/// <reference lib="webworker" />

import { analyzeSpatialPlan } from "../domain/spatial-analysis.ts";
import {
  isGeometryAnalysisRequest,
  type GeometryAnalysisResponse,
} from "../performance/geometry-worker-protocol.ts";

declare const self: DedicatedWorkerGlobalScope;

self.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (!isGeometryAnalysisRequest(event.data)) return;
  let response: GeometryAnalysisResponse;
  try {
    response = {
      kind: "geometry-analysis-complete",
      requestId: event.data.requestId,
      result: analyzeSpatialPlan(event.data.input),
    };
  } catch {
    response = {
      kind: "geometry-analysis-failed",
      requestId: event.data.requestId,
      errorCode: "GEOMETRY_ANALYSIS_FAILED",
    };
  }
  self.postMessage(response);
});
