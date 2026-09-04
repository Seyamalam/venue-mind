# VenueMind

Local revision draft. No Devpost content or video links were changed by this preparation pass.

## One-line summary

Let an agent propose venue changes, inspect the evidence, and leave the final approval to the person responsible for the room.

## Problem

A floor plan is more than furniture. Moving one seating block can narrow an accessible route, obscure the stage, or collide with a locked fixture. An event planner needs to understand those consequences before accepting a change.

## Solution

VenueMind is a venue operations workspace with a shared floor plan for people and agents. In the recorded example, the request is to keep 400 seats, widen the center aisle to six feet, improve sightlines, and preserve locked objects.

The agent inspects Plan v3.2, creates a proposal with four violet ghost changes, and runs validation. The accepted plan stays unchanged during review. The interface shows a 1.829-meter accessible route, 400 seats, and clear sightline samples. Approval in the interface commits v3.3. The agent then reads the change ledger, verifies replay, and exports the validated JSON plan.

## Why this matters

WebMCP gives the agent structured access to the same plan the operator is reviewing. It can address stable object IDs, inspect locks, and request measured evidence without inferring geometry from pixels. The person sees the proposal on the drawing and can approve or request changes there.

The useful collaboration is a concrete handoff. An agent prepares and checks a change; the operator reviews its spatial consequences; both can inspect the resulting version and activity record. VenueMind removes the need to translate an agent's prose into a separate drawing before reviewing it.

## How we used AI

An external agent invokes the tools registered by the page. VenueMind's geometry checks and command execution are deterministic application code. The recorded request uses the implemented proposal workflow, not an unrestricted generative floor-plan optimizer or an in-app chat model.

## How we used Codex

Codex helped implement the TypeScript domain model, shared tool contracts, Next.js frontend, Cloudflare persistence, and local verification. It also exercised the browser workflow and assembled the demo with HyperFrames. The video uses existing local Kokoro narration and real browser footage.

## Key features

- Versioned plans with stable spatial object IDs and typed locks.
- Violet proposal previews, branch comparison, conflict checks, and UI approval.
- Geometry-backed access, capacity, circulation, and sightline validation, plus operational checks.
- Command receipts, activity history, replay, undo, and validated exports.
- WebMCP tools, a standalone MCP server, SDK, agent skills, and documentation.

## Architecture

The Next.js frontend is hosted on Vercel. A Cloudflare Worker handles the API and D1 persistence. There is no R2 dependency.

The page registers 56 tools using `document.modelContext.registerTool`. Their versioned schemas come from a shared contract registry. Tool execution passes through validation and authorization checks into the same command bus used by the interface. Proposal creation does not commit an accepted plan. Approval is intentionally absent from the agent tool list.

## Testing instructions

Open the live app in a browser with WebMCP enabled. Use the sample SummitForward plan. In a fresh local guest session, the seeded accepted version is v3.2.

1. Call `venue.inspect_layout` with `{}`.
2. Call `venue.preview_revision` with `{"goal":"Keep 400 seats, widen the center aisle to six feet, improve sightlines, and preserve locked objects."}`.
3. Call `venue.validate_layout` with `{}`. Inspect the violet proposal and analysis evidence.
4. Review and click **Approve proposal** in the interface.
5. Call `venue.inspect_layout` and check v3.3, then `venue.get_change_log` and `venue.replay_history`.
6. Call `venue.export_plan` with `{"format":"json"}`.

For a reproducible local run, use Node.js 22 or newer, `npm ci`, `npm run build:next -- --webpack`, then `npm run start -- -p 4185`. The recording script is in `videos/venuemind-webmcp-demo/capture-workflow.ts`. Full project checks run locally with `npm run verify:local`; GitHub Actions are not required.

## Public demo link

https://venue-mind-jet.vercel.app

## Public repository link

https://github.com/Seyamalam/venue-mind

MIT license, included at the repository root.

## Demo video

Local improved cut: `videos/venuemind-webmcp-demo/renders/venuemind-native-demo.mp4`.

Public YouTube URL: retain the existing URL until the replacement has been uploaded and reviewed. This pass does not upload or replace it.

The edit follows inspection, proposal, validation, UI approval, ledger, replay, and export. It begins inside the working app. Captions and a separate subtitle file accompany the narration.

## Screenshot shot list

All images are actual browser screenshots from the recorded session, with the recording-only tool-result overlay hidden.

1. `capture/01-before.png`: accepted layout before the proposal.
2. `capture/02-proposal.png`: four violet ghost changes.
3. `capture/03-validation.png`: spatial evidence and measured outcomes.
4. `capture/04-committed.png`: Plan v3.3 after UI approval.
5. `capture/05-ledger.png`: history and recorded changes.

Paths are relative to `videos/venuemind-webmcp-demo`.

## Submission readiness notes

Official requirements were read from the Devpost connector on September 4, 2026. They require a working live URL, a specific explanation of WebMCP usage, a public repository with an open-source license, and a public YouTube demo under three minutes with audio.

This is a replacement-materials draft. The connector already reports a submitted relationship for the WebMCP Challenge. No existing submission has been edited here.

## Known limitations

- Validation checks the configured sample geometry and policies. It is not a compliance certificate or a substitute for venue inspection and professional safety review.
- The demo runs the current production source locally with isolated guest state. It does not demonstrate multi-user D1 synchronization. The live guest sample showed a remote sync conflict during capture preparation, so that condition needs investigation before calling the hosted guest flow clean.
- The installed Chromium 149 exposes native WebMCP on `navigator.modelContext`. The recorder aliases that object to `document.modelContext` before the app mounts. Calls then use the browser's native `getTools` and `executeTool`, not a mocked tool registry. Current WebMCP documentation uses `document.modelContext`.
- Codex operates the approval button to demonstrate the human UI path. The recording is not evidence of an independently authenticated human approval ceremony, nor of protection against an agent given unrestricted UI automation.
- The recorded scenario is supported by the implemented planner. Do not describe it as arbitrary natural-language venue optimization.
- File uploads and R2 storage are not included.

## TODO official form fields

Preserve existing answers rather than overwriting them. The live form includes submitter type, country, new/existing app status, live URL, testing instructions, public repo, tested clients, AI tools, learning level, and career value. It does not ask for a Codex session ID.

Suggested updated client-testing text: "Codex through agent-browser and native Chromium 149 WebMCP discovery/execution, with a recording-only alias from navigator.modelContext to document.modelContext. Automated browser tests also cover registration and the supervised loop using an instrumented registry. The native recording and instrumented tests are distinct."

Learning level and career-value answers are personal responses and should remain the participant's own.
