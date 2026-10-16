import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { TFile } from "obsidian";
import { layoutGraph, type GraphLink } from "./graph-layout";

const TAU = Math.PI * 2;
const NOTE_COLORS = ["#cbb4ff", "#a9a0f5", "#e2c8ff", "#9bcdf5", "#c4a8f4"];

export interface NoteStar {
  file: TFile;
  group: string;
  color: string;
  incoming: number;
  outgoing: number;
  degree: number;
}

export type NoteConnection = GraphLink;

export type StarHit =
  | { kind: "note"; note: NoteStar }
  | { kind: "empty"; index: number };

function hash(value: string): number {
  let result = 2166136261;
  for (let i = 0; i < value.length; i++) {
    result ^= value.charCodeAt(i);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function random(seed: number): number {
  let value = seed + 0x6d2b79f5;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

function haloPosition(seed: number, spread = 1): THREE.Vector3 {
  const radius = (70 + Math.sqrt(random(seed ^ 0x172a)) * 100) * spread;
  const angle = random(seed ^ 0x90ab) * TAU;
  const depth = (random(seed ^ 0x5c83) + random(seed ^ 0x2c73) - 1) * 24;
  return new THREE.Vector3(Math.cos(angle) * radius, depth, Math.sin(angle) * radius);
}

function glowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const glow = ctx.createRadialGradient(64, 64, 1, 64, 64, 64);
  glow.addColorStop(0, "rgba(255,255,255,1)");
  glow.addColorStop(0.09, "rgba(255,255,255,.94)");
  glow.addColorStop(0.25, "rgba(255,255,255,.38)");
  glow.addColorStop(0.55, "rgba(255,255,255,.08)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class GalaxyScene {
  readonly domElement: HTMLCanvasElement;
  readonly emptyNodeCount = 240;

  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(58, 1, 0.1, 1200);
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private galaxy = new THREE.Group();
  private noteLayer = new THREE.Group();
  private linkLayer = new THREE.Group();
  private background = new THREE.Group();
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private clock = new THREE.Clock();
  private texture = glowTexture();
  private geometries: THREE.BufferGeometry[] = [];
  private materials: THREE.Material[] = [];
  private noteMaterials: THREE.SpriteMaterial[] = [];
  private interactive: THREE.Sprite[] = [];
  private emptySprites: THREE.Sprite[] = [];
  private noteSprites = new Map<string, THREE.Sprite>();
  private basePositions = new Map<string, THREE.Vector3>();
  private targetPositions = new Map<string, THREE.Vector3>();
  private noteLabels = new Map<string, HTMLElement>();
  private labelLayer: HTMLElement;
  private notes: NoteStar[] = [];
  private links: NoteConnection[] = [];
  private highlightedLines: THREE.LineSegments | null = null;
  private highlightedPairs: Array<[THREE.Sprite, THREE.Sprite]> = [];
  private spacing = 15;
  private glow = 0.9;
  private showLinks = true;
  private showLabels = true;
  private labelMode: "featured" | "all" = "featured";
  private defaultDistance = 310;
  private initialFrame = true;
  private motion = true;
  private frame = 0;
  private labelElapsed = 1;
  private selectedPath: string | null = null;
  private trackedPath: string | null = null;

  constructor(host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor("#0d081b");
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.domElement = this.renderer.domElement;
    this.domElement.className = "astra-canvas";
    host.prepend(this.domElement);
    this.labelLayer = document.createElement("div");
    this.labelLayer.className = "astra-node-labels";
    host.appendChild(this.labelLayer);

    this.scene.background = new THREE.Color("#0d081b");
    this.scene.add(this.background);
    this.scene.add(this.galaxy);
    this.galaxy.add(this.linkLayer);
    this.galaxy.add(this.noteLayer);
    this.camera.position.set(0, 172, 267);
    this.camera.lookAt(0, 0, 0);
    this.controls = new OrbitControls(this.camera, this.domElement);
    this.controls.target.set(0, 0, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.055;
    this.controls.enablePan = true;
    this.controls.minDistance = 28;
    this.controls.maxDistance = 650;
    this.controls.minPolarAngle = 0.12;
    this.controls.maxPolarAngle = Math.PI - 0.12;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.24;
    this.controls.update();

    this.buildBackdrop();
    this.buildGalaxyDust();
    this.buildEmptyNodes();
    this.animate();
  }

  private addPoints(
    parent: THREE.Group,
    positions: number[],
    colors: number[],
    size: number,
    opacity: number
  ): void {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
      size,
      map: this.texture,
      vertexColors: true,
      transparent: true,
      opacity,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    parent.add(new THREE.Points(geometry, material));
    this.geometries.push(geometry);
    this.materials.push(material);
  }

  private buildBackdrop(): void {
    const positions: number[] = [];
    const colors: number[] = [];
    for (let i = 0; i < 1350; i++) {
      const theta = random(i * 13 + 71) * TAU;
      const z = random(i * 31 + 82) * 2 - 1;
      const radius = 430 + random(i * 17 + 29) * 110;
      const planar = Math.sqrt(1 - z * z);
      positions.push(Math.cos(theta) * planar * radius, z * radius, Math.sin(theta) * planar * radius);
      const tone = 0.4 + random(i * 23 + 55) * 0.5;
      colors.push(tone * 0.8, tone * 0.83, tone);
    }
    this.addPoints(this.background, positions, colors, 1.65, 0.75);
  }

  private buildGalaxyDust(): void {
    const corePositions: number[] = [];
    const coreColors: number[] = [];
    const haloPositions: number[] = [];
    const haloColors: number[] = [];
    for (let i = 0; i < 3000; i++) {
      const seed = i * 37 + 401;
      const radius = Math.sqrt(random(seed ^ 0x52)) * 84;
      const angle = random(seed ^ 0x83) * TAU;
      const y = (random(seed ^ 0xa4) + random(seed ^ 0xb5) - 1) * 17;
      const color = new THREE.Color(i % 7 === 0 ? "#dbc4ff" : i % 11 === 0 ? "#8eb9ef" : "#8d68c5");
      color.multiplyScalar(0.16 + random(seed ^ 0xc6) * 0.4);
      corePositions.push(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
      coreColors.push(color.r, color.g, color.b);
    }
    for (let i = 0; i < 780; i++) {
      const seed = i * 61 + 903;
      const position = haloPosition(seed);
      const color = new THREE.Color(i % 4 === 0 ? "#c6d9ff" : "#82b8df");
      color.multiplyScalar(0.14 + random(seed ^ 0x408) * 0.4);
      haloPositions.push(position.x, position.y, position.z);
      haloColors.push(color.r, color.g, color.b);
    }
    this.addPoints(this.galaxy, corePositions, coreColors, 1.9, 0.68);
    this.addPoints(this.galaxy, haloPositions, haloColors, 1.5, 0.48);

    for (let i = 0; i < 3; i++) {
      const cloudMaterial = new THREE.SpriteMaterial({
        map: this.texture,
        color: i === 1 ? "#7a56c0" : "#ad86e8",
        transparent: true,
        opacity: 0.055,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      this.materials.push(cloudMaterial);
      const cloud = new THREE.Sprite(cloudMaterial);
      cloud.position.set((i - 1) * 30, 0, (i % 2 ? 20 : -12));
      cloud.scale.set(120, 100, 1);
      this.galaxy.add(cloud);
    }
    const core = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.texture,
      color: "#b89ae9",
      transparent: true,
      opacity: 0.08,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    }));
    this.materials.push(core.material);
    core.scale.set(78, 78, 1);
    this.galaxy.add(core);
  }

  private buildEmptyNodes(): void {
    const materials = ["#a6d8ff", "#e2e4ff", "#a78ad8"].map((color) => {
      const material = new THREE.SpriteMaterial({
        map: this.texture,
        color,
        transparent: true,
        opacity: 0.58,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      this.materials.push(material);
      return material;
    });
    for (let i = 0; i < this.emptyNodeCount; i++) {
      const star = new THREE.Sprite(materials[i % materials.length]);
      star.position.copy(haloPosition(0x90000 + i * 67));
      const size = 3 + random(i * 19 + 780) * 3.3;
      star.scale.set(size, size, 1);
      star.userData = { kind: "empty", index: i + 1 };
      this.galaxy.add(star);
      this.emptySprites.push(star);
    }
    this.interactive = [...this.emptySprites];
  }

  setNotes(notes: NoteStar[], links: NoteConnection[]): void {
    this.notes = notes;
    this.links = links;
    this.noteLayer.clear();
    for (const material of this.noteMaterials) material.dispose();
    this.noteMaterials = [];
    this.noteSprites.clear();
    this.basePositions.clear();
    this.targetPositions.clear();
    this.noteLabels.clear();
    this.labelLayer.replaceChildren();
    this.interactive = [...this.emptySprites];
    this.selectedPath = null;
    this.trackedPath = null;
    for (const note of notes) {
      const ageDays = Math.max(0, (Date.now() - (note.file.stat?.mtime ?? 0)) / 86_400_000);
      const recency = ageDays < 40 ? Math.exp(-ageDays / 12) : 0;
      const material = new THREE.SpriteMaterial({
        map: this.texture,
        color: note.color,
        transparent: true,
        opacity: 0.5 + recency * 0.28,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false
      });
      this.noteMaterials.push(material);
      const sprite = new THREE.Sprite(material);
      const size = 6.2 + Math.min(2, Math.log2(note.degree + 1) * 0.55) + recency * 1.6;
      sprite.scale.set(size, size, 1);
      sprite.userData = { kind: "note", note, baseSize: size, recency };
      sprite.renderOrder = 10;
      this.noteLayer.add(sprite);
      this.noteSprites.set(note.file.path, sprite);
      this.interactive.push(sprite);
    }
    for (const note of notes) {
      const label = document.createElement("div");
      label.className = "astra-node-label";
      label.textContent = note.file.basename;
      label.title = note.file.basename;
      label.dataset.path = note.file.path;
      label.style.setProperty("--astra-node-color", note.color);
      this.labelLayer.appendChild(label);
      this.noteLabels.set(note.file.path, label);
    }
    this.repositionNotes();
  }

  private disposeLines(line: THREE.LineSegments | null): void {
    if (!line) return;
    line.parent?.remove(line);
    line.geometry.dispose();
    const materials = Array.isArray(line.material) ? line.material : [line.material];
    for (const material of materials) material.dispose();
  }

  private repositionNotes(): void {
    const positions = layoutGraph(this.notes.map((note) => note.file.path), this.links, this.spacing);
    let radius = 0;
    for (const [path, sprite] of this.noteSprites) {
      const position = positions.get(path);
      if (position) {
        const base = new THREE.Vector3(position.x, position.y, position.z);
        this.basePositions.set(path, base);
        this.targetPositions.set(path, base.clone());
        sprite.position.copy(base);
        radius = Math.max(radius, Math.hypot(position.x, position.z));
      }
    }
    this.defaultDistance = this.notes.length ? THREE.MathUtils.clamp(radius * 2.3 + 65, 320, 460) : 365;
    if (this.initialFrame) {
      this.initialFrame = false;
      this.reset();
    }
    if (this.selectedPath) this.arrangeBranch(this.selectedPath);
    this.rebuildHighlightedLinks();
  }

  private arrangeBranch(path: string): void {
    for (const [notePath, base] of this.basePositions) this.targetPositions.set(notePath, base.clone());
    const related = this.links
      .filter((link) => link.source === path || link.target === path)
      .map((link) => link.source === path ? link.target : link.source)
      .sort((a, b) => {
        const first = this.notes.find((note) => note.file.path === a);
        const second = this.notes.find((note) => note.file.path === b);
        return (first?.group ?? "").localeCompare(second?.group ?? "") ||
          (first?.file.basename ?? a).localeCompare(second?.file.basename ?? b);
      });
    this.targetPositions.set(path, new THREE.Vector3(0, 12, 0));
    related.forEach((neighbor, index) => {
      const ring = index < 8 ? 0 : index < 22 ? 1 : 2 + Math.floor((index - 22) / 20);
      const first = ring === 0 ? 0 : ring === 1 ? 8 : 22 + (ring - 2) * 20;
      const count = ring === 0 ? Math.min(8, related.length) : ring === 1 ? Math.min(14, related.length - 8) : Math.min(20, related.length - first);
      const angle = -Math.PI / 2 + (index - first + 0.5) * TAU / Math.max(count, 1) + ring * 0.15;
      const distance = 31 + ring * 25;
      this.targetPositions.set(neighbor, new THREE.Vector3(
        Math.cos(angle) * distance,
        11 + (ring % 2) * 5,
        Math.sin(angle) * distance
      ));
    });
  }

  private rebuildHighlightedLinks(): void {
    this.disposeLines(this.highlightedLines);
    this.highlightedLines = null;
    this.highlightedPairs = [];
    if (!this.selectedPath) return;
    const vertices: number[] = [];
    for (const link of this.links) {
      if (link.source !== this.selectedPath && link.target !== this.selectedPath) continue;
      const a = this.noteSprites.get(link.source);
      const b = this.noteSprites.get(link.target);
      if (!a || !b) continue;
      vertices.push(a.position.x, a.position.y, a.position.z, b.position.x, b.position.y, b.position.z);
      this.highlightedPairs.push([a, b]);
    }
    if (!vertices.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    const material = new THREE.LineBasicMaterial({
      color: "#e9c4ff",
      transparent: true,
      opacity: Math.min(1, 0.8 * this.glow),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false
    });
    this.highlightedLines = new THREE.LineSegments(geometry, material);
    this.highlightedLines.renderOrder = 8;
    this.highlightedLines.visible = this.showLinks;
    this.linkLayer.add(this.highlightedLines);
  }

  static colorForGroup(group: string): string {
    return NOTE_COLORS[hash(group) % NOTE_COLORS.length];
  }

  pick(clientX: number, clientY: number): StarHit | null {
    const rect = this.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    this.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.galaxy.updateMatrixWorld(true);
    this.camera.updateMatrixWorld(true);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.interactive, false);
    if (!hits.length) return null;
    const data = hits[0].object.userData as StarHit;
    return data.kind === "note" ? { kind: "note", note: data.note } : { kind: "empty", index: data.index };
  }

  select(path: string | null): void {
    if (path !== this.selectedPath) this.trackedPath = null;
    this.selectedPath = path;
    const neighbors = new Set<string>();
    if (path) {
      for (const link of this.links) {
        if (link.source === path) neighbors.add(link.target);
        if (link.target === path) neighbors.add(link.source);
      }
      this.arrangeBranch(path);
    } else {
      for (const [notePath, base] of this.basePositions) this.targetPositions.set(notePath, base.clone());
    }
    for (const [notePath, sprite] of this.noteSprites) {
      const size = sprite.userData.baseSize as number;
      const factor = notePath === path ? 1.95 : neighbors.has(notePath) ? 1.35 : path ? 0.72 : 1;
      sprite.scale.setScalar(size * factor * (0.84 + this.glow * 0.16));
      (sprite.material as THREE.SpriteMaterial).opacity = path
        ? notePath === path ? 1 : neighbors.has(notePath) ? 0.9 : 0.18
        : Math.min(0.86, 0.39 + this.glow * 0.13 + (sprite.userData.recency as number) * 0.27);
    }
    this.rebuildHighlightedLinks();
  }

  focus(path: string): void {
    const sprite = this.noteSprites.get(path);
    if (!sprite) return;
    this.select(path);
    const position = new THREE.Vector3(0, 12, 0);
    this.controls.target.copy(position);
    this.camera.position.copy(position).add(new THREE.Vector3(0, 92, 112));
    this.camera.lookAt(position);
    this.controls.update();
  }

  reset(): void {
    this.trackedPath = null;
    this.select(null);
    this.controls.target.set(0, 0, 0);
    this.camera.position.set(0, this.defaultDistance * 0.69, this.defaultDistance * 0.73);
    this.camera.lookAt(0, 0, 0);
    this.controls.update();
  }

  wideView(): void {
    this.trackedPath = null;
    this.select(null);
    this.controls.target.set(0, 0, 0);
    this.camera.position.set(0, 245, 320);
    this.camera.lookAt(0, 0, 0);
    this.controls.update();
  }

  zoom(factor: number): void {
    const direction = this.camera.position.clone().sub(this.controls.target);
    const distance = THREE.MathUtils.clamp(direction.length() / factor, this.controls.minDistance, this.controls.maxDistance);
    direction.setLength(distance);
    this.camera.position.copy(this.controls.target).add(direction);
    this.controls.update();
  }

  setMotion(enabled: boolean): void {
    this.motion = enabled;
    this.controls.autoRotate = enabled;
  }

  setSpacing(spacing: number): void {
    this.spacing = THREE.MathUtils.clamp(spacing, 8, 20);
    this.repositionNotes();
  }

  setGlow(glow: number): void {
    this.glow = THREE.MathUtils.clamp(glow, 0.5, 2);
    if (this.highlightedLines) (this.highlightedLines.material as THREE.LineBasicMaterial).opacity = Math.min(1, 0.8 * this.glow);
    this.select(this.selectedPath);
  }

  setShowLinks(visible: boolean): void {
    this.showLinks = visible;
    if (this.highlightedLines) this.highlightedLines.visible = visible;
  }

  setShowLabels(visible: boolean): void {
    this.showLabels = visible;
    this.labelLayer.hidden = !visible;
  }

  setLabelMode(mode: "featured" | "all"): void {
    this.labelMode = mode;
    this.labelElapsed = 1;
  }

  resize(width: number, height: number): void {
    if (width < 1 || height < 1) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  private animate = (): void => {
    this.frame = requestAnimationFrame(this.animate);
    const delta = Math.min(this.clock.getDelta(), 0.05);
    let moved = false;
    for (const [path, sprite] of this.noteSprites) {
      const target = this.targetPositions.get(path);
      if (!target || sprite.position.distanceToSquared(target) < 0.001) continue;
      sprite.position.lerp(target, Math.min(1, delta * 7.5));
      moved = true;
    }
    if (moved && this.highlightedLines) {
      const positions = this.highlightedLines.geometry.getAttribute("position") as THREE.BufferAttribute;
      this.highlightedPairs.forEach(([a, b], index) => {
        positions.setXYZ(index * 2, a.position.x, a.position.y, a.position.z);
        positions.setXYZ(index * 2 + 1, b.position.x, b.position.y, b.position.z);
      });
      positions.needsUpdate = true;
    }
    if (this.motion) {
      this.galaxy.rotation.y += delta * 0.06;
      this.background.rotation.y -= delta * 0.002;
    }
    if (this.trackedPath) {
      const sprite = this.noteSprites.get(this.trackedPath);
      if (sprite) {
        this.galaxy.updateMatrixWorld(true);
        const position = new THREE.Vector3();
        sprite.getWorldPosition(position);
        const shift = position.sub(this.controls.target);
        this.controls.target.add(shift);
        this.camera.position.add(shift);
      }
    }
    this.controls.update(delta);
    this.renderer.render(this.scene, this.camera);
    this.labelElapsed += delta;
    if (this.labelElapsed >= 0.12) {
      this.labelElapsed = 0;
      this.updateLabels();
    }
  };

  private updateLabels(): void {
    if (!this.showLabels || !this.noteLabels.size) return;
    const width = this.domElement.clientWidth;
    const height = this.domElement.clientHeight;
    if (!width || !height) return;
    const placed: Array<{ x: number; y: number; width: number; height: number }> = [];
    const visible = new Set<string>();
    if (this.selectedPath) {
      visible.add(this.selectedPath);
      for (const link of this.links) {
        if (link.source === this.selectedPath) visible.add(link.target);
        if (link.target === this.selectedPath) visible.add(link.source);
      }
    } else if (this.labelMode === "featured") {
      const connected = [...this.notes].filter((note) => note.degree > 0)
        .sort((a, b) => b.degree - a.degree || a.file.basename.localeCompare(b.file.basename));
      const leaders = new Map<string, NoteStar>();
      for (const note of connected) if (!leaders.has(note.group)) leaders.set(note.group, note);
      for (const note of leaders.values()) visible.add(note.file.path);
      for (const note of connected) {
        if (visible.size >= 12) break;
        visible.add(note.file.path);
      }
      if (!visible.size) for (const note of this.notes.slice(0, 8)) visible.add(note.file.path);
    }
    const ordered = [...this.notes].sort((a, b) =>
      Number(b.file.path === this.selectedPath) - Number(a.file.path === this.selectedPath)
      || b.degree - a.degree
    );
    for (const label of this.noteLabels.values()) label.style.display = "none";
    this.galaxy.updateMatrixWorld(true);
    for (const note of ordered) {
      if ((this.selectedPath || this.labelMode === "featured") && !visible.has(note.file.path)) continue;
      const label = this.noteLabels.get(note.file.path);
      const sprite = this.noteSprites.get(note.file.path);
      if (!label || !sprite) continue;
      const point = new THREE.Vector3();
      sprite.getWorldPosition(point);
      point.y += 3;
      point.project(this.camera);
      if (point.z <= -1 || point.z >= 1) continue;
      const x = (point.x * 0.5 + 0.5) * width;
      const y = (-point.y * 0.5 + 0.5) * height;
      const labelWidth = Math.min(155, 14 + note.file.basename.length * 5.4);
      const labelHeight = 18;
      const safeTop = Math.min(192, height * 0.25);
      const safeBottom = height - Math.min(82, height * 0.12);
      const candidates: Array<[number, number]> = [
        [0, -19], [0, 20], [0, -40], [0, 41],
        [-labelWidth / 2 - 10, 0], [labelWidth / 2 + 10, 0],
        [-labelWidth / 2 - 12, -24], [labelWidth / 2 + 12, -24],
        [-labelWidth / 2 - 12, 25], [labelWidth / 2 + 12, 25],
        [0, -61], [0, 62]
      ];
      let bestX = x;
      let bestY = y;
      let bestScore = Infinity;
      for (const [dx, dy] of candidates) {
        const cx = Math.max(labelWidth / 2 + 10, Math.min(width - labelWidth / 2 - 10, x + dx));
        const cy = Math.max(safeTop + labelHeight / 2, Math.min(safeBottom - labelHeight / 2, y + dy));
        let score = Math.hypot(cx - x, cy - y) * 0.05;
        for (const other of placed) {
          const overlapX = Math.max(0, (labelWidth + other.width) / 2 + 4 - Math.abs(cx - other.x));
          const overlapY = Math.max(0, (labelHeight + other.height) / 2 + 3 - Math.abs(cy - other.y));
          score += overlapX * overlapY;
        }
        if (score < bestScore) { bestScore = score; bestX = cx; bestY = cy; }
        if (score < 1) break;
      }
      const selected = note.file.path === this.selectedPath;
      label.style.display = "block";
      label.style.left = `${bestX}px`;
      label.style.top = `${bestY}px`;
      label.classList.toggle("is-selected", selected);
      placed.push({ x: bestX, y: bestY, width: labelWidth, height: labelHeight });
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.controls.dispose();
    this.disposeLines(this.highlightedLines);
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    for (const material of this.noteMaterials) material.dispose();
    this.texture.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.labelLayer.remove();
    this.domElement.remove();
  }
}
