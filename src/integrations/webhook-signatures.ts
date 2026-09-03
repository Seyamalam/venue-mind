import { AdapterContractError } from "./contracts.ts";

const encoder = new TextEncoder();
type SignatureEncoding = "hex" | "base64" | "base64url";

const fail = (message: string, details: Readonly<Record<string, unknown>> = {}): never => {
  throw new AdapterContractError("ADAPTER_WEBHOOK_SIGNATURE_INVALID", message, details);
};

const concat = (left: Uint8Array, right: Uint8Array): Uint8Array => {
  const output = new Uint8Array(left.length + right.length);
  output.set(left);
  output.set(right, left.length);
  return output;
};

const copyToArrayBuffer = (value: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(value.byteLength);
  new Uint8Array(buffer).set(value);
  return buffer;
};

const decodeHex = (value: string): Uint8Array | null => {
  if (!/^[0-9a-fA-F]+$/.test(value) || value.length % 2 !== 0) return null;
  return Uint8Array.from(value.match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16));
};

const decodeBase64 = (value: string, urlSafe: boolean): Uint8Array | null => {
  let normalized = value;
  if (urlSafe) normalized = normalized.replace(/-/g, "+").replace(/_/g, "/");
  const pattern = urlSafe ? /^[A-Za-z0-9_-]+={0,2}$/ : /^[A-Za-z0-9+/]+={0,2}$/;
  if (!pattern.test(value) || value.length % 4 === 1) return null;
  normalized = normalized.replace(/=+$/, "");
  normalized += "=".repeat((4 - (normalized.length % 4)) % 4);
  try {
    return Uint8Array.from(atob(normalized), (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
};

const decodeSignature = (value: string, encoding: SignatureEncoding): Uint8Array | null => {
  if (encoding === "hex") return decodeHex(value);
  return decodeBase64(value, encoding === "base64url");
};

interface TimestampResult {
  readonly prefix: Uint8Array;
  readonly fresh: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isSignatureEncoding = (value: unknown): value is SignatureEncoding =>
  value === "hex" || value === "base64" || value === "base64url";

const normalizeTimestamp = (input: unknown, now: number): TimestampResult => {
  if (!isRecord(input)) return fail("Webhook timestamp must be an object");
  const unknown = Object.keys(input).filter((key) => !["value", "unit", "separator", "toleranceMs"].includes(key));
  if (unknown.length) fail("Webhook timestamp contains unknown fields", { fields: unknown.sort() });
  const value = input["value"];
  const unit = input["unit"];
  const separator = input["separator"];
  const toleranceMs = input["toleranceMs"];
  if (typeof value !== "string" || !/^\d+$/.test(value))
    return fail("Webhook timestamp value must be an unsigned integer string");
  if (unit !== "seconds" && unit !== "milliseconds")
    return fail("Webhook timestamp unit must be seconds or milliseconds");
  if (typeof separator !== "string") return fail("Webhook timestamp separator must be explicit");
  if (typeof toleranceMs !== "number" || !Number.isInteger(toleranceMs) || toleranceMs < 0 || toleranceMs > 86_400_000)
    return fail("Webhook timestamp toleranceMs must be an integer from 0 to 86400000");
  const numeric = Number(value);
  const timestampMs = unit === "seconds" ? numeric * 1_000 : numeric;
  if (!Number.isSafeInteger(timestampMs)) fail("Webhook timestamp is outside the safe integer range");
  return {
    prefix: encoder.encode(`${value}${separator}`),
    fresh: Math.abs(now - timestampMs) <= toleranceMs,
  };
};

export interface VerifyWebhookHmacInput {
  readonly body?: unknown;
  readonly signature?: unknown;
  readonly secret?: unknown;
  readonly algorithm?: unknown;
  readonly encoding?: unknown;
  readonly prefix?: unknown;
  readonly timestamp?: unknown;
  readonly now?: number;
}

export async function verifyWebhookHmac({
  body,
  signature,
  secret,
  algorithm,
  encoding,
  prefix,
  timestamp = null,
  now = Date.now(),
}: VerifyWebhookHmacInput = {}): Promise<boolean> {
  if (!(body instanceof Uint8Array)) return fail("Webhook body must be raw Uint8Array bytes");
  if (!(secret instanceof Uint8Array) || secret.length === 0)
    return fail("Webhook secret must be non-empty Uint8Array bytes");
  if (algorithm !== "SHA-256") return fail("Webhook HMAC algorithm must be SHA-256");
  if (!isSignatureEncoding(encoding)) return fail("Webhook signature encoding must be hex, base64, or base64url");
  if (typeof prefix !== "string") return fail("Webhook signature prefix must be explicit");
  if (typeof signature !== "string" || !signature.startsWith(prefix)) return false;
  if (!Number.isFinite(now)) fail("Webhook verification now must be finite epoch milliseconds");

  const timestampResult = timestamp === null ? null : normalizeTimestamp(timestamp, now);
  if (timestampResult && !timestampResult.fresh) return false;
  const signatureBytes = decodeSignature(signature.slice(prefix.length), encoding);
  if (!signatureBytes || signatureBytes.length === 0) return false;
  const signedBytes = timestampResult ? concat(timestampResult.prefix, body) : body;
  const key = await crypto.subtle.importKey(
    "raw",
    copyToArrayBuffer(secret),
    { name: "HMAC", hash: algorithm },
    false,
    ["verify"],
  );
  return crypto.subtle.verify("HMAC", key, copyToArrayBuffer(signatureBytes), copyToArrayBuffer(signedBytes));
}
