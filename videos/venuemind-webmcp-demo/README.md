# VenueMind native workflow demo

The improved cut is 74.715 seconds at 1920×1080, 30 fps, with narration and embedded captions. `captions.srt` contains separate subtitles. The MP4 is generated locally at `renders/venuemind-native-demo.mp4` and is not committed.

## What changed

- Removed the opening speech before the product workflow.
- Replaced illustrated tool cards and simulated UI changes with actual browser recordings.
- Recorded native WebMCP inspection, proposal, validation, history, replay, and export.
- Showed the UI approval and resulting v3.3 commit.
- Corrected transcription errors, removed overlapping captions, and removed the claim that generated contracts cannot drift.
- Added clean before, proposal, validation, committed-plan, and ledger screenshots.

## Provenance

The original 87.2-second video remains untouched in the earlier live-occupancy worktree. This cut uses its locally generated Kokoro `am_michael` narration, with the original opening removed and the export paragraph shortened.

`capture/workflow-take2.webm` is the continuous source recording. `capture/provenance.json` documents the exact source revision and browser setup. The dark tool-result box is a recording-only overlay filled from actual native return values, not product UI. Still captures hide that overlay. Terminal pauses are cut and selected recorded frames are held to fit narration. No product behavior is animated or invented.

The installed Chromium 149 exposes its native API at `navigator.modelContext`. The recording-only adapter aliases that native object to `document.modelContext` before application registration. Execution uses native `getTools()` and `executeTool(registeredTool, JSON.stringify(input))`. It does not use the instrumented Map registry from the browser unit tests. See [Chrome's current API reference](https://developer.chrome.com/docs/ai/webmcp/imperative-api).

The app ran locally from production source, with isolated guest state. Cloud persistence is not demonstrated. Codex clicked the approval button to demonstrate the human-facing UI path. An independently authenticated human was not filmed.

## Rebuild

From the repository root, install dependencies first. From this directory:

```sh
node build-cut.ts
npm run check
npx hyperframes@0.8.27 preview --background --port 3017
npm run render -- --quality high --workers 4 --output renders/venuemind-native-demo.mp4
```

`node build-cut.ts --reuse-clips` regenerates composition, captions, and the cut manifest without encoding clips again. The checked-in source recording and voice files are sufficient to rebuild the edit without opening the app or calling a paid provider.

To record a new take, first run the production Next.js app on `http://127.0.0.1:4185`. Update the recorder's session and output filename to preserve existing takes. Use a fresh isolated session, then run `node capture-workflow.ts`. The recorder verifies v3.2, passing validation, v3.3, passing replay, and the export filename.

## Checks

HyperFrames 0.8.27 passed lint, runtime, layout, motion, and contrast checks with zero warnings. Scene snapshots were reviewed before rendering. The recording and edit scripts have a separate strict TypeScript configuration and pass the repository's typed ESLint rules.

The final render is H.264 with AAC narration. Nothing is uploaded by these commands. The HyperFrames Studio preview is local.
