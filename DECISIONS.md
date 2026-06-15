# DECISIONS

## 1. Seq-Based Ordering And Deduplication

Incoming frames are forwarded to a Web Worker, decoded there, and validated into a discriminated `ProtocolMessage` union. The worker owns the transport-ordering layer: a `ReorderBuffer` stores future `seq` values in a `Map` and tracks the lowest future sequence with a min-heap. The normal path, `msg.seq === expectedSeq`, is O(1) and drains any now-contiguous buffered messages.

Deduplication is a time-based sliding window, not an unbounded `Set`. It keeps recent seqs in an array plus head pointer and mirrors membership in a `Set<number>`, so eviction does not use `array.shift()`. The main thread persists recent seqs in `sessionStorage`; the worker never touches browser storage directly.

Two counters are intentionally separate:

- `lastReceivedSeq` advances in the worker after ordering and deduplication.
- `lastRenderedSeq` advances in the main thread after the log projection commits.

Reconnect sends `RESUME` with `lastRenderedSeq`, because anything received but not rendered still needs replay.

## 2. Tool-Call Layout Stability

Chat is derived from the append-only event log into stream parts: text segment, tool card, result update, next text segment. A `TOOL_CALL` creates a new structural boundary in the stream, so later tokens render after the tool card rather than rewriting earlier text. This keeps tool interruptions stable and prevents result updates from overwriting prior calls.

Worker log entries are not committed to React one at a time. They are queued and flushed with `requestAnimationFrame`, so a burst of WebSocket messages becomes one log commit for that frame. Protocol responses are separate from rendering: PONG and TOOL_ACK are still sent immediately from the worker path before the UI waits for a render frame.

The current implementation uses React projections from the immutable log rather than direct `Text.appendData`. That is simpler and verified against the provided token rate. If this needed significantly higher token throughput, I would move the chat hot path to imperative text-node appends while keeping the same log-derived structural model for tool cards.

## 3. Reconnection State Recovery

The main thread owns the real `WebSocket`; the worker owns protocol ordering. On socket close, the UI stays readable and schedules capped exponential backoff. On reconnect, the first client message is `RESUME` when `lastRenderedSeq > 0`. Replayed events go back through the same worker reorder/dedup pipeline, so replay stitching is not a special rendering case.

The app reset path explicitly closes and reconnects after `GET /reset`, because the provided server stops heartbeat timers on reset without restarting them on the existing socket. Reconnecting after reset restores real heartbeat verification.

The provided server is single-client. When a newer browser page connects, it closes the previous socket with code `1000` and reason `replaced`. The client treats that close as terminal for the older tab instead of reconnecting, which prevents two tabs from replacing each other in a loop.

## 4. 50 Concurrent Streams

The current stream projection already keys by `stream_id`, which avoids global `isStreaming` collapse. For 50 concurrent streams I would partition the event log by `stream_id` and render only visible stream partitions at full rate. Timeline virtualization is already in place, but chat would need viewport-aware stream virtualization and stricter batching.

## 5. 100x Longer Responses

For document-length responses I would not keep appending to large visible text blocks indefinitely. I would chunk text segments, virtualize old chunks, and keep an index from seq range to chunk. Context snapshots would move heavier diff work fully into a worker and render only expanded tree branches, with pagination for very large arrays or object maps.

## 6. Context Tree Virtualization

The context inspector does not recursively render the entire JSON object and it does not cap branches. It keeps an expanded-path set, flattens only the currently visible expanded JSON nodes, and renders those rows through `@tanstack/react-virtual`. This preserves expand/collapse, diff highlighting, syntax coloring, and the history scrubber while keeping the 500KB+ schema responsive.

The tradeoff is that flattening still happens on the main thread when expansion changes. For the provided 603KB schema this is acceptable; for much larger context payloads I would move visible-row flattening and diff computation into a worker.

## 7. Protocol Failure Mode Found

The chaos server can produce a `TOOL_ACK_TIMEOUT` that the client cannot prevent: if chaos buffering holds the `TOOL_CALL`, the server starts waiting for ACK before the browser receives the call. The client sends `TOOL_ACK` immediately when it receives a `TOOL_CALL`, before waiting for ordered rendering, but it cannot ACK a call ID it has not seen.

This is visible in the provided server source: `runScript()` awaits `sendMessage(TOOL_CALL)` and then starts `waitForAck()`, but `sendMessage()` can return after `ChaosEngine.process()` has buffered the message and returned no frames to send. The timeout therefore starts before the client has a call ID to acknowledge.

The timestamped reproduction is included in `docs/evidence/ack-race-timestamped.json`. In that run, the server logged `TOOL_ACK_TIMEOUT` at `1781360215885`; the client first received the delayed `TOOL_CALL` at `1781360217339` and sent `TOOL_ACK` at `1781360217339`. That is a 0ms client ACK after first observation, but 1,454ms after the server-side timeout had already fired. `docs/evidence/ack-ok-baseline.json` shows the same immediate-ACK logic passing cleanly when chaos does not withhold the call frame.

## 8. Manual Proof Boundary

Reviewer-facing chaos proof should be recorded manually against the real provided server. I do not modify the server, replay protocol events, or use a fake WebSocket backend. `docs/manual-live-proof.md` gives the manual prompt/check sequence; `docs/rapid-tool-server-audit.md` documents the real server limitation around parallel rapid tool calls.
