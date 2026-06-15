import { describe, expect, it } from "vitest";
import { deriveChatStreams, deriveTimelineRows } from "./derive";
import type { LogEntry } from "./protocol";

describe("deriveChatStreams", () => {
  it("keeps rapid stacked tool calls without overwriting either result", () => {
    const entries: LogEntry[] = [
      token(1, "s1", "before "),
      toolCall(2, "s1", "c1", "first_tool"),
      toolCall(3, "s1", "c2", "second_tool"),
      toolResult(4, "s1", "c2", { ok: "second" }),
      toolResult(5, "s1", "c1", { ok: "first" }),
      token(6, "s1", "after"),
    ];

    const [stream] = deriveChatStreams(entries);

    expect(stream.parts).toMatchObject([
      { type: "text", text: "before " },
      { type: "tool", callId: "c1", toolName: "first_tool", result: { ok: "first" } },
      { type: "tool", callId: "c2", toolName: "second_tool", result: { ok: "second" } },
      { type: "text", text: "after" },
    ]);
  });
});

describe("deriveTimelineRows", () => {
  it("groups only consecutive token entries from the same stream", () => {
    const rows = deriveTimelineRows([
      token(1, "s1", "a"),
      token(2, "s1", "b"),
      token(3, "s2", "x"),
      token(4, "s1", "c"),
    ]);

    expect(rows).toMatchObject([
      { kind: "token-group", streamId: "s1", fromSeq: 1, toSeq: 2, tokenCount: 2, text: "ab" },
      { kind: "token-group", streamId: "s2", fromSeq: 3, toSeq: 3, tokenCount: 1, text: "x" },
      { kind: "token-group", streamId: "s1", fromSeq: 4, toSeq: 4, tokenCount: 1, text: "c" },
    ]);
  });
});

function token(seq: number, streamId: string, text: string): LogEntry {
  return {
    id: `s:${seq}:TOKEN`,
    direction: "server",
    type: "TOKEN",
    seq,
    streamId,
    text,
    ts: seq,
  };
}

function toolCall(seq: number, streamId: string, callId: string, toolName: string): LogEntry {
  return {
    id: `s:${seq}:TOOL_CALL:${callId}`,
    direction: "server",
    type: "TOOL_CALL",
    seq,
    streamId,
    callId,
    toolName,
    args: { callId },
    ts: seq,
  };
}

function toolResult(seq: number, streamId: string, callId: string, result: Record<string, unknown>): LogEntry {
  return {
    id: `s:${seq}:TOOL_RESULT:${callId}`,
    direction: "server",
    type: "TOOL_RESULT",
    seq,
    streamId,
    callId,
    result,
    ts: seq,
  };
}
