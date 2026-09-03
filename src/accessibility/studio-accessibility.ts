import type { Footprint, VenueObject } from "../domain/geometry";

export type RovingDirection = "first" | "last" | "next" | "previous";

export const nextRovingIndex = (length: number, currentIndex: number, direction: RovingDirection): number => {
  if (length <= 0) return -1;
  if (direction === "first") return 0;
  if (direction === "last") return length - 1;
  if (currentIndex < 0) return direction === "next" ? 0 : length - 1;
  return direction === "next" ? (currentIndex + 1) % length : (currentIndex - 1 + length) % length;
};

const fixed = (value: number): string => Number(value.toFixed(2)).toString();

const footprintSummary = (footprint: Footprint): string => {
  if (footprint.kind === "rectangle")
    return `${fixed(footprint.center.x)}, ${fixed(footprint.center.y)} metres; ${fixed(footprint.width)} by ${fixed(footprint.depth)} metres; ${fixed(footprint.rotationDegrees)} degrees`;
  if (footprint.kind === "circle")
    return `${fixed(footprint.center.x)}, ${fixed(footprint.center.y)} metres; radius ${fixed(footprint.radius)} metres`;
  if (footprint.kind === "line")
    return `${fixed(footprint.start.x)}, ${fixed(footprint.start.y)} to ${fixed(footprint.end.x)}, ${fixed(footprint.end.y)} metres; width ${fixed(footprint.width)} metres`;
  return `${footprint.points.length} points; ${fixed(footprint.rotationDegrees)} degrees`;
};

export const describeVenueObject = (object: VenueObject): string => {
  const label = object.label?.trim() || object.id;
  const activeLocks = (object.locks ?? []).filter((lock) => lock.active).length;
  return [
    label,
    object.kind.replaceAll("_", " "),
    object.layer ?? "annotations",
    footprintSummary(object.footprint),
    activeLocks === 0 ? "unlocked" : `${activeLocks} active ${activeLocks === 1 ? "lock" : "locks"}`,
  ].join("; ");
};

export const validationAnnouncement = (input: {
  status: "pass" | "fail";
  blockingIssues: number;
  unwaivedWarnings: number;
}): string =>
  input.status === "pass"
    ? input.unwaivedWarnings === 0
      ? "Validation passed"
      : `Validation passed with ${input.unwaivedWarnings} open ${input.unwaivedWarnings === 1 ? "warning" : "warnings"}`
    : `Validation failed with ${input.blockingIssues} blocking ${input.blockingIssues === 1 ? "issue" : "issues"}`;

const channel = (hex: string, offset: number): number => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
const linearChannel = (value: number): number => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);

export const relativeLuminance = (hex: `#${string}`): number => {
  if (!/^#[0-9a-f]{6}$/iu.test(hex)) throw new TypeError("COLOR_HEX_INVALID");
  return (
    0.2126 * linearChannel(channel(hex, 1)) +
    0.7152 * linearChannel(channel(hex, 3)) +
    0.0722 * linearChannel(channel(hex, 5))
  );
};

export const contrastRatio = (left: `#${string}`, right: `#${string}`): number => {
  const lighter = Math.max(relativeLuminance(left), relativeLuminance(right));
  const darker = Math.min(relativeLuminance(left), relativeLuminance(right));
  return (lighter + 0.05) / (darker + 0.05);
};
