import { describe, expect, it } from "vitest";
import { diffJson } from "./json-diff";

describe("diffJson", () => {
  it("detects add, remove, and replace operations", () => {
    const patches = diffJson(
      { a: 1, b: 2, nested: { c: "old" } },
      { a: 1, nested: { c: "new" }, d: true },
    );

    expect(patches).toEqual([
      { op: "remove", path: "/b", oldValue: 2 },
      { op: "add", path: "/d", value: true },
      { op: "replace", path: "/nested/c", value: "new", oldValue: "old" },
    ]);
  });

  it("handles arrays by index", () => {
    expect(diffJson([1, 2], [1, 3, 4])).toEqual([
      { op: "replace", path: "/1", value: 3, oldValue: 2 },
      { op: "add", path: "/2", value: 4 },
    ]);
  });
});
