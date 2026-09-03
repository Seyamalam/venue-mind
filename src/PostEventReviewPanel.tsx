import { useMemo, useState, type FormEvent } from "react";
import { Download, RefreshCw, RotateCcw, ShieldCheck, Wifi, WifiOff, X } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Empty, EmptyHeader, EmptyTitle } from "../components/ui/empty";
import { Field, FieldError, FieldGroup, FieldLabel } from "../components/ui/field";
import { Input } from "../components/ui/input";
import { ScrollArea } from "../components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Separator } from "../components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "../components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { cn } from "../lib/utils";
import type {
  PostEventComparison,
  PostEventLesson,
  PostEventReview,
  PostEventReviewLedgerEntry,
  TemplateImprovementProposal,
} from "./domain/post-event-review-types";

export type PostEventObservationInput = Readonly<{
  predictionKey: string;
  value: number | null;
  confidence: "measured" | "estimated" | "unavailable";
}>;

export type PostEventLessonInput = Readonly<{
  comparisonKey: string;
  lessonCode: string;
  findingCode: string;
  recommendedActionCode: string;
  linkKind: "requirement" | "constraint";
  linkId: string;
}>;

export type PostEventProposalReviewInput = Readonly<{
  proposalId: string;
  expectedProposalRevision: number;
  decision: "approved" | "rejected";
  reasonCode: string;
}>;

export interface PostEventReviewPanelProps {
  readonly open: boolean;
  readonly review: PostEventReview | null;
  readonly comparisons?: readonly PostEventComparison[];
  readonly syncState: Readonly<{
    state: string;
    pendingCount: number;
    conflictCount: number;
    lastSyncedAt: string | null;
  }>;
  readonly onClose: () => void;
  readonly onRecordObservation?: (input: PostEventObservationInput) => void;
  readonly onRecordLesson?: (input: PostEventLessonInput) => void;
  readonly onCreateTemplateProposal?: (lessonIds: readonly string[]) => void;
  readonly onReviewTemplateProposal?: (input: PostEventProposalReviewInput) => void;
  readonly onRecover?: () => void;
  readonly onDiscardConflicts?: () => void;
  readonly onSync?: () => void;
  readonly onExport?: (format: "json" | "text") => void;
}

const code = (value: string) =>
  value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 64);

const stamp = (value: string | null | undefined) => {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return "—";
  return new Intl.DateTimeFormat("en", { dateStyle: "short", timeStyle: "short" }).format(parsed);
};

function SyncBadge({ state, pendingCount }: { state: string; pendingCount: number }) {
  const Icon = state === "online" ? Wifi : WifiOff;
  return (
    <Badge
      variant={state === "conflict" || state === "recovery" ? "destructive" : "outline"}
      className={cn("post-event-sync", `is-${state}`)}
      role={state === "conflict" || state === "recovery" ? "alert" : "status"}
      aria-live={state === "conflict" || state === "recovery" ? "assertive" : "polite"}
    >
      <Icon aria-hidden="true" />
      {state.toUpperCase()}{pendingCount ? ` · ${pendingCount}` : ""}
    </Badge>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <Empty className="post-event-empty">
      <EmptyHeader><EmptyTitle>{label}</EmptyTitle></EmptyHeader>
    </Empty>
  );
}

function ObservationForm({ comparisons, onSubmit }: {
  comparisons: readonly PostEventComparison[];
  onSubmit?: ((input: PostEventObservationInput) => void) | undefined;
}) {
  const eligible = comparisons.filter(({ observation }) => !observation);
  const [predictionKey, setPredictionKey] = useState(eligible[0]?.key ?? "");
  const [confidence, setConfidence] = useState<PostEventObservationInput["confidence"]>("measured");
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const numeric = Number(value);
    if (!predictionKey || (confidence !== "unavailable" && (!value.trim() || !Number.isFinite(numeric)))) {
      setInvalid(true);
      return;
    }
    onSubmit?.({ predictionKey, confidence, value: confidence === "unavailable" ? null : numeric });
    setValue("");
    setInvalid(false);
  };
  return (
    <form className="post-event-form" onSubmit={submit}>
      <FieldGroup>
        <Field data-invalid={invalid && !predictionKey}>
          <FieldLabel>OUTCOME</FieldLabel>
          <Select value={predictionKey} onValueChange={setPredictionKey}>
            <SelectTrigger aria-label="Predicted outcome"><SelectValue placeholder="OUTCOME —" /></SelectTrigger>
            <SelectContent position="popper">
              {eligible.map(({ key }) => <SelectItem key={key} value={key}>{key}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel>CONFIDENCE</FieldLabel>
          <Select value={confidence} onValueChange={(next) => {
            if (next === "measured" || next === "estimated" || next === "unavailable") setConfidence(next);
          }}>
            <SelectTrigger aria-label="Observation confidence"><SelectValue /></SelectTrigger>
            <SelectContent position="popper">
              <SelectItem value="measured">MEASURED</SelectItem>
              <SelectItem value="estimated">ESTIMATED</SelectItem>
              <SelectItem value="unavailable">UNAVAILABLE</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field data-invalid={invalid && confidence !== "unavailable"}>
          <FieldLabel>VALUE</FieldLabel>
          <Input aria-label="Observed value" aria-invalid={invalid && confidence !== "unavailable"} inputMode="decimal" value={value} disabled={confidence === "unavailable"} onChange={(event) => {
            setValue(event.currentTarget.value);
            setInvalid(false);
          }} />
          <FieldError>{invalid ? "VALUE REQUIRED" : null}</FieldError>
        </Field>
      </FieldGroup>
      <Button type="submit" disabled={!eligible.length}>RECORD</Button>
    </form>
  );
}

function LessonForm({ review, comparisons, onSubmit }: {
  review: PostEventReview;
  comparisons: readonly PostEventComparison[];
  onSubmit?: ((input: PostEventLessonInput) => void) | undefined;
}) {
  const eligible = comparisons.filter(({ observation }) => observation);
  const requirements = review.baseline.runbook.baseline.acceptedBrief.requirements;
  const constraints = review.baseline.runbook.baseline.acceptedPlan.constraints;
  const [comparisonKey, setComparisonKey] = useState(eligible[0]?.key ?? "");
  const [linkKind, setLinkKind] = useState<PostEventLessonInput["linkKind"]>("requirement");
  const [linkId, setLinkId] = useState(requirements[0]?.id ?? "");
  const [lessonCode, setLessonCode] = useState("");
  const [findingCode, setFindingCode] = useState("");
  const [recommendedActionCode, setRecommendedActionCode] = useState("");
  const [invalid, setInvalid] = useState(false);
  const options = linkKind === "requirement" ? requirements : constraints;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const input = {
      comparisonKey,
      lessonCode: code(lessonCode),
      findingCode: code(findingCode),
      recommendedActionCode: code(recommendedActionCode),
      linkKind,
      linkId,
    };
    if (!input.comparisonKey || !input.lessonCode || !input.findingCode || !input.recommendedActionCode || !input.linkId) {
      setInvalid(true);
      return;
    }
    onSubmit?.(input);
    setLessonCode("");
    setFindingCode("");
    setRecommendedActionCode("");
    setInvalid(false);
  };
  return (
    <form className="post-event-form" onSubmit={submit}>
      <FieldGroup>
        <Field><FieldLabel>OUTCOME</FieldLabel><Select value={comparisonKey} onValueChange={setComparisonKey}>
          <SelectTrigger aria-label="Lesson outcome"><SelectValue placeholder="OUTCOME —" /></SelectTrigger>
          <SelectContent position="popper">{eligible.map(({ key }) => <SelectItem key={key} value={key}>{key}</SelectItem>)}</SelectContent>
        </Select></Field>
        <Field><FieldLabel>LINK</FieldLabel><Select value={linkKind} onValueChange={(next) => {
          if (next === "requirement" || next === "constraint") {
            setLinkKind(next);
            setLinkId((next === "requirement" ? requirements : constraints)[0]?.id ?? "");
          }
        }}><SelectTrigger aria-label="Lesson link type"><SelectValue /></SelectTrigger><SelectContent position="popper">
          <SelectItem value="requirement">REQUIREMENT</SelectItem><SelectItem value="constraint">CONSTRAINT</SelectItem>
        </SelectContent></Select></Field>
        <Field><FieldLabel>ID</FieldLabel><Select value={linkId} onValueChange={setLinkId}>
          <SelectTrigger aria-label="Lesson evidence link"><SelectValue placeholder="ID —" /></SelectTrigger>
          <SelectContent position="popper">{options.map(({ id }) => <SelectItem key={id} value={id}>{id}</SelectItem>)}</SelectContent>
        </Select></Field>
        <Field data-invalid={invalid}><FieldLabel>LESSON</FieldLabel><Input aria-label="Lesson code" aria-invalid={invalid} value={lessonCode} placeholder="QUEUE_SPILL" onChange={(event) => setLessonCode(event.currentTarget.value)} /></Field>
        <Field data-invalid={invalid}><FieldLabel>FINDING</FieldLabel><Input aria-label="Finding code" aria-invalid={invalid} value={findingCode} placeholder="P95_HIGH" onChange={(event) => setFindingCode(event.currentTarget.value)} /></Field>
        <Field data-invalid={invalid}><FieldLabel>ACTION</FieldLabel><Input aria-label="Recommended action code" aria-invalid={invalid} value={recommendedActionCode} placeholder="ADD_SERVER" onChange={(event) => setRecommendedActionCode(event.currentTarget.value)} /><FieldError>{invalid ? "FIELDS REQUIRED" : null}</FieldError></Field>
      </FieldGroup>
      <Button type="submit" disabled={!eligible.length}>CAPTURE</Button>
    </form>
  );
}

function OutcomeList({ comparisons }: { comparisons: readonly PostEventComparison[] }) {
  if (!comparisons.length) return <EmptyState label="NO OUTCOMES" />;
  return <div className="post-event-list" role="list">{comparisons.map((item) => (
    <article className="post-event-row" data-comparison-key={item.key} key={item.key} role="listitem">
      <header><code>{item.key}</code><Badge variant={item.status === "worse" ? "destructive" : "outline"}>{item.status.toUpperCase()}</Badge></header>
      <div className="post-event-values"><span>PRED <b>{item.prediction.value}</b></span><span>OBS <b>{item.observation?.value ?? "—"}</b></span><code>{item.prediction.unit}</code></div>
      <footer><span>{item.prediction.family.toUpperCase()}</span><span>{item.prediction.metric.toUpperCase()}</span><span>Δ {item.delta ?? "—"}</span></footer>
    </article>
  ))}</div>;
}

function LessonList({ lessons }: { lessons: readonly PostEventLesson[] }) {
  if (!lessons.length) return <EmptyState label="NO LESSONS" />;
  return <div className="post-event-list" role="list">{lessons.map((lesson) => (
    <article className="post-event-row" data-lesson-id={lesson.id} key={lesson.id} role="listitem">
      <header><code>{lesson.id}</code><Badge variant="outline">{lesson.family.toUpperCase()}</Badge></header>
      <strong>{lesson.findingCode}</strong><span>{lesson.recommendedActionCode}</span>
      <footer><span>{lesson.comparisonKey}</span><span>{[...lesson.requirementIds, ...lesson.constraintIds].join(" · ")}</span></footer>
    </article>
  ))}</div>;
}

function ProposalList({ proposals, onReview }: {
  proposals: readonly TemplateImprovementProposal[];
  onReview?: ((input: PostEventProposalReviewInput) => void) | undefined;
}) {
  if (!proposals.length) return <EmptyState label="NO TEMPLATES" />;
  return <div className="post-event-list" role="list">{proposals.map((proposal) => (
    <article className="post-event-row" data-proposal-id={proposal.id} key={proposal.id} role="listitem">
      <header><code>{proposal.id}</code><Badge variant={proposal.status === "rejected" ? "destructive" : "outline"}>{proposal.status.toUpperCase()}</Badge></header>
      <strong>{proposal.target.templateId} · V{proposal.target.version}</strong>
      <footer><span>CHANGES {proposal.proposal.changes.length}</span><span>TRACES {proposal.traces.length}</span><span>{proposal.publicationStatus.toUpperCase()}</span></footer>
      {proposal.status === "pending-human-review" && <div className="post-event-review-actions">
        <Button type="button" size="sm" onClick={() => onReview?.({ proposalId: proposal.id, expectedProposalRevision: proposal.revision, decision: "approved", reasonCode: "RECOMMENDATION_ACCEPTED" })}><ShieldCheck aria-hidden="true" />APPROVE</Button>
        <Button type="button" size="sm" variant="outline" onClick={() => onReview?.({ proposalId: proposal.id, expectedProposalRevision: proposal.revision, decision: "rejected", reasonCode: "RECOMMENDATION_REJECTED" })}>REJECT</Button>
      </div>}
    </article>
  ))}</div>;
}

function LedgerList({ entries }: { entries: readonly PostEventReviewLedgerEntry[] }) {
  if (!entries.length) return <EmptyState label="NO LEDGER" />;
  return <div className="post-event-list" role="list">{[...entries].reverse().map((entry) => (
    <article className="post-event-row" data-ledger-id={entry.id} key={entry.id} role="listitem">
      <header><code>{entry.id}</code><b>#{entry.sequence}</b></header>
      <strong>{entry.type.replace("post-event.", "").replaceAll("-", " ").toUpperCase()}</strong>
      <footer><span>{entry.actor.actorId}</span><span>{entry.subjectId}</span><time dateTime={entry.actor.occurredAt}>{stamp(entry.actor.occurredAt)}</time></footer>
    </article>
  ))}</div>;
}

export function PostEventReviewPanel({
  open,
  review,
  comparisons = [],
  syncState,
  onClose,
  onRecordObservation,
  onRecordLesson,
  onCreateTemplateProposal,
  onReviewTemplateProposal,
  onRecover,
  onDiscardConflicts,
  onSync,
  onExport,
}: PostEventReviewPanelProps) {
  const [view, setView] = useState("outcomes");
  const counts = useMemo(() => ({
    worse: comparisons.filter(({ status }) => status === "worse").length,
    pending: review?.templateProposals.filter(({ status }) => status === "pending-human-review").length ?? 0,
  }), [comparisons, review]);
  const tracedLessonIds = new Set(review?.templateProposals.flatMap(({ traces }) => traces.flatMap(({ lessonIds }) => lessonIds)) ?? []);
  const eligibleLessonIds = review?.lessons.filter((lesson) => {
    const comparison = comparisons.find(({ key }) => key === lesson.comparisonKey);
    return comparison?.observation && comparison.status !== "insufficient-evidence" && !tracedLessonIds.has(lesson.id);
  }).map(({ id }) => id) ?? [];
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()} modal={false}>
      <SheetContent side="right" showOverlay={false} showCloseButton={false} className="post-event-panel !h-auto !gap-0 !p-0 sm:!max-w-none" aria-label="Post-event Review">
        <header className="post-event-heading">
          <div><SheetTitle asChild><span>POST-EVENT · REVIEW</span></SheetTitle><SheetDescription className="sr-only">OUTCOMES · LESSONS · TEMPLATES · LEDGER</SheetDescription><code>{review?.id ?? "REVIEW —"}</code></div>
          <div className="post-event-heading-counts"><Badge variant={counts.worse ? "destructive" : "outline"}>WORSE {counts.worse}</Badge><Badge variant="outline">PENDING {counts.pending}</Badge></div>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Close post-event review" onClick={onClose}><X aria-hidden="true" /></Button>
        </header>
        <div className="post-event-context"><code>{review?.projectId ?? "PROJECT —"}</code><code>{review?.runbookVersionId ?? "RUNBOOK —"}</code><code>R{review?.revision ?? 0}</code></div>
        <Separator />
        <div className="post-event-actions">
          <SyncBadge state={syncState.state} pendingCount={syncState.pendingCount} />
          {syncState.state === "recovery" && <Button type="button" size="sm" variant="outline" onClick={onRecover}>RECOVER</Button>}
          {syncState.state === "conflict" && <Button type="button" size="sm" variant="destructive" onClick={onDiscardConflicts}><RotateCcw aria-hidden="true" />DISCARD</Button>}
          <Button type="button" size="sm" variant="outline" onClick={onSync}><RefreshCw aria-hidden="true" />SYNC</Button>
          <Button type="button" size="icon-sm" variant="ghost" aria-label="Export post-event JSON" onClick={() => onExport?.("json")}><Download aria-hidden="true" /></Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => onExport?.("text")}>TXT</Button>
        </div>
        <Tabs className="post-event-tabs" value={view} onValueChange={setView}>
          <TabsList className="post-event-tabs-list" aria-label="Post-event Review views">
            <TabsTrigger value="outcomes">OUTCOMES</TabsTrigger><TabsTrigger value="lessons">LESSONS</TabsTrigger><TabsTrigger value="templates">TEMPLATES</TabsTrigger><TabsTrigger value="ledger">LEDGER</TabsTrigger>
          </TabsList>
          <TabsContent className="post-event-tab" value="outcomes"><ScrollArea className="post-event-scroll"><OutcomeList comparisons={comparisons} /></ScrollArea>{review && <ObservationForm key={`observations-${review.revision}`} comparisons={comparisons} onSubmit={onRecordObservation} />}</TabsContent>
          <TabsContent className="post-event-tab" value="lessons"><ScrollArea className="post-event-scroll"><LessonList lessons={review?.lessons ?? []} /></ScrollArea>{review && <LessonForm key={`lessons-${review.revision}`} review={review} comparisons={comparisons} onSubmit={onRecordLesson} />}</TabsContent>
          <TabsContent className="post-event-tab" value="templates"><ScrollArea className="post-event-scroll"><ProposalList proposals={review?.templateProposals ?? []} onReview={onReviewTemplateProposal} /></ScrollArea><div className="post-event-create"><Badge variant="outline">ELIGIBLE {eligibleLessonIds.length}</Badge><Button type="button" size="sm" variant="outline" disabled={!eligibleLessonIds.length} onClick={() => onCreateTemplateProposal?.(eligibleLessonIds)}>PROPOSE</Button></div></TabsContent>
          <TabsContent className="post-event-tab" value="ledger"><ScrollArea className="post-event-scroll"><LedgerList entries={review?.ledger ?? []} /></ScrollArea></TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
