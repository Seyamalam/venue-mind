import { createEventDayRunbook, deriveRunbookHandoff, taskReadiness, transitionRunbookTask } from "./event-day-runbook.ts";
import { stableFingerprint } from "./activity-ledger.ts";
import { exportEventDayRunbook } from "../interchange/runbook-exports.ts";
import { venueError } from "./errors.ts";

const clone: any = (value: any) => value === null ? null : JSON.parse(JSON.stringify(value));

export function createRunbookCommandBus({ initialRunbook = null, onChange = () => {} }: any = {}) {
  let runbook: any = initialRunbook;
  const listeners: any = new Set();
  const publish: any = (next: any, event: any) => {
    runbook = next;
    onChange(clone(next), clone(event));
    listeners.forEach((listener: any) => listener());
  };
  const requireRunbook: any = () => {
    if (!runbook) throw venueError("RUNBOOK_DEFINITION_INVALID", { reason: "runbook-not-created" });
    return runbook;
  };

  return Object.freeze({
    getSnapshot: () => clone(runbook),
    subscribe(listener: any) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    hydrate(nextRunbook: any) {
      publish(nextRunbook, { type: "runbook.hydrated", runbookVersionId: nextRunbook?.versionId ?? null });
    },
    preview(command: any) {
      if (command?.type !== "transition_runbook_task") throw venueError("COMMAND_UNSUPPORTED", { commandType: command?.type });
      const result: any = transitionRunbookTask(requireRunbook(), command, { committedAt: command.committedAt });
      return { status: result.duplicate ? "already-applied" : "ready", receipt: clone(result.receipt), task: clone(result.runbook.tasks.find((task: any) => task.id === command.taskId)) };
    },
    execute(command: any) {
      if (!command?.type) throw venueError("COMMAND_INVALID");
      if (command.type === "create_runbook_version") {
        if (runbook && runbook.source.planId === command.plan?.id && runbook.source.planVersion === command.plan?.version && runbook.source.planFingerprint === stableFingerprint("plan", command.plan)) return { status: "existing", runbook: clone(runbook) };
        const next: any = createEventDayRunbook(command);
        publish(next, { type: "runbook.created", runbookVersionId: next.versionId });
        return { status: "created", runbook: clone(next) };
      }
      const current: any = requireRunbook();
      if (command.type === "inspect_runbook") return clone(current);
      if (command.type === "list_runbook_tasks") {
        return current.tasks
          .filter((task: any) => !command.phaseId || task.phaseId === command.phaseId)
          .filter((task: any) => !command.roleId || task.owner.roleId === command.roleId)
          .map((task: any) => ({ ...clone(task), readiness: taskReadiness(current, task.id) }));
      }
      if (command.type === "transition_runbook_task") {
        const result: any = transitionRunbookTask(current, command, { committedAt: command.committedAt });
        if (!result.duplicate) publish(result.runbook, { type: "runbook.task_transitioned", taskId: command.taskId, transitionId: result.receipt.transitionId });
        return { status: result.duplicate ? "already-applied" : "applied", receipt: clone(result.receipt), task: clone(result.runbook.tasks.find((task: any) => task.id === command.taskId)) };
      }
      if (command.type === "generate_shift_handoff") return deriveRunbookHandoff(current, command);
      if (command.type === "export_runbook") return exportEventDayRunbook(current, command);
      throw venueError("COMMAND_UNSUPPORTED", { commandType: command.type });
    },
  });
}
