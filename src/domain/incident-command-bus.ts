import {
  acknowledgeIncident,
  classifyIncident,
  createIncidentRegister,
  escalateIncident,
  exportIncidentRecord,
  handoffIncident,
  inspectIncident,
  inspectIncidents,
  recordIncidentEmergencyAction,
  relocateIncident,
  reportIncident,
  setIncidentOwner,
  transitionIncidentStatus,
} from "./incidents.ts";
import { venueError } from "./errors.ts";
import type { IncidentCommand, IncidentRegister } from "./operational-types.ts";

const clone = <Value>(value: Value): Value => (value == null ? value : structuredClone(value));
const fail = (code: Parameters<typeof venueError>[0], details: Parameters<typeof venueError>[1] = {}): never => {
  throw venueError(code, details);
};

export interface IncidentCommandBusOptions {
  readonly initialRegister?: IncidentRegister | null;
  readonly onChange?: (register: IncidentRegister | null, event: object) => void;
}

export function createIncidentCommandBus({
  initialRegister = null,
  onChange = () => {},
}: IncidentCommandBusOptions = {}) {
  let register: IncidentRegister | null = initialRegister;
  const listeners = new Set<() => void>();
  const requireRegister = (): IncidentRegister => {
    if (!register) return fail("INCIDENT_REGISTER_NOT_FOUND");
    return register;
  };
  const publish = (next: IncidentRegister, event: object): void => {
    register = next;
    onChange(clone(next), clone(event));
    listeners.forEach((listener) => listener());
  };

  return Object.freeze({
    getSnapshot: () => clone(register),
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    hydrate(nextRegister: IncidentRegister | null) {
      register = nextRegister;
      onChange(clone(nextRegister), { type: "incident.register.hydrated", registerId: nextRegister?.id ?? null });
      listeners.forEach((listener) => listener());
      return clone(register);
    },
    execute(command: IncidentCommand) {
      if (command.type === "create_incident_register") {
        const actorType = command.actorType;
        if (actorType !== "human")
          throw venueError("INCIDENT_HUMAN_REQUIRED", { operation: "create_incident_register" });
        if (register) {
          if (register.runbookVersionId !== command.runbook?.versionId || register.projectId !== command.projectId)
            fail("INCIDENT_BASELINE_INVALID", { reason: "register-already-bound", registerId: register.id });
          return { status: "existing", register: clone(register) };
        }
        const next = createIncidentRegister({
          type: "create_incident_register",
          projectId: command.projectId,
          runbook: command.runbook,
          createdAt: command.createdAt ?? new Date().toISOString(),
          createdBy: command.createdBy,
          actorType,
        });
        publish(next, { type: "incident.register.created", registerId: next.id });
        return { status: "created", register: clone(next) };
      }
      const current = requireRegister();
      if (command.type === "inspect_incidents") return inspectIncidents(current, command);
      if (command.type === "inspect_incident") return inspectIncident(current, command);
      if (command.type === "export_incident_record") return exportIncidentRecord(current, command);
      const commitOptions = command.committedAt === undefined ? {} : { committedAt: command.committedAt };
      const result =
        command.type === "report_incident"
          ? reportIncident(current, command, commitOptions)
          : command.type === "classify_incident"
            ? classifyIncident(current, command, commitOptions)
            : command.type === "set_incident_owner"
              ? setIncidentOwner(current, command, commitOptions)
              : command.type === "acknowledge_incident"
                ? acknowledgeIncident(current, command, commitOptions)
                : command.type === "escalate_incident"
                  ? escalateIncident(current, command, commitOptions)
                  : command.type === "relocate_incident"
                    ? relocateIncident(current, command, commitOptions)
                    : command.type === "transition_incident_status"
                      ? transitionIncidentStatus(current, command, commitOptions)
                      : command.type === "handoff_incident"
                        ? handoffIncident(current, command, commitOptions)
                        : command.type === "record_incident_emergency_action"
                          ? recordIncidentEmergencyAction(current, command, commitOptions)
                          : fail("COMMAND_UNSUPPORTED", { commandType: "unknown" });
      if (!result.duplicate) {
        const transition = result.register.transitions.at(-1);
        if (!transition) return fail("INCIDENT_LEDGER_INTEGRITY_FAILED", { reason: "transition-missing" });
        publish(result.register, {
          type: transition.type,
          incidentId: result.incident.id,
          transitionId: transition.id,
          receiptId: result.receipt.id,
        });
      }
      return clone(result);
    },
  });
}
