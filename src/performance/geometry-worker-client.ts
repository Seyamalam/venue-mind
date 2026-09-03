import { analyzeSpatialPlan } from "../domain/spatial-analysis.ts";
import {
  isGeometryAnalysisResponse,
  type GeometryAnalysisInput,
  type GeometryAnalysisRequest,
  type GeometryAnalysisResult,
} from "./geometry-worker-protocol.ts";

interface WorkerPort {
  postMessage(message: GeometryAnalysisRequest): void;
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  terminate(): void;
}

export interface GeometryAnalysisClient {
  analyze(input: GeometryAnalysisInput): Promise<GeometryAnalysisResult>;
  dispose(): void;
}

export function createGeometryAnalysisClient({
  workerFactory = () => new Worker(new URL("../workers/geometry-worker.ts", import.meta.url), { type: "module" }),
  fallback = analyzeSpatialPlan,
}: {
  readonly workerFactory?: () => WorkerPort;
  readonly fallback?: (input: GeometryAnalysisInput) => GeometryAnalysisResult;
} = {}): GeometryAnalysisClient {
  let worker: WorkerPort | null = null;
  let sequence = 0;
  let disposed = false;
  const pending = new Map<
    string,
    { readonly resolve: (result: GeometryAnalysisResult) => void; readonly reject: (error: Error) => void }
  >();
  const onMessage = (event: MessageEvent<unknown>): void => {
    if (!isGeometryAnalysisResponse(event.data)) return;
    const request = pending.get(event.data.requestId);
    if (!request) return;
    pending.delete(event.data.requestId);
    if (event.data.kind === "geometry-analysis-complete") request.resolve(event.data.result);
    else request.reject(new Error(event.data.errorCode));
  };
  const ensureWorker = (): WorkerPort | null => {
    if (worker) return worker;
    if (typeof globalThis.Worker === "undefined") return null;
    try {
      worker = workerFactory();
      worker.addEventListener("message", onMessage);
      return worker;
    } catch {
      return null;
    }
  };
  return Object.freeze({
    analyze(input: GeometryAnalysisInput): Promise<GeometryAnalysisResult> {
      if (disposed) return Promise.reject(new Error("GEOMETRY_ANALYSIS_CLIENT_DISPOSED"));
      const activeWorker = ensureWorker();
      if (!activeWorker) return Promise.resolve(fallback(structuredClone(input)));
      sequence += 1;
      const requestId = `geometry-${sequence}`;
      return new Promise((resolve, reject) => {
        pending.set(requestId, { resolve, reject });
        activeWorker.postMessage({ kind: "analyze-spatial-plan", requestId, input: structuredClone(input) });
      });
    },
    dispose(): void {
      disposed = true;
      if (worker) {
        worker.removeEventListener("message", onMessage);
        worker.terminate();
        worker = null;
      }
      for (const request of pending.values()) request.reject(new Error("GEOMETRY_ANALYSIS_CLIENT_DISPOSED"));
      pending.clear();
    },
  });
}
