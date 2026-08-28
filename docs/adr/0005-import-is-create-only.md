# Import is create-only

VenueMind imports a versioned, SHA-256-bound Interchange Package through a read-only Import Preview, then permits Import Commit only when the Project ID is absent. Import never overwrites an existing Project: preserving stable Project, Plan, Branch, Change, Constraint, and ledger IDs makes exact round trips auditable, while create-only persistence prevents a portable package from becoming a hidden accepted-Plan mutation; operators must resolve an ID collision explicitly instead of receiving automatic ID rewriting or destructive replacement.
