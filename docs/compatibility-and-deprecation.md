# SDK compatibility and deprecation

VenueMind versions each public surface independently. Compatibility is determined by the version carried by the artifact, not by the deployed application version.

## Version surfaces

| Surface | Current SDK baseline | Version rule |
| --- | --- | --- |
| TypeScript SDK | `0.1.0` | Package semantic version |
| Tool contract | Declared by `VENUE_TOOL_CONTRACT_VERSION` | Semantic version for tool names, inputs, outputs, errors, scopes, and limits |
| Adapter contract | Declared by `ADAPTER_CONTRACT_VERSION` | Integer contract generation plus each adapter's semantic version |
| Project Record | `10` | Exact current schema only; no multi-version runtime decoder |
| Spatial Geometry | Declared by the geometry document | Integer schema version |
| Validation engine | Declared by each Validation result | Semantic engine version; evidence is comparable only for matching engine and immutable input fingerprints |
| Simulation engine | Declared by each Simulation result | Semantic engine version; comparison also requires matching Scenario fingerprints |
| Activity Ledger | Declared by each ledger entry | Integer schema version with hash-chain verification |
| Interchange Package | `1` with Project schema `10` | Exact current format and embedded schema only |

An SDK release states which versions it can encode, decode, and call. Installing a newer SDK does not rewrite persisted Projects, reinterpret old Validation evidence, or upgrade an adapter cursor automatically.

## SDK semantic versioning

Before `1.0.0`, VenueMind uses `0.MINOR.PATCH` deliberately:

- `MINOR` may change an unstable SDK API and must include migration notes. A symbol marked deprecated remains available for at least one complete minor release before removal.
- `PATCH` is backward compatible within its minor line and may add optional types, helpers, documentation, or fixes that preserve observable contracts.

From `1.0.0` onward:

- `MAJOR` permits breaking public API changes with a migration path;
- `MINOR` adds backward-compatible behavior or exports;
- `PATCH` fixes behavior without changing the supported contract.

A package entry point, exported runtime symbol, exported type, method signature, error shape, and documented observable behavior are public API. Repository paths, generated intermediate files, private fields, and undeclared package subpaths are internal.

## Contract change classification

| Change | Required action |
| --- | --- |
| Remove or rename a tool, required field, output field, error code, or package export | Breaking SDK and affected contract release; publish migration notes |
| Add a required input field or narrow an accepted value | Breaking release |
| Add an optional input field, output field, method, or adapter helper | Compatible minor contract change and compatible SDK release |
| Add an enum member that callers must tolerate | Compatible only where the contract declares open-world handling; otherwise breaking |
| Clarify documentation or remediation without behavior change | Patch release |
| Change Validation or Simulation logic | Increment the relevant engine version; retain immutable input and evidence fingerprints |
| Change persisted Project shape | Increment Project schema, cut over atomically, and keep conversion outside the application runtime |
| Change adapter staging or durable-store semantics | Increment adapter contract generation or adapter major version as appropriate |

Generated TypeScript declarations follow the canonical schema and tool registry classification. A declaration-only change cannot redefine runtime compatibility.

## Deprecation lifecycle

Every deprecation has one machine-readable record containing:

- affected symbol, tool, field, or entry point;
- deprecation version and earliest removal version;
- replacement or migration instructions;
- affected contract versions;
- behavioral risk when migration is delayed.

The lifecycle is:

1. publish the replacement and deprecation metadata together;
2. retain the deprecated surface through at least one complete SDK minor release;
3. keep runtime and compile-time tests for both old and replacement paths during that window;
4. remove the surface only in the declared breaking release;
5. retain prior immutable schema artifacts for audit, without keeping old decoders in the runtime.

Security remediation may require an accelerated removal. The release notes must name the affected versions, risk, replacement, and earliest safe version.

## Consumer rules

- Pin a compatible SDK range and retain the lockfile used for verification.
- Check tool and adapter contract compatibility at connection or startup.
- Persist the version attached to snapshots, cursors, Validation, Simulation, ledger, and interchange artifacts.
- Branch on stable error codes and tolerate unknown future codes as safe failures.
- Treat unknown fields according to the schema: closed objects reject them; explicitly extensible objects preserve or ignore them as documented.
- Regenerate clients from canonical releases rather than copying repository source files.

## Release evidence

An SDK release is ready when:

- generated declarations and API reference have no drift from canonical contracts;
- public exports match the package manifest and contain no private paths;
- a clean consumer installs the packed package and typechecks on Node.js 22;
- the example adapter imports only `@venuemind/sdk` entry points and passes its contract suite;
- client examples pass against the matching local sandbox;
- deprecations and migration notes match the released version set.
