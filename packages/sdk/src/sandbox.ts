import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  createAdapterRuntime,
  type AdapterAuthorization,
  type AdapterCapability,
  type AdapterRuntimeOptions,
  type VenueAdapter,
} from "./adapter.js";
import { createMemorySecretStore } from "./testkit.js";

const JSON_MEDIA_TYPE = "application/json; charset=utf-8";
const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null;
const isAdapterCapability = (value: string): value is AdapterCapability =>
  value === "import" || value === "export" || value === "synchronize" || value === "webhook";

const sendJson = (response: ServerResponse, status: number, value: unknown) => {
  response.writeHead(status, { "content-type": JSON_MEDIA_TYPE, "cache-control": "no-store" });
  response.end(`${JSON.stringify(value)}\n`);
};

const readJson = async (request: IncomingMessage, maximumBytes: number): Promise<unknown> => {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const rawChunk of request) {
    const chunk: unknown = rawChunk;
    const bytes =
      typeof chunk === "string"
        ? Buffer.from(chunk)
        : chunk instanceof Uint8Array
          ? Uint8Array.from(chunk)
          : new Uint8Array();
    if (bytes.byteLength === 0 && chunk !== "") {
      throw Object.assign(new Error("Sandbox request body contains unsupported bytes"), { statusCode: 400 });
    }
    size += bytes.byteLength;
    if (size > maximumBytes) throw Object.assign(new Error("Sandbox request body is too large"), { statusCode: 413 });
    chunks.push(bytes);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Sandbox request body must be valid JSON"), { statusCode: 400 });
  }
};

export interface AdapterSandboxOptions {
  adapter: VenueAdapter;
  fixtures?: readonly unknown[];
  authorization?: AdapterAuthorization;
  runtimeOptions?: AdapterRuntimeOptions;
  maximumBodyBytes?: number;
}

export interface AdapterSandboxHandle {
  readonly url: string;
  readonly host: string;
  readonly port: number;
  close(): Promise<void>;
}

export async function createAdapterSandboxServer(
  {
    adapter,
    fixtures = [],
    authorization = {},
    runtimeOptions = {},
    maximumBodyBytes = 1_048_576,
  }: AdapterSandboxOptions,
  { host = "127.0.0.1", port = 0 }: { host?: string; port?: number } = {},
): Promise<AdapterSandboxHandle> {
  if (!adapter?.definition) throw new TypeError("Adapter sandbox requires a VenueMind adapter");
  if (host !== "127.0.0.1" && host !== "::1" && host !== "localhost")
    throw new TypeError("Adapter sandbox binds to loopback hosts only");
  if (!Number.isInteger(port) || port < 0 || port > 65_535)
    throw new TypeError("Adapter sandbox port must be an integer from 0 to 65535");
  if (!Number.isInteger(maximumBodyBytes) || maximumBodyBytes < 1 || maximumBodyBytes > 10_485_760)
    throw new TypeError("Adapter sandbox maximumBodyBytes must be between 1 and 10485760");
  const runtime = createAdapterRuntime(runtimeOptions);
  const sandboxAuthorization = authorization.secretStore
    ? authorization
    : { ...authorization, secretStore: createMemorySecretStore() };
  let allowedOrigin = "";
  const handleRequest = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try {
      const url = new URL(request.url ?? "/", `http://${host}`);
      if (request.method === "GET" && url.pathname === "/health")
        return sendJson(response, 200, {
          status: "ok",
          adapterId: adapter.definition.id,
          adapterVersion: adapter.definition.version,
        });
      if (request.method === "GET" && url.pathname === "/fixtures") return sendJson(response, 200, { fixtures });
      if (request.method === "POST" && url.pathname.startsWith("/invoke/")) {
        const origin = request.headers.origin;
        if (origin && origin !== allowedOrigin)
          return sendJson(response, 403, { error: { code: "SANDBOX_ORIGIN_DENIED" } });
        const mediaType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
        if (mediaType !== "application/json")
          return sendJson(response, 415, { error: { code: "SANDBOX_MEDIA_TYPE_REQUIRED" } });
        const capability = decodeURIComponent(url.pathname.slice("/invoke/".length));
        if (!isAdapterCapability(capability))
          return sendJson(response, 404, { error: { code: "SANDBOX_ROUTE_NOT_FOUND" } });
        const input = await readJson(request, maximumBodyBytes);
        const result =
          capability === "webhook"
            ? await runtime.acceptWebhook(adapter, input, sandboxAuthorization)
            : await runtime.execute(adapter, capability, input, sandboxAuthorization);
        return sendJson(response, 200, result);
      }
      return sendJson(response, 404, { error: { code: "SANDBOX_ROUTE_NOT_FOUND" } });
    } catch (error) {
      const failure = isRecord(error) ? error : {};
      const statusCode = typeof failure["statusCode"] === "number" ? failure["statusCode"] : 400;
      const code = typeof failure["code"] === "string" ? failure["code"] : "SANDBOX_REQUEST_INVALID";
      const message = error instanceof Error ? error.message : "Sandbox request failed";
      return sendJson(response, statusCode, { error: { code, message } });
    }
  };
  const server = createServer((request, response) => {
    void handleRequest(request, response);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("Adapter sandbox did not receive a network address");
  }
  allowedOrigin = `http://${host.includes(":") ? `[${host}]` : host}:${address.port}`;
  let closed = false;
  return Object.freeze({
    url: allowedOrigin,
    host,
    port: address.port,
    close: async () => {
      if (closed) return;
      closed = true;
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  });
}
