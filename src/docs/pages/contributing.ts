import { bullets, code, links, prose, steps, type DocsPage } from "../blocks.ts";

export const contributingPage = {
  slug: "architecture-contributing",
  group: "Reference",
  title: "Architecture and contributing",
  eyebrow: "Contributor map",
  summary: "Runtime boundaries, extension paths, migrations, testing layers, release checks, recovery, and architecture decisions.",
  audience: ["developers", "maintainers", "security reviewers"],
  compatibility: ["Project schema 10", "Tool contract 1.4.0"],
  sections: [
    {
      id: "architecture",
      title: "Architecture",
      blocks: [
        prose("Studio, WebMCP, and MCP converge on one planner command boundary. Shared contracts generate every public agent surface; deterministic Validation, authorization, ledger integrity, persistence, and exports remain separate deep modules."),
        links({ label: "Architecture overview and diagrams", href: "/guides/architecture.md" }, { label: "Persistence and recovery diagram", href: "/guides/persistence-and-recovery.md" }, { label: "Optimistic concurrency", href: "/guides/optimistic-concurrency.md" }, { label: "Database operations", href: "/guides/database-operations.md" }),
      ],
    },
    {
      id: "first-change",
      title: "First contributor change",
      blocks: [
        steps("Read the source map and choose the command, Constraint, migration, or documentation path.", "Change the authoritative runtime source and its focused tests.", "Regenerate contracts, docs, examples, and skills.", "Run the full tests, production build, and drift gate."),
        code("npm ci\nnpm run generate:contracts\nnpm run generate:migrations\nnpm run generate:docs\nnpm test\nnpm run build\nnpm run check:generated", "bash"),
        links({ label: "Contributor entry point", href: "/guides/contributing.md" }, { label: "Local development", href: "/guides/development.md" }, { label: "Testing by layer", href: "/guides/testing.md" }),
      ],
    },
    {
      id: "contracts",
      title: "Extend commands and Constraints",
      blocks: [
        bullets("Commands begin in src/contracts/venue-contracts.ts and execute only through VenuePlanner.execute.", "Agent-facing commands receive one shared tool contract and authorization mapping.", "Constraints enter the versioned evaluator registry and return deterministic stable-ID evidence.", "Contract tests bind runtime required fields, errors, outputs, docs, examples, WebMCP, and MCP."),
        links({ label: "Add a command or Constraint", href: "/guides/architecture.md" }, { label: "Shared runtime contracts ADR", href: "/guides/adr/0018-shared-runtime-contracts.md" }, { label: "Constraint registry ADR", href: "/guides/adr/0019-versioned-constraint-registry.md" }),
      ],
    },
    {
      id: "operations",
      title: "Migrations, release, and recovery",
      blocks: [
        links({ label: "TypeScript SDK", href: "/guides/sdk.md" }, { label: "Adapter authoring", href: "/guides/adapter-authoring.md" }, { label: "SDK API reference", href: "/sdk-api.json" }, { label: "Schema migration guide", href: "/guides/schema-migrations.md" }, { label: "Database operations", href: "/guides/database-operations.md" }, { label: "Real-time collaboration", href: "/guides/realtime-collaboration.md" }, { label: "Sharing and notifications", href: "/guides/sharing-and-notifications.md" }, { label: "Registration and ticketing", href: "/guides/registration-and-ticketing.md" }, { label: "Operational resources", href: "/guides/operational-resources.md" }, { label: "Release checklist", href: "/guides/release-checklist.md" }, { label: "Failure recovery runbook", href: "/guides/runbooks/failure-recovery.md" }, { label: "Security reporting policy", href: "/guides/security.md" }, { label: "Published guide manifest", href: "/guides/manifest.json" }),
      ],
    },
    {
      id: "decisions",
      title: "Architecture decisions",
      blocks: [
        links({ label: "Canonical spatial frame", href: "/guides/adr/0003-canonical-spatial-frame.md" }, { label: "Human Roles and Agent Grants", href: "/guides/adr/0017-human-roles-and-agent-grants.md" }, { label: "Shared runtime contracts", href: "/guides/adr/0018-shared-runtime-contracts.md" }, { label: "Constraint registry", href: "/guides/adr/0019-versioned-constraint-registry.md" }, { label: "Ledger integrity and replay", href: "/guides/adr/0020-hash-chained-ledger-and-replay.md" }, { label: "Server-owned tenancy", href: "/guides/adr/0021-server-owned-tenancy.md" }, { label: "Hashed bearer sharing", href: "/guides/adr/0024-hashed-bearer-sharing.md" }, { label: "Operational Resource Snapshots", href: "/guides/adr/0025-operational-resource-snapshots-are-not-plan-truth.md" }, { label: "Public SDK boundary", href: "/guides/adr/0026-public-sdk-follows-canonical-tool-and-adapter-contracts.md" }),
      ],
    },
  ],
} satisfies DocsPage;
