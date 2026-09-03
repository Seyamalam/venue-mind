# Frontend platform verification

VenueMind has one frontend: the Next.js App Router deployment on Vercel. Cloudflare owns only the API Worker and D1. The platform gate rejects a Vite or JavaScript compatibility entry point, a Cloudflare static-asset frontend, a missing D1 binding, or a public route that includes Studio-only client modules.

## Complete gate

Run:

```bash
npm run verify:frontend-platform
```

The command first creates the production Next.js build. It then reads the emitted client-reference manifests for docs, Projects, Settings, Shared Review, and Studio. Docs and non-Studio routes must exclude the Studio runtime, planner, WebMCP registration, and browser Project store; Studio must own its route runtime. Hashed chunk names are deliberately ignored because their content identity changes between builds.

The focused tests cover route metadata and CSS ownership, deferred Studio surfaces, WebMCP registration cleanup, collaboration subscription teardown, browser recovery and corrupt-cache quarantine, keyboard operation and focus return, responsive capability boundaries, semantic contrast, and the locked Design 2 visual contract.

## Source ownership checks

- `next dev` and `next build` are the only frontend entry points.
- No tracked `.js`, `.jsx`, or Vite entry point may exist.
- `next.config.ts` owns the same-origin `/api/*` rewrite to the Cloudflare API origin.
- `wrangler.jsonc` owns the D1 binding and cannot contain a static asset or Pages frontend.
- No GitHub Actions workflow is part of the delivery path.

This gate is local and build-output aware. It fails on missing evidence instead of treating an absent `.next` directory as success.
