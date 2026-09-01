import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarCheck,
  Check,
  CircleDot,
  Clipboard,
  Cloud,
  CloudOff,
  Download,
  FileCheck,
  MoreHorizontal,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  SkipForward,
  X,
} from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../components/ui/empty";
import { Field, FieldError, FieldGroup, FieldLabel } from "../components/ui/field";
import { Input } from "../components/ui/input";
import { Progress } from "../components/ui/progress";
import { ScrollArea } from "../components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Separator } from "../components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "../components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { cn } from "../lib/utils";

const DEFAULT_PHASES = Object.freeze([
  { id: "setup", label: "SETUP" },
  { id: "doors", label: "DOORS" },
  { id: "live", label: "LIVE" },
  { id: "interval", label: "INTERVAL" },
  { id: "egress", label: "EGRESS" },
  { id: "breakdown", label: "BREAKDOWN" },
]);

const DEFAULT_ROLES = Object.freeze([
  { id: "production", label: "PRODUCTION" },
  { id: "front-of-house", label: "FOH" },
  { id: "security", label: "SECURITY" },
  { id: "catering", label: "CATERING" },
  { id: "venue-operations", label: "VENUE OPS" },
]);

const EMPTY_TASKS = Object.freeze([]);

const TASK_STATUS = Object.freeze({
  pending: { label: "PENDING", icon: CircleDot, variant: "outline" },
  ready: { label: "READY", icon: CircleDot, variant: "secondary" },
  active: { label: "ACTIVE", icon: Play, variant: "default" },
  blocked: { label: "BLOCKED", icon: ShieldAlert, variant: "destructive" },
  done: { label: "DONE", icon: Check, variant: "secondary" },
  completed: { label: "DONE", icon: Check, variant: "secondary" },
  skipped: { label: "SKIPPED", icon: SkipForward, variant: "outline" },
});

const SYNC_STATUS = Object.freeze({
  online: { label: "ONLINE", icon: Cloud, variant: "secondary" },
  offline: { label: "OFFLINE", icon: CloudOff, variant: "outline" },
  syncing: { label: "SYNCING", icon: RefreshCw, variant: "outline" },
  conflict: { label: "CONFLICT", icon: AlertTriangle, variant: "destructive" },
});

const labelFor = (value, fallback = "—") => value?.label ?? value?.name ?? value?.kind?.replace("live-event", "live").toUpperCase() ?? value?.id ?? fallback;
const normalizedTaskStatus = (status) => status === "in-progress" ? "active" : TASK_STATUS[status] ? status : "pending";
const taskRoleIds = (task) => [...new Set([...(task.roleIds ?? []), task.roleId, task.role, task.workstream, task.owner?.roleId].filter(Boolean))];
const taskEvidence = (task) => task.evidence ?? task.evidenceRefs ?? [];
const taskDependencies = (task) => task.dependencies ?? task.dependencyIds ?? task.dependencyTaskIds ?? [];
const completedDependencyCount = (task) => task.completedDependencyCount ?? task.dependenciesCompleted ?? task.readiness?.completedDependencyIds?.length ?? 0;
const shortTime = (value, fallback = "—") => {
  if (!value) return fallback;
  if (/^\d{1,2}:\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return String(value);
  return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

function StatusBadge({ status }) {
  const definition = TASK_STATUS[normalizedTaskStatus(status)];
  const Icon = definition.icon;
  return <Badge variant={definition.variant}><Icon aria-hidden="true" />{definition.label}</Badge>;
}

function RunbookSelect({ label, value, options, onValueChange }) {
  return <Select value={value} onValueChange={onValueChange}>
    <SelectTrigger aria-label={label}><SelectValue /></SelectTrigger>
    <SelectContent position="popper" align="start" sideOffset={4}>
      <SelectGroup>{options.map((option) => <SelectItem key={option.id} value={option.id}>{labelFor(option)}</SelectItem>)}</SelectGroup>
    </SelectContent>
  </Select>;
}

function RunbookEmptyState({ sourcePlanVersion, sourcePlanStatus, phaseCount, taskCount, onCreate }) {
  const approved = sourcePlanStatus === "approved" || sourcePlanStatus === "accepted";
  return <Empty className="runbook-empty">
    <EmptyHeader>
      <EmptyMedia variant="icon"><CalendarCheck aria-hidden="true" /></EmptyMedia>
      <EmptyTitle>NO RUNBOOK</EmptyTitle>
      <EmptyDescription>
        <span>BASE PLAN v{sourcePlanVersion} · {String(sourcePlanStatus || "unknown").toUpperCase()}</span>
        <span>{phaseCount} PHASES · {taskCount} TASKS</span>
      </EmptyDescription>
    </EmptyHeader>
    <EmptyContent><Button type="button" onClick={() => onCreate?.({ sourcePlanVersion })} disabled={!approved || !onCreate}>CREATE</Button></EmptyContent>
  </Empty>;
}

function RunbookTaskRow({ task, onTaskTransition, onOpenEvidence }) {
  const status = normalizedTaskStatus(task.status);
  const dependencies = taskDependencies(task);
  const completedDependencies = Math.min(dependencies.length, completedDependencyCount(task));
  const dependenciesReady = completedDependencies >= dependencies.length;
  const evidenceCount = taskEvidence(task).length;
  const primary = status === "active"
    ? { label: "DONE", toStatus: "completed", icon: Check }
    : status === "blocked"
      ? { label: "RESUME", toStatus: "in-progress", icon: Play }
      : status === "skipped" || status === "done" || status === "completed"
        ? null
        : { label: "START", toStatus: "in-progress", icon: Play };
  const PrimaryIcon = primary?.icon;
  const titleId = `runbook-task-${task.id}`;

  return <article className={cn("runbook-task", task.syncState === "local" && "is-local", status === "blocked" && "is-blocked")} role="listitem" aria-labelledby={titleId}>
    <header>
      <time dateTime={task.dueAt ?? undefined}>{task.dueLabel ?? shortTime(task.dueAt)}</time>
      <StatusBadge status={status} />
      {task.syncState === "local" && <Badge variant="outline">LOCAL</Badge>}
    </header>
    <div className="runbook-task-title">
      <strong id={titleId}>{task.title ?? task.label ?? task.id}</strong>
      <code>{task.id}</code>
    </div>
    <div className="runbook-task-meta">
      <span>{task.ownerLabel ?? task.ownerId ?? task.owner?.roleId ?? task.workstream ?? "UNASSIGNED"}</span>
      <span>DEP {completedDependencies}/{dependencies.length}</span>
      <span>EV {evidenceCount}</span>
    </div>
    <footer>
      <Button variant="outline" size="sm" type="button" disabled={!onOpenEvidence} onClick={() => onOpenEvidence?.(task)} aria-label={`Add evidence to task ${task.id}`}><FileCheck data-icon="inline-start" />EV {evidenceCount}</Button>
      {primary && <Button size="sm" type="button" disabled={!dependenciesReady || !onTaskTransition} onClick={() => onTaskTransition?.({ taskId: task.id, toStatus: primary.toStatus })} aria-label={`${primary.label === "DONE" ? "Complete" : primary.label === "RESUME" ? "Resume" : "Start"} task ${task.id}`}><PrimaryIcon data-icon="inline-start" />{primary.label}</Button>}
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" type="button" aria-label={`Task actions for ${task.id}`}><MoreHorizontal /></Button></DropdownMenuTrigger>
        <DropdownMenuContent className="runbook-task-menu" align="end" sideOffset={4}>
          <DropdownMenuGroup>
            {!(["blocked", "done", "completed", "skipped"].includes(status)) && <DropdownMenuItem disabled={!onTaskTransition} onSelect={() => onTaskTransition?.({ taskId: task.id, toStatus: "blocked" })}><ShieldAlert />BLOCK</DropdownMenuItem>}
            {!(["done", "completed", "skipped"].includes(status)) && <DropdownMenuItem disabled={!onTaskTransition} onSelect={() => onTaskTransition?.({ taskId: task.id, toStatus: "skipped" })}><SkipForward />SKIP</DropdownMenuItem>}
            {(["done", "completed", "skipped"].includes(status)) && <DropdownMenuItem disabled={!onTaskTransition} onSelect={() => onTaskTransition?.({ taskId: task.id, toStatus: "pending" })}><RotateCcw />RESET</DropdownMenuItem>}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </footer>
  </article>;
}

function RunbookEvidenceDialog({ task, open, onOpenChange, onAddEvidence }) {
  const evidenceCodes = task?.requiredEvidenceCodes?.length ? task.requiredEvidenceCodes : ["STATUS_CHECK"];
  const [code, setCode] = useState(evidenceCodes[0]);
  const [reference, setReference] = useState("");
  const [invalid, setInvalid] = useState(false);

  const submit = (event) => {
    event.preventDefault();
    if (!reference.trim()) {
      setInvalid(true);
      return;
    }
    onAddEvidence?.({ taskId: task?.id, code, ref: reference.trim() });
    setInvalid(false);
    setReference("");
    onOpenChange(false);
  };

  return <Dialog open={open} onOpenChange={(nextOpen) => { setInvalid(false); onOpenChange(nextOpen); }}>
    <DialogContent className="runbook-evidence-dialog">
      <DialogHeader>
        <DialogTitle>EVIDENCE · {task?.id ?? "—"}</DialogTitle>
        <DialogDescription className="sr-only">Add structured evidence to a runbook task</DialogDescription>
      </DialogHeader>
      <form onSubmit={submit}>
        <FieldGroup>
          <Field>
            <FieldLabel>KIND</FieldLabel>
            <RunbookSelect label="Evidence code" value={code} onValueChange={setCode} options={evidenceCodes.map((id) => ({ id, label: id }))} />
          </Field>
          <Field data-invalid={invalid}>
            <FieldLabel htmlFor="runbook-evidence-reference">REF</FieldLabel>
            <Input id="runbook-evidence-reference" value={reference} onChange={(event) => { setReference(event.target.value); setInvalid(false); }} aria-invalid={invalid} />
          </Field>
          {invalid && <FieldError>EVIDENCE REQUIRED</FieldError>}
        </FieldGroup>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>CANCEL</Button>
          <Button type="submit" disabled={!onAddEvidence}><FileCheck data-icon="inline-start" />ADD</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

function RunbookHandoffView({ runbookId, roleOptions, ownerOptions, handoffs, onCreateHandoff, onCopyHandoff, onExportHandoff }) {
  const [outgoingOwnerId, setOutgoingOwnerId] = useState(ownerOptions[0]?.id ?? "");
  const [incomingOwnerId, setIncomingOwnerId] = useState(ownerOptions[1]?.id ?? ownerOptions[0]?.id ?? "");
  const [roleId, setRoleId] = useState("all");
  const [at, setAt] = useState("");

  const submit = (event) => {
    event.preventDefault();
    onCreateHandoff?.({ runbookId, outgoingOwnerId, incomingOwnerId, roleId, at: at || null });
  };

  return <div className="runbook-handoff-view">
    <form className="runbook-handoff-form" onSubmit={submit}>
      <FieldGroup>
        <Field>
          <FieldLabel>OUT</FieldLabel>
          <RunbookSelect label="Outgoing owner" value={outgoingOwnerId} onValueChange={setOutgoingOwnerId} options={ownerOptions} />
        </Field>
        <Field>
          <FieldLabel>IN</FieldLabel>
          <RunbookSelect label="Incoming owner" value={incomingOwnerId} onValueChange={setIncomingOwnerId} options={ownerOptions} />
        </Field>
        <Field>
          <FieldLabel>ROLE</FieldLabel>
          <RunbookSelect label="Handoff role" value={roleId} onValueChange={setRoleId} options={[{ id: "all", label: "ALL" }, ...roleOptions]} />
        </Field>
        <Field>
          <FieldLabel htmlFor="runbook-handoff-at">AT</FieldLabel>
          <Input id="runbook-handoff-at" type="datetime-local" value={at} onChange={(event) => setAt(event.target.value)} />
        </Field>
      </FieldGroup>
      <Button type="submit" disabled={!onCreateHandoff || !outgoingOwnerId || !incomingOwnerId}>CREATE</Button>
    </form>
    <Separator />
    <ScrollArea className="runbook-handoff-list" aria-label="Shift handoffs">
      <div role="list">{handoffs.length ? handoffs.slice().reverse().map((handoff) => {
        const counts = handoff.counts ?? handoff.summary ?? {};
        const carry = handoff.carriedTasks ?? handoff.carry ?? [];
        const blockers = handoff.blockedTasks ?? handoff.blockers ?? [];
        return <article className="runbook-handoff" key={handoff.id} role="listitem" aria-labelledby={`runbook-handoff-${handoff.id}`}>
          <header>
            <strong id={`runbook-handoff-${handoff.id}`}>HANDOFF · {handoff.id}</strong>
            <time dateTime={handoff.createdAt ?? handoff.at ?? undefined}>{handoff.atLabel ?? shortTime(handoff.createdAt ?? handoff.at)}</time>
          </header>
          <p>{handoff.outgoingOwnerLabel ?? handoff.outgoingOwnerId ?? "—"} → {handoff.incomingOwnerLabel ?? handoff.incomingOwnerId ?? "—"}</p>
          <div className="runbook-handoff-counts">
            <Badge variant="secondary">DONE {counts.done ?? counts.completed ?? 0}</Badge>
            <Badge variant="outline">OPEN {counts.open ?? 0}</Badge>
            <Badge variant="destructive">BLOCK {counts.blocked ?? 0}</Badge>
            <Badge variant="outline">LOCAL {counts.local ?? counts.pendingSync ?? 0}</Badge>
          </div>
          <section aria-labelledby={`runbook-carry-${handoff.id}`}>
            <b id={`runbook-carry-${handoff.id}`}>CARRY</b>
            {carry.length ? carry.map((item) => <span key={item.taskId ?? item.id}><code>{item.taskId ?? item.id}</code><em>{String(item.status ?? "open").toUpperCase()}</em><small>{item.ownerLabel ?? item.ownerId ?? "—"}</small></span>) : <span>0</span>}
          </section>
          <section aria-labelledby={`runbook-blockers-${handoff.id}`}>
            <b id={`runbook-blockers-${handoff.id}`}>BLOCKERS</b>
            {blockers.length ? blockers.map((item) => <span key={item.taskId ?? item.id}><code>{item.taskId ?? item.id}</code><em>{item.code ?? item.status ?? "BLOCKED"}</em><small>{item.locationLabel ?? item.objectId ?? "—"}</small></span>) : <span>0</span>}
          </section>
          <footer>
            <Button variant="outline" size="sm" type="button" disabled={!onCopyHandoff} onClick={() => onCopyHandoff?.(handoff)} aria-label={`Copy handoff ${handoff.id}`}><Clipboard data-icon="inline-start" />COPY JSON</Button>
            <Button variant="outline" size="sm" type="button" disabled={!onExportHandoff} onClick={() => onExportHandoff?.(handoff)} aria-label={`Export handoff ${handoff.id}`}><Download data-icon="inline-start" />EXPORT</Button>
          </footer>
        </article>;
      }) : <Empty className="runbook-handoff-empty"><EmptyHeader><EmptyTitle>NO HANDOFFS</EmptyTitle><EmptyDescription>0 RECORDS</EmptyDescription></EmptyHeader></Empty>}</div>
    </ScrollArea>
  </div>;
}

export function RunbookPanel({
  open,
  runbook = null,
  sourcePlanVersion = runbook?.sourcePlanVersion ?? "—",
  sourcePlanStatus = runbook?.sourcePlanStatus ?? "approved",
  phaseOptions = runbook?.phases ?? DEFAULT_PHASES,
  roleOptions = DEFAULT_ROLES,
  ownerOptions = runbook?.owners ?? [],
  syncState = { state: "online", pendingCount: 0 },
  phaseFilter,
  roleFilter,
  handoffs = runbook?.handoffs ?? [],
  plannedTaskCount = runbook?.plannedTaskCount ?? runbook?.tasks?.length ?? 0,
  onClose,
  onCreate,
  onPhaseFilterChange,
  onRoleFilterChange,
  onTaskTransition,
  onAddEvidence,
  onCreateHandoff,
  onCopyHandoff,
  onExportHandoff,
  onSync,
  onResolveSyncConflict,
}) {
  const [view, setView] = useState("tasks");
  const [internalPhaseFilter, setInternalPhaseFilter] = useState("all");
  const [internalRoleFilter, setInternalRoleFilter] = useState("all");
  const [evidenceTask, setEvidenceTask] = useState(null);
  const activePhaseFilter = phaseFilter ?? internalPhaseFilter;
  const activeRoleFilter = roleFilter ?? internalRoleFilter;
  const tasks = runbook?.tasks ?? EMPTY_TASKS;
  const syncDefinition = SYNC_STATUS[syncState.state] ?? SYNC_STATUS.online;
  const SyncIcon = syncDefinition.icon;
  const completedTasks = tasks.filter((task) => ["done", "completed"].includes(task.status)).length;
  const activeTasks = tasks.filter((task) => ["active", "in-progress"].includes(task.status)).length;
  const blockedTasks = tasks.filter((task) => task.status === "blocked").length;
  const progress = tasks.length ? Math.round((completedTasks / tasks.length) * 100) : 0;
  const visibleTasks = useMemo(() => tasks.filter((task) => {
    const phaseMatches = activePhaseFilter === "all" || task.phaseId === activePhaseFilter;
    const roleMatches = activeRoleFilter === "all" || taskRoleIds(task).includes(activeRoleFilter);
    return phaseMatches && roleMatches;
  }), [activePhaseFilter, activeRoleFilter, tasks]);
  const setPhase = (value) => {
    if (phaseFilter === undefined) setInternalPhaseFilter(value);
    onPhaseFilterChange?.(value);
  };
  const setRole = (value) => {
    if (roleFilter === undefined) setInternalRoleFilter(value);
    onRoleFilterChange?.(value);
  };

  return <>
    <Sheet open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose?.(); }} modal={false}>
      <SheetContent id="event-day-runbook-panel" className="runbook-panel !h-auto !gap-0 !p-0 sm:!max-w-none" side="right" showOverlay={false} showCloseButton={false} aria-label="Event Day Runbook">
        <header className="runbook-heading">
          <div><span>EVENT DAY</span><SheetTitle asChild><strong>RUNBOOK</strong></SheetTitle><SheetDescription className="sr-only">TASKS · SYNC · HANDOFF</SheetDescription></div>
          {runbook && <div className="runbook-heading-meta"><Badge variant="outline">{runbook.version ?? "v1"}</Badge><Badge variant="secondary">PLAN v{sourcePlanVersion}</Badge></div>}
          <Button variant="ghost" size="icon-sm" type="button" onClick={onClose} aria-label="Close Event Day Runbook"><X /></Button>
        </header>

        {!runbook ? <RunbookEmptyState sourcePlanVersion={sourcePlanVersion} sourcePlanStatus={sourcePlanStatus} phaseCount={phaseOptions.length} taskCount={plannedTaskCount} onCreate={onCreate} /> : <>
          <div className={cn("runbook-sync-strip", `is-${syncState.state ?? "online"}`)}>
            <Badge variant={syncDefinition.variant} role={syncState.state === "conflict" ? "alert" : "status"} aria-live={syncState.state === "conflict" ? "assertive" : "polite"}><SyncIcon aria-hidden="true" />{syncDefinition.label}</Badge>
            {(syncState.pendingCount ?? 0) > 0 && <Badge variant="outline">{syncState.pendingCount} LOCAL</Badge>}
            {syncState.lastSyncedAt && <time dateTime={syncState.lastSyncedAt}>{syncState.lastSyncedLabel ?? shortTime(syncState.lastSyncedAt)}</time>}
            {syncState.state !== "online" && syncState.state !== "conflict" && <Button variant="outline" size="sm" type="button" disabled={!onSync} onClick={onSync}><RefreshCw data-icon="inline-start" />SYNC</Button>}
            {syncState.state === "conflict" && <Button variant="destructive" size="sm" type="button" disabled={!onResolveSyncConflict} onClick={onResolveSyncConflict}><AlertTriangle data-icon="inline-start" />REVIEW</Button>}
          </div>
          <Tabs className="runbook-tabs" value={view} onValueChange={setView}>
            <TabsList className="runbook-tabs-list" aria-label="Runbook views">
              <TabsTrigger value="tasks">TASKS</TabsTrigger>
              <TabsTrigger value="handoff">HANDOFF</TabsTrigger>
            </TabsList>
            <TabsContent className="runbook-tab-content" value="tasks">
              <div className="runbook-filters">
                <FieldGroup>
                  <Field><FieldLabel>PHASE</FieldLabel><RunbookSelect label="Runbook phase" value={activePhaseFilter} onValueChange={setPhase} options={[{ id: "all", label: "ALL" }, ...phaseOptions]} /></Field>
                  <Field><FieldLabel>ROLE</FieldLabel><RunbookSelect label="Runbook role" value={activeRoleFilter} onValueChange={setRole} options={[{ id: "all", label: "ALL" }, ...roleOptions]} /></Field>
                </FieldGroup>
              </div>
              <div className="runbook-progress-summary">
                <div><strong>{completedTasks}/{tasks.length} DONE</strong><span>{activeTasks} ACTIVE · {blockedTasks} BLOCKED</span></div>
                <Progress value={progress} aria-label="Runbook completion" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} />
              </div>
              <Separator />
              <ScrollArea className="runbook-task-list" aria-label="Runbook tasks">
                <div role="list">{visibleTasks.length ? visibleTasks.map((task) => <RunbookTaskRow key={task.id} task={task} onTaskTransition={onTaskTransition} onOpenEvidence={onAddEvidence ? setEvidenceTask : null} />) : <Empty className="runbook-task-empty"><EmptyHeader><EmptyTitle>NO TASKS</EmptyTitle><EmptyDescription>0 MATCHES</EmptyDescription></EmptyHeader></Empty>}</div>
              </ScrollArea>
            </TabsContent>
            <TabsContent className="runbook-tab-content" value="handoff">
              <RunbookHandoffView runbookId={runbook.id} roleOptions={roleOptions} ownerOptions={ownerOptions} handoffs={handoffs} onCreateHandoff={onCreateHandoff} onCopyHandoff={onCopyHandoff} onExportHandoff={onExportHandoff} />
            </TabsContent>
          </Tabs>
        </>}
      </SheetContent>
    </Sheet>
    <RunbookEvidenceDialog key={evidenceTask?.id ?? "none"} task={evidenceTask} open={Boolean(evidenceTask)} onOpenChange={(nextOpen) => { if (!nextOpen) setEvidenceTask(null); }} onAddEvidence={onAddEvidence} />
  </>;
}

export { DEFAULT_PHASES as RUNBOOK_PHASE_OPTIONS, DEFAULT_ROLES as RUNBOOK_ROLE_OPTIONS };
