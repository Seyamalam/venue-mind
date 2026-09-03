import { spawn } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";

const root = path.resolve(new URL("../", import.meta.url).pathname);
const next = path.join(root, "node_modules/next/dist/bin/next");

const reservePort = () =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unable to reserve browser-test port"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });

const waitForServer = async (url, child, output) => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Next exited before browser tests\n${output.join("")}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The production server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}\n${output.join("")}`);
};

const waitForExit = (child) =>
  new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve(child.exitCode);
      return;
    }
    child.once("exit", (code) => resolve(code));
  });

const port = await reservePort();
const baseUrl = `http://127.0.0.1:${port}`;
const serverOutput = [];
const server = spawn(process.execPath, [next, "start", "-H", "127.0.0.1", "-p", String(port)], {
  cwd: root,
  env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
for (const stream of [server.stdout, server.stderr]) {
  stream.on("data", (chunk) => {
    serverOutput.push(String(chunk));
    if (serverOutput.length > 200) serverOutput.shift();
  });
}

let exitCode = 1;
try {
  await waitForServer(`${baseUrl}/docs`, server, serverOutput);
  const tests = spawn(process.execPath, ["--test", "tests/browser-e2e.test.mjs"], {
    cwd: root,
    env: { ...process.env, VENUEMIND_BROWSER_BASE_URL: baseUrl },
    stdio: "inherit",
  });
  exitCode = (await waitForExit(tests)) ?? 1;
} finally {
  server.kill("SIGTERM");
  await Promise.race([waitForExit(server), new Promise((resolve) => setTimeout(resolve, 2_000))]);
  if (server.exitCode === null) server.kill("SIGKILL");
}

process.exitCode = exitCode;
