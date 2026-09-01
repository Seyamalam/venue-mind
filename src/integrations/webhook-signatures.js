import { AdapterContractError } from "./contracts.js";

const encoder = new TextEncoder();
const ENCODINGS = new Set(["hex", "base64", "base64url"]);

const fail = (message, details = {}) => {
  throw new AdapterContractError("ADAPTER_WEBHOOK_SIGNATURE_INVALID", message, details);
};

const concat = (left, right) => {
  const output = new Uint8Array(left.length + right.length);
  output.set(left);
  output.set(right, left.length);
  return output;
};

const decodeHex = (value) => {
  if (!/^[0-9a-fA-F]+$/.test(value) || value.length % 2 !== 0) return null;
  return Uint8Array.from(value.match(/.{2}/g), (byte) => Number.parseInt(byte, 16));
};

const decodeBase64 = (value, urlSafe) => {
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

const decodeSignature = (value, encoding) => {
  if (encoding === "hex") return decodeHex(value);
  return decodeBase64(value, encoding === "base64url");
};

const normalizeTimestamp = (input, now) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("Webhook timestamp must be an object");
  const unknown = Object.keys(input).filter((key) => !["value", "unit", "separator", "toleranceMs"].includes(key));
  if (unknown.length) fail("Webhook timestamp contains unknown fields", { fields: unknown.sort() });
  if (typeof input.value !== "string" || !/^\d+$/.test(input.value)) fail("Webhook timestamp value must be an unsigned integer string");
  if (!["seconds", "milliseconds"].includes(input.unit)) fail("Webhook timestamp unit must be seconds or milliseconds");
  if (typeof input.separator !== "string") fail("Webhook timestamp separator must be explicit");
  if (!Number.isInteger(input.toleranceMs) || input.toleranceMs < 0 || input.toleranceMs > 86_400_000) fail("Webhook timestamp toleranceMs must be an integer from 0 to 86400000");
  const numeric = Number(input.value);
  const timestampMs = input.unit === "seconds" ? numeric * 1_000 : numeric;
  if (!Number.isSafeInteger(timestampMs)) fail("Webhook timestamp is outside the safe integer range");
  return {
    prefix: encoder.encode(`${input.value}${input.separator}`),
    fresh: Math.abs(now - timestampMs) <= input.toleranceMs,
  };
};

export async function verifyWebhookHmac({
  body,
  signature,
  secret,
  algorithm,
  encoding,
  prefix,
  timestamp = null,
  now = Date.now(),
} = {}) {
  if (!(body instanceof Uint8Array)) fail("Webhook body must be raw Uint8Array bytes");
  if (!(secret instanceof Uint8Array) || secret.length === 0) fail("Webhook secret must be non-empty Uint8Array bytes");
  if (algorithm !== "SHA-256") fail("Webhook HMAC algorithm must be SHA-256");
  if (!ENCODINGS.has(encoding)) fail("Webhook signature encoding must be hex, base64, or base64url");
  if (typeof prefix !== "string") fail("Webhook signature prefix must be explicit");
  if (typeof signature !== "string" || !signature.startsWith(prefix)) return false;
  if (!Number.isFinite(now)) fail("Webhook verification now must be finite epoch milliseconds");

  const timestampResult = timestamp === null ? null : normalizeTimestamp(timestamp, now);
  if (timestampResult && !timestampResult.fresh) return false;
  const signatureBytes = decodeSignature(signature.slice(prefix.length), encoding);
  if (!signatureBytes || signatureBytes.length === 0) return false;
  const signedBytes = timestampResult ? concat(timestampResult.prefix, body) : body;
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: algorithm }, false, ["verify"]);
  return crypto.subtle.verify("HMAC", key, signatureBytes, signedBytes);
}
