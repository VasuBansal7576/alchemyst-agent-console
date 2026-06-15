# Manual Live Proof Workflow

Use this for the final reviewer-facing recording. Do not run the CDP recorder, do not replay protocol events, and do not use a fake backend.

If the UI feels unclear, read `docs/live-run-cheatsheet.md` first. It explains what each panel means and what output to expect for each prompt.

## Setup

Terminal 1:

```bash
cd "hiring/June-2026_FullStackAI/agent-server"
npm start -- --mode chaos
```

Terminal 2:

```bash
npm run start -- -p 3000
```

Browser:

- Open `http://localhost:3000`.
- Keep the app full-screen or side-by-side with this checklist.
- Start a normal screen recording manually with QuickTime, Loom, or another screen recorder.
- Label scenarios by speaking them out loud or keeping this checklist visible in the recording.

## Required Live Segments

### 1. Drop / Resume / Out-Of-Order / Sequential Tools

1. Click reset in the app.
2. Send:

```text
compare correlation metrics
```

3. Show both tool cards:
   - `fetch_dataset`
   - `compute_correlation`
4. Show timeline markers when they appear:
   - `OUT_OF_ORDER_BUFFERED`
   - `DUPLICATE_DROPPED`
   - `GAP_DETECTED`
5. Fetch `/log` from the Protocol Proof panel.
6. If the server drops during this run, show `RESUME ok`.
7. If no drop happens within about 45 seconds, keep recording, click reset, and retry the same prompt. Chaos profiles are random.

### 2. Oversized Context And Virtualized Tree

1. Click reset.
2. Send:

```text
schema database large context
```

3. Show `ctx_schema` with a size around 603 KB.
4. Wait for the `analyze_schema` tool result and the final tokens. The context selector should show `ctx_schema`, and the history counter should reach `2/2`.
5. In Context Inspector:
   - Expand `root`.
   - Expand `tables`.
   - Expand a table entry such as `0`.
   - Expand nested branches such as `columns`.
   - Scroll the JSON tree; it should remain responsive because visible rows are virtualized.
6. Use the history scrubber to move between the two schema snapshots and show the diff count changing.
7. If chaos interrupts before the second schema snapshot arrives, keep recording and use `report` after reset as a fallback history-scrubber proof; `report` also emits two snapshots for `ctx_report`.

### 3. Corrupt Heartbeat

1. Leave the chaos server running.
2. Fetch `/log` periodically from the Protocol Proof panel.
3. Show a `PONG ok` entry with empty `echo`.
4. Confirm the UI did not crash or disconnect.

## Acceptance Check Before Submission

The final recording should be 3-5 minutes and visibly show:

- Real local app at `http://localhost:3000`.
- Real provided server in `--mode chaos`.
- Connection drop and `RESUME ok`.
- Out-of-order/duplicate/gap timeline markers.
- Sequential live tool calls from the real server.
- Oversized 500KB+ context snapshot.
- Virtualized context tree scroll/expand behavior.
- Corrupt heartbeat handled with empty `PONG` echo.

If the recording misses one of these because chaos randomness did not trigger it, record again. Do not patch the server or fake protocol events.
