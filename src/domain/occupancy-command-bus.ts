import {
  acknowledgeOccupancyAlert,
  createLiveOccupancyMonitor,
  evaluateLiveOccupancy,
  exportLiveOccupancyAudit,
  ingestOccupancySignal,
  refreshLiveOccupancy,
} from "./live-occupancy.ts";
import { venueError } from "./errors.ts";
import type { LiveOccupancyMonitor, OccupancyCommand } from "./operational-types.ts";

const clone = <Value>(value: Value): Value => (value == null ? value : structuredClone(value));

export interface OccupancyCommandBusOptions {
  readonly initialMonitor?: LiveOccupancyMonitor | null;
  readonly onChange?: (monitor: LiveOccupancyMonitor, event: object) => void;
}

export function createOccupancyCommandBus({
  initialMonitor = null,
  onChange = () => {},
}: OccupancyCommandBusOptions = {}) {
  let monitor: LiveOccupancyMonitor | null = initialMonitor;
  const listeners = new Set<() => void>();
  const requireMonitor = (): LiveOccupancyMonitor => {
    if (!monitor) throw venueError("OCCUPANCY_BASELINE_INVALID", { reason: "monitor-not-created" });
    return monitor;
  };
  const publish = (next: LiveOccupancyMonitor, event: object): void => {
    monitor = next;
    onChange(clone(next), clone(event));
    listeners.forEach((listener) => listener());
  };

  return Object.freeze({
    getSnapshot: () => clone(monitor),
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    hydrate(nextMonitor: LiveOccupancyMonitor | null) {
      monitor = nextMonitor;
      listeners.forEach((listener) => listener());
      return clone(monitor);
    },
    execute(command: OccupancyCommand) {
      if (command.type === "create_occupancy_monitor") {
        if (monitor)
          return {
            status: "existing",
            monitor: clone(monitor),
            projection: evaluateLiveOccupancy(monitor, { at: command.createdAt ?? monitor.updatedAt }),
          };
        const next = createLiveOccupancyMonitor({
          projectId: command.projectId,
          runbook: command.runbook,
          ...(command.plan ? { plan: command.plan } : {}),
          simulation: null,
          policy: {},
          ...(command.createdAt ? { createdAt: command.createdAt } : {}),
          createdBy: command.createdBy,
        });
        publish(next, { type: "occupancy.monitor.created", monitorId: next.id });
        return {
          status: "created",
          monitor: clone(next),
          projection: evaluateLiveOccupancy(next, { at: next.createdAt }),
        };
      }
      const current = requireMonitor();
      if (command.type === "inspect_live_occupancy")
        return {
          monitor: clone(current),
          projection: evaluateLiveOccupancy(current, { at: command.evaluatedAt ?? current.updatedAt }),
        };
      if (command.type === "export_live_occupancy") return exportLiveOccupancyAudit(current, command);
      if (command.type === "ingest_occupancy_signal") {
        const result = ingestOccupancySignal(
          current,
          command,
          command.committedAt ? { acceptedAt: command.committedAt } : {},
        );
        if (!result.duplicate)
          publish(result.monitor, { type: "occupancy.signal.ingested", receiptId: result.receipt.id });
        return clone(result);
      }
      if (command.type === "refresh_live_occupancy") {
        const result = refreshLiveOccupancy(
          current,
          command,
          command.committedAt ? { committedAt: command.committedAt } : {},
        );
        if (!result.duplicate)
          publish(result.monitor, { type: "occupancy.monitor.refreshed", receiptId: result.receipt.id });
        return clone(result);
      }
      if (command.type === "acknowledge_occupancy_alert") {
        const result = acknowledgeOccupancyAlert(
          current,
          command,
          command.committedAt ? { acknowledgedAt: command.committedAt } : {},
        );
        if (!result.duplicate)
          publish(result.monitor, {
            type: "occupancy.alert.acknowledged",
            alertId: command.alertId,
            receiptId: result.receipt.id,
          });
        return clone(result);
      }
      throw venueError("COMMAND_UNSUPPORTED", { commandType: "unknown" });
    },
  });
}
