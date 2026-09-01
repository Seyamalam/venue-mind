# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

## VenueMind product direction

- The selected visual target is the second generated concept: the bright Editorial Planning Studio at `/Users/seyam/.codex/generated_images/01a03ee4-c9c1-7573-bb03-9d47cc2f5d47/exec-47251252-ff3a-40e1-97e2-839dfb4c1ba4.png`.
- Preserve its warm architectural-paper palette, expansive top-down plan, restrained violet proposal overlays, concise left-side brief, and bottom comparison bar.
- The core interaction is `inspect -> ghost proposal -> human review -> approve/request adjustment`; the UI must feel like a spatial design tool, never a chatbot dashboard.
- Product UI uses terse operational labels and values only; do not add narrative marketing or explanatory copy to product chrome. Documentation prose is exempt.
- The frontend target is the latest stable Next.js App Router with Tailwind CSS 4 and source-owned shadcn/ui primitives. Preserve the selected Design 2 rather than adopting stock shadcn styling.

Build product UI in the Next.js App Router and reusable client components in `src/`. Vercel is the sole frontend host. Cloudflare runs only the API Worker and D1; never add a second frontend build, SPA fallback, alternate hosting package, or compatibility entry point.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
