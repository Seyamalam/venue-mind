import { acknowledgeOccupancyAlert, createLiveOccupancyMonitor, evaluateLiveOccupancy, exportLiveOccupancyAudit, ingestOccupancySignal, refreshLiveOccupancy } from "./live-occupancy.js";
import { venueError } from "./errors.js";

const clone = (value) => value == null ? value : structuredClone(value);

export function createOccupancyCommandBus({ initialMonitor = null, onChange = () => {} } = {}) {
  let monitor = initialMonitor;
  const listeners = new Set();
  const requireMonitor = () => {
    if (!monitor) throw venueError("OCCUPANCY_BASELINE_INVALID", { reason: "monitor-not-created" });
    return monitor;
  };
  const publish = (next, event) => {
    monitor = next;
    onChange(clone(next), clone(event));
    listeners.forEach((listener) => listener());
  };

  return Object.freeze({
    getSnapshot: () => clone(monitor),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    hydrate(nextMonitor) {
      monitor = nextMonitor;
      listeners.forEach((listener) => listener());
      return clone(monitor);
    },
    execute(command) {
      if (!command?.type) throw venueError("COMMAND_INVALID", { reason: "occupancy-command-required" });
      if (command.type === "create_occupancy_monitor") {
        if (monitor) return { status: "existing", monitor: clone(monitor), projection: evaluateLiveOccupancy(monitor, { at: command.createdAt ?? monitor.updatedAt }) };
        const next = createLiveOccupancyMonitor(command);
        publish(next, { type: "occupancy.monitor.created", monitorId: next.id });
        return { status: "created", monitor: clone(next), projection: evaluateLiveOccupancy(next, { at: next.createdAt }) };
      }
      const current = requireMonitor();
      if (command.type === "inspect_live_occupancy") return { monitor: clone(current), projection: evaluateLiveOccupancy(current, { at: command.evaluatedAt ?? current.updatedAt }) };
      if (command.type === "export_live_occupancy") return exportLiveOccupancyAudit(current, command);
      if (command.type === "ingest_occupancy_signal") {
        const result = ingestOccupancySignal(current, command, { acceptedAt: command.committedAt });
        if (!result.duplicate) publish(result.monitor, { type: "occupancy.signal.ingested", receiptId: result.receipt.id });
        return clone(result);
      }
      if (command.type === "refresh_live_occupancy") {
        const result = refreshLiveOccupancy(current, command, { committedAt: command.committedAt });
        if (!result.duplicate) publish(result.monitor, { type: "occupancy.monitor.refreshed", receiptId: result.receipt.id });
        return clone(result);
      }
      if (command.type === "acknowledge_occupancy_alert") {
        const result = acknowledgeOccupancyAlert(current, command, { acknowledgedAt: command.committedAt });
        if (!result.duplicate) publish(result.monitor, { type: "occupancy.alert.acknowledged", alertId: command.alertId, receiptId: result.receipt.id });
        return clone(result);
      }
      throw venueError("COMMAND_UNSUPPORTED", { commandType: command.type });
    },
  });
}
