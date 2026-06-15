# Verification Log

Last updated: 2026-06-14

## Static Gates

```bash
npm test
# 5 test files passed, 17 tests passed

npm run typecheck
# tsc --noEmit passed

npm run build
# next build passed

npm audit --json
# 0 vulnerabilities
```

Latest gate runs:

- 2026-06-13 19:48 IST, after timeline/result selection fix:
  - `npm test` - passed, including stacked tool-call projection and stream-safe token grouping.
  - `npm run typecheck` - passed.
  - `npm run build` - passed.
- `npm audit --json` - passed with 0 vulnerabilities after pinning transitive `postcss` through `overrides`.
- 2026-06-14, after context-tree virtualization:
  - `npm test` - passed, including virtualized context-tree flattening with a 350-item expanded branch and no cap.
  - `npm run typecheck` - passed.
  - `npm run build` - passed.
  - `npm audit --json` - passed with 0 vulnerabilities.

## Normal Mode Browser Verification

Environment:

- App: `npm run start -- -p 3000`
- Server: `hiring/June-2026_FullStackAI/agent-server`, `npm start`
- Browser: real local app against the real provided server.

Verified prompts:

- `report`
  - Streamed text rendered.
  - `lookup_metric` card rendered.
  - Tool result rendered.
  - `/log` contained `TOOL_ACK` with `verdict: "ok"`.
  - Re-verified after rAF-batched log commits: reached `RECEIVED 37` / `RENDERED 37`, `TOOL_ACK ok`, no violations, no page errors.
  - Screenshot: `docs/screenshots/normal-report-tool.png`

- `hello`
  - Timeline token-group click highlighted the corresponding chat text chunk in a real browser run.

- `compare correlation metrics`
  - Two sequential tool cards rendered: `fetch_dataset`, `compute_correlation`.
  - `/log` had two `TOOL_ACK ok` entries and no violations.

- `schema database large`
  - 603 KB context snapshot rendered.
  - Context tree now flattens visible expanded nodes and renders rows with `@tanstack/react-virtual`.
  - Context diff panel and history scrubber remained interactive.
  - `/log` had no violations.
  - Screenshot: `docs/screenshots/normal-context-diff.png`

Manual re-check before final submission:

- Run the prompts above in the browser and fetch `/log` from the Protocol Proof panel.
- Do not use scripted browser capture as reviewer-facing proof.

## Chaos Mode Browser Verification

Environment:

- App: `npm run start -- -p 3000`
- Server: `hiring/June-2026_FullStackAI/agent-server`, `npm start -- --mode chaos`
- Browser: manual live recording workflow in `docs/manual-live-proof.md`

Manual workflow must show:

- `compare correlation metrics`
  - `RESUME ok` when the real chaos server drops the connection.
  - Two `TOOL_ACK ok` entries for the server-supported sequential tool calls.
  - `OUT_OF_ORDER_BUFFERED`, `DUPLICATE_DROPPED`, and/or `GAP_DETECTED` timeline markers.
  - `fetch_dataset` and `compute_correlation` cards/results.

- `schema database large context`
  - 603 KB `ctx_schema` context snapshot.
  - Virtualized context tree scroll and nested expansion.
  - Context diff/history controls while chat and timeline remain interactive.

- Corrupt heartbeat
  - `/log` shows `PONG ok` with empty `echo`.
  - The UI does not crash or disconnect.

Server limitation:

- The provided server source was inspected for the "rapid tool calls" requirement. It has sequential scripted `tool_call` events and chaos shuffling/delay/drop/duplicate behavior, but no code path that synthesizes an extra second `TOOL_CALL` before the first `TOOL_RESULT`. Client-side projection support for stacked tool calls is covered by unit test.

## Chaos Recording Artifact

Reviewer-facing recording status:

- Manual recording is required before final submission.
- Follow `docs/manual-live-proof.md`.
- Save the final manual MP4 as `docs/recordings/chaos-mode-proof.mp4` or upload it to Loom/YouTube and include the link in the submission email.

Diagnostic files:

- `docs/evidence/ack-ok-baseline.json`
  - Clean large-context run with `TOOL_ACK ok`, no timeout.

- `docs/evidence/ack-race-timestamped.json`
  - Server logged `TOOL_ACK_TIMEOUT` at `1781360215885`.
  - Client first received delayed `TOOL_CALL` at `1781360217339`.
  - Client sent `TOOL_ACK` at `1781360217339`, 0ms after first observation and 1,454ms after the server timeout had already fired.

Known server-side chaos edge:

- The chaos server can buffer a `TOOL_CALL`, start its ACK timer, and only flush the tool-call frame after timeout when later messages arrive. The client ACKs immediately after receipt, but cannot ACK a call ID before seeing it.
