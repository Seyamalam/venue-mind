import { Activity, RefreshCw, X } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { ScrollArea } from "../components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "../components/ui/sheet";
import type { ObservabilitySnapshot, TelemetryEvent, TelemetryOperation } from "./observability/telemetry";

export interface HealthPanelProps {
  readonly open: boolean;
  readonly snapshot: ObservabilitySnapshot;
  readonly trace: readonly TelemetryEvent[];
  readonly onClose: () => void;
  readonly onRefresh: () => void;
}

const codes: Readonly<Record<TelemetryOperation, string>> = {
  request: "API",
  command: "CMD",
  policy: "POL",
  validation: "VAL",
  simulation: "SIM",
  persistence: "SAVE",
  conflict: "CNFL",
  approval: "APRV",
  ledger: "LDGR",
  integrity: "INTG",
  "external-adapter": "ADPT",
};

const duration = (value: number): string =>
  value < 1_000 ? `${Math.round(value)}MS` : `${(value / 1_000).toFixed(1)}S`;

export function HealthPanel({ open, snapshot, trace, onClose, onRefresh }: HealthPanelProps) {
  return (
    <Sheet
      open={open}
      modal={false}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent
        side="right"
        showOverlay={false}
        showCloseButton={false}
        className="health-panel !h-auto !gap-0 !p-0 sm:!max-w-none"
        aria-label="System health"
      >
        <SheetTitle className="sr-only">HEALTH</SheetTitle>
        <SheetDescription className="sr-only">SYSTEM METRICS</SheetDescription>
        <header className="health-panel-header">
          <span>
            <Activity aria-hidden="true" /> HEALTH
          </span>
          <Badge variant={snapshot.status === "error" ? "destructive" : "outline"}>
            {snapshot.status.toUpperCase()}
          </Badge>
          <Button variant="ghost" size="icon-sm" type="button" onClick={onRefresh} aria-label="Refresh health">
            <RefreshCw aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="icon-sm" type="button" onClick={onClose} aria-label="Close health">
            <X aria-hidden="true" />
          </Button>
        </header>
        <div className="health-summary" aria-label="Golden loop health">
          <span>
            <b>SAMPLES</b>
            <strong>{snapshot.samples}</strong>
          </span>
          <span>
            <b>FAIL</b>
            <strong>{Math.round(snapshot.failureRate * 100)}%</strong>
          </span>
          <span>
            <b>CNFL</b>
            <strong>{snapshot.conflicts}</strong>
          </span>
          <span>
            <b>APRV</b>
            <strong>
              {snapshot.approvals.approved}/{snapshot.approvals.rejected}
            </strong>
          </span>
        </div>
        <ScrollArea className="health-scroll">
          <section className="health-section" aria-label="Operation metrics">
            <h3>METRICS</h3>
            {snapshot.metrics
              .filter((metric) => metric.samples > 0)
              .map((metric) => (
                <div className="health-metric" key={metric.operation}>
                  <b>{codes[metric.operation]}</b>
                  <span>{metric.samples}</span>
                  <span>{duration(metric.averageDurationMs)}</span>
                  <span>{metric.failures ? `F${metric.failures}` : "OK"}</span>
                </div>
              ))}
          </section>
          <section className="health-section" aria-label="Health alerts">
            <h3>ALERTS</h3>
            {snapshot.alerts.length ? (
              snapshot.alerts.map((alert) => (
                <div className={`health-alert is-${alert.level}`} key={`${alert.code}-${alert.operation}`} role="alert">
                  <b>{alert.code}</b>
                  <span>{alert.observed}</span>
                  <span>≥ {alert.threshold}</span>
                </div>
              ))
            ) : (
              <div className="health-empty">NONE</div>
            )}
          </section>
          <section className="health-section" aria-label="Correlation trace">
            <h3>TRACE</h3>
            {trace.length ? (
              trace.map((event) => (
                <div className="health-trace" key={event.eventId}>
                  <b>{event.component.toUpperCase()}</b>
                  <span>{codes[event.operation]}</span>
                  <span>{event.outcome.toUpperCase()}</span>
                  <code>{event.correlationId}</code>
                </div>
              ))
            ) : (
              <div className="health-empty">NONE</div>
            )}
          </section>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
