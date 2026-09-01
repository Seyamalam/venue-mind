import { stableFingerprint } from "../domain/activity-ledger.ts";
import { analyzeProductionPlan, createProductionMapSvg, createProductionScheduleCsv } from "../domain/production-planning.ts";
import { createReplenishmentScheduleCsv, createServiceStationScheduleCsv } from "../domain/catering-planning.ts";
import { analyzeEmergencyPlan } from "../domain/emergency-planning.ts";
import { analyzeStaffingOperations, createStaffingPostMapSvg, createStaffingScheduleCsv } from "../domain/staffing-operations.ts";
import { venueTemplateCatalog } from "../domain/venue-templates.ts";

export const PLAN_EXPORT_FORMATS = Object.freeze(["json", "text", "svg", "pdf", "pdf-emergency", "csv", "csv-objects", "csv-inventory", "csv-staffing", "svg-post-map", "csv-production", "svg-production", "csv-catering-stations", "csv-replenishment", "audit"]);

const LAYERS: readonly string[] = Object.freeze(["architecture", "furniture", "access", "production", "catering", "safety", "annotations"]);
const LAYER_STYLE: Readonly<Record<string, { fill: string; stroke: string }>> = Object.freeze({
  architecture: { fill: "#d9d7d1", stroke: "#5f605c" },
  furniture: { fill: "#ded8f8", stroke: "#6950ce" },
  access: { fill: "#caeadb", stroke: "#25845c" },
  production: { fill: "#ccbdf5", stroke: "#5e3ec6" },
  catering: { fill: "#f0d6ad", stroke: "#9a642d" },
  safety: { fill: "#f3c9c4", stroke: "#b0443a" },
  annotations: { fill: "#eeeafc", stroke: "#6845e8" },
});

const encoder = new TextEncoder();
const clone = (value: any) => JSON.parse(JSON.stringify(value));
const number = (value: any, digits: any = 3) => Number(Number(value).toFixed(digits));
const xml = (value: any) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
const slug = (value: any) => String(value || "venue-plan").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "venue-plan";

const centerOf = (footprint: any) => {
  if (footprint.center) return footprint.center;
  if (footprint.kind === "line") return { x: (footprint.start.x + footprint.end.x) / 2, y: (footprint.start.y + footprint.end.y) / 2 };
  return {
    x: footprint.points.reduce((sum: any, point: any) => sum + point.x, 0) / footprint.points.length,
    y: footprint.points.reduce((sum: any, point: any) => sum + point.y, 0) / footprint.points.length,
  };
};

const rectangleCorners = (footprint: any) => {
  const radians = -(footprint.rotationDegrees ?? 0) * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [[-footprint.width / 2, -footprint.depth / 2], [footprint.width / 2, -footprint.depth / 2], [footprint.width / 2, footprint.depth / 2], [-footprint.width / 2, footprint.depth / 2]].map(([dx, dy]: any) => ({
    x: footprint.center.x + dx * cos - dy * sin,
    y: footprint.center.y + dx * sin + dy * cos,
  }));
};

const lineCorners = (footprint: any) => {
  const dx = footprint.end.x - footprint.start.x;
  const dy = footprint.end.y - footprint.start.y;
  const length = Math.hypot(dx, dy) || 1;
  const ox = (-dy / length) * footprint.width / 2;
  const oy = (dx / length) * footprint.width / 2;
  return [
    { x: footprint.start.x + ox, y: footprint.start.y + oy },
    { x: footprint.end.x + ox, y: footprint.end.y + oy },
    { x: footprint.end.x - ox, y: footprint.end.y - oy },
    { x: footprint.start.x - ox, y: footprint.start.y - oy },
  ];
};

const footprintPoints = (footprint: any, circleSegments: any = 32) => {
  if (footprint.kind === "rectangle") return rectangleCorners(footprint);
  if (footprint.kind === "line") return lineCorners(footprint);
  if (footprint.kind === "polygon") return footprint.points;
  return Array.from({ length: circleSegments }, (_: any, index: any) => {
    const radians = index / circleSegments * Math.PI * 2;
    return { x: footprint.center.x + Math.cos(radians) * footprint.radius, y: footprint.center.y + Math.sin(radians) * footprint.radius };
  });
};

const planBounds = (plan: any) => {
  const points = plan.spatial.roomBoundary.outer;
  const xs = points.map((point: any) => point.x);
  const ys = points.map((point: any) => point.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
};

const geometryDescriptor = (footprint: any) => {
  if (footprint.kind === "rectangle") return `${number(footprint.width)} x ${number(footprint.depth)} m`;
  if (footprint.kind === "circle") return `D ${number(footprint.radius * 2)} m`;
  if (footprint.kind === "line") return `${number(Math.hypot(footprint.end.x - footprint.start.x, footprint.end.y - footprint.start.y))} x ${number(footprint.width)} m`;
  return `${footprint.points.length} points`;
};

const rfc4180 = (value: any) => {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const metricValue = (object: any, key: any) => object[key] == null ? "" : object[key];

export function createObjectScheduleCsv(plan: any) {
  const header: any = ["object_id", "label", "kind", "layer", "footprint", "center_x_m", "center_y_m", "rotation_deg", "elevation_m", "capacity", "inventory_count", "template_id", "template_version", "resource_id", "resource_kind", "resource_quantity", "locked"];
  const rows = [...plan.objects].sort((left: any, right: any) => LAYERS.indexOf(left.layer) - LAYERS.indexOf(right.layer) || left.id.localeCompare(right.id)).map((object: any) => {
    const center = centerOf(object.footprint);
    return [object.id, object.label, object.kind, object.layer, geometryDescriptor(object.footprint), number(center.x), number(center.y), metricValue(object.footprint, "rotationDegrees"), number(object.elevationM), metricValue(object, "capacity"), metricValue(object, "inventoryCount"), object.templateRef?.templateId ?? "", object.templateRef?.version ?? "", object.resourceBinding?.resourceId ?? "", object.resourceBinding?.kind ?? "", object.resourceBinding?.quantity ?? "", object.locked || object.locks?.length ? "true" : "false"];
  });
  return `${[header, ...rows].map((row: any) => row.map(rfc4180).join(",")).join("\r\n")}\r\n`;
}

export function createInventoryScheduleCsv(plan: any, validation: any) {
  const header: any = ["template_id", "template_version", "item_name", "category", "requested", "available", "shortage", "status", "unit_cost", "currency", "cost_basis", "estimated_cost", "unit_weight_kg", "total_weight_kg", "watts_each", "total_watts", "connector", "placed_object_ids", "resource_bindings"];
  const availability: any = new Map((validation.inventoryAvailability ?? []).map((item: any) => [`${item.templateId}@${item.version}`, item]));
  const placements: any = new Map();
  for (const object of plan.objects) {
    if (object.templateRef?.kind !== "inventory-item-template") continue;
    const key = `${object.templateRef.templateId}@${object.templateRef.version}`;
    const entry = placements.get(key) ?? { requested: 0, objectIds: [], resourceBindings: [] };
    entry.requested += object.inventoryCount ?? 1;
    entry.objectIds.push(object.id);
    if (object.resourceBinding) entry.resourceBindings.push(`${object.resourceBinding.resourceId}:${object.resourceBinding.quantity}`);
    placements.set(key, entry);
  }
  const rows = [...placements.entries()].sort(([left]: any, [right]: any) => left.localeCompare(right)).map(([key, placement]: any) => {
    const [templateId, version] = key.split("@");
    const template = venueTemplateCatalog.inventoryTemplates.find((item: any) => item.id === templateId && item.version === version);
    const stock = availability.get(key) ?? { requested: placement.requested, available: template ? template.availability.total - template.availability.unavailable : "", shortage: "", status: "unmeasured" };
    const unitCost = template?.cost.amount ?? "";
    const watts = template?.power.watts ?? "";
    return [templateId, version, template?.name ?? "", template?.category ?? "", stock.requested, stock.available, stock.shortage, stock.status, unitCost, template?.cost.currency ?? "", template?.cost.basis ?? "", unitCost === "" ? "" : number(unitCost * stock.requested, 2), template?.weightKg ?? "", template ? number(template.weightKg * stock.requested, 2) : "", watts, watts === "" ? "" : number(watts * stock.requested, 2), template?.power.connector ?? "", placement.objectIds.sort().join("|"), placement.resourceBindings.sort().join("|")];
  });
  return `${[header, ...rows].map((row: any) => row.map(rfc4180).join(",")).join("\r\n")}\r\n`;
}

const svgPath = (points: any, transform: any) => `${points.map((point: any, index: any) => `${index ? "L" : "M"} ${number(transform.x(point.x), 2)} ${number(transform.y(point.y), 2)}`).join(" ")} Z`;

export function createLayeredSvg(plan: any, validation: any, { comments = [], exportedAt = new Date().toISOString() }: any = {}) {
  const bounds = planBounds(plan);
  const width = 1200;
  const height = 800;
  const margin: any = { left: 72, right: 255, top: 116, bottom: 66 };
  const scale = Math.min((width - margin.left - margin.right) / (bounds.maxX - bounds.minX), (height - margin.top - margin.bottom) / (bounds.maxY - bounds.minY));
  const transform: any = {
    x: (value: any) => margin.left + (value - bounds.minX) * scale,
    y: (value: any) => height - margin.bottom - (value - bounds.minY) * scale,
  };
  const roomPath = svgPath(plan.spatial.roomBoundary.outer, transform);
  const holePaths = plan.spatial.roomBoundary.holes.map((hole: any) => svgPath(hole, transform)).join(" ");
  const objectMarkup = LAYERS.map((layer: any) => {
    const objects = plan.objects.filter((object: any) => object.layer === layer).sort((left: any, right: any) => left.id.localeCompare(right.id));
    const children = objects.map((object: any) => {
      const style = LAYER_STYLE[layer];
      const points = footprintPoints(object.footprint);
      const center = centerOf(object.footprint);
      const label = object.label.length > 22 ? `${object.label.slice(0, 20)}..` : object.label;
      return `<g id="${xml(object.id)}" data-object-id="${xml(object.id)}" data-kind="${xml(object.kind)}" role="graphics-symbol" aria-label="${xml(object.label)}"><title>${xml(`${object.label} (${object.id})`)}</title><path d="${svgPath(points, transform)}" fill="${style.fill}" fill-opacity="0.78" stroke="${style.stroke}" stroke-width="1.5" vector-effect="non-scaling-stroke"/><text x="${number(transform.x(center.x), 2)}" y="${number(transform.y(center.y), 2)}" text-anchor="middle" dominant-baseline="middle" class="object-label">${xml(label)}</text></g>`;
    }).join("");
    return `<g id="layer-${layer}" data-layer="${layer}" aria-label="${layer}">${children}</g>`;
  }).join("");
  const pins = comments.filter((comment: any) => comment.anchor?.kind === "coordinate" && comment.anchor.planVersion === plan.version).map((comment: any, index: any) => {
    const point = comment.anchor.point;
    return `<g id="annotation-${xml(comment.id)}" data-comment-id="${xml(comment.id)}"><circle cx="${number(transform.x(point.x), 2)}" cy="${number(transform.y(point.y), 2)}" r="10" fill="${comment.status === "resolved" ? "#8c8d88" : "#6845e8"}"/><text x="${number(transform.x(point.x), 2)}" y="${number(transform.y(point.y) + 1, 2)}" class="pin-label">${index + 1}</text><title>${xml(comment.body)}</title></g>`;
  }).join("");
  const legend = LAYERS.map((layer: any, index: any) => `<g transform="translate(970 ${180 + index * 34})"><rect width="18" height="18" rx="3" fill="${LAYER_STYLE[layer].fill}" stroke="${LAYER_STYLE[layer].stroke}"/><text x="29" y="13" class="legend-label">${xml(layer.toUpperCase())}</text></g>`).join("");
  const checks = validation.checks ?? [];
  const passed = checks.filter((check: any) => check.status === "pass").length;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title description"><title id="title">${xml(plan.event.name)} Plan v${xml(plan.version)}</title><desc id="description">Layered VenueMind venue plan. Validation ${xml(validation.status)}. ${passed} of ${checks.length} checks passed.</desc><metadata>${xml(JSON.stringify({ format: "venuemind-layered-svg", schemaVersion: 1, planId: plan.id, planVersion: plan.version, geometryFingerprint: plan.spatial.fingerprint, validationId: validation.validationId, exportedAt }))}</metadata><style>.title{font:700 26px Inter,Arial,sans-serif;fill:#23241f}.meta{font:500 12px Inter,Arial,sans-serif;fill:#6b6c66}.object-label{font:600 9px Inter,Arial,sans-serif;fill:#252622;paint-order:stroke;stroke:#fff;stroke-width:2px;stroke-opacity:.86}.legend-label{font:700 10px Inter,Arial,sans-serif;fill:#4e4f4a;letter-spacing:.7px}.pin-label{font:700 9px Inter,Arial,sans-serif;fill:#fff;text-anchor:middle;dominant-baseline:middle}.dimension{font:600 10px Inter,Arial,sans-serif;fill:#686963}</style><rect width="1200" height="800" fill="#f8f7f3"/><text x="72" y="52" class="title">${xml(plan.event.name)}</text><text x="72" y="78" class="meta">PLAN v${xml(plan.version)}  /  PROPOSAL ${xml(validation.evaluatedProposalId ?? "NONE")}  /  ${xml(plan.venue.name)}</text><text x="1128" y="52" text-anchor="end" class="meta">${xml(validation.status.toUpperCase())}  /  ${passed}-${checks.length}</text><g id="layer-room" data-layer="architecture"><path d="${roomPath} ${holePaths}" fill="#fff" fill-rule="evenodd" stroke="#383935" stroke-width="3"/></g>${objectMarkup}<g id="comment-annotations" data-layer="annotations">${pins}</g><g id="dimensions"><path d="M ${number(transform.x(bounds.minX), 2)} ${height - 40} H ${number(transform.x(bounds.maxX), 2)}" stroke="#9a9b95"/><text x="${number((transform.x(bounds.minX) + transform.x(bounds.maxX)) / 2, 2)}" y="${height - 26}" text-anchor="middle" class="dimension">${number(bounds.maxX - bounds.minX)} m</text><path d="M 42 ${number(transform.y(bounds.maxY), 2)} V ${number(transform.y(bounds.minY), 2)}" stroke="#9a9b95"/><text x="24" y="${number((transform.y(bounds.maxY) + transform.y(bounds.minY)) / 2, 2)}" text-anchor="middle" class="dimension" transform="rotate(-90 24 ${number((transform.y(bounds.maxY) + transform.y(bounds.minY)) / 2, 2)})">${number(bounds.maxY - bounds.minY)} m</text></g><g id="legend"><text x="970" y="142" class="legend-label">LAYERS</text>${legend}</g><text x="970" y="472" class="legend-label">OBJECTS  ${plan.objects.length}</text><text x="970" y="500" class="legend-label">GEOMETRY</text><text x="970" y="519" class="meta">${xml(plan.spatial.fingerprint)}</text><text x="970" y="555" class="legend-label">VALIDATION</text><text x="970" y="574" class="meta">${xml(validation.validationId)}</text><text x="970" y="610" class="legend-label">EXPORTED</text><text x="970" y="629" class="meta">${xml(exportedAt)}</text></svg>\n`;
}

const ascii = (value: any) => String(value ?? "").normalize("NFKD").replace(/[^\x20-\x7E]/g, "-");
const pdfEscape = (value: any) => ascii(value).replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
const pdfColor = (hex: any) => [1, 3, 5].map((index: any) => Number.parseInt(hex.slice(index, index + 2), 16) / 255).map((value: any) => number(value, 3)).join(" ");

const pdfText = (x: any, y: any, text: any, size: any = 10, font: any = "F1", color: any = "0.18 0.18 0.17") => `BT /${font} ${size} Tf ${color} rg ${number(x, 2)} ${number(y, 2)} Td (${pdfEscape(text)}) Tj ET`;
const pdfLine = (x1: any, y1: any, x2: any, y2: any, color: any = "0.4 0.4 0.38", width: any = 1) => `${color} RG ${width} w ${number(x1, 2)} ${number(y1, 2)} m ${number(x2, 2)} ${number(y2, 2)} l S`;
const pdfPolygon = (points: any, fill: any, stroke: any, width: any = 0.8) => `${pdfColor(fill)} rg ${pdfColor(stroke)} RG ${width} w ${points.map((point: any, index: any) => `${number(point.x, 2)} ${number(point.y, 2)} ${index ? "l" : "m"}`).join(" ")} h B`;

const buildPdfDocument = (pages: any) => {
  const objects: any = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_: any, index: any) => `${5 + index * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
  ];
  pages.forEach((content: any, index: any) => {
    const pageId = 5 + index * 2;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageId + 1} 0 R >>`);
    objects.push(`<< /Length ${encoder.encode(content).byteLength} >>\nstream\n${content}\nendstream`);
  });
  let output = "%PDF-1.4\n%VMND\n";
  const offsets: any = [0];
  objects.forEach((object: any, index: any) => {
    offsets.push(encoder.encode(output).byteLength);
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = encoder.encode(output).byteLength;
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset: any) => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return encoder.encode(output);
};

const base64 = (bytes: any) => {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

export function createPlanPdf(plan: any, validation: any, { exportedAt = new Date().toISOString() }: any = {}) {
  const bounds = planBounds(plan);
  const origin: any = { x: 42, y: 72 };
  const available: any = { width: 600, height: 440 };
  const scale = Math.min(available.width / (bounds.maxX - bounds.minX), available.height / (bounds.maxY - bounds.minY));
  const transform: any = {
    x: (value: any) => origin.x + (value - bounds.minX) * scale,
    y: (value: any) => origin.y + (value - bounds.minY) * scale,
  };
  const page1: any = [];
  page1.push("0.973 0.969 0.953 rg 0 0 842 595 re f");
  page1.push(pdfText(42, 552, plan.event.name, 22, "F2", "0.12 0.12 0.11"));
  page1.push(pdfText(42, 529, `PLAN v${plan.version}  /  PROPOSAL ${validation.evaluatedProposalId ?? "NONE"}  /  ${plan.venue.name}`, 9, "F1", "0.37 0.37 0.35"));
  page1.push(pdfText(800, 552, validation.status.toUpperCase(), 10, "F2", validation.status === "pass" ? "0.12 0.48 0.32" : "0.7 0.2 0.17"));
  page1.push(pdfPolygon(plan.spatial.roomBoundary.outer.map((point: any) => ({ x: transform.x(point.x), y: transform.y(point.y) })), "#ffffff", "#393a37", 1.8));
  for (const layer of LAYERS) {
    for (const object of plan.objects.filter((item: any) => item.layer === layer).sort((left: any, right: any) => left.id.localeCompare(right.id))) {
      const points = footprintPoints(object.footprint, 20).map((point: any) => ({ x: transform.x(point.x), y: transform.y(point.y) }));
      page1.push(pdfPolygon(points, LAYER_STYLE[layer].fill, LAYER_STYLE[layer].stroke));
      const center = centerOf(object.footprint);
      const visibleLabel = object.footprint.kind === "rectangle" || (object.footprint.kind === "line" && Math.hypot(object.footprint.end.x - object.footprint.start.x, object.footprint.end.y - object.footprint.start.y) >= 4);
      if (visibleLabel) page1.push(pdfText(transform.x(center.x) - Math.min(object.label.length * 2.1, 36), transform.y(center.y) - 2, object.label.slice(0, 18), 6, "F2", "0.16 0.16 0.15"));
    }
  }
  page1.push(pdfText(674, 495, "LAYERS", 9, "F2"));
  LAYERS.forEach((layer: any, index: any) => {
    const y = 470 - index * 29;
    page1.push(`${pdfColor(LAYER_STYLE[layer].fill)} rg ${pdfColor(LAYER_STYLE[layer].stroke)} RG 0.8 w 674 ${y} 14 14 re B`);
    page1.push(pdfText(696, y + 3, layer.toUpperCase(), 8, "F2", "0.3 0.3 0.28"));
  });
  page1.push(pdfText(674, 238, "PLAN DATA", 9, "F2"));
  page1.push(pdfText(674, 216, `Capacity  ${validation.spatialEvidence.capacity.effectiveCapacity}`, 8));
  page1.push(pdfText(674, 199, `Access  ${validation.spatialEvidence.accessibility.minimumClearWidthM} m`, 8));
  page1.push(pdfText(674, 182, `Sightlines  ${number(validation.spatialEvidence.sightlines.coverageRatio * 100, 1)}%`, 8));
  page1.push(pdfText(674, 165, `Congestion  ${validation.spatialEvidence.circulation.peakCongestionIndex}`, 8));
  page1.push(pdfText(674, 134, "GEOMETRY", 9, "F2"));
  page1.push(pdfText(674, 115, plan.spatial.fingerprint, 7));
  page1.push(pdfText(42, 34, `Exported ${exportedAt}`, 7, "F1", "0.45 0.45 0.42"));
  page1.push(pdfText(800, 34, "1 / 2", 7, "F1", "0.45 0.45 0.42"));

  const page2: any = [];
  page2.push("0.973 0.969 0.953 rg 0 0 842 595 re f");
  page2.push(pdfText(42, 552, "VALIDATION", 22, "F2", "0.12 0.12 0.11"));
  page2.push(pdfText(42, 529, `${plan.event.name}  /  PLAN v${plan.version}  /  ${validation.validationId}`, 9, "F1", "0.37 0.37 0.35"));
  page2.push(pdfText(800, 552, validation.status.toUpperCase(), 10, "F2", validation.status === "pass" ? "0.12 0.48 0.32" : "0.7 0.2 0.17"));
  page2.push(pdfLine(42, 507, 800, 507, "0.78 0.77 0.73", 0.8));
  const columns: any = [42, 428];
  const displayedChecks = validation.checks.slice(0, 18);
  const columnLength = Math.ceil(displayedChecks.length / 2);
  displayedChecks.forEach((check: any, index: any) => {
    const column = index >= columnLength ? 1 : 0;
    const row = index % columnLength;
    const x = columns[column];
    const y = 476 - row * 47;
    const statusColor = check.status === "pass" ? "0.12 0.48 0.32" : check.status === "warning" || check.status === "waived" ? "0.62 0.39 0.12" : check.status === "not-applicable" ? "0.42 0.42 0.4" : "0.7 0.2 0.17";
    const statusLabel = check.status === "not-applicable" ? "N/A" : check.status.toUpperCase();
    page2.push(pdfText(x, y, statusLabel, 7, "F2", statusColor));
    page2.push(pdfText(x + 47, y, check.label.slice(0, 42), 9, "F2"));
    page2.push(pdfText(x + 47, y - 15, `${check.actual ?? "-"} ${check.unit ?? ""}  /  ${check.threshold ?? "-"}`, 7, "F1", "0.4 0.4 0.37"));
    page2.push(pdfLine(x, y - 27, x + 344, y - 27, "0.86 0.85 0.81", 0.5));
  });
  page2.push(pdfText(42, 60, `Engine ${validation.engineVersion}  /  Input ${validation.inputFingerprint}`, 7, "F1", "0.45 0.45 0.42"));
  page2.push(pdfText(42, 43, `Blocking ${validation.blockingIssues}  /  Warnings ${validation.unwaivedWarnings}  /  Waived ${validation.waivedWarnings}`, 7, "F1", "0.45 0.45 0.42"));
  page2.push(pdfText(800, 34, "2 / 2", 7, "F1", "0.45 0.45 0.42"));
  return buildPdfDocument([page1.join("\n"), page2.join("\n")]);
}

export function createEmergencyPlanPdf(plan: any, evidence: any = analyzeEmergencyPlan(plan), { exportedAt = new Date().toISOString() }: any = {}) {
  const emergencyObjects = plan.objects.filter((object: any) => object.kind === "fire_exit" || object.emergency);
  const allPoints: any = [...plan.spatial.roomBoundary.outer, ...emergencyObjects.flatMap((object: any) => footprintPoints(object.footprint, 20))];
  const bounds: any = { minX: Math.min(...allPoints.map((point: any) => point.x)), maxX: Math.max(...allPoints.map((point: any) => point.x)), minY: Math.min(...allPoints.map((point: any) => point.y)), maxY: Math.max(...allPoints.map((point: any) => point.y)) };
  const origin: any = { x: 42, y: 72 };
  const available: any = { width: 580, height: 420 };
  const scale = Math.min(available.width / (bounds.maxX - bounds.minX), available.height / (bounds.maxY - bounds.minY));
  const transform: any = { x: (value: any) => origin.x + (value - bounds.minX) * scale, y: (value: any) => origin.y + (value - bounds.minY) * scale };
  const page: any = ["1 1 1 rg 0 0 842 595 re f"];
  page.push(pdfText(42, 552, "EMERGENCY PLAN", 22, "F2", "0 0 0"));
  page.push(pdfText(42, 529, `${plan.event.name}  /  PLAN v${plan.version}  /  ${plan.venue.name}`, 9, "F1", "0.2 0.2 0.2"));
  page.push(pdfText(800, 552, evidence.summary.status.toUpperCase(), 10, "F2", evidence.summary.status === "pass" ? "0 0 0" : "0.55 0 0"));
  page.push(pdfPolygon(plan.spatial.roomBoundary.outer.map((point: any) => ({ x: transform.x(point.x), y: transform.y(point.y) })), "#ffffff", "#000000", 1.8));
  const routeKinds: any = new Set(["accessible_route", "corridor", "aisle", "service_lane", "emergency_access_lane"]);
  for (const object of plan.objects.filter((item: any) => routeKinds.has(item.kind))) {
    page.push(pdfPolygon(footprintPoints(object.footprint, 12).map((point: any) => ({ x: transform.x(point.x), y: transform.y(point.y) })), object.kind === "emergency_access_lane" ? "#d9d9d9" : "#f3f3f3", "#4d4d4d", object.kind === "emergency_access_lane" ? 1.5 : .5));
  }
  emergencyObjects.sort((left: any, right: any) => left.id.localeCompare(right.id)).forEach((object: any, index: any) => {
    const points = footprintPoints(object.footprint, 18).map((point: any) => ({ x: transform.x(point.x), y: transform.y(point.y) }));
    page.push(pdfPolygon(points, object.kind === "assembly_point" ? "#ffffff" : "#2b2b2b", "#000000", 1.2));
    const center = centerOf(object.footprint);
    page.push(pdfText(transform.x(center.x) + 5, transform.y(center.y) + 4, `${index + 1} ${object.label}`.slice(0, 28), 6, "F2", "0 0 0"));
  });
  page.push(pdfText(650, 492, "READINESS", 9, "F2", "0 0 0"));
  const readiness: any = [
    `EXITS  ${evidence.exitObjectIds.length} / ${evidence.totalExitCapacityPersons}`,
    `ASSEMBLY  ${evidence.totalAssemblyCapacityPersons}`,
    `FIRE COVER  ${number(evidence.fireEquipmentCoverageRatio * 100)}%`,
    `FIRST AID  ${evidence.firstAidPostObjectIds.length}`,
    `COMMAND  ${evidence.commandPostObjectIds.length}`,
  ];
  readiness.forEach((line: any, index: any) => page.push(pdfText(650, 470 - index * 20, line, 8, index === 0 ? "F2" : "F1", "0.1 0.1 0.1")));
  page.push(pdfLine(650, 350, 800, 350, "0.2 0.2 0.2", .8));
  page.push(pdfText(650, 330, "DEGRADED", 9, "F2", "0 0 0"));
  evidence.degradedScenarios.forEach((scenario: any, index: any) => {
    const y = 308 - index * 52;
    page.push(pdfText(650, y, scenario.status.toUpperCase(), 7, "F2", scenario.status === "pass" ? "0 0 0" : "0.55 0 0"));
    page.push(pdfText(695, y, scenario.scenarioType.toUpperCase(), 7, "F2", "0.1 0.1 0.1"));
    page.push(pdfText(650, y - 15, `${scenario.affectedZoneObjectIds.length} ZONE  /  ${scenario.unresolvedHardFailures} HARD`, 6, "F1", "0.25 0.25 0.25"));
    page.push(pdfText(650, y - 28, `CAP ${scenario.capacityImpact.deltaPersons >= 0 ? "+" : ""}${scenario.capacityImpact.deltaPersons}`, 6, "F1", "0.25 0.25 0.25"));
  });
  page.push(pdfText(42, 42, `${evidence.evidenceFingerprint}  /  ${exportedAt}`, 6, "F1", "0.3 0.3 0.3"));
  page.push(pdfText(800, 34, "1 / 1", 7, "F1", "0.3 0.3 0.3"));
  return buildPdfDocument([page.join("\n")]);
}

export function createPortableAuditPackage(state: any, validation: any, replay: any, { exportedAt = new Date().toISOString() }: any = {}) {
  const payload: any = {
    eventBrief: clone(state.brief),
    acceptedPlan: clone(state.plan),
    proposalBranches: clone(state.branches),
    comments: clone(state.comments.filter((comment: any) => comment.decisionRelevant)),
    validation: clone(validation),
    activityLedger: clone(state.ledger),
    commandReceipts: clone(state.receipts),
    replay: clone(replay),
    scenarios: clone(state.scenarios ?? []),
    scenarioRuns: clone(state.scenarioRuns ?? []),
    emergency: { plan: clone(state.plan.emergencyPlan ?? null), reviews: clone(state.plan.emergencyReviews ?? []), evidence: clone(validation.emergencyEvidence) },
  };
  const payloadFingerprint = stableFingerprint("audit", payload);
  return {
    manifest: {
      format: "venuemind-audit",
      schemaVersion: 1,
      planId: state.plan.id,
      planVersion: state.plan.version,
      geometryFingerprint: state.plan.spatial.fingerprint,
      ledgerHeadHash: replay.ledgerHeadHash,
      payloadFingerprint,
      emergencyEvidenceFingerprint: validation.emergencyEvidence.evidenceFingerprint,
      emergencyReviewIds: (state.plan.emergencyReviews ?? []).map((review: any) => review.id),
      createdAt: exportedAt,
    },
    ...payload,
  };
}

export function createPlanExport(format: any, { state, plan, validation, replay, exportedAt = new Date().toISOString(), jsonPayload = null, textPayload = null }: any) {
  const basename = `${slug(plan.event.name)}-v${slug(plan.version)}`;
  if (format === "svg") return { format, filename: `${basename}.svg`, mimeType: "image/svg+xml", encoding: "utf8", content: createLayeredSvg(plan, validation, { comments: state.comments, exportedAt }) };
  if (format === "csv" || format === "csv-objects") return { format, filename: `${basename}-objects.csv`, mimeType: "text/csv;charset=utf-8", encoding: "utf8", content: createObjectScheduleCsv(plan) };
  if (format === "csv-inventory") return { format, filename: `${basename}-inventory.csv`, mimeType: "text/csv;charset=utf-8", encoding: "utf8", content: createInventoryScheduleCsv(plan, validation) };
  if (format === "csv-staffing") return { format, filename: `${basename}-staffing.csv`, mimeType: "text/csv;charset=utf-8", encoding: "utf8", content: createStaffingScheduleCsv(plan) };
  if (format === "svg-post-map") return { format, filename: `${basename}-staff-posts.svg`, mimeType: "image/svg+xml", encoding: "utf8", content: createStaffingPostMapSvg(plan, analyzeStaffingOperations(plan)) };
  if (format === "csv-production") return { format, filename: `${basename}-production.csv`, mimeType: "text/csv;charset=utf-8", encoding: "utf8", content: createProductionScheduleCsv(plan) };
  if (format === "svg-production") return { format, filename: `${basename}-production.svg`, mimeType: "image/svg+xml", encoding: "utf8", content: createProductionMapSvg(plan, analyzeProductionPlan(plan)) };
  if (format === "csv-catering-stations") return { format, filename: `${basename}-catering-stations.csv`, mimeType: "text/csv;charset=utf-8", encoding: "utf8", content: createServiceStationScheduleCsv(plan) };
  if (format === "csv-replenishment") return { format, filename: `${basename}-replenishment.csv`, mimeType: "text/csv;charset=utf-8", encoding: "utf8", content: createReplenishmentScheduleCsv(plan) };
  if (format === "pdf") return { format, filename: `${basename}.pdf`, mimeType: "application/pdf", encoding: "base64", content: base64(createPlanPdf(plan, validation, { exportedAt })) };
  if (format === "pdf-emergency") return { format, filename: `${basename}-emergency.pdf`, mimeType: "application/pdf", encoding: "base64", content: base64(createEmergencyPlanPdf(plan, validation.emergencyEvidence, { exportedAt })) };
  if (format === "audit") return { format, filename: `${basename}.audit.json`, mimeType: "application/json", encoding: "utf8", content: `${JSON.stringify(createPortableAuditPackage(state, validation, replay, { exportedAt }), null, 2)}\n` };
  if (format === "json") return { format, filename: `${basename}.json`, mimeType: "application/json", encoding: "utf8", content: jsonPayload };
  if (format === "text") return { format, filename: `${basename}.txt`, mimeType: "text/plain;charset=utf-8", encoding: "utf8", content: textPayload };
  throw new Error(`Unsupported export format: ${format}`);
}
