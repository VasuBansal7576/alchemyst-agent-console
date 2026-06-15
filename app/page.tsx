"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Database,
  Filter,
  Link2,
  PauseCircle,
  Plug,
  RefreshCcw,
  Search,
  Send,
  TerminalSquare,
  Wrench,
  XCircle,
} from "lucide-react";
import { type FormEvent, type KeyboardEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { deriveChatStreams, deriveTimelineRows, type ChatPart, type TimelineRow } from "@/lib/derive";
import { diffJson, diffPathSet, type JsonPatch } from "@/lib/json-diff";
import { flattenVisibleJsonRows } from "@/lib/json-tree";
import { isRecord, type ClientMessage, type ConnectionState, type HealthStatus, type LogEntry, type ServerClientLogEntry, type WorkerOutboundMessage } from "@/lib/protocol";

const HTTP_BASE = "http://localhost:4747";
const WS_URL = "ws://localhost:4747/ws";
const DEDUP_STORAGE_KEY = "alchemyst-agent-console:dedup-seqs";
const EVENT_TYPE_FILTERS = [
  "TOKEN",
  "TOOL_CALL",
  "TOOL_RESULT",
  "CONTEXT_SNAPSHOT",
  "PING",
  "CLIENT_SEND",
  "ERROR",
  "GAP_DETECTED",
  "OUT_OF_ORDER_BUFFERED",
  "DUPLICATE_DROPPED",
] as const;

type EventTypeFilter = (typeof EVENT_TYPE_FILTERS)[number];
type ProofTone = "pending" | "active" | "pass" | "warn";

const SCENARIOS = [
  {
    id: "tool",
    label: "Clean tool proof",
    prompt: "report",
    description: "One tool call, result payload, two context snapshots, and a clean server ACK.",
    expectation: "Expect `lookup_metric`, a result payload, `ctx_report`, then `TOOL_ACK ok` after Fetch /log.",
  },
  {
    id: "context",
    label: "Large context",
    prompt: "schema database large context",
    description: "603KB schema snapshot, virtual JSON tree, diff summary, and history scrubber.",
    expectation: "Expect `ctx_schema`, `analyze_schema`, a 500KB+ snapshot, and expandable `tables` rows.",
  },
  {
    id: "chaos",
    label: "Chaos tool sequence",
    prompt: "compare correlation metrics",
    description: "Sequential tool calls plus any reordered, duplicated, dropped, or delayed frames.",
    expectation: "Expect `fetch_dataset`, `compute_correlation`, chaos markers, and server ACK evidence or the documented ACK race.",
  },
] as const;

type Scenario = (typeof SCENARIOS)[number];

interface ProofCard {
  id: string;
  title: string;
  tone: ProofTone;
  status: string;
  run: string;
  expect: string;
  evidence: string;
  scenario?: Scenario;
}

export default function AgentConsolePage() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [input, setInput] = useState("hello");
  const [connection, setConnection] = useState<ConnectionState>({ type: "DISCONNECTED", retryCount: 0, nextRetryAt: null });
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [serverLog, setServerLog] = useState<ServerClientLogEntry[]>([]);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [lastReceivedSeq, setLastReceivedSeq] = useState(0);
  const [lastRenderedSeq, setLastRenderedSeq] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const retryRef = useRef(0);
  const manualCloseRef = useRef(false);
  const hasOpenedRef = useRef(false);
  const lastRenderedSeqRef = useRef(0);
  const connectRef = useRef<(attempt?: number) => void>(() => undefined);
  const pendingEntriesRef = useRef<LogEntry[]>([]);
  const logFlushFrameRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const flushPendingEntries = useCallback(() => {
    logFlushFrameRef.current = null;
    const batch = pendingEntriesRef.current;
    if (batch.length === 0) return;
    pendingEntriesRef.current = [];

    setEntries((current) => {
      const seen = new Set(current.map((entry) => entry.id));
      const nextEntries: LogEntry[] = [];
      for (const entry of batch) {
        if (seen.has(entry.id)) continue;
        seen.add(entry.id);
        nextEntries.push(entry);
      }
      if (nextEntries.length === 0) return current;
      return [...current, ...nextEntries];
    });
  }, []);

  const appendEntry = useCallback(
    (entry: LogEntry) => {
      pendingEntriesRef.current.push(entry);
      if (logFlushFrameRef.current === null) {
        logFlushFrameRef.current = window.requestAnimationFrame(flushPendingEntries);
      }
    },
    [flushPendingEntries],
  );

  const clearPendingEntries = useCallback(() => {
    pendingEntriesRef.current = [];
    if (logFlushFrameRef.current !== null) {
      window.cancelAnimationFrame(logFlushFrameRef.current);
      logFlushFrameRef.current = null;
    }
  }, []);

  const appendClientSend = useCallback(
    (message: ClientMessage, relatedSeq?: number) => {
      appendEntry({
        id: `client:${message.type}:${relatedSeq ?? "none"}:${Date.now()}:${Math.random().toString(16).slice(2)}`,
        direction: "client",
        type: "CLIENT_SEND",
        clientType: message.type,
        payload: message,
        relatedSeq,
        ts: Date.now(),
      });
    },
    [appendEntry],
  );

  const sendClientMessage = useCallback(
    (message: ClientMessage, relatedSeq?: number): boolean => {
      const socket = wsRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return false;
      }
      socket.send(JSON.stringify(message));
      appendClientSend(message, relatedSeq);
      return true;
    },
    [appendClientSend],
  );

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const scheduleReconnect = useCallback(
    (reason: "DROP" | "ERROR" | "HEARTBEAT_TIMEOUT") => {
      clearReconnectTimer();
      const retryCount = retryRef.current;
      const baseDelay = Math.min(500 * 2 ** retryCount, 10_000);
      const delay = Math.round(baseDelay * (1 + 0.3 * Math.random()));
      const nextRetryAt = Date.now() + delay;
      retryRef.current = retryCount + 1;
      setConnection({ type: "RECONNECTING", reason, retryCount });
      reconnectTimerRef.current = window.setTimeout(() => connectRef.current(retryRef.current), delay);
      window.setTimeout(() => {
        setConnection((current) => {
          if (current.type !== "RECONNECTING" || current.retryCount !== retryCount) return current;
          return { type: "DISCONNECTED", retryCount, nextRetryAt };
        });
      }, 0);
    },
    [clearReconnectTimer],
  );

  const connect = useCallback(
    (attempt = 0) => {
      clearReconnectTimer();
      const existing = wsRef.current;
      if (existing?.readyState === WebSocket.OPEN || existing?.readyState === WebSocket.CONNECTING) {
        return;
      }

      setConnection({ type: "CONNECTING", attemptNumber: attempt + 1 });
      manualCloseRef.current = false;

      const socket = new WebSocket(WS_URL);
      socket.binaryType = "arraybuffer";
      wsRef.current = socket;

      socket.onopen = () => {
        retryRef.current = 0;
        const wasReconnect = hasOpenedRef.current;
        hasOpenedRef.current = true;

        if (wasReconnect && lastRenderedSeqRef.current > 0) {
          sendClientMessage({ type: "RESUME", last_seq: lastRenderedSeqRef.current });
        }

        setConnection({ type: "CONNECTED" });
        void refreshHealth();
      };

      socket.onmessage = (event: MessageEvent<string | ArrayBuffer>) => {
        const worker = workerRef.current;
        if (!worker) return;
        if (event.data instanceof ArrayBuffer) {
          worker.postMessage({ type: "FRAME", payload: event.data }, [event.data]);
        } else {
          worker.postMessage({ type: "FRAME", payload: event.data });
        }
      };

      socket.onerror = () => {
        if (wsRef.current !== socket) return;
        setConnection({ type: "RECONNECTING", reason: "ERROR", retryCount: retryRef.current });
      };

      socket.onclose = (event) => {
        if (wsRef.current !== socket) return;
        if (manualCloseRef.current) {
          setConnection({ type: "DISCONNECTED", retryCount: retryRef.current, nextRetryAt: null });
          return;
        }
        if (event.code === 1000 && event.reason === "replaced") {
          setConnection({ type: "DISCONNECTED", retryCount: retryRef.current, nextRetryAt: null });
          return;
        }
        scheduleReconnect("DROP");
      };
    },
    [clearReconnectTimer, scheduleReconnect, sendClientMessage],
  );

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    const worker = new Worker(new URL("../src/workers/protocol-worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;

    const saved = readPersistedSeqs();
    worker.postMessage({ type: "INIT_DEDUP", seqs: saved });

    worker.onmessage = (event: MessageEvent<WorkerOutboundMessage>) => {
      const message = event.data;
      switch (message.type) {
        case "LOG_ENTRY":
          appendEntry(message.entry);
          break;
        case "SEND_CLIENT_MESSAGE":
          sendClientMessage(message.message, message.relatedSeq);
          break;
        case "PERSIST_SEQS":
          sessionStorage.setItem(DEDUP_STORAGE_KEY, JSON.stringify(message.seqs));
          break;
        case "LAST_RECEIVED_SEQ":
          setLastReceivedSeq(message.seq);
          break;
      }
    };

    connect(0);

    return () => {
      manualCloseRef.current = true;
      clearReconnectTimer();
      clearPendingEntries();
      worker.terminate();
      workerRef.current = null;
      wsRef.current?.close(1000, "component_unmount");
      wsRef.current = null;
    };
  }, [appendEntry, clearPendingEntries, clearReconnectTimer, connect, sendClientMessage]);

  useEffect(() => {
    void refreshHealth();
    const id = window.setInterval(() => {
      void refreshHealth();
    }, 2500);
    return () => window.clearInterval(id);
  }, []);

  useLayoutEffect(() => {
    const maxRendered = entries.reduce((max, entry) => {
      if (entry.direction === "server" && "seq" in entry) {
        return Math.max(max, entry.seq);
      }
      return max;
    }, 0);
    lastRenderedSeqRef.current = maxRendered;
    setLastRenderedSeq(maxRendered);
    workerRef.current?.postMessage({ type: "SET_LAST_RENDERED_SEQ", seq: maxRendered });
  }, [entries]);

  const submitMessage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = input.trim();
    if (!content) return;
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      connect(0);
      return;
    }

    workerRef.current?.postMessage({ type: "RESET_TURN" });
    clearPendingEntries();
    setEntries([]);
    setServerLog([]);
    setSelectedTraceId(null);
    lastRenderedSeqRef.current = 0;
    setLastRenderedSeq(0);
    setLastReceivedSeq(0);
    sendClientMessage({ type: "USER_MESSAGE", content });
    setConnection({ type: "STREAMING", activeStreamIds: [] });
  };

  const fetchServerLog = async () => {
    try {
      const res = await fetch(`${HTTP_BASE}/log`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ServerClientLogEntry[];
      setServerLog(data);
    } catch (error) {
      appendEntry({
        id: `server-log-error:${Date.now()}`,
        direction: "internal",
        type: "PROTOCOL_ERROR",
        message: error instanceof Error ? error.message : "Unable to fetch server log",
        ts: Date.now(),
      });
    }
  };

  const resetServer = async () => {
    await fetch(`${HTTP_BASE}/reset`, { cache: "no-store" }).catch(() => undefined);
    manualCloseRef.current = true;
    wsRef.current?.close(1000, "client_reset_reconnect");
    wsRef.current = null;
    hasOpenedRef.current = false;
    retryRef.current = 0;
    workerRef.current?.postMessage({ type: "RESET_TURN" });
    clearPendingEntries();
    setEntries([]);
    setServerLog([]);
    setSelectedTraceId(null);
    lastRenderedSeqRef.current = 0;
    setLastRenderedSeq(0);
    setLastReceivedSeq(0);
    await refreshHealth();
    connect(0);
  };

  const activeViolations = serverLog.filter((item) => item.verdict && !["ok", "unexpected"].includes(item.verdict));
  const chatStreams = useMemo(() => deriveChatStreams(entries), [entries]);
  const proofCards = useMemo(() => buildProofCards(entries, serverLog, input), [entries, input, serverLog]);
  const callIdToTimelineId = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of entries) {
      if (entry.direction === "server" && entry.type === "TOOL_CALL") {
        map.set(entry.callId, entry.id);
      }
    }
    return map;
  }, [entries]);

  useEffect(() => {
    if (connection.type === "STREAMING" && chatStreams.length > 0 && chatStreams.every((stream) => stream.complete)) {
      setConnection({ type: "CONNECTED" });
    }
  }, [chatStreams, connection.type]);

  async function refreshHealth() {
    try {
      const res = await fetch(`${HTTP_BASE}/health`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as HealthStatus;
      setHealth(data);
      setHealthError(null);
    } catch (error) {
      setHealth(null);
      setHealthError(error instanceof Error ? error.message : "health unavailable");
    }
  }

  return (
    <main className="console-shell">
      <header className="topbar">
        <div className="brand">
          <Bot aria-hidden="true" />
          <div>
            <span>Real server observer</span>
            <h1>Alchemyst Agent Console</h1>
            <p>Token stream, tool calls, context snapshots, and server proof in one correlated log.</p>
          </div>
        </div>
        <div className="status-strip">
          <StatusPill label="socket" value={connectionLabel(connection)} tone={connectionTone(connection)} />
          <StatusPill label="server" value={health ? `${health.mode} seq ${health.seq}` : healthError ?? "offline"} tone={health ? "good" : "bad"} />
          <StatusPill label="received" value={String(lastReceivedSeq)} tone="neutral" />
          <StatusPill label="rendered" value={String(lastRenderedSeq)} tone="neutral" />
          <button className="icon-button" type="button" onClick={() => connect(0)} title="Reconnect">
            <Plug aria-hidden="true" />
          </button>
          <button className="icon-button" type="button" onClick={() => void resetServer()} title="Reset server session">
            <RefreshCcw aria-hidden="true" />
          </button>
        </div>
      </header>

      <GuidedProofMode
        cards={proofCards}
        onSelectScenario={(scenario) => {
          setInput(scenario.prompt);
          inputRef.current?.focus();
        }}
      />

      <section className="workspace-grid">
        <section className="panel chat-panel" aria-label="Streaming chat">
          <PanelHeader
            icon={<TerminalSquare aria-hidden="true" />}
            title="Agent Response"
            description="Readable stream projection with stable tool cards."
            meta={`${chatStreams.length} stream${chatStreams.length === 1 ? "" : "s"}`}
          />
          <ChatPane
            streams={chatStreams}
            callIdToTimelineId={callIdToTimelineId}
            selectedTraceId={selectedTraceId}
            onSelectTrace={setSelectedTraceId}
          />
          <form className="composer" onSubmit={submitMessage}>
            <input
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Send a scenario prompt to the real agent-server"
              aria-label="Message"
            />
            <button type="submit" disabled={wsRef.current?.readyState !== WebSocket.OPEN}>
              <Send aria-hidden="true" />
              Send
            </button>
          </form>
        </section>

        <section className="panel timeline-panel" aria-label="Agent trace timeline">
          <PanelHeader
            icon={<Activity aria-hidden="true" />}
            title="Trace Timeline"
            description="Seq-ordered event log with transport anomalies made visible."
            meta={`${entries.length} log entries`}
          />
          <TimelinePane entries={entries} selectedTraceId={selectedTraceId} onSelectTrace={setSelectedTraceId} />
        </section>

        <section className="panel context-panel" aria-label="Context inspector">
          <PanelHeader
            icon={<Database aria-hidden="true" />}
            title="Context Inspector"
            description="Snapshot history, JSON diff, and virtualized large-context tree."
            meta="snapshots + diffs"
          />
          <ContextPane entries={entries} />
        </section>

        <section className="panel protocol-panel" aria-label="Server verification log">
          <PanelHeader
            icon={activeViolations.length > 0 ? <XCircle aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
            title="Protocol Proof"
            description="Server-side `/log` evidence for PONG, TOOL_ACK, and RESUME."
            meta={activeViolations.length > 0 ? `${activeViolations.length} violation(s)` : "server /log"}
          />
          <div className="protocol-actions">
            <button type="button" onClick={() => void fetchServerLog()}>
              <RefreshCcw aria-hidden="true" />
              Fetch /log
            </button>
            <span>{serverLog.length} server-side client events</span>
          </div>
          <ServerLogTable rows={serverLog} />
        </section>
      </section>
    </main>
  );
}

function GuidedProofMode({ cards, onSelectScenario }: { cards: ProofCard[]; onSelectScenario: (scenario: Scenario) => void }) {
  const passed = cards.filter((card) => card.tone === "pass").length;
  const attention = cards.filter((card) => card.tone === "warn").length;

  return (
    <section className="proof-guide" aria-label="Guided proof mode">
      <div className="proof-guide-copy">
        <div>
          <h2>Guided proof mode</h2>
          <p>Start the real server and console, send the prompts below, then fetch `/log`. These cards only turn green when the live trace or server audit log proves the requirement.</p>
          <div className="proof-commands" aria-label="Run commands">
            <code>server normal: cd hiring/June-2026_FullStackAI/agent-server && npm start</code>
            <code>server chaos: cd hiring/June-2026_FullStackAI/agent-server && npm start -- --mode chaos</code>
            <code>console: npm run start</code>
          </div>
        </div>
        <div className="proof-score" aria-label="Proof progress">
          <strong>{passed}/{cards.length}</strong>
          <span>{attention > 0 ? `${attention} needs explanation` : "proof checks clear"}</span>
        </div>
      </div>

      <div className="proof-steps">
        {cards.map((card) => {
          const scenario = card.scenario;
          return (
            <article className={`proof-card ${card.tone}`} key={card.id}>
              <div className="proof-card-head">
                <span>{card.status}</span>
                <strong>{card.title}</strong>
              </div>
              <p>{card.evidence}</p>
              <dl>
                <div>
                  <dt>Run</dt>
                  <dd>{card.run}</dd>
                </div>
                <div>
                  <dt>Expect</dt>
                  <dd>{card.expect}</dd>
                </div>
              </dl>
              {scenario ? (
                <button type="button" onClick={() => onSelectScenario(scenario)}>
                  Use prompt
                </button>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function buildProofCards(entries: LogEntry[], serverLog: ServerClientLogEntry[], input: string): ProofCard[] {
  const lastPrompt = lastUserPrompt(entries);
  const activeScenario = scenarioForPrompt(input) ?? scenarioForPrompt(lastPrompt);
  const serverStarted = serverLog.length > 0;
  const ackOkCount = serverLog.filter((row) => row.type === "TOOL_ACK" && row.verdict === "ok").length;
  const ackRaceCount = serverLog.filter((row) => row.type === "TOOL_ACK_TIMEOUT" && row.verdict === "violation").length;
  const userMessageOk = serverLog.some((row) => row.type === "USER_MESSAGE" && row.verdict === "ok");
  const pongOk = serverLog.some((row) => row.type === "PONG" && row.verdict === "ok");
  const emptyPongOk = serverLog.some((row) => row.type === "PONG" && row.verdict === "ok" && typeof row.data.echo === "string" && row.data.echo.length === 0);
  const resumeOk = serverLog.some((row) => row.type === "RESUME" && row.verdict === "ok");
  const transportMarkers = entries.filter(
    (entry) => entry.type === "GAP_DETECTED" || entry.type === "OUT_OF_ORDER_BUFFERED" || entry.type === "DUPLICATE_DROPPED",
  );

  const reportSnapshots = contextSnapshots(entries, "ctx_report");
  const schemaSnapshots = contextSnapshots(entries, "ctx_schema");
  const schemaBytes = maxJsonBytes(schemaSnapshots.map((entry) => entry.data));
  const hasLookupResult = hasToolResult(entries, "lookup_metric");
  const hasAnalyzeSchema = hasToolCall(entries, "analyze_schema") || hasToolResult(entries, "analyze_schema");
  const hasFetchDataset = hasToolCall(entries, "fetch_dataset") || hasToolResult(entries, "fetch_dataset");
  const hasCorrelation = hasToolCall(entries, "compute_correlation") || hasToolResult(entries, "compute_correlation");
  const hasCorrelationResult = hasToolResult(entries, "compute_correlation");

  const toolScenario = SCENARIOS[0];
  const contextScenario = SCENARIOS[1];
  const chaosScenario = SCENARIOS[2];
  const toolTraceReady = hasLookupResult && reportSnapshots.length >= 2;
  const toolServerReady = ackOkCount >= 1;
  const contextReady = schemaBytes >= 500_000 && hasAnalyzeSchema;
  const chaosTraceReady = hasFetchDataset && hasCorrelation;
  const chaosServerExplained = ackOkCount >= 2 || ackRaceCount > 0 || transportMarkers.length > 0;
  const protocolReady = userMessageOk && pongOk && (ackOkCount > 0 || ackRaceCount > 0);

  return [
    {
      id: "tool-proof",
      title: "Tool call and ACK",
      tone: proofTone(toolTraceReady && toolServerReady, activeScenario?.id === toolScenario.id, false),
      status: toolTraceReady && toolServerReady ? "Proven" : toolTraceReady ? "Fetch /log" : activeScenario?.id === toolScenario.id ? "Running" : "Run this",
      run: "Prompt `report`, wait for completion, then click Fetch /log.",
      expect: toolScenario.expectation,
      evidence: toolTraceReady
        ? `Observed lookup_metric result and ${reportSnapshots.length} ctx_report snapshot${reportSnapshots.length === 1 ? "" : "s"}; server has ${ackOkCount} TOOL_ACK ok.`
        : "Waiting for lookup_metric, its result payload, and two ctx_report snapshots in the live trace.",
      scenario: toolScenario,
    },
    {
      id: "large-context-proof",
      title: "Large context explorer",
      tone: proofTone(contextReady, activeScenario?.id === contextScenario.id, false),
      status: contextReady ? "Proven" : activeScenario?.id === contextScenario.id ? "Running" : "Run this",
      run: "Prompt `schema database large context`, open Context Inspector, expand `tables`.",
      expect: contextScenario.expectation,
      evidence:
        schemaBytes > 0
          ? `Observed ctx_schema at ${schemaBytes.toLocaleString()} bytes with ${schemaSnapshots.length} snapshot${schemaSnapshots.length === 1 ? "" : "s"}; analyze_schema ${hasAnalyzeSchema ? "appeared" : "not seen yet"}.`
          : "Waiting for the 500KB+ ctx_schema snapshot and the analyze_schema tool proof.",
      scenario: contextScenario,
    },
    {
      id: "chaos-proof",
      title: "Chaos tool sequence",
      tone: proofTone(chaosTraceReady && chaosServerExplained, activeScenario?.id === chaosScenario.id, ackRaceCount > 0),
      status: ackRaceCount > 0 ? "Explain" : chaosTraceReady && chaosServerExplained ? "Proven" : activeScenario?.id === chaosScenario.id ? "Running" : "Run this",
      run: "In chaos mode, prompt `compare correlation metrics`, then click Fetch /log.",
      expect: chaosScenario.expectation,
      evidence: chaosTraceReady
        ? `Observed fetch_dataset and compute_correlation${hasCorrelationResult ? " with result" : ""}; ${transportMarkers.length} transport marker${transportMarkers.length === 1 ? "" : "s"}, ${ackRaceCount} ACK timeout${ackRaceCount === 1 ? "" : "s"}.`
        : "Waiting for the sequential fetch_dataset and compute_correlation tool calls from the real chaos server.",
      scenario: chaosScenario,
    },
    {
      id: "protocol-proof",
      title: "Heartbeat and resume",
      tone: proofTone(protocolReady, serverStarted, ackRaceCount > 0 && !protocolReady),
      status: protocolReady ? "Proven" : serverStarted ? "Review /log" : "Fetch /log",
      run: "After any run, click Fetch /log. In chaos mode, wait for drops if you need RESUME proof.",
      expect: "Expect USER_MESSAGE ok, PONG ok, TOOL_ACK ok or documented ACK race, and RESUME ok if chaos drops the socket.",
      evidence: serverStarted
        ? `Server log: USER_MESSAGE ${userMessageOk ? "ok" : "missing"}, PONG ${pongOk ? "ok" : "missing"}${emptyPongOk ? " with empty echo" : ""}, TOOL_ACK ok x${ackOkCount}, RESUME ${resumeOk ? "ok" : "not observed"}.`
        : "No server /log loaded yet, so protocol compliance is not proven on screen.",
    },
  ];
}

function proofTone(passed: boolean, active: boolean, warn: boolean): ProofTone {
  if (warn) return "warn";
  if (passed) return "pass";
  if (active) return "active";
  return "pending";
}

function scenarioForPrompt(prompt: string | null): Scenario | undefined {
  const normalized = prompt?.trim().toLowerCase();
  if (!normalized) return undefined;
  return SCENARIOS.find((scenario) => scenario.prompt.toLowerCase() === normalized);
}

function lastUserPrompt(entries: LogEntry[]): string | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.direction !== "client" || entry.type !== "CLIENT_SEND" || entry.clientType !== "USER_MESSAGE") continue;
    return entry.payload.type === "USER_MESSAGE" ? entry.payload.content : null;
  }
  return null;
}

function hasToolCall(entries: LogEntry[], toolName: string): boolean {
  return entries.some((entry) => entry.direction === "server" && entry.type === "TOOL_CALL" && entry.toolName === toolName);
}

function hasToolResult(entries: LogEntry[], toolName: string): boolean {
  const callIds = new Set(
    entries
      .filter((entry): entry is Extract<LogEntry, { type: "TOOL_CALL" }> => entry.direction === "server" && entry.type === "TOOL_CALL" && entry.toolName === toolName)
      .map((entry) => entry.callId),
  );
  return entries.some((entry) => entry.direction === "server" && entry.type === "TOOL_RESULT" && callIds.has(entry.callId));
}

function contextSnapshots(entries: LogEntry[], contextId: string): Extract<LogEntry, { type: "CONTEXT_SNAPSHOT" }>[] {
  return entries.filter((entry): entry is Extract<LogEntry, { type: "CONTEXT_SNAPSHOT" }> => entry.direction === "server" && entry.type === "CONTEXT_SNAPSHOT" && entry.contextId === contextId);
}

function maxJsonBytes(values: Record<string, unknown>[]): number {
  return values.reduce((max, value) => Math.max(max, JSON.stringify(value).length), 0);
}

function PanelHeader({ icon, title, description, meta }: { icon: React.ReactNode; title: string; description: string; meta: string }) {
  return (
    <div className="panel-header">
      <div className="panel-title">
        {icon}
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>
      <span>{meta}</span>
    </div>
  );
}

function StatusPill({ label, value, tone }: { label: string; value: string; tone: "good" | "warn" | "bad" | "neutral" }) {
  return (
    <div className={`status-pill ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ChatPane({
  streams,
  selectedTraceId,
  callIdToTimelineId,
  onSelectTrace,
}: {
  streams: ReturnType<typeof deriveChatStreams>;
  selectedTraceId: string | null;
  callIdToTimelineId: Map<string, string>;
  onSelectTrace: (id: string) => void;
}) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [streams]);

  if (streams.length === 0) {
    return (
      <div className="empty-state">
        <Circle aria-hidden="true" />
        <strong>No active stream</strong>
        <p>Choose a runbook scenario or send a prompt. Tool calls will appear here as inspectable cards, not inline noise.</p>
      </div>
    );
  }

  return (
    <div className="chat-scroll">
      {streams.map((stream) => (
        <article className="stream-card" key={stream.streamId}>
          <div className="stream-heading">
            <span>{stream.streamId}</span>
            {stream.complete ? <CheckCircle2 aria-hidden="true" /> : <PauseCircle aria-hidden="true" />}
          </div>
          <div className="stream-body">
            {stream.parts.map((part) => (
              <ChatPartView
                key={part.id}
                part={part}
                selectedTraceId={selectedTraceId}
                callIdToTimelineId={callIdToTimelineId}
                onSelectTrace={onSelectTrace}
              />
            ))}
          </div>
        </article>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

function ChatPartView({
  part,
  selectedTraceId,
  callIdToTimelineId,
  onSelectTrace,
}: {
  part: ChatPart;
  selectedTraceId: string | null;
  callIdToTimelineId: Map<string, string>;
  onSelectTrace: (id: string) => void;
}) {
  if (part.type === "text") {
    const selectedTokenSeq = selectedTokenSeqForStream(selectedTraceId, part.streamId);
    const selected = selectedTokenSeq !== null && selectedTokenSeq >= part.fromSeq && selectedTokenSeq <= part.toSeq;
    return (
      <p className={`stream-text ${selected ? "selected" : ""}`} data-seq-range={`${part.fromSeq}-${part.toSeq}`}>
        {part.text}
      </p>
    );
  }

  if (part.type === "end") {
    return <div className="stream-end">stream complete at seq {part.seq}</div>;
  }

  const timelineId = callIdToTimelineId.get(part.callId) ?? part.id;
  const resultTimelineId = part.resultSeq ? `s:${part.resultSeq}:TOOL_RESULT:${part.callId}` : null;
  const selected = selectedTraceId === timelineId || selectedTraceId === resultTimelineId;
  return (
    <button
      type="button"
      className={`tool-card ${selected ? "selected" : ""}`}
      onClick={() => onSelectTrace(timelineId)}
    >
      <div className="tool-card-head">
        <Wrench aria-hidden="true" />
        <strong>{part.toolName}</strong>
        <span>{part.callId}</span>
      </div>
      <JsonPreview title="args" value={part.args} />
      {part.result ? <JsonPreview title="result" value={part.result} /> : <div className="waiting-result">waiting for TOOL_RESULT</div>}
    </button>
  );
}

function TimelinePane({
  entries,
  selectedTraceId,
  onSelectTrace,
}: {
  entries: LogEntry[];
  selectedTraceId: string | null;
  onSelectTrace: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [enabledTypes, setEnabledTypes] = useState<Set<EventTypeFilter>>(() => new Set(EVENT_TYPE_FILTERS));
  const [expandedRows, setExpandedRows] = useState<Set<string>>(() => new Set());
  const parentRef = useRef<HTMLDivElement | null>(null);
  const rows = useMemo(() => deriveTimelineRows(entries), [entries]);

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      const type = row.kind === "token-group" ? "TOKEN" : row.entry.type;
      if (!enabledTypes.has(type as EventTypeFilter)) return false;
      if (!needle) return true;
      return timelineSearchText(row).toLowerCase().includes(needle);
    });
  }, [enabledTypes, query, rows]);

  const virtualizer = useVirtualizer({
    count: filteredRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 46,
    measureElement: (element) => element.getBoundingClientRect().height,
    overscan: 8,
  });

  useEffect(() => {
    if (!selectedTraceId) return;
    const index = filteredRows.findIndex((row) => row.id === selectedTraceId || (row.kind === "entry" && row.entry.id === selectedTraceId));
    if (index >= 0) {
      virtualizer.scrollToIndex(index, { align: "center" });
    }
  }, [filteredRows, selectedTraceId, virtualizer]);

  const toggleFilter = (type: EventTypeFilter) => {
    setEnabledTypes((current) => {
      const next = new Set(current);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  return (
    <div className="timeline-shell">
      <div className="filter-bar">
        <div className="search-box">
          <Search aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search trace" />
        </div>
        <div className="filter-buttons" aria-label="Event filters">
          <Filter aria-hidden="true" />
          {EVENT_TYPE_FILTERS.map((type) => (
            <button key={type} type="button" className={enabledTypes.has(type) ? "active" : ""} onClick={() => toggleFilter(type)}>
              {type.replace("_", " ")}
            </button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="empty-state compact">
          <Activity aria-hidden="true" />
          <strong>No events yet</strong>
          <p>The timeline will show ordered TOKEN, TOOL_CALL, TOOL_RESULT, CONTEXT_SNAPSHOT, and chaos markers after a prompt runs.</p>
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="empty-state compact">
          <Search aria-hidden="true" />
          <strong>No matching events</strong>
          <p>Clear the search or re-enable event filters to inspect the full trace.</p>
        </div>
      ) : null}
      <div ref={parentRef} className="timeline-viewport">
        <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = filteredRows[item.index];
            const expanded = expandedRows.has(row.id);
            return (
              <div
                key={row.id}
                ref={virtualizer.measureElement}
                className="virtual-row"
                style={{ transform: `translateY(${item.start}px)` }}
                data-index={item.index}
              >
                <TimelineRowView
                  row={row}
                  expanded={expanded}
                  selected={selectedTraceId === row.id || (row.kind === "entry" && selectedTraceId === row.entry.id)}
                  onSelect={() => onSelectTrace(row.id)}
                  onToggle={() =>
                    setExpandedRows((current) => {
                      const next = new Set(current);
                      if (next.has(row.id)) next.delete(row.id);
                      else next.add(row.id);
                      return next;
                    })
                  }
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TimelineRowView({
  row,
  expanded,
  selected,
  onSelect,
  onToggle,
}: {
  row: TimelineRow;
  expanded: boolean;
  selected: boolean;
  onSelect: () => void;
  onToggle: () => void;
}) {
  if (row.kind === "token-group") {
    const duration = Math.max(0, row.endedAt - row.startedAt) / 1000;
    return (
      <div
        role="button"
        tabIndex={0}
        className={`timeline-row token-row ${selected ? "selected" : ""}`}
        onClick={onSelect}
        onKeyDown={(event) => handleTimelineRowKeyDown(event, onSelect)}
      >
        <span className="row-seq">
          {row.fromSeq}-{row.toSeq}
        </span>
        <div className="row-main">
          <div className="row-title">
            <button type="button" className="tiny-toggle" onClick={(event) => { event.stopPropagation(); onToggle(); }}>
              {expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
            </button>
            <strong>TOKEN</strong>
            <span>{row.tokenCount} tokens</span>
            <span>{duration.toFixed(1)}s</span>
          </div>
          <p className="row-summary-line">{compact(row.text, 86)}</p>
          {expanded ? <pre>{row.text}</pre> : null}
        </div>
      </div>
    );
  }

  const entry = row.entry;
  const seq = entry.direction === "server" && "seq" in entry ? entry.seq : entry.direction === "client" ? "client" : "internal";
  const canExpand = timelineEntryCanExpand(entry);
  return (
    <div
      role="button"
      tabIndex={0}
      className={`timeline-row ${selected ? "selected" : ""} ${entry.type.toLowerCase()}`}
      onClick={onSelect}
      onKeyDown={(event) => handleTimelineRowKeyDown(event, onSelect)}
    >
      <span className="row-seq">{seq}</span>
      <div className="row-main">
        <div className="row-title">
          {canExpand ? (
            <button type="button" className="tiny-toggle" onClick={(event) => { event.stopPropagation(); onToggle(); }}>
              {expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
            </button>
          ) : (
            <span className="toggle-spacer" />
          )}
          {timelineIcon(entry)}
          <strong>{timelineEntryTitle(entry)}</strong>
          <span>{new Date(entry.ts).toLocaleTimeString()}</span>
        </div>
        <TimelineEntrySummary entry={entry} expanded={expanded} />
      </div>
    </div>
  );
}

function TimelineEntrySummary({ entry, expanded }: { entry: LogEntry; expanded: boolean }) {
  const summary = summarizeEntry(entry);
  const detail = timelineEntryDetail(entry);
  const canExpand = detail !== summary;
  return (
    <div className="row-detail">
      <p className="row-summary-line">{summary}</p>
      {expanded && canExpand ? <pre>{detail}</pre> : null}
    </div>
  );
}

function ContextPane({ entries }: { entries: LogEntry[] }) {
  const snapshots = useMemo(() => {
    const byId = new Map<string, Extract<LogEntry, { type: "CONTEXT_SNAPSHOT" }>[]>();
    for (const entry of entries) {
      if (entry.direction === "server" && entry.type === "CONTEXT_SNAPSHOT") {
        const list = byId.get(entry.contextId) ?? [];
        list.push(entry);
        byId.set(entry.contextId, list);
      }
    }
    return byId;
  }, [entries]);

  const contextIds = [...snapshots.keys()];
  const [selectedContextId, setSelectedContextId] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    if (contextIds.length === 0) {
      setSelectedContextId(null);
      setSelectedIndex(0);
      return;
    }
    if (!selectedContextId || !snapshots.has(selectedContextId)) {
      const id = contextIds[0];
      setSelectedContextId(id);
      setSelectedIndex(Math.max(0, (snapshots.get(id)?.length ?? 1) - 1));
    } else {
      const maxIndex = Math.max(0, (snapshots.get(selectedContextId)?.length ?? 1) - 1);
      setSelectedIndex((current) => Math.min(current, maxIndex));
    }
  }, [contextIds, selectedContextId, snapshots]);

  if (contextIds.length === 0 || !selectedContextId) {
    return (
      <div className="empty-state">
        <Database aria-hidden="true" />
        <strong>No context snapshots</strong>
        <p>Run `report` for a small diff or `schema database large context` for the 603KB virtualized tree proof.</p>
      </div>
    );
  }

  const history = snapshots.get(selectedContextId) ?? [];
  const selected = history[selectedIndex] ?? history[history.length - 1];
  const previous = selectedIndex > 0 ? history[selectedIndex - 1] : null;
  const patches = selected ? diffJson(previous?.data ?? {}, selected.data) : [];
  const changedPaths = diffPathSet(patches);

  return (
    <div className="context-shell">
      <div className="context-controls">
        <label>
          <span>Context</span>
          <select value={selectedContextId} onChange={(event) => { setSelectedContextId(event.target.value); setSelectedIndex(Math.max(0, (snapshots.get(event.target.value)?.length ?? 1) - 1)); }}>
            {contextIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Snapshot history</span>
          <input
            type="range"
            min={0}
            max={Math.max(0, history.length - 1)}
            value={selectedIndex}
            onChange={(event) => setSelectedIndex(Number(event.target.value))}
          />
        </label>
        <strong>
          {selectedIndex + 1}/{history.length}
        </strong>
      </div>
      <div className="diff-summary">
        <strong>{patches.length}</strong>
        <span>diff operation{patches.length === 1 ? "" : "s"} since previous snapshot</span>
      </div>
      <JsonTree value={selected?.data ?? {}} changedPaths={changedPaths} patches={patches} />
    </div>
  );
}

function JsonTree({ value, changedPaths, patches }: { value: unknown; changedPaths: Set<string>; patches: JsonPatch[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(["/"]));
  const parentRef = useRef<HTMLDivElement | null>(null);
  const patchByPath = useMemo(() => new Map(patches.map((patch) => [patch.path, patch])), [patches]);
  const rows = useMemo(() => flattenVisibleJsonRows(value, expanded), [expanded, value]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 26,
    overscan: 24,
  });

  const toggle = (path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <div className="json-tree" ref={parentRef}>
      <div className="json-tree-inner" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index];
          const patch = patchByPath.get(row.path);
          const changed = changedPaths.has(row.path);
          const isOpen = row.expandable && expanded.has(row.path);
          return (
            <div
              key={row.path}
              className={`json-node-row virtual-json-row ${changed ? `changed ${patch?.op ?? "replace"}` : ""}`}
              style={{ transform: `translateY(${item.start}px)`, paddingLeft: `${row.depth * 14}px` }}
            >
              {row.expandable ? (
                <button type="button" className="tiny-toggle" onClick={() => toggle(row.path)}>
                  {isOpen ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
                </button>
              ) : (
                <span className="toggle-spacer" />
              )}
              <strong>{row.name}</strong>
              <span className={`json-value ${jsonValueClass(row.value)}`}>{row.expandable ? describeContainer(row.value) : formatScalar(row.value)}</span>
              {patch ? <em>{patch.op}</em> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ServerLogTable({ rows }: { rows: ServerClientLogEntry[] }) {
  if (rows.length === 0) {
    return (
      <div className="empty-state compact">
        <AlertTriangle aria-hidden="true" />
        <strong>No server log loaded</strong>
        <p>Fetch `/log` after a run to inspect real USER_MESSAGE, PONG, TOOL_ACK, RESUME, and any documented chaos violations.</p>
      </div>
    );
  }

  return (
    <div className="server-log-list">
      {rows.slice(-80).map((row, index) => (
        <div className={`server-log-row ${row.verdict ?? "unknown"}`} key={`${row.timestamp}:${row.type}:${index}`}>
          <span>{row.type}</span>
          <strong>{row.verdict ?? "n/a"}</strong>
          <code>{JSON.stringify(row.data)}</code>
        </div>
      ))}
    </div>
  );
}

function JsonPreview({ title, value }: { title: string; value: Record<string, unknown> }) {
  return (
    <div className="json-preview">
      <span>{title}</span>
      <code>{JSON.stringify(value, null, 2)}</code>
    </div>
  );
}

function timelineIcon(entry: LogEntry) {
  switch (entry.type) {
    case "TOOL_CALL":
    case "TOOL_RESULT":
      return <Wrench aria-hidden="true" />;
    case "CONTEXT_SNAPSHOT":
      return <Database aria-hidden="true" />;
    case "PING":
    case "CLIENT_SEND":
      return <Link2 aria-hidden="true" />;
    case "PROTOCOL_ERROR":
    case "GAP_DETECTED":
    case "OUT_OF_ORDER_BUFFERED":
    case "DUPLICATE_DROPPED":
    case "ERROR":
      return <AlertTriangle aria-hidden="true" />;
    default:
      return <Activity aria-hidden="true" />;
  }
}

function handleTimelineRowKeyDown(event: KeyboardEvent<HTMLDivElement>, onSelect: () => void) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  onSelect();
}

function timelineEntryTitle(entry: LogEntry): string {
  if (entry.type === "CLIENT_SEND") return entry.clientType;
  return entry.type;
}

function timelineEntryCanExpand(entry: LogEntry): boolean {
  return timelineEntryDetail(entry) !== summarizeEntry(entry);
}

function summarizeEntry(entry: LogEntry): string {
  switch (entry.type) {
    case "TOOL_CALL":
      return `${entry.toolName} · ${entry.callId} · ${summarizeRecord(entry.args)}`;
    case "TOOL_RESULT":
      return `${entry.callId} · result ${summarizeRecord(entry.result)}`;
    case "CONTEXT_SNAPSHOT":
      return `${entry.contextId} · ${jsonByteSize(entry.data).toLocaleString()} bytes · ${summarizeRecord(entry.data)}`;
    case "PING":
      return entry.challenge.length > 0 ? `challenge "${entry.challenge}"` : "empty challenge";
    case "STREAM_END":
      return `stream ${entry.streamId} complete`;
    case "ERROR":
      return `${entry.code}: ${entry.message}`;
    case "CLIENT_SEND":
      return summarizeClientMessage(entry.payload);
    case "GAP_DETECTED":
      return `missing seq ${entry.missingSeq} accepted after timeout`;
    case "OUT_OF_ORDER_BUFFERED":
      return `buffered future seq ${entry.seq}; waiting for expected seq ${entry.expectedSeq}`;
    case "DUPLICATE_DROPPED":
      return `dropped seq ${entry.seq}; expected seq is already ${entry.expectedSeq}`;
    case "PROTOCOL_ERROR":
      return entry.message;
    default:
      return "";
  }
}

function timelineEntryDetail(entry: LogEntry): string {
  switch (entry.type) {
    case "TOOL_CALL":
      return JSON.stringify({ tool: entry.toolName, call_id: entry.callId, stream: entry.streamId, args: entry.args }, null, 2);
    case "TOOL_RESULT":
      return JSON.stringify({ call_id: entry.callId, stream: entry.streamId, result: entry.result }, null, 2);
    case "CONTEXT_SNAPSHOT":
      return JSON.stringify(
        {
          context_id: entry.contextId,
          bytes: jsonByteSize(entry.data),
          top_level_keys: Object.keys(entry.data),
          inspect: "Open Context Inspector for the virtualized JSON tree and diff.",
        },
        null,
        2,
      );
    case "CLIENT_SEND":
      return JSON.stringify(entry.payload, null, 2);
    case "ERROR":
      return JSON.stringify({ code: entry.code, message: entry.message }, null, 2);
    case "PROTOCOL_ERROR":
      return entry.raw ? `${entry.message}\n\n${entry.raw}` : entry.message;
    default:
      return summarizeEntry(entry);
  }
}

function summarizeClientMessage(message: ClientMessage): string {
  switch (message.type) {
    case "USER_MESSAGE":
      return `prompt "${compact(message.content, 54)}"`;
    case "TOOL_ACK":
      return `ack ${message.call_id}`;
    case "PONG":
      return message.echo.length > 0 ? `echo "${message.echo}"` : "empty echo";
    case "RESUME":
      return `last_seq ${message.last_seq}`;
  }
}

function summarizeRecord(value: Record<string, unknown>): string {
  const keys = Object.keys(value);
  if (keys.length === 0) return "empty";
  return keys.slice(0, 4).map((key) => `${key}=${compact(formatInlineValue(value[key]), 28)}`).join(" · ") + (keys.length > 4 ? ` · +${keys.length - 4}` : "");
}

function formatInlineValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || value === null) return String(value);
  if (Array.isArray(value)) return `Array(${value.length})`;
  if (isRecord(value)) return `Object(${Object.keys(value).length})`;
  return typeof value;
}

function jsonByteSize(value: Record<string, unknown>): number {
  return JSON.stringify(value).length;
}

function timelineSearchText(row: TimelineRow): string {
  if (row.kind === "token-group") {
    return `TOKEN ${row.streamId} ${row.text}`;
  }
  return `${row.entry.type} ${timelineEntryTitle(row.entry)} ${summarizeEntry(row.entry)} ${timelineEntryDetail(row.entry)}`;
}

function connectionLabel(connection: ConnectionState): string {
  switch (connection.type) {
    case "DISCONNECTED":
      return connection.nextRetryAt ? `retry ${Math.max(0, connection.nextRetryAt - Date.now())}ms` : "disconnected";
    case "CONNECTING":
      return `connecting ${connection.attemptNumber}`;
    case "CONNECTED":
      return "connected";
    case "STREAMING":
      return "streaming";
    case "RECONNECTING":
      return `reconnecting ${connection.retryCount + 1}`;
  }
}

function connectionTone(connection: ConnectionState): "good" | "warn" | "bad" | "neutral" {
  switch (connection.type) {
    case "CONNECTED":
    case "STREAMING":
      return "good";
    case "CONNECTING":
    case "RECONNECTING":
      return "warn";
    case "DISCONNECTED":
      return "bad";
  }
}

function compact(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1)}...`;
}

function describeContainer(value: unknown): string {
  if (Array.isArray(value)) return `Array(${value.length})`;
  if (isRecord(value)) return `Object(${Object.keys(value).length})`;
  return "";
}

function formatScalar(value: unknown): string {
  if (typeof value === "string") return `"${compact(value, 100)}"`;
  if (value === null) return "null";
  return String(value);
}

function jsonValueClass(value: unknown): string {
  if (typeof value === "string") return "json-string";
  if (typeof value === "number") return "json-number";
  if (typeof value === "boolean") return "json-boolean";
  if (value === null) return "json-null";
  return "";
}

function readPersistedSeqs(): number[] {
  try {
    const raw = sessionStorage.getItem(DEDUP_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  } catch {
    return [];
  }
}

function selectedTokenSeqForStream(selectedTraceId: string | null, streamId: string): number | null {
  if (!selectedTraceId) return null;
  const prefix = `tokens:${streamId}:`;
  if (!selectedTraceId.startsWith(prefix)) return null;
  const seq = Number(selectedTraceId.slice(prefix.length));
  return Number.isFinite(seq) ? seq : null;
}
