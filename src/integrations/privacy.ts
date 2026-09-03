const CONTACT_SHAPE_PATTERN_SOURCE = String.raw`(?:[@＠]|(?:^|[\s(])(?:[Hh][Tt][Tt][Pp][Ss]?|[Mm][Aa][Ii][Ll][Tt][Oo]|[Tt][Ee][Ll]|[Ss][Mm][Ss])\s*:|(?:^|[\s(])[Ww][Ww][Ww][.\uFF0E\uFF61\u2024]|(?:[A-Za-z0-9-]+[.\uFF0E\uFF61\u2024])+(?:[Cc][Oo][Mm]|[Oo][Rr][Gg]|[Nn][Ee][Tt]|[Ii][Oo]|[Cc][Oo]|[Dd][Ee][Vv]|[Aa][Pp][Pp]|[Aa][Ii]|[Mm][Ee]|[Ii][Nn][Ff][Oo]|[Bb][Ii][Zz]|[Ee][Dd][Uu]|[Gg][Oo][Vv])(?:[\s/:?#]|$)|\+[\s(]*[0-9][0-9\s()./\-\u00A0\u200B-\u200D\u2010-\u2015\u2060\u2212\uFEFF]{5,}[0-9]|(?:^|[\s(])(?:(?:\([0-9]{2,4}\)|[0-9]{2,3})[\s./\-\u00A0\u200B-\u200D\u2010-\u2015\u2060\u2212\uFEFF]){2,}[0-9]{3,4}(?:$|[\s)])|(?:^|[\s(])[0-9]{10,}(?:$|[\s)])|(?:^|[\s(])(?:[Dd][Ii][Ss][Cc][Oo][Rr][Dd]|[Tt][Ee][Ll][Ee][Gg][Rr][Aa][Mm]|[Ww][Hh][Aa][Tt][Ss][Aa][Pp][Pp]|[Ww][Ee][Cc][Hh][Aa][Tt]|[Ss][Ll][Aa][Cc][Kk])(?:\s*:\s*[A-Za-z0-9_.-]+|\s+(?:[A-Za-z][0-9][A-Za-z0-9_-]*|[A-Za-z0-9_]+[-_.][A-Za-z0-9_.-]+)))`;

export const NON_CONTACT_LABEL_PATTERN_SOURCE = `^(?![\\s\\S]*${CONTACT_SHAPE_PATTERN_SOURCE})[\\s\\S]+$`;

const nonContactLabelPattern = new RegExp(NON_CONTACT_LABEL_PATTERN_SOURCE);
const defaultIgnorableCodePointPattern = /\p{Default_Ignorable_Code_Point}/gu;

const canonicalContactText = (value: string): string =>
  value
    .normalize("NFKC")
    .replace(/[\u2024\uFF61]/g, ".")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(defaultIgnorableCodePointPattern, "")
    .replace(/\s/g, " ");

export const isNonContactLabel = (value: unknown): value is string =>
  typeof value === "string" &&
  nonContactLabelPattern.test(value) &&
  nonContactLabelPattern.test(canonicalContactText(value));
