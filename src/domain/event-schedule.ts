export const RFC3339_INSTANT_PATTERN_SOURCE = "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?(?:Z|(?!-00:00)[+-]\\d{2}:\\d{2})$";

const RFC3339_INSTANT: any = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?(Z|([+-])(\d{2}):(\d{2}))$/;

const fail: any = (label: any, reason: any) => {
  throw new Error(`${label} ${reason}`);
};

const offsetMinutes: any = (value: any) => {
  if (value === "Z") return 0;
  const match: any = /^([+-])(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours: any = Number(match[2]);
  const minutes: any = Number(match[3]);
  if (hours > 23 || minutes > 59) return null;
  return (match[1] === "-" ? -1 : 1) * ((hours * 60) + minutes);
};

const timeZoneOffsetMinutes: any = (instant: any, timezone: any) => {
  const name: any = new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "longOffset" })
    .formatToParts(new Date(instant))
    .find((part: any) => part.type === "timeZoneName")?.value;
  if (name === "GMT") return 0;
  const match: any = /^GMT([+-])(\d{2}):(\d{2})$/.exec(name ?? "");
  if (!match) throw new Error(`Cannot determine timezone offset for ${timezone}`);
  return (match[1] === "-" ? -1 : 1) * ((Number(match[2]) * 60) + Number(match[3]));
};

export function assertRfc3339Instant(value: any, label: any = "Schedule instant") {
  if (typeof value !== "string") fail(label, "must be a canonical RFC3339 date-time with an explicit offset");
  const match: any = RFC3339_INSTANT.exec(value);
  if (!match) fail(label, "must be a canonical RFC3339 date-time with an explicit offset");
  const [, year, month, day, hour, minute, second, , offset] = match;
  if (offset === "-00:00") fail(label, "must use a known RFC3339 offset");
  const maximumDay: any = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > maximumDay || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59 || offsetMinutes(offset) === null || Number.isNaN(Date.parse(value))) fail(label, "is not a valid RFC3339 instant");
  return value;
}

export function normalizeEventSchedule(schedule: any, { label = "Event schedule", nullable = false }: any = {}) {
  if (nullable && (schedule === null || schedule === undefined)) return null;
  if (!schedule || typeof schedule !== "object" || Array.isArray(schedule)) fail(label, "must be an object");
  const unknown: any = Object.keys(schedule).filter((key: any) => !["startAt", "endAt", "timezone"].includes(key));
  if (unknown.length) fail(label, `contains unknown fields: ${unknown.sort().join(", ")}`);
  assertRfc3339Instant(schedule.startAt, `${label} startAt`);
  assertRfc3339Instant(schedule.endAt, `${label} endAt`);
  if (typeof schedule.timezone !== "string" || !schedule.timezone) fail(label, "timezone is required");
  try {
    new Intl.DateTimeFormat("en", { timeZone: schedule.timezone }).format();
  } catch {
    fail(label, "timezone is invalid");
  }
  if (timeZoneOffsetMinutes(schedule.startAt, schedule.timezone) !== offsetMinutes(RFC3339_INSTANT.exec(schedule.startAt)[8])) fail(label, "startAt offset does not match timezone at that instant");
  if (timeZoneOffsetMinutes(schedule.endAt, schedule.timezone) !== offsetMinutes(RFC3339_INSTANT.exec(schedule.endAt)[8])) fail(label, "endAt offset does not match timezone at that instant");
  if (Date.parse(schedule.endAt) <= Date.parse(schedule.startAt)) fail(label, "must have a start before end");
  return { startAt: schedule.startAt, endAt: schedule.endAt, timezone: schedule.timezone };
}
