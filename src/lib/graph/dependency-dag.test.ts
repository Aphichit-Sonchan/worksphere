import { describe, expect, it } from "vitest";
import { wouldCreateDependencyCycle } from "./dependency-dag";

describe("Task Dependency Cycle Detection (WS-404)", () => {
  it("detects self-dependency, 2-node cycles, and multi-hop transitive cycles", () => {
    // ผูกตัวเอง
    expect(wouldCreateDependencyCycle([], { taskId: "A", dependsOnTaskId: "A" })).toBe(true);

    // A รอ B และ B รอ C (A -> B -> C)
    const edges = [
      { taskId: "A", dependsOnTaskId: "B" },
      { taskId: "B", dependsOnTaskId: "C" },
    ];

    // เพิ่ม A รอ C (DAG diamond ไม่เป็นวงจร) -> อนุญาต
    expect(wouldCreateDependencyCycle(edges, { taskId: "A", dependsOnTaskId: "C" })).toBe(false);

    // เพิ่ม D รอ A -> อนุญาต
    expect(wouldCreateDependencyCycle(edges, { taskId: "D", dependsOnTaskId: "A" })).toBe(false);

    // เพิ่ม B รอ A (2-node cycle) -> บล็อก!
    expect(wouldCreateDependencyCycle(edges, { taskId: "B", dependsOnTaskId: "A" })).toBe(true);

    // เพิ่ม C รอ A (3-node cycle: A -> B -> C -> A) -> บล็อก!
    expect(wouldCreateDependencyCycle(edges, { taskId: "C", dependsOnTaskId: "A" })).toBe(true);
  });
});
