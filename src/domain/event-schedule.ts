export const RFC3339_INSTANT_PATTERN_SOURCE =
  "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?(?:Z|(?!-00:00)[+-]\\d{2}:\\d{2})$";

const RFC3339_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?(Z|([+-])(\d{2}):(\d{2}))$/;

export interface EventSchedule {
  startAt: string;
  endAt: string;
  timezone: string;
}

type ScheduleOptions = { label?: string; nullable?: boolean };
interface RawSchedule extends Record<string, unknown> {
  startAt?: unknown;
  endAt?: unknown;
  timezone?: unknown;
}
const isRecord = (input: unknown): input is RawSchedule =>
  Boolean(input) && typeof input === "object" && !Array.isArray(input);

function fail(label: string, reason: string): never {
  throw new Error(`${label} ${reason}`);
}

const offsetMinutes = (value: string): number | null => {
  if (value === "Z") return 0;
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  if (hours > 23 || minutes > 59) return null;
  return (match[1] === "-" ? -1 : 1) * (hours * 60 + minutes);
};

const timeZoneOffsetMinutes = (instant: string, timezone: string): number => {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "longOffset" })
    .formatToParts(new Date(instant))
    .find((part) => part.type === "timeZoneName")?.value;
  if (name === "GMT") return 0;
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(name ?? "");
  if (!match) throw new Error(`Cannot determine timezone offset for ${timezone}`);
  return (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]));
};

export function assertRfc3339Instant(value: unknown, label = "Schedule instant"): string {
  if (typeof value !== "string") fail(label, "must be a canonical RFC3339 date-time with an explicit offset");
  const match = RFC3339_INSTANT.exec(value);
  if (!match) fail(label, "must be a canonical RFC3339 date-time with an explicit offset");
  const [, year, month, day, hour, minute, second, , offset] = match;
  if (!offset) fail(label, "must include an explicit offset");
  if (offset === "-00:00") fail(label, "must use a known RFC3339 offset");
  const maximumDay = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  if (
    Number(month) < 1 ||
    Number(month) > 12 ||
    Number(day) < 1 ||
    Number(day) > maximumDay ||
    Number(hour) > 23 ||
    Number(minute) > 59 ||
    Number(second) > 59 ||
    offsetMinutes(offset) === null ||
    Number.isNaN(Date.parse(value))
  )
    fail(label, "is not a valid RFC3339 instant");
  return value;
}

export function normalizeEventSchedule(
  schedule: unknown,
  { label = "Event schedule", nullable = false }: ScheduleOptions = {},
): EventSchedule | null {
  if (nullable && (schedule === null || schedule === undefined)) return null;
  if (!isRecord(schedule)) fail(label, "must be an object");
  const unknown = Object.keys(schedule).filter((key) => !["startAt", "endAt", "timezone"].includes(key));
  if (unknown.length) fail(label, `contains unknown fields: ${unknown.sort().join(", ")}`);
  const startAt = assertRfc3339Instant(schedule.startAt, `${label} startAt`);
  const endAt = assertRfc3339Instant(schedule.endAt, `${label} endAt`);
  if (typeof schedule.timezone !== "string" || !schedule.timezone) fail(label, "timezone is required");
  try {
    new Intl.DateTimeFormat("en", { timeZone: schedule.timezone }).format();
  } catch {
    fail(label, "timezone is invalid");
  }
  const startMatch = RFC3339_INSTANT.exec(startAt);
  const endMatch = RFC3339_INSTANT.exec(endAt);
  if (!startMatch || !endMatch) fail(label, "contains a non-canonical instant");
  const startOffset = startMatch[8];
  const endOffset = endMatch[8];
  if (!startOffset || !endOffset) fail(label, "contains an instant without an explicit offset");
  if (timeZoneOffsetMinutes(startAt, schedule.timezone) !== offsetMinutes(startOffset))
    fail(label, "startAt offset does not match timezone at that instant");
  if (timeZoneOffsetMinutes(endAt, schedule.timezone) !== offsetMinutes(endOffset))
    fail(label, "endAt offset does not match timezone at that instant");
  if (Date.parse(endAt) <= Date.parse(startAt)) fail(label, "must have a start before end");
  return { startAt, endAt, timezone: schedule.timezone };
}
