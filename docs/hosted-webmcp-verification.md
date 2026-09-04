# Hosted WebMCP verification

Verified September 4, 2026 against https://venue-mind-jet.vercel.app on deployment `dpl_HhAAqkGdrpiYM63WRvxHRurG4D8U`.

## Results

- Chrome 152, native `document.modelContext.getTools` and `executeTool`, with experimental web platform features enabled. No mocked registry, alias, or injected application implementation.
- Fresh guest sample persisted with `SAVED` / `SAFE` and no `SYNC CONFLICT`.
- Native inspection returned Plan v3.2; preview produced four changes requiring review; validation passed.
- The test clicked the actual UI approval button. This verifies the reviewer interface, not an independently authenticated human approval ceremony.
- Native inspection returned v3.3; the activity ledger contained three records; replay passed; JSON export returned `summitforward-2026-v3-3.json`.
- The hosted Project API returned v3.3 from D1. Reload retained the same Project identity and v3.3.
- A second isolated guest received a different Organization and sample Project ID, saved successfully, and received HTTP 404 when attempting to read the first Organization's Project.
- The user's pre-existing Chrome tab also showed `SAVED` / `SAFE` and WebMCP `READY` after refresh.

## Reproduce

The explicit target variable authorizes this write test. It creates disposable guest Organizations and persists their sample Projects; it does not modify an existing user's Project. Use a current Chrome installation exposing native `document.modelContext`.

```sh
AGENT_BROWSER_EXECUTABLE_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
AGENT_BROWSER_ARGS='--enable-experimental-web-platform-features' \
VENUEMIND_HOSTED_BASE_URL=https://venue-mind-jet.vercel.app \
node scripts/verify-hosted-webmcp.mjs
```

The automated test uses a 1920 by 1080 viewport so the approval control is visible. The existing local browser suite also checks route accessibility and reviewed screenshots.

## Root cause and fix

D1 Project IDs are globally unique. The sample route previously used `project-summit-forward` for every Organization. A new guest received HTTP 404 for another Organization's Project, followed by HTTP 409 when attempting to create the same ID. The browser misclassified that ID collision as a recoverable revision conflict.

Studio now resolves the sample route to `project-summit-forward-<organizationId>` after account loading. The ID remains stable across reloads and distinct across Organizations. Explicit non-sample Project routes remain unchanged. Existing Project records and browser recovery copies are not deleted or overwritten.

A server ID conflict without an accessible current Project now remains `PROJECT_ID_CONFLICT`; the client does not fabricate a remote revision. Real overlapping edits retain the existing recovery and revision-conflict behavior.
