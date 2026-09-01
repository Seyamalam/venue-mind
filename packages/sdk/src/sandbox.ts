import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createAdapterRuntime, type AdapterAuthorization, type VenueAdapter } from "./adapter.js";

const JSON_MEDIA_TYPE = "application/json; charset=utf-8";

const sendJson = (response: ServerResponse, status: number, value: unknown) => {
  response.writeHead(status, { "content-type": JSON_MEDIA_TYPE, "cache-control": "no-store" });
  response.end(`${JSON.stringify(value)}\n`);
};

const readJson = async (request: IncomingMessage, maximumBytes: number): Promise<unknown> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
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
  runtimeOptions?: Record<string, unknown>;
  maximumBodyBytes?: number;
}

export interface AdapterSandboxHandle {
  readonly url: string;
  readonly host: string;
  readonly port: number;
  close(): Promise<void>;
}

export async function createAdapterSandboxServer({
  adapter,
  fixtures = [],
  authorization = {},
  runtimeOptions = {},
  maximumBodyBytes = 1_048_576,
}: AdapterSandboxOptions, { host = "127.0.0.1", port = 0 }: { host?: string; port?: number } = {}): Promise<AdapterSandboxHandle> {
  if (!adapter?.definition) throw new TypeError("Adapter sandbox requires a VenueMind adapter");
  if (host !== "127.0.0.1" && host !== "::1" && host !== "localhost") throw new TypeError("Adapter sandbox binds to loopback hosts only");
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new TypeError("Adapter sandbox port must be an integer from 0 to 65535");
  if (!Number.isInteger(maximumBodyBytes) || maximumBodyBytes < 1 || maximumBodyBytes > 10_485_760) throw new TypeError("Adapter sandbox maximumBodyBytes must be between 1 and 10485760");
  const runtime = createAdapterRuntime(runtimeOptions);
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${host}`);
      if (request.method === "GET" && url.pathname === "/health") return sendJson(response, 200, { status: "ok", adapterId: adapter.definition.id, adapterVersion: adapter.definition.version });
      if (request.method === "GET" && url.pathname === "/fixtures") return sendJson(response, 200, { fixtures });
      if (request.method === "POST" && url.pathname.startsWith("/invoke/")) {
        const capability = decodeURIComponent(url.pathname.slice("/invoke/".length));
        if (!["import", "export", "synchronize", "webhook"].includes(capability)) return sendJson(response, 404, { error: { code: "SANDBOX_ROUTE_NOT_FOUND" } });
        const input = await readJson(request, maximumBodyBytes);
        const result = capability === "webhook"
          ? await runtime.acceptWebhook(adapter, input, authorization)
          : await runtime.execute(adapter, capability as "import" | "export" | "synchronize", input, authorization);
        return sendJson(response, 200, result);
      }
      return sendJson(response, 404, { error: { code: "SANDBOX_ROUTE_NOT_FOUND" } });
    } catch (error) {
      const failure = error as { code?: string; message?: string; statusCode?: number };
      return sendJson(response, failure.statusCode ?? 400, { error: { code: failure.code ?? "SANDBOX_REQUEST_INVALID", message: failure.message ?? "Sandbox request failed" } });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  let closed = false;
  return Object.freeze({
    url: `http://${host.includes(":") ? `[${host}]` : host}:${address.port}`,
    host,
    port: address.port,
    close: async () => {
      if (closed) return;
      closed = true;
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  });
}
