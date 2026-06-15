import { describe, expect, it } from "vitest";
import { flattenVisibleJsonRows } from "./json-tree";

describe("flattenVisibleJsonRows", () => {
  it("renders only visible expanded branches", () => {
    const rows = flattenVisibleJsonRows({ a: { b: 1 }, c: 2 }, new Set(["/"]));

    expect(rows.map((row) => row.path)).toEqual(["/", "/a", "/c"]);
  });

  it("does not cap large arrays when the branch is expanded", () => {
    const value = { items: Array.from({ length: 350 }, (_, index) => ({ index })) };
    const rows = flattenVisibleJsonRows(value, new Set(["/", "/items"]));

    expect(rows).toHaveLength(352);
    expect(rows.at(-1)).toMatchObject({ name: "349", path: "/items/349", depth: 2 });
  });

  it("escapes json-pointer path segments", () => {
    const rows = flattenVisibleJsonRows({ "a/b": { "c~d": true } }, new Set(["/", "/a~1b"]));

    expect(rows.map((row) => row.path)).toEqual(["/", "/a~1b", "/a~1b/c~0d"]);
  });
});
