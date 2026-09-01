const parse = async (response: any) => {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) throw Object.assign(new Error("Incident endpoint unavailable"), { code: "INCIDENT_API_UNAVAILABLE", status: response.status });
  const payload = await response.json();
  if (response.ok) return payload;
  const error: any = new Error(payload.error?.message ?? payload.error ?? payload.message ?? "Incident request failed");
  error.code = payload.error?.code ?? payload.code ?? "INCIDENT_REQUEST_FAILED";
  error.details = payload.error?.details ?? payload.details ?? {};
  error.status = response.status;
  throw error;
};

const requiredId = (value: any, label: any) => {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} is required`);
  return encodeURIComponent(value);
};

export function createIncidentRemote({ fetchImpl = globalThis.fetch?.bind(globalThis), organizationId }: any = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("Incident remote requires fetch");
  if (typeof organizationId !== "string" || !organizationId.trim()) throw new TypeError("Incident remote requires an Organization ID");
  const headers = (extra: any = {}) => ({ accept: "application/json", "x-venuemind-organization-id": organizationId, ...extra });
  const collection = (projectId: any) => `/api/projects/${requiredId(projectId, "Project ID")}/incident-registers`;
  const item = (projectId: any, registerId: any) => `${collection(projectId)}/${requiredId(registerId, "Incident Register ID")}`;
  const incident = (projectId: any, registerId: any, incidentId: any) => `${item(projectId, registerId)}/incidents/${requiredId(incidentId, "Incident ID")}`;
  const request = (url: any, init: any = {}) => fetchImpl(url, { credentials: "same-origin", ...init, headers: headers(init.headers) });

  return Object.freeze({
    async create(projectId: any, input: any) {
      return parse(await request(collection(projectId), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }));
    },
    async get(projectId: any, registerId: any) {
      return parse(await request(item(projectId, registerId)));
    },
    async sync(projectId: any, registerId: any, commands: any) {
      if (!Array.isArray(commands)) throw new TypeError("Incident sync commands must be an array");
      return parse(await request(`${item(projectId, registerId)}/commands:sync`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ commands }) }));
    },
    async export(projectId: any, registerId: any, incidentId: any) {
      return parse(await request(`${incident(projectId, registerId, incidentId)}/export`));
    },
    async attach(projectId: any, registerId: any, incidentId: any, file: any) {
      if (!(file instanceof Blob)) throw new TypeError("Incident attachment File is required");
      const body = new FormData();
      const fileName = typeof File !== "undefined" && file instanceof File && file.name ? file.name : "evidence";
      body.append("file", file, fileName);
      return parse(await request(`${incident(projectId, registerId, incidentId)}/attachments`, { method: "POST", body }));
    },
    async download(projectId: any, registerId: any, incidentId: any, attachmentId: any) {
      return request(`${incident(projectId, registerId, incidentId)}/attachments/${requiredId(attachmentId, "Attachment ID")}`);
    },
  });
}
