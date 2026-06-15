/// <reference lib="webworker" />

import {
  parseProtocolMessage,
  protocolToLogEntry,
  type ClientMessage,
  type ProtocolMessage,
  type WorkerInboundMessage,
  type WorkerOutboundMessage,
} from "../lib/protocol";
import { ReorderBuffer } from "../lib/reorder-buffer";
import { SlidingDedupWindow } from "../lib/sliding-dedup-window";

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

let reorder = new ReorderBuffer<ProtocolMessage>(1, 3000);
let dedup = new SlidingDedupWindow(30_000);
let lastReceivedSeq = 0;
let lastRenderedSeq = 0;
const ackedCallIds = new Set<string>();
const decoder = new TextDecoder();

ctx.onmessage = (event: MessageEvent<WorkerInboundMessage>) => {
  const msg = event.data;
  switch (msg.type) {
    case "INIT_DEDUP":
      dedup.reset(msg.seqs);
      break;
    case "RESET_TURN":
      reorder = new ReorderBuffer<ProtocolMessage>(1, 3000);
      dedup = new SlidingDedupWindow(30_000);
      lastReceivedSeq = 0;
      lastRenderedSeq = 0;
      ackedCallIds.clear();
      post({ type: "PERSIST_SEQS", seqs: [] });
      break;
    case "SET_LAST_RENDERED_SEQ":
      lastRenderedSeq = msg.seq;
      break;
    case "FRAME":
      handleFrame(msg.payload);
      break;
  }
};

setInterval(() => {
  const gap = reorder.flushExpiredGap(Date.now());
  if (!gap) return;
  post({
    type: "LOG_ENTRY",
    entry: {
      id: `gap:${gap.missingSeq}:${Date.now()}`,
      direction: "internal",
      type: "GAP_DETECTED",
      missingSeq: gap.missingSeq,
      ts: Date.now(),
    },
  });
  for (const ready of gap.ready) {
    processReadyMessage(ready);
  }
}, 500);

function handleFrame(payload: string | ArrayBuffer): void {
  let raw: string;
  try {
    raw = typeof payload === "string" ? payload : decoder.decode(payload);
  } catch (error) {
    postProtocolError(error, "Unable to decode WebSocket frame");
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    postProtocolError(error, "Unable to parse WebSocket JSON", raw.slice(0, 300));
    return;
  }

  let protocol: ProtocolMessage;
  try {
    protocol = parseProtocolMessage(parsed);
  } catch (error) {
    postProtocolError(error, "Invalid protocol message", raw.slice(0, 300));
    return;
  }

  sendPriorityResponses(protocol);

  if (protocol.seq > reorder.expectedSeq) {
    post({
      type: "LOG_ENTRY",
      entry: {
        id: `out-of-order:${protocol.seq}:expected:${reorder.expectedSeq}:${Date.now()}`,
        direction: "internal",
        type: "OUT_OF_ORDER_BUFFERED",
        seq: protocol.seq,
        expectedSeq: reorder.expectedSeq,
        ts: Date.now(),
      },
    });
  } else if (protocol.seq < reorder.expectedSeq) {
    post({
      type: "LOG_ENTRY",
      entry: {
        id: `duplicate-dropped:${protocol.seq}:expected:${reorder.expectedSeq}:${Date.now()}`,
        direction: "internal",
        type: "DUPLICATE_DROPPED",
        seq: protocol.seq,
        expectedSeq: reorder.expectedSeq,
        ts: Date.now(),
      },
    });
  }

  const ready = reorder.insert(protocol, Date.now());
  for (const message of ready) {
    processReadyMessage(message);
  }
}

function sendPriorityResponses(message: ProtocolMessage): void {
  if (message.type === "PING") {
    const pong: ClientMessage = { type: "PONG", echo: message.challenge ?? "" };
    post({ type: "SEND_CLIENT_MESSAGE", message: pong, relatedSeq: message.seq });
    return;
  }

  if (message.type === "TOOL_CALL" && !ackedCallIds.has(message.call_id)) {
    ackedCallIds.add(message.call_id);
    const ack: ClientMessage = { type: "TOOL_ACK", call_id: message.call_id };
    post({ type: "SEND_CLIENT_MESSAGE", message: ack, relatedSeq: message.seq });
  }
}

function processReadyMessage(message: ProtocolMessage): void {
  const now = Date.now();
  if (dedup.has(message.seq, now)) {
    return;
  }
  dedup.add(message.seq, now);
  lastReceivedSeq = Math.max(lastReceivedSeq, message.seq);
  post({ type: "LAST_RECEIVED_SEQ", seq: lastReceivedSeq });
  post({ type: "PERSIST_SEQS", seqs: dedup.snapshot(100) });
  post({ type: "LOG_ENTRY", entry: protocolToLogEntry(message, now) });
}

function postProtocolError(error: unknown, message: string, raw?: string): void {
  const detail = error instanceof Error ? `${message}: ${error.message}` : message;
  post({
    type: "LOG_ENTRY",
    entry: {
      id: `protocol-error:${Date.now()}:${Math.random().toString(16).slice(2)}`,
      direction: "internal",
      type: "PROTOCOL_ERROR",
      message: detail,
      raw,
      ts: Date.now(),
    },
  });
}

function post(message: WorkerOutboundMessage): void {
  ctx.postMessage(message);
}

void lastRenderedSeq;
