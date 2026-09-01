import assert from "node:assert/strict";
import test from "node:test";
import { createIncidentAttachmentService, IncidentAttachmentError } from "../worker/incident-attachments.ts";

const PNG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);

class MemoryR2Bucket {
  objects = new Map();
  async put(key, value, options = {}) {
    const bytes = value instanceof Uint8Array ? new Uint8Array(value) : new Uint8Array(await new Response(value).arrayBuffer());
    this.objects.set(key, { bytes, options });
    return { key };
  }
  async get(key) {
    const stored = this.objects.get(key);
    if (!stored) return null;
    return { body: new Blob([stored.bytes]).stream(), size: stored.bytes.byteLength, httpMetadata: stored.options.httpMetadata, customMetadata: stored.options.customMetadata };
  }
}

const service = (bucket = new MemoryR2Bucket()) => ({
  bucket,
  attachments: createIncidentAttachmentService({
    bucket,
    idFactory: () => "fixed-id",
    clock: () => "2026-09-12T12:00:00.000Z",
  }),
});

test("Incident attachment upload stores validated bytes under a private server key and returns metadata only", async () => {
  const { bucket, attachments } = service();
  const metadata = await attachments.upload({
    incidentId: "incident-alpha",
    filename: "../../Floor \"A\".png",
    mimeType: "image/png",
    content: PNG,
    existingAttachments: [],
  });

  assert.deepEqual(metadata, {
    id: "incident-evidence-fixed-id",
    incidentId: "incident-alpha",
    filename: "Floor _A_.png",
    mimeType: "image/png",
    byteLength: 9,
    sha256: "843ac23b1736b4487ec81cf7c07ddd9bb46ae5b7818c2c3843d99d62fa75f3c9",
    createdAt: "2026-09-12T12:00:00.000Z",
  });
  assert.equal(Object.hasOwn(metadata, "objectKey"), false);
  const [[key, stored]] = [...bucket.objects];
  assert.equal(key, "private/incident-evidence-fixed-id");
  assert.equal(key.includes("incident-alpha"), false);
  assert.equal(key.includes("Floor"), false);
  assert.deepEqual(stored.options, {
    httpMetadata: { contentType: "image/png" },
    customMetadata: { attachmentId: metadata.id, incidentId: "incident-alpha", sha256: metadata.sha256 },
  });
});

test("Incident attachment upload accepts only the four published media signatures", async () => {
  const fixtures = [
    ["image/jpeg", Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])],
    ["image/png", PNG],
    ["image/webp", new TextEncoder().encode("RIFF0000WEBP")],
    ["application/pdf", new TextEncoder().encode("%PDF-1.7")],
  ];
  for (const [mimeType, content] of fixtures) {
    const { attachments } = service();
    assert.equal((await attachments.upload({ incidentId: "incident-alpha", filename: "evidence", mimeType, content })).mimeType, mimeType);
  }
  const { attachments } = service();
  await assert.rejects(
    () => attachments.upload({ incidentId: "incident-alpha", filename: "spoofed.png", mimeType: "image/png", content: new TextEncoder().encode("<svg>") }),
    (error) => error instanceof IncidentAttachmentError && error.code === "INCIDENT_ATTACHMENT_TYPE_INVALID",
  );
});

test("Incident attachment upload enforces actual byte and per-Incident count limits", async () => {
  const { attachments } = service();
  await assert.rejects(
    () => attachments.upload({ incidentId: "incident-alpha", filename: "large.png", mimeType: "image/png", content: new Uint8Array((5 * 1024 * 1024) + 1) }),
    (error) => error instanceof IncidentAttachmentError && error.code === "INCIDENT_ATTACHMENT_SIZE_INVALID",
  );
  await assert.rejects(
    () => attachments.upload({ incidentId: "incident-alpha", filename: "ninth.png", mimeType: "image/png", content: PNG, existingAttachments: Array.from({ length: 8 }, (_, index) => ({ id: `attachment-${index}` })) }),
    (error) => error instanceof IncidentAttachmentError && error.code === "INCIDENT_ATTACHMENT_LIMIT_EXCEEDED",
  );
});

test("Incident attachment download stays private and forces safe attachment delivery", async () => {
  const { attachments } = service();
  const metadata = await attachments.upload({ incidentId: "incident-alpha", filename: "Floor A.png", mimeType: "image/png", content: PNG });
  const response = await attachments.download(metadata);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal(response.headers.get("content-disposition"), "attachment; filename=\"Floor A.png\"; filename*=UTF-8''Floor%20A.png");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), PNG);
});

test("Incident attachment download rejects forged aggregate metadata", async () => {
  const { attachments } = service();
  const metadata = await attachments.upload({ incidentId: "incident-alpha", filename: "Floor A.png", mimeType: "image/png", content: PNG });
  await assert.rejects(
    () => attachments.download({ ...metadata, mimeType: "text/html" }),
    (error) => error instanceof IncidentAttachmentError && error.code === "INCIDENT_ATTACHMENT_INVALID",
  );
});
