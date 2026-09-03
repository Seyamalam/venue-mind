import { useMemo, useState, type SyntheticEvent } from "react";
import {
  ArchiveRestore,
  CircleAlert,
  Download,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
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
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
import { cn } from "../lib/utils";
import type {
  DeviationDisposition,
  DeviationLedgerEntry,
  LivePlanDeviation,
  PostEventDeviationRecommendation,
} from "./domain/operational-types";

export type DeviationObjectOption = Readonly<{ id: string; label: string }>;
export type DeviationRecordInput = Readonly<{
  objectId: string;
  disposition: DeviationDisposition;
  reasonCode: string;
  mode: "controlled" | "unavailable";
}>;
export type DeviationEndInput = Readonly<{
  deviationId: string;
  expectedDeviationRevision: number;
  reasonCode: string;
}>;

export interface DeviationPanelProps {
  readonly open: boolean;
  readonly registerId: string | null;
  readonly runbookVersionId: string | null;
  readonly planId: string;
  readonly planVersion: string | number;
  readonly deviations?: readonly LivePlanDeviation[];
  readonly recommendations?: readonly PostEventDeviationRecommendation[];
  readonly ledger?: readonly DeviationLedgerEntry[];
  readonly objectOptions?: readonly DeviationObjectOption[];
  readonly syncState: Readonly<{
    state: string;
    pendingCount: number;
    conflictCount: number;
    lastSyncedAt: string | null;
  }>;
  readonly onClose: () => void;
  readonly onRecord?: (input: DeviationRecordInput) => void;
  readonly onEnd?: (input: DeviationEndInput) => void;
  readonly onPostEvent?: (deviationIds: readonly string[]) => void;
  readonly onRecover?: () => void;
  readonly onDiscardConflicts?: () => void;
  readonly onSync?: () => void;
  readonly onExport?: () => void;
}

const dispositionLabel = (value: DeviationDisposition) =>
  value === "revision-candidate" ? "REVISION" : "TEMP";
const stamp = (value: string | null | undefined) => {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return "—";
  return new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(parsed);
};
const reasonCode = (value: string) =>
  value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);

function SyncBadge({ state, pendingCount }: { state: string; pendingCount: number }) {
  const online = state === "online";
  const Icon = online ? Wifi : WifiOff;
  return (
    <Badge
      variant={state === "conflict" || state === "recovery" ? "destructive" : "outline"}
      className={cn("deviation-sync", `is-${state}`)}
      role={state === "conflict" || state === "recovery" ? "alert" : "status"}
      aria-live={state === "conflict" || state === "recovery" ? "assertive" : "polite"}
    >
      <Icon aria-hidden="true" />
      {state.toUpperCase()}
      {pendingCount ? ` · ${pendingCount}` : ""}
    </Badge>
  );
}

function RecordView({
  objectOptions,
  onRecord,
}: {
  objectOptions: readonly DeviationObjectOption[];
  onRecord?: ((input: DeviationRecordInput) => void) | undefined;
}) {
  const [objectId, setObjectId] = useState(objectOptions[0]?.id ?? "");
  const [disposition, setDisposition] = useState<DeviationDisposition>("temporary");
  const [mode, setMode] = useState<DeviationRecordInput["mode"]>("controlled");
  const [reason, setReason] = useState("");
  const [invalid, setInvalid] = useState(false);
  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = reasonCode(reason);
    if (!objectId || !/^[A-Z][A-Z0-9_]{1,63}$/.test(normalized)) {
      setInvalid(true);
      return;
    }
    onRecord?.({ objectId, disposition, reasonCode: normalized, mode });
    setReason("");
    setInvalid(false);
  };
  return (
    <form className="deviation-record" onSubmit={submit}>
      <FieldGroup>
        <Field data-invalid={invalid && !objectId}>
          <FieldLabel>OBJECT</FieldLabel>
          <Select value={objectId} onValueChange={setObjectId}>
            <SelectTrigger aria-label="Deviation object">
              <SelectValue placeholder="OBJECT —" />
            </SelectTrigger>
            <SelectContent position="popper" align="start" sideOffset={4}>
              <SelectGroup>
                {objectOptions.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldError>{invalid && !objectId ? "OBJECT REQUIRED" : null}</FieldError>
        </Field>
        <Field>
          <FieldLabel>DISPOSITION</FieldLabel>
          <ToggleGroup
            type="single"
            value={disposition}
            onValueChange={(value) => {
              if (value === "temporary" || value === "revision-candidate") setDisposition(value);
            }}
            aria-label="Deviation disposition"
          >
            <ToggleGroupItem value="temporary">TEMP</ToggleGroupItem>
            <ToggleGroupItem value="revision-candidate">REVISION</ToggleGroupItem>
          </ToggleGroup>
        </Field>
        <Field>
          <FieldLabel>CHANGE</FieldLabel>
          <ToggleGroup
            type="single"
            value={mode}
            onValueChange={(value) => {
              if (value === "controlled" || value === "unavailable") setMode(value);
            }}
            aria-label="Deviation change"
          >
            <ToggleGroupItem value="controlled">CONTROLLED</ToggleGroupItem>
            <ToggleGroupItem value="unavailable">UNAVAILABLE</ToggleGroupItem>
          </ToggleGroup>
        </Field>
        <Field data-invalid={invalid && !reasonCode(reason)}>
          <FieldLabel>REASON</FieldLabel>
          <Input
            value={reason}
            onChange={(event) => {
              setReason(event.currentTarget.value);
              setInvalid(false);
            }}
            aria-invalid={invalid && !reasonCode(reason)}
            placeholder="OPS_CHANGE"
          />
          <FieldError>{invalid && !reasonCode(reason) ? "REASON REQUIRED" : null}</FieldError>
        </Field>
      </FieldGroup>
      <Button type="submit" disabled={!objectOptions.length}>
        <ShieldCheck data-icon="inline-start" aria-hidden="true" />
        RECORD
      </Button>
    </form>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <Empty className="deviation-empty">
      <EmptyHeader>
        <EmptyTitle>{label}</EmptyTitle>
      </EmptyHeader>
    </Empty>
  );
}

export function DeviationPanel({
  open,
  registerId,
  runbookVersionId,
  planId,
  planVersion,
  deviations = [],
  recommendations = [],
  ledger = [],
  objectOptions = [],
  syncState,
  onClose,
  onRecord,
  onEnd,
  onPostEvent,
  onRecover,
  onDiscardConflicts,
  onSync,
  onExport,
}: DeviationPanelProps) {
  const [view, setView] = useState("live");
  const active = useMemo(() => deviations.filter((item) => item.status === "active"), [deviations]);
  const blockers = useMemo(
    () => active.reduce((total, item) => total + item.validation.blockingIssues, 0),
    [active],
  );
  const endedCandidates = useMemo(
    () =>
      deviations
        .filter((item) => item.status === "ended" && item.disposition === "revision-candidate")
        .map((item) => item.id),
    [deviations],
  );
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()} modal={false}>
      <SheetContent
        side="right"
        showOverlay={false}
        showCloseButton={false}
        className="deviation-panel !h-auto !gap-0 !p-0 sm:!max-w-none"
        aria-label="Live Plan Deviations"
      >
        <header className="deviation-heading">
          <div>
            <SheetTitle asChild>
              <span>LIVE · DEVIATIONS</span>
            </SheetTitle>
            <SheetDescription className="sr-only">RECORD · LIVE · LEDGER</SheetDescription>
            <code>{registerId ?? "REGISTER —"}</code>
          </div>
          <div className="deviation-heading-counts">
            <Badge variant="outline">ACTIVE {active.length}</Badge>
            <Badge variant={blockers ? "destructive" : "outline"}>BLOCK {blockers}</Badge>
          </div>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Close deviations" onClick={onClose}>
            <X aria-hidden="true" />
          </Button>
        </header>
        <div className="deviation-context">
          <code>{planId} · V{planVersion}</code>
          <code>{runbookVersionId ?? "RUNBOOK —"}</code>
        </div>
        <Separator />
        <div className="deviation-actions">
          <SyncBadge state={syncState.state} pendingCount={syncState.pendingCount} />
          {syncState.state === "recovery" && (
            <Button type="button" size="sm" variant="outline" onClick={onRecover}>
              <ArchiveRestore data-icon="inline-start" aria-hidden="true" />
              RECOVER
            </Button>
          )}
          {syncState.state === "conflict" && (
            <Button type="button" size="sm" variant="destructive" onClick={onDiscardConflicts}>
              <RotateCcw data-icon="inline-start" aria-hidden="true" />
              DISCARD
            </Button>
          )}
          <Button type="button" size="sm" variant="outline" onClick={onSync}>
            <RefreshCw data-icon="inline-start" aria-hidden="true" />
            SYNC
          </Button>
          <Button type="button" size="icon-sm" variant="ghost" aria-label="Export deviations" onClick={onExport}>
            <Download aria-hidden="true" />
          </Button>
        </div>
        <Tabs className="deviation-tabs" value={view} onValueChange={setView}>
          <TabsList className="deviation-tabs-list" aria-label="Deviation views">
            <TabsTrigger value="live">LIVE</TabsTrigger>
            <TabsTrigger value="record">RECORD</TabsTrigger>
            <TabsTrigger value="ledger">LEDGER</TabsTrigger>
          </TabsList>
          <TabsContent className="deviation-tab-content" value="record">
            <RecordView objectOptions={objectOptions} onRecord={onRecord} />
          </TabsContent>
          <TabsContent className="deviation-tab-content" value="live">
            <ScrollArea className="deviation-scroll">
              {deviations.length ? (
                <div className="deviation-list" role="list">
                  {deviations.map((item) => (
                    <article
                      key={item.id}
                      className={cn("deviation-row", item.status === "active" && "is-active")}
                      data-deviation-id={item.id}
                      role="listitem"
                    >
                      <header>
                        <code>{item.id}</code>
                        <Badge variant={item.validation.status === "fail" ? "destructive" : "outline"}>
                          {item.validation.status.toUpperCase()}
                        </Badge>
                      </header>
                      <div className="deviation-row-meta">
                        <Badge variant="secondary">{dispositionLabel(item.disposition)}</Badge>
                        <Badge variant="outline">{item.status.toUpperCase()}</Badge>
                        <b>{item.reasonCode}</b>
                      </div>
                      <div className="deviation-object-ids">
                        {item.affectedObjectIds.map((objectId) => (
                          <code key={objectId}>{objectId}</code>
                        ))}
                      </div>
                      <footer>
                        <span>{item.authored.actorId}</span>
                        <time dateTime={item.authored.occurredAt}>{stamp(item.authored.occurredAt)}</time>
                        {item.validation.blockingIssues > 0 && (
                          <Badge variant="destructive">
                            <CircleAlert aria-hidden="true" /> BLOCK {item.validation.blockingIssues}
                          </Badge>
                        )}
                        {item.status === "active" && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              onEnd?.({
                                deviationId: item.id,
                                expectedDeviationRevision: item.revision,
                                reasonCode: "OPS_RESTORED",
                              })
                            }
                          >
                            END
                          </Button>
                        )}
                      </footer>
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyState label="NO DEVIATIONS" />
              )}
            </ScrollArea>
            <div className="deviation-post-event">
              <Badge variant="outline">POST {recommendations.length}</Badge>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!endedCandidates.length}
                onClick={() => onPostEvent?.(endedCandidates)}
              >
                POST-EVENT
              </Button>
            </div>
          </TabsContent>
          <TabsContent className="deviation-tab-content" value="ledger">
            <ScrollArea className="deviation-scroll">
              {ledger.length ? (
                <div className="deviation-ledger-list" role="list">
                  {[...ledger].reverse().map((entry) => (
                    <article key={entry.id} className="deviation-ledger" data-ledger-id={entry.id} role="listitem">
                      <header>
                        <code>{entry.id}</code>
                        <b>#{entry.sequence}</b>
                      </header>
                      <strong>{entry.type.replaceAll("deviation.", "").replaceAll("_", " ").toUpperCase()}</strong>
                      <footer>
                        <span>{entry.actor.actorId}</span>
                        <span>{entry.deviationId ?? "REGISTER"}</span>
                        <time dateTime={entry.actor.occurredAt}>{stamp(entry.actor.occurredAt)}</time>
                      </footer>
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyState label="NO LEDGER" />
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
