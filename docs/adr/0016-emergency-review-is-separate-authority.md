# ADR 0016: Emergency review is separate authority

Status: accepted

## Context

Ordinary human Approval proves that a reviewed Proposal may become accepted Plan truth, but it does not prove that the approver holds the operational authority to accept changed evacuation infrastructure or emergency assumptions.

## Decision

VenueMind requires a separate Emergency Review whenever a Proposal adds, removes, or changes an emergency Exit, assembly point, access lane, fire-equipment point, first-aid post, command post, or emergency metadata. The review must name an authorized reviewer role, explicitly accept the modeled assumptions, and bind its identity to the Proposal, base Plan Version, Validation input fingerprint, Emergency Plan evidence fingerprint, and changed object IDs before normal Approval can commit the Plan.

## Consequences

Emergency authority remains explicit and auditable without granting agents Approval power; ordinary Proposals retain the existing human Approval flow, while any changed emergency evidence invalidates the prior review and requires a new one.
