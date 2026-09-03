import {
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent,
} from "react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Toggle } from "../components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
import { materializeSpatialPlan } from "./domain/spatial-analysis";
import { createVenueObjectSpatialIndex } from "./domain/spatial-index";
import { venueTemplateCatalog } from "./domain/venue-templates";
import { AnnotationPins } from "./AnnotationPins";
import type { ValidationResult } from "./domain/constraint-engine";
import type { EditingCommand } from "./domain/editing-commands";
import type {
  Footprint,
  Point,
  RoomBoundary,
  SpatialLayer,
  VenueObject,
  VenuePlan,
  VenueProposal,
} from "./domain/geometry";
import type { VenueComment } from "./domain/comments";
import { describeVenueObject, nextRovingIndex, validationAnnouncement } from "./accessibility/studio-accessibility";

const clone = <T,>(value: T): T => structuredClone(value);
const layers = [
  "architecture",
  "furniture",
  "access",
  "production",
  "catering",
  "safety",
  "annotations",
] as const satisfies readonly SpatialLayer[];
const layerCodes: Record<SpatialLayer, string> = {
  architecture: "ARC",
  furniture: "FUR",
  access: "ACC",
  production: "PRO",
  catering: "CAT",
  safety: "SAF",
  annotations: "ANN",
};
const palette: Record<SpatialLayer, string> = {
  architecture: "#52534f",
  furniture: "#7c7466",
  access: "#26855c",
  production: "#6845e8",
  catering: "#c27b25",
  safety: "#b44a42",
  annotations: "#72736f",
};
const uid = (prefix = "obj") =>
  `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;

const centerOf = (footprint: Footprint): Point => {
  if (footprint.kind === "rectangle" || footprint.kind === "circle") return footprint.center;
  if (footprint.kind === "line")
    return { x: (footprint.start.x + footprint.end.x) / 2, y: (footprint.start.y + footprint.end.y) / 2 };
  return {
    x: footprint.points.reduce((sum, point) => sum + point.x, 0) / footprint.points.length,
    y: footprint.points.reduce((sum, point) => sum + point.y, 0) / footprint.points.length,
  };
};
const fixedCoordinate = (value: number): string => Number(value.toFixed(2)).toString();

const moveFootprint = (footprint: Footprint, delta: Point): Footprint => {
  const point = ({ x, y }: { x: number; y: number }) => ({ x: x + delta.x, y: y + delta.y });
  if (footprint.kind === "rectangle" || footprint.kind === "circle")
    return { ...footprint, center: point(footprint.center) };
  if (footprint.kind === "line") return { ...footprint, start: point(footprint.start), end: point(footprint.end) };
  return { ...footprint, points: footprint.points.map(point) };
};

const rectanglePoints = (footprint: Extract<Footprint, { kind: "rectangle" }>, maxY: number) => {
  const radians = (-footprint.rotationDegrees * Math.PI) / 180;
  const corners: Array<readonly [number, number]> = [
    [-footprint.width / 2, -footprint.depth / 2],
    [footprint.width / 2, -footprint.depth / 2],
    [footprint.width / 2, footprint.depth / 2],
    [-footprint.width / 2, footprint.depth / 2],
  ];
  return corners
    .map(([dx, dy]) => {
      const x = footprint.center.x + dx * Math.cos(radians) - dy * Math.sin(radians);
      const y = footprint.center.y + dx * Math.sin(radians) + dy * Math.cos(radians);
      return `${x},${maxY - y}`;
    })
    .join(" ");
};

function ObjectShape({
  object,
  maxY,
  selected,
  onPointerDown,
  draftDelta,
  active,
  label,
  onFocus,
  onKeyDown,
}: {
  object: VenueObject;
  maxY: number;
  selected: boolean;
  onPointerDown: (event: PointerEvent<SVGElement>) => void;
  draftDelta?: Point | null;
  active: boolean;
  label: string;
  onFocus: () => void;
  onKeyDown: (event: ReactKeyboardEvent<SVGElement>) => void;
}) {
  const footprint = draftDelta ? moveFootprint(object.footprint, draftDelta) : object.footprint;
  const layer = object.layer ?? "annotations";
  const common = {
    className: `editor-object is-${layer} ${selected ? "is-selected" : ""}`,
    fill: palette[layer],
    onPointerDown,
    onFocus,
    onKeyDown,
    role: "button",
    tabIndex: active ? 0 : -1,
    "aria-label": label,
    "aria-pressed": selected,
    "data-object-id": object.id,
  };
  if (footprint.kind === "rectangle") return <polygon {...common} points={rectanglePoints(footprint, maxY)} />;
  if (footprint.kind === "circle")
    return <circle {...common} cx={footprint.center.x} cy={maxY - footprint.center.y} r={footprint.radius} />;
  if (footprint.kind === "line")
    return (
      <line
        {...common}
        x1={footprint.start.x}
        y1={maxY - footprint.start.y}
        x2={footprint.end.x}
        y2={maxY - footprint.end.y}
        style={{ strokeWidth: Math.max(0.12, footprint.width), stroke: palette[layer] }}
      />
    );
  return <polygon {...common} points={footprint.points.map((point) => `${point.x},${maxY - point.y}`).join(" ")} />;
}

function InspectorNumberInput({
  field,
  value,
  onCommit,
}: {
  field: string;
  value: number;
  onCommit: (field: string, value: number) => void;
}) {
  const commit = (event: FocusEvent<HTMLInputElement>) => {
    const next = Number(event.currentTarget.value);
    if (!Number.isFinite(next) || Math.abs(next - value) < 1e-9) {
      event.currentTarget.value = String(value);
      return;
    }
    onCommit(field, next);
  };
  return (
    <Input
      key={`${field}-${value}`}
      type="number"
      step="0.05"
      defaultValue={value}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          event.currentTarget.value = String(value);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

type PlanEditorProps = {
  plan: VenuePlan;
  proposal?: VenueProposal | null;
  validation: ValidationResult;
  comments?: VenueComment[];
  selectedCommentId?: string | null;
  onSelectComment?: (commentId: string) => void;
  onEdit: (edit: EditingCommand) => unknown;
  onMeasure: (objectIds: string[]) => {
    objectIds: string[];
    centers: Array<{ objectId: string; point: Point }>;
    distances: Array<{ fromObjectId: string; toObjectId: string; distanceM: number }>;
  } | null;
  layoutPresets?: Array<{ id: string; label: string; roomBoundary: RoomBoundary; objects: VenueObject[] }>;
};

type ViewBox = { x: number; y: number; width: number; height: number };
type ViewState = { key: string; value: ViewBox };
type DragState =
  | { kind: "move"; start: Point; objectIds: string[]; delta?: Point }
  | { kind: "pan"; client: Point; view: ViewBox }
  | { kind: "box"; start: Point; additive: boolean }
  | { kind: "vertex"; objectId: string; index: number; points: Point[]; point?: Point };
type SelectionBox = { start: Point; end: Point };
type InventoryTemplate = (typeof venueTemplateCatalog.inventoryTemplates)[number];

const isJsonObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const clipboardObjectIds = (value: unknown): string[] | null => {
  if (!isJsonObject(value) || value["format"] !== "venuemind-objects") return null;
  const objectIds = value["objectIds"];
  return Array.isArray(objectIds) && objectIds.every((item): item is string => typeof item === "string")
    ? objectIds
    : null;
};

export function PlanEditor({
  plan,
  proposal,
  validation,
  comments = [],
  selectedCommentId = null,
  onSelectComment = () => {},
  onEdit,
  onMeasure,
  layoutPresets = [],
}: PlanEditorProps) {
  const candidate = useMemo(
    () => materializeSpatialPlan(plan, proposal?.changes ?? [], { allowLockConflicts: true }),
    [plan, proposal],
  );
  const boundary = candidate.spatial.roomBoundary.outer;
  const planObjects = candidate.objects;
  const validationChecks = validation.checks;
  const bounds = useMemo(
    () => ({
      minX: Math.min(...boundary.map((point) => point.x)),
      maxX: Math.max(...boundary.map((point) => point.x)),
      minY: Math.min(...boundary.map((point) => point.y)),
      maxY: Math.max(...boundary.map((point) => point.y)),
    }),
    [boundary],
  );
  const fullView = useMemo(
    () => ({ x: bounds.minX - 1, y: -1, width: bounds.maxX - bounds.minX + 2, height: bounds.maxY - bounds.minY + 2 }),
    [bounds],
  );
  const viewKey = `${bounds.minX}:${bounds.maxX}:${bounds.minY}:${bounds.maxY}`;
  const [viewState, setViewState] = useState<ViewState>(() => ({ key: viewKey, value: fullView }));
  const view = viewState.key === viewKey ? viewState.value : fullView;
  const objectIndex = useMemo(() => createVenueObjectSpatialIndex(planObjects), [planObjects]);
  const visiblePlanObjects = useMemo(() => {
    const margin = Math.max(view.width, view.height) * 0.03;
    return objectIndex.queryBounds({
      minX: view.x - margin,
      maxX: view.x + view.width + margin,
      minY: bounds.maxY - view.y - view.height - margin,
      maxY: bounds.maxY - view.y + margin,
    });
  }, [bounds.maxY, objectIndex, view.height, view.width, view.x, view.y]);
  const setView = (next: ViewBox | ((current: ViewBox) => ViewBox)) => {
    const value = typeof next === "function" ? next(view) : next;
    setViewState({ key: viewKey, value });
  };
  const [tool, setTool] = useState("select");
  const [selectedState, setSelected] = useState<string[]>([]);
  const [grid, setGrid] = useState(true);
  const [snap, setSnap] = useState({ enabled: true, sizeM: 0.25, toleranceM: 0.08 });
  const [layerState, setLayerState] = useState<Record<SpatialLayer, { visible: boolean; locked: boolean }>>(() => ({
    architecture: { visible: true, locked: false },
    furniture: { visible: true, locked: false },
    access: { visible: true, locked: false },
    production: { visible: true, locked: false },
    catering: { visible: true, locked: false },
    safety: { visible: true, locked: false },
    annotations: { visible: true, locked: false },
  }));
  const [drag, setDrag] = useState<DragState | null>(null);
  const [box, setBox] = useState<SelectionBox | null>(null);
  const [clipboard, setClipboard] = useState<VenueObject[]>([]);
  const [shortcuts, setShortcuts] = useState(false);
  const [panels, setPanels] = useState({ layers: false, inspector: true, library: false });
  const [objectListOpen, setObjectListOpen] = useState(false);
  const [activeObjectId, setActiveObjectId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [placeTemplate, setPlaceTemplate] = useState<InventoryTemplate | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const planObjectIds = useMemo(() => new Set(planObjects.map((object) => object.id)), [planObjects]);
  const selected = useMemo(() => selectedState.filter((id) => planObjectIds.has(id)), [planObjectIds, selectedState]);
  const selectedObjects = useMemo(
    () => planObjects.filter((object) => selected.includes(object.id)),
    [planObjects, selected],
  );
  const focused = selectedObjects.at(-1) ?? null;
  const measurement = useMemo(() => (selected.length > 1 ? onMeasure(selected) : null), [onMeasure, selected]);
  const selectedChecks = useMemo(
    () => (focused ? validationChecks.filter((check) => check.evidence?.affectedObjectIds?.includes(focused.id)) : []),
    [focused, validationChecks],
  );
  const focusedPolygonPoints = focused?.footprint.kind === "polygon" ? focused.footprint.points : null;
  const accessibleObjects = useMemo(
    () => planObjects.filter((object) => layerState[object.layer ?? "annotations"].visible),
    [layerState, planObjects],
  );
  const visibleObjects = useMemo(
    () => visiblePlanObjects.filter((object) => layerState[object.layer ?? "annotations"].visible),
    [layerState, visiblePlanObjects],
  );
  const effectiveActiveObjectId = visibleObjects.some((object) => object.id === activeObjectId)
    ? activeObjectId
    : (visibleObjects[0]?.id ?? null);
  const validationMessage = validationAnnouncement(validation);

  const announce = (message: string) => {
    setAnnouncement("");
    window.requestAnimationFrame(() => setAnnouncement(message));
  };

  const selectObject = (object: VenueObject, additive = false) => {
    const next = additive
      ? selected.includes(object.id)
        ? selected.filter((id) => id !== object.id)
        : [...selected, object.id]
      : [object.id];
    setSelected(next);
    setActiveObjectId(object.id);
    announce(`${object.label ?? object.id}; ${next.includes(object.id) ? "selected" : "not selected"}`);
  };

  const focusObject = (direction: "first" | "last" | "next" | "previous") => {
    const currentIndex = visibleObjects.findIndex((object) => object.id === effectiveActiveObjectId);
    const index = nextRovingIndex(visibleObjects.length, currentIndex, direction);
    const object = visibleObjects[index];
    if (!object) return;
    setActiveObjectId(object.id);
    window.requestAnimationFrame(() => {
      const targets = svgRef.current?.querySelectorAll<SVGElement>("[data-object-id]");
      targets?.[index]?.focus();
    });
    announce(describeVenueObject(object));
  };

  const handleObjectKeyDown = (event: ReactKeyboardEvent<SVGElement>, object: VenueObject) => {
    if (event.key === "Home" || event.key === "End") {
      focusObject(event.key === "Home" ? "first" : "last");
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      if (event.ctrlKey || event.metaKey) {
        if (!editable(object)) {
          announce(`${object.label ?? object.id}; locked`);
        } else {
          const step = event.shiftKey ? 1 : snap.sizeM;
          apply({
            operation: "move",
            objectIds: selected.includes(object.id) ? selected : [object.id],
            delta: {
              x: event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0,
              y: event.key === "ArrowDown" ? -step : event.key === "ArrowUp" ? step : 0,
            },
          });
          announce(`${object.label ?? object.id}; moved ${step} metres`);
        }
      } else {
        focusObject(event.key === "ArrowLeft" || event.key === "ArrowUp" ? "previous" : "next");
      }
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      selectObject(object, event.shiftKey);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (["Delete", "Backspace"].includes(event.key) && editable(object)) {
      apply({ operation: "delete", objectIds: selected.includes(object.id) ? selected : [object.id] });
      announce(`${object.label ?? object.id}; deleted`);
      event.preventDefault();
      event.stopPropagation();
    }
  };

  const pointFromEvent = (event: PointerEvent<SVGElement>) => {
    const svg = svgRef.current;
    if (!svg) throw new Error("PLAN_EDITOR_NOT_MOUNTED");
    const rect = svg.getBoundingClientRect();
    const displayX = view.x + ((event.clientX - rect.left) / rect.width) * view.width;
    const displayY = view.y + ((event.clientY - rect.top) / rect.height) * view.height;
    return { x: displayX, y: bounds.maxY - displayY };
  };

  const editable = (object: VenueObject) =>
    !layerState[object.layer ?? "annotations"].locked && !(object.locks ?? []).some((lock) => lock.active);
  const apply = (edit: EditingCommand) => onEdit({ ...edit, snap });
  const snapValue = (value: number) => {
    if (!snap.enabled) return value;
    const target = Math.round(value / snap.sizeM) * snap.sizeM;
    return Math.abs(value - target) <= snap.toleranceM ? target : value;
  };
  const createAt = (point: { x: number; y: number }, kind: string) => {
    point = { x: snapValue(point.x), y: snapValue(point.y) };
    const id = uid("obj");
    if (kind === "zone") {
      apply({
        operation: "create-zone",
        object: {
          id,
          label: "Zone",
          kind: "restricted_zone",
          layer: "safety",
          elevationM: 0,
          locked: false,
          locks: [],
          footprint: {
            kind: "polygon",
            points: [
              { x: point.x - 1.5, y: point.y - 1 },
              { x: point.x + 1.5, y: point.y - 1 },
              { x: point.x + 1.5, y: point.y + 1 },
              { x: point.x - 1.5, y: point.y + 1 },
            ],
            rotationDegrees: 0,
          },
        },
      });
      return;
    }
    const inventory = kind === "inventory" ? placeTemplate : null;
    const categoryKinds: Record<string, string> = {
      furniture: "table",
      seating: "chair",
      barriers: "barrier",
      staging: "stage",
      av: "av_desk",
      catering: "refreshment",
      signage: "signage",
      queue: "queue",
    };
    const categoryLayers: Record<string, SpatialLayer> = {
      furniture: "furniture",
      seating: "furniture",
      barriers: "safety",
      staging: "production",
      av: "production",
      catering: "catering",
      signage: "annotations",
      queue: "access",
    };
    const specs: { label: string; width: number; depth: number; kind: string; layer: SpatialLayer } = inventory
      ? {
          label: inventory.name,
          width: inventory.dimensions["widthM"] ?? inventory.dimensions["diameterM"] ?? 1,
          depth: inventory.dimensions["depthM"] ?? inventory.dimensions["diameterM"] ?? 1,
          kind: categoryKinds[inventory.category] ?? "inventory",
          layer: categoryLayers[inventory.category] ?? "annotations",
        }
      : kind === "chair"
        ? { label: "Chair", width: 0.5, depth: 0.55, kind, layer: "furniture" }
        : { label: "Table", width: 1.8, depth: 0.8, kind, layer: "furniture" };
    apply({
      operation: "place",
      object: {
        id,
        kind: specs.kind,
        label: specs.label,
        layer: specs.layer,
        elevationM: 0,
        locked: false,
        locks: [],
        placement: { collisionMode: "solid" },
        ...(inventory
          ? {
              templateRef: { kind: "inventory-item-template", templateId: inventory.id, version: inventory.version },
              inventoryCount: 1,
              specification: {
                dimensions: inventory.dimensions,
                weightKg: inventory.weightKg,
                power: inventory.power,
                capacity: inventory.capacity,
                cost: inventory.cost,
              },
            }
          : {}),
        footprint: { kind: "rectangle", center: point, width: specs.width, depth: specs.depth, rotationDegrees: 0 },
      },
    });
    setSelected([id]);
  };

  const finishPointer = (event: PointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    const point = pointFromEvent(event);
    if (drag.kind === "move") {
      const delta = { x: point.x - drag.start.x, y: point.y - drag.start.y };
      if (Math.hypot(delta.x, delta.y) > 0.01) apply({ operation: "move", objectIds: drag.objectIds, delta });
    }
    if (drag.kind === "pan") {
      const svg = svgRef.current;
      if (svg)
        setView((current) => ({
          ...current,
          x: drag.view.x - ((event.clientX - drag.client.x) / svg.clientWidth) * drag.view.width,
          y: drag.view.y - ((event.clientY - drag.client.y) / svg.clientHeight) * drag.view.height,
        }));
    }
    if (drag.kind === "box") {
      const x1 = Math.min(drag.start.x, point.x);
      const x2 = Math.max(drag.start.x, point.x);
      const y1 = Math.min(drag.start.y, point.y);
      const y2 = Math.max(drag.start.y, point.y);
      const ids = planObjects
        .filter(
          (object) =>
            layerState[object.layer ?? "annotations"].visible &&
            (() => {
              const center = centerOf(object.footprint);
              return center.x >= x1 && center.x <= x2 && center.y >= y1 && center.y <= y2;
            })(),
        )
        .map((object) => object.id);
      setSelected(drag.additive ? [...new Set([...selected, ...ids])] : ids);
    }
    if (drag.kind === "vertex") {
      const points = drag.points.map((item, index) => (index === drag.index ? point : item));
      apply({ operation: "edit-zone-vertices", objectIds: [drag.objectId], points });
    }
    setDrag(null);
    setBox(null);
  };

  const handleBackgroundDown = (event: PointerEvent<SVGElement>) => {
    if (
      event.target !== svgRef.current &&
      !(event.target instanceof SVGElement && event.target.classList.contains("editor-room"))
    )
      return;
    const point = pointFromEvent(event);
    if (["table", "chair", "zone", "inventory"].includes(tool)) {
      createAt(point, tool);
      setTool("select");
      return;
    }
    if (tool === "pan" || event.button === 1)
      setDrag({ kind: "pan", client: { x: event.clientX, y: event.clientY }, view });
    else {
      if (!event.shiftKey) setSelected([]);
      setDrag({ kind: "box", start: point, additive: event.shiftKey });
      setBox({ start: point, end: point });
    }
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleObjectDown = (event: PointerEvent<SVGElement>, object: VenueObject) => {
    event.stopPropagation();
    if (tool === "pan") {
      handleBackgroundDown(event);
      return;
    }
    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    const next = additive
      ? selected.includes(object.id)
        ? selected.filter((id) => id !== object.id)
        : [...selected, object.id]
      : selected.includes(object.id)
        ? selected
        : [object.id];
    setSelected(next);
    setActiveObjectId(object.id);
    if (editable(object))
      setDrag({
        kind: "move",
        start: pointFromEvent(event),
        objectIds: next.filter((id) => {
          const item = planObjects.find((candidateObject) => candidateObject.id === id);
          return item ? editable(item) : false;
        }),
      });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    const point = pointFromEvent(event);
    if (drag.kind === "move") setDrag({ ...drag, delta: { x: point.x - drag.start.x, y: point.y - drag.start.y } });
    if (drag.kind === "pan") {
      const svg = svgRef.current;
      if (svg)
        setView({
          ...drag.view,
          x: drag.view.x - ((event.clientX - drag.client.x) / svg.clientWidth) * drag.view.width,
          y: drag.view.y - ((event.clientY - drag.client.y) / svg.clientHeight) * drag.view.height,
        });
    }
    if (drag.kind === "box") setBox({ start: drag.start, end: point });
    if (drag.kind === "vertex") setDrag({ ...drag, point });
  };

  const duplicate = () =>
    selectedObjects.length &&
    apply({
      operation: "duplicate",
      objectIds: selected,
      newObjectIds: selected.map(() => uid("obj")),
      offset: { x: 0.5, y: 0.5 },
    });
  const remove = () => selectedObjects.length && apply({ operation: "delete", objectIds: selected });
  const copy = async () => {
    const data = clone(selectedObjects);
    setClipboard(data);
    await navigator.clipboard?.writeText(
      JSON.stringify({ format: "venuemind-objects", objectIds: data.map((object) => object.id) }),
    );
  };
  const paste = async () => {
    let objects = clipboard;
    try {
      const parsed: unknown = JSON.parse(await navigator.clipboard?.readText());
      const objectIds = clipboardObjectIds(parsed);
      if (objectIds) objects = planObjects.filter((object) => objectIds.includes(object.id));
    } catch {
      /* local clipboard remains available */
    }
    if (objects.length)
      apply({ operation: "paste", objects, newObjectIds: objects.map(() => uid("obj")), offset: { x: 0.5, y: 0.5 } });
  };

  const onKeyDown = useEffectEvent((event: globalThis.KeyboardEvent) => {
    if (event.target instanceof HTMLElement && ["INPUT", "SELECT", "TEXTAREA"].includes(event.target.tagName)) return;
    if (event.key === "?" || (event.shiftKey && event.key === "/")) {
      setShortcuts((open) => !open);
      event.preventDefault();
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d") {
      duplicate();
      event.preventDefault();
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c") {
      void copy();
      event.preventDefault();
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v") {
      void paste();
      event.preventDefault();
    } else if (event.key.toLowerCase() === "v") setTool("select");
    else if (event.key.toLowerCase() === "h") setTool("pan");
    else if (event.key.toLowerCase() === "g") setGrid((value) => !value);
    else if (["Delete", "Backspace"].includes(event.key)) {
      remove();
      event.preventDefault();
    } else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) && selected.length) {
      const step = event.shiftKey ? 1 : snap.sizeM;
      apply({
        operation: "move",
        objectIds: selected,
        delta: {
          x: event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0,
          y: event.key === "ArrowDown" ? -step : event.key === "ArrowUp" ? step : 0,
        },
      });
      event.preventDefault();
    }
  });

  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const updateFocused = (field: string, value: number) => {
    if (!focused) return;
    const footprint = focused.footprint;
    if (["x", "y"].includes(field)) {
      const center = centerOf(footprint);
      apply({
        operation: "move",
        objectIds: [focused.id],
        delta: { x: field === "x" ? value - center.x : 0, y: field === "y" ? value - center.y : 0 },
      });
    } else if (field === "rotationDegrees")
      apply({ operation: "rotate", objectIds: [focused.id], rotationDegrees: value });
    else apply({ operation: "resize", objectIds: [focused.id], dimensions: { [field]: value } });
  };

  return (
    <div className="plan-editor">
      <div className="editor-toolbar" role="toolbar" aria-label="Plan editing tools">
        <ToggleGroup
          className="editor-tool-group"
          type="single"
          value={tool}
          onValueChange={(value) => {
            if (value) setTool(value);
          }}
          spacing={3}
          aria-label="Placement tool"
        >
          {(
            [
              ["select", "V"],
              ["pan", "H"],
              ["table", "TBL"],
              ["chair", "CHR"],
              ["zone", "ZON"],
            ] satisfies Array<[string, string]>
          ).map(([id, label]) => (
            <ToggleGroupItem value={id} key={id} aria-label={`${id} tool`} aria-keyshortcuts={id === "select" ? "V" : id === "pan" ? "H" : undefined}>
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Toggle
          pressed={panels.library}
          onPressedChange={(pressed) => {
            setPanels((value) => ({ ...value, library: pressed }));
          }}
        >
          LIB
        </Toggle>
        <Toggle pressed={objectListOpen} onPressedChange={setObjectListOpen} aria-label="Toggle object list">
          OBJ
        </Toggle>
        <i />
        <Button variant="ghost" size="xs" type="button" onClick={duplicate} disabled={!selected.length}>
          DUP
        </Button>
        <Button variant="ghost" size="xs" type="button" onClick={remove} disabled={!selected.length}>
          DEL
        </Button>
        <Button
          variant="ghost"
          size="xs"
          type="button"
          onClick={() => selected.length > 1 && apply({ operation: "align", objectIds: selected, axis: "x" })}
          disabled={selected.length < 2}
        >
          ALN
        </Button>
        <Button
          variant="ghost"
          size="xs"
          type="button"
          onClick={() => selected.length > 2 && apply({ operation: "distribute", objectIds: selected, axis: "x" })}
          disabled={selected.length < 3}
        >
          DST
        </Button>
        <Button
          variant="ghost"
          size="xs"
          type="button"
          onClick={() =>
            selected.length > 1 && apply({ operation: "group", objectIds: selected, groupId: uid("group") })
          }
          disabled={selected.length < 2}
        >
          GRP
        </Button>
        <Button
          variant="ghost"
          size="xs"
          type="button"
          onClick={() => selected.length && apply({ operation: "ungroup", objectIds: selected })}
          disabled={!selected.length}
        >
          UN
        </Button>
        <i />
        <Toggle pressed={grid} onPressedChange={setGrid}>
          GRID
        </Toggle>
        <Toggle
          pressed={snap.enabled}
          onPressedChange={(pressed) => {
            setSnap((value) => ({ ...value, enabled: pressed }));
          }}
        >
          SNAP
        </Toggle>
        <Toggle
          pressed={panels.layers}
          onPressedChange={(pressed) => {
            setPanels((value) => ({ ...value, layers: pressed }));
          }}
        >
          LYR
        </Toggle>
        <Button
          variant="ghost"
          size="xs"
          type="button"
          onClick={() => {
            setShortcuts(true);
          }}
          aria-label="Open keyboard shortcuts"
          aria-keyshortcuts="?"
        >
          ?
        </Button>
      </div>

      <svg
        ref={svgRef}
        className={`editor-svg tool-${tool}`}
        role="group"
        tabIndex={0}
        aria-labelledby="plan-editor-canvas-title"
        aria-describedby="plan-editor-canvas-help"
        onFocus={(event) => {
          if (event.target === event.currentTarget) announce("Plan canvas; use arrow keys to enter object navigation");
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown", "Home", "End"].includes(event.key)) {
            const direction =
              event.key === "Home"
                ? "first"
                : event.key === "End"
                  ? "last"
                  : event.key === "ArrowLeft" || event.key === "ArrowUp"
                    ? "previous"
                    : "next";
            focusObject(direction);
            event.preventDefault();
            event.stopPropagation();
          }
        }}
        viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
        onPointerDown={handleBackgroundDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
        onWheel={(event) => {
          event.preventDefault();
          const factor = event.deltaY > 0 ? 1.12 : 0.88;
          setView((current) => ({
            ...current,
            width: Math.min(fullView.width * 4, Math.max(fullView.width * 0.25, current.width * factor)),
            height: Math.min(fullView.height * 4, Math.max(fullView.height * 0.25, current.height * factor)),
          }));
        }}
      >
        <title id="plan-editor-canvas-title">Plan canvas</title>
        <desc id="plan-editor-canvas-help">
          Arrow keys move between objects. Enter selects. Control plus arrow moves selected objects. Delete removes editable objects.
        </desc>
        <defs>
          <pattern id="editor-grid" width={snap.sizeM} height={snap.sizeM} patternUnits="userSpaceOnUse">
            <path d={`M ${snap.sizeM} 0 L 0 0 0 ${snap.sizeM}`} />
          </pattern>
        </defs>
        <polygon
          className="editor-room"
          points={boundary.map((point) => `${point.x},${bounds.maxY - point.y}`).join(" ")}
        />
        {grid && (
          <polygon
            className="editor-grid"
            fill="url(#editor-grid)"
            points={boundary.map((point) => `${point.x},${bounds.maxY - point.y}`).join(" ")}
          />
        )}
        {grid && (
          <g className="editor-guides">
            <line
              x1={(bounds.minX + bounds.maxX) / 2}
              y1={0}
              x2={(bounds.minX + bounds.maxX) / 2}
              y2={bounds.maxY - bounds.minY}
            />
            <line
              x1={bounds.minX}
              y1={(bounds.maxY - bounds.minY) / 2}
              x2={bounds.maxX}
              y2={(bounds.maxY - bounds.minY) / 2}
            />
          </g>
        )}
        {visibleObjects.map((object) => {
          const draftDelta = drag?.kind === "move" && drag.objectIds.includes(object.id) ? drag.delta : null;
          return (
            <ObjectShape
              key={object.id}
              object={object}
              maxY={bounds.maxY}
              selected={selected.includes(object.id)}
              active={object.id === effectiveActiveObjectId}
              label={describeVenueObject(object)}
              {...(draftDelta === undefined ? {} : { draftDelta })}
              onPointerDown={(event) => {
                handleObjectDown(event, object);
              }}
              onFocus={() => {
                setActiveObjectId(object.id);
                announce(describeVenueObject(object));
              }}
              onKeyDown={(event) => handleObjectKeyDown(event, object)}
            />
          );
        })}
        <AnnotationPins
          comments={comments}
          planVersion={plan.version}
          maxY={bounds.maxY}
          selectedCommentId={selectedCommentId}
          onSelect={onSelectComment}
        />
        {box && (
          <rect
            className="selection-box"
            x={Math.min(box.start.x, box.end.x)}
            y={bounds.maxY - Math.max(box.start.y, box.end.y)}
            width={Math.abs(box.end.x - box.start.x)}
            height={Math.abs(box.end.y - box.start.y)}
          />
        )}
        {focused &&
          focusedPolygonPoints?.map((point, index) => {
            const shown =
              drag?.kind === "vertex" && drag.objectId === focused.id && drag.index === index
                ? (drag.point ?? point)
                : point;
            return (
              <circle
                className="zone-vertex"
                key={index}
                cx={shown.x}
                cy={bounds.maxY - shown.y}
                r=".14"
                onPointerDown={(event) => {
                  event.stopPropagation();
                  setDrag({ kind: "vertex", objectId: focused.id, index, points: clone(focusedPolygonPoints), point });
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
              />
            );
          })}
      </svg>

      <div className="editor-status" role="status" aria-live="polite">
        <span>{tool.toUpperCase()}</span>
        <b>{selected.length} SEL</b>
        <strong className={`is-${validation.status}`}>{validation.status.toUpperCase()}</strong>
        <span>{Math.round((fullView.width / view.width) * 100)}%</span>
        {measurement?.distances?.[0] && <strong>{measurement.distances[0].distanceM} m</strong>}
      </div>

      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
      <div className="sr-only" role={validation.status === "fail" ? "alert" : "status"}>
        {validationMessage}
      </div>

      {objectListOpen && (
        <aside className="accessible-object-panel" aria-label="Plan objects">
          <header>
            <b>OBJECTS</b>
            <span>{accessibleObjects.length}</span>
            <Button
              variant="ghost"
              size="icon-xs"
              type="button"
              onClick={() => setObjectListOpen(false)}
              aria-label="Close object list"
            >
              ×
            </Button>
          </header>
          <ol>
            {accessibleObjects.map((object) => {
              const center = centerOf(object.footprint);
              const objectChecks = validationChecks.filter((check) => check.evidence?.affectedObjectIds?.includes(object.id));
              const objectStatus = objectChecks.some((check) => check.status === "fail")
                ? "FAIL"
                : objectChecks.some((check) => check.status === "warning")
                  ? "WARN"
                  : "PASS";
              return (
                <li key={object.id}>
                  <Button
                    variant="ghost"
                    type="button"
                    className={selected.includes(object.id) ? "is-selected" : ""}
                    aria-pressed={selected.includes(object.id)}
                    onClick={() => selectObject(object)}
                  >
                    <span>
                      <strong>{object.label ?? object.id}</strong>
                      <small>{object.kind.toUpperCase().replaceAll("_", " ")}</small>
                    </span>
                    <code>{fixedCoordinate(center.x)} · {fixedCoordinate(center.y)}</code>
                    <b className={`is-${objectStatus.toLowerCase()}`}>{objectStatus}</b>
                  </Button>
                </li>
              );
            })}
          </ol>
        </aside>
      )}

      {panels.layers && (
        <aside className="layer-panel">
          <header>
            <b>LAYERS</b>
            <Button
              variant="ghost"
              size="icon-xs"
              type="button"
              onClick={() => {
                setPanels((value) => ({ ...value, layers: false }));
              }}
              aria-label="Close layers"
            >
              ×
            </Button>
          </header>
          {layers.map((layer) => (
            <div key={layer}>
              <Toggle
                size="sm"
                pressed={layerState[layer].visible}
                onPressedChange={(pressed) => {
                  setLayerState((current) => ({ ...current, [layer]: { ...current[layer], visible: pressed } }));
                }}
                aria-label={`${layer} visibility`}
              >
                ●
              </Toggle>
              <span>{layerCodes[layer]}</span>
              <Toggle
                size="sm"
                pressed={layerState[layer].locked}
                onPressedChange={(pressed) => {
                  setLayerState((current) => ({ ...current, [layer]: { ...current[layer], locked: pressed } }));
                }}
                aria-label={`${layer} lock`}
              >
                L
              </Toggle>
            </div>
          ))}
          <footer>
            <label>
              <span>GRID</span>
              <Input
                type="number"
                min="0.05"
                step="0.05"
                value={snap.sizeM}
                onChange={(event) => {
                  setSnap((value) => ({ ...value, sizeM: Math.max(0.05, Number(event.target.value)) }));
                }}
              />
            </label>
            <label>
              <span>TOL</span>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={snap.toleranceM}
                onChange={(event) => {
                  setSnap((value) => ({ ...value, toleranceM: Math.max(0, Number(event.target.value)) }));
                }}
              />
            </label>
          </footer>
        </aside>
      )}

      {panels.library && (
        <aside className="object-library">
          <header>
            <b>LIBRARY</b>
            <Button
              variant="ghost"
              size="icon-xs"
              type="button"
              onClick={() => {
                setPanels((value) => ({ ...value, library: false }));
              }}
              aria-label="Close library"
            >
              ×
            </Button>
          </header>
          {planObjects.length === 0 &&
            layoutPresets.map((preset) => (
              <Button
                className="is-layout"
                variant="outline"
                type="button"
                key={preset.id}
                onClick={() => {
                  apply({
                    operation: "apply-layout",
                    roomBoundary: preset.roomBoundary,
                    objects: clone(preset.objects),
                  });
                  setPanels((value) => ({ ...value, library: false }));
                }}
              >
                <span>LAY</span>
                <strong>{preset.label}</strong>
                <small>{preset.objects.length}</small>
              </Button>
            ))}
          {venueTemplateCatalog.inventoryTemplates.map((item) => (
            <Button
              variant="outline"
              type="button"
              key={item.id}
              onClick={() => {
                setPlaceTemplate(item);
                setTool("inventory");
                setPanels((value) => ({ ...value, library: false }));
              }}
            >
              <span>{item.category.slice(0, 3).toUpperCase()}</span>
              <strong>{item.name}</strong>
              <small>{item.availability.total - item.availability.unavailable}</small>
            </Button>
          ))}
        </aside>
      )}

      {focused && panels.inspector && (
        <aside className="object-inspector">
          <header>
            <span>{focused.kind.toUpperCase().replaceAll("_", " ")}</span>
            <Button
              variant="ghost"
              size="icon-xs"
              type="button"
              onClick={() => {
                setSelected([]);
              }}
              aria-label="Close inspector"
            >
              ×
            </Button>
          </header>
          <strong>{focused.label}</strong>
          <code>{focused.id}</code>
          <div className="inspector-fields">
            {(
              [
                ["x", centerOf(focused.footprint).x],
                ["y", centerOf(focused.footprint).y],
                ...("width" in focused.footprint ? [["width", focused.footprint.width] as const] : []),
                ...(focused.footprint.kind === "rectangle" ? [["depth", focused.footprint.depth] as const] : []),
                ...(focused.footprint.kind === "circle" ? [["radius", focused.footprint.radius] as const] : []),
                ...("rotationDegrees" in focused.footprint
                  ? [["rotationDegrees", focused.footprint.rotationDegrees] as const]
                  : []),
              ] satisfies Array<readonly [string, number]>
            ).map(([field, value]) => (
              <label key={field}>
                <span>{field === "rotationDegrees" ? "R°" : field.toUpperCase()}</span>
                <InspectorNumberInput field={field} value={value} onCommit={updateFocused} />
              </label>
            ))}
          </div>
          <div className="inspector-evidence">
            <span>
              LOCKS <b>{(focused.locks ?? []).filter((lock) => lock.active).length}</b>
            </span>
            <span>
              CHECKS <b>{selectedChecks.length}</b>
            </span>
            {selectedChecks.slice(0, 3).map((check) => (
              <em className={`is-${check.status}`} key={check.id}>
                {check.label.toUpperCase()} · {check.status.toUpperCase()}
              </em>
            ))}
          </div>
        </aside>
      )}

      {shortcuts && (
        <aside className="shortcut-panel">
          <header>
            <b>SHORTCUTS</b>
            <Button
              variant="ghost"
              size="icon-xs"
              type="button"
              onClick={() => {
                setShortcuts(false);
              }}
              aria-label="Close shortcuts"
            >
              ×
            </Button>
          </header>
          {[
            ["V", "SELECT"],
            ["H", "PAN"],
            ["G", "GRID"],
            ["⌘D", "DUP"],
            ["⌘C", "COPY"],
            ["⌘V", "PASTE"],
            ["DEL", "DELETE"],
            ["⇧↑", "MOVE 1m"],
            ["?", "SHORTCUTS"],
          ].map(([key, action]) => (
            <span key={key}>
              <kbd>{key}</kbd>
              <b>{action}</b>
            </span>
          ))}
        </aside>
      )}
    </div>
  );
}
