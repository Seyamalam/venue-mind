# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

## VenueMind product direction

- The selected visual target is the second generated concept: the bright Editorial Planning Studio at `/Users/seyam/.codex/generated_images/01a03ee4-c9c1-7573-bb03-9d47cc2f5d47/exec-47251252-ff3a-40e1-97e2-839dfb4c1ba4.png`.
- Preserve its warm architectural-paper palette, expansive top-down plan, restrained violet proposal overlays, concise left-side brief, and bottom comparison bar.
- The core interaction is `inspect -> ghost proposal -> human review -> approve/request adjustment`; the UI must feel like a spatial design tool, never a chatbot dashboard.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.
