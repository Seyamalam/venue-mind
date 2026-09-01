const json = async (response) => {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) throw Object.assign(new Error("Runbook endpoint unavailable"), { code: "RUNBOOK_API_UNAVAILABLE", status: response.status });
  const payload = await response.json();
  if (response.ok) return payload;
  const error = new Error(payload.error?.message ?? payload.error ?? "Runbook request failed");
  error.code = payload.error?.code ?? payload.code ?? "RUNBOOK_REQUEST_FAILED";
  error.details = payload.error?.details ?? payload.details ?? {};
  error.status = response.status;
  throw error;
};

export function createRunbookRemote({ fetchImpl = globalThis.fetch?.bind(globalThis), organizationId } = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("Runbook remote requires fetch");
  if (typeof organizationId !== "string" || !organizationId.trim()) throw new TypeError("Runbook remote requires an Organization ID");
  const headers = (extra = {}) => ({ accept: "application/json", "x-venuemind-organization-id": organizationId, ...extra });
  const base = (projectId) => `/api/projects/${encodeURIComponent(projectId)}/runbooks`;

  return Object.freeze({
    async create(projectId, runbook) {
      return json(await fetchImpl(base(projectId), {
        method: "POST",
        credentials: "same-origin",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify({ runbook }),
      }));
    },

    async get(projectId, runbookVersionId) {
      return json(await fetchImpl(`${base(projectId)}/${encodeURIComponent(runbookVersionId)}`, {
        credentials: "same-origin",
        headers: headers(),
      }));
    },

    async sync(projectId, runbookVersionId, commands) {
      if (!Array.isArray(commands)) throw new TypeError("Runbook sync commands must be an array");
      return json(await fetchImpl(`${base(projectId)}/${encodeURIComponent(runbookVersionId)}/transitions:sync`, {
        method: "POST",
        credentials: "same-origin",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify({ commands }),
      }));
    },
  });
}
