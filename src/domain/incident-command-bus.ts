import {
  acknowledgeIncident,
  attachIncidentEvidence,
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

const clone: any = (value: any) => value == null ? value : structuredClone(value);
const fail: any = (code: any, details: any = {}) => { throw venueError(code, details); };

const MUTATIONS: any = Object.freeze({
  report_incident: reportIncident,
  classify_incident: classifyIncident,
  set_incident_owner: setIncidentOwner,
  acknowledge_incident: acknowledgeIncident,
  escalate_incident: escalateIncident,
  relocate_incident: relocateIncident,
  transition_incident_status: transitionIncidentStatus,
  handoff_incident: handoffIncident,
  record_incident_emergency_action: recordIncidentEmergencyAction,
  attach_incident_evidence: attachIncidentEvidence,
});

export function createIncidentCommandBus({ initialRegister = null, onChange = () => {} }: any = {}) {
  let register: any = initialRegister;
  const listeners: any = new Set();
  const requireRegister: any = () => {
    if (!register) fail("INCIDENT_REGISTER_NOT_FOUND");
    return register;
  };
  const publish: any = (next: any, event: any) => {
    register = next;
    onChange(clone(next), clone(event));
    listeners.forEach((listener: any) => listener());
  };

  return Object.freeze({
    getSnapshot: () => clone(register),
    subscribe(listener: any) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    hydrate(nextRegister: any) {
      register = nextRegister;
      onChange(clone(nextRegister), { type: "incident.register.hydrated", registerId: nextRegister?.id ?? null });
      listeners.forEach((listener: any) => listener());
      return clone(register);
    },
    execute(command: any) {
      if (!command?.type) fail("COMMAND_INVALID", { reason: "incident-command-required" });
      if (command.type === "create_incident_register") {
        if (command.actorType !== "human") fail("INCIDENT_HUMAN_REQUIRED", { operation: "create_incident_register", actorType: command.actorType ?? null });
        if (register) {
          if (register.runbookVersionId !== command.runbook?.versionId || register.projectId !== command.projectId) fail("INCIDENT_BASELINE_INVALID", { reason: "register-already-bound", registerId: register.id });
          return { status: "existing", register: clone(register) };
        }
        const next: any = createIncidentRegister(command);
        publish(next, { type: "incident.register.created", registerId: next.id });
        return { status: "created", register: clone(next) };
      }
      const current: any = requireRegister();
      if (command.type === "inspect_incidents") return inspectIncidents(current, command);
      if (command.type === "inspect_incident") return inspectIncident(current, command);
      if (command.type === "export_incident_record") return exportIncidentRecord(current, command);
      const mutation: any = MUTATIONS[command.type];
      if (!mutation) fail("COMMAND_UNSUPPORTED", { commandType: command.type });
      const result: any = mutation(current, command, { committedAt: command.committedAt });
      if (!result.duplicate) {
        const transition: any = result.register.transitions.at(-1);
        publish(result.register, { type: transition.type, incidentId: result.incident.id, transitionId: transition.id, receiptId: result.receipt.id });
      }
      return clone(result);
    },
  });
}
