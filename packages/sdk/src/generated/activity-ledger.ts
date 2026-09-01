/* Generated from VenueMind canonical JSON Schemas. Do not edit. */

export type VenueMindActivityLedger = {
  id: string;
  schemaVersion: 1;
  sequence: number;
  type: string;
  actor: "human" | "agent" | "system";
  actorId: string;
  actorType: "human" | "agent" | "system";
  source: "studio" | "webmcp" | "mcp" | "system" | "agent-tool";
  sessionId: string;
  occurredAt: string;
  details: {
    [k: string]: unknown;
  };
  previousHash: "genesis" | string;
  hash: string;
}[];
