import type { analyzeSpatialPlan } from "../domain/spatial-analysis.ts";

export type GeometryAnalysisInput = Parameters<typeof analyzeSpatialPlan>[0];
export type GeometryAnalysisResult = ReturnType<typeof analyzeSpatialPlan>;

export interface GeometryAnalysisRequest {
  readonly kind: "analyze-spatial-plan";
  readonly requestId: string;
  readonly input: GeometryAnalysisInput;
}

export type GeometryAnalysisResponse =
  | { readonly kind: "geometry-analysis-complete"; readonly requestId: string; readonly result: GeometryAnalysisResult }
  | { readonly kind: "geometry-analysis-failed"; readonly requestId: string; readonly errorCode: "GEOMETRY_ANALYSIS_FAILED" };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isGeometryAnalysisRequest = (value: unknown): value is GeometryAnalysisRequest => {
  if (!isRecord(value) || value["kind"] !== "analyze-spatial-plan" || typeof value["requestId"] !== "string")
    return false;
  const input = value["input"];
  if (!isRecord(input)) return false;
  const plan = input["plan"];
  return isRecord(plan) && typeof plan["id"] === "string" && Array.isArray(plan["objects"]);
};

export const isGeometryAnalysisResponse = (value: unknown): value is GeometryAnalysisResponse => {
  if (!isRecord(value) || typeof value["requestId"] !== "string") return false;
  if (value["kind"] === "geometry-analysis-failed") return value["errorCode"] === "GEOMETRY_ANALYSIS_FAILED";
  if (value["kind"] !== "geometry-analysis-complete") return false;
  const result = value["result"];
  return isRecord(result) && isRecord(result["candidatePlan"]) && isRecord(result["evidence"]);
};
