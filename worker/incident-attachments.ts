export const INCIDENT_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const INCIDENT_ATTACHMENT_MAX_COUNT = 8;
const INCIDENT_ATTACHMENT_MIME_TYPES = Object.freeze([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const);
const isIncidentAttachmentMime = (value: string): value is IncidentAttachmentMetadata["mimeType"] =>
  INCIDENT_ATTACHMENT_MIME_TYPES.some((mimeType) => mimeType === value);

export type IncidentAttachmentMetadata = Readonly<{
  id: string;
  incidentId: string;
  filename: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp" | "application/pdf";
  byteLength: number;
  sha256: string;
  createdAt: string;
}>;

type AttachmentContent = ArrayBuffer | ArrayBufferView | Blob;
type AttachmentUpload = {
  incidentId: string;
  filename: string;
  mimeType: string;
  content: AttachmentContent;
  existingAttachments?: ReadonlyArray<unknown>;
};

export class IncidentAttachmentError extends Error {
  code: string;
  details: Record<string, unknown>;

  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "IncidentAttachmentError";
    this.code = code;
    this.details = details;
  }
}

const requiredText = (value: unknown, field: string) => {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new IncidentAttachmentError("INCIDENT_ATTACHMENT_INVALID", `${field} is required`);
  return normalized;
};

const safeFilename = (value: unknown) => {
  const basename = requiredText(value, "Attachment filename").split(/[\\/]/).at(-1) ?? "evidence";
  const safe = basename
    .replace(/[";\u0000-\u001f\u007f]/g, "_")
    .trim()
    .slice(0, 120);
  return safe || "evidence";
};

const toBytes = async (content: AttachmentContent) => {
  if (content instanceof Blob) return new Uint8Array(await content.arrayBuffer());
  if (content instanceof ArrayBuffer) return new Uint8Array(content.slice(0));
  if (ArrayBuffer.isView(content))
    return new Uint8Array(content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength));
  throw new IncidentAttachmentError("INCIDENT_ATTACHMENT_INVALID", "Attachment content is invalid");
};

const isPrefix = (bytes: Uint8Array, signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
const validMagic = (mimeType: string, bytes: Uint8Array) => {
  if (mimeType === "image/jpeg") return isPrefix(bytes, [0xff, 0xd8, 0xff]);
  if (mimeType === "image/png") return isPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (mimeType === "image/webp")
    return isPrefix(bytes, [0x52, 0x49, 0x46, 0x46]) && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  if (mimeType === "application/pdf") return String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-";
  return false;
};

const sha256 = async (bytes: Uint8Array) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer)))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
const objectKey = (attachmentId: string) => `private/${attachmentId}`;
const contentDisposition = (filename: string) => {
  const safe = safeFilename(filename);
  const ascii = safe.replace(/[^\x20-\x7e]/g, "_");
  const encoded = encodeURIComponent(safe).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
};

export function createIncidentAttachmentService({
  bucket,
  idFactory = () => crypto.randomUUID(),
  clock = () => new Date().toISOString(),
}: {
  bucket: R2Bucket;
  idFactory?: () => string;
  clock?: () => string;
}) {
  return Object.freeze({
    async upload(input: AttachmentUpload): Promise<IncidentAttachmentMetadata> {
      const incidentId = requiredText(input.incidentId, "Incident ID");
      const attachments = input.existingAttachments ?? [];
      if (!Array.isArray(attachments))
        throw new IncidentAttachmentError("INCIDENT_ATTACHMENT_INVALID", "Existing attachments must be an array");
      if (attachments.length >= INCIDENT_ATTACHMENT_MAX_COUNT)
        throw new IncidentAttachmentError(
          "INCIDENT_ATTACHMENT_LIMIT_EXCEEDED",
          "Incident attachment count limit reached",
          { maximum: INCIDENT_ATTACHMENT_MAX_COUNT },
        );
      const bytes = await toBytes(input.content);
      if (bytes.byteLength === 0 || bytes.byteLength > INCIDENT_ATTACHMENT_MAX_BYTES)
        throw new IncidentAttachmentError("INCIDENT_ATTACHMENT_SIZE_INVALID", "Incident attachment size is invalid", {
          maximumBytes: INCIDENT_ATTACHMENT_MAX_BYTES,
          byteLength: bytes.byteLength,
        });
      if (!isIncidentAttachmentMime(input.mimeType) || !validMagic(input.mimeType, bytes))
        throw new IncidentAttachmentError(
          "INCIDENT_ATTACHMENT_TYPE_INVALID",
          "Incident attachment media type does not match its content",
          { mimeType: input.mimeType },
        );
      const token = idFactory();
      if (!/^[A-Za-z0-9-]{1,128}$/.test(token))
        throw new IncidentAttachmentError("INCIDENT_ATTACHMENT_ID_INVALID", "Generated attachment ID is invalid");
      const id = `incident-evidence-${token}`;
      const digest = await sha256(bytes);
      const metadata: IncidentAttachmentMetadata = Object.freeze({
        id,
        incidentId,
        filename: safeFilename(input.filename),
        mimeType: input.mimeType,
        byteLength: bytes.byteLength,
        sha256: digest,
        createdAt: clock(),
      });
      await bucket.put(objectKey(id), bytes, {
        httpMetadata: { contentType: metadata.mimeType },
        customMetadata: { attachmentId: metadata.id, incidentId, sha256: digest },
      });
      return metadata;
    },
    async download(metadata: IncidentAttachmentMetadata): Promise<Response> {
      const id = requiredText(metadata?.id, "Attachment ID");
      const incidentId = requiredText(metadata?.incidentId, "Incident ID");
      if (
        !/^incident-evidence-[A-Za-z0-9-]{1,128}$/.test(id) ||
        !INCIDENT_ATTACHMENT_MIME_TYPES.includes(metadata.mimeType) ||
        !Number.isSafeInteger(metadata.byteLength) ||
        metadata.byteLength < 1 ||
        metadata.byteLength > INCIDENT_ATTACHMENT_MAX_BYTES ||
        !/^[a-f0-9]{64}$/.test(metadata.sha256) ||
        !metadata.filename
      )
        throw new IncidentAttachmentError("INCIDENT_ATTACHMENT_INVALID", "Attachment metadata is invalid");
      const object = await bucket.get(objectKey(id));
      if (!object)
        throw new IncidentAttachmentError("INCIDENT_ATTACHMENT_NOT_FOUND", "Incident attachment not found", {
          attachmentId: id,
        });
      const custom = object.customMetadata ?? {};
      if (
        custom.attachmentId !== id ||
        custom.incidentId !== incidentId ||
        custom.sha256 !== metadata.sha256 ||
        object.size !== metadata.byteLength ||
        object.httpMetadata?.contentType !== metadata.mimeType
      ) {
        throw new IncidentAttachmentError(
          "INCIDENT_ATTACHMENT_INTEGRITY_FAILED",
          "Incident attachment metadata does not match stored evidence",
          { attachmentId: id },
        );
      }
      return new Response(object.body, {
        headers: {
          "cache-control": "private, no-store",
          "content-disposition": contentDisposition(metadata.filename),
          "content-length": String(metadata.byteLength),
          "content-security-policy": "sandbox",
          "content-type": metadata.mimeType,
          "x-content-type-options": "nosniff",
        },
      });
    },
  });
}
