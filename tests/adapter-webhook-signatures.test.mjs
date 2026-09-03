import assert from "node:assert/strict";
import test from "node:test";
import { verifyWebhookHmac } from "../src/integrations/webhook-signatures.ts";

const bytes = (value) => new TextEncoder().encode(value);

const sign = async ({ body, secret, timestamp = null, separator = ".", encoding = "hex" }) => {
  const prefix = timestamp === null ? new Uint8Array() : bytes(`${timestamp}${separator}`);
  const signed = new Uint8Array(prefix.length + body.length);
  signed.set(prefix);
  signed.set(body, prefix.length);
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, signed));
  if (encoding === "hex") return [...signature].map((value) => value.toString(16).padStart(2, "0")).join("");
  const base64 = btoa(String.fromCharCode(...signature));
  return encoding === "base64url" ? base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : base64;
};

test("verifyWebhookHmac verifies the exact raw bytes with explicit prefix and encoding", async () => {
  const body = Uint8Array.from([0, 255, 123, 34, 97, 34, 58, 49, 125]);
  const secret = bytes("fixture-secret");
  const hex = await sign({ body, secret });
  assert.equal(await verifyWebhookHmac({ body, secret, signature: `sha256=${hex}`, algorithm: "SHA-256", encoding: "hex", prefix: "sha256=" }), true);
  assert.equal(await verifyWebhookHmac({ body: Uint8Array.from([...body, 10]), secret, signature: `sha256=${hex}`, algorithm: "SHA-256", encoding: "hex", prefix: "sha256=" }), false);
  assert.equal(await verifyWebhookHmac({ body, secret, signature: `v1=${hex}`, algorithm: "SHA-256", encoding: "hex", prefix: "sha256=" }), false);
});

test("verifyWebhookHmac supports explicit base64 encodings", async () => {
  const body = bytes("raw-body");
  const secret = bytes("fixture-secret");
  for (const encoding of ["base64", "base64url"]) {
    const signature = await sign({ body, secret, encoding });
    assert.equal(await verifyWebhookHmac({ body, secret, signature, algorithm: "SHA-256", encoding, prefix: "" }), true);
  }
});

test("timestamp freshness is checked and the exact timestamp header is signed", async () => {
  const body = bytes("{\"event\":1}");
  const secret = bytes("fixture-secret");
  const timestamp = "1787896800";
  const now = Number(timestamp) * 1_000 + 300_000;
  const signature = await sign({ body, secret, timestamp, separator: "." });
  const input = {
    body,
    secret,
    signature: `t=${signature}`,
    algorithm: "SHA-256",
    encoding: "hex",
    prefix: "t=",
    timestamp: { value: timestamp, unit: "seconds", separator: ".", toleranceMs: 300_000 },
  };
  assert.equal(await verifyWebhookHmac({ ...input, now }), true, "the freshness boundary is inclusive");
  assert.equal(await verifyWebhookHmac({ ...input, now: now + 1 }), false);
  assert.equal(await verifyWebhookHmac({ ...input, timestamp: { ...input.timestamp, value: String(Number(timestamp) + 1) }, now }), false, "timestamp bytes are part of the signature");
});

test("webhook verification rejects ambiguous inputs and malformed signatures", async () => {
  const valid = { body: bytes("body"), secret: bytes("secret"), signature: "sha256=zz", algorithm: "SHA-256", encoding: "hex", prefix: "sha256=" };
  assert.equal(await verifyWebhookHmac(valid), false);
  await assert.rejects(() => verifyWebhookHmac({ ...valid, body: "body" }), (error) => error.code === "ADAPTER_WEBHOOK_SIGNATURE_INVALID");
  await assert.rejects(() => verifyWebhookHmac({ ...valid, secret: bytes("") }), (error) => error.code === "ADAPTER_WEBHOOK_SIGNATURE_INVALID");
  await assert.rejects(() => verifyWebhookHmac({ ...valid, algorithm: "SHA-1" }), (error) => error.code === "ADAPTER_WEBHOOK_SIGNATURE_INVALID");
  await assert.rejects(() => verifyWebhookHmac({ ...valid, encoding: "auto" }), (error) => error.code === "ADAPTER_WEBHOOK_SIGNATURE_INVALID");
  await assert.rejects(() => verifyWebhookHmac({ ...valid, prefix: undefined }), (error) => error.code === "ADAPTER_WEBHOOK_SIGNATURE_INVALID");
  await assert.rejects(() => verifyWebhookHmac({ ...valid, timestamp: { value: "1", unit: "seconds", separator: ".", toleranceMs: 30_000, extra: true } }), (error) => error.code === "ADAPTER_WEBHOOK_SIGNATURE_INVALID");
});
