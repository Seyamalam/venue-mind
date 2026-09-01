import { stableFingerprint } from "./activity-ledger.ts";

const clone: any = (value: any) => JSON.parse(JSON.stringify(value));
const round: any = (value: any, precision: any = 2) => Number(Number(value).toFixed(precision));
const csv: any = (value: any) => `"${String(value ?? "").replaceAll('"', '""')}"`;

const centerOf: any = (footprint: any) => {
  if (footprint?.center) return clone(footprint.center);
  if (footprint?.start && footprint?.end) return { x: (footprint.start.x + footprint.end.x) / 2, y: (footprint.start.y + footprint.end.y) / 2 };
  const points: any = footprint?.points ?? [];
  return points.length ? { x: points.reduce((sum: any, point: any) => sum + point.x, 0) / points.length, y: points.reduce((sum: any, point: any) => sum + point.y, 0) / points.length } : { x: 0, y: 0 };
};

const requireUnique: any = (items: any, label: any) => {
  const ids: any = items.map((item: any) => item.id);
  if (ids.some((id: any) => typeof id !== "string" || !id.trim()) || new Set(ids).size !== ids.length) throw new Error(`${label} require unique stable IDs`);
};

export function normalizeStaffingPlan(value: any = {}) {
  const roles: any = (value.roles ?? []).map((role: any) => ({ id: String(role.id), label: String(role.label ?? role.id), headcount: Math.trunc(Number(role.headcount)), skills: [...new Set((role.skills ?? []).map(String))].sort() }));
  const shifts: any = (value.shifts ?? []).map((shift: any) => ({ id: String(shift.id), label: String(shift.label ?? shift.id), startMinute: Math.trunc(Number(shift.startMinute)), endMinute: Math.trunc(Number(shift.endMinute)) }));
  const coverageRequirements: any = (value.coverageRequirements ?? []).map((requirement: any) => ({ id: String(requirement.id), zoneObjectId: String(requirement.zoneObjectId), roleId: String(requirement.roleId), minimumCount: Math.trunc(Number(requirement.minimumCount)), shiftIds: [...new Set((requirement.shiftIds ?? shifts.map((shift: any) => shift.id)).map(String))].sort() }));
  requireUnique(roles, "Staff roles");
  requireUnique(shifts, "Staff shifts");
  requireUnique(coverageRequirements, "Coverage requirements");
  if (roles.some((role: any) => !Number.isInteger(role.headcount) || role.headcount < 0)) throw new Error("Staff role headcount must be a non-negative integer");
  if (shifts.some((shift: any) => !Number.isInteger(shift.startMinute) || !Number.isInteger(shift.endMinute) || shift.endMinute <= shift.startMinute)) throw new Error("Staff shifts require increasing minute bounds");
  const roleIds: any = new Set(roles.map((role: any) => role.id));
  const shiftIds: any = new Set(shifts.map((shift: any) => shift.id));
  if (coverageRequirements.some((requirement: any) => !roleIds.has(requirement.roleId) || !Number.isInteger(requirement.minimumCount) || requirement.minimumCount < 1 || requirement.shiftIds.some((id: any) => !shiftIds.has(id)))) throw new Error("Coverage requirements must reference roles, shifts, and positive counts");
  return {
    schemaVersion: 1,
    roles,
    shifts,
    coverageRequirements,
    minimumHandoffOverlapMinutes: Math.max(0, Math.trunc(Number(value.minimumHandoffOverlapMinutes ?? 15))),
    maximumWalkingDistanceM: Math.max(1, Number(value.maximumWalkingDistanceM ?? 25)),
  };
}

const normalizePost: any = (object: any, staffing: any) => {
  const metadata: any = object.staffPost;
  if (!metadata) throw new Error(`Staff post ${object.id} requires staffing metadata`);
  const roleIds: any = new Set(staffing.roles.map((role: any) => role.id));
  const shiftIds: any = new Set(staffing.shifts.map((shift: any) => shift.id));
  const assignments: any = (metadata.assignments ?? []).map((assignment: any) => ({ shiftId: String(assignment.shiftId), roleId: String(assignment.roleId), count: Math.trunc(Number(assignment.count)) }));
  if (!assignments.length || assignments.some((assignment: any) => !shiftIds.has(assignment.shiftId) || !roleIds.has(assignment.roleId) || !Number.isInteger(assignment.count) || assignment.count < 1)) throw new Error(`Staff post ${object.id} requires valid shift assignments`);
  return { objectId: object.id, label: object.label, point: centerOf(object.footprint), coverageZoneObjectIds: [...new Set((metadata.coverageZoneObjectIds ?? []).map(String))].sort(), assignments };
};

export function analyzeStaffingOperations(plan: any) {
  const staffing: any = normalizeStaffingPlan(plan.staffing);
  const objects: any = new Map(plan.objects.map((object: any) => [object.id, object]));
  const posts: any = plan.objects.filter((object: any) => object.kind === "staff_post").map((object: any) => normalizePost(object, staffing)).sort((left: any, right: any) => left.objectId.localeCompare(right.objectId));
  const coverage: any = staffing.coverageRequirements.flatMap((requirement: any) => requirement.shiftIds.map((shiftId: any) => {
    const zone: any = objects.get(requirement.zoneObjectId);
    if (!zone) throw new Error(`Coverage zone not found: ${requirement.zoneObjectId}`);
    const zonePoint: any = centerOf(zone.footprint);
    const candidates: any = posts.filter((post: any) => post.coverageZoneObjectIds.includes(requirement.zoneObjectId)).flatMap((post: any) => post.assignments.filter((assignment: any) => assignment.shiftId === shiftId && assignment.roleId === requirement.roleId).map((assignment: any) => ({ post, assignment, walkingDistanceM: round(Math.hypot(post.point.x - zonePoint.x, post.point.y - zonePoint.y)) })));
    const reachable: any = candidates.filter((candidate: any) => candidate.walkingDistanceM <= staffing.maximumWalkingDistanceM);
    const assignedCount: any = reachable.reduce((sum: any, candidate: any) => sum + candidate.assignment.count, 0);
    return { requirementId: requirement.id, zoneObjectId: requirement.zoneObjectId, roleId: requirement.roleId, shiftId, minimumCount: requirement.minimumCount, assignedCount, status: assignedCount >= requirement.minimumCount ? "covered" : "gap", postObjectIds: reachable.map((candidate: any) => candidate.post.objectId).sort(), maximumWalkingDistanceM: reachable.length ? Math.max(...reachable.map((candidate: any) => candidate.walkingDistanceM)) : null };
  })).sort((left: any, right: any) => left.shiftId.localeCompare(right.shiftId) || left.requirementId.localeCompare(right.requirementId));
  const handoffs: any[] = [];
  for (const post of posts) for (const roleId of staffing.roles.map((role: any) => role.id)) {
    const assignments: any = post.assignments.filter((assignment: any) => assignment.roleId === roleId).map((assignment: any) => ({ ...assignment, shift: staffing.shifts.find((shift: any) => shift.id === assignment.shiftId) })).sort((left: any, right: any) => left.shift.startMinute - right.shift.startMinute);
    for (let index: any = 1; index < assignments.length; index += 1) {
      const previous: any = assignments[index - 1];
      const next: any = assignments[index];
      const overlapMinutes: any = previous.shift.endMinute - next.shift.startMinute;
      handoffs.push({ postObjectId: post.objectId, roleId, fromShiftId: previous.shiftId, toShiftId: next.shiftId, overlapMinutes, status: overlapMinutes >= staffing.minimumHandoffOverlapMinutes ? "covered" : "risk" });
    }
  }
  const staffOnlyRouteObjectIds: any = plan.objects.filter((object: any) => ["corridor", "aisle", "service_lane", "accessible_route"].includes(object.kind) && (object.route?.staffOnly === true || object.route?.purpose === "staff-only")).map((object: any) => object.id).sort();
  const assignedByRole: any = Object.fromEntries(staffing.roles.map((role: any) => [role.id, Math.max(0, ...staffing.shifts.map((shift: any) => posts.flatMap((post: any) => post.assignments).filter((assignment: any) => assignment.roleId === role.id && assignment.shiftId === shift.id).reduce((sum: any, assignment: any) => sum + assignment.count, 0)))]));
  const roleCapacity: any = staffing.roles.map((role: any) => ({ roleId: role.id, headcount: role.headcount, peakAssigned: assignedByRole[role.id], status: assignedByRole[role.id] <= role.headcount ? "within-headcount" : "over-assigned" }));
  const result: any = {
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
    summary: { requiredCoverageChecks: coverage.length, coveredChecks: coverage.filter((item: any) => item.status === "covered").length, coverageGaps: coverage.filter((item: any) => item.status === "gap").length, handoffRisks: handoffs.filter((item: any) => item.status === "risk").length, overAssignedRoles: roleCapacity.filter((item: any) => item.status === "over-assigned").length, maximumWalkingDistanceM: Math.max(0, ...coverage.map((item: any) => item.maximumWalkingDistanceM ?? 0)) },
  };
  result.evidenceFingerprint = stableFingerprint("staffing-operations", result);
  return result;
}

export function createStaffingScheduleCsv(plan: any, result: any = analyzeStaffingOperations(plan)) {
  const shifts: any = new Map(result.staffing.shifts.map((shift: any) => [shift.id, shift]));
  const roles: any = new Map(result.staffing.roles.map((role: any) => [role.id, role]));
  const rows: any = result.posts.flatMap((post: any) => post.assignments.map((assignment: any) => {
    const shift: any = shifts.get(assignment.shiftId);
    return [post.objectId, post.label, assignment.roleId, roles.get(assignment.roleId)?.label, assignment.count, assignment.shiftId, shift.startMinute, shift.endMinute, post.coverageZoneObjectIds.join("|")];
  }));
  return [["post_object_id", "post_label", "role_id", "role_label", "count", "shift_id", "start_minute", "end_minute", "coverage_zone_object_ids"], ...rows].map((row: any) => row.map(csv).join(",")).join("\r\n") + "\r\n";
}

export function createStaffingPostMapSvg(plan: any, result: any = analyzeStaffingOperations(plan)) {
  const boundary: any = plan.spatial.roomBoundary.outer;
  const minX: any = Math.min(...boundary.map((point: any) => point.x));
  const maxX: any = Math.max(...boundary.map((point: any) => point.x));
  const minY: any = Math.min(...boundary.map((point: any) => point.y));
  const maxY: any = Math.max(...boundary.map((point: any) => point.y));
  const scale: any = Math.min(900 / (maxX - minX), 540 / (maxY - minY));
  const point: any = ({ x, y }: any) => ({ x: 60 + (x - minX) * scale, y: 600 - 30 - (y - minY) * scale });
  const room: any = boundary.map((item: any) => { const p: any = point(item); return `${round(p.x)},${round(p.y)}`; }).join(" ");
  const posts: any = result.posts.map((post: any, index: any) => { const p: any = point(post.point); return `<g data-object-id="${post.objectId}"><circle cx="${round(p.x)}" cy="${round(p.y)}" r="12" fill="#6f4ee8"/><text x="${round(p.x)}" y="${round(p.y + 4)}" text-anchor="middle" fill="#fff" font-size="10" font-weight="700">${index + 1}</text><text x="${round(p.x + 16)}" y="${round(p.y + 4)}" font-size="11">${post.label}</text></g>`; }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="1020" height="640" viewBox="0 0 1020 640" role="img" aria-label="Staffing post map"><rect width="1020" height="640" fill="#f8f7f3"/><text x="60" y="34" font-family="Inter,Arial" font-size="22" font-weight="700">${plan.event.name} · STAFF POSTS</text><polygon points="${room}" fill="#fff" stroke="#34352f" stroke-width="3"/>${posts}<text x="960" y="34" text-anchor="end" font-family="Inter,Arial" font-size="11">${result.evidenceFingerprint}</text></svg>\n`;
}
