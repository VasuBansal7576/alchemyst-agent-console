import type { LogEntry } from "./protocol";

export type ChatPart =
  | { type: "text"; id: string; streamId: string; text: string; fromSeq: number; toSeq: number }
  | {
      type: "tool";
      id: string;
      streamId: string;
      callId: string;
      toolName: string;
      args: Record<string, unknown>;
      result?: Record<string, unknown>;
      callSeq: number;
      resultSeq?: number;
    }
  | { type: "end"; id: string; streamId: string; seq: number };

export interface ChatStream {
  streamId: string;
  parts: ChatPart[];
  complete: boolean;
}

interface MutableStream {
  streamId: string;
  parts: ChatPart[];
  complete: boolean;
}

export function deriveChatStreams(entries: LogEntry[]): ChatStream[] {
  const streams = new Map<string, MutableStream>();

  for (const entry of entries) {
    if (entry.direction !== "server") continue;
    if (!("streamId" in entry)) continue;

    const stream = getStream(streams, entry.streamId);
    switch (entry.type) {
      case "TOKEN": {
        const last = stream.parts[stream.parts.length - 1];
        if (last?.type === "text") {
          last.text += entry.text;
          last.toSeq = entry.seq;
        } else {
          stream.parts.push({
            type: "text",
            id: `text:${entry.streamId}:${entry.seq}`,
            streamId: entry.streamId,
            text: entry.text,
            fromSeq: entry.seq,
            toSeq: entry.seq,
          });
        }
        break;
      }
      case "TOOL_CALL":
        stream.parts.push({
          type: "tool",
          id: `tool:${entry.callId}`,
          streamId: entry.streamId,
          callId: entry.callId,
          toolName: entry.toolName,
          args: entry.args,
          callSeq: entry.seq,
        });
        break;
      case "TOOL_RESULT": {
        const existing = stream.parts.find((part) => part.type === "tool" && part.callId === entry.callId);
        if (existing?.type === "tool") {
          existing.result = entry.result;
          existing.resultSeq = entry.seq;
        } else {
          stream.parts.push({
            type: "tool",
            id: `tool:${entry.callId}`,
            streamId: entry.streamId,
            callId: entry.callId,
            toolName: "unknown_tool",
            args: {},
            result: entry.result,
            callSeq: entry.seq,
            resultSeq: entry.seq,
          });
        }
        break;
      }
      case "STREAM_END":
        stream.complete = true;
        stream.parts.push({ type: "end", id: `end:${entry.streamId}:${entry.seq}`, streamId: entry.streamId, seq: entry.seq });
        break;
      default:
        break;
    }
  }

  return [...streams.values()].map((stream) => ({
    streamId: stream.streamId,
    complete: stream.complete,
    parts: stream.parts,
  }));
}

export type TimelineRow =
  | {
      kind: "token-group";
      id: string;
      streamId: string;
      fromSeq: number;
      toSeq: number;
      tokenCount: number;
      text: string;
      startedAt: number;
      endedAt: number;
    }
  | { kind: "entry"; id: string; entry: LogEntry };

export function deriveTimelineRows(entries: LogEntry[]): TimelineRow[] {
  const rows: TimelineRow[] = [];
  let activeTokenGroup: Extract<TimelineRow, { kind: "token-group" }> | null = null;

  for (const entry of entries) {
    if (entry.direction === "server" && entry.type === "TOKEN") {
      if (activeTokenGroup && activeTokenGroup.streamId === entry.streamId && activeTokenGroup.toSeq + 1 === entry.seq) {
        activeTokenGroup.toSeq = entry.seq;
        activeTokenGroup.tokenCount += 1;
        activeTokenGroup.text += entry.text;
        activeTokenGroup.endedAt = entry.ts;
      } else {
        activeTokenGroup = {
          kind: "token-group",
          id: `tokens:${entry.streamId}:${entry.seq}`,
          streamId: entry.streamId,
          fromSeq: entry.seq,
          toSeq: entry.seq,
          tokenCount: 1,
          text: entry.text,
          startedAt: entry.ts,
          endedAt: entry.ts,
        };
        rows.push(activeTokenGroup);
      }
    } else {
      activeTokenGroup = null;
      rows.push({ kind: "entry", id: entry.id, entry });
    }
  }

  return rows;
}

function getStream(streams: Map<string, MutableStream>, streamId: string): MutableStream {
  const existing = streams.get(streamId);
  if (existing) return existing;
  const created: MutableStream = { streamId, parts: [], complete: false };
  streams.set(streamId, created);
  return created;
}
