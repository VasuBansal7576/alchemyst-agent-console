# Rapid Tool Call Server Audit

The assignment text mentions rapid tool calls: two `TOOL_CALL` events in quick succession for the same stream before any `TOOL_RESULT`.

I re-checked the provided server source without modifying it:

- `hiring/June-2026_FullStackAI/agent-server/src/server.ts:336-370`
  - For each scripted `tool_call`, the server sends one `TOOL_CALL`.
  - It then awaits `waitForAck(callId)`.
  - It then waits for simulated tool execution.
  - It then sends the matching `TOOL_RESULT`.
  - Only after this does the script loop continue to later events.

- `hiring/June-2026_FullStackAI/agent-server/src/scripts.ts:124-175`
  - The multi-tool script contains `fetch_dataset` followed later by `compute_correlation`.
  - Tokens and the first result sit between those tool calls.

- `hiring/June-2026_FullStackAI/agent-server/src/chaos.ts:46-103`
  - Chaos can buffer, delay, shuffle, duplicate, and drop existing messages.
  - It does not synthesize a new second `TOOL_CALL`.

Conclusion: true rapid parallel tool calls cannot be intentionally triggered live without modifying the provided server or faking protocol traffic. The client still supports stacked rapid tool calls in code: `src/lib/derive.test.ts` covers two `TOOL_CALL` events before either result, with results arriving out of order.

Reviewer-facing proof should therefore show the real server-supported sequential tool sequence live, and explain this server limitation honestly rather than manufacturing a fake rapid-tool demo.
