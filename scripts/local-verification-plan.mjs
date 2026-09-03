import path from "node:path";

const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
const nodeScript = (id, label, script, ...args) => Object.freeze({ id, label, executable: process.execPath, args: [script, ...args] });
const npmScript = (id, label, script) => Object.freeze({ id, label, executable: npmExecutable, args: ["run", script] });

export const LOCAL_VERIFICATION_PHASES = Object.freeze([
  nodeScript("install-preconditions", "Install preconditions", "scripts/check-install.mjs"),
  nodeScript("format", "Source format", "scripts/check-format.mjs"),
  npmScript("lint", "Lint", "lint"),
  npmScript("typecheck", "All typechecks", "typecheck"),
  npmScript("generated-drift", "Generated contract and documentation drift", "check:generated"),
  npmScript("skill-validation", "Skill validation", "validate:skills"),
  Object.freeze({
    id: "dependency-scan",
    label: "Dependency advisory scan",
    executable: npmExecutable,
    args: ["audit", "--package-lock-only", "--audit-level=high", "--omit=optional", "--ignore-scripts", "--no-fund"],
  }),
  nodeScript("secret-scan", "Secret scan", "scripts/scan-secrets.mjs"),
  npmScript("vercel-build", "Vercel Next.js build", "build:next"),
  npmScript("worker-build", "Cloudflare Worker build", "build:worker"),
  npmScript("mcp-build", "MCP server build", "build:mcp"),
  npmScript("sdk-build", "SDK build", "build:sdk"),
  npmScript("skills-build", "Skills build", "build:skills"),
  nodeScript("migration-tests", "Migration tests", "scripts/run-test-group.mjs", "migrations"),
  npmScript("browser-contract-tests", "Browser contract tests", "test:browser"),
  nodeScript("all-tests", "Complete test suite", "scripts/run-test-group.mjs", "all"),
]);

export const displayCommand = (phase) =>
  [path.basename(phase.executable) === path.basename(process.execPath) ? "node" : phase.executable, ...phase.args]
    .map((part) => (/^[A-Za-z0-9_./:@=-]+$/.test(part) ? part : JSON.stringify(part)))
    .join(" ");
