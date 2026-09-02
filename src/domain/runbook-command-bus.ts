import {
  createEventDayRunbook,
  deriveRunbookHandoff,
  taskReadiness,
  transitionRunbookTask,
} from "./event-day-runbook.ts";
import { stableFingerprint } from "./activity-ledger.ts";
import { exportEventDayRunbook } from "../interchange/runbook-exports.ts";
import { venueError } from "./errors.ts";
import type {
  EventDayRunbook,
  RunbookCommand,
  RunbookTask,
  TransitionRunbookTaskCommand,
} from "./operational-types.ts";

const clone = <Value>(value: Value): Value => structuredClone(value);

export interface RunbookCommandBusOptions {
  readonly initialRunbook?: EventDayRunbook | null;
  readonly onChange?: (runbook: EventDayRunbook, event: object) => void;
}

export function createRunbookCommandBus({ initialRunbook = null, onChange = () => {} }: RunbookCommandBusOptions = {}) {
  let runbook: EventDayRunbook | null = initialRunbook;
  const listeners = new Set<() => void>();
  const publish = (next: EventDayRunbook, event: object): void => {
    runbook = next;
    onChange(clone(next), clone(event));
    listeners.forEach((listener) => listener());
  };
  const requireRunbook = (): EventDayRunbook => {
    if (!runbook) throw venueError("RUNBOOK_DEFINITION_INVALID", { reason: "runbook-not-created" });
    return runbook;
  };

  return Object.freeze({
    getSnapshot: () => clone(runbook),
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    hydrate(nextRunbook: EventDayRunbook) {
      publish(nextRunbook, { type: "runbook.hydrated", runbookVersionId: nextRunbook?.versionId ?? null });
    },
    preview(command: TransitionRunbookTaskCommand) {
      if (command?.type !== "transition_runbook_task")
        throw venueError("COMMAND_UNSUPPORTED", { commandType: command?.type });
      const result = transitionRunbookTask(
        requireRunbook(),
        command,
        command.committedAt ? { committedAt: command.committedAt } : {},
      );
      return {
        status: result.duplicate ? "already-applied" : "ready",
        receipt: clone(result.receipt),
        task: clone(result.runbook.tasks.find((task: RunbookTask) => task.id === command.taskId)),
      };
    },
    execute(command: RunbookCommand) {
      if (command.type === "create_runbook_version") {
        if (
          runbook &&
          runbook.source.planId === command.plan?.id &&
          runbook.source.planVersion === command.plan?.version &&
          runbook.source.planFingerprint === stableFingerprint("plan", command.plan)
        )
          return { status: "existing", runbook: clone(runbook) };
        const next = createEventDayRunbook({
          projectId: command.projectId,
          plan: command.plan,
          ...(command.brief ? { brief: command.brief } : {}),
          validation: command.validation,
          sourceLedgerHeadHash: command.sourceLedgerHeadHash,
          approvalLedgerEntryId: command.approvalLedgerEntryId,
          frozenAt: command.frozenAt ?? new Date().toISOString(),
          frozenBy: command.frozenBy,
          version: 1,
        });
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
        const result = transitionRunbookTask(
          current,
          command,
          command.committedAt ? { committedAt: command.committedAt } : {},
        );
        if (!result.duplicate)
          publish(result.runbook, {
            type: "runbook.task_transitioned",
            taskId: command.taskId,
            transitionId: result.receipt.transitionId,
          });
        return {
          status: result.duplicate ? "already-applied" : "applied",
          receipt: clone(result.receipt),
          task: clone(result.runbook.tasks.find((task: RunbookTask) => task.id === command.taskId)),
        };
      }
      if (command.type === "generate_shift_handoff") return deriveRunbookHandoff(current, command);
      if (command.type === "export_runbook") return exportEventDayRunbook(current, command);
      throw venueError("COMMAND_UNSUPPORTED", { commandType: "unknown" });
    },
  });
}
