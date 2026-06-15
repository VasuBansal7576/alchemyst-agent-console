export interface BaseMessage {
  seq: number;
}

export interface TokenMsg extends BaseMessage {
  type: "TOKEN";
  stream_id: string;
  text: string;
}

export interface ToolCallMsg extends BaseMessage {
  type: "TOOL_CALL";
  stream_id: string;
  call_id: string;
  tool_name: string;
  args: Record<string, unknown>;
}

export interface ToolResultMsg extends BaseMessage {
  type: "TOOL_RESULT";
  stream_id: string;
  call_id: string;
  result: Record<string, unknown>;
}

export interface ContextSnapMsg extends BaseMessage {
  type: "CONTEXT_SNAPSHOT";
  context_id: string;
  data: Record<string, unknown>;
}

export interface PingMsg extends BaseMessage {
  type: "PING";
  challenge: string;
}

export interface StreamEndMsg extends BaseMessage {
  type: "STREAM_END";
  stream_id: string;
}

export interface ErrorMsg extends BaseMessage {
  type: "ERROR";
  code: string;
  message: string;
}

export type ProtocolMessage =
  | TokenMsg
  | ToolCallMsg
  | ToolResultMsg
  | ContextSnapMsg
  | PingMsg
  | StreamEndMsg
  | ErrorMsg;

export type ClientMessage =
  | { type: "USER_MESSAGE"; content: string }
  | { type: "PONG"; echo: string }
  | { type: "RESUME"; last_seq: number }
  | { type: "TOOL_ACK"; call_id: string };

export type ConnectionState =
  | { type: "DISCONNECTED"; retryCount: number; nextRetryAt: number | null }
  | { type: "CONNECTING"; attemptNumber: number }
  | { type: "CONNECTED" }
  | { type: "STREAMING"; activeStreamIds: string[] }
  | { type: "RECONNECTING"; reason: "DROP" | "ERROR" | "HEARTBEAT_TIMEOUT"; retryCount: number };

export type LogEntry =
  | {
      id: string;
      direction: "server";
      type: "TOKEN";
      seq: number;
      streamId: string;
      text: string;
      ts: number;
    }
  | {
      id: string;
      direction: "server";
      type: "TOOL_CALL";
      seq: number;
      streamId: string;
      callId: string;
      toolName: string;
      args: Record<string, unknown>;
      ts: number;
    }
  | {
      id: string;
      direction: "server";
      type: "TOOL_RESULT";
      seq: number;
      streamId: string;
      callId: string;
      result: Record<string, unknown>;
      ts: number;
    }
  | {
      id: string;
      direction: "server";
      type: "CONTEXT_SNAPSHOT";
      seq: number;
      contextId: string;
      data: Record<string, unknown>;
      ts: number;
    }
  | {
      id: string;
      direction: "server";
      type: "STREAM_END";
      seq: number;
      streamId: string;
      ts: number;
    }
  | {
      id: string;
      direction: "server";
      type: "ERROR";
      seq: number;
      code: string;
      message: string;
      ts: number;
    }
  | {
      id: string;
      direction: "server";
      type: "PING";
      seq: number;
      challenge: string;
      ts: number;
    }
  | {
      id: string;
      direction: "client";
      type: "CLIENT_SEND";
      clientType: ClientMessage["type"];
      payload: ClientMessage;
      relatedSeq?: number;
      ts: number;
    }
  | {
      id: string;
      direction: "internal";
      type: "GAP_DETECTED";
      missingSeq: number;
      ts: number;
    }
  | {
      id: string;
      direction: "internal";
      type: "OUT_OF_ORDER_BUFFERED";
      seq: number;
      expectedSeq: number;
      ts: number;
    }
  | {
      id: string;
      direction: "internal";
      type: "DUPLICATE_DROPPED";
      seq: number;
      expectedSeq: number;
      ts: number;
    }
  | {
      id: string;
      direction: "internal";
      type: "PROTOCOL_ERROR";
      message: string;
      raw?: string;
      ts: number;
    };

export interface HealthStatus {
  status: string;
  mode: "normal" | "chaos";
  connected: boolean;
  seq: number;
  historyLength: number;
}

export interface ServerClientLogEntry {
  timestamp: number;
  type: string;
  data: Record<string, unknown>;
  verdict?: string;
}

export type WorkerInboundMessage =
  | { type: "FRAME"; payload: string | ArrayBuffer }
  | { type: "RESET_TURN" }
  | { type: "INIT_DEDUP"; seqs: number[] }
  | { type: "SET_LAST_RENDERED_SEQ"; seq: number };

export type WorkerOutboundMessage =
  | { type: "LOG_ENTRY"; entry: LogEntry }
  | { type: "SEND_CLIENT_MESSAGE"; message: ClientMessage; relatedSeq?: number }
  | { type: "PERSIST_SEQS"; seqs: number[] }
  | { type: "LAST_RECEIVED_SEQ"; seq: number };

export function protocolToLogEntry(msg: ProtocolMessage, ts = Date.now()): LogEntry {
  switch (msg.type) {
    case "TOKEN":
      return {
        id: `s:${msg.seq}:TOKEN`,
        direction: "server",
        type: "TOKEN",
        seq: msg.seq,
        streamId: msg.stream_id,
        text: msg.text,
        ts,
      };
    case "TOOL_CALL":
      return {
        id: `s:${msg.seq}:TOOL_CALL:${msg.call_id}`,
        direction: "server",
        type: "TOOL_CALL",
        seq: msg.seq,
        streamId: msg.stream_id,
        callId: msg.call_id,
        toolName: msg.tool_name,
        args: msg.args,
        ts,
      };
    case "TOOL_RESULT":
      return {
        id: `s:${msg.seq}:TOOL_RESULT:${msg.call_id}`,
        direction: "server",
        type: "TOOL_RESULT",
        seq: msg.seq,
        streamId: msg.stream_id,
        callId: msg.call_id,
        result: msg.result,
        ts,
      };
    case "CONTEXT_SNAPSHOT":
      return {
        id: `s:${msg.seq}:CONTEXT:${msg.context_id}`,
        direction: "server",
        type: "CONTEXT_SNAPSHOT",
        seq: msg.seq,
        contextId: msg.context_id,
        data: msg.data,
        ts,
      };
    case "PING":
      return {
        id: `s:${msg.seq}:PING`,
        direction: "server",
        type: "PING",
        seq: msg.seq,
        challenge: msg.challenge,
        ts,
      };
    case "STREAM_END":
      return {
        id: `s:${msg.seq}:STREAM_END:${msg.stream_id}`,
        direction: "server",
        type: "STREAM_END",
        seq: msg.seq,
        streamId: msg.stream_id,
        ts,
      };
    case "ERROR":
      return {
        id: `s:${msg.seq}:ERROR`,
        direction: "server",
        type: "ERROR",
        seq: msg.seq,
        code: msg.code,
        message: msg.message,
        ts,
      };
  }
}

export function parseProtocolMessage(value: unknown): ProtocolMessage {
  if (!isRecord(value)) {
    throw new Error("Protocol frame is not a JSON object");
  }
  if (typeof value.type !== "string") {
    throw new Error("Protocol frame is missing type");
  }
  if (typeof value.seq !== "number" || !Number.isFinite(value.seq)) {
    throw new Error(`Protocol ${value.type} is missing numeric seq`);
  }

  switch (value.type) {
    case "TOKEN":
      assertString(value.stream_id, "stream_id");
      assertString(value.text, "text");
      return { type: "TOKEN", seq: value.seq, stream_id: value.stream_id, text: value.text };
    case "TOOL_CALL":
      assertString(value.stream_id, "stream_id");
      assertString(value.call_id, "call_id");
      assertString(value.tool_name, "tool_name");
      assertRecord(value.args, "args");
      return {
        type: "TOOL_CALL",
        seq: value.seq,
        stream_id: value.stream_id,
        call_id: value.call_id,
        tool_name: value.tool_name,
        args: value.args,
      };
    case "TOOL_RESULT":
      assertString(value.stream_id, "stream_id");
      assertString(value.call_id, "call_id");
      assertRecord(value.result, "result");
      return {
        type: "TOOL_RESULT",
        seq: value.seq,
        stream_id: value.stream_id,
        call_id: value.call_id,
        result: value.result,
      };
    case "CONTEXT_SNAPSHOT":
      assertString(value.context_id, "context_id");
      assertRecord(value.data, "data");
      return { type: "CONTEXT_SNAPSHOT", seq: value.seq, context_id: value.context_id, data: value.data };
    case "PING":
      return {
        type: "PING",
        seq: value.seq,
        challenge: typeof value.challenge === "string" ? value.challenge : "",
      };
    case "STREAM_END":
      assertString(value.stream_id, "stream_id");
      return { type: "STREAM_END", seq: value.seq, stream_id: value.stream_id };
    case "ERROR":
      assertString(value.code, "code");
      assertString(value.message, "message");
      return { type: "ERROR", seq: value.seq, code: value.code, message: value.message };
    default:
      throw new Error(`Unknown protocol message type: ${value.type}`);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string") {
    throw new Error(`Protocol field ${field} must be a string`);
  }
}

function assertRecord(value: unknown, field: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`Protocol field ${field} must be an object`);
  }
}
