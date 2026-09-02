import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import Image from "next/image";
import Link from "next/link";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import {
  ArrowCounterClockwiseIcon as ArrowCounterClockwise,
  CaretDownIcon as CaretDown,
  CheckIcon as Check,
  ChatCircleIcon as ChatCircle,
  CircleNotchIcon as CircleNotch,
  ClockIcon as Clock,
  ColumnsIcon as Columns,
  DownloadSimpleIcon as DownloadSimple,
  EyeIcon as Eye,
  ForkKnifeIcon as ForkKnife,
  GitBranchIcon as GitBranch,
  ListBulletsIcon as ListBullets,
  MapPinIcon as MapPin,
  PersonSimpleIcon as PersonSimple,
  PresentationChartIcon as PresentationChart,
  SparkleIcon as Sparkle,
  UsersThreeIcon as UsersThree,
  WheelchairIcon as Wheelchair,
  XIcon as X,
} from "@phosphor-icons/react";
import { summitForwardPlan } from "./domain/summit-forward";
import { createEmptyVenuePlan } from "./domain/empty-project";
import { createVenuePlanner, validateVenueState } from "./domain/venue-planner";
import type { ProposalBranch, ScenarioDefinition, VenuePlanner } from "./domain/venue-planner";
import {
  normalizePlanGeometry,
  type Footprint,
  type LineFootprint,
  type VenueObject,
  type VenuePlanDocument,
} from "./domain/geometry";
import type { EventBrief, EventRequirement } from "./domain/event-brief";
import { detectLockConflicts } from "./domain/locks";
import type {
  AggregateOccupancySignal,
  EventDayRunbook,
  IncidentCategory,
  IncidentLocationInput,
  IncidentOwner,
  IncidentRegister,
  IncidentRelatedRef,
  IncidentSeverity,
  IncidentEscalationLevel,
  IncidentStatus,
  LiveOccupancyMonitor,
  OccupancyProjection,
  OccupancyMutationResult,
  OperationalIncident,
  IncidentMutationResult,
  RunbookEvidence,
  RunbookTaskStatus,
} from "./domain/operational-types";
import type { compareProposalBranches } from "./domain/proposal-comparison";
import type { detectProposalConflicts } from "./domain/proposal-conflicts";
import type { VenueComment } from "./domain/comments";
import { stableFingerprint, verifyActivityLedger } from "./domain/activity-ledger";
import { createRunbookCommandBus } from "./domain/runbook-command-bus";
import { deriveRunbookHandoff } from "./domain/event-day-runbook";
import { createOccupancyCommandBus } from "./domain/occupancy-command-bus";
import { createIncidentCommandBus } from "./domain/incident-command-bus";
import { createHumanPrincipal, createShortLivedAgentAuthorization } from "./domain/authorization";
import { venueError } from "./domain/errors";
import { createProjectStore } from "./persistence/project-store";
import type { ProjectStore } from "./persistence/project-store";
import type { LocalProjectRecord, ProjectConflict, ProjectRecordMetadata } from "./domain/project-types";
import { createRunbookStore } from "./persistence/runbook-store";
import type { RunbookOutboxCommand } from "./persistence/runbook-store";
import { createRunbookRemote } from "./persistence/runbook-remote";
import { synchronizeRunbook } from "./persistence/runbook-sync";
import { createOccupancyStore } from "./persistence/occupancy-store";
import type { OccupancyOutboxCommand } from "./persistence/occupancy-store";
import { createOccupancyRemote } from "./persistence/occupancy-remote";
import { synchronizeOccupancy } from "./persistence/occupancy-sync";
import { createIncidentStore } from "./persistence/incident-store";
import type { IncidentOutboxCommand } from "./persistence/incident-store";
import { createIncidentRemote } from "./persistence/incident-remote";
import { synchronizeIncidents } from "./persistence/incident-sync";
import { registerVenueTools } from "./webmcp/register-venue-tools";
import type { RegisterVenueToolOptions, ToolRegistrationLifecycle } from "./webmcp/register-venue-tools";
import type { WebMcpPlanner } from "./webmcp/tool-runtime";
import type { IncidentOperations, OccupancyOperations } from "./tools/venue-tool-service";
import {
  VENUE_TOOL_AUTHORIZATION_SCOPES,
  VENUE_TOOL_CONTRACT_VERSION,
  venueToolContracts,
  type VenueToolInput,
} from "./contracts/venue-contracts";
import { exportProjectPackage } from "./interchange/venue-package";
import { AnnotationPins } from "./AnnotationPins";
import { createCollaborationClient } from "./collaboration/collaboration-client";
import { SharingControls } from "./SharingControls";
import type { CollaborationEvent } from "./collaboration/collaboration-client";
import type { BranchView, LockView } from "./HistoryPanel";
import type { ReadyAccountSnapshot, ValueCallback, ValueOption } from "./ui-types";
import type { createAccountStore } from "./auth/account-store";
import type { EditingCommand } from "./domain/editing-commands";
import { browserNavigate, navigateInternalLink } from "./navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import { Input } from "../components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger } from "../components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "../components/ui/sheet";
import { Textarea } from "../components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
import "./styles.css";
import type { AddCommentInput, EditCommentInput } from "./CommentsPanel";
import type { OverlayView, ScenarioComparisonView } from "./ScenarioPanel";
import type { RunbookHandoffInput, RunbookHandoffView } from "./RunbookPanel";

const briefIcons: Record<string, PhosphorIcon> = {
  accessibility: Wheelchair,
  seating: UsersThree,
  production: PresentationChart,
  catering: ForkKnife,
  circulation: Columns,
  staffing: PersonSimple,
  security: MapPin,
  emergency: Clock,
};

const EXPORT_OPTIONS: ReadonlyArray<readonly [string, string, string]> = [
  ["package", "VM JSON", "Portable"],
  ["pdf", "PDF", "Print"],
  ["pdf-emergency", "EMERG PDF", "Safety"],
  ["svg", "SVG", "Layers"],
  ["csv-objects", "CSV OBJ", "Objects"],
  ["csv-inventory", "CSV INV", "Inventory"],
  ["csv-staffing", "CSV STAFF", "Posts"],
  ["svg-post-map", "POST MAP", "Staff"],
  ["csv-production", "CSV PROD", "Equipment"],
  ["svg-production", "PROD MAP", "AV"],
  ["csv-catering-stations", "CSV SERVICE", "Stations"],
  ["csv-replenishment", "CSV REPLEN", "Routes"],
  ["audit", "AUDIT", "Ledger"],
];

const LazyPlanEditor = lazy(() => import("./PlanEditor").then((module) => ({ default: module.PlanEditor })));
const loadCommentsPanel = () => import("./CommentsPanel").then((module) => ({ default: module.CommentsPanel }));
const LazyCommentsPanel = lazy(loadCommentsPanel);
const loadScenarioPanel = () => import("./ScenarioPanel").then((module) => ({ default: module.ScenarioPanel }));
const LazyScenarioPanel = lazy(loadScenarioPanel);
const loadHistoryPanel = () => import("./HistoryPanel").then((module) => ({ default: module.HistoryPanel }));
const LazyHistoryPanel = lazy(loadHistoryPanel);
const loadRunbookPanel = () => import("./RunbookPanel").then((module) => ({ default: module.RunbookPanel }));
const LazyRunbookPanel = lazy(loadRunbookPanel);
const loadOccupancyPanel = () => import("./OccupancyPanel").then((module) => ({ default: module.OccupancyPanel }));
const LazyOccupancyPanel = lazy(loadOccupancyPanel);
const loadIncidentPanel = () => import("./IncidentPanel").then((module) => ({ default: module.IncidentPanel }));
const LazyIncidentPanel = lazy(loadIncidentPanel);

const studioSessionId = `studio-session-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;
const uniqueToken = (): string => globalThis.crypto?.randomUUID?.() ?? `${performance.timeOrigin}-${performance.now()}`;
const commandMetadata = (type: string) => {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return {
    idempotencyKey: `${type}-${id}`,
    correlationId: `studio-${id}`,
    source: "studio",
    sessionId: studioSessionId,
  };
};

const projectRecordMetadataFor = (record: LocalProjectRecord): ProjectRecordMetadata => ({
  createdAt: record.createdAt,
  revision: record.revision ?? null,
  provenance: record.provenance ?? null,
  archivedAt: record.archivedAt ?? null,
  deletedAt: record.deletedAt ?? null,
  recoveryUntil: record.recoveryUntil ?? null,
  pinned: record.pinned ?? false,
  lastOpenedAt: record.lastOpenedAt ?? null,
});

type ToolRegistrationProps = {
  planner: VenuePlanner;
  projectStore: ProjectStore;
  projectId: string;
  organizationId: string;
  occupancyOperations: Partial<OccupancyOperations>;
  incidentOperations: Partial<IncidentOperations>;
  authorizationProvider: NonNullable<RegisterVenueToolOptions["authorizationProvider"]>;
  onLifecycle: (lifecycle: ToolRegistrationLifecycle) => void;
  navigate: (href: string) => void;
};

function ToolRegistration({
  planner,
  projectStore,
  projectId,
  organizationId,
  occupancyOperations,
  incidentOperations,
  authorizationProvider,
  onLifecycle,
  navigate,
}: ToolRegistrationProps) {
  const occupancyOperationsRef = useRef(occupancyOperations);
  const incidentOperationsRef = useRef(incidentOperations);
  useEffect(() => {
    occupancyOperationsRef.current = occupancyOperations;
  }, [occupancyOperations]);
  useEffect(() => {
    incidentOperationsRef.current = incidentOperations;
  }, [incidentOperations]);
  useEffect(() => {
    const modelContext = document.modelContext;
    if (typeof modelContext?.registerTool !== "function") {
      onLifecycle({
        state: "failed",
        registered: 0,
        total: venueToolContracts.length,
        errorCode: "WEBMCP_UNSUPPORTED",
      });
      return undefined;
    }

    const controller = new AbortController();
    const register = async () => {
      try {
        const projectOperations = {
          async listProjects() {
            const result = await projectStore.list();
            return {
              source: result.source,
              projects: result.projects
                .filter((record) => !record.deletedAt)
                .map((record) => ({
                  id: record.id,
                  name: record.name,
                  activePlanId: record.activePlanId,
                  schemaVersion: record.schemaVersion,
                  planVersion: record.snapshot.plan.version,
                  updatedAt: record.updatedAt,
                  active: record.id === projectId,
                })),
            };
          },
          async openProject(nextProjectId: string) {
            const result = await projectStore.load(nextProjectId);
            if (!result.record || result.record.deletedAt)
              throw venueError("PROJECT_NOT_FOUND", { projectId: nextProjectId });
            const opened = {
              status: nextProjectId === projectId ? "active" : "opening",
              project: {
                id: result.record.id,
                name: result.record.name,
                activePlanId: result.record.activePlanId,
                planVersion: result.record.snapshot.plan.version,
              },
            };
            if (nextProjectId !== projectId)
              window.setTimeout(() => navigate(`/studio/${encodeURIComponent(nextProjectId)}`), 0);
            return opened;
          },
        };
        const webMcpPlanner: WebMcpPlanner = {
          execute(command, context) {
            const authorization = context.authorization;
            return planner.execute(
              command,
              authorization
                ? {
                    authorization: {
                      principal: authorization.principal,
                      ...(authorization.projectId ? { projectId: authorization.projectId } : {}),
                    },
                  }
                : {},
            );
          },
          recordAuthorizationDenial(denial) {
            planner.recordAuthorizationDenial(denial);
          },
        };
        const forwardedOccupancyOperations: Partial<OccupancyOperations> = {
          inspectLiveOccupancy: (...args) =>
            occupancyOperationsRef.current.inspectLiveOccupancy?.(...args) ??
            Promise.reject(new Error("Occupancy tools are not ready")),
          ingestOccupancySignal: (...args) =>
            occupancyOperationsRef.current.ingestOccupancySignal?.(...args) ??
            Promise.reject(new Error("Occupancy tools are not ready")),
          refreshLiveOccupancy: (...args) =>
            occupancyOperationsRef.current.refreshLiveOccupancy?.(...args) ??
            Promise.reject(new Error("Occupancy tools are not ready")),
          exportLiveOccupancy: (...args) =>
            occupancyOperationsRef.current.exportLiveOccupancy?.(...args) ??
            Promise.reject(new Error("Occupancy tools are not ready")),
        };
        const forwardedIncidentOperations: Partial<IncidentOperations> = {
          inspectIncidents: (...args) =>
            incidentOperationsRef.current.inspectIncidents?.(...args) ??
            Promise.reject(new Error("Incident tools are not ready")),
          reportIncident: (...args) =>
            incidentOperationsRef.current.reportIncident?.(...args) ??
            Promise.reject(new Error("Incident tools are not ready")),
          exportIncidentRecord: (...args) =>
            incidentOperationsRef.current.exportIncidentRecord?.(...args) ??
            Promise.reject(new Error("Incident tools are not ready")),
        };
        await registerVenueTools(modelContext, webMcpPlanner, controller.signal, {
          projectId,
          organizationId,
          projectOperations,
          occupancyOperations: forwardedOccupancyOperations,
          incidentOperations: forwardedIncidentOperations,
          authorizationProvider,
          onLifecycle,
        });
      } catch {
        // registerVenueTools publishes the terminal failure state.
      }
    };

    void register();
    return () => controller.abort();
  }, [authorizationProvider, navigate, onLifecycle, organizationId, planner, projectId, projectStore]);
  return null;
}

function BriefItem({ icon: Icon, children }: { icon: PhosphorIcon; children: ReactNode }) {
  return (
    <li className="brief-item">
      <Icon size={16} aria-hidden="true" />
      <span>{children}</span>
    </li>
  );
}

type HeaderButtonProps = Omit<ComponentProps<typeof Button>, "aria-label"> & { ariaLabel: string };

function HeaderButton({ children, className = "", onClick, ariaLabel, ...props }: HeaderButtonProps) {
  return (
    <Button type="button" className={`header-button ${className}`} onClick={onClick} aria-label={ariaLabel} {...props}>
      {children}
    </Button>
  );
}

function AppSelect({
  label,
  value,
  onValueChange,
  options,
  className = "",
}: {
  label: string;
  value: string;
  onValueChange: ValueCallback;
  options: ValueOption[];
  className?: string;
}) {
  return (
    <Select
      key={`${label}:${options.map((option) => option.value).join("|")}`}
      value={value}
      onValueChange={onValueChange}
    >
      <SelectTrigger className={className} aria-label={label} data-current-value={value}>
        <span className="select-current-value">{options.find((option) => option.value === value)?.label}</span>
      </SelectTrigger>
      <SelectContent className="studio-select-content" position="popper" align="start" sideOffset={4}>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

type BranchComparison = ReturnType<typeof compareProposalBranches>;
type ComparisonMetric = BranchComparison["metricDeltas"][number];
type ProposalConflict = ReturnType<typeof detectProposalConflicts>["conflicts"][number];

const formatComparisonMetric = (metric: ComparisonMetric, value: number, signed = false) => {
  const normalized = metric.unit === "ratio" ? `${Math.round(value * 100)}%` : String(value);
  if (!signed || value === 0) return normalized;
  return value > 0 ? `+${normalized}` : normalized;
};

const footprintPoints = (footprint: Footprint, maxY = 20) => {
  if (footprint.kind === "polygon") return footprint.points.map((point) => `${point.x},${maxY - point.y}`).join(" ");
  if (footprint.kind !== "rectangle") return "";
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

function ComparisonShape({ object, maxY, className }: { object: VenueObject; maxY: number; className: string }) {
  const footprint = object.footprint;
  const common = { className, "data-object-id": object.id };
  if (footprint.kind === "rectangle" || footprint.kind === "polygon")
    return <polygon {...common} points={footprintPoints(footprint, maxY)} />;
  if (footprint.kind === "circle")
    return <circle {...common} cx={footprint.center.x} cy={maxY - footprint.center.y} r={footprint.radius} />;
  return (
    <line
      {...common}
      x1={footprint.start.x}
      y1={maxY - footprint.start.y}
      x2={footprint.end.x}
      y2={maxY - footprint.end.y}
      style={{ strokeWidth: Math.max(0.1, footprint.width) }}
    />
  );
}

export type AppProps = {
  projectId?: string;
  organizationId?: string;
  account?: ReadyAccountSnapshot;
  accountStore?: ReturnType<typeof createAccountStore>;
  navigate?: (href: string) => void;
};

const errorCode = (error: unknown, fallback: string): string =>
  typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : fallback;
const errorMessage = (error: unknown, fallback: string): string => (error instanceof Error ? error.message : fallback);
const isJsonObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isUnknownArray = (value: unknown): value is unknown[] => Array.isArray(value);
const unknownProperty = (value: unknown, field: string): unknown => (isJsonObject(value) ? value[field] : undefined);
const syncCommandResult = (result: object | Promise<object>): object => {
  if ("then" in result && typeof result.then === "function")
    throw new Error("Unexpected asynchronous planner command result");
  return result;
};
const resultString = (result: object | Promise<object>, field: string): string => {
  const value = unknownProperty(syncCommandResult(result), field);
  if (typeof value !== "string") throw new TypeError(`Planner command result is missing ${field}`);
  return value;
};
const resultNumber = (result: object | Promise<object>, field: string): number => {
  const value = unknownProperty(syncCommandResult(result), field);
  if (typeof value !== "number") throw new TypeError(`Planner command result is missing ${field}`);
  return value;
};
interface DownloadArtifact {
  readonly content: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly encoding?: "utf8" | "base64";
}
const downloadArtifact = (value: object): DownloadArtifact => {
  const content = unknownProperty(value, "content");
  const filename = unknownProperty(value, "filename");
  const mimeType = unknownProperty(value, "mimeType");
  const encoding = unknownProperty(value, "encoding");
  if (
    typeof content !== "string" ||
    typeof filename !== "string" ||
    typeof mimeType !== "string" ||
    (encoding !== undefined && encoding !== "utf8" && encoding !== "base64")
  )
    throw new TypeError("Invalid export artifact");
  return { content, filename, mimeType, ...(encoding ? { encoding } : {}) };
};
const isLiveOccupancyMonitor = (value: unknown): value is LiveOccupancyMonitor =>
  typeof value === "object" &&
  value !== null &&
  "schemaVersion" in value &&
  value.schemaVersion === 1 &&
  "id" in value &&
  typeof value.id === "string" &&
  "revision" in value &&
  typeof value.revision === "number" &&
  "feeds" in value &&
  Array.isArray(value.feeds);
const isOccupancyProjection = (value: unknown): value is OccupancyProjection =>
  typeof value === "object" &&
  value !== null &&
  "monitorId" in value &&
  typeof value.monitorId === "string" &&
  "scopes" in value &&
  Array.isArray(value.scopes) &&
  "sources" in value &&
  Array.isArray(value.sources);
const isOccupancyResult = (value: object): value is OccupancyMutationResult =>
  "monitor" in value &&
  isLiveOccupancyMonitor(value.monitor) &&
  "projection" in value &&
  isOccupancyProjection(value.projection) &&
  "receipt" in value &&
  typeof value.receipt === "object" &&
  value.receipt !== null &&
  "duplicate" in value &&
  typeof value.duplicate === "boolean";
const occupancyResult = (value: object): Pick<OccupancyMutationResult, "monitor" | "projection"> => {
  if (!("monitor" in value) || !("projection" in value)) throw new TypeError("Invalid occupancy command result");
  const monitor = unknownProperty(value, "monitor");
  const projection = unknownProperty(value, "projection");
  if (!isLiveOccupancyMonitor(monitor) || !isOccupancyProjection(projection))
    throw new TypeError("Invalid occupancy command result");
  return { monitor, projection };
};
const isIncidentRegister = (value: unknown): value is IncidentRegister =>
  typeof value === "object" &&
  value !== null &&
  "schemaVersion" in value &&
  value.schemaVersion === 1 &&
  "incidents" in value &&
  Array.isArray(value.incidents) &&
  "revision" in value &&
  typeof value.revision === "number";
const isOperationalIncident = (value: unknown): value is OperationalIncident =>
  typeof value === "object" &&
  value !== null &&
  "schemaVersion" in value &&
  value.schemaVersion === 1 &&
  "severity" in value &&
  typeof value.severity === "string" &&
  "revision" in value &&
  typeof value.revision === "number";
const isIncidentReceipt = (value: unknown): value is IncidentMutationResult["receipt"] =>
  typeof value === "object" &&
  value !== null &&
  "incidentId" in value &&
  typeof value.incidentId === "string" &&
  "incidentRevision" in value &&
  typeof value.incidentRevision === "number";
const incidentMutationResult = (value: object): IncidentMutationResult => {
  if (!("register" in value) || !("incident" in value) || !("receipt" in value) || !("duplicate" in value))
    throw new TypeError("Invalid incident mutation result");
  const register = unknownProperty(value, "register");
  const incident = unknownProperty(value, "incident");
  const receipt = unknownProperty(value, "receipt");
  const duplicate = unknownProperty(value, "duplicate");
  if (!isIncidentRegister(register)) throw new TypeError("Invalid incident register result");
  if (!isOperationalIncident(incident)) throw new TypeError("Invalid incident result");
  if (!isIncidentReceipt(receipt) || typeof duplicate !== "boolean")
    throw new TypeError("Invalid incident receipt result");
  return { register, incident, receipt, duplicate };
};
const isProjectConflict = (value: unknown): value is ProjectConflict =>
  typeof value === "object" &&
  value !== null &&
  "kind" in value &&
  typeof value.kind === "string" &&
  "local" in value &&
  typeof value.local === "object" &&
  value.local !== null &&
  "remote" in value &&
  typeof value.remote === "object" &&
  value.remote !== null;
const isFootprint = (value: unknown): value is Footprint => {
  if (typeof value !== "object" || value === null || !("kind" in value)) return false;
  if ((value.kind === "rectangle" || value.kind === "circle") && "center" in value)
    return (
      typeof value.center === "object" &&
      value.center !== null &&
      "x" in value.center &&
      typeof value.center.x === "number" &&
      "y" in value.center &&
      typeof value.center.y === "number"
    );
  if (value.kind === "line")
    return (
      "start" in value &&
      "end" in value &&
      typeof value.start === "object" &&
      value.start !== null &&
      typeof value.end === "object" &&
      value.end !== null
    );
  return value.kind === "polygon" && "points" in value && Array.isArray(value.points);
};
const isVenueObject = (value: unknown): value is VenueObject =>
  typeof value === "object" &&
  value !== null &&
  "id" in value &&
  typeof value.id === "string" &&
  "kind" in value &&
  typeof value.kind === "string" &&
  "footprint" in value &&
  isFootprint(value.footprint);
const inputString = (input: VenueToolInput, field: string): string | undefined => {
  const value = unknownProperty(input, field);
  return typeof value === "string" ? value : undefined;
};
const inputNumber = (input: VenueToolInput, field: string): number | undefined => {
  const value = unknownProperty(input, field);
  return typeof value === "number" ? value : undefined;
};
type StudioPresence = { sessionId: string; displayName: string; planVersion: string; focusedObjectId: string | null };
const decodePresence = (values: readonly unknown[]): StudioPresence[] =>
  values.flatMap((value) =>
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "sessionId" in value &&
    typeof value.sessionId === "string" &&
    "displayName" in value &&
    typeof value.displayName === "string" &&
    "planVersion" in value &&
    typeof value.planVersion === "string"
      ? [
          {
            sessionId: value.sessionId,
            displayName: value.displayName,
            planVersion: value.planVersion,
            focusedObjectId:
              "focusedObjectId" in value && typeof value.focusedObjectId === "string" ? value.focusedObjectId : null,
          },
        ]
      : [],
  );
const isOccupancyMode = (value: string): value is EventBrief["occupancyMode"] =>
  ["theater", "classroom", "banquet", "standing", "mixed", "custom"].includes(value);
const isRequirementPriority = (value: string): value is EventRequirement["priority"] =>
  ["critical", "high", "medium", "low"].includes(value);
const isRequirementStatus = (value: string): value is EventRequirement["status"] =>
  ["open", "confirmed", "satisfied", "waived"].includes(value);
const scenarioComparisonResult = (value: object): ScenarioComparisonView => {
  const stringProperty = (record: object, field: string): string => {
    const property = unknownProperty(record, field);
    if (typeof property !== "string") throw new TypeError(`Invalid simulation comparison ${field}`);
    return property;
  };
  const objectProperty = (record: object, field: string): object => {
    const property = unknownProperty(record, field);
    if (typeof property !== "object" || property === null)
      throw new TypeError(`Invalid simulation comparison ${field}`);
    return property;
  };
  const numberProperty = (record: object, field: string): number => {
    const property = unknownProperty(record, field);
    return typeof property === "number" ? property : 0;
  };
  const left = objectProperty(value, "left");
  const right = objectProperty(value, "right");
  const deltas = objectProperty(value, "deltas");
  return {
    id: stringProperty(value, "id"),
    scenarioId: stringProperty(value, "scenarioId"),
    engineVersion: stringProperty(value, "engineVersion"),
    left: {
      inputFingerprint: stringProperty(left, "inputFingerprint"),
      branchId: stringProperty(left, "branchId"),
      planVersion: stringProperty(left, "planVersion"),
    },
    right: {
      inputFingerprint: stringProperty(right, "inputFingerprint"),
      branchId: stringProperty(right, "branchId"),
      planVersion: stringProperty(right, "planVersion"),
    },
    deltas: {
      totalClearanceSeconds: numberProperty(deltas, "totalClearanceSeconds"),
      p95ClearanceSeconds: numberProperty(deltas, "p95ClearanceSeconds"),
      worstBottleneckDurationSeconds: numberProperty(deltas, "worstBottleneckDurationSeconds"),
      affectedOccupancyPersons: numberProperty(deltas, "affectedOccupancyPersons"),
      accessibleRouteClearanceSeconds: numberProperty(deltas, "accessibleRouteClearanceSeconds"),
      averageWaitSeconds: numberProperty(deltas, "averageWaitSeconds"),
      p95WaitSeconds: numberProperty(deltas, "p95WaitSeconds"),
      maximumQueueLength: numberProperty(deltas, "maximumQueueLength"),
      abandonmentRate: numberProperty(deltas, "abandonmentRate"),
      requiredBufferAreaM2: numberProperty(deltas, "requiredBufferAreaM2"),
      meanProcessedPersons: numberProperty(deltas, "meanProcessedPersons"),
      maximumP95BacklogPersons: numberProperty(deltas, "maximumP95BacklogPersons"),
      maximumP95Utilization: numberProperty(deltas, "maximumP95Utilization"),
    },
  };
};
type NewIncidentInput = {
  severity: IncidentSeverity;
  category: IncidentCategory;
  summaryCode: string;
  location: IncidentLocationInput;
  relatedRefs?: readonly IncidentRelatedRef[];
  owner?: IncidentOwner;
  idempotencyKey?: string;
  correlationId?: string;
};
type IncidentActionInput = {
  incidentId: string;
  expectedIncidentRevision: number;
  reasonCode?: string;
  level?: Exclude<IncidentEscalationLevel, "none">;
  toStatus?: IncidentStatus;
  resolutionCode?: string;
  fromOwner?: IncidentOwner;
  toOwner?: IncidentOwner;
  openActionCodes?: readonly string[];
  evidenceRefs?: readonly IncidentRelatedRef[];
  actionCode?: string;
  targetObjectIds?: readonly string[];
  authorityRole?: string;
  scenarioDefinitionId?: string;
};

export function App({
  projectId = "project-summit-forward",
  organizationId = "org-local",
  account,
  accountStore,
  navigate = browserNavigate,
}: AppProps) {
  const organizationRoles = useMemo<readonly string[]>(
    () =>
      account?.organizations.find((organization) => organization.id === organizationId)?.roles ?? [
        "venue-administrator",
      ],
    [account, organizationId],
  );
  const studioActorId = account?.user?.id ?? "studio-operator";
  const studioAuthorization = useMemo(
    () =>
      Object.freeze({
        principal: createHumanPrincipal({
          id: studioActorId,
          organizationId,
          roles: organizationRoles,
          operationalRoles: ["safety-officer", "venue-administrator"],
        }),
      }),
    [organizationId, organizationRoles, studioActorId],
  );
  const webMcpAuthorizationProvider = useMemo(
    () => () =>
      createShortLivedAgentAuthorization({
        agentId: "webmcp-agent",
        organizationId,
        projectId,
        scopes: VENUE_TOOL_AUTHORIZATION_SCOPES,
        issuedBy: studioActorId,
        delegatedBy: studioAuthorization.principal,
      }),
    [organizationId, projectId, studioActorId, studioAuthorization],
  );
  const canManageSharing = organizationRoles.some((role: string) =>
    ["venue-administrator", "organization-administrator"].includes(role),
  );
  const planner = useMemo(() => {
    const generatedPlan = createEmptyVenuePlan({ projectId });
    const initialPlan: VenuePlanDocument =
      projectId === "project-summit-forward"
        ? summitForwardPlan
        : {
            ...generatedPlan,
            spatial: {
              ...generatedPlan.spatial,
              schemaVersion: 1,
              unit: "m",
              units: { length: "m", area: "m2", angle: "deg", time: "s" },
              layers: ["architecture", "furniture", "access", "production", "catering", "safety", "annotations"],
              coordinateSystem: { origin: "southwest", xAxis: "east", yAxis: "north", rotationDirection: "clockwise" },
            },
            brief: { ...generatedPlan.brief, occupancyMode: "custom", schedule: null },
          };
    return createVenuePlanner(
      { ...normalizePlanGeometry(initialPlan), brief: initialPlan.brief, proposal: initialPlan.proposal },
      { authorization: studioAuthorization, projectId },
    );
  }, [projectId, studioAuthorization]);
  const projectStore = useMemo(() => createProjectStore({ organizationId }), [organizationId]);
  const runbookStore = useMemo(() => createRunbookStore(), []);
  const runbookRemote = useMemo(() => createRunbookRemote({ organizationId }), [organizationId]);
  const occupancyStore = useMemo(
    () => createOccupancyStore({ organizationId, projectId }),
    [organizationId, projectId],
  );
  const occupancyRemote = useMemo(() => createOccupancyRemote({ organizationId }), [organizationId]);
  const occupancyBus = useMemo(() => createOccupancyCommandBus(), []);
  const incidentStore = useMemo(() => createIncidentStore({ organizationId, projectId }), [organizationId, projectId]);
  const incidentRemote = useMemo(() => createIncidentRemote({ organizationId }), [organizationId]);
  const incidentBus = useMemo(() => createIncidentCommandBus(), []);
  const subscribeToPlanner = useCallback((listener: () => void) => planner.subscribe(listener), [planner]);
  const plannerSnapshot = useCallback(() => planner.getSnapshot(), [planner]);
  const plannerState = useSyncExternalStore(subscribeToPlanner, plannerSnapshot, plannerSnapshot);
  const changes = plannerState.proposal.changes;
  const proposalState = plannerState.proposal.status;
  const validation = planner.execute({ type: "validate_layout" });
  const acceptedValidation = useMemo(() => validateVenueState({ ...plannerState, proposal: null }), [plannerState]);
  const brief = planner.execute({ type: "get_project_brief" });
  const branches = useMemo<BranchView[]>(
    () =>
      plannerState.branches.map((branch) => {
        const branchValidation = validateVenueState({ ...plannerState, proposal: branch.proposal });
        return {
          ...branch,
          active: branch.id === plannerState.activeBranchId,
          stale: branch.proposal.baseVersion !== plannerState.plan.version,
          validationStatus: branchValidation.status,
          changedItems: branch.proposal.changes.length,
          revisionCount: branch.revisions.length,
          proposalId: branch.proposal.id,
          baseVersion: branch.proposal.baseVersion,
          revisions: branch.revisions.map((revision) => ({
            proposalId: revision.id,
            revision: revision.revision,
            current: revision.id === branch.proposal.id,
          })),
        };
      }),
    [plannerState],
  );
  const accessEvidence = validation.spatialEvidence.accessibility;
  const capacityEvidence = validation.spatialEvidence.capacity;
  const circulationEvidence = validation.spatialEvidence.circulation;
  const sightlineEvidence = validation.spatialEvidence.sightlines;
  const warningChecks = validation.checks.filter((check) => check.status === "warning");
  const openWarningChecks = warningChecks.filter((check) => !check.waiver);
  const lockConflicts = useMemo(
    () => detectLockConflicts(plannerState.plan, plannerState.proposal.changes, plannerState.projectLocks),
    [plannerState],
  );
  const graphNodes = new Map(accessEvidence.nodes.map((node) => [node.id, node.point]));
  const routeLoadByObjectId = new Map(
    circulationEvidence.bottleneckLoads.flatMap<[string, number]>((load) =>
      load.kind === "route" && "objectId" in load ? [[load.objectId, load.loadIndex]] : [],
    ),
  );
  const versionEvents = useMemo(
    () =>
      plannerState.ledger
        .filter((entry) => ["plan.opened", "proposal.approved", "plan.undone", "plan.redone"].includes(entry.type))
        .slice()
        .reverse(),
    [plannerState],
  );
  const proposedVersion =
    proposalState === "approved"
      ? plannerState.plan.version
      : `${plannerState.plan.version.split(".")[0]}.${Number(plannerState.plan.version.split(".")[1]) + 1}`;
  const [viewMode, setViewMode] = useState("proposed");
  const [selectedChange, setSelectedChange] = useState(2);
  const [webMcpLifecycle, setWebMcpLifecycle] = useState<
    ToolRegistrationLifecycle | Readonly<{ state: "detecting"; registered: 0; total: number; errorCode: null }>
  >({ state: "detecting", registered: 0, total: venueToolContracts.length, errorCode: null });
  const [webMcpDiagnosticsOpen, setWebMcpDiagnosticsOpen] = useState(false);
  const [adjustmentOpen, setAdjustmentOpen] = useState(false);
  const [adjustment, setAdjustment] = useState("");
  const [toast, setToast] = useState("");
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyMounted, setHistoryMounted] = useState(false);
  const [persistenceStatus, setPersistenceStatus] = useState("SYNC");
  const [syncConflict, setSyncConflict] = useState<ProjectConflict | null>(null);
  const [collaborationStatus, setCollaborationStatus] = useState("CONNECT");
  const [collaborationOpen, setCollaborationOpen] = useState(false);
  const [presence, setPresence] = useState<StudioPresence[]>([]);
  const [briefOpen, setBriefOpen] = useState(false);
  const [briefDraft, setBriefDraft] = useState<EventBrief | null>(null);
  const [briefFilter, setBriefFilter] = useState("all");
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [waiverReason, setWaiverReason] = useState("operational-acceptance");
  const [emergencyReviewerId, setEmergencyReviewerId] = useState("");
  const [emergencyReviewerRole, setEmergencyReviewerRole] = useState("safety-officer");
  const [emergencyAssumptionsAccepted, setEmergencyAssumptionsAccepted] = useState(false);
  const [lockObjectId, setLockObjectId] = useState("obj-av-desk");
  const [lockType, setLockType] = useState("position");
  const [lockReason, setLockReason] = useState("operator-hold");
  const [compareLeftBranchId, setCompareLeftBranchId] = useState("branch-balanced");
  const [compareRightBranchId, setCompareRightBranchId] = useState("branch-balanced");
  const [decisionNote, setDecisionNote] = useState("");
  const [branchRevisionSelections, setBranchRevisionSelections] = useState<Record<string, string>>({});
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentsMounted, setCommentsMounted] = useState(false);
  const [selectedCommentId, setSelectedCommentId] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [simulationOpen, setSimulationOpen] = useState(false);
  const [simulationMounted, setSimulationMounted] = useState(false);
  const [simulationOverlay, setSimulationOverlay] = useState<OverlayView | null>(null);
  const [runbookOpen, setRunbookOpen] = useState(false);
  const [runbookMounted, setRunbookMounted] = useState(false);
  const [runbook, setRunbook] = useState<EventDayRunbook | null>(null);
  const [runbookSyncState, setRunbookSyncState] = useState<{ state: string; pendingCount: number }>({
    state: "online",
    pendingCount: 0,
  });
  const [runbookEvidenceDrafts, setRunbookEvidenceDrafts] = useState<Record<string, RunbookEvidence[]>>({});
  const [runbookHandoffs, setRunbookHandoffs] = useState<RunbookHandoffView[]>([]);
  const [occupancyOpen, setOccupancyOpen] = useState(false);
  const [occupancyMounted, setOccupancyMounted] = useState(false);
  const [occupancyMonitor, setOccupancyMonitor] = useState<LiveOccupancyMonitor | null>(null);
  const [occupancyProjection, setOccupancyProjection] = useState<OccupancyProjection | null>(null);
  const [occupancySyncState, setOccupancySyncState] = useState<{
    state: string;
    pendingCount: number;
    lastSyncedAt: string | null;
  }>({ state: "offline", pendingCount: 0, lastSyncedAt: null });
  const [incidentOpen, setIncidentOpen] = useState(false);
  const [incidentMounted, setIncidentMounted] = useState(false);
  const [incidentRegister, setIncidentRegister] = useState<IncidentRegister | null>(null);
  const [incidentSyncState, setIncidentSyncState] = useState<{
    state: string;
    pendingCount: number;
    lastSyncedAt: string | null;
  }>({ state: "offline", pendingCount: 0, lastSyncedAt: null });
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const incidentClientSequence = useRef(0);
  const occupancyClientSequence = useRef(0);
  const runbookClientSequence = useRef(0);
  const runbookBus = useMemo(
    () =>
      createRunbookCommandBus({
        onChange: (next) => {
          setRunbook(next);
          if (next) void runbookStore.saveRunbook(next);
        },
      }),
    [runbookStore],
  );
  const toastTimer = useRef<number | null>(null);
  const projectRecordMetadata = useRef<ProjectRecordMetadata>({
    createdAt: null,
    revision: null,
    provenance: null,
    archivedAt: null,
    deletedAt: null,
    recoveryUntil: null,
    pinned: false,
    lastOpenedAt: null,
  });
  const syncConflictRef = useRef<ProjectConflict | null>(null);
  const skipNextPersistenceSave = useRef(false);
  const collaborationClientRef = useRef<ReturnType<typeof createCollaborationClient> | null>(null);
  const persistenceStatusRef = useRef("SYNC");
  const saveInFlightRef = useRef(false);

  const acceptedLedgerEntry = useMemo(
    () =>
      plannerState.ledger
        .slice()
        .reverse()
        .find(
          (entry) =>
            entry.details.acceptedPlan?.id === plannerState.plan.id &&
            entry.details.acceptedPlan.version === plannerState.plan.version,
        ) ?? null,
    [plannerState.ledger, plannerState.plan.id, plannerState.plan.version],
  );
  const runbookView = useMemo(() => {
    if (!runbook) return null;
    const phases = runbook.phases.map((phase) => ({
      ...phase,
      label: phase.kind.replace("live-event", "live").toUpperCase(),
    }));
    const phaseById = new Map(phases.map((phase) => [phase.id, phase]));
    const taskById = new Map(runbook.tasks.map((task) => [task.id, task]));
    return {
      ...runbook,
      sourcePlanVersion: runbook.source.planVersion,
      phases,
      owners: (plannerState.plan.staffing?.shifts ?? []).map((shift) => ({ id: shift.id, label: shift.label })),
      tasks: runbook.tasks.map((task) => ({
        ...task,
        title: task.code.replaceAll("_", " "),
        ownerLabel: task.owner.roleId ?? task.workstream,
        dueAt: phaseById.get(task.phaseId)?.startAt ?? null,
        evidence: [...task.evidence, ...(runbookEvidenceDrafts[task.id] ?? [])],
        completedDependencyCount: task.dependencyTaskIds.filter((id) => taskById.get(id)?.status === "completed")
          .length,
        syncState: runbookSyncState.pendingCount > 0 ? "local" : "synced",
      })),
    };
  }, [plannerState.plan.staffing?.shifts, runbook, runbookEvidenceDrafts, runbookSyncState.pendingCount]);
  const incidentView = useMemo(
    () =>
      (incidentRegister?.incidents ?? []).map((incident) => ({
        ...incident,
        syncState: incidentSyncState.pendingCount > 0 ? "local" : "synced",
      })),
    [incidentRegister, incidentSyncState.pendingCount],
  );
  const incidentHandoffs = useMemo(
    () =>
      incidentView.flatMap((incident) => incident.handoffs.map((handoff) => ({ ...handoff, incidentId: incident.id }))),
    [incidentView],
  );
  const incidentOwnerOptions = useMemo(
    () =>
      (plannerState.plan.staffing?.roles ?? []).map((role) => ({
        id: role.id,
        label: role.label,
        owner: { roleId: role.id },
      })),
    [plannerState.plan.staffing?.roles],
  );
  const incidentObjectOptions = useMemo(
    () => plannerState.plan.objects.map((object) => ({ id: object.id, label: object.label ?? object.id })),
    [plannerState.plan.objects],
  );
  const incidentEmergencyActionContext = useMemo(
    () => ({
      actionCode: "EVACUATE",
      authorityRole:
        (incidentRegister?.baseline?.emergencyPlan?.authorizedReviewerRoles ?? []).find((role: string) =>
          organizationRoles.includes(role),
        ) ?? "",
      targetObjectIds: (incidentRegister?.baseline?.acceptedPlan?.objects ?? [])
        .filter((object) => object.emergency || object.exit?.emergency)
        .map((object) => object.id),
    }),
    [incidentRegister, organizationRoles],
  );

  const activeChange = useMemo(
    () => changes.find((change) => change.number === selectedChange) ?? changes[0] ?? null,
    [changes, selectedChange],
  );
  const activeCapacityDelta =
    capacityEvidence.changeDeltas.find((delta) => delta.changeId === activeChange?.id) ?? null;
  const objectIds = useMemo(
    () => new Set(plannerState.plan.objects.map((object) => object.id)),
    [plannerState.plan.objects],
  );
  const doorObjects = useMemo(
    () =>
      plannerState.plan.objects.filter(
        (object): object is VenueObject & { footprint: LineFootprint } =>
          object.kind === "door" && object.footprint.kind === "line",
      ),
    [plannerState.plan.objects],
  );
  const exitObjects = useMemo(
    () =>
      plannerState.plan.objects.filter(
        (object): object is VenueObject & { footprint: LineFootprint } =>
          object.kind === "fire_exit" && object.footprint.kind === "line",
      ),
    [plannerState.plan.objects],
  );
  const restrictedZones = useMemo(
    () => plannerState.plan.objects.filter((object) => object.kind === "restricted_zone"),
    [plannerState.plan.objects],
  );
  const activeLocks = useMemo<LockView[]>(
    () =>
      plannerState.plan.objects.flatMap((object) =>
        [...(object.locks ?? []), ...plannerState.projectLocks.filter((lock) => lock.objectId === object.id)]
          .filter((lock) => lock.active)
          .map((lock) => ({ ...lock, ...(object.label ? { label: object.label } : {}) })),
      ),
    [plannerState.plan.objects, plannerState.projectLocks],
  );
  const activeConflictState = useMemo(
    () => planner.execute({ type: "detect_conflicts", branchId: plannerState.activeBranchId }),
    [planner, plannerState],
  );
  const activeBranches = useMemo(() => branches.filter((branch) => !branch.archived), [branches]);
  const activeBranch = branches.find((branch) => branch.id === plannerState.activeBranchId) ?? null;
  const branchComparison = useMemo<BranchComparison | null>(() => {
    if (!comparisonOpen || compareLeftBranchId === compareRightBranchId) return null;
    if (
      !branches.some((branch) => branch.id === compareLeftBranchId) ||
      !branches.some((branch) => branch.id === compareRightBranchId)
    )
      return null;
    return planner.execute({
      type: "compare_branches",
      leftBranchId: compareLeftBranchId,
      rightBranchId: compareRightBranchId,
    });
  }, [branches, compareLeftBranchId, compareRightBranchId, comparisonOpen, planner]);
  const comparisonView = useMemo(() => {
    const outer = branchComparison?.overlay.roomBoundary.outer ?? [];
    if (!outer.length) return null;
    if (!branchComparison) return null;
    const comparison = branchComparison;
    const minX = Math.min(...outer.map((point) => point.x));
    const maxX = Math.max(...outer.map((point) => point.x));
    const minY = Math.min(...outer.map((point) => point.y));
    const maxY = Math.max(...outer.map((point) => point.y));
    const changedIds = (delta: Record<string, string[]>) => new Set<string>(Object.values(delta).flat());
    return {
      maxY,
      viewBox: `${minX - 1} -1 ${maxX - minX + 2} ${maxY - minY + 2}`,
      boundaryPoints: outer.map((point) => `${point.x},${maxY - point.y}`).join(" "),
      leftChangedIds: changedIds(comparison.acceptedDeltas.left),
      rightChangedIds: changedIds(comparison.acceptedDeltas.right),
    };
  }, [branchComparison]);
  const eventDate = plannerState.plan.event.date
    ? new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(
        new Date(`${plannerState.plan.event.date}T00:00:00`),
      )
    : "DATE —";
  const notify = (message: string) => {
    setToast(message);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 2600);
  };

  useEffect(
    () => () => {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    },
    [],
  );
  useEffect(() => {
    persistenceStatusRef.current = persistenceStatus;
  }, [persistenceStatus]);
  useEffect(() => {
    let active = true;
    void runbookStore.hydrateProject(projectId).then(({ runbook: cached, outbox }) => {
      if (!active || !cached) return;
      runbookClientSequence.current = Math.max(0, ...outbox.map((entry) => entry.command.clientSequence));
      runbookBus.hydrate(cached);
      setRunbookSyncState({ state: outbox.length ? "offline" : "online", pendingCount: outbox.length });
    });
    return () => {
      active = false;
    };
  }, [projectId, runbookBus, runbookStore]);

  useEffect(() => {
    let active = true;
    void occupancyStore.load().then(async ({ monitor: cached, outbox }) => {
      if (!active || !cached) return;
      occupancyBus.hydrate(cached);
      setOccupancyMonitor(cached);
      setOccupancyProjection(
        occupancyResult(occupancyBus.execute({ type: "inspect_live_occupancy", evaluatedAt: new Date().toISOString() }))
          .projection,
      );
      setOccupancySyncState({
        state: outbox.length ? "offline" : "syncing",
        pendingCount: outbox.length,
        lastSyncedAt: cached.updatedAt,
      });
      try {
        const result = await synchronizeOccupancy({
          projectId,
          monitorId: cached.id,
          store: occupancyStore,
          remote: occupancyRemote,
        });
        if (!active) return;
        occupancyBus.hydrate(result.monitor);
        setOccupancyMonitor(result.monitor);
        setOccupancyProjection(result.projection);
        setOccupancySyncState(result.syncState);
      } catch {
        if (active)
          setOccupancySyncState({
            state: "offline",
            pendingCount: (await occupancyStore.listOutbox()).length,
            lastSyncedAt: cached.updatedAt,
          });
      }
    });
    return () => {
      active = false;
    };
  }, [occupancyBus, occupancyRemote, occupancyStore, projectId]);

  useEffect(() => {
    let active = true;
    void incidentStore.hydrate().then(async ({ register: cached, outbox, recovery }) => {
      if (!active) return;
      incidentClientSequence.current = Math.max(0, ...outbox.map((entry) => entry.command.clientSequence));
      if (recovery) setIncidentSyncState({ state: "recovery", pendingCount: outbox.length, lastSyncedAt: null });
      if (!cached) return;
      incidentBus.hydrate(cached);
      setIncidentRegister(cached);
      setIncidentSyncState({
        state: outbox.length ? "offline" : "syncing",
        pendingCount: outbox.length,
        lastSyncedAt: cached.updatedAt,
      });
      try {
        const result = await synchronizeIncidents({
          projectId,
          registerId: cached.id,
          store: incidentStore,
          remote: incidentRemote,
        });
        if (!active) return;
        incidentBus.hydrate(result.register);
        setIncidentRegister(result.register);
        setIncidentSyncState(result.syncState);
      } catch {
        if (active)
          setIncidentSyncState({
            state: "offline",
            pendingCount: (await incidentStore.listOutbox()).length,
            lastSyncedAt: cached.updatedAt,
          });
      }
    });
    return () => {
      active = false;
    };
  }, [incidentBus, incidentRemote, incidentStore, projectId]);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe = () => {};
    let saveTimer: number | undefined;
    let saveQueue = Promise.resolve();
    const save = async () => {
      if (syncConflictRef.current) return;
      saveInFlightRef.current = true;
      setPersistenceStatus("SYNC");
      try {
        const result = await projectStore.save({
          id: projectId,
          name: planner.getSnapshot().plan.event.name,
          activePlanId: planner.getSnapshot().plan.id,
          snapshot: planner.getSnapshot(),
          createdAt: projectRecordMetadata.current.createdAt,
          provenance: projectRecordMetadata.current.provenance,
          archivedAt: projectRecordMetadata.current.archivedAt,
          deletedAt: projectRecordMetadata.current.deletedAt,
          recoveryUntil: projectRecordMetadata.current.recoveryUntil,
          pinned: projectRecordMetadata.current.pinned,
          lastOpenedAt: projectRecordMetadata.current.lastOpenedAt,
        });
        projectRecordMetadata.current = projectRecordMetadataFor(result.record);
        if (!cancelled)
          setPersistenceStatus(result.source === "remote" ? (result.reconciliation ? "MERGED" : "SAVED") : "LOCAL");
      } catch (error) {
        if (cancelled) return;
        const conflict = unknownProperty(error, "conflict");
        if (errorCode(error, "") === "PROJECT_REVISION_CONFLICT" && isProjectConflict(conflict)) {
          syncConflictRef.current = conflict;
          setSyncConflict(conflict);
          setPersistenceStatus("CONFLICT");
          return;
        }
        setPersistenceStatus("ERROR");
      } finally {
        saveInFlightRef.current = false;
      }
    };
    const queueSave = () => {
      saveQueue = saveQueue.then(save, save);
      return saveQueue;
    };

    const start = async () => {
      const loaded = await projectStore.load(projectId);
      if (cancelled) return;
      if (loaded.record?.schemaVersion === 10) {
        try {
          syncCommandResult(planner.execute({ type: "restore_snapshot", snapshot: loaded.record.snapshot }));
        } catch (_error) {
          setPersistenceStatus("INTEGRITY");
          return;
        }
        projectRecordMetadata.current = projectRecordMetadataFor(loaded.record);
        setPersistenceStatus(loaded.source === "remote" ? "SAVED" : "LOCAL");
      } else if (!loaded.record) {
        await queueSave();
      } else {
        setPersistenceStatus("UNSUPPORTED");
        return;
      }
      unsubscribe = planner.subscribe(() => {
        if (skipNextPersistenceSave.current) {
          skipNextPersistenceSave.current = false;
          return;
        }
        window.clearTimeout(saveTimer);
        saveTimer = window.setTimeout(() => {
          void queueSave();
        }, 220);
      });
    };

    void start();
    return () => {
      cancelled = true;
      unsubscribe();
      window.clearTimeout(saveTimer);
    };
  }, [planner, projectId, projectStore]);

  useEffect(() => {
    let active = true;
    const applyRemoteEvent = async (event: CollaborationEvent) => {
      if (
        !active ||
        event.sessionId === studioSessionId ||
        ![
          "project.created",
          "project.updated",
          "comment.updated",
          "ledger.appended",
          "proposal.updated",
          "approval.committed",
          "sync.reset",
        ].includes(event.type)
      )
        return;
      const projectRevision = typeof event.projectRevision === "number" ? event.projectRevision : null;
      if (projectRevision !== null && projectRevision <= (projectRecordMetadata.current.revision ?? 0)) return;
      if (saveInFlightRef.current) {
        window.setTimeout(() => {
          void applyRemoteEvent(event);
        }, 350);
        return;
      }
      if (["LOCAL", "CONFLICT"].includes(persistenceStatusRef.current)) {
        setPersistenceStatus("STALE");
        return;
      }
      const loaded = await projectStore.load(projectId);
      if (!active || !loaded.record || (loaded.record.revision ?? 0) <= (projectRecordMetadata.current.revision ?? 0))
        return;
      projectRecordMetadata.current = projectRecordMetadataFor(loaded.record);
      skipNextPersistenceSave.current = true;
      syncCommandResult(planner.execute({ type: "restore_snapshot", snapshot: loaded.record.snapshot }));
      setPersistenceStatus("REMOTE");
    };
    const client = createCollaborationClient({
      projectId,
      organizationId,
      onEvent: (event) => {
        void applyRemoteEvent(event);
      },
      onPresence: (next) => {
        if (active) setPresence(decodePresence(next));
      },
      onStatus: (status) => {
        if (active) setCollaborationStatus(status.toUpperCase());
      },
    });
    collaborationClientRef.current = client;
    client.start();
    return () => {
      active = false;
      collaborationClientRef.current = null;
      void client.stop();
    };
  }, [organizationId, planner, projectId, projectStore]);

  useEffect(() => {
    void collaborationClientRef.current?.updatePresence({
      planVersion: plannerState.plan.version,
      focusedObjectId: activeChange?.targetObjectIds?.[0] ?? null,
    });
  }, [activeChange, plannerState.plan.version]);

  const handleUseRemoteRecord = () => {
    const conflict = syncConflictRef.current;
    if (!conflict?.remote) return;
    void projectStore.acceptRemote(conflict.remote);
    projectRecordMetadata.current = projectRecordMetadataFor(conflict.remote);
    syncConflictRef.current = null;
    setSyncConflict(null);
    skipNextPersistenceSave.current = true;
    syncCommandResult(planner.execute({ type: "restore_snapshot", snapshot: conflict.remote.snapshot }));
    setPersistenceStatus("SAVED");
  };

  const handleRecoverProposalBranch = () => {
    const conflict = syncConflictRef.current;
    if (!conflict?.remote || !conflict.local?.snapshot?.proposal) return;
    void projectStore.acceptRemote(conflict.remote);
    projectRecordMetadata.current = projectRecordMetadataFor(conflict.remote);
    skipNextPersistenceSave.current = true;
    syncCommandResult(planner.execute({ type: "restore_snapshot", snapshot: conflict.remote.snapshot }));
    syncConflictRef.current = null;
    setSyncConflict(null);
    syncCommandResult(
      planner.execute({
        type: "recover_unsynchronized_branch",
        proposal: conflict.local.snapshot.proposal,
        ...(conflict.localRevision === null ? {} : { sourceRevision: conflict.localRevision }),
        remoteRevision: conflict.remoteRevision,
        actor: "human",
        actorId: account?.user?.id ?? "studio-operator",
        ...commandMetadata("sync-recovery"),
      }),
    );
    setPersistenceStatus("SYNC");
  };

  const handleApprove = () => {
    try {
      const result = planner.execute({
        type: "approve_proposal",
        proposalId: plannerState.proposal.id,
        baseVersion: plannerState.proposal.baseVersion,
        actor: "human",
        actorId: studioActorId,
        ...(validation.emergencyReviewRequired
          ? {
              emergencyReview: {
                reviewerId: emergencyReviewerId,
                reviewerRole: emergencyReviewerRole,
                assumptionsAccepted: emergencyAssumptionsAccepted,
              },
            }
          : {}),
        ...commandMetadata("approve"),
      });
      setAdjustmentOpen(false);
      setViewMode("proposed");
      notify(`Plan v${resultString(result, "planVersion")} applied`);
    } catch (error) {
      notify(errorMessage(error, "APPROVAL FAILED"));
    }
  };

  const handleWarningWaiver = (constraintId: string) => {
    try {
      syncCommandResult(
        planner.execute({
          type: "waive_warning",
          constraintId,
          reasonCode: waiverReason,
          actor: "human",
          actorId: studioActorId,
          ...commandMetadata("waiver"),
        }),
      );
      notify("WAIVER RECORDED");
    } catch (error) {
      notify(errorMessage(error, "WAIVER FAILED"));
    }
  };

  const handleUndo = () => {
    const result = planner.execute({
      type: "undo",
      actor: "human",
      actorId: studioActorId,
      ...commandMetadata("undo"),
    });
    const status = resultString(result, "status");
    notify(
      status === "edit-undone"
        ? `${resultNumber(result, "changedItems")} CHG`
        : status === "undone"
          ? `Plan v${resultString(result, "planVersion")} restored`
          : "No change",
    );
  };

  const handleRedo = () => {
    const result = planner.execute({
      type: "redo",
      actor: "human",
      actorId: studioActorId,
      ...commandMetadata("redo"),
    });
    const status = resultString(result, "status");
    notify(
      status === "edit-redone"
        ? `${resultNumber(result, "changedItems")} CHG`
        : status === "redone"
          ? `Plan v${resultString(result, "planVersion")} restored`
          : "No change",
    );
  };

  const handleEdit = (edit: EditingCommand) => {
    try {
      const result = planner.execute({
        type: "apply_edit",
        edit,
        actor: "human",
        actorId: studioActorId,
        ...commandMetadata("edit"),
      });
      const changeId = resultString(result, "changeId");
      const added = planner.getSnapshot().proposal.changes.find((change) => change.id === changeId);
      if (typeof added?.number === "number") setSelectedChange(added.number);
      setViewMode("proposed");
      notify(`${resultString(result, "operation").toUpperCase()} · ${resultNumber(result, "changedItems")} CHG`);
      return syncCommandResult(result);
    } catch (error) {
      notify(errorCode(error, "EDIT FAILED"));
      return null;
    }
  };

  const handleMeasure = (objectIds: string[]) => {
    try {
      const result = syncCommandResult(planner.execute({ type: "measure_objects", objectIds }));
      const centers = unknownProperty(result, "centers");
      const distances = unknownProperty(result, "distances");
      const measuredIds = unknownProperty(result, "objectIds");
      if (!isUnknownArray(centers) || !isUnknownArray(distances) || !isUnknownArray(measuredIds)) return null;
      return {
        objectIds: measuredIds.filter((id): id is string => typeof id === "string"),
        centers: centers.flatMap((center) =>
          typeof center === "object" &&
          center !== null &&
          "objectId" in center &&
          typeof center.objectId === "string" &&
          "point" in center &&
          typeof center.point === "object" &&
          center.point !== null &&
          "x" in center.point &&
          typeof center.point.x === "number" &&
          "y" in center.point &&
          typeof center.point.y === "number"
            ? [{ objectId: center.objectId, point: { x: center.point.x, y: center.point.y } }]
            : [],
        ),
        distances: distances.flatMap((distance) =>
          typeof distance === "object" &&
          distance !== null &&
          "fromObjectId" in distance &&
          typeof distance.fromObjectId === "string" &&
          "toObjectId" in distance &&
          typeof distance.toObjectId === "string" &&
          "distanceM" in distance &&
          typeof distance.distanceM === "number"
            ? [{ fromObjectId: distance.fromObjectId, toObjectId: distance.toObjectId, distanceM: distance.distanceM }]
            : [],
        ),
      };
    } catch {
      return null;
    }
  };

  const handleRevertChange = () => {
    if (!activeChange) return;
    const nextChange = changes.find((change) => change.id !== activeChange.id);
    const result = planner.execute({
      type: "revert_change",
      changeId: activeChange.id,
      actor: "human",
      actorId: studioActorId,
      ...commandMetadata("revert"),
    });
    if (typeof nextChange?.number === "number") setSelectedChange(nextChange.number);
    notify(
      resultString(result, "status") === "reverted" ? `${resultNumber(result, "changedItems")} changes` : "No change",
    );
  };

  const handleAdjustmentSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!adjustment.trim()) return;
    try {
      syncCommandResult(
        planner.execute({
          type: "request_adjustment",
          instruction: adjustment,
          actor: "human",
          actorId: studioActorId,
          ...commandMetadata("adjustment"),
        }),
      );
      setAdjustmentOpen(false);
      setAdjustment("");
      setViewMode("proposed");
      notify("Adjustment sent");
    } catch (error) {
      notify(errorMessage(error, "ADJUSTMENT FAILED"));
    }
  };

  const downloadExport = ({ content, filename, mimeType, encoding = "utf8" }: DownloadArtifact) => {
    const body =
      encoding === "base64" ? Uint8Array.from(window.atob(content), (character) => character.charCodeAt(0)) : content;
    const url = URL.createObjectURL(new Blob([body], { type: mimeType }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const handleExport = async (format: string) => {
    try {
      let exported: DownloadArtifact;
      if (format === "package") {
        const current = planner.getSnapshot();
        exported = {
          ...(await exportProjectPackage({
            id: projectId,
            name: current.plan.event.name,
            activePlanId: current.plan.id,
            schemaVersion: 10,
            snapshot: current,
            createdAt: projectRecordMetadata.current.createdAt ?? new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            ...(projectRecordMetadata.current.provenance
              ? { provenance: projectRecordMetadata.current.provenance }
              : {}),
          })),
          mimeType: "application/json",
        };
      } else {
        exported = downloadArtifact(syncCommandResult(planner.execute({ type: "export_plan", format })));
      }
      downloadExport(exported);
      setExportOpen(false);
      notify(`${format.toUpperCase()} READY`);
    } catch (error) {
      notify(errorCode(error, "EXPORT FAILED"));
    }
  };

  const openBriefEditor = () => {
    setBriefDraft(structuredClone(plannerState.brief));
    setBriefOpen(true);
  };

  const updateBriefField = <Key extends keyof EventBrief>(field: Key, value: EventBrief[Key]) =>
    setBriefDraft((current) => (current ? { ...current, [field]: value } : current));
  const updateRequirement = <Key extends keyof EventRequirement>(
    requirementId: string,
    field: Key,
    value: EventRequirement[Key],
  ) =>
    setBriefDraft((current) =>
      current
        ? {
            ...current,
            requirements: current.requirements.map((requirement) =>
              requirement.id === requirementId ? { ...requirement, [field]: value } : requirement,
            ),
          }
        : current,
    );

  const handleBriefSave = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      syncCommandResult(
        planner.execute({
          type: "update_event_brief",
          brief: briefDraft,
          actor: "human",
          actorId: studioActorId,
          ...commandMetadata("brief"),
        }),
      );
      setBriefOpen(false);
      setBriefDraft(null);
      notify("Brief saved");
    } catch (error) {
      notify(errorMessage(error, "BRIEF FAILED"));
    }
  };

  const handleCreateBranch = () => {
    const strategy = branches.length % 2 === 1 ? "access-first" : "sightlines-first";
    const name = strategy === "access-first" ? `Access ${branches.length + 1}` : `Sightlines ${branches.length + 1}`;
    const balancedBranch = branches.find((branch) => branch.id === "branch-balanced");
    if (balancedBranch && !balancedBranch.active)
      syncCommandResult(
        planner.execute({
          type: "switch_branch",
          branchId: balancedBranch.id,
          actor: "human",
          actorId: studioActorId,
          ...commandMetadata("branch-source"),
        }),
      );
    const result = planner.execute({
      type: "create_branch",
      name,
      strategy,
      actor: "human",
      actorId: studioActorId,
      ...commandMetadata("branch"),
    });
    const branchId = resultString(result, "branchId");
    setCompareRightBranchId(branchId);
    setCompareLeftBranchId((current) => (current === branchId ? "branch-balanced" : current));
    const next = planner.getSnapshot().proposal.changes[0];
    if (typeof next?.number === "number") setSelectedChange(next.number);
    setViewMode("proposed");
    notify(`${resultNumber(result, "changedItems")} changes`);
  };

  const handleBranchMetadata = (branch: BranchView, fields: Partial<Pick<ProposalBranch, "name" | "notes">>) => {
    try {
      syncCommandResult(
        planner.execute({
          type: "update_branch_metadata",
          branchId: branch.id,
          name: fields.name ?? branch.name,
          notes: fields.notes ?? branch.notes,
          actor: "human",
          actorId: studioActorId,
          ...commandMetadata("branch-meta"),
        }),
      );
      notify("BRANCH SAVED");
    } catch (error) {
      notify(errorCode(error, "BRANCH FAILED"));
    }
  };

  const handleDuplicateBranch = (branchId: string) => {
    try {
      const selectedProposalId = branchRevisionSelections[branchId];
      const result = planner.execute({
        type: "duplicate_branch",
        branchId,
        ...(selectedProposalId ? { proposalId: selectedProposalId } : {}),
        actor: "human",
        actorId: studioActorId,
        ...commandMetadata("branch-copy"),
      });
      setCompareRightBranchId(resultString(result, "branchId"));
      notify("BRANCH COPIED");
    } catch (error) {
      notify(errorCode(error, "COPY FAILED"));
    }
  };

  const handleBranchArchive = (branch: BranchView) => {
    try {
      const result = planner.execute({
        type: branch.archived ? "restore_branch" : "archive_branch",
        branchId: branch.id,
        actor: "human",
        actorId: studioActorId,
        ...commandMetadata(branch.archived ? "branch-restore" : "branch-archive"),
      });
      if (!branch.archived) {
        const activeBranchId = resultString(result, "activeBranchId");
        setCompareLeftBranchId((value) => (value === branch.id ? activeBranchId : value));
        setCompareRightBranchId((value) => (value === branch.id ? activeBranchId : value));
      }
      notify(branch.archived ? "BRANCH RESTORED" : "BRANCH ARCHIVED");
    } catch (error) {
      notify(errorCode(error, "BRANCH FAILED"));
    }
  };

  const handleBranchDecision = (chosenBranchId: string, rejectedBranchId: string) => {
    try {
      if (!branchComparison) return;
      syncCommandResult(
        planner.execute({
          type: "record_branch_decision",
          chosenBranchId,
          rejectedBranchIds: [rejectedBranchId],
          comparisonId: branchComparison.comparisonId,
          note: decisionNote,
          actor: "human",
          actorId: studioActorId,
          ...commandMetadata("branch-decision"),
        }),
      );
      setDecisionNote("");
      setComparisonOpen(false);
      notify("DECISION RECORDED");
    } catch (error) {
      notify(errorCode(error, "DECISION FAILED"));
    }
  };

  const handleCompareBranches = () => {
    if (activeBranches.length < 2) return;
    const firstBranch = activeBranches[0];
    if (!firstBranch) return;
    const left = activeBranches.some((branch) => branch.id === compareLeftBranchId)
      ? compareLeftBranchId
      : firstBranch.id;
    const fallbackRight = activeBranches.find((branch) => branch.id !== left)?.id ?? left;
    setCompareLeftBranchId(left);
    setCompareRightBranchId(
      compareRightBranchId !== left && activeBranches.some((branch) => branch.id === compareRightBranchId)
        ? compareRightBranchId
        : fallbackRight,
    );
    setComparisonOpen(true);
  };

  const handleSwitchBranch = (branchId: string) => {
    syncCommandResult(
      planner.execute({
        type: "switch_branch",
        branchId,
        actor: "human",
        actorId: studioActorId,
        ...commandMetadata("switch-branch"),
      }),
    );
    const next = planner.getSnapshot().proposal.changes[0];
    if (typeof next?.number === "number") setSelectedChange(next.number);
    setViewMode("proposed");
  };

  const handleRebaseBranch = (branchId: string) => {
    try {
      const result = planner.execute({
        type: "rebase_proposal",
        branchId,
        actor: "human",
        actorId: studioActorId,
        ...commandMetadata("rebase"),
      });
      notify(
        resultString(result, "status") === "rebased" ? `v${resultString(result, "toVersion")} · REBASED` : "CURRENT",
      );
    } catch {
      notify("CONFLICT");
    }
  };

  const handleConflictChoice = (conflict: ProposalConflict, outcome: string) => {
    if (outcome === "manual-resolution") {
      setAdjustment(`${conflict.type.toUpperCase()} · ${conflict.objectIds.join(" · ")}`);
      setAdjustmentOpen(true);
      return;
    }
    try {
      const result = planner.execute({
        type: "resolve_conflict",
        branchId: plannerState.activeBranchId,
        conflictId: conflict.id,
        outcome,
        actor: "human",
        actorId: studioActorId,
        ...commandMetadata("resolve-conflict"),
      });
      notify(`${resultString(result, "outcome").toUpperCase()} · ${resultNumber(result, "remainingConflicts")} CFT`);
    } catch (error) {
      notify(errorCode(error, "CONFLICT"));
    }
  };

  const handleAddLock = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const result = planner.execute({
        type: "set_object_lock",
        objectId: lockObjectId,
        lockType,
        reasonCode: lockReason,
        actor: "human",
        actorId: studioActorId,
        ...commandMetadata("set-lock"),
      });
      notify(`${resultString(result, "lockType").toUpperCase()} · LOCKED`);
    } catch (error) {
      notify(errorCode(error, "LOCK FAILED"));
    }
  };

  const handleReleaseLock = (lockId: string) => {
    try {
      syncCommandResult(
        planner.execute({
          type: "release_object_lock",
          lockId,
          actor: "human",
          actorId: studioActorId,
          ...commandMetadata("release-lock"),
        }),
      );
      notify("LOCK · RELEASED");
    } catch (error) {
      notify(errorCode(error, "RELEASE FAILED"));
    }
  };

  const handleAddComment = (input: AddCommentInput) => {
    try {
      const result = planner.execute({
        type: "add_comment",
        ...input,
        actor: "human",
        actorId: studioActorId,
        ...commandMetadata("comment-add"),
      });
      setSelectedCommentId(resultString(syncCommandResult(result), "commentId"));
      notify("COMMENT ADDED");
      return syncCommandResult(result);
    } catch (error) {
      notify(errorCode(error, "COMMENT FAILED"));
      return null;
    }
  };

  const handleEditComment = (comment: VenueComment, changes: EditCommentInput) => {
    try {
      syncCommandResult(
        planner.execute({
          type: "edit_comment",
          commentId: comment.id,
          body: changes.body ?? comment.body,
          mentions: changes.mentions ?? comment.mentions,
          decisionRelevant: changes.decisionRelevant ?? comment.decisionRelevant,
          actor: "human",
          actorId: studioActorId,
          ...commandMetadata("comment-edit"),
        }),
      );
      notify("COMMENT SAVED");
    } catch (error) {
      notify(errorCode(error, "COMMENT FAILED"));
    }
  };

  const handleCommentStatus = (commentId: string, status: string) => {
    try {
      syncCommandResult(
        planner.execute({
          type: "set_comment_status",
          commentId,
          status,
          actor: "human",
          actorId: studioActorId,
          ...commandMetadata("comment-status"),
        }),
      );
      notify(status === "resolved" ? "COMMENT DONE" : "COMMENT REOPENED");
    } catch (error) {
      notify(errorCode(error, "COMMENT FAILED"));
    }
  };

  const handleSelectComment = (commentId: string) => {
    setSelectedCommentId(commentId);
    setCommentsOpen(true);
  };

  const handleCreateRunbook = () => {
    try {
      const ledgerIntegrity = verifyActivityLedger(plannerState.ledger);
      if (!acceptedLedgerEntry || ledgerIntegrity.status !== "pass")
        throw venueError("LEDGER_INTEGRITY_FAILED", { planVersion: plannerState.plan.version });
      const result = runbookBus.execute({
        type: "create_runbook_version",
        projectId,
        plan: plannerState.plan,
        brief: plannerState.brief,
        validation: acceptedValidation,
        sourceLedgerHeadHash: ledgerIntegrity.headHash,
        approvalLedgerEntryId: acceptedLedgerEntry.id,
        frozenBy: account?.user?.id ?? "studio-operator",
        frozenAt: new Date().toISOString(),
      });
      const createdRunbook = runbookBus.getSnapshot();
      if (!createdRunbook) throw venueError("RUNBOOK_DEFINITION_INVALID", { reason: "runbook-not-created" });
      setRunbookSyncState({ state: "offline", pendingCount: 0 });
      notify(resultString(result, "status") === "created" ? "RUNBOOK CREATED" : "RUNBOOK ACTIVE");
      void handleRunbookSync(createdRunbook);
    } catch (error) {
      notify(errorCode(error, "RUNBOOK BLOCKED"));
    }
  };

  const handleRunbookEvidence = ({ taskId, code, ref }: { taskId: string; code: string; ref: string }) => {
    setRunbookEvidenceDrafts((current) => ({
      ...current,
      [taskId]: [...(current[taskId] ?? []).filter((item) => item.code !== code || item.ref !== ref), { code, ref }],
    }));
    notify("EVIDENCE LOCAL");
  };

  const handleRunbookTransition = async ({ taskId, toStatus }: { taskId: string; toStatus: RunbookTaskStatus }) => {
    if (!runbook) return;
    try {
      const task = runbook.tasks.find((candidate) => candidate.id === taskId);
      if (!task) throw venueError("RUNBOOK_TASK_NOT_FOUND", { taskId });
      const identity = `${uniqueToken()}-${task.revision}`;
      const occurredAt = new Date().toISOString();
      const command: RunbookOutboxCommand = {
        type: "transition_runbook_task",
        runbookVersionId: runbook.versionId,
        taskId,
        expectedTaskRevision: task.revision,
        fromStatus: task.status,
        toStatus,
        ...(toStatus === "skipped" ? { reasonCode: "operator-skip" } : {}),
        ...(toStatus === "pending" ? { reasonCode: "operator-reopen" } : {}),
        evidence: [...task.evidence, ...(runbookEvidenceDrafts[taskId] ?? [])],
        operationId: `runbook-operation-${identity}`,
        idempotencyKey: `runbook-transition-${identity}`,
        correlationId: `studio-runbook-${identity}`,
        clientId: `studio-${projectId}`,
        clientSequence: ++runbookClientSequence.current,
        clientOccurredAt: occurredAt,
        deviceOccurredAt: occurredAt,
        committedAt: occurredAt,
        deviceId: "studio-browser",
        actorType: "human",
        actorId: account?.user?.id ?? "studio-operator",
        source: "studio",
        sessionId: studioSessionId,
      };
      runbookBus.preview(command);
      await runbookStore.enqueue(command);
      runbookBus.execute(command);
      const pendingCount = (await runbookStore.listOutbox(runbook.versionId)).length;
      setRunbookSyncState({ state: "offline", pendingCount });
      setRunbookEvidenceDrafts((current) => ({ ...current, [taskId]: [] }));
      const updatedTask = runbookBus.getSnapshot()?.tasks.find((candidate) => candidate.id === taskId);
      notify(`TASK ${(updatedTask?.status ?? toStatus).toUpperCase()} · LOCAL`);
    } catch (error) {
      notify(errorCode(error, "TASK BLOCKED"));
    }
  };

  const handleRunbookSync = async (candidate: EventDayRunbook | null = runbook) => {
    if (!candidate) return;
    const pendingCount = (await runbookStore.listOutbox(candidate.versionId)).length;
    setRunbookSyncState((current) => ({ ...current, state: "syncing", pendingCount }));
    try {
      const result = await synchronizeRunbook({
        projectId,
        runbook: candidate,
        store: runbookStore,
        remote: runbookRemote,
      });
      runbookBus.hydrate(result.runbook);
      setRunbookSyncState(result.syncState);
      notify(result.syncState.state === "online" ? "RUNBOOK SYNCED" : "RUNBOOK CONFLICT");
    } catch (error) {
      const remaining = (await runbookStore.listOutbox(candidate.versionId)).length;
      setRunbookSyncState({ state: "offline", pendingCount: remaining });
      const code = errorCode(error, "RUNBOOK SYNC FAILED");
      notify(code === "RUNBOOK_API_UNAVAILABLE" ? "RUNBOOK LOCAL" : code);
    }
  };

  const handleCreateRunbookHandoff = ({ outgoingOwnerId, incomingOwnerId, roleId, at }: RunbookHandoffInput) => {
    try {
      if (!runbook) throw new Error("Runbook required");
      const handoff = deriveRunbookHandoff(runbook, {
        outgoingAssignmentId: outgoingOwnerId,
        incomingAssignmentId: incomingOwnerId,
        roleId: roleId === "all" ? null : roleId,
        at: at ? new Date(at).toISOString() : new Date().toISOString(),
      });
      setRunbookHandoffs((current) => [
        ...current,
        { ...handoff, id: `handoff-${handoff.ledgerSequence}-${current.length + 1}`, outgoingOwnerId, incomingOwnerId },
      ]);
      notify("HANDOFF CREATED");
    } catch (error) {
      notify(errorCode(error, "HANDOFF BLOCKED"));
    }
  };

  const handleCopyRunbookHandoff = (handoff: RunbookHandoffView) => {
    void navigator.clipboard?.writeText(JSON.stringify(handoff, null, 2));
    notify("HANDOFF COPIED");
  };

  const handleExportRunbook = () => {
    try {
      downloadExport(downloadArtifact(runbookBus.execute({ type: "export_runbook", format: "audit" })));
      notify("RUNBOOK EXPORT READY");
    } catch (error) {
      notify(errorCode(error, "RUNBOOK EXPORT FAILED"));
    }
  };

  const occupancyMetadata = (
    type: string,
    expectedRevision: number,
    actorType: "human" | "agent" = "human",
    actorId = studioActorId,
  ) => {
    const identity = uniqueToken();
    const committedAt = new Date().toISOString();
    const source: "webmcp" | "studio" = actorType === "agent" ? "webmcp" : "studio";
    return {
      operationId: `occupancy-operation-${identity}`,
      idempotencyKey: `occupancy-${type}-${identity}`,
      correlationId: `studio-occupancy-${identity}`,
      expectedRevision,
      clientId: `studio-${projectId}`,
      clientSequence: ++occupancyClientSequence.current,
      clientOccurredAt: committedAt,
      actorType,
      actorId,
      source,
      sessionId: studioSessionId,
      committedAt,
    };
  };

  const applyOccupancyCommand = async (command: OccupancyOutboxCommand) => {
    const executed = occupancyBus.execute(command);
    if (!isOccupancyResult(executed)) throw new TypeError("Invalid occupancy mutation result");
    const result = executed;
    await occupancyStore.saveMonitor(result.monitor);
    await occupancyStore.enqueue(command);
    setOccupancyMonitor(result.monitor);
    setOccupancyProjection(result.projection);
    const pendingCount = (await occupancyStore.listOutbox()).length;
    setOccupancySyncState((current) => ({ ...current, state: "offline", pendingCount }));
    return result;
  };

  const handleCreateOccupancy = async () => {
    if (!runbook) {
      notify("RUNBOOK REQUIRED");
      return null;
    }
    try {
      const result = await occupancyRemote.create(projectId, { runbookVersionId: runbook.versionId });
      occupancyBus.hydrate(result.monitor);
      await occupancyStore.saveMonitor(result.monitor);
      setOccupancyMonitor(result.monitor);
      setOccupancyProjection(result.projection);
      setOccupancySyncState({ state: "online", pendingCount: 0, lastSyncedAt: result.monitor.updatedAt });
      notify("OCCUPANCY ONLINE");
      return result;
    } catch (error) {
      try {
        const createdAt = new Date().toISOString();
        const result = occupancyResult(
          occupancyBus.execute({
            type: "create_occupancy_monitor",
            projectId,
            runbook,
            plan: plannerState.plan,
            createdAt,
            createdBy: studioActorId,
          }),
        );
        await occupancyStore.saveMonitor(result.monitor);
        setOccupancyMonitor(result.monitor);
        setOccupancyProjection(result.projection);
        setOccupancySyncState({ state: "offline", pendingCount: 0, lastSyncedAt: null });
        notify("OCCUPANCY LOCAL");
        return result;
      } catch (localError) {
        notify(errorCode(localError, errorCode(error, "OCCUPANCY BLOCKED")));
        return null;
      }
    }
  };

  const handleOccupancySignal = async (
    {
      sourceId,
      sourceType,
      sourceVersion = "studio-v1",
      kind,
      observedAt = new Date().toISOString(),
      confidence,
      readings,
      idempotencyKey,
      correlationId,
    }: Omit<AggregateOccupancySignal, "sourceVersion" | "observedAt"> &
      Partial<Pick<AggregateOccupancySignal, "sourceVersion" | "observedAt">> & {
        idempotencyKey?: string;
        correlationId?: string;
      },
    actorType: "human" | "agent" = "human",
  ) => {
    if (!occupancyMonitor) return null;
    const generated = occupancyMetadata(
      "ingest",
      occupancyMonitor.revision,
      actorType,
      actorType === "agent" ? "webmcp-agent" : studioActorId,
    );
    const command: OccupancyOutboxCommand = {
      type: "ingest_occupancy_signal",
      signal: { sourceId, sourceType, sourceVersion, kind, observedAt, confidence, readings },
      ...generated,
      ...(idempotencyKey ? { idempotencyKey } : {}),
      ...(correlationId ? { correlationId } : {}),
    };
    try {
      const result = await applyOccupancyCommand(command);
      notify("SIGNAL LOCAL");
      void handleOccupancySync(result.monitor);
      return result;
    } catch (error) {
      notify(errorCode(error, "SIGNAL BLOCKED"));
      throw error;
    }
  };

  const handleOccupancyRefresh = async (
    actorType: "human" | "agent" = "human",
    input: { idempotencyKey?: string; correlationId?: string } = {},
  ) => {
    if (!occupancyMonitor) return null;
    const committedAt = new Date().toISOString();
    const generated = occupancyMetadata(
      "refresh",
      occupancyMonitor.revision,
      actorType,
      actorType === "agent" ? "webmcp-agent" : studioActorId,
    );
    const command: OccupancyOutboxCommand = {
      type: "refresh_live_occupancy",
      evaluatedAt: committedAt,
      ...generated,
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      committedAt,
    };
    const result = await applyOccupancyCommand(command);
    notify("OCCUPANCY REFRESHED");
    void handleOccupancySync(result.monitor);
    return result;
  };

  const handleOccupancyAcknowledge = async ({ alertId, reasonCode }: { alertId: string; reasonCode: string }) => {
    if (!occupancyMonitor) return null;
    const command: OccupancyOutboxCommand = {
      type: "acknowledge_occupancy_alert",
      alertId,
      reasonCode,
      ...occupancyMetadata("acknowledge", occupancyMonitor.revision),
    };
    try {
      const result = await applyOccupancyCommand(command);
      notify("ALERT ACKNOWLEDGED");
      void handleOccupancySync(result.monitor);
      return result;
    } catch (error) {
      notify(errorCode(error, "ACK BLOCKED"));
      return null;
    }
  };

  const handleOccupancySync = async (candidate: LiveOccupancyMonitor | null = occupancyMonitor) => {
    if (!candidate) return null;
    const pendingCount = (await occupancyStore.listOutbox()).length;
    setOccupancySyncState((current) => ({ ...current, state: "syncing", pendingCount }));
    try {
      const result = await synchronizeOccupancy({
        projectId,
        monitorId: candidate.id,
        store: occupancyStore,
        remote: occupancyRemote,
      });
      occupancyBus.hydrate(result.monitor);
      setOccupancyMonitor(result.monitor);
      setOccupancyProjection(result.projection);
      setOccupancySyncState(result.syncState);
      notify(result.syncState.state === "online" ? "OCCUPANCY SYNCED" : "OCCUPANCY CONFLICT");
      return result;
    } catch (error) {
      const remaining = (await occupancyStore.listOutbox()).length;
      setOccupancySyncState({ state: "offline", pendingCount: remaining, lastSyncedAt: candidate.updatedAt });
      const code = errorCode(error, "OCCUPANCY SYNC FAILED");
      notify(code === "OCCUPANCY_API_UNAVAILABLE" ? "OCCUPANCY LOCAL" : code);
      return null;
    }
  };

  const handleOccupancyExport = async () => {
    if (!occupancyMonitor) return null;
    try {
      const result =
        occupancySyncState.state === "online"
          ? (await occupancyRemote.export(projectId, occupancyMonitor.id)).artifact
          : downloadArtifact(
              occupancyBus.execute({ type: "export_live_occupancy", exportedAt: new Date().toISOString() }),
            );
      downloadExport(downloadArtifact(result));
      notify("OCCUPANCY EXPORT READY");
      return result;
    } catch (error) {
      notify(errorCode(error, "OCCUPANCY EXPORT FAILED"));
      return null;
    }
  };

  const incidentMetadata = (
    type: string,
    expectedIncidentRevision: number | null,
    actorType: "human" | "agent" = "human",
    input: { idempotencyKey?: string; correlationId?: string } = {},
  ) => {
    const identity = input.idempotencyKey ?? uniqueToken();
    const committedAt = new Date().toISOString();
    const source: "webmcp" | "studio" = actorType === "agent" ? "webmcp" : "studio";
    return {
      operationId: `incident-operation-${identity}`,
      idempotencyKey: identity,
      correlationId: input.correlationId ?? `studio-incident-${identity}`,
      ...(expectedIncidentRevision == null ? {} : { expectedIncidentRevision }),
      clientId: `studio-${projectId}`,
      clientSequence: ++incidentClientSequence.current,
      clientOccurredAt: committedAt,
      actorType,
      actorId: actorType === "agent" ? "webmcp-agent" : studioActorId,
      source,
      sessionId: studioSessionId,
      committedAt,
    };
  };

  const ensureIncidentRegister = async () => {
    const cached = incidentBus.getSnapshot();
    if (cached) return cached;
    if (!runbook) throw venueError("INCIDENT_BASELINE_INVALID", { reason: "runbook-required" });
    try {
      const result = await incidentRemote.create(projectId, { runbookVersionId: runbook.versionId });
      incidentBus.hydrate(result.register);
      await incidentStore.saveRegister(result.register);
      setIncidentRegister(result.register);
      setIncidentSyncState({ state: "online", pendingCount: 0, lastSyncedAt: result.register.updatedAt });
      return result.register;
    } catch (remoteError) {
      incidentBus.execute({
        type: "create_incident_register",
        projectId,
        runbook,
        createdAt: new Date().toISOString(),
        createdBy: studioActorId,
        actorType: "human",
      });
      const localRegister = incidentBus.getSnapshot();
      if (!localRegister) throw remoteError;
      await incidentStore.saveRegister(localRegister);
      setIncidentRegister(localRegister);
      setIncidentSyncState({ state: "offline", pendingCount: 0, lastSyncedAt: null });
      return localRegister;
    }
  };

  const applyIncidentCommand = async (command: IncidentOutboxCommand) => {
    const result = incidentMutationResult(incidentBus.execute(command));
    if (!result.duplicate) await incidentStore.enqueue(command);
    await incidentStore.saveRegister(result.register);
    setIncidentRegister(result.register);
    const pendingCount = (await incidentStore.listOutbox()).length;
    setIncidentSyncState((current) => ({ ...current, state: "offline", pendingCount }));
    return result;
  };

  const handleIncidentSync = async () => {
    const candidate = incidentBus.getSnapshot();
    if (!candidate || !runbook) return null;
    const pendingCount = (await incidentStore.listOutbox()).length;
    setIncidentSyncState((current) => ({ ...current, state: "syncing", pendingCount }));
    try {
      await incidentRemote.create(projectId, { runbookVersionId: runbook.versionId });
      const result = await synchronizeIncidents({
        projectId,
        registerId: candidate.id,
        store: incidentStore,
        remote: incidentRemote,
      });
      incidentBus.hydrate(result.register);
      setIncidentRegister(result.register);
      setIncidentSyncState(result.syncState);
      notify(result.syncState.state === "online" ? "INCIDENTS SYNCED" : "INCIDENT CONFLICT");
      return result;
    } catch (error) {
      const remaining = (await incidentStore.listOutbox()).length;
      setIncidentSyncState({ state: "offline", pendingCount: remaining, lastSyncedAt: candidate.updatedAt });
      const code = errorCode(error, "INCIDENT SYNC FAILED");
      notify(code === "INCIDENT_API_UNAVAILABLE" ? "INCIDENTS LOCAL" : code);
      return null;
    }
  };

  const handleIncidentDiscardConflicts = async () => {
    const candidate = incidentBus.getSnapshot();
    if (!candidate) return null;
    try {
      await incidentStore.discardConflicts();
      const result = await incidentRemote.get(projectId, candidate.id);
      incidentBus.hydrate(result.register);
      await incidentStore.saveRegister(result.register);
      setIncidentRegister(result.register);
      const pendingCount = (await incidentStore.listOutbox()).length;
      setIncidentSyncState({ state: "online", pendingCount, lastSyncedAt: result.register.updatedAt });
      notify("INCIDENT CONFLICTS DISCARDED");
      return result;
    } catch (error) {
      const pendingCount = (await incidentStore.listOutbox()).length;
      setIncidentSyncState({ state: "offline", pendingCount, lastSyncedAt: candidate.updatedAt });
      notify(errorCode(error, "INCIDENT DISCARD FAILED"));
      return null;
    }
  };

  const handleIncidentCreate = async (
    { owner, ...input }: NewIncidentInput,
    actorType: "human" | "agent" = "human",
  ) => {
    try {
      await ensureIncidentRegister();
      const identity = input.idempotencyKey ?? uniqueToken();
      const incidentId = `incident-${stableFingerprint("studio-incident-id", { projectId, identity }).slice(-16)}`;
      const reportCommand: IncidentOutboxCommand = {
        type: "report_incident",
        incidentId,
        severity: input.severity,
        category: input.category,
        summaryCode: input.summaryCode,
        location: input.location,
        relatedRefs: input.relatedRefs ?? [],
        ...incidentMetadata("report", null, actorType, {
          idempotencyKey: identity,
          ...(input.correlationId ? { correlationId: input.correlationId } : {}),
        }),
      };
      const report = await applyIncidentCommand(reportCommand);
      if (owner && actorType === "human")
        await applyIncidentCommand({
          type: "set_incident_owner",
          incidentId,
          owner,
          ...incidentMetadata("owner", report.incident.revision),
          expectedIncidentRevision: report.incident.revision,
        });
      setSelectedIncidentId(incidentId);
      notify("INCIDENT CREATED · LOCAL");
      void handleIncidentSync();
      return report;
    } catch (error) {
      notify(errorCode(error, "INCIDENT BLOCKED"));
      if (actorType === "agent") throw error;
      return null;
    }
  };

  const handleIncidentAction = async (
    type:
      | "acknowledge_incident"
      | "escalate_incident"
      | "transition_incident_status"
      | "record_incident_emergency_action"
      | "handoff_incident",
    input: IncidentActionInput,
  ) => {
    try {
      const metadata = incidentMetadata(type, input.expectedIncidentRevision);
      let command: IncidentOutboxCommand;
      if (type === "acknowledge_incident" && input.reasonCode)
        command = {
          type,
          incidentId: input.incidentId,
          expectedIncidentRevision: input.expectedIncidentRevision,
          reasonCode: input.reasonCode,
          ...metadata,
        };
      else if (type === "escalate_incident" && input.level && input.reasonCode)
        command = {
          type,
          incidentId: input.incidentId,
          expectedIncidentRevision: input.expectedIncidentRevision,
          level: input.level,
          reasonCode: input.reasonCode,
          ...metadata,
        };
      else if (type === "transition_incident_status" && input.toStatus)
        command = {
          type,
          incidentId: input.incidentId,
          expectedIncidentRevision: input.expectedIncidentRevision,
          toStatus: input.toStatus,
          ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}),
          ...(input.resolutionCode ? { resolutionCode: input.resolutionCode } : {}),
          ...metadata,
        };
      else if (
        type === "record_incident_emergency_action" &&
        input.actionCode &&
        input.authorityRole &&
        input.targetObjectIds
      )
        command = {
          type,
          incidentId: input.incidentId,
          expectedIncidentRevision: input.expectedIncidentRevision,
          actionCode: input.actionCode,
          authorityRole: input.authorityRole,
          targetObjectIds: input.targetObjectIds,
          ...(input.scenarioDefinitionId ? { scenarioDefinitionId: input.scenarioDefinitionId } : {}),
          ...metadata,
        };
      else if (
        type === "handoff_incident" &&
        input.fromOwner &&
        input.toOwner &&
        input.openActionCodes &&
        input.evidenceRefs
      )
        command = {
          type,
          incidentId: input.incidentId,
          expectedIncidentRevision: input.expectedIncidentRevision,
          fromOwner: input.fromOwner,
          toOwner: input.toOwner,
          openActionCodes: input.openActionCodes,
          evidenceRefs: input.evidenceRefs,
          ...metadata,
        };
      else throw venueError("COMMAND_INVALID", { type, reason: "incident-action-fields" });
      const result = await applyIncidentCommand(command);
      notify(`${type.replaceAll("_", " ").toUpperCase()} · LOCAL`);
      void handleIncidentSync();
      return result;
    } catch (error) {
      notify(errorCode(error, "INCIDENT ACTION BLOCKED"));
      return null;
    }
  };

  const handleIncidentExport = async () => {
    const candidate = incidentBus.getSnapshot();
    const incidentId = selectedIncidentId ?? candidate?.incidents?.[0]?.id;
    if (!candidate || !incidentId) return null;
    try {
      const artifact =
        incidentSyncState.state === "online"
          ? (await incidentRemote.export(projectId, candidate.id, incidentId)).artifact
          : downloadArtifact(
              incidentBus.execute({ type: "export_incident_record", incidentId, exportedAt: new Date().toISOString() }),
            );
      downloadExport(downloadArtifact(artifact));
      notify("INCIDENT EXPORT READY");
      return artifact;
    } catch (error) {
      notify(errorCode(error, "INCIDENT EXPORT FAILED"));
      return null;
    }
  };

  const handleRunScenario = async (scenario: ScenarioDefinition, branchId: string) => {
    notify("SIM RUNNING");
    try {
      const result = await planner.execute({
        type: "run_scenario",
        scenario,
        branchId,
        actor: "human",
        actorId: studioActorId,
        ...commandMetadata("simulation"),
      });
      notify(resultString(result, "status") === "completed" ? "SIM COMPLETE" : "SIM CANCELLED");
    } catch (error) {
      notify(errorCode(error, "SIM FAILED"));
    }
  };

  const handleExportSimulation = (runId: string) => {
    try {
      downloadExport(downloadArtifact(syncCommandResult(planner.execute({ type: "export_simulation", runId }))));
      notify("SIM EXPORT READY");
    } catch (error) {
      notify(errorCode(error, "SIM EXPORT FAILED"));
    }
  };

  const handlePreviewQueueOption = (runId: string) => {
    try {
      const run = planner
        .execute({ type: "list_scenario_runs" })
        .find((item) => item.id === runId && item.status === "completed");
      const result = run?.result;
      const suggestion = unknownProperty(result, "suggestion");
      const preflight = unknownProperty(suggestion, "preflight");
      const change = unknownProperty(suggestion, "change");
      const spatialEffects = unknownProperty(change, "spatialEffects");
      const addEffect = isUnknownArray(spatialEffects)
        ? spatialEffects.find((effect) => unknownProperty(effect, "operation") === "add_object")
        : null;
      const object = unknownProperty(addEffect, "object");
      if (
        !run ||
        run.model !== "queue" ||
        unknownProperty(preflight, "status") !== "spatially-valid" ||
        !isVenueObject(object)
      )
        throw new Error("QUEUE_OPTION_INVALID");
      if (planner.getSnapshot().activeBranchId !== run.branchId)
        syncCommandResult(
          planner.execute({
            type: "switch_branch",
            branchId: run.branchId,
            actor: "human",
            actorId: studioActorId,
            ...commandMetadata("queue-option-branch"),
          }),
        );
      syncCommandResult(
        planner.execute({
          type: "apply_edit",
          edit: { operation: "place", object },
          actor: "human",
          actorId: studioActorId,
          ...commandMetadata("queue-option"),
        }),
      );
      const validationResult = planner.execute({ type: "validate_layout" });
      notify(validationResult.status === "pass" ? "QUEUE OPTION READY" : "QUEUE OPTION REVIEW");
    } catch (error) {
      notify(errorCode(error, errorMessage(error, "QUEUE OPTION FAILED")));
    }
  };

  const occupancyOperations: Partial<OccupancyOperations> = {
    inspectLiveOccupancy: async () => {
      if (!occupancyMonitor) throw venueError("OCCUPANCY_MONITOR_NOT_FOUND", { projectId });
      return occupancyBus.execute({ type: "inspect_live_occupancy", evaluatedAt: new Date().toISOString() });
    },
    ingestOccupancySignal: async (input) => {
      if (!occupancyMonitor) throw venueError("OCCUPANCY_MONITOR_NOT_FOUND", { projectId });
      const sourceId = inputString(input, "sourceId");
      const sourceType = inputString(input, "sourceType");
      const kind = inputString(input, "kind");
      const confidence = inputString(input, "confidence");
      const sourceVersion = inputString(input, "sourceVersion");
      const observedAt = inputString(input, "observedAt");
      const idempotencyKey = inputString(input, "idempotencyKey");
      const correlationId = inputString(input, "correlationId");
      const readingsValue = input["readings"];
      const readings = isUnknownArray(readingsValue)
        ? readingsValue.flatMap((reading) => {
            const scopeId = unknownProperty(reading, "scopeId");
            const count = unknownProperty(reading, "count");
            return typeof scopeId === "string" && typeof count === "number" ? [{ scopeId, count }] : [];
          })
        : [];
      if (
        !sourceId ||
        (sourceType !== "registration" && sourceType !== "sensor" && sourceType !== "manual-counter") ||
        (kind !== "check-in" && kind !== "zone-occupancy") ||
        (confidence !== "low" && confidence !== "medium" && confidence !== "high") ||
        readings.length === 0
      )
        throw venueError("OCCUPANCY_SIGNAL_INVALID", { reason: "tool-input" });
      return handleOccupancySignal(
        {
          sourceId,
          sourceType,
          kind,
          confidence,
          readings,
          ...(sourceVersion ? { sourceVersion } : {}),
          ...(observedAt ? { observedAt } : {}),
          ...(idempotencyKey ? { idempotencyKey } : {}),
          ...(correlationId ? { correlationId } : {}),
        },
        "agent",
      );
    },
    refreshLiveOccupancy: async (input) => {
      if (!occupancyMonitor) throw venueError("OCCUPANCY_MONITOR_NOT_FOUND", { projectId });
      const idempotencyKey = inputString(input, "idempotencyKey");
      const correlationId = inputString(input, "correlationId");
      return handleOccupancyRefresh("agent", {
        ...(idempotencyKey ? { idempotencyKey } : {}),
        ...(correlationId ? { correlationId } : {}),
      });
    },
    exportLiveOccupancy: async () => {
      if (!occupancyMonitor) throw venueError("OCCUPANCY_MONITOR_NOT_FOUND", { projectId });
      return occupancyBus.execute({ type: "export_live_occupancy", exportedAt: new Date().toISOString() });
    },
  };

  const incidentOperations: Partial<IncidentOperations> = {
    inspectIncidents: async (input) => {
      const register = await ensureIncidentRegister();
      const incidentId = inputString(input, "incidentId");
      if (incidentId) return { register, incident: incidentBus.execute({ type: "inspect_incident", incidentId }) };
      const status = inputString(input, "status");
      const severity = inputString(input, "severity");
      const category = inputString(input, "category");
      const inspected = incidentBus.execute({
        type: "inspect_incidents",
        ...(status === "open" || status === "mitigating" || status === "resolved" || status === "closed"
          ? { status }
          : {}),
        ...(severity === "low" || severity === "medium" || severity === "high" || severity === "critical"
          ? { severity }
          : {}),
        ...(category === "accessibility" ||
        category === "crowd-capacity" ||
        category === "medical" ||
        category === "security" ||
        category === "fire-life-safety" ||
        category === "facilities" ||
        category === "production-av" ||
        category === "catering" ||
        category === "staffing" ||
        category === "transport" ||
        category === "weather" ||
        category === "other"
          ? { category }
          : {}),
      });
      if (!Array.isArray(inspected)) throw new TypeError("Invalid incident inspection result");
      return { register, incidents: inspected.slice(0, inputNumber(input, "limit") ?? 50) };
    },
    reportIncident: async (input) => {
      const severity = inputString(input, "severity");
      const category = inputString(input, "category");
      const summaryCode = inputString(input, "summaryCode");
      const locationValue = input["location"];
      if (
        (severity !== "low" && severity !== "medium" && severity !== "high" && severity !== "critical") ||
        (category !== "accessibility" &&
          category !== "crowd-capacity" &&
          category !== "medical" &&
          category !== "security" &&
          category !== "fire-life-safety" &&
          category !== "facilities" &&
          category !== "production-av" &&
          category !== "catering" &&
          category !== "staffing" &&
          category !== "transport" &&
          category !== "weather" &&
          category !== "other") ||
        !summaryCode ||
        typeof locationValue !== "object" ||
        locationValue === null ||
        Array.isArray(locationValue)
      )
        throw venueError("COMMAND_INVALID", { reason: "incident-tool-input" });
      const pointValue = locationValue["point"];
      let location: IncidentLocationInput | null = null;
      if (locationValue["kind"] === "plan-object" && typeof locationValue["planObjectId"] === "string")
        location = { kind: "plan-object", planObjectId: locationValue["planObjectId"] };
      else if (
        locationValue["kind"] === "coordinate" &&
        isJsonObject(pointValue) &&
        typeof pointValue["x"] === "number" &&
        typeof pointValue["y"] === "number"
      )
        location = { kind: "coordinate", point: { x: pointValue["x"], y: pointValue["y"] } };
      if (!location) throw venueError("COMMAND_INVALID", { reason: "incident-location" });
      const idempotencyKey = inputString(input, "idempotencyKey");
      const correlationId = inputString(input, "correlationId");
      return handleIncidentCreate(
        {
          severity,
          category,
          summaryCode,
          location,
          ...(idempotencyKey ? { idempotencyKey } : {}),
          ...(correlationId ? { correlationId } : {}),
        },
        "agent",
      );
    },
    exportIncidentRecord: async (input) => {
      await ensureIncidentRegister();
      const incidentId = inputString(input, "incidentId");
      if (!incidentId) throw venueError("COMMAND_INVALID", { field: "incidentId" });
      return incidentBus.execute({ type: "export_incident_record", incidentId, exportedAt: new Date().toISOString() });
    },
  };

  return (
    <div className="app-shell">
      <ToolRegistration
        planner={planner}
        projectStore={projectStore}
        projectId={projectId}
        organizationId={organizationId}
        occupancyOperations={occupancyOperations}
        incidentOperations={incidentOperations}
        authorizationProvider={webMcpAuthorizationProvider}
        onLifecycle={setWebMcpLifecycle}
        navigate={navigate}
      />

      <header className="topbar">
        <div className="brand-block">
          <span className="brand-mark" aria-hidden="true">
            <Image src="/assets/venuemind-mark.webp" alt="" width={32} height={32} />
          </span>
          <span className="brand-name">VenueMind</span>
        </div>
        <div className="event-heading">
          <Button type="button" className="event-name" onClick={() => navigate("/projects")}>
            {plannerState.plan.event.name} <CaretDown size={15} weight="bold" />
          </Button>
          <span>{eventDate}</span>
          <i aria-hidden="true" />
          <span>{plannerState.plan.venue.name}</span>
        </div>
        <nav className="top-actions" aria-label="Plan actions">
          <AppSelect
            className="organization-select"
            label="Organization"
            value={organizationId}
            onValueChange={(value) => {
              accountStore?.selectOrganization(value);
            }}
            options={(account?.organizations ?? []).map((organization) => ({
              value: organization.id,
              label: organization.name,
            }))}
          />
          <Link
            className="organization-settings-link"
            href="/settings/organization"
            onClick={(event) => navigateInternalLink(event, navigate, "/settings/organization")}
            aria-label="Organization settings"
          >
            {account?.user?.displayName?.slice(0, 2).toUpperCase() || "ID"}
          </Link>
          <SharingControls
            projectId={projectId}
            organizationId={organizationId}
            proposalId={plannerState.proposal.id}
            canManage={canManageSharing}
          />
          <Popover open={collaborationOpen} onOpenChange={setCollaborationOpen}>
            <div className="collaboration-control">
              <PopoverTrigger asChild>
                <HeaderButton
                  className={`collaboration-button is-${collaborationStatus.toLowerCase()}`}
                  ariaLabel="Collaboration presence"
                >
                  LIVE {presence.length}
                  <span className="status-dot" />
                </HeaderButton>
              </PopoverTrigger>
              <PopoverContent
                className="collaboration-presence"
                align="end"
                sideOffset={8}
                role="status"
                aria-label="Active Project sessions"
              >
                <header>
                  <b>{collaborationStatus}</b>
                  <span>{presence.length} SESS</span>
                </header>
                {presence.map((item) => (
                  <div key={item.sessionId}>
                    <i>{item.displayName.slice(0, 2).toUpperCase()}</i>
                    <span>
                      <b>{item.displayName}</b>
                      <small>
                        v{item.planVersion} · {item.focusedObjectId ?? "CANVAS"}
                      </small>
                    </span>
                  </div>
                ))}
              </PopoverContent>
            </div>
          </Popover>
          <Popover open={webMcpDiagnosticsOpen} onOpenChange={setWebMcpDiagnosticsOpen}>
            <div className="webmcp-control">
              <PopoverTrigger asChild>
                <HeaderButton className={`status-button is-${webMcpLifecycle.state}`} ariaLabel="WebMCP status">
                  <span className="status-dot" />
                  WebMCP <span className="status-separator">|</span> <span>{webMcpLifecycle.state.toUpperCase()}</span>
                  <CaretDown size={14} />
                </HeaderButton>
              </PopoverTrigger>
              <PopoverContent
                className="webmcp-diagnostics"
                align="start"
                sideOffset={8}
                role="status"
                aria-label="WebMCP diagnostics"
              >
                <div>
                  <b>STATE</b>
                  <span>{webMcpLifecycle.state.toUpperCase()}</span>
                </div>
                <div>
                  <b>CONTRACT</b>
                  <span>{VENUE_TOOL_CONTRACT_VERSION}</span>
                </div>
                <div>
                  <b>TOOLS</b>
                  <span>
                    {webMcpLifecycle.registered}/{webMcpLifecycle.total}
                  </span>
                </div>
                <div>
                  <b>SCOPES</b>
                  <span>{VENUE_TOOL_AUTHORIZATION_SCOPES.length}</span>
                </div>
                <div>
                  <b>ERROR</b>
                  <span>{webMcpLifecycle.errorCode ?? "—"}</span>
                </div>
              </PopoverContent>
            </div>
          </Popover>
          <HeaderButton
            className="history-button"
            ariaLabel="Open plan history"
            onPointerEnter={() => {
              void loadHistoryPanel();
            }}
            onFocus={() => {
              void loadHistoryPanel();
            }}
            onClick={() => {
              setHistoryMounted(true);
              setHistoryOpen((open) => !open);
            }}
          >
            Plan v{plannerState.plan.version}
            <span className={`save-indicator is-${persistenceStatus.toLowerCase()}`}>{persistenceStatus}</span>
            <CaretDown size={14} />
          </HeaderButton>
          <HeaderButton
            className={`edit-button ${editorOpen ? "is-active" : ""}`}
            ariaLabel="Toggle plan editor"
            onClick={() => setEditorOpen((open) => !open)}
          >
            {editorOpen ? "REVIEW" : "EDIT"}
          </HeaderButton>
          <HeaderButton
            className={`comments-button ${commentsOpen ? "is-active" : ""}`}
            ariaLabel="Open comments"
            onPointerEnter={() => {
              void loadCommentsPanel();
            }}
            onFocus={() => {
              void loadCommentsPanel();
            }}
            onClick={() => {
              setCommentsMounted(true);
              setSimulationOpen(false);
              setRunbookOpen(false);
              setOccupancyOpen(false);
              setIncidentOpen(false);
              setCommentsOpen((open) => !open);
            }}
          >
            <ChatCircle size={17} /> {plannerState.comments.filter((comment) => comment.status === "open").length}
          </HeaderButton>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <HeaderButton
                className={`simulation-button ${simulationOpen || runbookOpen || occupancyOpen || incidentOpen ? "is-active" : ""}`}
                ariaLabel="Open operations"
                onPointerEnter={() => {
                  void loadRunbookPanel();
                  void loadScenarioPanel();
                  void loadOccupancyPanel();
                  void loadIncidentPanel();
                }}
                onFocus={() => {
                  void loadRunbookPanel();
                  void loadScenarioPanel();
                  void loadOccupancyPanel();
                  void loadIncidentPanel();
                }}
              >
                OPS <CaretDown size={14} />
              </HeaderButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="export-menu" align="end" sideOffset={8} aria-label="Operational modes">
              <DropdownMenuItem
                className="export-menu-item"
                onPointerEnter={() => {
                  void loadRunbookPanel();
                }}
                onFocus={() => {
                  void loadRunbookPanel();
                }}
                onSelect={() => {
                  setRunbookMounted(true);
                  setRunbookOpen(true);
                  setCommentsOpen(false);
                  setSimulationOpen(false);
                  setOccupancyOpen(false);
                  setIncidentOpen(false);
                }}
              >
                <b>RUNBOOK</b>
                <span>{runbook ? runbook.tasks.filter((task) => task.status !== "completed").length : 0}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="export-menu-item"
                onPointerEnter={() => {
                  void loadScenarioPanel();
                }}
                onFocus={() => {
                  void loadScenarioPanel();
                }}
                onSelect={() => {
                  setSimulationMounted(true);
                  setSimulationOpen(true);
                  setCommentsOpen(false);
                  setRunbookOpen(false);
                  setOccupancyOpen(false);
                  setIncidentOpen(false);
                }}
              >
                <b>SIM</b>
                <span>{plannerState.scenarioRuns.filter((run) => run.status === "completed").length}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="export-menu-item"
                onPointerEnter={() => {
                  void loadOccupancyPanel();
                }}
                onFocus={() => {
                  void loadOccupancyPanel();
                }}
                onSelect={() => {
                  setOccupancyMounted(true);
                  setOccupancyOpen(true);
                  setCommentsOpen(false);
                  setRunbookOpen(false);
                  setSimulationOpen(false);
                  setIncidentOpen(false);
                }}
              >
                <b>OCCUPANCY</b>
                <span>{occupancyMonitor?.activeAlerts.length ?? 0}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="export-menu-item"
                onPointerEnter={() => {
                  void loadIncidentPanel();
                }}
                onFocus={() => {
                  void loadIncidentPanel();
                }}
                onSelect={() => {
                  setIncidentMounted(true);
                  setIncidentOpen(true);
                  setCommentsOpen(false);
                  setRunbookOpen(false);
                  setSimulationOpen(false);
                  setOccupancyOpen(false);
                }}
              >
                <b>INCIDENTS</b>
                <span>
                  {incidentView.filter((incident) => ["open", "mitigating"].includes(incident.status)).length}
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            className="icon-button"
            variant="ghost"
            size="icon"
            type="button"
            onClick={handleUndo}
            aria-label="Undo"
          >
            <ArrowCounterClockwise size={22} />
          </Button>
          <Button
            className="icon-button"
            variant="ghost"
            size="icon"
            type="button"
            onClick={handleRedo}
            aria-label="Redo"
          >
            <ArrowCounterClockwise size={22} className="redo-icon" />
          </Button>
          <DropdownMenu open={exportOpen} onOpenChange={setExportOpen}>
            <div className="export-control">
              <DropdownMenuTrigger asChild>
                <HeaderButton className={`export-button ${exportOpen ? "is-active" : ""}`} ariaLabel="Export plan">
                  <DownloadSimple size={19} /> Export <CaretDown size={14} />
                </HeaderButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="export-menu" align="end" sideOffset={8} aria-label="Export formats">
                {EXPORT_OPTIONS.map(([format, label, meta]) => (
                  <DropdownMenuItem
                    className="export-menu-item"
                    key={format}
                    onSelect={() => {
                      void handleExport(format);
                    }}
                  >
                    <b>{label}</b>
                    <span>{meta}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </div>
          </DropdownMenu>
        </nav>
      </header>

      {syncConflict && (
        <div className="sync-conflict-strip" role="alert" aria-label="Project synchronization conflict">
          <b>SYNC CONFLICT</b>
          <span>
            R{syncConflict.localRevision ?? "—"} ↔ R{syncConflict.remoteRevision}
          </span>
          <span>{syncConflict.overlappingFields.map((field: string) => field.toUpperCase()).join(" · ")}</span>
          {syncConflict.resolutions.includes("recover-proposal-branch") && (
            <Button type="button" onClick={handleRecoverProposalBranch}>
              <GitBranch size={13} /> BRANCH
            </Button>
          )}
          <Button type="button" onClick={handleUseRemoteRecord}>
            REMOTE
          </Button>
        </div>
      )}
      <main className="workspace">
        <aside className="brief-panel">
          <section className="brief-section">
            <div className="eyebrow-row">
              <span className="eyebrow">Event brief</span>
              <Button type="button" variant="ghost" size="xs" className="text-button" onClick={openBriefEditor}>
                Edit
              </Button>
            </div>
            <h1>{plannerState.plan.event.program}</h1>
            <p className="attendee-count">
              {brief.attendeeTarget} attendees · {brief.occupancyMode}
            </p>
            <div className="brief-summary">
              <span>
                {brief.summary.satisfied}/{brief.summary.total} covered
              </span>
              <span>{brief.summary.unresolved} open</span>
              {brief.summary.ambiguous > 0 && <span>{brief.summary.ambiguous} ambiguous</span>}
            </div>
            <ul className="brief-list">
              {brief.requirements.map((requirement) => {
                const Icon = briefIcons[requirement.category] ?? ListBullets;
                const coverage =
                  brief.coverage.find((item) => item.requirementId === requirement.id)?.status ?? "unmeasured";
                return (
                  <BriefItem key={requirement.id} icon={Icon}>
                    <span className="brief-label">{requirement.label}</span>
                    <small className={`coverage-badge is-${coverage}`}>{coverage}</small>
                  </BriefItem>
                );
              })}
            </ul>
            <p className="last-updated">
              {persistenceStatus} · {brief.timezone}
            </p>
          </section>

          <section className="agent-section">
            <div className="eyebrow-row">
              <span className="eyebrow agent-eyebrow">
                <Sparkle size={18} weight="fill" /> Plan analysis
              </span>
              <span className="summary-time">09:41</span>
            </div>
            <div className="agent-metrics" aria-label="Plan analysis metrics">
              <span>
                <strong>{accessEvidence.connected ? `${accessEvidence.minimumClearWidthM}m` : "FAIL"}</strong>
                <small>Access</small>
              </span>
              <span>
                <strong>{Math.round(sightlineEvidence.coverageRatio * 100)}%</strong>
                <small>Sightlines</small>
              </span>
              <span>
                <strong>{capacityEvidence.effectiveCapacity}</strong>
                <small>Capacity</small>
              </span>
            </div>
            <p className="proposal-count">
              {proposalState === "approved"
                ? `${changes.length} changes · applied`
                : `${changes.length} changes · ${validation.unresolvedIssues} conflicts`}
            </p>
            <div className="change-list" role="list" aria-label="Proposed changes">
              {changes.map((change, index) => (
                <Button
                  type="button"
                  variant="ghost"
                  role="listitem"
                  key={change.id}
                  className={`change-row ${selectedChange === (change.number ?? index + 1) ? "is-active" : ""}`}
                  onClick={() => setSelectedChange(change.number ?? index + 1)}
                >
                  <span className="change-number">{change.number ?? index + 1}</span>
                  <span>{change.title}</span>
                </Button>
              ))}
            </div>
            {activeChange && (
              <div className="change-detail">
                <div className="detail-heading">
                  <strong>Change {activeChange.number}</strong>
                  <span>Impact</span>
                </div>
                <div className="detail-metrics">
                  {(activeChange.metrics ?? []).map(([label, value]) => (
                    <span key={label}>
                      <small>{label}</small>
                      <strong>{value}</strong>
                    </span>
                  ))}
                  {activeCapacityDelta && (
                    <span>
                      <small>Capacity Δ</small>
                      <strong>
                        {activeCapacityDelta.effectiveCapacityDelta > 0 ? "+" : ""}
                        {activeCapacityDelta.effectiveCapacityDelta}
                      </strong>
                    </span>
                  )}
                </div>
              </div>
            )}

            {activeConflictState.conflicts.length > 0 && (
              <div className="conflict-panel" aria-label="Proposal conflicts">
                <div className="conflict-heading">
                  <strong>CONFLICTS</strong>
                  <span>{activeConflictState.conflicts.length} CFT</span>
                </div>
                {activeConflictState.conflicts.map((conflict) => (
                  <div className="conflict-row" key={conflict.id}>
                    <span>
                      <strong>{conflict.type.toUpperCase()}</strong>
                      <small>
                        {conflict.objectIds.length
                          ? conflict.objectIds.join(" · ")
                          : `${conflict.baseVersion} → ${conflict.currentVersion}`}
                      </small>
                    </span>
                    <div>
                      {conflict.resolutionOptions.includes("rebase") && (
                        <Button type="button" onClick={() => handleRebaseBranch(plannerState.activeBranchId)}>
                          REBASE
                        </Button>
                      )}
                      {conflict.resolutionOptions.some((option) => ["keep-plan", "drop-change"].includes(option)) && (
                        <Button type="button" onClick={() => handleConflictChoice(conflict, "keep-plan")}>
                          KEEP PLAN
                        </Button>
                      )}
                      {conflict.resolutionOptions.includes("keep-proposal") && (
                        <Button type="button" onClick={() => handleConflictChoice(conflict, "keep-proposal")}>
                          KEEP PROPOSAL
                        </Button>
                      )}
                      {conflict.resolutionOptions.some((option) =>
                        ["manual-resolution", "revise-proposal"].includes(option),
                      ) && (
                        <Button type="button" onClick={() => handleConflictChoice(conflict, "manual-resolution")}>
                          MANUAL
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {warningChecks.length > 0 && (
              <div className="waiver-panel" aria-label="Warning Waivers">
                <div className="waiver-heading">
                  <strong>Warnings</strong>
                  <span>
                    {validation.waivedWarnings} WAIVED · {validation.unwaivedWarnings} OPEN
                  </span>
                </div>
                {warningChecks.map((check) => (
                  <div className={`waiver-row ${check.waiver ? "is-waived" : ""}`} key={check.constraintId}>
                    <span>
                      <strong>{check.label}</strong>
                      <small>
                        {check.actual} / {check.threshold} {check.unit}
                      </small>
                    </span>
                    {check.waiver ? (
                      <b>WAIVED</b>
                    ) : (
                      <Button type="button" onClick={() => handleWarningWaiver(check.constraintId)}>
                        Waive
                      </Button>
                    )}
                  </div>
                ))}
                {openWarningChecks.length > 0 && (
                  <AppSelect
                    label="Waiver reason"
                    value={waiverReason}
                    onValueChange={setWaiverReason}
                    options={[
                      { value: "operational-acceptance", label: "Operational acceptance" },
                      { value: "temporary-condition", label: "Temporary condition" },
                      { value: "equivalent-control", label: "Equivalent control" },
                      { value: "owner-approved-deviation", label: "Owner-approved deviation" },
                    ]}
                  />
                )}
              </div>
            )}

            {adjustmentOpen && (
              <form className="adjustment-form" onSubmit={handleAdjustmentSubmit}>
                <label htmlFor="adjustment">Adjustment</label>
                <Textarea
                  id="adjustment"
                  value={adjustment}
                  onChange={(event) => setAdjustment(event.target.value)}
                  placeholder="ADJUSTMENT"
                  autoFocus
                />
                <div className="form-actions">
                  <Button type="button" variant="secondary" onClick={() => setAdjustmentOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit">Send</Button>
                </div>
              </form>
            )}

            {validation.emergencyReviewRequired && (
              <div className="emergency-review-panel" aria-label="Emergency Review">
                <div>
                  <strong>EMERGENCY REVIEW</strong>
                  <span>{validation.emergencyChangedObjectIds.length} OBJ</span>
                </div>
                <Input
                  aria-label="Emergency reviewer ID"
                  placeholder="REVIEWER ID"
                  value={emergencyReviewerId}
                  onChange={(event) => setEmergencyReviewerId(event.target.value)}
                />
                <AppSelect
                  label="Emergency reviewer role"
                  value={emergencyReviewerRole}
                  onValueChange={setEmergencyReviewerRole}
                  options={[
                    { value: "safety-officer", label: "SAFETY OFFICER" },
                    { value: "venue-administrator", label: "VENUE ADMIN" },
                  ]}
                />
                <label>
                  <Checkbox
                    checked={emergencyAssumptionsAccepted}
                    onCheckedChange={(checked) => setEmergencyAssumptionsAccepted(checked === true)}
                    aria-label="Emergency assumptions accepted"
                  />{" "}
                  ASSUMPTIONS
                </label>
              </div>
            )}

            <div className="decision-actions">
              <Button
                className={`primary-action ${proposalState === "approved" ? "is-approved" : ""}`}
                type="button"
                onClick={handleApprove}
                disabled={
                  proposalState === "approved" ||
                  changes.length === 0 ||
                  validation.status !== "pass" ||
                  validation.unwaivedWarnings > 0 ||
                  (validation.emergencyReviewRequired && (!emergencyReviewerId.trim() || !emergencyAssumptionsAccepted))
                }
              >
                <Check size={20} weight="bold" />
                {changes.length === 0
                  ? "0 changes"
                  : proposalState === "approved"
                    ? "Proposal approved"
                    : validation.status !== "pass"
                      ? `${validation.blockingIssues} blocked`
                      : validation.unwaivedWarnings > 0
                        ? `${validation.unwaivedWarnings} waiver required`
                        : validation.emergencyReviewRequired &&
                            (!emergencyReviewerId.trim() || !emergencyAssumptionsAccepted)
                          ? "Review required"
                          : "Approve proposal"}
              </Button>
              <Button
                className="secondary-action"
                type="button"
                variant="secondary"
                onClick={() => setAdjustmentOpen((open) => !open)}
              >
                <ChatCircle size={20} /> Request adjustment
              </Button>
            </div>
          </section>
        </aside>

        <section className="canvas-column" aria-label="Venue plan workspace">
          <div className={`plan-canvas mode-${viewMode} state-${proposalState} ${editorOpen ? "is-editing" : ""}`}>
            {projectId === "project-summit-forward" ? (
              <Image
                className="floorplan-image"
                src="/assets/venue-floorplan.webp"
                alt="Top-down floor plan of Harborview Convention Center"
                width={1600}
                height={1000}
                priority
              />
            ) : (
              <div className="empty-plan-surface">
                <strong>24 × 16 m</strong>
                <span>0 OBJ</span>
              </div>
            )}
            {objectIds.has("obj-stage-west") && (
              <div className="canvas-lock lock-stage">
                <MapPin size={17} weight="fill" />
                <span>
                  <strong>Locked</strong> Stage position
                </span>
              </div>
            )}
            {objectIds.has("obj-fire-exit-east") && (
              <div className="canvas-lock lock-exit">
                <MapPin size={17} weight="fill" />
                <span>
                  <strong>Locked</strong> Fire exit
                </span>
              </div>
            )}
            {objectIds.has("obj-column-southwest") && (
              <div className="canvas-lock lock-column">
                <MapPin size={17} weight="fill" />
                <span>
                  <strong>Locked</strong> Column
                </span>
              </div>
            )}

            <svg className="evidence-overlay" viewBox="0 0 30 20" role="img" aria-label="Spatial Validation evidence">
              <title>Spatial Validation evidence</title>
              <defs>
                <pattern
                  id="restricted-hatch"
                  width=".32"
                  height=".32"
                  patternUnits="userSpaceOnUse"
                  patternTransform="rotate(45)"
                >
                  <line className="restricted-hatch-line" x1="0" y1="0" x2="0" y2=".32" />
                </pattern>
                <pattern
                  id="clearance-hatch"
                  width=".24"
                  height=".24"
                  patternUnits="userSpaceOnUse"
                  patternTransform="rotate(-45)"
                >
                  <line className="clearance-hatch-line" x1="0" y1="0" x2="0" y2=".24" />
                </pattern>
              </defs>
              <g className="restricted-evidence">
                {restrictedZones.map((object) => (
                  <polygon key={object.id} points={footprintPoints(object.footprint)} />
                ))}
              </g>
              <g className="door-clearance-evidence">
                {accessEvidence.doorClearanceZones
                  .filter((zone) => zone.points.length)
                  .map((zone) => (
                    <polygon
                      className={`is-${zone.status}`}
                      key={zone.id}
                      points={zone.points.map((point) => `${point.x},${20 - point.y}`).join(" ")}
                    />
                  ))}
              </g>
              <g className="exit-approach-evidence">
                {circulationEvidence.exitApproachZones.map((zone) => (
                  <polygon
                    className={`is-${zone.status}`}
                    key={zone.id}
                    points={zone.points.map((point) => `${point.x},${20 - point.y}`).join(" ")}
                  />
                ))}
              </g>
              <g className="opening-evidence">
                {doorObjects.map((object) => (
                  <line
                    className="is-door"
                    key={object.id}
                    x1={object.footprint.start.x}
                    y1={20 - object.footprint.start.y}
                    x2={object.footprint.end.x}
                    y2={20 - object.footprint.end.y}
                  />
                ))}
                {exitObjects.map((object) => (
                  <line
                    className="is-exit"
                    key={object.id}
                    x1={object.footprint.start.x}
                    y1={20 - object.footprint.start.y}
                    x2={object.footprint.end.x}
                    y2={20 - object.footprint.end.y}
                  />
                ))}
              </g>
              <g className="route-evidence">
                {accessEvidence.edges.map((edge) => {
                  const start = graphNodes.get(edge.startNodeId);
                  const end = graphNodes.get(edge.endNodeId);
                  const loadIndex = routeLoadByObjectId.get(edge.objectId) ?? 0;
                  if (!start || !end) return null;
                  return (
                    <line
                      className={
                        edge.blockedByObjectIds.length
                          ? "is-blocked"
                          : loadIndex >= 50
                            ? "is-high-load"
                            : loadIndex > 0
                              ? "is-loaded"
                              : ""
                      }
                      key={edge.id}
                      x1={start.x}
                      y1={20 - start.y}
                      x2={end.x}
                      y2={20 - end.y}
                      style={{ strokeWidth: Math.max(0.12, edge.widthM / 8) }}
                    />
                  );
                })}
                {accessEvidence.nodes.map((node) => (
                  <circle key={node.id} cx={node.point.x} cy={20 - node.point.y} r=".12" />
                ))}
              </g>
              {analysisOpen && (
                <g className="sightline-evidence">
                  {sightlineEvidence.rays.map((ray) => (
                    <line
                      className={`is-${ray.status} ${accessEvidence.accessibleSeatSampleIds.includes(ray.sampleId) ? "is-accessible-seat" : ""}`}
                      key={ray.id}
                      x1={ray.start.x}
                      y1={20 - ray.start.y}
                      x2={ray.end.x}
                      y2={20 - ray.end.y}
                    />
                  ))}
                </g>
              )}
              {simulationOverlay && (
                <g className="density-evidence" aria-label={`Density frame ${simulationOverlay.frame.second} seconds`}>
                  {simulationOverlay.frame.cells
                    .filter((cell) => cell.occupancyPersons > 0)
                    .map((cell) => (
                      <circle
                        className={`is-${cell.level} is-${cell.kind}`}
                        key={cell.id}
                        cx={cell.point.x}
                        cy={20 - cell.point.y}
                        r={Math.max(0.32, Math.min(1.65, 0.28 + Math.sqrt(cell.densityPersonsPerM2) * 0.52))}
                        data-object-id={cell.objectId}
                      >
                        <title>
                          {cell.objectId} · {cell.densityPersonsPerM2} p/m² · {cell.occupancyPersons}
                        </title>
                      </circle>
                    ))}
                </g>
              )}
            </svg>
            {simulationOverlay && (
              <div className="density-status">
                <b>DENSITY</b>
                <span>
                  {Math.floor(simulationOverlay.frame.second / 60)}:
                  {String(Math.round(simulationOverlay.frame.second % 60)).padStart(2, "0")}
                </span>
                <i>{simulationOverlay.frame.peakDensityPersonsPerM2} P/M²</i>
              </div>
            )}
            {!editorOpen && (
              <svg className="annotation-overlay" viewBox="0 0 30 20" aria-label="Coordinate comments">
                <AnnotationPins
                  comments={plannerState.comments}
                  planVersion={plannerState.plan.version}
                  maxY={20}
                  selectedCommentId={selectedCommentId}
                  onSelect={handleSelectComment}
                />
              </svg>
            )}

            {editorOpen && (
              <Suspense
                fallback={
                  <div className="panel-loading" role="status">
                    EDITOR
                  </div>
                }
              >
                <LazyPlanEditor
                  plan={plannerState.plan}
                  proposal={plannerState.proposal}
                  validation={validation}
                  comments={plannerState.comments}
                  selectedCommentId={selectedCommentId}
                  onSelectComment={handleSelectComment}
                  onEdit={handleEdit}
                  onMeasure={handleMeasure}
                  layoutPresets={[
                    {
                      id: "layout-conference-400",
                      label: "CONF 400",
                      roomBoundary: summitForwardPlan.spatial.roomBoundary,
                      objects: summitForwardPlan.objects,
                    },
                  ]}
                />
              </Suspense>
            )}

            {!editorOpen && (
              <div className="proposal-overlays" aria-label="Agent proposal changes">
                {changes.map((change, index) => {
                  const conflict = lockConflicts.find((item) => item.changeId === change.id);
                  const changeNumber = change.number ?? index + 1;
                  return (
                    <Button
                      key={change.id}
                      className={`proposal-shape shape-${["one", "two", "three", "four"][changeNumber - 1] ?? "four"} ${selectedChange === changeNumber ? "selected" : ""} ${conflict ? "is-lock-conflict" : ""}`}
                      onClick={() => setSelectedChange(changeNumber)}
                      aria-label={`Select change ${changeNumber}${conflict ? `, ${conflict.lockType} Lock conflict` : ""}`}
                    >
                      <span>{changeNumber}</span>
                      {conflict && (
                        <b>
                          LOCK · {conflict.lockType.toUpperCase()} ·{" "}
                          {conflict.source === "project" ? "PROJECT" : "TEMPLATE"}
                        </b>
                      )}
                    </Button>
                  );
                })}
                {activeChange && (
                  <div className={`canvas-callout callout-${selectedChange}`}>
                    <span className="callout-kicker">Change {activeChange.number}</span>
                    <strong>{activeChange.shortTitle}</strong>
                    {lockConflicts
                      .filter((item) => item.changeId === activeChange.id)
                      .map((conflict) => (
                        <span className="callout-lock" key={conflict.id}>
                          {conflict.lockType.toUpperCase()} · {conflict.source === "project" ? "PROJECT" : "TEMPLATE"} ·{" "}
                          {conflict.objectId}
                        </span>
                      ))}
                    <div className="callout-metrics">
                      {(activeChange.metrics ?? []).map(([label, value]) => (
                        <span key={label}>
                          <small>{label}</small>
                          <b>{value}</b>
                        </span>
                      ))}
                    </div>
                    <Button type="button" variant="ghost" onClick={handleRevertChange}>
                      <ArrowCounterClockwise size={16} /> Revert
                    </Button>
                  </div>
                )}
              </div>
            )}
            <div className="canvas-legend">
              <span>
                <i className="legend-before" /> Before (v{plannerState.proposal.baseVersion})
              </span>
              <span>
                <i className="legend-proposed" /> Proposed (v{proposedVersion})
              </span>
              <span>
                <i className="legend-door" /> Door
              </span>
              <span>
                <i className="legend-clearance" /> Clearance
              </span>
              <span>
                <i className="legend-egress" /> Egress
              </span>
              <span>
                <i className="legend-restricted" /> Restricted
              </span>
              <span>
                <i className="legend-route" /> Route graph
              </span>
              {simulationOverlay && (
                <span>
                  <i className="legend-density" /> Density
                </span>
              )}
              {analysisOpen && (
                <span>
                  <i className="legend-ray" /> Sightline rays
                </span>
              )}
            </div>
          </div>

          <div className="comparison-bar">
            <div className="compare-group">
              <span className="bar-label">Compare</span>
              <ToggleGroup
                className="segmented-control"
                type="single"
                value={viewMode}
                onValueChange={(value) => {
                  if (value) setViewMode(value);
                }}
                aria-label="Compare plan states"
                spacing={6}
              >
                <ToggleGroupItem value="before">
                  <Eye size={16} /> Before
                </ToggleGroupItem>
                <ToggleGroupItem value="proposed">
                  <Sparkle size={16} /> Proposed
                </ToggleGroupItem>
                <ToggleGroupItem value="split">
                  <Columns size={16} /> Split
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
            <div className="outcomes-group">
              <span className="bar-label">Outcomes</span>
              <div className="outcome-row">
                <div className="outcome">
                  <Check size={18} weight="bold" />
                  <span>
                    <strong>Accessible route</strong>
                    <small>
                      {accessEvidence.minimumClearWidthM} m · {accessEvidence.reachableDestinationIds.length}{" "}
                      destinations
                    </small>
                  </span>
                </div>
                <div className="outcome">
                  <Check size={18} weight="bold" />
                  <span>
                    <strong>Sightline coverage</strong>
                    <small>
                      {sightlineEvidence.sampledSeatIds.length - sightlineEvidence.blockedSampleIds.length}/
                      {sightlineEvidence.sampledSeatIds.length} clear · {sightlineEvidence.maximumViewingDistanceM} m
                    </small>
                  </span>
                </div>
              </div>
            </div>
            <Button
              className="analysis-button"
              variant="ghost"
              type="button"
              onClick={() => setAnalysisOpen((open) => !open)}
            >
              {analysisOpen ? "Hide analysis" : "View analysis"}
            </Button>
          </div>

          {analysisOpen && (
            <div className="analysis-drawer">
              <div>
                <Wheelchair size={18} />
                <span>
                  <strong>Route graph</strong>
                  <small>
                    {accessEvidence.minimumClearWidthM} m · {accessEvidence.graphFingerprint}
                  </small>
                </span>
              </div>
              <div>
                <UsersThree size={18} />
                <span>
                  <strong>Accessible seats</strong>
                  <small>
                    {accessEvidence.accessibleSeatSampleIds.length} samples ·{" "}
                    {accessEvidence.blockedAccessibleSeatSampleIds.length} blocked
                  </small>
                </span>
              </div>
              <div>
                <MapPin size={18} />
                <span>
                  <strong>Door clearance</strong>
                  <small>
                    {accessEvidence.doorClearanceZones.length} zones · {accessEvidence.obstructedDoorObjectIds.length}{" "}
                    blocked
                  </small>
                </span>
              </div>
              <div>
                <UsersThree size={18} />
                <span>
                  <strong>Occupancy</strong>
                  <small>
                    {capacityEvidence.placedCapacity} placed · {capacityEvidence.operationalLoad}/
                    {capacityEvidence.venueMaximum} load
                  </small>
                </span>
              </div>
              <div>
                <PersonSimple size={18} />
                <span>
                  <strong>Circulation</strong>
                  <small>
                    {circulationEvidence.shortestExitPaths.length} paths · {circulationEvidence.peakCongestionIndex}{" "}
                    peak
                  </small>
                </span>
              </div>
              <div>
                <Eye size={18} />
                <span>
                  <strong>Sightlines</strong>
                  <small>
                    {sightlineEvidence.sampledSeatIds.length} rays · {sightlineEvidence.blockedSampleIds.length} blocked
                  </small>
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                type="button"
                onClick={() => setAnalysisOpen(false)}
                aria-label="Close analysis"
              >
                <X size={18} />
              </Button>
            </div>
          )}
        </section>
      </main>
      {historyMounted && (
        <Suspense
          fallback={
            historyOpen ? (
              <div className="panel-loading is-side" role="status">
                HISTORY
              </div>
            ) : null
          }
        >
          <LazyHistoryPanel
            open={historyOpen}
            version={plannerState.plan.version}
            versionEvents={versionEvents}
            ledger={plannerState.ledger}
            activeBranches={activeBranches}
            branches={branches}
            activeBranch={activeBranch}
            compareLeftBranchId={compareLeftBranchId}
            compareRightBranchId={compareRightBranchId}
            branchRevisionSelections={branchRevisionSelections}
            planObjects={plannerState.plan.objects}
            activeLocks={activeLocks}
            lockObjectId={lockObjectId}
            lockType={lockType}
            lockReason={lockReason}
            onClose={() => {
              setHistoryOpen(false);
              setComparisonOpen(false);
            }}
            onCompareLeftChange={setCompareLeftBranchId}
            onCompareRightChange={setCompareRightBranchId}
            onCompareBranches={handleCompareBranches}
            onSwitchBranch={handleSwitchBranch}
            onRevisionChange={(branchId, proposalId) =>
              setBranchRevisionSelections((current) => ({ ...current, [branchId]: proposalId }))
            }
            onDuplicateBranch={handleDuplicateBranch}
            onBranchArchive={handleBranchArchive}
            onRebaseBranch={handleRebaseBranch}
            onBranchMetadata={handleBranchMetadata}
            onCreateBranch={handleCreateBranch}
            onLockObjectChange={setLockObjectId}
            onLockTypeChange={setLockType}
            onLockReasonChange={setLockReason}
            onAddLock={handleAddLock}
            onReleaseLock={handleReleaseLock}
          />
        </Suspense>
      )}
      {commentsMounted && (
        <Suspense
          fallback={
            commentsOpen ? (
              <div className="panel-loading is-side" role="status">
                COMMENTS
              </div>
            ) : null
          }
        >
          <LazyCommentsPanel
            open={commentsOpen}
            state={plannerState}
            selectedCommentId={selectedCommentId}
            onAdd={handleAddComment}
            onEdit={handleEditComment}
            onStatus={handleCommentStatus}
            onClose={() => setCommentsOpen(false)}
          />
        </Suspense>
      )}
      {simulationMounted && (
        <Suspense
          fallback={
            simulationOpen ? (
              <div className="panel-loading is-side" role="status">
                SIM
              </div>
            ) : null
          }
        >
          <LazyScenarioPanel
            open={simulationOpen}
            branches={branches}
            runs={plannerState.scenarioRuns}
            onClose={() => {
              setSimulationOpen(false);
              setSimulationOverlay(null);
            }}
            onRun={handleRunScenario}
            onCompare={(leftRunId, rightRunId) =>
              scenarioComparisonResult(
                syncCommandResult(planner.execute({ type: "compare_simulations", leftRunId, rightRunId })),
              )
            }
            onExport={handleExportSimulation}
            onOverlayChange={setSimulationOverlay}
            onPreviewOption={handlePreviewQueueOption}
          />
        </Suspense>
      )}
      {runbookMounted && (
        <Suspense
          fallback={
            runbookOpen ? (
              <div className="panel-loading is-side" role="status">
                RUNBOOK
              </div>
            ) : null
          }
        >
          <LazyRunbookPanel
            open={runbookOpen}
            runbook={runbookView}
            sourcePlanVersion={runbook?.source.planVersion ?? plannerState.plan.version}
            sourcePlanStatus={runbook ? "accepted" : acceptedValidation.status === "pass" ? "accepted" : "blocked"}
            plannedTaskCount={9}
            syncState={runbookSyncState}
            handoffs={runbookHandoffs}
            onClose={() => setRunbookOpen(false)}
            onCreate={handleCreateRunbook}
            onTaskTransition={handleRunbookTransition}
            onAddEvidence={handleRunbookEvidence}
            onCreateHandoff={handleCreateRunbookHandoff}
            onCopyHandoff={handleCopyRunbookHandoff}
            onExportHandoff={handleExportRunbook}
            onSync={() => {
              void handleRunbookSync();
            }}
            onResolveSyncConflict={() => notify("RUNBOOK CONFLICT")}
          />
        </Suspense>
      )}
      {occupancyMounted && (
        <Suspense
          fallback={
            occupancyOpen ? (
              <div className="panel-loading is-side" role="status">
                OCCUPANCY
              </div>
            ) : null
          }
        >
          <LazyOccupancyPanel
            open={occupancyOpen}
            monitor={occupancyMonitor}
            projection={occupancyProjection}
            syncState={occupancySyncState}
            onClose={() => setOccupancyOpen(false)}
            onCreate={() => {
              void handleCreateOccupancy();
            }}
            onIngest={(signal) => {
              void handleOccupancySignal(signal);
            }}
            onRefresh={() => {
              void handleOccupancyRefresh();
            }}
            onAcknowledge={(input) => {
              void handleOccupancyAcknowledge(input);
            }}
            onSync={() => {
              void handleOccupancySync();
            }}
            onExport={() => {
              void handleOccupancyExport();
            }}
          />
        </Suspense>
      )}
      {incidentMounted && (
        <Suspense
          fallback={
            incidentOpen ? (
              <div className="panel-loading is-side" role="status">
                INCIDENTS
              </div>
            ) : null
          }
        >
          <LazyIncidentPanel
            open={incidentOpen}
            incidents={incidentView}
            handoffs={incidentHandoffs}
            ledger={incidentRegister?.ledger ?? []}
            ownerOptions={incidentOwnerOptions}
            objectOptions={incidentObjectOptions}
            syncState={incidentSyncState}
            onClose={() => setIncidentOpen(false)}
            onCreate={(input) => {
              void handleIncidentCreate(input);
            }}
            onSelectIncident={setSelectedIncidentId}
            onSelectAnchor={(anchor) =>
              notify(anchor.kind === "plan-object" ? anchor.planObjectId : `${anchor.point.x},${anchor.point.y}`)
            }
            onAcknowledge={(input) => {
              void handleIncidentAction("acknowledge_incident", input);
            }}
            onEscalate={(input) => {
              void handleIncidentAction("escalate_incident", input);
            }}
            onResolve={(input) => {
              void handleIncidentAction("transition_incident_status", input);
            }}
            emergencyActionContext={incidentEmergencyActionContext}
            onEmergencyAction={(input) => {
              void handleIncidentAction("record_incident_emergency_action", input);
            }}
            onCreateHandoff={(input) => {
              void handleIncidentAction("handoff_incident", input);
            }}
            onDiscardConflicts={() => {
              void handleIncidentDiscardConflicts();
            }}
            onSync={() => {
              void (incidentRegister
                ? handleIncidentSync()
                : ensureIncidentRegister()
                    .then(() => handleIncidentSync())
                    .catch((error: unknown) => notify(errorCode(error, "INCIDENTS BLOCKED"))));
            }}
            onExport={() => {
              void handleIncidentExport();
            }}
          />
        </Suspense>
      )}
      <Sheet
        open={comparisonOpen && Boolean(branchComparison)}
        onOpenChange={(open) => {
          if (!open) setComparisonOpen(false);
        }}
      >
        {branchComparison && (
          <SheetContent
            className="branch-comparison !h-auto !gap-0 !p-0 sm:!max-w-none"
            side="left"
            showOverlay={false}
            showCloseButton={false}
            aria-label="Proposal Branch comparison"
          >
            <div className="branch-comparison-heading">
              <div>
                <SheetTitle asChild>
                  <span className="eyebrow">BRANCH COMPARE</span>
                </SheetTitle>
                <strong>{branchComparison.comparisonId}</strong>
                <SheetDescription className="sr-only">
                  Proposal Branch metrics, constraints, spatial deltas, and decision controls
                </SheetDescription>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                type="button"
                onClick={() => setComparisonOpen(false)}
                aria-label="Close branch comparison"
              >
                <X size={18} />
              </Button>
            </div>
            <div className="branch-comparison-columns">
              <div>
                <small>A · {branchComparison.left.strategy}</small>
                <strong>{branchComparison.left.name}</strong>
                <span className={`branch-status is-${branchComparison.left.validationStatus}`}>
                  {branchComparison.left.validationStatus.toUpperCase()} · {branchComparison.left.changedItems} CHG
                </span>
                <em>{branchComparison.left.notes || "—"}</em>
                <code>{branchComparison.left.geometryFingerprint}</code>
              </div>
              <div>
                <small>B · {branchComparison.right.strategy}</small>
                <strong>{branchComparison.right.name}</strong>
                <span className={`branch-status is-${branchComparison.right.validationStatus}`}>
                  {branchComparison.right.validationStatus.toUpperCase()} · {branchComparison.right.changedItems} CHG
                </span>
                <em>{branchComparison.right.notes || "—"}</em>
                <code>{branchComparison.right.geometryFingerprint}</code>
              </div>
            </div>
            {comparisonView && (
              <div className="comparison-overlay">
                <div className="comparison-overlay-key">
                  <span className="is-plan">PLAN</span>
                  <span className="is-left">A</span>
                  <span className="is-right">B</span>
                </div>
                <svg viewBox={comparisonView.viewBox} aria-label="Accepted Plan and Proposal Branch overlay">
                  <polygon className="comparison-room" points={comparisonView.boundaryPoints} />
                  {branchComparison.overlay.acceptedObjects.map((object) => (
                    <ComparisonShape
                      key={`plan-${object.id}`}
                      object={object}
                      maxY={comparisonView.maxY}
                      className="is-plan"
                    />
                  ))}
                  {branchComparison.overlay.leftObjects
                    .filter((object) => comparisonView.leftChangedIds.has(object.id))
                    .map((object) => (
                      <ComparisonShape
                        key={`left-${object.id}`}
                        object={object}
                        maxY={comparisonView.maxY}
                        className="is-left"
                      />
                    ))}
                  {branchComparison.overlay.rightObjects
                    .filter((object) => comparisonView.rightChangedIds.has(object.id))
                    .map((object) => (
                      <ComparisonShape
                        key={`right-${object.id}`}
                        object={object}
                        maxY={comparisonView.maxY}
                        className="is-right"
                      />
                    ))}
                </svg>
              </div>
            )}
            <div className="branch-comparison-section">
              <span className="eyebrow">Metrics</span>
              <div className="comparison-metric-table">
                {branchComparison.metricDeltas.map((metric) => (
                  <div className="comparison-metric-row" key={metric.metric}>
                    <strong>{metric.label}</strong>
                    <span>{formatComparisonMetric(metric, metric.left)}</span>
                    <span>{formatComparisonMetric(metric, metric.right)}</span>
                    <b className={metric.delta === 0 ? "is-neutral" : ""}>
                      {formatComparisonMetric(metric, metric.delta, true)}
                    </b>
                  </div>
                ))}
              </div>
            </div>
            <div className="branch-comparison-section">
              <span className="eyebrow">Constraints</span>
              <div className="comparison-constraint-table">
                {branchComparison.constraintDeltas.map((constraint) => (
                  <div className="comparison-constraint-row" key={constraint.constraintId}>
                    <strong>{constraint.label}</strong>
                    <span className={`is-${constraint.leftStatus}`}>{constraint.leftStatus.toUpperCase()}</span>
                    <span className={`is-${constraint.rightStatus}`}>{constraint.rightStatus.toUpperCase()}</span>
                    <b className={`is-${constraint.outcome}`}>{constraint.outcome.toUpperCase()}</b>
                  </div>
                ))}
              </div>
            </div>
            <div className="branch-comparison-section">
              <span className="eyebrow">Spatial deltas</span>
              <div className="comparison-object-groups">
                {Object.entries({
                  Moved: branchComparison.objectDeltas.movedObjectIds,
                  Rotated: branchComparison.objectDeltas.rotatedObjectIds,
                  Resized: branchComparison.objectDeltas.resizedObjectIds,
                  Added: branchComparison.objectDeltas.addedObjectIds,
                  Removed: branchComparison.objectDeltas.removedObjectIds,
                  Metadata: branchComparison.objectDeltas.metadataObjectIds,
                }).map(([label, ids]) => (
                  <div key={label}>
                    <strong>{label}</strong>
                    <b>{ids.length}</b>
                    <small>{ids.join(" · ") || "—"}</small>
                  </div>
                ))}
              </div>
            </div>
            <div className="comparison-decision">
              <Input
                aria-label="Decision note"
                placeholder="DECISION NOTE"
                value={decisionNote}
                onChange={(event) => setDecisionNote(event.target.value)}
              />
              <Button
                type="button"
                onClick={() => handleBranchDecision(branchComparison.left.branchId, branchComparison.right.branchId)}
              >
                CHOOSE A
              </Button>
              <Button
                type="button"
                onClick={() => handleBranchDecision(branchComparison.right.branchId, branchComparison.left.branchId)}
              >
                CHOOSE B
              </Button>
            </div>
          </SheetContent>
        )}
      </Sheet>
      <Sheet
        open={briefOpen && Boolean(briefDraft)}
        onOpenChange={(open) => {
          if (!open) setBriefOpen(false);
        }}
      >
        {briefDraft && (
          <SheetContent
            className="brief-editor !h-auto !gap-0 !p-0 sm:!max-w-none"
            side="left"
            showOverlay={false}
            showCloseButton={false}
            aria-label="Event Brief editor"
          >
            <form onSubmit={handleBriefSave}>
              <div className="brief-editor-heading">
                <div>
                  <SheetTitle asChild>
                    <span className="eyebrow">EVENT BRIEF</span>
                  </SheetTitle>
                  <strong>{briefDraft.id}</strong>
                  <SheetDescription className="sr-only">
                    Event requirements and constraint coverage editor
                  </SheetDescription>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  type="button"
                  onClick={() => setBriefOpen(false)}
                  aria-label="Close Event Brief"
                >
                  <X size={18} />
                </Button>
              </div>
              <div className="brief-fields">
                <label>
                  <span>Event</span>
                  <Input
                    value={briefDraft.eventName}
                    onChange={(event) => updateBriefField("eventName", event.target.value)}
                    required
                  />
                </label>
                <label>
                  <span>Date</span>
                  <Input
                    type="date"
                    value={briefDraft.date ?? ""}
                    onChange={(event) => updateBriefField("date", event.target.value || null)}
                  />
                </label>
                <label>
                  <span>Timezone</span>
                  <Input
                    value={briefDraft.timezone}
                    onChange={(event) => updateBriefField("timezone", event.target.value)}
                    required
                  />
                </label>
                <label>
                  <span>Attendance</span>
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    value={briefDraft.attendeeTarget}
                    onChange={(event) => updateBriefField("attendeeTarget", Number(event.target.value))}
                    required
                  />
                </label>
                <div className="brief-field">
                  <span>Occupancy</span>
                  <AppSelect
                    label="Occupancy"
                    value={briefDraft.occupancyMode}
                    onValueChange={(value) => {
                      if (isOccupancyMode(value)) updateBriefField("occupancyMode", value);
                    }}
                    options={["theater", "classroom", "banquet", "standing", "mixed", "custom"].map((mode) => ({
                      value: mode,
                      label: mode,
                    }))}
                  />
                </div>
              </div>
              <div className="requirement-editor-heading">
                <span className="eyebrow">Requirements</span>
                <div>
                  <small>{brief.summary.unresolved} open</small>
                  <AppSelect
                    label="Requirement filter"
                    value={briefFilter}
                    onValueChange={setBriefFilter}
                    options={[
                      { value: "all", label: "all" },
                      { value: "unresolved", label: "unresolved" },
                      { value: "ambiguous", label: "ambiguous" },
                    ]}
                  />
                </div>
              </div>
              <div className="requirement-editor-list">
                {briefDraft.requirements
                  .filter((requirement) => {
                    if (briefFilter === "ambiguous")
                      return brief.ambiguities.some((item) => item.requirementId === requirement.id);
                    if (briefFilter === "unresolved")
                      return ["blocked", "warning", "unmeasured"].includes(
                        brief.coverage.find((item) => item.requirementId === requirement.id)?.status ?? "unmeasured",
                      );
                    return true;
                  })
                  .map((requirement) => (
                    <div className="requirement-editor-row" key={requirement.id}>
                      <label className="requirement-label">
                        <span>{requirement.category}</span>
                        <Input
                          value={requirement.label}
                          onChange={(event) => updateRequirement(requirement.id, "label", event.target.value)}
                          required
                        />
                      </label>
                      <AppSelect
                        label={`${requirement.label} priority`}
                        value={requirement.priority}
                        onValueChange={(value) => {
                          if (isRequirementPriority(value)) updateRequirement(requirement.id, "priority", value);
                        }}
                        options={["critical", "high", "medium", "low"].map((priority) => ({
                          value: priority,
                          label: priority,
                        }))}
                      />
                      <AppSelect
                        label={`${requirement.label} status`}
                        value={requirement.status}
                        onValueChange={(value) => {
                          if (isRequirementStatus(value)) updateRequirement(requirement.id, "status", value);
                        }}
                        options={["open", "confirmed", "satisfied", "waived"].map((status) => ({
                          value: status,
                          label: status,
                        }))}
                      />
                      <span className={`requirement-link ${requirement.constraintIds.length > 0 ? "is-linked" : ""}`}>
                        {requirement.constraintIds.length} C
                      </span>
                    </div>
                  ))}
              </div>
              <div className="brief-editor-actions">
                <Button type="button" variant="outline" onClick={() => setBriefOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit">Save brief</Button>
              </div>
            </form>
          </SheetContent>
        )}
      </Sheet>
      {toast && (
        <div className="toast" role="status">
          <CircleNotch size={18} weight="bold" />
          {toast}
        </div>
      )}
    </div>
  );
}
