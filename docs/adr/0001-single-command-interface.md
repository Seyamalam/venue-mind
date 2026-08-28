# Route all venue mutations through one command interface

VenueMind uses one `VenuePlanner.execute(command)` interface for visible UI actions and WebMCP actions. This concentrates version checks, validation, approval rules, undo/redo, and ledger writes in one deep module; direct React-state mutation and tool-specific planning logic are rejected because they would let human and agent behavior drift apart as the product grows.

