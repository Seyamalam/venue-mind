import { createEventDayRunbook, deriveRunbookHandoff, taskReadiness, transitionRunbookTask } from "./event-day-runbook.js";
import { exportEventDayRunbook } from "../interchange/runbook-exports.js";
import { venueError } from "./errors.js";

const clone = (value) => value === null ? null : JSON.parse(JSON.stringify(value));

export function createRunbookCommandBus({ initialRunbook = null, onChange = () => {} } = {}) {
  let runbook = initialRunbook;
  const listeners = new Set();
  const publish = (next, event) => {
    runbook = next;
    onChange(clone(next), clone(event));
    listeners.forEach((listener) => listener());
  };
  const requireRunbook = () => {
    if (!runbook) throw venueError("RUNBOOK_DEFINITION_INVALID", { reason: "runbook-not-created" });
    return runbook;
  };

  return Object.freeze({
    getSnapshot: () => clone(runbook),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    hydrate(nextRunbook) {
      publish(nextRunbook, { type: "runbook.hydrated", runbookVersionId: nextRunbook?.versionId ?? null });
    },
    execute(command) {
      if (!command?.type) throw venueError("COMMAND_INVALID");
      if (command.type === "create_runbook_version") {
        if (runbook && runbook.source.planId === command.plan?.id && runbook.source.planVersion === command.plan?.version) return { status: "existing", runbook: clone(runbook) };
        const next = createEventDayRunbook(command);
        publish(next, { type: "runbook.created", runbookVersionId: next.versionId });
        return { status: "created", runbook: clone(next) };
      }
      const current = requireRunbook();
      if (command.type === "inspect_runbook") return clone(current);
      if (command.type === "list_runbook_tasks") {
        return current.tasks
          .filter((task) => !command.phaseId || task.phaseId === command.phaseId)
          .filter((task) => !command.roleId || task.owner.roleId === command.roleId)
          .map((task) => ({ ...clone(task), readiness: taskReadiness(current, task.id) }));
      }
      if (command.type === "transition_runbook_task") {
        const result = transitionRunbookTask(current, command, { committedAt: command.committedAt });
        if (!result.duplicate) publish(result.runbook, { type: "runbook.task_transitioned", taskId: command.taskId, transitionId: result.receipt.transitionId });
        return { status: result.duplicate ? "already-applied" : "applied", receipt: clone(result.receipt), task: clone(result.runbook.tasks.find((task) => task.id === command.taskId)) };
      }
      if (command.type === "generate_shift_handoff") return deriveRunbookHandoff(current, command);
      if (command.type === "export_runbook") return exportEventDayRunbook(current, command);
      throw venueError("COMMAND_UNSUPPORTED", { commandType: command.type });
    },
  });
}
