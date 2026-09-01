import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  ArrowCounterClockwise,
  CaretDown,
  Check,
  ChatCircle,
  CircleNotch,
  Clock,
  ClockCounterClockwise,
  Columns,
  DownloadSimple,
  Eye,
  ForkKnife,
  GitBranch,
  ListBullets,
  MapPin,
  PersonSimple,
  Plus,
  PresentationChart,
  Sparkle,
  UsersThree,
  Wheelchair,
  X,
} from "@phosphor-icons/react";
import { summitForwardPlan } from "./domain/summit-forward.js";
import { createEmptyVenuePlan } from "./domain/empty-project.js";
import { createVenuePlanner } from "./domain/venue-planner.js";
import { createHumanPrincipal } from "./domain/authorization.js";
import { venueError } from "./domain/errors.js";
import { createProjectStore } from "./persistence/project-store.js";
import { registerVenueTools } from "./webmcp/register-venue-tools.js";
import { VENUE_TOOL_AUTHORIZATION_SCOPES, VENUE_TOOL_CONTRACT_VERSION, venueToolContracts } from "./contracts/venue-contracts.js";
import { exportProjectPackage } from "./interchange/venue-package.js";
import { PlanEditor } from "./PlanEditor.jsx";
import { AnnotationPins, CommentsPanel } from "./CommentsPanel.jsx";
import { ScenarioPanel } from "./ScenarioPanel.jsx";
import { createCollaborationClient } from "./collaboration/collaboration-client.js";
import { SharingControls } from "./SharingControls.jsx";
import { browserNavigate, navigateInternalLink } from "./navigation.js";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";

const briefIcons = {
  accessibility: Wheelchair,
  seating: UsersThree,
  production: PresentationChart,
  catering: ForkKnife,
  circulation: Columns,
  staffing: PersonSimple,
  security: MapPin,
  emergency: Clock,
};

const studioSessionId = `studio-session-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;
const commandMetadata = (type) => {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return { idempotencyKey: `${type}-${id}`, correlationId: `studio-${id}`, source: "studio", sessionId: studioSessionId };
};

const projectRecordMetadataFor = (record) => ({
  createdAt: record.createdAt,
  revision: record.revision ?? null,
  provenance: record.provenance ?? null,
  archivedAt: record.archivedAt ?? null,
  deletedAt: record.deletedAt ?? null,
  recoveryUntil: record.recoveryUntil ?? null,
  pinned: record.pinned ?? false,
  lastOpenedAt: record.lastOpenedAt ?? null,
});

function ToolRegistration({ planner, projectStore, projectId, organizationId, onLifecycle, navigate }) {
  useEffect(() => {
    const modelContext = document.modelContext;
    if (typeof modelContext?.registerTool !== "function") {
      onLifecycle({ state: "unsupported", registered: 0, total: venueToolContracts.length, errorCode: null });
      return undefined;
    }

    const controller = new AbortController();
    const register = async () => {
      try {
        const projectOperations = {
          async listProjects() {
            const result = await projectStore.list();
            return { source: result.source, projects: result.projects.filter((record) => !record.deletedAt).map((record) => ({ id: record.id, name: record.name, activePlanId: record.activePlanId, schemaVersion: record.schemaVersion, planVersion: record.snapshot?.plan?.version ?? null, updatedAt: record.updatedAt, active: record.id === projectId })) };
          },
          async openProject(nextProjectId) {
            const result = await projectStore.load(nextProjectId);
            if (!result.record || result.record.deletedAt) throw venueError("PROJECT_NOT_FOUND", { projectId: nextProjectId });
            const opened = { status: nextProjectId === projectId ? "active" : "opening", project: { id: result.record.id, name: result.record.name, activePlanId: result.record.activePlanId, planVersion: result.record.snapshot?.plan?.version ?? null } };
            if (nextProjectId !== projectId) window.setTimeout(() => navigate(`/studio/${encodeURIComponent(nextProjectId)}`), 0);
            return opened;
          },
        };
        await registerVenueTools(modelContext, planner, controller.signal, { projectId, organizationId, projectOperations, onLifecycle });
      } catch {
        // registerVenueTools publishes the terminal failure state.
      }
    };

    register();
    return () => controller.abort();
  }, [navigate, onLifecycle, organizationId, planner, projectId, projectStore]);
  return null;
}

function BriefItem({ icon: Icon, children }) {
  return <li className="brief-item"><Icon size={16} aria-hidden="true" /><span>{children}</span></li>;
}

function HeaderButton({ children, className = "", onClick, ariaLabel, ...props }) {
  return <button type="button" className={`header-button ${className}`} onClick={onClick} aria-label={ariaLabel} {...props}>{children}</button>;
}

const formatComparisonMetric = (metric, value, signed = false) => {
  const normalized = metric.unit === "ratio" ? `${Math.round(value * 100)}%` : String(value);
  if (!signed || value === 0) return normalized;
  return value > 0 ? `+${normalized}` : normalized;
};

const footprintPoints = (footprint, maxY = 20) => {
  if (footprint.kind === "polygon") return footprint.points.map((point) => `${point.x},${maxY - point.y}`).join(" ");
  if (footprint.kind !== "rectangle") return "";
  const radians = (-footprint.rotationDegrees * Math.PI) / 180;
  const corners = [
    [-footprint.width / 2, -footprint.depth / 2],
    [footprint.width / 2, -footprint.depth / 2],
    [footprint.width / 2, footprint.depth / 2],
    [-footprint.width / 2, footprint.depth / 2],
  ];
  return corners.map(([dx, dy]) => {
    const x = footprint.center.x + dx * Math.cos(radians) - dy * Math.sin(radians);
    const y = footprint.center.y + dx * Math.sin(radians) + dy * Math.cos(radians);
    return `${x},${maxY - y}`;
  }).join(" ");
};

function ComparisonShape({ object, maxY, className }) {
  const footprint = object.footprint;
  const common = { className, "data-object-id": object.id };
  if (footprint.kind === "rectangle" || footprint.kind === "polygon") return <polygon {...common} points={footprintPoints(footprint, maxY)} />;
  if (footprint.kind === "circle") return <circle {...common} cx={footprint.center.x} cy={maxY - footprint.center.y} r={footprint.radius} />;
  return <line {...common} x1={footprint.start.x} y1={maxY - footprint.start.y} x2={footprint.end.x} y2={maxY - footprint.end.y} style={{ strokeWidth: Math.max(.1, footprint.width) }} />;
}

export function App({ projectId = "project-summit-forward", organizationId = "org-local", account, accountStore, navigate = browserNavigate }) {
  const organizationRoles = useMemo(() => account?.organizations.find((organization) => organization.id === organizationId)?.roles ?? ["venue-administrator"], [account, organizationId]);
  const studioAuthorization = useMemo(() => Object.freeze({ principal: createHumanPrincipal({ id: account?.user?.id ?? "studio-operator", organizationId, roles: organizationRoles, operationalRoles: ["safety-officer", "venue-administrator"] }) }), [account, organizationId, organizationRoles]);
  const canManageSharing = organizationRoles.some((role) => ["venue-administrator", "organization-administrator"].includes(role));
  const planner = useMemo(() => createVenuePlanner(projectId === "project-summit-forward" ? summitForwardPlan : createEmptyVenuePlan({ projectId }), { authorization: studioAuthorization, projectId }), [projectId, studioAuthorization]);
  const projectStore = useMemo(() => createProjectStore({ organizationId }), [organizationId]);
  const plannerState = useSyncExternalStore(planner.subscribe, planner.getSnapshot, planner.getSnapshot);
  const changes = plannerState.proposal.changes;
  const proposalState = plannerState.proposal.status;
  const validation = useMemo(() => planner.execute({ type: "validate_layout" }), [planner, plannerState]);
  const brief = useMemo(() => planner.execute({ type: "get_project_brief" }), [planner, plannerState]);
  const branches = useMemo(() => planner.execute({ type: "list_branches" }), [planner, plannerState]);
  const accessEvidence = validation.spatialEvidence.accessibility;
  const capacityEvidence = validation.spatialEvidence.capacity;
  const circulationEvidence = validation.spatialEvidence.circulation;
  const sightlineEvidence = validation.spatialEvidence.sightlines;
  const warningChecks = validation.checks.filter((check) => check.status === "warning");
  const openWarningChecks = warningChecks.filter((check) => !check.waiver);
  const lockConflicts = validation.checks.find((check) => check.id === "check-locked-objects")?.evidence.details?.lockConflicts ?? [];
  const graphNodes = useMemo(() => new Map(accessEvidence.nodes.map((node) => [node.id, node.point])), [accessEvidence.nodes]);
  const routeLoadByObjectId = useMemo(() => new Map(circulationEvidence.bottleneckLoads.filter((load) => load.kind === "route").map((load) => [load.objectId, load.loadIndex])), [circulationEvidence.bottleneckLoads]);
  const versionEvents = useMemo(() => plannerState.ledger.filter((entry) => ["plan.opened", "proposal.approved", "plan.undone", "plan.redone"].includes(entry.type)).slice().reverse(), [plannerState]);
  const proposedVersion = proposalState === "approved"
    ? plannerState.plan.version
    : `${plannerState.plan.version.split(".")[0]}.${Number(plannerState.plan.version.split(".")[1]) + 1}`;
  const [viewMode, setViewMode] = useState("proposed");
  const [selectedChange, setSelectedChange] = useState(2);
  const [webMcpLifecycle, setWebMcpLifecycle] = useState({ state: "detecting", registered: 0, total: venueToolContracts.length, errorCode: null });
  const [webMcpDiagnosticsOpen, setWebMcpDiagnosticsOpen] = useState(false);
  const [adjustmentOpen, setAdjustmentOpen] = useState(false);
  const [adjustment, setAdjustment] = useState("");
  const [toast, setToast] = useState("");
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyTab, setHistoryTab] = useState("versions");
  const [persistenceStatus, setPersistenceStatus] = useState("SYNC");
  const [legacyBriefMigration, setLegacyBriefMigration] = useState(null);
  const [legacyBriefReviewOpen, setLegacyBriefReviewOpen] = useState(false);
  const [persistenceEpoch, setPersistenceEpoch] = useState(0);
  const [syncConflict, setSyncConflict] = useState(null);
  const [collaborationStatus, setCollaborationStatus] = useState("CONNECT");
  const [collaborationOpen, setCollaborationOpen] = useState(false);
  const [presence, setPresence] = useState([]);
  const [briefOpen, setBriefOpen] = useState(false);
  const [briefDraft, setBriefDraft] = useState(null);
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
  const [branchRevisionSelections, setBranchRevisionSelections] = useState({});
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [selectedCommentId, setSelectedCommentId] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [simulationOpen, setSimulationOpen] = useState(false);
  const [simulationOverlay, setSimulationOverlay] = useState(null);
  const toastTimer = useRef(null);
  const projectRecordMetadata = useRef({ createdAt: null, revision: null, provenance: null, archivedAt: null, deletedAt: null, recoveryUntil: null, pinned: false, lastOpenedAt: null });
  const syncConflictRef = useRef(null);
  const skipNextPersistenceSave = useRef(false);
  const collaborationClientRef = useRef(null);
  const persistenceStatusRef = useRef("SYNC");
  const saveInFlightRef = useRef(false);

  const activeChange = useMemo(() => changes.find((change) => change.number === selectedChange) ?? changes[0] ?? null, [changes, selectedChange]);
  const activeCapacityDelta = useMemo(() => capacityEvidence.changeDeltas.find((delta) => delta.changeId === activeChange?.id) ?? null, [activeChange, capacityEvidence.changeDeltas]);
  const objectIds = useMemo(() => new Set(plannerState.plan.objects.map((object) => object.id)), [plannerState.plan.objects]);
  const doorObjects = useMemo(() => plannerState.plan.objects.filter((object) => object.kind === "door"), [plannerState.plan.objects]);
  const exitObjects = useMemo(() => plannerState.plan.objects.filter((object) => object.kind === "fire_exit"), [plannerState.plan.objects]);
  const restrictedZones = useMemo(() => plannerState.plan.objects.filter((object) => object.kind === "restricted_zone"), [plannerState.plan.objects]);
  const activeLocks = useMemo(() => plannerState.plan.objects.flatMap((object) => [...(object.locks ?? []), ...plannerState.projectLocks.filter((lock) => lock.objectId === object.id)].filter((lock) => lock.active).map((lock) => ({ ...lock, label: object.label }))), [plannerState.plan.objects, plannerState.projectLocks]);
  const activeConflictState = useMemo(() => planner.execute({ type: "detect_conflicts", branchId: plannerState.activeBranchId }), [planner, plannerState]);
  const activeBranches = useMemo(() => branches.filter((branch) => !branch.archived), [branches]);
  const activeBranch = branches.find((branch) => branch.id === plannerState.activeBranchId) ?? null;
  const branchComparison = useMemo(() => {
    if (!comparisonOpen || compareLeftBranchId === compareRightBranchId) return null;
    if (!branches.some((branch) => branch.id === compareLeftBranchId) || !branches.some((branch) => branch.id === compareRightBranchId)) return null;
    return planner.execute({ type: "compare_branches", leftBranchId: compareLeftBranchId, rightBranchId: compareRightBranchId });
  }, [branches, compareLeftBranchId, compareRightBranchId, comparisonOpen, planner]);
  const comparisonView = useMemo(() => {
    const outer = branchComparison?.overlay.roomBoundary.outer ?? [];
    if (!outer.length) return null;
    const minX = Math.min(...outer.map((point) => point.x));
    const maxX = Math.max(...outer.map((point) => point.x));
    const minY = Math.min(...outer.map((point) => point.y));
    const maxY = Math.max(...outer.map((point) => point.y));
    const changedIds = (delta) => new Set(Object.values(delta).flat());
    return { maxY, viewBox: `${minX - 1} -1 ${maxX - minX + 2} ${maxY - minY + 2}`, boundaryPoints: outer.map((point) => `${point.x},${maxY - point.y}`).join(" "), leftChangedIds: changedIds(branchComparison.acceptedDeltas.left), rightChangedIds: changedIds(branchComparison.acceptedDeltas.right) };
  }, [branchComparison]);
  const eventDate = plannerState.plan.event.date ? new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${plannerState.plan.event.date}T00:00:00`)) : "DATE —";
  const notify = (message) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 2600);
  };

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);
  useEffect(() => { persistenceStatusRef.current = persistenceStatus; }, [persistenceStatus]);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe = () => {};
    let saveTimer;
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
        if (!cancelled) setPersistenceStatus(result.source === "remote" ? (result.reconciliation ? "MERGED" : "SAVED") : "LOCAL");
      } catch (error) {
        if (cancelled) return;
        if (error?.code === "PROJECT_REVISION_CONFLICT") {
          syncConflictRef.current = error.conflict;
          setSyncConflict(error.conflict);
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
      if ([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].includes(loaded.record?.schemaVersion)) {
        try {
          planner.execute({ type: "restore_snapshot", snapshot: loaded.record.snapshot });
        } catch (error) {
          if (error?.code === "LEGACY_BRIEF_ATTESTATION_REQUIRED" && loaded.source === "remote") {
            try {
              const inspection = await projectStore.inspectLegacyBriefMigration(projectId);
              if (inspection.status === "attestation-required") {
                setLegacyBriefMigration(inspection);
                setLegacyBriefReviewOpen(true);
                setPersistenceStatus("ATTEST");
                return;
              }
            } catch { /* retain the integrity state below */ }
          }
          setPersistenceStatus("INTEGRITY");
          return;
        }
        projectRecordMetadata.current = projectRecordMetadataFor(loaded.record);
        setPersistenceStatus(loaded.source === "remote" ? "SAVED" : "LOCAL");
        if (loaded.record.schemaVersion < 10) await queueSave();
      } else {
        await queueSave();
      }
      unsubscribe = planner.subscribe(() => {
        if (skipNextPersistenceSave.current) {
          skipNextPersistenceSave.current = false;
          return;
        }
        window.clearTimeout(saveTimer);
        saveTimer = window.setTimeout(queueSave, 220);
      });
    };

    start();
    return () => {
      cancelled = true;
      unsubscribe();
      window.clearTimeout(saveTimer);
    };
  }, [planner, projectStore, persistenceEpoch]);

  const handleLegacyBriefAttestation = async () => {
    if (!legacyBriefMigration) return;
    setPersistenceStatus("VERIFY");
    try {
      await projectStore.attestLegacyBriefMigration(projectId, legacyBriefMigration, {
        reason: "Administrator reviewed and adopted the legacy Event Brief",
        idempotencyKey: `legacy-brief-${legacyBriefMigration.challengeId}`,
      });
      setLegacyBriefMigration(null);
      setLegacyBriefReviewOpen(false);
      setPersistenceStatus("SAVED");
      setPersistenceEpoch((value) => value + 1);
    } catch (error) {
      setPersistenceStatus(error?.code === "LEGACY_BRIEF_ATTESTATION_DENIED" ? "DENIED" : "STALE");
    }
  };

  useEffect(() => {
    let active = true;
    const applyRemoteEvent = async (event) => {
      if (!active || event.sessionId === account?.session?.id || !["project.created", "project.updated", "comment.updated", "ledger.appended", "proposal.updated", "approval.committed", "sync.reset"].includes(event.type)) return;
      if (event.projectRevision && event.projectRevision <= (projectRecordMetadata.current.revision ?? 0)) return;
      if (saveInFlightRef.current) {
        window.setTimeout(() => { void applyRemoteEvent(event); }, 350);
        return;
      }
      if (["LOCAL", "CONFLICT"].includes(persistenceStatusRef.current)) {
        setPersistenceStatus("STALE");
        return;
      }
      const loaded = await projectStore.load(projectId);
      if (!active || !loaded.record || loaded.record.revision <= (projectRecordMetadata.current.revision ?? 0)) return;
      projectRecordMetadata.current = projectRecordMetadataFor(loaded.record);
      skipNextPersistenceSave.current = true;
      planner.execute({ type: "restore_snapshot", snapshot: loaded.record.snapshot });
      setPersistenceStatus("REMOTE");
    };
    const client = createCollaborationClient({ projectId, organizationId, onEvent: applyRemoteEvent, onPresence: (next) => active && setPresence(next), onStatus: (status) => active && setCollaborationStatus(status.toUpperCase()) });
    collaborationClientRef.current = client;
    client.start();
    return () => {
      active = false;
      collaborationClientRef.current = null;
      void client.stop();
    };
  }, [account?.session?.id, organizationId, planner, projectId, projectStore]);

  useEffect(() => {
    void collaborationClientRef.current?.updatePresence({ planVersion: plannerState.plan.version, focusedObjectId: activeChange?.targetObjectIds?.[0] ?? null });
  }, [activeChange, plannerState.plan.version]);

  const handleUseRemoteRecord = () => {
    const conflict = syncConflictRef.current;
    if (!conflict?.remote) return;
    projectStore.acceptRemote(conflict.remote);
    projectRecordMetadata.current = projectRecordMetadataFor(conflict.remote);
    syncConflictRef.current = null;
    setSyncConflict(null);
    skipNextPersistenceSave.current = true;
    planner.execute({ type: "restore_snapshot", snapshot: conflict.remote.snapshot });
    setPersistenceStatus("SAVED");
  };

  const handleRecoverProposalBranch = () => {
    const conflict = syncConflictRef.current;
    if (!conflict?.remote || !conflict.local?.snapshot?.proposal) return;
    projectStore.acceptRemote(conflict.remote);
    projectRecordMetadata.current = projectRecordMetadataFor(conflict.remote);
    skipNextPersistenceSave.current = true;
    planner.execute({ type: "restore_snapshot", snapshot: conflict.remote.snapshot });
    syncConflictRef.current = null;
    setSyncConflict(null);
    planner.execute({
      type: "recover_unsynchronized_branch",
      proposal: conflict.local.snapshot.proposal,
      sourceRevision: conflict.localRevision,
      remoteRevision: conflict.remoteRevision,
      actor: "human",
      actorId: account?.user?.id ?? "studio-operator",
      ...commandMetadata("sync-recovery"),
    });
    setPersistenceStatus("SYNC");
  };

  const handleApprove = () => {
    try {
      const result = planner.execute({
        type: "approve_proposal",
        proposalId: plannerState.proposal.id,
        baseVersion: plannerState.proposal.baseVersion,
        actor: "human",
        actorId: "studio-operator",
        ...(validation.emergencyReviewRequired ? { emergencyReview: { reviewerId: emergencyReviewerId, reviewerRole: emergencyReviewerRole, assumptionsAccepted: emergencyAssumptionsAccepted } } : {}),
        ...commandMetadata("approve"),
      });
      setAdjustmentOpen(false);
      setViewMode("proposed");
      notify(`Plan v${result.planVersion} applied`);
    } catch (error) {
      notify(error.message);
    }
  };

  const handleWarningWaiver = (constraintId) => {
    try {
      planner.execute({
        type: "waive_warning",
        constraintId,
        reasonCode: waiverReason,
        actor: "human",
        actorId: "studio-operator",
        ...commandMetadata("waiver"),
      });
      notify("WAIVER RECORDED");
    } catch (error) {
      notify(error.message);
    }
  };

  const handleUndo = () => {
    const result = planner.execute({ type: "undo", actor: "human", ...commandMetadata("undo") });
    notify(result.status === "edit-undone" ? `${result.changedItems} CHG` : result.status === "undone" ? `Plan v${result.planVersion} restored` : "No change");
  };

  const handleRedo = () => {
    const result = planner.execute({ type: "redo", actor: "human", ...commandMetadata("redo") });
    notify(result.status === "edit-redone" ? `${result.changedItems} CHG` : result.status === "redone" ? `Plan v${result.planVersion} restored` : "No change");
  };

  const handleEdit = (edit) => {
    try {
      const result = planner.execute({ type: "apply_edit", edit, actor: "human", actorId: "studio-operator", ...commandMetadata("edit") });
      const added = planner.getSnapshot().proposal.changes.find((change) => change.id === result.changeId);
      if (added) setSelectedChange(added.number);
      setViewMode("proposed");
      notify(`${result.operation.toUpperCase()} · ${result.changedItems} CHG`);
      return result;
    } catch (error) {
      notify(error.code ?? "EDIT FAILED");
      return null;
    }
  };

  const handleMeasure = (objectIds) => {
    try { return planner.execute({ type: "measure_objects", objectIds }); } catch { return null; }
  };

  const handleRevertChange = () => {
    if (!activeChange) return;
    const nextChange = changes.find((change) => change.id !== activeChange.id);
    const result = planner.execute({ type: "revert_change", changeId: activeChange.id, actor: "human", ...commandMetadata("revert") });
    if (nextChange) setSelectedChange(nextChange.number);
    notify(result.status === "reverted" ? `${result.changedItems} changes` : "No change");
  };

  const handleAdjustmentSubmit = (event) => {
    event.preventDefault();
    if (!adjustment.trim()) return;
    try {
      planner.execute({ type: "request_adjustment", instruction: adjustment, actor: "human", ...commandMetadata("adjustment") });
      setAdjustmentOpen(false);
      setAdjustment("");
      setViewMode("proposed");
      notify("Adjustment sent");
    } catch (error) {
      notify(error.message);
    }
  };

  const downloadExport = ({ content, filename, mimeType, encoding = "utf8" }) => {
    const body = encoding === "base64"
      ? Uint8Array.from(window.atob(content), (character) => character.charCodeAt(0))
      : content;
    const url = URL.createObjectURL(new Blob([body], { type: mimeType }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const handleExport = async (format) => {
    try {
      let exported;
      if (format === "package") {
        const current = planner.getSnapshot();
        exported = await exportProjectPackage({
          id: projectId,
          name: current.plan.event.name,
          activePlanId: current.plan.id,
          schemaVersion: 10,
          snapshot: current,
          createdAt: projectRecordMetadata.current.createdAt ?? new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          ...(projectRecordMetadata.current.provenance ? { provenance: projectRecordMetadata.current.provenance } : {}),
        });
        exported.mimeType = "application/json";
      } else {
        exported = planner.execute({ type: "export_plan", format });
      }
      downloadExport(exported);
      setExportOpen(false);
      notify(`${format.toUpperCase()} READY`);
    } catch (error) {
      notify(error.code ?? "EXPORT FAILED");
    }
  };

  const openBriefEditor = () => {
    setBriefDraft(structuredClone(plannerState.brief));
    setBriefOpen(true);
  };

  const updateBriefField = (field, value) => setBriefDraft((current) => ({ ...current, [field]: value }));
  const updateRequirement = (requirementId, field, value) => setBriefDraft((current) => ({
    ...current,
    requirements: current.requirements.map((requirement) => requirement.id === requirementId ? { ...requirement, [field]: value } : requirement),
  }));

  const handleBriefSave = (event) => {
    event.preventDefault();
    try {
      planner.execute({ type: "update_event_brief", brief: briefDraft, actor: "human", ...commandMetadata("brief") });
      setBriefOpen(false);
      setBriefDraft(null);
      notify("Brief saved");
    } catch (error) {
      notify(error.message);
    }
  };

  const handleCreateBranch = () => {
    const strategy = branches.length % 2 === 1 ? "access-first" : "sightlines-first";
    const name = strategy === "access-first" ? `Access ${branches.length + 1}` : `Sightlines ${branches.length + 1}`;
    const balancedBranch = branches.find((branch) => branch.id === "branch-balanced");
    if (balancedBranch && !balancedBranch.active) planner.execute({ type: "switch_branch", branchId: balancedBranch.id, actor: "human", ...commandMetadata("branch-source") });
    const result = planner.execute({ type: "create_branch", name, strategy, actor: "human", ...commandMetadata("branch") });
    setCompareRightBranchId(result.branchId);
    setCompareLeftBranchId((current) => current === result.branchId ? "branch-balanced" : current);
    const next = planner.getSnapshot().proposal.changes[0];
    if (next) setSelectedChange(next.number);
    setViewMode("proposed");
    notify(`${result.changedItems} changes`);
  };

  const handleBranchMetadata = (branch, fields) => {
    try {
      planner.execute({ type: "update_branch_metadata", branchId: branch.id, name: fields.name ?? branch.name, notes: fields.notes ?? branch.notes, actor: "human", ...commandMetadata("branch-meta") });
      notify("BRANCH SAVED");
    } catch (error) {
      notify(error.code ?? "BRANCH FAILED");
    }
  };

  const handleDuplicateBranch = (branchId) => {
    try {
      const result = planner.execute({ type: "duplicate_branch", branchId, proposalId: branchRevisionSelections[branchId], actor: "human", ...commandMetadata("branch-copy") });
      setCompareRightBranchId(result.branchId);
      notify("BRANCH COPIED");
    } catch (error) {
      notify(error.code ?? "COPY FAILED");
    }
  };

  const handleBranchArchive = (branch) => {
    try {
      const result = planner.execute({ type: branch.archived ? "restore_branch" : "archive_branch", branchId: branch.id, actor: "human", ...commandMetadata(branch.archived ? "branch-restore" : "branch-archive") });
      if (!branch.archived) {
        setCompareLeftBranchId((value) => value === branch.id ? result.activeBranchId : value);
        setCompareRightBranchId((value) => value === branch.id ? result.activeBranchId : value);
      }
      notify(branch.archived ? "BRANCH RESTORED" : "BRANCH ARCHIVED");
    } catch (error) {
      notify(error.code ?? "BRANCH FAILED");
    }
  };

  const handleBranchDecision = (chosenBranchId, rejectedBranchId) => {
    try {
      planner.execute({ type: "record_branch_decision", chosenBranchId, rejectedBranchIds: [rejectedBranchId], comparisonId: branchComparison.comparisonId, note: decisionNote, actor: "human", actorId: "studio-operator", ...commandMetadata("branch-decision") });
      setDecisionNote("");
      setComparisonOpen(false);
      notify("DECISION RECORDED");
    } catch (error) {
      notify(error.code ?? "DECISION FAILED");
    }
  };

  const handleCompareBranches = () => {
    if (activeBranches.length < 2) return;
    const left = activeBranches.some((branch) => branch.id === compareLeftBranchId) ? compareLeftBranchId : activeBranches[0].id;
    const fallbackRight = activeBranches.find((branch) => branch.id !== left)?.id ?? left;
    setCompareLeftBranchId(left);
    setCompareRightBranchId(compareRightBranchId !== left && activeBranches.some((branch) => branch.id === compareRightBranchId) ? compareRightBranchId : fallbackRight);
    setComparisonOpen(true);
  };

  const handleSwitchBranch = (branchId) => {
    planner.execute({ type: "switch_branch", branchId, actor: "human", ...commandMetadata("switch-branch") });
    const next = planner.getSnapshot().proposal.changes[0];
    if (next) setSelectedChange(next.number);
    setViewMode("proposed");
  };

  const handleRebaseBranch = (branchId) => {
    try {
      const result = planner.execute({ type: "rebase_proposal", branchId, actor: "human", ...commandMetadata("rebase") });
      notify(result.status === "rebased" ? `v${result.toVersion} · REBASED` : "CURRENT");
    } catch {
      notify("CONFLICT");
    }
  };

  const handleConflictChoice = (conflict, outcome) => {
    if (outcome === "manual-resolution") {
      setAdjustment(`${conflict.type.toUpperCase()} · ${conflict.objectIds.join(" · ")}`);
      setAdjustmentOpen(true);
      return;
    }
    try {
      const result = planner.execute({ type: "resolve_conflict", branchId: plannerState.activeBranchId, conflictId: conflict.id, outcome, actor: "human", actorId: "studio-operator", ...commandMetadata("resolve-conflict") });
      notify(`${result.outcome.toUpperCase()} · ${result.remainingConflicts} CFT`);
    } catch (error) {
      notify(error.code ?? "CONFLICT");
    }
  };

  const handleAddLock = (event) => {
    event.preventDefault();
    try {
      const result = planner.execute({ type: "set_object_lock", objectId: lockObjectId, lockType, reasonCode: lockReason, actor: "human", actorId: "studio-operator", ...commandMetadata("set-lock") });
      notify(`${result.lockType.toUpperCase()} · LOCKED`);
    } catch (error) {
      notify(error.code ?? "LOCK FAILED");
    }
  };

  const handleReleaseLock = (lockId) => {
    try {
      planner.execute({ type: "release_object_lock", lockId, actor: "human", actorId: "studio-operator", ...commandMetadata("release-lock") });
      notify("LOCK · RELEASED");
    } catch (error) {
      notify(error.code ?? "RELEASE FAILED");
    }
  };

  const handleAddComment = (input) => {
    try {
      const result = planner.execute({ type: "add_comment", ...input, actor: "human", actorId: "studio-operator", ...commandMetadata("comment-add") });
      setSelectedCommentId(result.commentId);
      notify("COMMENT ADDED");
      return result;
    } catch (error) {
      notify(error.code ?? "COMMENT FAILED");
      return null;
    }
  };

  const handleEditComment = (comment, changes) => {
    try {
      planner.execute({ type: "edit_comment", commentId: comment.id, body: changes.body ?? comment.body, mentions: changes.mentions ?? comment.mentions, decisionRelevant: changes.decisionRelevant ?? comment.decisionRelevant, actor: "human", actorId: "studio-operator", ...commandMetadata("comment-edit") });
      notify("COMMENT SAVED");
    } catch (error) {
      notify(error.code ?? "COMMENT FAILED");
    }
  };

  const handleCommentStatus = (commentId, status) => {
    try {
      planner.execute({ type: "set_comment_status", commentId, status, actor: "human", actorId: "studio-operator", ...commandMetadata("comment-status") });
      notify(status === "resolved" ? "COMMENT DONE" : "COMMENT REOPENED");
    } catch (error) {
      notify(error.code ?? "COMMENT FAILED");
    }
  };

  const handleSelectComment = (commentId) => {
    setSelectedCommentId(commentId);
    setCommentsOpen(true);
  };

  const handleRunScenario = async (scenario, branchId) => {
    notify("SIM RUNNING");
    try {
      const result = await planner.execute({ type: "run_scenario", scenario, branchId, actor: "human", actorId: "studio-operator", ...commandMetadata("simulation") });
      notify(result.status === "completed" ? "SIM COMPLETE" : "SIM CANCELLED");
    } catch (error) {
      notify(error.code ?? "SIM FAILED");
    }
  };

  const handleExportSimulation = (runId) => {
    try {
      downloadExport(planner.execute({ type: "export_simulation", runId }));
      notify("SIM EXPORT READY");
    } catch (error) {
      notify(error.code ?? "SIM EXPORT FAILED");
    }
  };

  const handlePreviewQueueOption = (runId) => {
    try {
      const run = planner.execute({ type: "list_scenario_runs" }).find((item) => item.id === runId && item.status === "completed");
      const option = run?.result?.suggestion;
      const object = option?.change?.spatialEffects?.find((effect) => effect.operation === "add_object")?.object;
      if (!run || run.model !== "queue" || option?.preflight?.status !== "spatially-valid" || !object) throw new Error("QUEUE_OPTION_INVALID");
      if (planner.getSnapshot().activeBranchId !== run.branchId) planner.execute({ type: "switch_branch", branchId: run.branchId, actor: "human", actorId: "studio-operator", ...commandMetadata("queue-option-branch") });
      planner.execute({ type: "apply_edit", edit: { operation: "place", object, label: option.change.title, shortLabel: option.change.shortTitle, metrics: option.change.metrics }, actor: "human", actorId: "studio-operator", ...commandMetadata("queue-option") });
      const validationResult = planner.execute({ type: "validate_layout" });
      notify(validationResult.status === "pass" ? "QUEUE OPTION READY" : "QUEUE OPTION REVIEW");
    } catch (error) {
      notify(error.code ?? error.message ?? "QUEUE OPTION FAILED");
    }
  };

  return (
    <div className="app-shell">
      <ToolRegistration
        planner={planner}
        projectStore={projectStore}
        projectId={projectId}
        organizationId={organizationId}
        onLifecycle={setWebMcpLifecycle}
        navigate={navigate}
      />

      <header className="topbar">
        <div className="brand-block">
          <span className="brand-mark" aria-hidden="true"><img src="/assets/venuemind-mark.png" alt="" /></span>
          <span className="brand-name">VenueMind</span>
        </div>
        <div className="event-heading">
          <button type="button" className="event-name" onClick={() => navigate("/projects")}>{plannerState.plan.event.name} <CaretDown size={15} weight="bold" /></button>
          <span>{eventDate}</span><i aria-hidden="true" /><span>{plannerState.plan.venue.name}</span>
        </div>
        <nav className="top-actions" aria-label="Plan actions">
          <select className="organization-select" aria-label="Organization" value={organizationId} onChange={(event) => accountStore?.selectOrganization(event.target.value)}>{account?.organizations.map((organization) => <option value={organization.id} key={organization.id}>{organization.name}</option>)}</select>
          <a className="organization-settings-link" href="/settings/organization" onClick={(event) => navigateInternalLink(event, navigate, "/settings/organization")} aria-label="Organization settings">{account?.user?.displayName?.slice(0, 2).toUpperCase() || "ID"}</a>
          <SharingControls projectId={projectId} organizationId={organizationId} proposalId={plannerState.proposal.id} canManage={canManageSharing} />
          <Popover open={collaborationOpen} onOpenChange={setCollaborationOpen}>
            <div className="collaboration-control">
            <PopoverTrigger asChild><HeaderButton className={`collaboration-button is-${collaborationStatus.toLowerCase()}`} ariaLabel="Collaboration presence">LIVE {presence.length}<span className="status-dot" /></HeaderButton></PopoverTrigger>
            <PopoverContent className="collaboration-presence" align="end" sideOffset={8} role="status" aria-label="Active Project sessions">
              <header><b>{collaborationStatus}</b><span>{presence.length} SESS</span></header>
              {presence.map((item) => <div key={item.sessionId}><i>{item.displayName.slice(0, 2).toUpperCase()}</i><span><b>{item.displayName}</b><small>v{item.planVersion} · {item.focusedObjectId ?? "CANVAS"}</small></span></div>)}
            </PopoverContent>
            </div>
          </Popover>
          <Popover open={webMcpDiagnosticsOpen} onOpenChange={setWebMcpDiagnosticsOpen}>
            <div className="webmcp-control">
            <PopoverTrigger asChild><HeaderButton className={`status-button is-${webMcpLifecycle.state}`} ariaLabel="WebMCP status"><span className="status-dot" />WebMCP <span className="status-separator">|</span> <span>{webMcpLifecycle.state.toUpperCase()}</span><CaretDown size={14} /></HeaderButton></PopoverTrigger>
            <PopoverContent className="webmcp-diagnostics" align="start" sideOffset={8} role="status" aria-label="WebMCP diagnostics">
              <div><b>STATE</b><span>{webMcpLifecycle.state.toUpperCase()}</span></div>
              <div><b>CONTRACT</b><span>{VENUE_TOOL_CONTRACT_VERSION}</span></div>
              <div><b>TOOLS</b><span>{webMcpLifecycle.registered}/{webMcpLifecycle.total}</span></div>
              <div><b>SCOPES</b><span>{VENUE_TOOL_AUTHORIZATION_SCOPES.length}</span></div>
              <div><b>ERROR</b><span>{webMcpLifecycle.errorCode ?? "—"}</span></div>
            </PopoverContent>
            </div>
          </Popover>
          <HeaderButton className="history-button" ariaLabel="Open plan history" onClick={() => setHistoryOpen((open) => !open)}>Plan v{plannerState.plan.version}<span className={`save-indicator is-${persistenceStatus.toLowerCase()}`}>{persistenceStatus}</span><CaretDown size={14} /></HeaderButton>
          <HeaderButton className={`edit-button ${editorOpen ? "is-active" : ""}`} ariaLabel="Toggle plan editor" onClick={() => setEditorOpen((open) => !open)}>{editorOpen ? "REVIEW" : "EDIT"}</HeaderButton>
          <HeaderButton className={`comments-button ${commentsOpen ? "is-active" : ""}`} ariaLabel="Open comments" onClick={() => { setSimulationOpen(false); setCommentsOpen((open) => !open); }}><ChatCircle size={17} /> {plannerState.comments.filter((comment) => comment.status === "open").length}</HeaderButton>
          <HeaderButton className={`simulation-button ${simulationOpen ? "is-active" : ""}`} ariaLabel="Open simulations" onClick={() => { setCommentsOpen(false); setSimulationOpen((open) => !open); }}>SIM {plannerState.scenarioRuns.filter((run) => run.status === "completed").length}</HeaderButton>
          <button className="icon-button" type="button" onClick={handleUndo} aria-label="Undo"><ArrowCounterClockwise size={22} /></button>
          <button className="icon-button" type="button" onClick={handleRedo} aria-label="Redo"><ArrowCounterClockwise size={22} className="redo-icon" /></button>
          <DropdownMenu open={exportOpen} onOpenChange={setExportOpen}>
            <div className="export-control">
              <DropdownMenuTrigger asChild><HeaderButton className={`export-button ${exportOpen ? "is-active" : ""}`} ariaLabel="Export plan"><DownloadSimple size={19} /> Export <CaretDown size={14} /></HeaderButton></DropdownMenuTrigger>
              <DropdownMenuContent className="export-menu" align="end" sideOffset={8} aria-label="Export formats">
                {[['package', 'VM JSON', 'Portable'], ['pdf', 'PDF', 'Print'], ['pdf-emergency', 'EMERG PDF', 'Safety'], ['svg', 'SVG', 'Layers'], ['csv-objects', 'CSV OBJ', 'Objects'], ['csv-inventory', 'CSV INV', 'Inventory'], ['csv-staffing', 'CSV STAFF', 'Posts'], ['svg-post-map', 'POST MAP', 'Staff'], ['csv-production', 'CSV PROD', 'Equipment'], ['svg-production', 'PROD MAP', 'AV'], ['csv-catering-stations', 'CSV SERVICE', 'Stations'], ['csv-replenishment', 'CSV REPLEN', 'Routes'], ['audit', 'AUDIT', 'Ledger']].map(([format, label, meta]) => <DropdownMenuItem className="export-menu-item" key={format} onSelect={() => handleExport(format)}><b>{label}</b><span>{meta}</span></DropdownMenuItem>)}
              </DropdownMenuContent>
            </div>
          </DropdownMenu>
        </nav>
      </header>

      {syncConflict && <div className="sync-conflict-strip" role="alert" aria-label="Project synchronization conflict">
        <b>SYNC CONFLICT</b>
        <span>R{syncConflict.localRevision ?? "—"} ↔ R{syncConflict.remoteRevision}</span>
        <span>{syncConflict.overlappingFields.map((field) => field.toUpperCase()).join(" · ")}</span>
        {syncConflict.resolutions.includes("recover-proposal-branch") && <button type="button" onClick={handleRecoverProposalBranch}><GitBranch size={13} /> BRANCH</button>}
        <button type="button" onClick={handleUseRemoteRecord}>REMOTE</button>
      </div>}
      {legacyBriefMigration && <div className="sync-conflict-strip" role="alert" aria-label="Legacy Event Brief attestation required">
        <b>LEGACY BRIEF</b>
        <span>R{legacyBriefMigration.projectRevision}</span>
        <span>{legacyBriefMigration.briefFingerprint.toUpperCase()}</span>
        <button type="button" onClick={() => setLegacyBriefReviewOpen(true)}>REVIEW</button>
      </div>}

      <main className="workspace">
        <aside className="brief-panel">
          <section className="brief-section">
            <div className="eyebrow-row"><span className="eyebrow">Event brief</span><button type="button" className="text-button" onClick={openBriefEditor}>Edit</button></div>
            <h1>{plannerState.plan.event.program}</h1>
            <p className="attendee-count">{brief.attendeeTarget} attendees · {brief.occupancyMode}</p>
            <div className="brief-summary"><span>{brief.summary.satisfied}/{brief.summary.total} covered</span><span>{brief.summary.unresolved} open</span>{brief.summary.ambiguous > 0 && <span>{brief.summary.ambiguous} ambiguous</span>}</div>
            <ul className="brief-list">{brief.requirements.map((requirement) => {
              const Icon = briefIcons[requirement.category] ?? ListBullets;
              const coverage = brief.coverage.find((item) => item.requirementId === requirement.id)?.status ?? "unmeasured";
              return <BriefItem key={requirement.id} icon={Icon}><span className="brief-label">{requirement.label}</span><small className={`coverage-badge is-${coverage}`}>{coverage}</small></BriefItem>;
            })}</ul>
            <p className="last-updated">{persistenceStatus} · {brief.timezone}</p>
          </section>

          <section className="agent-section">
            <div className="eyebrow-row"><span className="eyebrow agent-eyebrow"><Sparkle size={18} weight="fill" /> Plan analysis</span><span className="summary-time">09:41</span></div>
            <div className="agent-metrics" aria-label="Plan analysis metrics">
              <span><strong>{accessEvidence.connected ? `${accessEvidence.minimumClearWidthM}m` : "FAIL"}</strong><small>Access</small></span>
              <span><strong>{Math.round(sightlineEvidence.coverageRatio * 100)}%</strong><small>Sightlines</small></span>
              <span><strong>{capacityEvidence.effectiveCapacity}</strong><small>Capacity</small></span>
            </div>
            <p className="proposal-count">{proposalState === "approved" ? `${changes.length} changes · applied` : `${changes.length} changes · ${validation.unresolvedIssues} conflicts`}</p>
            <div className="change-list" role="list" aria-label="Proposed changes">
              {changes.map((change) => (
                <button type="button" role="listitem" key={change.id} className={`change-row ${selectedChange === change.number ? "is-active" : ""}`} onClick={() => setSelectedChange(change.number)}>
                  <span className="change-number">{change.number}</span><span>{change.title}</span>
                </button>
              ))}
            </div>
            {activeChange && <div className="change-detail">
              <div className="detail-heading"><strong>Change {activeChange.number}</strong><span>Impact</span></div>
              <div className="detail-metrics">{activeChange.metrics.map(([label, value]) => <span key={label}><small>{label}</small><strong>{value}</strong></span>)}{activeCapacityDelta && <span><small>Capacity Δ</small><strong>{activeCapacityDelta.effectiveCapacityDelta > 0 ? "+" : ""}{activeCapacityDelta.effectiveCapacityDelta}</strong></span>}</div>
            </div>}

            {activeConflictState.conflicts.length > 0 && <div className="conflict-panel" aria-label="Proposal conflicts">
              <div className="conflict-heading"><strong>CONFLICTS</strong><span>{activeConflictState.conflicts.length} CFT</span></div>
              {activeConflictState.conflicts.map((conflict) => <div className="conflict-row" key={conflict.id}><span><strong>{conflict.type.toUpperCase()}</strong><small>{conflict.objectIds.length ? conflict.objectIds.join(" · ") : `${conflict.baseVersion} → ${conflict.currentVersion}`}</small></span><div>{conflict.resolutionOptions.includes("rebase") && <button type="button" onClick={() => handleRebaseBranch(plannerState.activeBranchId)}>REBASE</button>}{conflict.resolutionOptions.some((option) => ["keep-plan", "drop-change"].includes(option)) && <button type="button" onClick={() => handleConflictChoice(conflict, "keep-plan")}>KEEP PLAN</button>}{conflict.resolutionOptions.includes("keep-proposal") && <button type="button" onClick={() => handleConflictChoice(conflict, "keep-proposal")}>KEEP PROPOSAL</button>}{conflict.resolutionOptions.some((option) => ["manual-resolution", "revise-proposal"].includes(option)) && <button type="button" onClick={() => handleConflictChoice(conflict, "manual-resolution")}>MANUAL</button>}</div></div>)}
            </div>}

            {warningChecks.length > 0 && <div className="waiver-panel" aria-label="Warning Waivers">
              <div className="waiver-heading"><strong>Warnings</strong><span>{validation.waivedWarnings} WAIVED · {validation.unwaivedWarnings} OPEN</span></div>
              {warningChecks.map((check) => <div className={`waiver-row ${check.waiver ? "is-waived" : ""}`} key={check.constraintId}>
                <span><strong>{check.label}</strong><small>{check.actual} / {check.threshold} {check.unit}</small></span>
                {check.waiver ? <b>WAIVED</b> : <button type="button" onClick={() => handleWarningWaiver(check.constraintId)}>Waive</button>}
              </div>)}
              {openWarningChecks.length > 0 && <select aria-label="Waiver reason" value={waiverReason} onChange={(event) => setWaiverReason(event.target.value)}>
                <option value="operational-acceptance">Operational acceptance</option>
                <option value="temporary-condition">Temporary condition</option>
                <option value="equivalent-control">Equivalent control</option>
                <option value="owner-approved-deviation">Owner-approved deviation</option>
              </select>}
            </div>}

            {adjustmentOpen && (
              <form className="adjustment-form" onSubmit={handleAdjustmentSubmit}>
                <label htmlFor="adjustment">Adjustment</label>
                <textarea id="adjustment" value={adjustment} onChange={(event) => setAdjustment(event.target.value)} placeholder="ADJUSTMENT" autoFocus />
                <div className="form-actions"><button type="button" onClick={() => setAdjustmentOpen(false)}>Cancel</button><button type="submit">Send</button></div>
              </form>
            )}

            {validation.emergencyReviewRequired && <div className="emergency-review-panel" aria-label="Emergency Review">
              <div><strong>EMERGENCY REVIEW</strong><span>{validation.emergencyChangedObjectIds.length} OBJ</span></div>
              <input aria-label="Emergency reviewer ID" placeholder="REVIEWER ID" value={emergencyReviewerId} onChange={(event) => setEmergencyReviewerId(event.target.value)} />
              <select aria-label="Emergency reviewer role" value={emergencyReviewerRole} onChange={(event) => setEmergencyReviewerRole(event.target.value)}><option value="safety-officer">SAFETY OFFICER</option><option value="venue-administrator">VENUE ADMIN</option></select>
              <label><input type="checkbox" checked={emergencyAssumptionsAccepted} onChange={(event) => setEmergencyAssumptionsAccepted(event.target.checked)} /> ASSUMPTIONS</label>
            </div>}

            <div className="decision-actions">
              <button className={`primary-action ${proposalState === "approved" ? "is-approved" : ""}`} type="button" onClick={handleApprove} disabled={proposalState === "approved" || changes.length === 0 || validation.status !== "pass" || validation.unwaivedWarnings > 0 || (validation.emergencyReviewRequired && (!emergencyReviewerId.trim() || !emergencyAssumptionsAccepted))}><Check size={20} weight="bold" />{changes.length === 0 ? "0 changes" : proposalState === "approved" ? "Proposal approved" : validation.status !== "pass" ? `${validation.blockingIssues} blocked` : validation.unwaivedWarnings > 0 ? `${validation.unwaivedWarnings} waiver required` : validation.emergencyReviewRequired && (!emergencyReviewerId.trim() || !emergencyAssumptionsAccepted) ? "Review required" : "Approve proposal"}</button>
              <button className="secondary-action" type="button" onClick={() => setAdjustmentOpen((open) => !open)}><ChatCircle size={20} /> Request adjustment</button>
            </div>
          </section>
        </aside>

        <section className="canvas-column" aria-label="Venue plan workspace">
          <div className={`plan-canvas mode-${viewMode} state-${proposalState} ${editorOpen ? "is-editing" : ""}`}>
            {projectId === "project-summit-forward" ? <img className="floorplan-image" src="/assets/venue-floorplan.png" alt="Top-down floor plan of Harborview Convention Center" /> : <div className="empty-plan-surface"><strong>24 × 16 m</strong><span>0 OBJ</span></div>}
            {objectIds.has("obj-stage-west") && <div className="canvas-lock lock-stage"><MapPin size={17} weight="fill" /><span><strong>Locked</strong> Stage position</span></div>}
            {objectIds.has("obj-fire-exit-east") && <div className="canvas-lock lock-exit"><MapPin size={17} weight="fill" /><span><strong>Locked</strong> Fire exit</span></div>}
            {objectIds.has("obj-column-southwest") && <div className="canvas-lock lock-column"><MapPin size={17} weight="fill" /><span><strong>Locked</strong> Column</span></div>}

            <svg className="evidence-overlay" viewBox="0 0 30 20" role="img" aria-label="Spatial Validation evidence">
              <title>Spatial Validation evidence</title>
              <defs><pattern id="restricted-hatch" width=".32" height=".32" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line className="restricted-hatch-line" x1="0" y1="0" x2="0" y2=".32" /></pattern><pattern id="clearance-hatch" width=".24" height=".24" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><line className="clearance-hatch-line" x1="0" y1="0" x2="0" y2=".24" /></pattern></defs>
              <g className="restricted-evidence">{restrictedZones.map((object) => <polygon key={object.id} points={footprintPoints(object.footprint)} />)}</g>
              <g className="door-clearance-evidence">{accessEvidence.doorClearanceZones.filter((zone) => zone.points.length).map((zone) => <polygon className={`is-${zone.status}`} key={zone.id} points={zone.points.map((point) => `${point.x},${20 - point.y}`).join(" ")} />)}</g>
              <g className="exit-approach-evidence">{circulationEvidence.exitApproachZones.map((zone) => <polygon className={`is-${zone.status}`} key={zone.id} points={zone.points.map((point) => `${point.x},${20 - point.y}`).join(" ")} />)}</g>
              <g className="opening-evidence">{doorObjects.map((object) => <line className="is-door" key={object.id} x1={object.footprint.start.x} y1={20 - object.footprint.start.y} x2={object.footprint.end.x} y2={20 - object.footprint.end.y} />)}{exitObjects.map((object) => <line className="is-exit" key={object.id} x1={object.footprint.start.x} y1={20 - object.footprint.start.y} x2={object.footprint.end.x} y2={20 - object.footprint.end.y} />)}</g>
              <g className="route-evidence">{accessEvidence.edges.map((edge) => {
                const start = graphNodes.get(edge.startNodeId);
                const end = graphNodes.get(edge.endNodeId);
                const loadIndex = routeLoadByObjectId.get(edge.objectId) ?? 0;
                return <line className={edge.blockedByObjectIds.length ? "is-blocked" : loadIndex >= 50 ? "is-high-load" : loadIndex > 0 ? "is-loaded" : ""} key={edge.id} x1={start.x} y1={20 - start.y} x2={end.x} y2={20 - end.y} style={{ strokeWidth: Math.max(.12, edge.widthM / 8) }} />;
              })}{accessEvidence.nodes.map((node) => <circle key={node.id} cx={node.point.x} cy={20 - node.point.y} r=".12" />)}</g>
              {analysisOpen && <g className="sightline-evidence">{sightlineEvidence.rays.map((ray) => <line className={`is-${ray.status} ${accessEvidence.accessibleSeatSampleIds.includes(ray.sampleId) ? "is-accessible-seat" : ""}`} key={ray.id} x1={ray.start.x} y1={20 - ray.start.y} x2={ray.end.x} y2={20 - ray.end.y} />)}</g>}
              {simulationOverlay && <g className="density-evidence" aria-label={`Density frame ${simulationOverlay.frame.second} seconds`}>{simulationOverlay.frame.cells.filter((cell) => cell.occupancyPersons > 0).map((cell) => <circle className={`is-${cell.level} is-${cell.kind}`} key={cell.id} cx={cell.point.x} cy={20 - cell.point.y} r={Math.max(.32, Math.min(1.65, .28 + Math.sqrt(cell.densityPersonsPerM2) * .52))} data-object-id={cell.objectId}><title>{cell.objectId} · {cell.densityPersonsPerM2} p/m² · {cell.occupancyPersons}</title></circle>)}</g>}
            </svg>
            {simulationOverlay && <div className="density-status"><b>DENSITY</b><span>{Math.floor(simulationOverlay.frame.second / 60)}:{String(Math.round(simulationOverlay.frame.second % 60)).padStart(2, "0")}</span><i>{simulationOverlay.frame.peakDensityPersonsPerM2} P/M²</i></div>}
            {!editorOpen && <svg className="annotation-overlay" viewBox="0 0 30 20" aria-label="Coordinate comments"><AnnotationPins comments={plannerState.comments} planVersion={plannerState.plan.version} maxY={20} selectedCommentId={selectedCommentId} onSelect={handleSelectComment} /></svg>}

            {editorOpen && <PlanEditor plan={plannerState.plan} proposal={plannerState.proposal} validation={validation} comments={plannerState.comments} selectedCommentId={selectedCommentId} onSelectComment={handleSelectComment} onEdit={handleEdit} onMeasure={handleMeasure} layoutPresets={[{ id: "layout-conference-400", label: "CONF 400", roomBoundary: summitForwardPlan.spatial.roomBoundary, objects: summitForwardPlan.objects }]} />}

            {!editorOpen && <div className="proposal-overlays" aria-label="Agent proposal changes">
              {changes.map((change) => {
                const conflict = lockConflicts.find((item) => item.changeId === change.id);
                return <button key={change.id} className={`proposal-shape shape-${["one", "two", "three", "four"][change.number - 1]} ${selectedChange === change.number ? "selected" : ""} ${conflict ? "is-lock-conflict" : ""}`} onClick={() => setSelectedChange(change.number)} aria-label={`Select change ${change.number}${conflict ? `, ${conflict.lockType} Lock conflict` : ""}`}><span>{change.number}</span>{conflict && <b>LOCK · {conflict.lockType.toUpperCase()} · {conflict.source === "project" ? "PROJECT" : "TEMPLATE"}</b>}</button>;
              })}
              {activeChange && <div className={`canvas-callout callout-${selectedChange}`}>
                <span className="callout-kicker">Change {activeChange.number}</span><strong>{activeChange.shortTitle}</strong>
                {lockConflicts.filter((item) => item.changeId === activeChange.id).map((conflict) => <span className="callout-lock" key={conflict.id}>{conflict.lockType.toUpperCase()} · {conflict.source === "project" ? "PROJECT" : "TEMPLATE"} · {conflict.objectId}</span>)}
                <div className="callout-metrics">{activeChange.metrics.map(([label, value]) => <span key={label}><small>{label}</small><b>{value}</b></span>)}</div>
                <button type="button" onClick={handleRevertChange}><ArrowCounterClockwise size={16} /> Revert</button>
              </div>}
            </div>}
            <div className="canvas-legend"><span><i className="legend-before" /> Before (v{plannerState.proposal.baseVersion})</span><span><i className="legend-proposed" /> Proposed (v{proposedVersion})</span><span><i className="legend-door" /> Door</span><span><i className="legend-clearance" /> Clearance</span><span><i className="legend-egress" /> Egress</span><span><i className="legend-restricted" /> Restricted</span><span><i className="legend-route" /> Route graph</span>{simulationOverlay && <span><i className="legend-density" /> Density</span>}{analysisOpen && <span><i className="legend-ray" /> Sightline rays</span>}</div>
          </div>

          <div className="comparison-bar">
            <div className="compare-group">
              <span className="bar-label">Compare</span>
              <div className="segmented-control" role="tablist" aria-label="Compare plan states">
                <button className={viewMode === "before" ? "active" : ""} onClick={() => setViewMode("before")} type="button" role="tab"><Eye size={16} /> Before</button>
                <button className={viewMode === "proposed" ? "active" : ""} onClick={() => setViewMode("proposed")} type="button" role="tab"><Sparkle size={16} /> Proposed</button>
                <button className={viewMode === "split" ? "active" : ""} onClick={() => setViewMode("split")} type="button" role="tab"><Columns size={16} /> Split</button>
              </div>
            </div>
            <div className="outcomes-group">
              <span className="bar-label">Outcomes</span>
              <div className="outcome-row"><div className="outcome"><Check size={18} weight="bold" /><span><strong>Accessible route</strong><small>{accessEvidence.minimumClearWidthM} m · {accessEvidence.reachableDestinationIds.length} destinations</small></span></div><div className="outcome"><Check size={18} weight="bold" /><span><strong>Sightline coverage</strong><small>{sightlineEvidence.sampledSeatIds.length - sightlineEvidence.blockedSampleIds.length}/{sightlineEvidence.sampledSeatIds.length} clear · {sightlineEvidence.maximumViewingDistanceM} m</small></span></div></div>
            </div>
            <button className="analysis-button" type="button" onClick={() => setAnalysisOpen((open) => !open)}>{analysisOpen ? "Hide analysis" : "View analysis"}</button>
          </div>

          {analysisOpen && <div className="analysis-drawer"><div><Wheelchair size={18} /><span><strong>Route graph</strong><small>{accessEvidence.minimumClearWidthM} m · {accessEvidence.graphFingerprint}</small></span></div><div><UsersThree size={18} /><span><strong>Accessible seats</strong><small>{accessEvidence.accessibleSeatSampleIds.length} samples · {accessEvidence.blockedAccessibleSeatSampleIds.length} blocked</small></span></div><div><MapPin size={18} /><span><strong>Door clearance</strong><small>{accessEvidence.doorClearanceZones.length} zones · {accessEvidence.obstructedDoorObjectIds.length} blocked</small></span></div><div><UsersThree size={18} /><span><strong>Occupancy</strong><small>{capacityEvidence.placedCapacity} placed · {capacityEvidence.operationalLoad}/{capacityEvidence.venueMaximum} load</small></span></div><div><PersonSimple size={18} /><span><strong>Circulation</strong><small>{circulationEvidence.shortestExitPaths.length} paths · {circulationEvidence.peakCongestionIndex} peak</small></span></div><div><Eye size={18} /><span><strong>Sightlines</strong><small>{sightlineEvidence.sampledSeatIds.length} rays · {sightlineEvidence.blockedSampleIds.length} blocked</small></span></div><button type="button" onClick={() => setAnalysisOpen(false)} aria-label="Close analysis"><X size={18} /></button></div>}
        </section>
      </main>
      {historyOpen && (
        <aside className="history-drawer" aria-label="Plan history">
          <div className="history-heading"><div><span className="eyebrow">Plan control</span><strong>v{plannerState.plan.version}</strong></div><button type="button" onClick={() => { setHistoryOpen(false); setComparisonOpen(false); }} aria-label="Close plan history"><X size={18} /></button></div>
          <div className="history-tabs" role="tablist" aria-label="Plan control views">
            <button type="button" role="tab" className={historyTab === "versions" ? "active" : ""} onClick={() => setHistoryTab("versions")}><ClockCounterClockwise size={15} /> Versions</button>
            <button type="button" role="tab" className={historyTab === "ledger" ? "active" : ""} onClick={() => setHistoryTab("ledger")}><ListBullets size={15} /> Ledger</button>
            <button type="button" role="tab" className={historyTab === "branches" ? "active" : ""} onClick={() => setHistoryTab("branches")}><GitBranch size={15} /> Branches</button>
            <button type="button" role="tab" className={historyTab === "locks" ? "active" : ""} onClick={() => setHistoryTab("locks")}><MapPin size={15} /> Locks</button>
          </div>

          {historyTab === "versions" && <div className="history-list">{versionEvents.map((entry) => {
            const version = entry.details.toVersion ?? entry.details.version ?? plannerState.plan.version;
            return <div className="history-row" key={entry.id}><span className="history-node" /><div><strong>v{version}</strong><small>{entry.type}</small></div><time>{entry.occurredAt.slice(11, 16)}</time></div>;
          })}</div>}

          {historyTab === "ledger" && <div className="history-list">{plannerState.ledger.slice().reverse().map((entry) => <div className="ledger-row" key={entry.id}><span className={`actor-badge is-${entry.actor}`}>{entry.actor === "agent" ? "AI" : entry.actor === "human" ? "HU" : "SY"}</span><div><strong>{entry.type}</strong><small>#{String(entry.sequence).padStart(3, "0")}</small></div><time>{entry.occurredAt.slice(11, 16)}</time></div>)}</div>}

          {historyTab === "branches" && <div className="branch-panel">
            <div className="branch-compare-controls"><label><span>A</span><select aria-label="Comparison branch A" value={compareLeftBranchId} onChange={(event) => setCompareLeftBranchId(event.target.value)}>{activeBranches.map((branch) => <option value={branch.id} key={branch.id}>{branch.name}</option>)}</select></label><label><span>B</span><select aria-label="Comparison branch B" value={compareRightBranchId} onChange={(event) => setCompareRightBranchId(event.target.value)}>{activeBranches.map((branch) => <option value={branch.id} key={branch.id}>{branch.name}</option>)}</select></label><button type="button" disabled={activeBranches.length < 2 || compareLeftBranchId === compareRightBranchId} onClick={handleCompareBranches}><Columns size={14} /> Compare</button></div>
            <div className="branch-list">{branches.map((branch) => <div className={`branch-entry ${branch.active ? "active" : ""} ${branch.archived ? "is-archived" : ""}`} key={branch.id}><button type="button" className={`branch-card ${branch.active ? "active" : ""}`} disabled={branch.archived} onClick={() => handleSwitchBranch(branch.id)}><span><GitBranch size={15} /><strong>{branch.name}</strong></span><span className={`branch-status is-${branch.stale ? "fail" : branch.validationStatus}`}>{branch.archived ? "ARCH" : branch.decisionStatus ? branch.decisionStatus.toUpperCase() : branch.stale ? "STALE" : branch.validationStatus.toUpperCase()}</span><small>{branch.changedItems} CHG · {branch.revisionCount} REV</small><b>v{branch.baseVersion}</b></button><div className="branch-actions"><select aria-label={`${branch.name} revision`} value={branchRevisionSelections[branch.id] ?? branch.proposalId} onChange={(event) => setBranchRevisionSelections((current) => ({ ...current, [branch.id]: event.target.value }))}>{branch.revisions.toReversed().map((revision) => <option key={revision.proposalId} value={revision.proposalId}>R{revision.revision}{revision.current ? "·" : ""}</option>)}</select><button type="button" onClick={() => handleDuplicateBranch(branch.id)}>DUP</button><button type="button" onClick={() => handleBranchArchive(branch)}>{branch.archived ? "RST" : "ARC"}</button>{branch.stale && !branch.archived && <button type="button" onClick={() => handleRebaseBranch(branch.id)}>RBS</button>}</div></div>)}</div>
            {activeBranch && <div className="branch-meta"><input key={`${activeBranch.id}-${activeBranch.name}`} aria-label="Branch name" defaultValue={activeBranch.name} onBlur={(event) => handleBranchMetadata(activeBranch, { name: event.currentTarget.value })} /><textarea key={`${activeBranch.id}-${activeBranch.notes}`} aria-label="Branch notes" placeholder="NOTES" defaultValue={activeBranch.notes} onBlur={(event) => handleBranchMetadata(activeBranch, { notes: event.currentTarget.value })} /></div>}
            <button className="new-branch" type="button" onClick={handleCreateBranch}><Plus size={16} /> New branch</button>
          </div>}

          {historyTab === "locks" && <div className="lock-panel"><form className="lock-form" onSubmit={handleAddLock}><select aria-label="Lock object" value={lockObjectId} onChange={(event) => setLockObjectId(event.target.value)}>{plannerState.plan.objects.map((object) => <option key={object.id} value={object.id}>{object.label}</option>)}</select><select aria-label="Lock type" value={lockType} onChange={(event) => setLockType(event.target.value)}>{["position", "rotation", "dimension", "deletion", "role"].map((type) => <option key={type}>{type}</option>)}</select><input aria-label="Lock reason code" value={lockReason} onChange={(event) => setLockReason(event.target.value)} required /><button type="submit">Add lock</button></form><div className="lock-list">{activeLocks.map((lock) => <div className={`lock-row is-${lock.source}`} key={lock.id}><span><strong>{lock.label}</strong><small>{lock.objectId}</small></span><b>{lock.type.toUpperCase()}</b><em>{lock.source === "project" ? "PROJECT" : "TEMPLATE"}</em>{lock.source === "project" && <button type="button" onClick={() => handleReleaseLock(lock.id)}>Release</button>}</div>)}</div></div>}
        </aside>
      )}
      {commentsOpen && <CommentsPanel state={plannerState} selectedCommentId={selectedCommentId} onAdd={handleAddComment} onEdit={handleEditComment} onStatus={handleCommentStatus} onClose={() => setCommentsOpen(false)} />}
      {simulationOpen && <ScenarioPanel branches={branches} runs={plannerState.scenarioRuns} onClose={() => { setSimulationOpen(false); setSimulationOverlay(null); }} onRun={handleRunScenario} onCompare={(leftRunId, rightRunId) => planner.execute({ type: "compare_simulations", leftRunId, rightRunId })} onExport={handleExportSimulation} onOverlayChange={setSimulationOverlay} onPreviewOption={handlePreviewQueueOption} />}
      {comparisonOpen && branchComparison && <aside className="branch-comparison" aria-label="Proposal Branch comparison">
        <div className="branch-comparison-heading"><div><span className="eyebrow">Branch comparison</span><strong>{branchComparison.comparisonId}</strong></div><button type="button" onClick={() => setComparisonOpen(false)} aria-label="Close branch comparison"><X size={18} /></button></div>
        <div className="branch-comparison-columns"><div><small>A · {branchComparison.left.strategy}</small><strong>{branchComparison.left.name}</strong><span className={`branch-status is-${branchComparison.left.validationStatus}`}>{branchComparison.left.validationStatus.toUpperCase()} · {branchComparison.left.changedItems} CHG</span><em>{branchComparison.left.notes || "—"}</em><code>{branchComparison.left.geometryFingerprint}</code></div><div><small>B · {branchComparison.right.strategy}</small><strong>{branchComparison.right.name}</strong><span className={`branch-status is-${branchComparison.right.validationStatus}`}>{branchComparison.right.validationStatus.toUpperCase()} · {branchComparison.right.changedItems} CHG</span><em>{branchComparison.right.notes || "—"}</em><code>{branchComparison.right.geometryFingerprint}</code></div></div>
        {comparisonView && <div className="comparison-overlay"><div className="comparison-overlay-key"><span className="is-plan">PLAN</span><span className="is-left">A</span><span className="is-right">B</span></div><svg viewBox={comparisonView.viewBox} aria-label="Accepted Plan and Proposal Branch overlay"><polygon className="comparison-room" points={comparisonView.boundaryPoints} />{branchComparison.overlay.acceptedObjects.map((object) => <ComparisonShape key={`plan-${object.id}`} object={object} maxY={comparisonView.maxY} className="is-plan" />)}{branchComparison.overlay.leftObjects.filter((object) => comparisonView.leftChangedIds.has(object.id)).map((object) => <ComparisonShape key={`left-${object.id}`} object={object} maxY={comparisonView.maxY} className="is-left" />)}{branchComparison.overlay.rightObjects.filter((object) => comparisonView.rightChangedIds.has(object.id)).map((object) => <ComparisonShape key={`right-${object.id}`} object={object} maxY={comparisonView.maxY} className="is-right" />)}</svg></div>}
        <div className="branch-comparison-section"><span className="eyebrow">Metrics</span><div className="comparison-metric-table">{branchComparison.metricDeltas.map((metric) => <div className="comparison-metric-row" key={metric.metric}><strong>{metric.label}</strong><span>{formatComparisonMetric(metric, metric.left)}</span><span>{formatComparisonMetric(metric, metric.right)}</span><b className={metric.delta === 0 ? "is-neutral" : ""}>{formatComparisonMetric(metric, metric.delta, true)}</b></div>)}</div></div>
        <div className="branch-comparison-section"><span className="eyebrow">Constraints</span><div className="comparison-constraint-table">{branchComparison.constraintDeltas.map((constraint) => <div className="comparison-constraint-row" key={constraint.constraintId}><strong>{constraint.label}</strong><span className={`is-${constraint.leftStatus}`}>{constraint.leftStatus.toUpperCase()}</span><span className={`is-${constraint.rightStatus}`}>{constraint.rightStatus.toUpperCase()}</span><b className={`is-${constraint.outcome}`}>{constraint.outcome.toUpperCase()}</b></div>)}</div></div>
        <div className="branch-comparison-section"><span className="eyebrow">Spatial deltas</span><div className="comparison-object-groups">{[["Moved", branchComparison.objectDeltas.movedObjectIds], ["Rotated", branchComparison.objectDeltas.rotatedObjectIds], ["Resized", branchComparison.objectDeltas.resizedObjectIds], ["Added", branchComparison.objectDeltas.addedObjectIds], ["Removed", branchComparison.objectDeltas.removedObjectIds], ["Metadata", branchComparison.objectDeltas.metadataObjectIds]].map(([label, ids]) => <div key={label}><strong>{label}</strong><b>{ids.length}</b><small>{ids.join(" · ") || "—"}</small></div>)}</div></div>
        <div className="comparison-decision"><input aria-label="Decision note" placeholder="DECISION NOTE" value={decisionNote} onChange={(event) => setDecisionNote(event.target.value)} /><button type="button" onClick={() => handleBranchDecision(branchComparison.left.branchId, branchComparison.right.branchId)}>CHOOSE A</button><button type="button" onClick={() => handleBranchDecision(branchComparison.right.branchId, branchComparison.left.branchId)}>CHOOSE B</button></div>
      </aside>}
      {legacyBriefMigration && legacyBriefReviewOpen && <aside className="brief-editor legacy-brief-review" aria-label="Legacy Event Brief review">
        <div className="brief-editor-heading"><div><span className="eyebrow">Legacy brief</span><strong>{legacyBriefMigration.briefFingerprint}</strong></div><button type="button" onClick={() => setLegacyBriefReviewOpen(false)} aria-label="Close legacy Event Brief review"><X size={18} /></button></div>
        <div className="brief-fields">
          <label><span>Event</span><b>{legacyBriefMigration.brief.eventName}</b></label>
          <label><span>Date</span><b>{legacyBriefMigration.brief.date ?? "—"}</b></label>
          <label><span>Timezone</span><b>{legacyBriefMigration.brief.timezone}</b></label>
          <label><span>Attendance</span><b>{legacyBriefMigration.brief.attendeeTarget}</b></label>
          <label><span>Occupancy</span><b>{legacyBriefMigration.brief.occupancyMode}</b></label>
          <label><span>Schedule</span><b>{legacyBriefMigration.brief.schedule ? `${legacyBriefMigration.brief.schedule.startAt} · ${legacyBriefMigration.brief.schedule.endAt}` : "—"}</b></label>
        </div>
        <div className="requirement-editor-heading"><span className="eyebrow">Requirements</span><small>{legacyBriefMigration.brief.requirements.length} REQ</small></div>
        <div className="requirement-editor-list">{legacyBriefMigration.brief.requirements.map((requirement) => <div className="requirement-editor-row" key={requirement.id}>
          <span className="requirement-label"><small>{requirement.category}</small><b>{requirement.label}</b></span>
          <b>{requirement.priority.toUpperCase()}</b><b>{requirement.status.toUpperCase()}</b><span className={`requirement-link ${requirement.constraintIds.length > 0 ? "is-linked" : ""}`}>{requirement.constraintIds.length} C</span>
        </div>)}</div>
        <div className="brief-editor-actions"><button type="button" onClick={() => setLegacyBriefReviewOpen(false)}>CLOSE</button><button type="button" className="legacy-adopt-button" onClick={handleLegacyBriefAttestation}>ADOPT</button></div>
      </aside>}
      {briefOpen && briefDraft && (
        <aside className="brief-editor" aria-label="Event Brief editor">
          <form onSubmit={handleBriefSave}>
            <div className="brief-editor-heading"><div><span className="eyebrow">Event brief</span><strong>{briefDraft.id}</strong></div><button type="button" onClick={() => setBriefOpen(false)} aria-label="Close Event Brief"><X size={18} /></button></div>
            <div className="brief-fields">
              <label><span>Event</span><input value={briefDraft.eventName} onChange={(event) => updateBriefField("eventName", event.target.value)} required /></label>
              <label><span>Date</span><input type="date" value={briefDraft.date ?? ""} onChange={(event) => updateBriefField("date", event.target.value || null)} /></label>
              <label><span>Timezone</span><input value={briefDraft.timezone} onChange={(event) => updateBriefField("timezone", event.target.value)} required /></label>
              <label><span>Attendance</span><input type="number" min="0" step="1" value={briefDraft.attendeeTarget} onChange={(event) => updateBriefField("attendeeTarget", Number(event.target.value))} required /></label>
              <label><span>Occupancy</span><select value={briefDraft.occupancyMode} onChange={(event) => updateBriefField("occupancyMode", event.target.value)}>{["theater", "classroom", "banquet", "standing", "mixed", "custom"].map((mode) => <option key={mode}>{mode}</option>)}</select></label>
            </div>
            <div className="requirement-editor-heading"><span className="eyebrow">Requirements</span><div><small>{brief.summary.unresolved} open</small><select aria-label="Requirement filter" value={briefFilter} onChange={(event) => setBriefFilter(event.target.value)}><option value="all">all</option><option value="unresolved">unresolved</option><option value="ambiguous">ambiguous</option></select></div></div>
            <div className="requirement-editor-list">{briefDraft.requirements.filter((requirement) => {
              if (briefFilter === "ambiguous") return brief.ambiguities.some((item) => item.requirementId === requirement.id);
              if (briefFilter === "unresolved") return ["blocked", "warning", "unmeasured"].includes(brief.coverage.find((item) => item.requirementId === requirement.id)?.status);
              return true;
            }).map((requirement) => <div className="requirement-editor-row" key={requirement.id}>
              <label className="requirement-label"><span>{requirement.category}</span><input value={requirement.label} onChange={(event) => updateRequirement(requirement.id, "label", event.target.value)} required /></label>
              <select aria-label={`${requirement.label} priority`} value={requirement.priority} onChange={(event) => updateRequirement(requirement.id, "priority", event.target.value)}>{["critical", "high", "medium", "low"].map((priority) => <option key={priority}>{priority}</option>)}</select>
              <select aria-label={`${requirement.label} status`} value={requirement.status} onChange={(event) => updateRequirement(requirement.id, "status", event.target.value)}>{["open", "confirmed", "satisfied", "waived"].map((status) => <option key={status}>{status}</option>)}</select>
              <span className={`requirement-link ${requirement.constraintIds.length > 0 ? "is-linked" : ""}`}>{requirement.constraintIds.length} C</span>
            </div>)}</div>
            <div className="brief-editor-actions"><button type="button" onClick={() => setBriefOpen(false)}>Cancel</button><button type="submit">Save brief</button></div>
          </form>
        </aside>
      )}
      {toast && <div className="toast" role="status"><CircleNotch size={18} weight="bold" />{toast}</div>}
    </div>
  );
}
