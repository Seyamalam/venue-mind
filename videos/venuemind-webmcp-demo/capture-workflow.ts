import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { z } from "zod";

const exec = promisify(execFile);
const session = "venuemind-capture-take2";
const browser = async (...args: string[]) =>
  (await exec("agent-browser", ["--session", session, ...args], { maxBuffer: 4_000_000 })).stdout.trim();
const evaluate = async (code: string) => z.json().parse(JSON.parse(await browser("eval", code)));
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const shot = async (name: string) => {
  await evaluate('document.getElementById("recording-result").style.display="none"; true');
  await browser("screenshot", `${process.cwd()}/capture/${name}.png`);
  await evaluate('document.getElementById("recording-result").style.display="block"; true');
};
await browser("open", "http://127.0.0.1:4185/projects");
await browser("set", "viewport", "1920", "1080");
const recordingStarted = Date.now();
await browser("record", "start", `${process.cwd()}/capture/workflow-take2.webm`, "http://127.0.0.1:4185/projects");
await browser("wait", ".projects-brand");
await evaluate('Object.defineProperty(document,"modelContext",{configurable:true,value:navigator.modelContext}); true');
await browser("click", ".projects-brand");
await browser("wait", ".app-shell");
await evaluate(`(() => {
  const panel = document.createElement('aside'); panel.id='recording-result';
  panel.style.cssText='position:fixed;right:40px;bottom:135px;width:485px;padding:24px;background:#191727;color:#faf9f6;border:1px solid #8170bd;border-radius:14px;z-index:99999;box-shadow:0 8px 30px #0003;font:17px/1.6 monospace;pointer-events:none';
  document.body.appendChild(panel);
  window.recordingCall = async (name,input) => {
    const tool=(await document.modelContext.getTools()).find(t=>t.name===name);
    if(!tool) throw Error('Native tool missing: '+name);
    const result=JSON.parse(await document.modelContext.executeTool(tool,JSON.stringify(input)));
    if(result.isError || !result.structuredContent?.data) throw Error(JSON.stringify(result));
    const data=result.structuredContent.data;
    const title=document.createElement('div');title.textContent='NATIVE WEBMCP · RECORDED RESULT';title.style.cssText='font:11px monospace;letter-spacing:1.5px;color:#c6b9ff;margin-bottom:12px';
    const heading=document.createElement('strong');heading.textContent=name;heading.style.cssText='display:block;color:white;margin-bottom:10px';
    const content=document.createElement('div');content.textContent=name==='venue.inspect_layout' ? 'Plan v'+data.planVersion+' · '+data.spatialObjects.length+' spatial objects' : name==='venue.preview_revision' ? data.changedItems+' changes · human approval required' : result.structuredContent.summary;
    panel.replaceChildren(title,heading,content);
    return result;
  };return true;
})()`);
const started = recordingStarted;
const call = async (name: string, input = {}) => {
  const result = z
    .object({ structuredContent: z.object({ summary: z.string(), data: z.json() }) })
    .passthrough()
    .parse(await evaluate(`window.recordingCall(${JSON.stringify(name)},${JSON.stringify(input)})`));
  await writeFile(`capture/${name.replace("venue.", "")}.json`, JSON.stringify(result, null, 2) + "\n");
  console.log(name, ((Date.now() - started) / 1000).toFixed(2), result.structuredContent.summary);
  const fields = z
    .object({ planVersion: z.string().optional(), status: z.string().optional(), filename: z.string().optional() })
    .safeParse(result.structuredContent.data);
  return fields.success ? fields.data : {};
};
await browser("find", "role", "radio", "click", "--name", "Before", "--exact");
const inspect = await call("venue.inspect_layout");
assert.equal(inspect.planVersion, "3.2");
await shot("01-before");
await pause(3000);
await call("venue.preview_revision", {
  goal: "Keep 400 seats, widen the center aisle to six feet, improve sightlines, and preserve locked objects.",
  idempotencyKey: "film-native-preview-20260904",
  correlationId: "corr-film-native",
});
await browser("find", "role", "radio", "click", "--name", "Proposed", "--exact");
await shot("02-proposal");
await pause(5000);
const validation = await call("venue.validate_layout");
assert.equal(validation.status, "pass");
await browser("find", "role", "button", "click", "--name", "View analysis", "--exact");
await shot("03-validation");
await pause(8000);
await browser("find", "role", "button", "click", "--name", "Close analysis", "--exact");
await evaluate(`document.getElementById('recording-result').textContent='UI APPROVAL · Human-controlled action'; true`);
await pause(2000);
await browser("find", "role", "button", "click", "--name", "Approve proposal", "--exact");
await pause(1000);
const committed = await call("venue.inspect_layout");
assert.equal(committed.planVersion, "3.3");
await shot("04-committed");
await pause(4000);
await call("venue.get_change_log");
await browser("find", "role", "button", "click", "--name", "Open plan history", "--exact");
await shot("05-ledger");
await pause(6000);
const replay = await call("venue.replay_history");
assert.equal(replay.status, "pass");
await pause(3000);
const exported = await call("venue.export_plan", { format: "json" });
assert.ok(exported.filename);
assert.match(exported.filename, /v3-3\.json$/);
await shot("06-export");
await pause(5000);
await browser("record", "stop");
await writeFile(
  "capture/provenance.json",
  JSON.stringify(
    {
      source: "http://127.0.0.1:4185",
      revision: "d5a83bea3c54755657b12ccf9692fa76b87c5212",
      browser: "Chromium 149",
      execution:
        "Native getTools + executeTool with RegisteredTool and JSON input; document.modelContext aliases native navigator.modelContext only in recording context.",
      humanApproval:
        "Recorded UI approval click operated by Codex for this demonstration; no agent approval tool exists.",
      remoteMutation: false,
    },
    null,
    2,
  ) + "\n",
);
