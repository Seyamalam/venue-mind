/* Generated from VenueMind canonical JSON Schemas. Do not edit. */

export interface VenueMindPlanExport {
  format:
    | "json"
    | "text"
    | "svg"
    | "pdf"
    | "pdf-emergency"
    | "csv"
    | "csv-objects"
    | "csv-inventory"
    | "csv-staffing"
    | "svg-post-map"
    | "csv-production"
    | "svg-production"
    | "csv-catering-stations"
    | "csv-replenishment"
    | "audit";
  filename: string;
  mimeType: string;
  encoding: "utf8" | "base64";
  content: string;
}
