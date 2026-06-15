import { isRecord } from "./protocol";

export interface JsonTreeRow {
  name: string;
  value: unknown;
  path: string;
  depth: number;
  expandable: boolean;
}

export function flattenVisibleJsonRows(root: unknown, expanded: Set<string>): JsonTreeRow[] {
  const rows: JsonTreeRow[] = [];
  appendJsonRow(rows, "root", root, "/", 0, expanded);
  return rows;
}

function appendJsonRow(rows: JsonTreeRow[], name: string, value: unknown, path: string, depth: number, expanded: Set<string>): void {
  const expandable = isRecord(value) || Array.isArray(value);
  rows.push({ name, value, path, depth, expandable });
  if (!expandable || !expanded.has(path)) return;

  const childEntries = Array.isArray(value) ? value.map((item, index) => [String(index), item] as const) : Object.entries(value);
  for (const [childName, childValue] of childEntries) {
    const childPath = path === "/" ? `/${escapeJsonPath(childName)}` : `${path}/${escapeJsonPath(childName)}`;
    appendJsonRow(rows, childName, childValue, childPath, depth + 1, expanded);
  }
}

function escapeJsonPath(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}
