/**
 * Task Dependency Graph & Cycle Detection (DFS) — WS-404
 * โมเดลความสัมพันธ์: edge (taskId -> dependsOnTaskId) หมายถึง `taskId` ต้องรอ `dependsOnTaskId`
 */

export interface DependencyEdge {
  taskId: string;
  dependsOnTaskId: string;
}

/**
 * ตรวจว่าการเพิ่มความสัมพันธ์ `taskId` ต้องรอ `dependsOnTaskId` จะทำให้เกิดวงจรปิดหรือไม่
 * จะเกิดวงจรก็ต่อเมื่อ มีเส้นทางจาก `dependsOnTaskId` เดินต่อไปยัง `taskId` อยู่แล้วในกราฟปัจจุบัน
 */
export function wouldCreateDependencyCycle(
  existingEdges: readonly DependencyEdge[],
  candidate: DependencyEdge,
): boolean {
  if (candidate.taskId === candidate.dependsOnTaskId) {
    return true;
  }

  const adjacency = new Map<string, string[]>();
  for (const edge of existingEdges) {
    const list = adjacency.get(edge.taskId);
    if (list) list.push(edge.dependsOnTaskId);
    else adjacency.set(edge.taskId, [edge.dependsOnTaskId]);
  }

  const visited = new Set<string>();
  const stack: string[] = [candidate.dependsOnTaskId];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === candidate.taskId) {
      return true;
    }
    if (visited.has(current)) continue;
    visited.add(current);

    const neighbors = adjacency.get(current);
    if (neighbors) {
      for (const next of neighbors) {
        if (!visited.has(next)) {
          stack.push(next);
        }
      }
    }
  }

  return false;
}
