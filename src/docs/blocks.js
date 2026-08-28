export const code = (value, language = "text") => ({ type: "code", language, value });
export const prose = (value) => ({ type: "prose", value });
export const bullets = (...items) => ({ type: "bullets", items });
export const steps = (...items) => ({ type: "steps", items });
export const links = (...items) => ({ type: "links", items });
export const table = (columns, rows) => ({ type: "table", columns, rows });

export function blockText(block) {
  if (block.type === "prose" || block.type === "code") return block.value;
  if (["bullets", "steps"].includes(block.type)) return block.items.join(" ");
  if (block.type === "links") return block.items.map((item) => item.label).join(" ");
  if (block.type === "table") return [block.columns.map((column) => column.label).join(" "), ...block.rows.map((row) => block.columns.map((column) => row[column.key] ?? "").join(" "))].join(" ");
  return "";
}
