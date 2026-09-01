export type DocLink = Readonly<{ label: string; href: string }>;
export type DocTableColumn = Readonly<{ key: string; label: string }>;
export type DocTableCell = string | number | boolean | null | undefined;
export type DocTableRow = Readonly<Record<string, DocTableCell>>;

export type DocBlock =
  | Readonly<{ type: "code"; language: string; value: string }>
  | Readonly<{ type: "prose"; value: string }>
  | Readonly<{ type: "bullets"; items: readonly string[] }>
  | Readonly<{ type: "steps"; items: readonly string[] }>
  | Readonly<{ type: "links"; items: readonly DocLink[] }>
  | Readonly<{ type: "table"; columns: readonly DocTableColumn[]; rows: readonly DocTableRow[] }>;

export type DocsNavigationMetadata = Readonly<{
  hidden?: boolean;
  collection?: string;
  parentSlug?: string;
}>;

export type DocsSection = Readonly<{
  id: string;
  title: string;
  blocks: readonly DocBlock[];
}>;

export type DocsTutorialMetadata = Readonly<{
  id: string;
  minutes: number;
  evidenceFiles: readonly string[];
  verificationCommand: string;
}>;

export type DocsPage = Readonly<{
  slug: string;
  group: string;
  title: string;
  eyebrow: string;
  summary: string;
  description?: string;
  canonicalPath?: string;
  audience?: readonly string[];
  compatibility?: readonly string[];
  lastReviewedVersion?: string;
  public?: boolean;
  deprecated?: boolean;
  navigation?: DocsNavigationMetadata;
  sections: readonly DocsSection[];
  tutorial?: DocsTutorialMetadata;
  reference?: Readonly<Record<string, unknown>>;
}>;

export type TutorialDocsPage = DocsPage & Readonly<{ tutorial: DocsTutorialMetadata }>;

export type PublishedDocsPage = DocsPage & Readonly<{
  description: string;
  canonicalPath: string;
  audience: readonly string[];
  compatibility: readonly string[];
  lastReviewedVersion: string;
}>;

export const code = (value: string, language = "text"): DocBlock => ({ type: "code", language, value });
export const prose = (value: string): DocBlock => ({ type: "prose", value });
export const bullets = (...items: string[]): DocBlock => ({ type: "bullets", items });
export const steps = (...items: string[]): DocBlock => ({ type: "steps", items });
export const links = (...items: DocLink[]): DocBlock => ({ type: "links", items });
export const table = (columns: readonly DocTableColumn[], rows: readonly DocTableRow[]): DocBlock => ({ type: "table", columns, rows });

export function blockText(block: DocBlock): string {
  if (block.type === "prose" || block.type === "code") return block.value;
  if (block.type === "bullets" || block.type === "steps") return block.items.join(" ");
  if (block.type === "links") return block.items.map((item) => item.label).join(" ");
  if (block.type === "table") return [block.columns.map((column) => column.label).join(" "), ...block.rows.map((row) => block.columns.map((column) => String(row[column.key] ?? "")).join(" "))].join(" ");
  return "";
}
