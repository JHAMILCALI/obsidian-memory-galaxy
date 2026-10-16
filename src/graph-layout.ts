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

/** Shared shape of the spiral: the dust, the nebulae and the note constellations all follow these arms. */
export const ARM_COUNT = 3;
export const GALAXY_RADIUS = 165;
const GOLDEN_ANGLE = 2.399963229728653;

/** Angle of an arm's centre line at a given radius (a logarithmic spiral that winds tighter near the core). */
export function armAngle(arm: number, radius: number): number {
  return arm * (Math.PI * 2 / ARM_COUNT) + 2.15 * Math.log(1 + radius / 20);
}

export function hash(value: string): number {
  let result = 2166136261;
  for (let i = 0; i < value.length; i++) {
    result ^= value.charCodeAt(i);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

/** Connected islands become constellations strung along the spiral arms. Links never pull the overview into a knot. */
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

  const singles = components.filter((component) => component.length === 1).map((component) => component[0]);
  const clusters = components.filter((component) => component.length > 1);
  const lift = (path: string) => ((hash(path) % 1000) / 1000 - 0.5) * 5;

  // Very large vaults get tighter constellations so everything still rides the visible arms.
  let cell = spacing * 0.62;
  let positions = placeClusters(clusters, cell, lift);
  for (let attempt = 0; attempt < 6; attempt++) {
    let maxRadius = 0;
    for (const point of positions.values()) maxRadius = Math.max(maxRadius, Math.hypot(point.x, point.z));
    if (maxRadius <= GALAXY_RADIUS) break;
    cell *= Math.max(0.5, (GALAXY_RADIUS / maxRadius) * 0.97);
    positions = placeClusters(clusters, cell, lift);
  }

  // Notes without links are lone stars scattered over the outer arms.
  singles.forEach((path, index) => {
    const seed = hash(path);
    const arm = index % ARM_COUNT;
    const radius = 46 + ((index * 0.618034) % 1) * 118;
    const jitter = ((seed % 1000) / 1000 - 0.5) * 0.5;
    const theta = armAngle(arm, radius) + jitter;
    positions.set(path, { x: Math.cos(theta) * radius, y: lift(path), z: Math.sin(theta) * radius });
  });
  return positions;
}

function placeClusters(clusters: string[][], cell: number, lift: (path: string) => number): Map<string, GraphPosition> {
  const positions = new Map<string, GraphPosition>();
  // Each arm keeps a cursor; the next constellation goes to the arm with the most room left near the core.
  const cursors = Array.from({ length: ARM_COUNT }, (_, arm) => 26 + arm * 6);
  for (const component of clusters) {
    const extent = cell * Math.sqrt(component.length) * 0.9 + cell;
    let arm = 0;
    for (let i = 1; i < ARM_COUNT; i++) if (cursors[i] < cursors[arm]) arm = i;
    const centerRadius = cursors[arm] + extent * 0.75;
    cursors[arm] = centerRadius + extent * 0.75 + cell * 1.2;
    const theta = armAngle(arm, centerRadius);
    const tangent = theta + Math.PI / 2 - 0.42;
    const cx = Math.cos(theta) * centerRadius;
    const cz = Math.sin(theta) * centerRadius;
    // Golden-angle sunflower: hubs (first in BFS order) sit in the middle, stretched along the arm.
    component.forEach((path, index) => {
      const r = cell * Math.sqrt(index) * 1.05;
      const a = index * GOLDEN_ANGLE + (hash(path) % 100) / 400;
      const along = Math.cos(a) * r * 1.45;
      const across = Math.sin(a) * r * 0.75;
      positions.set(path, {
        x: cx + Math.cos(tangent) * along - Math.sin(tangent) * across,
        y: lift(path),
        z: cz + Math.sin(tangent) * along + Math.cos(tangent) * across
      });
    });
  }
  return positions;
}
