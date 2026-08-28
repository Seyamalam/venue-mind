export const CANONICAL_UTC_TIMESTAMP_PATTERN_SOURCE = "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?Z$";

const CANONICAL_UTC_TIMESTAMP = new RegExp(CANONICAL_UTC_TIMESTAMP_PATTERN_SOURCE);

export function assertCanonicalUtcTimestamp(value, label = "Timestamp") {
  if (typeof value !== "string" || !CANONICAL_UTC_TIMESTAMP.test(value)) throw new Error(`${label} must be an ISO-8601 UTC timestamp`);
  const parsed = Date.parse(value);
  const canonical = Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
  const expected = value.includes(".") ? value : value.replace("Z", ".000Z");
  if (canonical !== expected) throw new Error(`${label} must be an ISO-8601 UTC timestamp`);
  return value;
}
