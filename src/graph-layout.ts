export interface GraphLink {
  source: string;
  target: string;
  weight: number;
}

export interface GraphPosition {
  x: number;
  y: number;
  z: number;
}

function hash(value: string): number {
  let result = 2166136261;
  for (let i = 0; i < value.length; i++) {
    result ^= value.charCodeAt(i);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function hexSlots(count: number): Array<[number, number]> {
  const slots: Array<[number, number]> = [[0, 0]];
  const directions: Array<[number, number]> = [[-1, 1], [-1, 0], [0, -1], [1, -1], [1, 0], [0, 1]];
  for (let ring = 1; slots.length < count; ring++) {
    let q = ring;
    let r = 0;
    for (const [dq, dr] of directions) {
      for (let step = 0; step < ring && slots.length < count; step++) {
        slots.push([q, r]);
        q += dq;
        r += dr;
      }
    }
  }
  return slots;
}

/** Connected islands are laid out separately among the galaxy arms. Links never pull the overview into a knot. */
export function layoutGraph(paths: string[], links: GraphLink[], spacing: number): Map<string, GraphPosition> {
  const uniquePaths = [...new Set(paths)];
  const adjacency = new Map(uniquePaths.map((path) => [path, new Set<string>()]));
  for (const link of links) {
    if (!adjacency.has(link.source) || !adjacency.has(link.target) || link.source === link.target) continue;
    adjacency.get(link.source)!.add(link.target);
    adjacency.get(link.target)!.add(link.source);
  }

  const components: string[][] = [];
  const visited = new Set<string>();
  const priority = [...uniquePaths].sort((a, b) => adjacency.get(b)!.size - adjacency.get(a)!.size || a.localeCompare(b));
  for (const root of priority) {
    if (visited.has(root)) continue;
    const component: string[] = [];
    const queue = [root];
    visited.add(root);
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const path = queue[cursor];
      component.push(path);
      for (const neighbor of [...adjacency.get(path)!].sort()) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
    components.push(component);
  }
  components.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));

  const positions = new Map<string, GraphPosition>();
  const cell = spacing * 1.34;
  const anchors: Array<[number, number]> = [
    [-56, -14], [56, -14], [0, 69], [0, -75], [-110, 73], [110, 73], [-110, -88], [110, -88]
  ];
  // Single notes become a loose outer constellation instead of joining an unrelated island.
  let singleton = 0;
  let island = 0;
  for (const component of components) {
    if (component.length === 1) {
      const path = component[0];
      const angle = singleton * 2.399963229728653 + 0.35;
      const radius = 119 + (singleton % 4) * 10;
      positions.set(path, {
        x: Math.cos(angle) * radius,
        y: 6 + (hash(path) % 50) / 25,
        z: Math.sin(angle) * radius
      });
      singleton++;
      continue;
    }
    const anchor = anchors[island] ?? [Math.cos(island * 2.4) * 112, Math.sin(island * 2.4) * 112];
    const slots = hexSlots(component.length);
    const localScale = component.length > 55 ? 0.82 : 1;
    component.forEach((path, index) => {
      const [q, r] = slots[index];
      positions.set(path, {
        x: anchor[0] + (q + r / 2) * cell * localScale,
        y: 6 + (hash(path) % 50) / 25,
        z: anchor[1] + r * cell * Math.sqrt(3) / 2 * localScale
      });
    });
    island++;
  }

  // Keep even very large vaults within the visible disc; the camera can then frame the same galaxy.
  let maxRadius = 0;
  for (const point of positions.values()) maxRadius = Math.max(maxRadius, Math.hypot(point.x, point.z));
  if (maxRadius > 161) {
    const scale = 161 / maxRadius;
    for (const point of positions.values()) {
      point.x *= scale;
      point.z *= scale;
    }
  }
  return positions;
}
