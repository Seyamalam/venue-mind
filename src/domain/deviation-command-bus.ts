import {
  createLivePlanDeviationRegister,
  createPostEventDeviationProposal,
  endLivePlanDeviation,
  exportLivePlanDeviations,
  inspectLivePlanDeviations,
  inspectLivePlanOverlay,
  recordLivePlanDeviation,
} from "./live-plan-deviations.ts";
import { venueError } from "./errors.ts";
import type { DeviationCommand, LivePlanDeviationRegister } from "./operational-types.ts";

const clone = <Value>(value: Value): Value => (value == null ? value : structuredClone(value));

export interface DeviationCommandBusOptions {
  readonly initialRegister?: LivePlanDeviationRegister | null;
  readonly onChange?: (register: LivePlanDeviationRegister | null, event: object) => void;
}

/**
 * Shared in-memory command seam for Studio, WebMCP, MCP, and future persistence adapters.
 * The bus owns no domain rules; every caller observes the same pure transition functions.
 */
export function createDeviationCommandBus({
  initialRegister = null,
  onChange = () => {},
}: DeviationCommandBusOptions = {}) {
  let register: LivePlanDeviationRegister | null = clone(initialRegister);
  const listeners = new Set<() => void>();
  const requireRegister = (): LivePlanDeviationRegister => {
    if (!register) throw venueError("DEVIATION_REGISTER_NOT_FOUND");
    return register;
  };
  const publish = (next: LivePlanDeviationRegister, event: object): void => {
    register = clone(next);
    onChange(clone(register), clone(event));
    listeners.forEach((listener) => listener());
  };

  return Object.freeze({
    getSnapshot: (): LivePlanDeviationRegister | null => clone(register),
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    hydrate(nextRegister: LivePlanDeviationRegister | null) {
      register = clone(nextRegister);
      onChange(clone(register), {
        type: "deviation.register.hydrated",
        registerId: nextRegister?.id ?? null,
      });
      listeners.forEach((listener) => listener());
      return clone(register);
    },
    execute(command: DeviationCommand) {
      if (command.type === "create_deviation_register") {
        if (register) {
          if (register.runbookVersionId !== command.runbook.versionId || register.projectId !== command.projectId)
            throw venueError("DEVIATION_BASELINE_INVALID", {
              reason: "register-already-bound",
              registerId: register.id,
            });
          return { status: "existing", register: clone(register) };
        }
        const next = createLivePlanDeviationRegister(command);
        publish(next, { type: "deviation.register.created", registerId: next.id });
        return { status: "created", register: clone(next) };
      }
      const current = requireRegister();
      if (command.type === "inspect_live_plan_deviations") return inspectLivePlanDeviations(current, command);
      if (command.type === "inspect_live_plan_overlay") return inspectLivePlanOverlay(current);
      if (command.type === "export_live_plan_deviations") return exportLivePlanDeviations(current, command);
      const result =
        command.type === "record_live_plan_deviation"
          ? recordLivePlanDeviation(current, command)
          : command.type === "end_live_plan_deviation"
            ? endLivePlanDeviation(current, command)
            : command.type === "create_post_event_deviation_proposal"
              ? createPostEventDeviationProposal(current, command)
              : (() => {
                  throw venueError("COMMAND_UNSUPPORTED", { commandType: "unknown" });
                })();
      if (!result.duplicate) {
        const transition = result.register.transitions.at(-1);
        if (!transition) throw venueError("DEVIATION_LEDGER_INTEGRITY_FAILED", { reason: "transition-missing" });
        publish(result.register, {
          type: transition.type,
          deviationId: result.deviation?.id ?? null,
          proposalId: result.proposal?.id ?? null,
          transitionId: transition.id,
          receiptId: result.receipt.id,
        });
      }
      return clone(result);
    },
  });
}
