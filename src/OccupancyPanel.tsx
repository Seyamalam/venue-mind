import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, Download, Radio, RefreshCw, Send, ShieldCheck, Wifi, WifiOff, X } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from "../components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "../components/ui/field";
import { Input } from "../components/ui/input";
import { Progress } from "../components/ui/progress";
import { ScrollArea } from "../components/ui/scroll-area";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Separator } from "../components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "../components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import type { DomainRecord, VoidCallback } from "./ui-types";

const states = Object.freeze(["unavailable", "nominal", "warning", "exceeded", "conflicting", "stale"]);
const sourceTypes = Object.freeze(["registration", "sensor", "manual-counter"]);
const confidenceLevels = Object.freeze(["low", "medium", "high"]);
const label = (value: unknown) => String(value ?? "—").replaceAll("_", " ").replaceAll(".", " · ").toUpperCase();
const stamp = (value: string | number | Date | null | undefined) => value ? new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value)) : "—";

function StateBadge({ value }: { value: string }) {
  const status = states.includes(value) ? value : "unavailable";
  return <Badge className={`occupancy-status is-${status}`} variant="outline">{label(status)}</Badge>;
}

function Metric({ name, value, meta }: { name: string; value: React.ReactNode; meta?: React.ReactNode }) {
  return <div className="occupancy-metric"><span>{name}</span><strong>{value}</strong>{meta != null && <small>{meta}</small>}</div>;
}

function EmptyView({ title, icon: Icon = Radio, action, actionLabel }: { title: string; icon?: LucideIcon; action?: VoidCallback; actionLabel?: string }) {
  return <Empty className="occupancy-empty">
    <EmptyHeader>
      <EmptyMedia variant="icon"><Icon /></EmptyMedia>
      <EmptyTitle>{title}</EmptyTitle>
    </EmptyHeader>
    {action && <EmptyContent><Button type="button" onClick={action}>{actionLabel}</Button></EmptyContent>}
  </Empty>;
}

type OccupancyPanelProps = {
  open: boolean; monitor?: DomainRecord | null; projection?: DomainRecord | null;
  syncState?: DomainRecord; onClose?: VoidCallback; onCreate?: VoidCallback;
  onIngest?: (input: DomainRecord) => unknown; onRefresh?: VoidCallback;
  onAcknowledge?: (input: DomainRecord) => unknown; onSync?: VoidCallback; onExport?: VoidCallback;
};

export function OccupancyPanel({ open, monitor, projection, syncState = { state: "offline", pendingCount: 0 }, onClose, onCreate, onIngest, onRefresh, onAcknowledge, onSync, onExport }: OccupancyPanelProps) {
  const [sourceId, setSourceId] = useState("door-a");
  const [sourceType, setSourceType] = useState("manual-counter");
  const [scopeId, setScopeId] = useState("venue");
  const [count, setCount] = useState("0");
  const [confidence, setConfidence] = useState("high");
  const scopes: DomainRecord[] = projection?.scopes ?? monitor?.baseline?.scopes ?? [];
  const availableScopes = useMemo(() => sourceType === "registration"
    ? scopes.filter((scope) => scope.scopeId === "check-in")
    : scopes.filter((scope) => scope.scopeId !== "check-in"), [scopes, sourceType]);

  useEffect(() => {
    if (!availableScopes.some((scope) => scope.scopeId === scopeId)) setScopeId(availableScopes[0]?.scopeId ?? "venue");
  }, [availableScopes, scopeId]);

  const submitSignal = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedCount = Number(count);
    if (!sourceId.trim() || !Number.isInteger(normalizedCount) || normalizedCount < 0 || !scopeId) return;
    const kind = sourceType === "registration" ? "check-in" : "zone-occupancy";
    onIngest?.({ sourceId, sourceType, kind, confidence, readings: [{ scopeId, count: normalizedCount }] });
  };

  return <Sheet open={open} onOpenChange={(next) => { if (!next) onClose?.(); }} modal={false}>
    <SheetContent className="occupancy-panel !gap-0 !p-0 sm:!max-w-none" side="right" showOverlay={false} showCloseButton={false} aria-label="Live Occupancy">
      <header className="occupancy-panel-header">
        <div>
          <SheetTitle asChild><span className="eyebrow">LIVE · OCCUPANCY</span></SheetTitle>
          <SheetDescription className="sr-only">COUNTS · ALERTS · LEDGER</SheetDescription>
          <strong>{monitor?.id ?? "NO MONITOR"}</strong>
        </div>
        <div className="occupancy-header-state">
          {projection && <StateBadge value={projection.overallStatus} />}
          <Badge variant="outline" className={`occupancy-sync is-${syncState.state}`}>
            {syncState.state === "online" ? <Wifi /> : <WifiOff />}{label(syncState.state)}{syncState.pendingCount ? ` · ${syncState.pendingCount}` : ""}
          </Badge>
          <Button type="button" variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close Live Occupancy"><X /></Button>
        </div>
      </header>

      {!monitor || !projection ? <EmptyView title="RUNBOOK REQUIRED" icon={ShieldCheck} action={onCreate} actionLabel="CREATE" /> : <>
        <div className="occupancy-actions">
          <Button type="button" variant="outline" size="sm" onClick={onRefresh}><RefreshCw /> REFRESH</Button>
          <Button type="button" variant="outline" size="sm" onClick={onSync}><Wifi /> SYNC</Button>
          <Button type="button" variant="outline" size="sm" onClick={onExport}><Download /> EXPORT</Button>
        </div>
        <Separator />
        <form className="occupancy-input" onSubmit={submitSignal}>
          <FieldGroup className="occupancy-field-grid">
            <Field><FieldLabel htmlFor="occupancy-source-id">SOURCE</FieldLabel><Input id="occupancy-source-id" value={sourceId} onChange={(event) => setSourceId(event.target.value)} maxLength={160} required /></Field>
            <Field><FieldLabel>SYSTEM</FieldLabel><Select value={sourceType} onValueChange={setSourceType}><SelectTrigger aria-label="Source type"><SelectValue /></SelectTrigger><SelectContent position="popper"><SelectGroup>{sourceTypes.map((value) => <SelectItem key={value} value={value}>{label(value)}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
            <Field><FieldLabel>SCOPE</FieldLabel><Select value={scopeId} onValueChange={setScopeId}><SelectTrigger aria-label="Occupancy scope"><SelectValue /></SelectTrigger><SelectContent position="popper"><SelectGroup>{availableScopes.map((scope) => <SelectItem key={scope.scopeId} value={scope.scopeId}>{label(scope.label)}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
            <Field><FieldLabel htmlFor="occupancy-count">COUNT</FieldLabel><Input id="occupancy-count" type="number" min="0" max="1000000" step="1" value={count} onChange={(event) => setCount(event.target.value)} required /></Field>
            <Field><FieldLabel>CONFIDENCE</FieldLabel><Select value={confidence} onValueChange={setConfidence}><SelectTrigger aria-label="Signal confidence"><SelectValue /></SelectTrigger><SelectContent position="popper"><SelectGroup>{confidenceLevels.map((value) => <SelectItem key={value} value={value}>{label(value)}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
            <Button type="submit" className="occupancy-send"><Send /> INGEST</Button>
          </FieldGroup>
        </form>
        <Separator />
        <div className="occupancy-live-state" role={projection.overallStatus === "exceeded" ? "alert" : "status"} aria-live={projection.overallStatus === "exceeded" ? "assertive" : "polite"}>
          <Metric name="REV" value={`R${monitor.revision}`} meta={stamp(monitor.updatedAt)} />
          <Metric name="SOURCES" value={projection.sources.length} meta={`${projection.sources.filter((source: DomainRecord) => source.status === "fresh").length} FRESH`} />
          <Metric name="ALERTS" value={monitor.activeAlerts.length} meta={`${monitor.activeAlerts.filter((alert: DomainRecord) => alert.status === "acknowledged").length} ACK`} />
        </div>
        <Tabs defaultValue="scopes" className="occupancy-tabs">
          <TabsList variant="line" className="occupancy-tab-list">
            <TabsTrigger value="scopes">SCOPES</TabsTrigger>
            <TabsTrigger value="sources">SOURCES</TabsTrigger>
            <TabsTrigger value="alerts">ALERTS</TabsTrigger>
            <TabsTrigger value="ledger">LEDGER</TabsTrigger>
          </TabsList>
          <ScrollArea className="occupancy-scroll">
            <TabsContent value="scopes" className="occupancy-list">
              {projection.scopes.map((scope: DomainRecord) => <article className="occupancy-scope" key={scope.scopeId}>
                <div className="occupancy-row-head"><div><strong>{label(scope.label)}</strong><small>{scope.scopeId}</small></div><StateBadge value={scope.status} /></div>
                <div className="occupancy-count"><strong>{scope.count ?? "—"}</strong><span>/ {scope.capacity}</span>{scope.simulationDelta != null && <b>{scope.simulationDelta > 0 ? "+" : ""}{scope.simulationDelta} SIM</b>}</div>
                <Progress value={scope.utilization == null ? 0 : Math.min(100, scope.utilization * 100)} aria-label={`${scope.label} utilization`} />
                <div className="occupancy-row-meta"><span>{label(scope.confidence)}</span><span>{label(scope.freshness)}</span><span>{scope.sourceIds.length} SRC</span></div>
              </article>)}
            </TabsContent>
            <TabsContent value="sources" className="occupancy-list">
              {projection.sources.length === 0 ? <EmptyView title="NO SOURCES" /> : projection.sources.map((source: DomainRecord) => <article className="occupancy-source" key={`${source.sourceId}:${source.kind}`}>
                <div className="occupancy-row-head"><div><strong>{source.sourceId}</strong><small>{label(source.sourceType)} · {label(source.kind)}</small></div><Badge variant="outline">{label(source.status)}</Badge></div>
                <div className="occupancy-row-meta"><span>{label(source.confidence)}</span><span>{source.ageSeconds}s</span><span>{stamp(source.observedAt)}</span></div>
              </article>)}
            </TabsContent>
            <TabsContent value="alerts" className="occupancy-list">
              {monitor.activeAlerts.length === 0 ? <EmptyView title="NO ALERTS" icon={ShieldCheck} /> : monitor.activeAlerts.map((alert: DomainRecord) => <article className={`occupancy-alert is-${alert.severity}`} key={alert.id}>
                <div className="occupancy-row-head"><div><strong><AlertTriangle /> {label(alert.code)}</strong><small>{alert.scopeId ?? alert.sourceIds.join(" · ")}</small></div><Badge variant="outline">{label(alert.status)}</Badge></div>
                <div className="occupancy-alert-values"><span>{alert.actual} {label(alert.unit)}</span><span>LIMIT {alert.threshold}</span></div>
                {alert.status === "open" && <Button type="button" size="sm" variant="outline" onClick={() => onAcknowledge?.({ alertId: alert.id, reasonCode: "ops-team-dispatched" })}>ACK</Button>}
              </article>)}
            </TabsContent>
            <TabsContent value="ledger" className="occupancy-list">
              {monitor.ledger.slice().reverse().map((entry: DomainRecord) => <article className="occupancy-ledger" key={entry.id}>
                <div className="occupancy-row-head"><div><strong>{label(entry.type)}</strong><small>{entry.id}</small></div><b>#{entry.sequence}</b></div>
                <div className="occupancy-row-meta"><span>{label(entry.actorType)}</span><span>{entry.actorId}</span><span>{stamp(entry.committedAt)}</span></div>
              </article>)}
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </>}
    </SheetContent>
  </Sheet>;
}
