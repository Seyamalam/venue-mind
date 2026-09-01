import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  Download,
  LocateFixed,
  Paperclip,
  Plus,
  Radio,
  RefreshCw,
  ShieldAlert,
  UserRoundCheck,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Empty, EmptyHeader, EmptyTitle } from "../components/ui/empty";
import { Field, FieldError, FieldGroup, FieldLabel } from "../components/ui/field";
import { Input } from "../components/ui/input";
import { ScrollArea } from "../components/ui/scroll-area";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Separator } from "../components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "../components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Textarea } from "../components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
import { cn } from "../lib/utils";

const SEVERITIES = Object.freeze([
  { id: "critical", label: "CRITICAL" },
  { id: "high", label: "HIGH" },
  { id: "medium", label: "MEDIUM" },
  { id: "low", label: "LOW" },
]);

const CATEGORIES = Object.freeze([
  { id: "accessibility", label: "ACCESS" },
  { id: "crowd-capacity", label: "CROWD" },
  { id: "medical", label: "MEDICAL" },
  { id: "security", label: "SECURITY" },
  { id: "fire-life-safety", label: "FIRE / LIFE" },
  { id: "facilities", label: "FACILITIES" },
  { id: "production-av", label: "PRODUCTION" },
  { id: "catering", label: "CATERING" },
  { id: "staffing", label: "STAFFING" },
  { id: "transport", label: "TRANSPORT" },
  { id: "weather", label: "WEATHER" },
  { id: "other", label: "OTHER" },
]);

const EMPTY_INCIDENTS = Object.freeze([]);
const EMPTY_HANDOFFS = Object.freeze([]);
const EMPTY_LEDGER = Object.freeze([]);
const label = (value) => String(value ?? "—").replaceAll("_", " ").replaceAll("-", " ").toUpperCase();
const toSummaryCode = (value) => value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 64);
const ownerFromOption = (options, id) => options.find((option) => option.id === id)?.owner ?? { roleId: options.find((option) => option.id === id)?.roleId ?? id };
const nextEscalationLevel = (level) => ({ none: "team", team: "venue-command", "venue-command": "emergency-response" })[level] ?? null;
const stamp = (value) => {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return String(value);
  return new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(parsed);
};

function IncidentSelect({ ariaLabel, value, options, onValueChange, placeholder = "—" }) {
  return <Select value={value} onValueChange={onValueChange}>
    <SelectTrigger aria-label={ariaLabel}><SelectValue placeholder={placeholder} /></SelectTrigger>
    <SelectContent position="popper" align="start" sideOffset={4}>
      <SelectGroup>{options.map((option) => <SelectItem key={option.id} value={option.id}>{option.label ?? label(option.name ?? option.id)}</SelectItem>)}</SelectGroup>
    </SelectContent>
  </Select>;
}

function SyncBadge({ state, pendingCount }) {
  const online = state === "online";
  const Icon = online ? Wifi : WifiOff;
  return <Badge variant={state === "conflict" || state === "recovery" ? "destructive" : "outline"} className={cn("incident-sync", `is-${state ?? "offline"}`)} role={state === "conflict" || state === "recovery" ? "alert" : "status"} aria-live={state === "conflict" || state === "recovery" ? "assertive" : "polite"}>
    <Icon aria-hidden="true" />{label(state ?? "offline")}{pendingCount ? ` · ${pendingCount}` : ""}
  </Badge>;
}

function IncidentNewView({ ownerOptions, objectOptions, onCreate, onSelectAnchor, onCreated }) {
  const [severity, setSeverity] = useState("medium");
  const [category, setCategory] = useState("accessibility");
  const [ownerId, setOwnerId] = useState(ownerOptions[0]?.id ?? "");
  const [summary, setSummary] = useState("");
  const [anchorKind, setAnchorKind] = useState("object");
  const [objectId, setObjectId] = useState(objectOptions[0]?.id ?? "");
  const [x, setX] = useState("");
  const [y, setY] = useState("");
  const [invalid, setInvalid] = useState(false);

  const location = anchorKind === "object"
    ? { kind: "plan-object", planObjectId: objectId }
    : { kind: "coordinate", point: { x: Number(x), y: Number(y) } };
  const anchorReady = anchorKind === "object" ? Boolean(objectId) : Number.isFinite(Number(x)) && Number.isFinite(Number(y)) && x !== "" && y !== "";

  const submit = (event) => {
    event.preventDefault();
    const summaryCode = toSummaryCode(summary);
    if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(summaryCode) || !ownerId || !anchorReady) {
      setInvalid(true);
      return;
    }
    onCreate?.({ severity, category, owner: ownerFromOption(ownerOptions, ownerId), summaryCode, location });
    setSummary("");
    setInvalid(false);
    onCreated?.();
  };

  return <form className="incident-new" onSubmit={submit}>
    <FieldGroup className="incident-field-grid">
      <Field><FieldLabel>SEVERITY</FieldLabel><IncidentSelect ariaLabel="Incident severity" value={severity} onValueChange={setSeverity} options={SEVERITIES} /></Field>
      <Field><FieldLabel>CATEGORY</FieldLabel><IncidentSelect ariaLabel="Incident category" value={category} onValueChange={setCategory} options={CATEGORIES} /></Field>
      <Field data-invalid={invalid && !ownerId}><FieldLabel>OWNER</FieldLabel><IncidentSelect ariaLabel="Incident owner" value={ownerId} onValueChange={(value) => { setOwnerId(value); setInvalid(false); }} options={ownerOptions} /><FieldError>{invalid && !ownerId ? "OWNER REQUIRED" : null}</FieldError></Field>
      <Field className="incident-summary-field" data-invalid={invalid && !summary.trim()}>
        <FieldLabel htmlFor="incident-summary">SUMMARY</FieldLabel>
        <Textarea id="incident-summary" value={summary} onChange={(event) => { setSummary(event.target.value); setInvalid(false); }} maxLength={64} autoCapitalize="characters" spellCheck={false} aria-invalid={invalid && !summary.trim()} />
        <FieldError>{invalid && !summary.trim() ? "SUMMARY REQUIRED" : null}</FieldError>
      </Field>
      <Field className="incident-anchor-field" data-invalid={invalid && !anchorReady}>
        <FieldLabel id="incident-anchor-label">ANCHOR</FieldLabel>
        <ToggleGroup type="single" value={anchorKind} onValueChange={(value) => { if (value) { setAnchorKind(value); setInvalid(false); } }} aria-labelledby="incident-anchor-label">
          <ToggleGroupItem value="object">OBJECT</ToggleGroupItem>
          <ToggleGroupItem value="coordinate">POINT</ToggleGroupItem>
        </ToggleGroup>
        {anchorKind === "object" ? <IncidentSelect ariaLabel="Plan object anchor" value={objectId} onValueChange={(value) => { setObjectId(value); setInvalid(false); onSelectAnchor?.({ kind: "plan-object", planObjectId: value }); }} options={objectOptions} /> : <div className="incident-point-fields">
          <Input aria-label="Anchor X coordinate" inputMode="decimal" value={x} onChange={(event) => { setX(event.target.value); setInvalid(false); }} placeholder="X" aria-invalid={invalid && !anchorReady} />
          <Input aria-label="Anchor Y coordinate" inputMode="decimal" value={y} onChange={(event) => { setY(event.target.value); setInvalid(false); }} placeholder="Y" aria-invalid={invalid && !anchorReady} />
          <Button type="button" variant="outline" size="sm" disabled={!anchorReady || !onSelectAnchor} onClick={() => onSelectAnchor?.(location)}><LocateFixed data-icon="inline-start" /><span>LOCATE</span></Button>
        </div>}
        <FieldError>{invalid && !anchorReady ? "ANCHOR REQUIRED" : null}</FieldError>
      </Field>
    </FieldGroup>
    <Button type="submit" disabled={!onCreate}><Plus data-icon="inline-start" /><span>CREATE</span></Button>
  </form>;
}

function AttachmentAction({ incident, online, onAttach }) {
  const disabled = !online || !onAttach;
  return <Button asChild variant="outline" size="sm">
    <label className="incident-attach" aria-disabled={disabled}>
      <Paperclip data-icon="inline-start" /><span>ATTACH</span>
      <Input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={disabled} onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) onAttach?.({ incidentId: incident.id, expectedIncidentRevision: incident.revision, file });
        event.target.value = "";
      }} />
    </label>
  </Button>;
}

function IncidentIssuesView({ incidents, online, onSelectIncident, onSelectAnchor, onAcknowledge, onEscalate, onResolve, onHandoff, onAttach }) {
  if (!incidents.length) return <Empty className="incident-empty"><EmptyHeader><EmptyTitle>NO ISSUES</EmptyTitle></EmptyHeader></Empty>;
  return <ScrollArea className="incident-scroll" aria-label="Event Day incidents">
    <div className="incident-list" role="list">{incidents.map((incident) => {
      const inactive = incident.status === "resolved" || incident.status === "closed";
      const anchor = incident.anchor ?? incident.location ?? null;
      const anchorLabel = anchor?.kind === "coordinate" ? `${anchor.point?.x ?? "—"},${anchor.point?.y ?? "—"}` : anchor?.planObjectId ?? anchor?.objectId ?? anchor?.label ?? "—";
      const escalationLevel = nextEscalationLevel(incident.escalation?.level ?? "none");
      const timestamp = incident.timestamps?.updatedAt ?? incident.updatedAt ?? incident.createdAt;
      return <article className={cn("incident-row", `is-${incident.severity ?? "medium"}`, incident.syncState === "local" && "is-local")} key={incident.id} role="listitem" aria-labelledby={`incident-${incident.id}`}>
        <header>
          <Badge variant={incident.severity === "critical" ? "destructive" : incident.severity === "high" ? "default" : "outline"}>{label(incident.severity)}</Badge>
          <Badge variant="secondary">{label(incident.status)}</Badge>
          {incident.syncState === "local" && <Badge variant="outline">LOCAL</Badge>}
          <time dateTime={timestamp ?? undefined}>{stamp(timestamp)}</time>
        </header>
        <Button className="incident-select" type="button" variant="ghost" onClick={() => onSelectIncident?.(incident.id)} aria-label={`Select incident ${incident.id}`}>
          <span><strong id={`incident-${incident.id}`}>{incident.summaryCode ?? incident.summary ?? label(incident.category)}</strong><code>{incident.id}</code></span>
        </Button>
        <div className="incident-meta"><span>{label(incident.category)}</span><span>{incident.ownerLabel ?? incident.owner?.roleId ?? incident.ownerId ?? "UNASSIGNED"}</span><Button type="button" variant="ghost" size="xs" disabled={!anchor || !onSelectAnchor} onClick={() => onSelectAnchor?.(anchor)} aria-label={`Locate incident ${incident.id}`}><LocateFixed data-icon="inline-start" />{anchorLabel}</Button></div>
        <footer>
          {incident.acknowledgement?.status === "pending" && <Button type="button" variant="outline" size="sm" disabled={!onAcknowledge} onClick={() => onAcknowledge?.({ incidentId: incident.id, expectedIncidentRevision: incident.revision, reasonCode: "OPS_ACK" })}><UserRoundCheck data-icon="inline-start" /><span>ACK</span></Button>}
          {!inactive && <Button type="button" variant="destructive" size="sm" disabled={!onEscalate || !escalationLevel} onClick={() => onEscalate?.({ incidentId: incident.id, expectedIncidentRevision: incident.revision, level: escalationLevel, reasonCode: "OPS_ESCALATION" })}><ShieldAlert data-icon="inline-start" /><span>ESCALATE</span></Button>}
          {!inactive && <Button type="button" variant="outline" size="sm" disabled={!onResolve || incident.acknowledgement?.status !== "acknowledged" || !incident.owner} onClick={() => onResolve?.({ incidentId: incident.id, expectedIncidentRevision: incident.revision, toStatus: "resolved", resolutionCode: "CONTROL_COMPLETE" })}><Check data-icon="inline-start" /><span>RESOLVE</span></Button>}
          <Button type="button" variant="outline" size="sm" disabled={!onHandoff || inactive || !incident.owner} onClick={() => onHandoff?.(incident.id)}><RefreshCw data-icon="inline-start" /><span>HANDOFF</span></Button>
          <AttachmentAction incident={incident} online={online} onAttach={onAttach} />
        </footer>
      </article>;
    })}</div>
  </ScrollArea>;
}

function IncidentHandoffView({ incidents, handoffs, ownerOptions, initialIncidentId, onCreateHandoff }) {
  const [outgoingOwnerId, setOutgoingOwnerId] = useState(ownerOptions[0]?.id ?? "");
  const [incomingOwnerId, setIncomingOwnerId] = useState(ownerOptions[1]?.id ?? ownerOptions[0]?.id ?? "");
  const [incidentId, setIncidentId] = useState(initialIncidentId ?? incidents[0]?.id ?? "");
  const incidentOptions = incidents.filter((incident) => ["open", "mitigating"].includes(incident.status) && incident.owner).map((incident) => ({ id: incident.id, label: `${incident.id} · ${label(incident.severity)}` }));
  const currentIncident = incidents.find((incident) => incident.id === incidentId);
  const currentOwnerOption = ownerOptions.find((option) => (option.owner ?? { roleId: option.roleId ?? option.id }).roleId === currentIncident?.owner?.roleId);
  const outgoingValue = currentOwnerOption?.id ?? outgoingOwnerId;

  const submit = (event) => {
    event.preventDefault();
    const incident = incidents.find((candidate) => candidate.id === incidentId);
    if (!incident) return;
    onCreateHandoff?.({
      incidentId,
      expectedIncidentRevision: incident.revision,
      fromOwner: incident.owner ?? ownerFromOption(ownerOptions, outgoingValue),
      toOwner: ownerFromOption(ownerOptions, incomingOwnerId),
      openActionCodes: [],
      evidenceRefs: [],
    });
  };

  return <div className="incident-handoff-view">
    <form className="incident-handoff-form" onSubmit={submit}>
      <FieldGroup>
        <Field><FieldLabel>ISSUE</FieldLabel><IncidentSelect ariaLabel="Handoff incident" value={incidentId} onValueChange={(value) => { setIncidentId(value); const owner = incidents.find((incident) => incident.id === value)?.owner; const option = ownerOptions.find((candidate) => (candidate.owner ?? { roleId: candidate.roleId ?? candidate.id }).roleId === owner?.roleId); if (option) setOutgoingOwnerId(option.id); }} options={incidentOptions} /></Field>
        <Field><FieldLabel>OUT</FieldLabel><IncidentSelect ariaLabel="Outgoing owner" value={outgoingValue} onValueChange={setOutgoingOwnerId} options={ownerOptions} /></Field>
        <Field><FieldLabel>IN</FieldLabel><IncidentSelect ariaLabel="Incoming owner" value={incomingOwnerId} onValueChange={setIncomingOwnerId} options={ownerOptions} /></Field>
      </FieldGroup>
      <Button type="submit" disabled={!onCreateHandoff || !incidentId || !outgoingValue || !incomingOwnerId || outgoingValue === incomingOwnerId}><RefreshCw data-icon="inline-start" /><span>HANDOFF</span></Button>
    </form>
    <Separator />
    <ScrollArea className="incident-scroll" aria-label="Incident handoffs">
      <div className="incident-handoff-list" role="list">{handoffs.length ? handoffs.slice().reverse().map((handoff) => <article key={handoff.id} role="listitem" className="incident-handoff">
        <header><strong>{handoff.id}</strong><time dateTime={handoff.handedOffAt ?? handoff.createdAt ?? handoff.at ?? undefined}>{stamp(handoff.handedOffAt ?? handoff.createdAt ?? handoff.at)}</time></header>
        <p>{handoff.fromOwner?.roleId ?? handoff.outgoingOwnerLabel ?? handoff.outgoingOwnerId ?? "—"} → {handoff.toOwner?.roleId ?? handoff.incomingOwnerLabel ?? handoff.incomingOwnerId ?? "—"}</p>
        <div>{(handoff.incidentIds ?? [handoff.incidentId]).filter(Boolean).map((id) => <Badge key={id} variant="outline">{id}</Badge>)}</div>
      </article>) : <Empty className="incident-empty"><EmptyHeader><EmptyTitle>NO HANDOFFS</EmptyTitle></EmptyHeader></Empty>}</div>
    </ScrollArea>
  </div>;
}

function IncidentLedgerView({ ledger }) {
  return <ScrollArea className="incident-scroll" aria-label="Incident ledger">
    <div className="incident-ledger-list" role="list">{ledger.length ? ledger.slice().reverse().map((entry) => <article className="incident-ledger" key={entry.id} role="listitem">
      <header><strong>{label(entry.type)}</strong><b>#{entry.sequence ?? "—"}</b></header>
      <code>{entry.incidentId ?? entry.id}</code>
      <footer><span>{label(entry.actorType)}</span><span>{entry.actorId ?? "—"}</span><time dateTime={entry.committedAt ?? entry.occurredAt ?? undefined}>{stamp(entry.committedAt ?? entry.occurredAt)}</time></footer>
    </article>) : <Empty className="incident-empty"><EmptyHeader><EmptyTitle>NO LEDGER</EmptyTitle></EmptyHeader></Empty>}</div>
  </ScrollArea>;
}

export function IncidentPanel({
  open,
  incidents = EMPTY_INCIDENTS,
  handoffs = EMPTY_HANDOFFS,
  ledger = EMPTY_LEDGER,
  ownerOptions = [],
  objectOptions = [],
  syncState = { state: "offline", pendingCount: 0 },
  online = syncState.state === "online",
  onClose,
  onCreate,
  onSelectIncident,
  onSelectAnchor,
  onAcknowledge,
  onEscalate,
  onResolve,
  onCreateHandoff,
  onAttach,
  onSync,
  onExport,
}) {
  const [view, setView] = useState("issues");
  const [handoffIncidentId, setHandoffIncidentId] = useState(null);
  const openCount = incidents.filter((incident) => ["open", "mitigating"].includes(incident.status)).length;
  const criticalCount = incidents.filter((incident) => ["open", "mitigating"].includes(incident.status) && incident.severity === "critical").length;
  const visibleLedger = useMemo(() => ledger.length ? ledger : incidents.flatMap((incident) => incident.ledger ?? []), [incidents, ledger]);
  const openHandoff = (incidentId) => {
    setHandoffIncidentId(incidentId);
    setView("handoff");
  };

  return <Sheet open={open} onOpenChange={(next) => { if (!next) onClose?.(); }} modal={false}>
    <SheetContent className="incident-panel !h-auto !gap-0 !p-0 sm:!max-w-none" side="right" showOverlay={false} showCloseButton={false} aria-label="Event Day incidents">
      <header className="incident-heading">
        <div><SheetTitle asChild><strong>LIVE · INCIDENTS</strong></SheetTitle><SheetDescription className="sr-only">ISSUES · HANDOFF · LEDGER</SheetDescription></div>
        <div className="incident-heading-counts"><Badge variant="outline">OPEN {openCount}</Badge><Badge variant={criticalCount ? "destructive" : "outline"}>CRIT {criticalCount}</Badge></div>
        <Button type="button" variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close Event Day incidents"><X /></Button>
      </header>
      <div className="incident-actions">
        <SyncBadge state={syncState.state} pendingCount={syncState.pendingCount ?? 0} />
        <Button type="button" variant="outline" size="sm" disabled={!onSync} onClick={onSync}><RefreshCw data-icon="inline-start" /><span>SYNC</span></Button>
        <Button type="button" variant="outline" size="sm" disabled={!onExport} onClick={onExport}><Download data-icon="inline-start" /><span>EXPORT</span></Button>
      </div>
      <Separator />
      <Tabs className="incident-tabs" value={view} onValueChange={setView}>
        <TabsList className="incident-tabs-list" aria-label="Incident views">
          <TabsTrigger value="new"><Plus />NEW</TabsTrigger>
          <TabsTrigger value="issues"><AlertTriangle />ISSUES</TabsTrigger>
          <TabsTrigger value="handoff"><RefreshCw />HANDOFF</TabsTrigger>
          <TabsTrigger value="ledger"><Radio />LEDGER</TabsTrigger>
        </TabsList>
        <TabsContent className="incident-tab-content" value="new"><IncidentNewView ownerOptions={ownerOptions} objectOptions={objectOptions} onCreate={onCreate} onSelectAnchor={onSelectAnchor} onCreated={() => setView("issues")} /></TabsContent>
        <TabsContent className="incident-tab-content" value="issues"><IncidentIssuesView incidents={incidents} online={online} onSelectIncident={onSelectIncident} onSelectAnchor={onSelectAnchor} onAcknowledge={onAcknowledge} onEscalate={onEscalate} onResolve={onResolve} onHandoff={onCreateHandoff ? openHandoff : null} onAttach={onAttach} /></TabsContent>
        <TabsContent className="incident-tab-content" value="handoff"><IncidentHandoffView incidents={incidents} handoffs={handoffs} ownerOptions={ownerOptions} initialIncidentId={handoffIncidentId} onCreateHandoff={onCreateHandoff} /></TabsContent>
        <TabsContent className="incident-tab-content" value="ledger"><IncidentLedgerView ledger={visibleLedger} /></TabsContent>
      </Tabs>
    </SheetContent>
  </Sheet>;
}

export { CATEGORIES as INCIDENT_CATEGORY_OPTIONS, SEVERITIES as INCIDENT_SEVERITY_OPTIONS };
