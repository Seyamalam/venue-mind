import { stableFingerprint } from "./activity-ledger.ts";
import type { Footprint, Point, StaffingPlan, VenueObject, VenuePlan } from "./geometry.ts";

const clone = <T>(value: T): T => structuredClone(value);
const round = (value: number, precision = 2): number => Number(value.toFixed(precision));
type CsvValue = string | number | boolean | null | undefined;
const csv = (value: CsvValue): string => `"${String(value ?? "").replaceAll('"', '""')}"`;

const centerOf = (footprint: Footprint): Point => {
  if (footprint.kind === "rectangle" || footprint.kind === "circle") return clone(footprint.center);
  if (footprint.kind === "line")
    return { x: (footprint.start.x + footprint.end.x) / 2, y: (footprint.start.y + footprint.end.y) / 2 };
  return {
    x: footprint.points.reduce((sum, point) => sum + point.x, 0) / footprint.points.length,
    y: footprint.points.reduce((sum, point) => sum + point.y, 0) / footprint.points.length,
  };
};

const requireUnique = (items: readonly { id: string }[], label: string): void => {
  const ids = items.map((item) => item.id);
  if (ids.some((id) => typeof id !== "string" || !id.trim()) || new Set(ids).size !== ids.length)
    throw new Error(`${label} require unique stable IDs`);
};

export function normalizeStaffingPlan(value: Partial<StaffingPlan> = {}): StaffingPlan {
  const roles = (value.roles ?? []).map((role) => ({
    id: String(role.id),
    label: String(role.label ?? role.id),
    headcount: Math.trunc(Number(role.headcount)),
    skills: [...new Set((role.skills ?? []).map(String))].sort(),
  }));
  const shifts = (value.shifts ?? []).map((shift) => ({
    id: String(shift.id),
    label: String(shift.label ?? shift.id),
    startMinute: Math.trunc(Number(shift.startMinute)),
    endMinute: Math.trunc(Number(shift.endMinute)),
  }));
  const coverageRequirements = (value.coverageRequirements ?? []).map((requirement) => ({
    id: String(requirement.id),
    zoneObjectId: String(requirement.zoneObjectId),
    roleId: String(requirement.roleId),
    minimumCount: Math.trunc(Number(requirement.minimumCount)),
    shiftIds: [...new Set((requirement.shiftIds ?? shifts.map((shift) => shift.id)).map(String))].sort(),
  }));
  requireUnique(roles, "Staff roles");
  requireUnique(shifts, "Staff shifts");
  requireUnique(coverageRequirements, "Coverage requirements");
  if (roles.some((role) => !Number.isInteger(role.headcount) || role.headcount < 0))
    throw new Error("Staff role headcount must be a non-negative integer");
  if (
    shifts.some(
      (shift) =>
        !Number.isInteger(shift.startMinute) ||
        !Number.isInteger(shift.endMinute) ||
        shift.endMinute <= shift.startMinute,
    )
  )
    throw new Error("Staff shifts require increasing minute bounds");
  const roleIds = new Set(roles.map((role) => role.id));
  const shiftIds = new Set(shifts.map((shift) => shift.id));
  if (
    coverageRequirements.some(
      (requirement) =>
        !roleIds.has(requirement.roleId) ||
        !Number.isInteger(requirement.minimumCount) ||
        requirement.minimumCount < 1 ||
        requirement.shiftIds.some((id) => !shiftIds.has(id)),
    )
  )
    throw new Error("Coverage requirements must reference roles, shifts, and positive counts");
  return {
    schemaVersion: 1,
    roles,
    shifts,
    coverageRequirements,
    minimumHandoffOverlapMinutes: Math.max(0, Math.trunc(Number(value.minimumHandoffOverlapMinutes ?? 15))),
    maximumWalkingDistanceM: Math.max(1, Number(value.maximumWalkingDistanceM ?? 25)),
  };
}

const normalizePost = (object: VenueObject, staffing: StaffingPlan) => {
  const metadata = object.staffPost;
  if (!metadata) throw new Error(`Staff post ${object.id} requires staffing metadata`);
  const roleIds = new Set(staffing.roles.map((role) => role.id));
  const shiftIds = new Set(staffing.shifts.map((shift) => shift.id));
  const assignments = (metadata.assignments ?? []).map((assignment) => ({
    shiftId: String(assignment.shiftId),
    roleId: String(assignment.roleId),
    count: Math.trunc(Number(assignment.count)),
  }));
  if (
    !assignments.length ||
    assignments.some(
      (assignment) =>
        !shiftIds.has(assignment.shiftId) ||
        !roleIds.has(assignment.roleId) ||
        !Number.isInteger(assignment.count) ||
        assignment.count < 1,
    )
  )
    throw new Error(`Staff post ${object.id} requires valid shift assignments`);
  return {
    objectId: object.id,
    label: object.label,
    point: centerOf(object.footprint),
    coverageZoneObjectIds: [...new Set((metadata.coverageZoneObjectIds ?? []).map(String))].sort(),
    assignments,
  };
};

export function analyzeStaffingOperations(plan: VenuePlan) {
  const staffing = normalizeStaffingPlan(plan.staffing);
  const objects = new Map(plan.objects.map((object) => [object.id, object]));
  const posts = plan.objects
    .filter((object) => object.kind === "staff_post")
    .map((object) => normalizePost(object, staffing))
    .sort((left, right) => left.objectId.localeCompare(right.objectId));
  const coverage = staffing.coverageRequirements
    .flatMap((requirement) =>
      requirement.shiftIds.map((shiftId) => {
        const zone = objects.get(requirement.zoneObjectId);
        if (!zone) throw new Error(`Coverage zone not found: ${requirement.zoneObjectId}`);
        const zonePoint = centerOf(zone.footprint);
        const candidates = posts
          .filter((post) => post.coverageZoneObjectIds.includes(requirement.zoneObjectId))
          .flatMap((post) =>
            post.assignments
              .filter((assignment) => assignment.shiftId === shiftId && assignment.roleId === requirement.roleId)
              .map((assignment) => ({
                post,
                assignment,
                walkingDistanceM: round(Math.hypot(post.point.x - zonePoint.x, post.point.y - zonePoint.y)),
              })),
          );
        const reachable = candidates.filter(
          (candidate) => candidate.walkingDistanceM <= staffing.maximumWalkingDistanceM,
        );
        const assignedCount = reachable.reduce((sum, candidate) => sum + candidate.assignment.count, 0);
        return {
          requirementId: requirement.id,
          zoneObjectId: requirement.zoneObjectId,
          roleId: requirement.roleId,
          shiftId,
          minimumCount: requirement.minimumCount,
          assignedCount,
          status: assignedCount >= requirement.minimumCount ? "covered" : "gap",
          postObjectIds: reachable.map((candidate) => candidate.post.objectId).sort(),
          maximumWalkingDistanceM: reachable.length
            ? Math.max(...reachable.map((candidate) => candidate.walkingDistanceM))
            : null,
        };
      }),
    )
    .sort(
      (left, right) =>
        left.shiftId.localeCompare(right.shiftId) || left.requirementId.localeCompare(right.requirementId),
    );
  const handoffs: Array<{
    postObjectId: string;
    roleId: string;
    fromShiftId: string;
    toShiftId: string;
    overlapMinutes: number;
    status: "covered" | "risk";
  }> = [];
  for (const post of posts)
    for (const roleId of staffing.roles.map((role) => role.id)) {
      const assignments = post.assignments
        .filter((assignment) => assignment.roleId === roleId)
        .flatMap((assignment) => {
          const shift = staffing.shifts.find((item) => item.id === assignment.shiftId);
          return shift ? [{ ...assignment, shift }] : [];
        })
        .sort((left, right) => left.shift.startMinute - right.shift.startMinute);
      for (let index = 1; index < assignments.length; index += 1) {
        const previous = assignments[index - 1];
        const next = assignments[index];
        if (!previous || !next) continue;
        const overlapMinutes = previous.shift.endMinute - next.shift.startMinute;
        handoffs.push({
          postObjectId: post.objectId,
          roleId,
          fromShiftId: previous.shiftId,
          toShiftId: next.shiftId,
          overlapMinutes,
          status: overlapMinutes >= staffing.minimumHandoffOverlapMinutes ? "covered" : "risk",
        });
      }
    }
  const staffOnlyRouteObjectIds = plan.objects
    .filter(
      (object) =>
        ["corridor", "aisle", "service_lane", "accessible_route"].includes(object.kind) &&
        (object.route?.staffOnly === true || object.route?.purpose === "staff-only"),
    )
    .map((object) => object.id)
    .sort();
  const assignedByRole: Record<string, number> = Object.fromEntries(
    staffing.roles.map((role) => [
      role.id,
      Math.max(
        0,
        ...staffing.shifts.map((shift) =>
          posts
            .flatMap((post) => post.assignments)
            .filter((assignment) => assignment.roleId === role.id && assignment.shiftId === shift.id)
            .reduce((sum, assignment) => sum + assignment.count, 0),
        ),
      ),
    ]),
  );
  const roleCapacity = staffing.roles.map((role) => {
    const peakAssigned = assignedByRole[role.id] ?? 0;
    return {
      roleId: role.id,
      headcount: role.headcount,
      peakAssigned,
      status: peakAssigned <= role.headcount ? "within-headcount" : "over-assigned",
    };
  });
  const result = {
    schemaVersion: 1,
    kind: "staffing-operations-result",
    planId: plan.id,
    planVersion: plan.version,
    geometryFingerprint: plan.spatial.fingerprint,
    staffing,
    posts,
    coverage,
    handoffs,
    staffOnlyRouteObjectIds,
    roleCapacity,
    summary: {
      requiredCoverageChecks: coverage.length,
      coveredChecks: coverage.filter((item) => item.status === "covered").length,
      coverageGaps: coverage.filter((item) => item.status === "gap").length,
      handoffRisks: handoffs.filter((item) => item.status === "risk").length,
      overAssignedRoles: roleCapacity.filter((item) => item.status === "over-assigned").length,
      maximumWalkingDistanceM: Math.max(0, ...coverage.map((item) => item.maximumWalkingDistanceM ?? 0)),
    },
    evidenceFingerprint: "",
  };
  result.evidenceFingerprint = stableFingerprint("staffing-operations", result);
  return result;
}

export function createStaffingScheduleCsv(
  plan: VenuePlan,
  result: ReturnType<typeof analyzeStaffingOperations> = analyzeStaffingOperations(plan),
): string {
  const shifts = new Map(result.staffing.shifts.map((shift) => [shift.id, shift]));
  const roles = new Map(result.staffing.roles.map((role) => [role.id, role]));
  const rows = result.posts.flatMap((post) =>
    post.assignments.map((assignment) => {
      const shift = shifts.get(assignment.shiftId);
      return [
        post.objectId,
        post.label,
        assignment.roleId,
        roles.get(assignment.roleId)?.label,
        assignment.count,
        assignment.shiftId,
        shift?.startMinute,
        shift?.endMinute,
        post.coverageZoneObjectIds.join("|"),
      ];
    }),
  );
  return (
    [
      [
        "post_object_id",
        "post_label",
        "role_id",
        "role_label",
        "count",
        "shift_id",
        "start_minute",
        "end_minute",
        "coverage_zone_object_ids",
      ],
      ...rows,
    ]
      .map((row) => row.map(csv).join(","))
      .join("\r\n") + "\r\n"
  );
}

export function createStaffingPostMapSvg(
  plan: VenuePlan,
  result: ReturnType<typeof analyzeStaffingOperations> = analyzeStaffingOperations(plan),
): string {
  const boundary = plan.spatial.roomBoundary.outer;
  const minX = Math.min(...boundary.map((point) => point.x));
  const maxX = Math.max(...boundary.map((point) => point.x));
  const minY = Math.min(...boundary.map((point) => point.y));
  const maxY = Math.max(...boundary.map((point) => point.y));
  const scale = Math.min(900 / (maxX - minX), 540 / (maxY - minY));
  const point = ({ x, y }: Point): Point => ({ x: 60 + (x - minX) * scale, y: 600 - 30 - (y - minY) * scale });
  const room = boundary
    .map((item) => {
      const p = point(item);
      return `${round(p.x)},${round(p.y)}`;
    })
    .join(" ");
  const posts = result.posts
    .map((post, index) => {
      const p = point(post.point);
      return `<g data-object-id="${post.objectId}"><circle cx="${round(p.x)}" cy="${round(p.y)}" r="12" fill="#6f4ee8"/><text x="${round(p.x)}" y="${round(p.y + 4)}" text-anchor="middle" fill="#fff" font-size="10" font-weight="700">${index + 1}</text><text x="${round(p.x + 16)}" y="${round(p.y + 4)}" font-size="11">${post.label}</text></g>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="1020" height="640" viewBox="0 0 1020 640" role="img" aria-label="Staffing post map"><rect width="1020" height="640" fill="#f8f7f3"/><text x="60" y="34" font-family="Inter,Arial" font-size="22" font-weight="700">${plan.event.name} · STAFF POSTS</text><polygon points="${room}" fill="#fff" stroke="#34352f" stroke-width="3"/>${posts}<text x="960" y="34" text-anchor="end" font-family="Inter,Arial" font-size="11">${result.evidenceFingerprint}</text></svg>\n`;
}
