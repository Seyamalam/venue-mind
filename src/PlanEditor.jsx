import { useEffect, useMemo, useRef, useState } from "react";
import { materializeSpatialPlan } from "./domain/spatial-analysis.js";
import { venueTemplateCatalog } from "./domain/venue-templates.js";
import { AnnotationPins } from "./CommentsPanel.jsx";

const clone = (value) => JSON.parse(JSON.stringify(value));
const layers = ["architecture", "furniture", "access", "production", "catering", "safety", "annotations"];
const layerCodes = { architecture: "ARC", furniture: "FUR", access: "ACC", production: "PRO", catering: "CAT", safety: "SAF", annotations: "ANN" };
const palette = { architecture: "#52534f", furniture: "#7c7466", access: "#26855c", production: "#6845e8", catering: "#c27b25", safety: "#b44a42", annotations: "#72736f" };
const uid = (prefix = "obj") => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;

const centerOf = (footprint) => {
  if (footprint.center) return footprint.center;
  if (footprint.start) return { x: (footprint.start.x + footprint.end.x) / 2, y: (footprint.start.y + footprint.end.y) / 2 };
  return { x: footprint.points.reduce((sum, point) => sum + point.x, 0) / footprint.points.length, y: footprint.points.reduce((sum, point) => sum + point.y, 0) / footprint.points.length };
};

const moveFootprint = (footprint, delta) => {
  const point = ({ x, y }) => ({ x: x + delta.x, y: y + delta.y });
  if (footprint.center) return { ...footprint, center: point(footprint.center) };
  if (footprint.start) return { ...footprint, start: point(footprint.start), end: point(footprint.end) };
  return { ...footprint, points: footprint.points.map(point) };
};

const rectanglePoints = (footprint, maxY) => {
  const radians = (-footprint.rotationDegrees * Math.PI) / 180;
  return [[-footprint.width / 2, -footprint.depth / 2], [footprint.width / 2, -footprint.depth / 2], [footprint.width / 2, footprint.depth / 2], [-footprint.width / 2, footprint.depth / 2]].map(([dx, dy]) => {
    const x = footprint.center.x + dx * Math.cos(radians) - dy * Math.sin(radians);
    const y = footprint.center.y + dx * Math.sin(radians) + dy * Math.cos(radians);
    return `${x},${maxY - y}`;
  }).join(" ");
};

function ObjectShape({ object, maxY, selected, onPointerDown, draftDelta }) {
  const footprint = draftDelta ? moveFootprint(object.footprint, draftDelta) : object.footprint;
  const common = { className: `editor-object is-${object.layer} ${selected ? "is-selected" : ""}`, fill: palette[object.layer] ?? palette.annotations, onPointerDown, "data-object-id": object.id };
  if (footprint.kind === "rectangle") return <polygon {...common} points={rectanglePoints(footprint, maxY)} />;
  if (footprint.kind === "circle") return <circle {...common} cx={footprint.center.x} cy={maxY - footprint.center.y} r={footprint.radius} />;
  if (footprint.kind === "line") return <line {...common} x1={footprint.start.x} y1={maxY - footprint.start.y} x2={footprint.end.x} y2={maxY - footprint.end.y} style={{ strokeWidth: Math.max(0.12, footprint.width), stroke: palette[object.layer] }} />;
  return <polygon {...common} points={footprint.points.map((point) => `${point.x},${maxY - point.y}`).join(" ")} />;
}

function InspectorNumberInput({ field, value, onCommit }) {
  const commit = (event) => {
    const next = Number(event.currentTarget.value);
    if (!Number.isFinite(next) || Math.abs(next - value) < 1e-9) {
      event.currentTarget.value = String(value);
      return;
    }
    onCommit(field, next);
  };
  return <input key={`${field}-${value}`} type="number" step="0.05" defaultValue={value} onBlur={commit} onKeyDown={(event) => {
    if (event.key === "Enter") event.currentTarget.blur();
    if (event.key === "Escape") { event.currentTarget.value = String(value); event.currentTarget.blur(); }
  }} />;
}

export function PlanEditor({ plan, proposal, validation, comments = [], selectedCommentId = null, onSelectComment = () => {}, onEdit, onMeasure, layoutPresets = [] }) {
  const candidate = useMemo(() => materializeSpatialPlan(plan, proposal?.changes ?? [], { allowLockConflicts: true }), [plan, proposal]);
  const boundary = candidate.spatial.roomBoundary.outer;
  const bounds = useMemo(() => ({ minX: Math.min(...boundary.map((point) => point.x)), maxX: Math.max(...boundary.map((point) => point.x)), minY: Math.min(...boundary.map((point) => point.y)), maxY: Math.max(...boundary.map((point) => point.y)) }), [boundary]);
  const fullView = useMemo(() => ({ x: bounds.minX - 1, y: -1, width: bounds.maxX - bounds.minX + 2, height: bounds.maxY - bounds.minY + 2 }), [bounds]);
  const [view, setView] = useState(fullView);
  const [tool, setTool] = useState("select");
  const [selected, setSelected] = useState([]);
  const [grid, setGrid] = useState(true);
  const [snap, setSnap] = useState({ enabled: true, sizeM: 0.25, toleranceM: 0.08 });
  const [layerState, setLayerState] = useState(() => Object.fromEntries(layers.map((layer) => [layer, { visible: true, locked: false }])));
  const [drag, setDrag] = useState(null);
  const [box, setBox] = useState(null);
  const [clipboard, setClipboard] = useState([]);
  const [shortcuts, setShortcuts] = useState(false);
  const [panels, setPanels] = useState({ layers: false, inspector: true, library: false });
  const [placeTemplate, setPlaceTemplate] = useState(null);
  const svgRef = useRef(null);
  const selectedObjects = useMemo(() => candidate.objects.filter((object) => selected.includes(object.id)), [candidate.objects, selected]);
  const focused = selectedObjects.at(-1) ?? null;
  const measurement = useMemo(() => selected.length > 1 ? onMeasure(selected) : null, [onMeasure, selected]);
  const selectedChecks = useMemo(() => focused ? validation.checks.filter((check) => check.evidence?.affectedObjectIds?.includes(focused.id)) : [], [focused, validation.checks]);

  useEffect(() => setView(fullView), [fullView]);
  useEffect(() => setSelected((current) => current.filter((id) => candidate.objects.some((object) => object.id === id))), [candidate.objects]);

  const pointFromEvent = (event) => {
    const rect = svgRef.current.getBoundingClientRect();
    const displayX = view.x + ((event.clientX - rect.left) / rect.width) * view.width;
    const displayY = view.y + ((event.clientY - rect.top) / rect.height) * view.height;
    return { x: displayX, y: bounds.maxY - displayY };
  };

  const editable = (object) => !layerState[object.layer]?.locked && !(object.locks ?? []).some((lock) => lock.active);
  const apply = (edit) => onEdit({ ...edit, snap });
  const snapValue = (value) => { if (!snap.enabled) return value; const target = Math.round(value / snap.sizeM) * snap.sizeM; return Math.abs(value - target) <= snap.toleranceM ? target : value; };
  const createAt = (point, kind) => {
    point = { x: snapValue(point.x), y: snapValue(point.y) };
    const id = uid("obj");
    if (kind === "zone") return apply({ operation: "create-zone", object: { id, label: "Zone", kind: "restricted_zone", layer: "safety", elevationM: 0, locked: false, locks: [], footprint: { kind: "polygon", points: [{ x: point.x - 1.5, y: point.y - 1 }, { x: point.x + 1.5, y: point.y - 1 }, { x: point.x + 1.5, y: point.y + 1 }, { x: point.x - 1.5, y: point.y + 1 }], rotationDegrees: 0 } } });
    const inventory = kind === "inventory" ? placeTemplate : null;
    const categoryKinds = { furniture: "table", seating: "chair", barriers: "barrier", staging: "stage", av: "av_desk", catering: "refreshment", signage: "signage", queue: "queue" };
    const categoryLayers = { furniture: "furniture", seating: "furniture", barriers: "safety", staging: "production", av: "production", catering: "catering", signage: "annotations", queue: "access" };
    const specs = inventory ? { label: inventory.name, width: inventory.dimensions.widthM ?? inventory.dimensions.diameterM ?? 1, depth: inventory.dimensions.depthM ?? inventory.dimensions.diameterM ?? 1, kind: categoryKinds[inventory.category], layer: categoryLayers[inventory.category] } : kind === "chair" ? { label: "Chair", width: 0.5, depth: 0.55, kind, layer: "furniture" } : { label: "Table", width: 1.8, depth: 0.8, kind, layer: "furniture" };
    apply({ operation: "place", object: { id, kind: specs.kind, label: specs.label, layer: specs.layer, elevationM: 0, locked: false, locks: [], placement: { collisionMode: "solid" }, ...(inventory ? { templateRef: { kind: "inventory-item-template", templateId: inventory.id, version: inventory.version }, inventoryCount: 1, specification: { dimensions: inventory.dimensions, weightKg: inventory.weightKg, power: inventory.power, capacity: inventory.capacity, cost: inventory.cost } } : {}), footprint: { kind: "rectangle", center: point, width: specs.width, depth: specs.depth, rotationDegrees: 0 } } });
    setSelected([id]);
  };

  const finishPointer = (event) => {
    if (!drag) return;
    const point = pointFromEvent(event);
    if (drag.kind === "move") {
      const delta = { x: point.x - drag.start.x, y: point.y - drag.start.y };
      if (Math.hypot(delta.x, delta.y) > 0.01) apply({ operation: "move", objectIds: drag.objectIds, delta });
    }
    if (drag.kind === "pan") setView((current) => ({ ...current, x: drag.view.x - ((event.clientX - drag.client.x) / svgRef.current.clientWidth) * drag.view.width, y: drag.view.y - ((event.clientY - drag.client.y) / svgRef.current.clientHeight) * drag.view.height }));
    if (drag.kind === "box") {
      const x1 = Math.min(drag.start.x, point.x); const x2 = Math.max(drag.start.x, point.x); const y1 = Math.min(drag.start.y, point.y); const y2 = Math.max(drag.start.y, point.y);
      const ids = candidate.objects.filter((object) => layerState[object.layer]?.visible && (() => { const center = centerOf(object.footprint); return center.x >= x1 && center.x <= x2 && center.y >= y1 && center.y <= y2; })()).map((object) => object.id);
      setSelected(drag.additive ? [...new Set([...selected, ...ids])] : ids);
    }
    if (drag.kind === "vertex") {
      const points = drag.points.map((item, index) => index === drag.index ? point : item);
      apply({ operation: "edit-zone-vertices", objectIds: [drag.objectId], points });
    }
    setDrag(null); setBox(null);
  };

  const handleBackgroundDown = (event) => {
    if (event.target !== svgRef.current && !event.target.classList.contains("editor-room")) return;
    const point = pointFromEvent(event);
    if (["table", "chair", "zone", "inventory"].includes(tool)) { createAt(point, tool); setTool("select"); return; }
    if (tool === "pan" || event.button === 1) setDrag({ kind: "pan", client: { x: event.clientX, y: event.clientY }, view });
    else { if (!event.shiftKey) setSelected([]); setDrag({ kind: "box", start: point, additive: event.shiftKey }); setBox({ start: point, end: point }); }
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleObjectDown = (event, object) => {
    event.stopPropagation();
    if (tool === "pan") return handleBackgroundDown(event);
    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    const next = additive ? (selected.includes(object.id) ? selected.filter((id) => id !== object.id) : [...selected, object.id]) : (selected.includes(object.id) ? selected : [object.id]);
    setSelected(next);
    if (editable(object)) setDrag({ kind: "move", start: pointFromEvent(event), objectIds: next.filter((id) => editable(candidate.objects.find((item) => item.id === id))) });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event) => {
    if (!drag) return;
    const point = pointFromEvent(event);
    if (drag.kind === "move") setDrag((current) => ({ ...current, delta: { x: point.x - current.start.x, y: point.y - current.start.y } }));
    if (drag.kind === "pan") setView({ ...drag.view, x: drag.view.x - ((event.clientX - drag.client.x) / svgRef.current.clientWidth) * drag.view.width, y: drag.view.y - ((event.clientY - drag.client.y) / svgRef.current.clientHeight) * drag.view.height });
    if (drag.kind === "box") setBox({ start: drag.start, end: point });
    if (drag.kind === "vertex") setDrag((current) => ({ ...current, point }));
  };

  const duplicate = () => selectedObjects.length && apply({ operation: "duplicate", objectIds: selected, newObjectIds: selected.map(() => uid("obj")), offset: { x: 0.5, y: 0.5 } });
  const remove = () => selectedObjects.length && apply({ operation: "delete", objectIds: selected });
  const copy = async () => { const data = clone(selectedObjects); setClipboard(data); await navigator.clipboard?.writeText(JSON.stringify({ format: "venuemind-objects", objects: data })); };
  const paste = async () => {
    let objects = clipboard;
    try { const parsed = JSON.parse(await navigator.clipboard?.readText()); if (parsed.format === "venuemind-objects") objects = parsed.objects; } catch { /* local clipboard remains available */ }
    if (objects.length) apply({ operation: "paste", objects, newObjectIds: objects.map(() => uid("obj")), offset: { x: 0.5, y: 0.5 } });
  };

  useEffect(() => {
    const keydown = (event) => {
      if (["INPUT", "SELECT", "TEXTAREA"].includes(event.target.tagName)) return;
      if (event.key === "?" || (event.shiftKey && event.key === "/")) { setShortcuts((open) => !open); event.preventDefault(); }
      else if (event.key.toLowerCase() === "v") setTool("select");
      else if (event.key.toLowerCase() === "h") setTool("pan");
      else if (event.key.toLowerCase() === "g") setGrid((value) => !value);
      else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d") { duplicate(); event.preventDefault(); }
      else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c") { copy(); event.preventDefault(); }
      else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v") { paste(); event.preventDefault(); }
      else if (["Delete", "Backspace"].includes(event.key)) { remove(); event.preventDefault(); }
      else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) && selected.length) {
        const step = event.shiftKey ? 1 : snap.sizeM;
        apply({ operation: "move", objectIds: selected, delta: { x: event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0, y: event.key === "ArrowDown" ? -step : event.key === "ArrowUp" ? step : 0 } }); event.preventDefault();
      }
    };
    window.addEventListener("keydown", keydown); return () => window.removeEventListener("keydown", keydown);
  }, [clipboard, selected, selectedObjects, snap.sizeM]);

  const updateFocused = (field, value) => {
    if (!focused) return;
    const footprint = focused.footprint;
    if (["x", "y"].includes(field)) { const center = centerOf(footprint); apply({ operation: "move", objectIds: [focused.id], delta: { x: field === "x" ? value - center.x : 0, y: field === "y" ? value - center.y : 0 } }); }
    else if (field === "rotationDegrees") apply({ operation: "rotate", objectIds: [focused.id], rotationDegrees: value });
    else apply({ operation: "resize", objectIds: [focused.id], dimensions: { [field]: value } });
  };

  return <div className="plan-editor">
    <div className="editor-toolbar" role="toolbar" aria-label="Plan editing tools">
      {[['select', 'V'], ['pan', 'H'], ['table', 'TBL'], ['chair', 'CHR'], ['zone', 'ZON']].map(([id, label]) => <button type="button" key={id} className={tool === id ? "is-active" : ""} onClick={() => setTool(id)}>{label}</button>)}<button type="button" className={panels.library ? "is-active" : ""} onClick={() => setPanels((value) => ({ ...value, library: !value.library }))}>LIB</button>
      <i />
      <button type="button" onClick={duplicate} disabled={!selected.length}>DUP</button><button type="button" onClick={remove} disabled={!selected.length}>DEL</button>
      <button type="button" onClick={() => selected.length > 1 && apply({ operation: "align", objectIds: selected, axis: "x" })} disabled={selected.length < 2}>ALN</button><button type="button" onClick={() => selected.length > 2 && apply({ operation: "distribute", objectIds: selected, axis: "x" })} disabled={selected.length < 3}>DST</button>
      <button type="button" onClick={() => selected.length > 1 && apply({ operation: "group", objectIds: selected, groupId: uid("group") })} disabled={selected.length < 2}>GRP</button><button type="button" onClick={() => selected.length && apply({ operation: "ungroup", objectIds: selected })} disabled={!selected.length}>UN</button>
      <i />
      <button type="button" className={grid ? "is-active" : ""} onClick={() => setGrid((value) => !value)}>GRID</button><button type="button" className={snap.enabled ? "is-active" : ""} onClick={() => setSnap((value) => ({ ...value, enabled: !value.enabled }))}>SNAP</button>
      <button type="button" onClick={() => setPanels((value) => ({ ...value, layers: !value.layers }))}>LYR</button><button type="button" onClick={() => setShortcuts(true)}>?</button>
    </div>

    <svg ref={svgRef} className={`editor-svg tool-${tool}`} viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`} onPointerDown={handleBackgroundDown} onPointerMove={handlePointerMove} onPointerUp={finishPointer} onPointerCancel={finishPointer} onWheel={(event) => { event.preventDefault(); const factor = event.deltaY > 0 ? 1.12 : 0.88; setView((current) => ({ ...current, width: Math.min(fullView.width * 4, Math.max(fullView.width * 0.25, current.width * factor)), height: Math.min(fullView.height * 4, Math.max(fullView.height * 0.25, current.height * factor)) })); }}>
      <defs><pattern id="editor-grid" width={snap.sizeM} height={snap.sizeM} patternUnits="userSpaceOnUse"><path d={`M ${snap.sizeM} 0 L 0 0 0 ${snap.sizeM}`} /></pattern></defs>
      <polygon className="editor-room" points={boundary.map((point) => `${point.x},${bounds.maxY - point.y}`).join(" ")} />
      {grid && <polygon className="editor-grid" fill="url(#editor-grid)" points={boundary.map((point) => `${point.x},${bounds.maxY - point.y}`).join(" ")} />}
      {grid && <g className="editor-guides"><line x1={(bounds.minX + bounds.maxX) / 2} y1={0} x2={(bounds.minX + bounds.maxX) / 2} y2={bounds.maxY - bounds.minY} /><line x1={bounds.minX} y1={(bounds.maxY - bounds.minY) / 2} x2={bounds.maxX} y2={(bounds.maxY - bounds.minY) / 2} /></g>}
      {candidate.objects.filter((object) => layerState[object.layer]?.visible).map((object) => <ObjectShape key={object.id} object={object} maxY={bounds.maxY} selected={selected.includes(object.id)} draftDelta={drag?.kind === "move" && drag.objectIds.includes(object.id) ? drag.delta : null} onPointerDown={(event) => handleObjectDown(event, object)} />)}
      <AnnotationPins comments={comments} planVersion={plan.version} maxY={bounds.maxY} selectedCommentId={selectedCommentId} onSelect={onSelectComment} />
      {box && <rect className="selection-box" x={Math.min(box.start.x, box.end.x)} y={bounds.maxY - Math.max(box.start.y, box.end.y)} width={Math.abs(box.end.x - box.start.x)} height={Math.abs(box.end.y - box.start.y)} />}
      {focused?.kind === "restricted_zone" && focused.footprint.kind === "polygon" && focused.footprint.points.map((point, index) => { const shown = drag?.kind === "vertex" && drag.objectId === focused.id && drag.index === index ? drag.point ?? point : point; return <circle className="zone-vertex" key={index} cx={shown.x} cy={bounds.maxY - shown.y} r=".14" onPointerDown={(event) => { event.stopPropagation(); setDrag({ kind: "vertex", objectId: focused.id, index, points: clone(focused.footprint.points), point }); event.currentTarget.setPointerCapture(event.pointerId); }} />; })}
    </svg>

    <div className="editor-status"><span>{tool.toUpperCase()}</span><b>{selected.length} SEL</b><span>{Math.round((fullView.width / view.width) * 100)}%</span>{measurement?.distances?.[0] && <strong>{measurement.distances[0].distanceM} m</strong>}</div>

    {panels.layers && <aside className="layer-panel"><header><b>LAYERS</b><button type="button" onClick={() => setPanels((value) => ({ ...value, layers: false }))}>×</button></header>{layers.map((layer) => <div key={layer}><button type="button" className={layerState[layer].visible ? "is-on" : ""} onClick={() => setLayerState((current) => ({ ...current, [layer]: { ...current[layer], visible: !current[layer].visible } }))}>●</button><span>{layerCodes[layer]}</span><button type="button" className={layerState[layer].locked ? "is-locked" : ""} onClick={() => setLayerState((current) => ({ ...current, [layer]: { ...current[layer], locked: !current[layer].locked } }))}>L</button></div>)}<footer><label><span>GRID</span><input type="number" min="0.05" step="0.05" value={snap.sizeM} onChange={(event) => setSnap((value) => ({ ...value, sizeM: Math.max(.05, Number(event.target.value)) }))} /></label><label><span>TOL</span><input type="number" min="0" step="0.01" value={snap.toleranceM} onChange={(event) => setSnap((value) => ({ ...value, toleranceM: Math.max(0, Number(event.target.value)) }))} /></label></footer></aside>}

    {panels.library && <aside className="object-library"><header><b>LIBRARY</b><button type="button" onClick={() => setPanels((value) => ({ ...value, library: false }))}>×</button></header>{candidate.objects.length === 0 && layoutPresets.map((preset) => <button className="is-layout" type="button" key={preset.id} onClick={() => { apply({ operation: "apply-layout", roomBoundary: preset.roomBoundary, objects: clone(preset.objects) }); setPanels((value) => ({ ...value, library: false })); }}><span>LAY</span><strong>{preset.label}</strong><small>{preset.objects.length}</small></button>)}{venueTemplateCatalog.inventoryTemplates.map((item) => <button type="button" key={item.id} onClick={() => { setPlaceTemplate(item); setTool("inventory"); setPanels((value) => ({ ...value, library: false })); }}><span>{item.category.slice(0,3).toUpperCase()}</span><strong>{item.name}</strong><small>{item.availability.total - item.availability.unavailable}</small></button>)}</aside>}

    {focused && panels.inspector && <aside className="object-inspector"><header><span>{focused.kind.toUpperCase().replaceAll("_", " ")}</span><button type="button" onClick={() => setSelected([])}>×</button></header><strong>{focused.label}</strong><code>{focused.id}</code><div className="inspector-fields">{[["x", centerOf(focused.footprint).x], ["y", centerOf(focused.footprint).y], ...(focused.footprint.width ? [["width", focused.footprint.width]] : []), ...(focused.footprint.depth ? [["depth", focused.footprint.depth]] : []), ...(focused.footprint.radius ? [["radius", focused.footprint.radius]] : []), ...("rotationDegrees" in focused.footprint ? [["rotationDegrees", focused.footprint.rotationDegrees]] : [])].map(([field, value]) => <label key={field}><span>{field === "rotationDegrees" ? "R°" : field.toUpperCase()}</span><InspectorNumberInput field={field} value={value} onCommit={updateFocused} /></label>)}</div><div className="inspector-evidence"><span>LOCKS <b>{(focused.locks ?? []).filter((lock) => lock.active).length}</b></span><span>CHECKS <b>{selectedChecks.length}</b></span>{selectedChecks.slice(0, 3).map((check) => <em className={`is-${check.status}`} key={check.id}>{check.label.toUpperCase()} · {check.status.toUpperCase()}</em>)}</div></aside>}

    {shortcuts && <aside className="shortcut-panel"><header><b>SHORTCUTS</b><button type="button" onClick={() => setShortcuts(false)}>×</button></header>{[["V", "SELECT"], ["H", "PAN"], ["G", "GRID"], ["⌘D", "DUP"], ["⌘C", "COPY"], ["⌘V", "PASTE"], ["DEL", "DELETE"], ["⇧↑", "MOVE 1m"], ["?", "SHORTCUTS"]].map(([key, action]) => <span key={key}><kbd>{key}</kbd><b>{action}</b></span>)}</aside>}
  </div>;
}
