import { venueToolContracts } from "../contracts/venue-contracts.ts";
import { docsPages } from "./content.ts";
import { VERSION_REFERENCE } from "./reference-data.ts";
import type { DocBlock, PublishedDocsPage } from "./blocks.ts";

export type AgentSkillPackageSummary = Readonly<{ name: string; version: string }>;

export type AgentDocuments = Readonly<{
  compact: string;
  full: string;
  origin: string;
  publicPages: readonly PublishedDocsPage[];
}>;

function normalizeOrigin(value = ""): string {
  if (!value.trim()) return "";
  const url = new URL(value.trim());
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("VENUEMIND_PUBLIC_ORIGIN must be an HTTP(S) origin without credentials");
  }
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.origin;
}

const publicHref = (href: string, origin: string): string =>
  href.startsWith("/") && origin ? new URL(href, origin).href : href;

function renderBlock(block: DocBlock, origin: string): string {
  if (block.type === "prose") return block.value;
  if (block.type === "bullets") return block.items.map((item) => `- ${item}`).join("\n");
  if (block.type === "steps") return block.items.map((item, index) => `${index + 1}. ${item}`).join("\n");
  if (block.type === "links")
    return block.items.map((item) => `- [${item.label}](${publicHref(item.href, origin)})`).join("\n");
  if (block.type === "table") {
    const header = `| ${block.columns.map((column) => column.label).join(" | ")} |`;
    const divider = `| ${block.columns.map(() => "---").join(" | ")} |`;
    const rows = block.rows
      .map(
        (row) =>
          `| ${block.columns
            .map((column) =>
              String(row[column.key] ?? "—")
                .replaceAll("|", "\\|")
                .replaceAll("\n", " "),
            )
            .join(" | ")} |`,
      )
      .join("\n");
    return [header, divider, rows].join("\n");
  }
  return `\`\`\`${block.language}\n${block.value}\n\`\`\``;
}

function renderPage(page: PublishedDocsPage, origin: string): string {
  const sections = page.sections.map((section) =>
    [`## ${section.title}`, ...section.blocks.map((block) => renderBlock(block, origin))].join("\n\n"),
  );
  return [`# ${page.title}`, page.description, ...sections].join("\n\n");
}

export function buildAgentDocuments({
  origin: originValue = "",
  skillPackages = [],
}: { origin?: string; skillPackages?: readonly AgentSkillPackageSummary[] } = {}): AgentDocuments {
  const origin = normalizeOrigin(originValue);
  const publicPages = docsPages.filter((page) => page.public !== false && !page.deprecated);
  const documentationLinks = publicPages
    .filter((page) => !page.navigation?.hidden)
    .map(
      (page) => `- [${page.slug === "overview" ? "Overview" : page.title}](${publicHref(page.canonicalPath, origin)})`,
    )
    .join("\n");
  const link = (label: string, href: string): string => `- [${label}](${publicHref(href, origin)})`;

  const compact = `# VenueMind

> A versioned, human-supervised venue planning system for agents and operators.

VenueMind lets agents inspect accepted Plans, preview non-destructive Proposals, validate spatial Constraints, compare Proposal Branches, and export validated plans.

## Safety boundary

- Agents may inspect, propose, validate, compare, comment, simulate, and export within an Organization- and Project-scoped Agent Grant.
- Approval, Warning Waivers, Project Locks, and conflict decisions are human-only.
- Proposal actions never mutate the accepted Plan; Approval creates the next immutable Plan Version.

## Documentation

${documentationLinks}
${link("Complete agent reference", "/llms-full.txt")}

## Golden loop

1. Call venue.get_project_brief and venue.inspect_layout.
2. Call venue.preview_revision with a measurable outcome.
3. Call venue.validate_layout.
4. Review the Proposal and Requirement coverage in VenueMind Studio.
5. A human approves the Proposal into the next immutable Plan Version.
6. Export the validated plan, Event Brief, and Activity Ledger.

## Tools

${venueToolContracts.map((tool: { name: string; description: string }) => `- ${tool.name}: ${tool.description}`).join("\n")}

## Agent skills

${skillPackages.map((skill) => `- ${skill.name} ${skill.version}`).join("\n")}

## Compatibility

${VERSION_REFERENCE.map((item) => `- ${item.surface}: ${item.current}`).join("\n")}

## Machine-readable contracts

${(
  [
    ["Venue command schema", "/schemas/venue-command.schema.json"],
    ["Venue tool manifest schema", "/schemas/venue-tool-manifest.schema.json"],
    ["Venue tool manifest", "/venue-tools.json"],
    ["Venue tool examples", "/examples/venue-tool-examples.json"],
    ["Tool error catalog", "/tool-error-catalog.json"],
    ["Reference manifest", "/reference-manifest.json"],
    ["Agent skill package manifest", "/skills-manifest.json"],
    ["Agent skill evaluation metrics", "/skill-evaluation-metrics.json"],
    ["Authorization policy", "/authorization-policy.json"],
    ["Agent Grant schema", "/schemas/agent-grant.schema.json"],
    ["Authorization policy schema", "/schemas/authorization-policy.schema.json"],
    ["Event Brief schema", "/schemas/event-brief.schema.json"],
    ["Scenario definition schema", "/schemas/scenario-definition.schema.json"],
    ["Simulation result schema", "/schemas/simulation-result.schema.json"],
    ["Project list result schema", "/schemas/project-list-result.schema.json"],
    ["Project open result schema", "/schemas/project-open-result.schema.json"],
    ["Layout inspection schema", "/schemas/layout-inspection.schema.json"],
    ["Preview revision result schema", "/schemas/preview-revision-result.schema.json"],
    ["Spatial geometry schema", "/schemas/spatial-geometry.schema.json"],
    ["Spatial evidence schema", "/schemas/spatial-evidence.schema.json"],
    ["Venue Constraint schema", "/schemas/venue-constraint.schema.json"],
    ["Warning Waiver schema", "/schemas/warning-waiver.schema.json"],
    ["Object Lock schema", "/schemas/object-lock.schema.json"],
    ["Venue error schema", "/schemas/venue-error.schema.json"],
    ["Error catalog", "/error-catalog.json"],
    ["Validation result schema", "/schemas/validation-result.schema.json"],
    ["Command receipt schema", "/schemas/command-receipt.schema.json"],
    ["Activity Ledger schema", "/schemas/activity-ledger.schema.json"],
    ["Proposal conflicts schema", "/schemas/proposal-conflicts.schema.json"],
    ["Proposal comparison schema", "/schemas/proposal-comparison.schema.json"],
    ["Planner snapshot schema", "/schemas/planner-snapshot.schema.json"],
    ["Project record schema", "/schemas/project-record.schema.json"],
    ["VenueMind Interchange Package schema", "/schemas/venue-project-package.schema.json"],
    ["Post-event Review schema", "/schemas/post-event-review.schema.json"],
    ["VenueMind Interchange Package example", "/examples/venuemind-project-package.json"],
  ] satisfies readonly (readonly [string, string])[]
)
  .map(([label, href]) => link(label, href))
  .join("\n")}
`;

  const full = `# VenueMind complete agent reference

This file is generated from the same public structured documentation source as the VenueMind docs site.

${publicPages.map((page) => renderPage(page, origin)).join("\n\n---\n\n")}
`;

  return { compact, full, origin, publicPages };
}
