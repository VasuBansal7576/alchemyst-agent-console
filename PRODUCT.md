# Product

## Register

product

## Users

Primary users are technical reviewers, hiring evaluators, and the candidate operating the assignment locally. They are trying to inspect whether an agent console can survive real WebSocket chaos: streamed tokens, tool calls, context snapshots, reconnects, heartbeats, and protocol violations. They need quick orientation, trustworthy evidence, and clear failure boundaries without reading the source first.

## Product Purpose

The console is a local observability surface for the provided Alchemyst agent-server. It exists to make the append-only event log understandable through synchronized chat, trace timeline, context, and protocol-proof views. Success means a reviewer can run the real server, send known prompts, and immediately see what happened, what the client acknowledged, what chaos introduced, and why the UI remained stable.

## Brand Personality

Precise, operational, accountable. The interface should feel like a serious engineering console: calm under pressure, dense but legible, and explicit about evidence. It should avoid sales-demo gloss and instead earn trust through hierarchy, labels, status copy, and inspectable logs.

## Anti-references

Do not make this feel like a generic chatbot, a marketing dashboard, a toy demo, or a decorative dark-mode SaaS shell. Avoid vague panels, unexplained counters, floating decorative cards, oversized hero treatment, hidden protocol state, and any visual language that implies fake success when the server is chaotic or incomplete.

## Design Principles

- Evidence first: every major UI region should answer what happened, where it came from, and whether the server verified it.
- Explain the workflow in place: labels, hints, and empty states should teach the assignment scenarios without long documentation.
- Preserve operational density: keep chat, timeline, context, and protocol proof visible together on desktop so correlation is easy.
- Make chaos legible: out-of-order events, duplicate drops, gaps, ACK races, and reconnects should read as inspectable states, not random visual noise.
- Keep protocol boundaries honest: distinguish real server evidence, client-side projection, and documented server limitations.

## Accessibility & Inclusion

Target WCAG AA contrast for text and controls. Use system fonts, stable focus states, visible selected states, and reduced-motion-safe transitions. Avoid relying on color alone for status by pairing color with labels and icons. Keep controls keyboard reachable and ensure dense log text remains readable at typical laptop sizes.
