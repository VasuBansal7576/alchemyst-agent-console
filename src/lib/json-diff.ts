import { isRecord } from "./protocol";

export type JsonPatch =
  | { op: "add"; path: string; value: unknown }
  | { op: "remove"; path: string; oldValue: unknown }
  | { op: "replace"; path: string; value: unknown; oldValue: unknown };

export function diffJson(previous: unknown, next: unknown, basePath = ""): JsonPatch[] {
  if (Object.is(previous, next)) return [];

  if (Array.isArray(previous) && Array.isArray(next)) {
    return diffArrays(previous, next, basePath);
  }

  if (isRecord(previous) && isRecord(next)) {
    const patches: JsonPatch[] = [];
    const keys = new Set([...Object.keys(previous), ...Object.keys(next)].sort());
    for (const key of keys) {
      const path = joinPath(basePath, key);
      if (!(key in next)) {
        patches.push({ op: "remove", path, oldValue: previous[key] });
      } else if (!(key in previous)) {
        patches.push({ op: "add", path, value: next[key] });
      } else {
        patches.push(...diffJson(previous[key], next[key], path));
      }
    }
    return patches;
  }

  return [{ op: "replace", path: basePath || "/", value: next, oldValue: previous }];
}

export function diffPathSet(patches: JsonPatch[]): Set<string> {
  return new Set(patches.map((patch) => patch.path));
}

function diffArrays(previous: unknown[], next: unknown[], basePath: string): JsonPatch[] {
  const patches: JsonPatch[] = [];
  const max = Math.max(previous.length, next.length);
  for (let index = 0; index < max; index += 1) {
    const path = joinPath(basePath, String(index));
    if (index >= next.length) {
      patches.push({ op: "remove", path, oldValue: previous[index] });
    } else if (index >= previous.length) {
      patches.push({ op: "add", path, value: next[index] });
    } else {
      patches.push(...diffJson(previous[index], next[index], path));
    }
  }
  return patches;
}

function joinPath(base: string, key: string): string {
  const escaped = key.replaceAll("~", "~0").replaceAll("/", "~1");
  return `${base}/${escaped}`;
}
