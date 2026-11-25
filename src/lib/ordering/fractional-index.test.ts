import { describe, expect, it } from "vitest";
import {
  comparePositions,
  generateInitialPositions,
  generatePositionBetween,
} from "./fractional-index";

describe("Fractional Indexing (WS-403)", () => {
  it("generates strictly increasing initial positions in both ASCII and locale collation", () => {
    const initial = generateInitialPositions(6);
    expect(initial).toHaveLength(6);
    expect([...initial].sort(comparePositions)).toEqual(initial);
    expect([...initial].sort((a, b) => a.localeCompare(b))).toEqual(initial);
  });

  it("inserts at start, end, cross-prefix bounds, and repeatedly between adjacent items", () => {
    const first = generatePositionBetween(null, null);
    const beforeFirst = generatePositionBetween(null, first);
    const afterFirst = generatePositionBetween(first, null);

    expect(beforeFirst < first).toBe(true);
    expect(first < afterFirst).toBe(true);

    const cross = generatePositionBetween("0i", "11");
    expect("0i" < cross && cross < "11").toBe(true);

    let left = beforeFirst;
    const right = first;
    for (let i = 0; i < 40; i++) {
      const mid = generatePositionBetween(left, right);
      expect(left < mid).toBe(true);
      expect(mid < right).toBe(true);
      left = mid;
    }
  });

  it("throws when bounds are inverted or equal", () => {
    expect(() => generatePositionBetween("i", "i")).toThrow();
    expect(() => generatePositionBetween("z", "a")).toThrow();
  });
});
