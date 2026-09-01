const parse = async (response: any) => {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) throw Object.assign(new Error("Live Occupancy endpoint unavailable"), { code: "OCCUPANCY_API_UNAVAILABLE", status: response.status });
  const payload = await response.json();
  if (response.ok) return payload;
  const error: any = new Error(payload.error?.message ?? payload.error ?? "Live Occupancy request failed");
  error.code = payload.error?.code ?? payload.code ?? "OCCUPANCY_REQUEST_FAILED";
  error.details = payload.error?.details ?? payload.details ?? {};
  error.status = response.status;
  throw error;
};

export function createOccupancyRemote({ fetchImpl = globalThis.fetch?.bind(globalThis), organizationId }: any = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("Live Occupancy remote requires fetch");
  if (typeof organizationId !== "string" || !organizationId.trim()) throw new TypeError("Live Occupancy remote requires an Organization ID");
  const headers = (extra: any = {}) => ({ accept: "application/json", "x-venuemind-organization-id": organizationId, ...extra });
  const collection = (projectId: any) => `/api/projects/${encodeURIComponent(projectId)}/occupancy-monitors`;
  const item = (projectId: any, monitorId: any) => `${collection(projectId)}/${encodeURIComponent(monitorId)}`;
  const request = (url: any, init: any = {}) => fetchImpl(url, { credentials: "same-origin", ...init, headers: headers(init.headers) });

  return Object.freeze({
    async create(projectId: any, input: any) {
      return parse(await request(collection(projectId), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }));
    },
    async get(projectId: any, monitorId: any) {
      return parse(await request(item(projectId, monitorId)));
    },
    async sync(projectId: any, monitorId: any, commands: any) {
      if (!Array.isArray(commands)) throw new TypeError("Live Occupancy sync commands must be an array");
      return parse(await request(`${item(projectId, monitorId)}/commands:sync`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ commands }) }));
    },
    async export(projectId: any, monitorId: any) {
      return parse(await request(`${item(projectId, monitorId)}/export`));
    },
  });
}
