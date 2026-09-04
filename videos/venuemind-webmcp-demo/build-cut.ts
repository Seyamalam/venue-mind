import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";

const exec = promisify(execFile);
const scenes = [
  {
    id: "01-inspect",
    voice: "02",
    duration: 9.557,
    from: 2.5,
    to: 6.8,
    label: "INSPECT",
    caption: "400 seats. Six-foot aisle. Locked objects stay.",
  },
  {
    id: "02-proposal",
    voice: "03",
    duration: 10.347,
    from: 6.8,
    to: 12.3,
    label: "PROPOSE",
    caption: "Four ghost changes. Accepted plan unchanged.",
  },
  {
    id: "03-validate",
    voice: "04",
    duration: 15.253,
    from: 12.3,
    to: 21.6,
    label: "VALIDATE",
    caption: "Access · capacity · circulation · locks · sightlines",
  },
  {
    id: "04-approve",
    voice: "05",
    duration: 6.763,
    from: 21.6,
    to: 25.6,
    label: "UI APPROVAL",
    caption: "Approval is not exposed as an agent tool.",
  },
  {
    id: "05-ledger",
    voice: "06",
    duration: 11.776,
    from: 25.6,
    to: 37,
    label: "COMMIT + REPLAY",
    caption: "Plan v3.3. Recorded changes. Replay verified.",
  },
  {
    id: "06-export",
    voice: "07",
    duration: 12.23,
    from: 37,
    to: 44.5,
    label: "EXPORT",
    caption: "Validated plan · summitforward-2026-v3-3.json",
  },
  {
    id: "07-outcome",
    voice: "08",
    duration: 8.789,
    from: 24.8,
    to: 28.5,
    label: "VENUEMIND",
    caption: "venue-mind-jet.vercel.app",
  },
];
const audio = z
  .object({
    voices: z.array(
      z.object({ id: z.string(), words: z.array(z.object({ text: z.string(), start: z.number(), end: z.number() })) }),
    ),
  })
  .parse(JSON.parse(await readFile("original-audio.json", "utf8")));
await mkdir("assets/clips", { recursive: true });
const esc = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const time = (s: number) => {
  const n = Math.round(s * 1000);
  return `${String(Math.floor(n / 3600000)).padStart(2, "0")}:${String(Math.floor(n / 60000) % 60).padStart(2, "0")}:${String(Math.floor(n / 1000) % 60).padStart(2, "0")},${String(n % 1000).padStart(3, "0")}`;
};
let cursor = 0;
let captionIndex = 0;
const clips: string[] = [];
const captions: string[] = [];
const srt: string[] = [];
const board: string[] = [];
const animation: string[] = [];
for (const [index, scene] of scenes.entries()) {
  if (!process.argv.includes("--reuse-clips"))
    await exec("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-ss",
      String(scene.from),
      "-to",
      String(scene.to),
      "-i",
      "capture/workflow-take2.webm",
      "-vf",
      `tpad=stop_mode=clone:stop_duration=${scene.duration},fps=30`,
      "-t",
      String(scene.duration),
      "-an",
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      `assets/clips/${scene.id}.mp4`,
    ]);
  clips.push(
    `<video id="scene-${scene.id}" class="clip footage" src="assets/clips/${scene.id}.mp4" data-start="${cursor}" data-duration="${scene.duration}" muted playsinline></video>`,
  );
  clips.push(
    `<audio id="voice-${scene.id}" src="assets/voice/${scene.voice}.wav" data-start="${cursor}" data-duration="${scene.duration}" data-volume="1"></audio>`,
  );
  clips.push(
    `<div id="label-${scene.id}" class="clip scene-label" data-start="${cursor}" data-duration="${scene.duration}"><span>${String(index + 1).padStart(2, "0")} / 07</span> ${esc(scene.label)}</div>`,
  );
  const voice = audio.voices.find((v) => v.id === scene.voice);
  if (!voice) throw new Error("Missing narration: " + scene.voice);
  const words = voice.words.filter((w) => w.end <= scene.duration + 0.02);
  for (let i = 0; i < words.length; i += 7) {
    const group = words.slice(i, i + 7);
    const first = group[0];
    if (!first) continue;
    const begin = cursor + first.start;
    const end = cursor + Math.min(scene.duration, words[i + 7]?.start ?? scene.duration - 0.03);
    const text = group
      .map((w) => w.text)
      .join(" ")
      .replaceAll("Web MCP", "WebMCP")
      .replaceAll("VenuMind", "VenueMind")
      .replaceAll("venue-mind.", "VenueMind.")
      .replaceAll("V3, 3", "v3.3")
      .replaceAll("V3, two", "v3.2")
      .replaceAll("sight lines", "sightlines")
      .replaceAll("one. 829", "1.829")
      .replace(/until a person$/, "until a person decides.")
      .replace(/^commits the$/, "commits the proposal.")
      .replace(/accepted change stays$/, "accepted change stays explainable.")
      .replace(/registry,$/, "registry.");
    captionIndex++;
    captions.push(
      `<div id="caption-${captionIndex}" class="clip caption" data-start="${begin}" data-duration="${end - begin}">${esc(text)}</div>`,
    );
    srt.push(`${captionIndex}\n${time(begin)} --> ${time(end)}\n${text}\n`);
  }
  animation.push(`tl.fromTo('#scene-${scene.id}',{opacity:0.96},{opacity:1,duration:0.18,ease:'none'},${cursor});`);
  board.push(
    `## ${scene.id}\n\nStart ${cursor.toFixed(3)}s. Duration ${scene.duration}s.\n\n${scene.caption}\n\nActual recorded source interval ${scene.from}–${scene.to}s. Hold final recorded frame for narration where needed. No fabricated UI.\n`,
  );
  cursor += scene.duration;
}
const html = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><title>VenueMind native workflow</title><script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script><style>
*{box-sizing:border-box}body{margin:0;background:#faf9f6;font-family:Arial,sans-serif}#root{position:relative;width:1920px;height:1080px;overflow:hidden;background:#faf9f6}.clip{position:absolute}.footage{left:96px;top:16px;width:1728px;height:972px;object-fit:contain;border:1px solid #dedbd5;border-radius:10px}.scene-label{left:96px;top:1012px;width:290px;height:42px;font-size:18px;font-weight:700;color:#34255a;line-height:32px}.scene-label span{display:inline-block;margin-right:14px;color:#625b6b;font-size:14px}.caption{left:410px;top:1005px;width:1310px;height:60px;text-align:center;font-size:28px;line-height:40px;color:#211e27;font-weight:500}.progress{position:absolute;left:96px;top:1070px;width:1728px;height:4px;background:#7145e5;transform-origin:left center}.source{position:absolute;right:102px;top:22px;background:#faf9f6;color:#56505d;padding:5px 9px;font-size:11px;letter-spacing:1px;z-index:9}</style></head><body><div id="root" data-composition-id="main" data-width="1920" data-height="1080" data-duration="${cursor}">${clips.join("\n")}${captions.join("\n")}<div class="source">RECORDED APP · LOCAL GUEST SESSION</div><div id="progress" class="progress"></div></div><script>const tl=gsap.timeline({paused:true});${animation.join("\n")}tl.fromTo('#progress',{scaleX:0},{scaleX:1,duration:${cursor},ease:'none'},0);window.__timelines=window.__timelines||{};window.__timelines.main=tl;</script></body></html>`;
await writeFile("index.html", html);
await writeFile("captions.srt", srt.join("\n"));
await writeFile(
  "STORYBOARD.md",
  `---\nworkflow: product-launch-video\nmode: autonomous\nduration: ${cursor}\nmusic: none\n---\n\n# Improved native workflow cut\n\nPreserves the architectural UI and existing narration. Replaces staged UI reenactments with native tool execution and actual UI approval. Captions use the existing voice timestamps. Closing export sentence stops after "contract registry" to remove the unsupported claim that contracts cannot drift.\n\n${board.join("\n")}`,
);
await writeFile("cut-manifest.json", JSON.stringify({ duration: cursor, scenes }, null, 2) + "\n");
console.log(`Built ${cursor.toFixed(3)} seconds, ${scenes.length} scenes, ${captionIndex} captions.`);
