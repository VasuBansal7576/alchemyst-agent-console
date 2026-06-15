# Live Run Cheat Sheet

Use this before recording if the app feels confusing.

## What The App Is

This is not a normal chatbot demo. It is an **agent event console**.

The assignment cares about whether the UI survives messy WebSocket agent events:

- streamed tokens
- tool calls and tool results
- large context snapshots
- dropped/reordered/duplicated messages in chaos mode
- heartbeat `PING` / `PONG`
- reconnect and `RESUME`

## What The Four Panels Mean

### Chat

This is the human-readable answer.

For `compare correlation metrics`, expect:

- text starting with `Let me analyze...`
- a `fetch_dataset` tool card
- later a `compute_correlation` tool card
- eventually tool results, unless chaos delays or drops frames

### Trace Timeline

This is the raw event stream shown in order.

Useful proof labels:

- `TOKEN`
- `TOOL_CALL`
- `TOOL_RESULT`
- `CONTEXT_SNAPSHOT`
- `OUT_OF_ORDER_BUFFERED`
- `DUPLICATE_DROPPED`
- `GAP_DETECTED`

If chaos mode is confusing, this panel is where the weirdness is explained.

### Context Inspector

This shows context snapshots sent by the server.

For `schema database large context`, expect:

- `ctx_schema`
- about `603,441 bytes`
- `2/2` after the full stream finishes
- expandable JSON rows like `tables`, `0`, and `columns`

The point is to show the app handles a 500KB+ context without freezing.

### Protocol Proof

This is the server-side audit log from `GET /log`.

Good things to show:

- `USER_MESSAGE ok`
- `TOOL_ACK ok`
- `PONG ok`
- `RESUME ok` if chaos dropped the connection

Confusing but known chaos edge:

- `TOOL_ACK_TIMEOUT violation` followed by `TOOL_ACK unexpected`

That can happen because the provided chaos server starts the ACK timer before the browser receives the delayed `TOOL_CALL`. It is documented in `docs/verification-log.md` and `DECISIONS.md`.

## Easiest Practice Run

Before recording, run in this order:

1. `report`
   - easiest to understand
   - shows streamed text, one tool call, one tool result, and two context snapshots

2. `schema database large context`
   - shows the big 603KB context tree

3. `compare correlation metrics`
   - shows two sequential tool calls
   - in chaos mode this can look messy because the server may delay/reorder/drop frames

## What Counts As A Good Final Recording

The recording does not need to look perfectly clean. It needs to show:

- the real app at `localhost:3000`
- the real provided server in chaos mode
- at least one tool call and tool result
- server `/log` proof for `TOOL_ACK ok` or the documented ACK race
- `PONG ok`, ideally with empty `echo`
- big `ctx_schema` context
- virtualized tree expansion/scroll
- reconnect/`RESUME ok` if chaos drops the socket
