import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const executeFile = promisify(execFile);
const root = path.resolve(new URL("../", import.meta.url).pathname);
const wrangler = path.join(root, "node_modules/.bin/wrangler");
const fixedArguments = ["DB", "--local", "--env-file", "/dev/null"];

const runWrangler = async (arguments_, persistTo) =>
  executeFile(wrangler, [...arguments_, "--persist-to", persistTo], {
    cwd: root,
    env: { ...process.env, CI: "true", NO_COLOR: "1" },
    maxBuffer: 2 * 1024 * 1024,
  });

const executeSql = async (persistTo, sql) => {
  const { stdout } = await runWrangler(
    ["d1", "execute", ...fixedArguments, "--command", sql, "--json"],
    persistTo,
  );
  const response = JSON.parse(stdout);
  assert.equal(response[0].success, true);
  return response[0].results;
};

test("Wrangler local D1 applies production migrations and persists tenant-scoped Project state", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "venuemind-real-d1-"));
  try {
    await runWrangler(["d1", "migrations", "apply", ...fixedArguments], directory);
    await executeSql(
      directory,
      [
        "INSERT INTO users (id,identity_provider,provider_subject,email,status,created_at,updated_at) VALUES ('user-d1','test','d1','d1@example.test','active','2026-09-03T00:00:00.000Z','2026-09-03T00:00:00.000Z')",
        "INSERT INTO organizations (id,name,slug,created_by,created_at,updated_at) VALUES ('org-d1','D1','d1','user-d1','2026-09-03T00:00:00.000Z','2026-09-03T00:00:00.000Z')",
        "INSERT INTO projects (id,organization_id,name,active_plan_id,created_at,updated_at) VALUES ('project-d1','org-d1','D1 Project','plan-d1','2026-09-03T00:00:00.000Z','2026-09-03T00:00:00.000Z')",
        "INSERT INTO project_states (project_id,schema_version,snapshot_json,updated_at) VALUES ('project-d1',10,'{}','2026-09-03T00:00:00.000Z')",
      ].join(";"),
    );
    const rows = await executeSql(
      directory,
      "SELECT projects.id,projects.organization_id,project_states.schema_version FROM projects JOIN project_states ON project_states.project_id=projects.id WHERE projects.id='project-d1'",
    );
    assert.deepEqual(rows, [{ id: "project-d1", organization_id: "org-d1", schema_version: 10 }]);

    await assert.rejects(() =>
      executeSql(
        directory,
        "INSERT INTO projects (id,organization_id,name,active_plan_id,created_at,updated_at) VALUES ('project-invalid','org-missing','Invalid','plan-invalid','2026-09-03T00:00:00.000Z','2026-09-03T00:00:00.000Z')",
      ),
    );
    assert.deepEqual(
      await executeSql(directory, "SELECT COUNT(*) AS count FROM projects WHERE id='project-invalid'"),
      [{ count: 0 }],
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
