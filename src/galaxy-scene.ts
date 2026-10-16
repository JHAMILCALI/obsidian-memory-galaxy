import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import type { TFile } from "obsidian";
import { ARM_COUNT, armAngle, hash, layoutGraph, type GraphLink } from "./graph-layout";

const TAU = Math.PI * 2;
const NOTE_COLORS = ["#8fd8ff", "#ffcf7d", "#ff9ad5", "#b99bff", "#86f5d0", "#ff9f86", "#a3b6ff"];
const RECENT_TINT = new THREE.Color("#fff3da");
/** A chosen idea and its branch float above the disc, clear of the bright core. */
const BRANCH_HEIGHT = 46;
/** Colour of the dust from the core outwards: warm white heart, pink and violet arms, cyan rim. */
const DUST_STOPS: Array<[number, THREE.Color]> = [
  [0, new THREE.Color("#fff1e8")],
  [0.12, new THREE.Color("#ffb6e3")],
  [0.32, new THREE.Color("#c48cff")],
  [0.58, new THREE.Color("#8a8dff")],
  [0.86, new THREE.Color("#6fd2ff")],
  [1, new THREE.Color("#5fb8ff")]
];

export interface NoteStar {
  file: TFile;
  group: string;
  color: string;
  incoming: number;
  outgoing: number;
  degree: number;
  /** 0 for older notes; up to 1 for the most recently edited ideas, which shine and pulse. */
  recency: number;
}

export type NoteConnection = GraphLink;

export type StarHit = { kind: "note"; note: NoteStar };

function random(seed: number): number {
  let value = seed + 0x6d2b79f5;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

/** Roughly normal noise with a standard deviation near 1. */
function gaussian(seed: number): number {
  return (random(seed) + random(seed ^ 0x3c6e) + random(seed ^ 0x7f4a) - 1.5) * 2;
}

function dustColor(t: number): THREE.Color {
  for (let i = 1; i < DUST_STOPS.length; i++) {
    const [end, color] = DUST_STOPS[i];
    if (t <= end) {
      const [start, previous] = DUST_STOPS[i - 1];
      return previous.clone().lerp(color, (t - start) / (end - start));
    }
  }
  return DUST_STOPS[DUST_STOPS.length - 1][1].clone();
}

/** A point on (or near) one of the spiral arms. */
function armPosition(seed: number, minRadius: number, maxRadius: number, width = 1): THREE.Vector3 {
  const arm = Math.floor(random(seed ^ 0x11) * ARM_COUNT);
  const radius = minRadius + Math.pow(random(seed ^ 0x22), 0.9) * (maxRadius - minRadius);
  const theta = armAngle(arm, radius) + gaussian(seed ^ 0x33) * 0.1;
  const across = gaussian(seed ^ 0x44) * (4.5 + radius * 0.12) * width;
  const y = gaussian(seed ^ 0x55) * (1.6 + 5 * Math.exp(-radius / 38));
  return new THREE.Vector3(
    Math.cos(theta) * radius - Math.sin(theta) * across,
    y,
    Math.sin(theta) * radius + Math.cos(theta) * across
  );
}

function canvasTexture(draw: (ctx: CanvasRenderingContext2D, size: number) => void): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  draw(canvas.getContext("2d")!, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function drawGlow(ctx: CanvasRenderingContext2D, size: number): void {
  const c = size / 2;
  const glow = ctx.createRadialGradient(c, c, 0, c, c, c);
  glow.addColorStop(0, "rgba(255,255,255,1)");
  glow.addColorStop(0.07, "rgba(255,255,255,.95)");
  glow.addColorStop(0.18, "rgba(255,255,255,.42)");
  glow.addColorStop(0.42, "rgba(255,255,255,.1)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);
}

/** Soft glow plus four thin diffraction spikes: the look of a bright star in a telescope photo. */
function drawSparkle(ctx: CanvasRenderingContext2D, size: number): void {
  drawGlow(ctx, size);
  const c = size / 2;
  ctx.globalCompositeOperation = "lighter";
  for (const [angle, length, alpha] of [[0, 1, 0.85], [Math.PI / 2, 1, 0.85], [Math.PI / 4, 0.45, 0.35], [-Math.PI / 4, 0.45, 0.35]]) {
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(angle);
    const half = c * length;
    const spike = ctx.createLinearGradient(-half, 0, half, 0);
    spike.addColorStop(0, "rgba(255,255,255,0)");
    spike.addColorStop(0.5, `rgba(255,255,255,${alpha})`);
    spike.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = spike;
    ctx.fillRect(-half, -1, half * 2, 2);
    ctx.restore();
  }
}

function drawRing(ctx: CanvasRenderingContext2D, size: number): void {
  const c = size / 2;
  const ring = ctx.createRadialGradient(c, c, c * 0.55, c, c, c);
  ring.addColorStop(0, "rgba(255,255,255,0)");
  ring.addColorStop(0.62, "rgba(255,255,255,.75)");
  ring.addColorStop(0.75, "rgba(255,255,255,.2)");
  ring.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = ring;
  ctx.fillRect(0, 0, size, size);
}

const STAR_VERTEX = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aPhase;
  uniform float uTime;
  uniform float uScale;
  uniform float uOpacity;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * view;
    float size = aSize * uScale / max(1.0, -view.z);
    float twinkle = 0.72 + 0.28 * sin(uTime * (0.5 + aPhase * 1.9) + aPhase * 37.0);
    gl_PointSize = max(1.5, size);
    vColor = aColor;
    vAlpha = uOpacity * twinkle * min(1.0, size / 1.5);
  }
`;

const STAR_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float glow = exp(-d * d * 5.5);
    float core = smoothstep(0.38, 0.0, d);
    gl_FragColor = vec4(vColor, (glow * 0.55 + core * 0.75) * vAlpha);
  }
`;

interface StarField {
  points: THREE.Points;
  material: THREE.ShaderMaterial;
  opacity: number;
  dims: boolean;
}

interface Glow {
  sprite: THREE.Sprite;
  opacity: number;
}

export class GalaxyScene {
  readonly domElement: HTMLCanvasElement;

  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(58, 1, 0.1, 1600);
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private controls: OrbitControls;
  private galaxy = new THREE.Group();
  private noteLayer = new THREE.Group();
  private linkLayer = new THREE.Group();
  private background = new THREE.Group();
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private clock = new THREE.Clock();
  private glowMap = canvasTexture(drawGlow);
  private sparkleMap = canvasTexture(drawSparkle);
  private ringMap = canvasTexture(drawRing);
  private geometries: THREE.BufferGeometry[] = [];
  private materials: THREE.Material[] = [];
  private fields: StarField[] = [];
  private glows: Glow[] = [];
  private noteMaterials: THREE.Material[] = [];
  private interactive: THREE.Sprite[] = [];
  private noteSprites = new Map<string, THREE.Sprite>();
  private rings: Array<{ ring: THREE.Sprite; star: THREE.Sprite; recency: number; phase: number }> = [];
  private basePositions = new Map<string, THREE.Vector3>();
  private targetPositions = new Map<string, THREE.Vector3>();
  private noteLabels = new Map<string, HTMLElement>();
  private labelLayer: HTMLElement;
  private leaderLayer: SVGSVGElement;
  private leaders: SVGLineElement[] = [];
  private notes: NoteStar[] = [];
  private links: NoteConnection[] = [];
  private constellationLines: THREE.LineSegments | null = null;
  private constellationPairs: Array<[THREE.Sprite, THREE.Sprite]> = [];
  private highlightedLines: THREE.LineSegments | null = null;
  private highlightedPairs: Array<[THREE.Sprite, THREE.Sprite]> = [];
  private spacing = 15;
  private glow = 0.9;
  private showLinks = true;
  private showConstellations = true;
  private showLabels = true;
  private labelMode: "featured" | "all" = "featured";
  private defaultDistance = 310;
  private initialFrame = true;
  private motion = true;
  private time = 0;
  private dim = 1;
  private frame = 0;
  private labelElapsed = 1;
  private selectedPath: string | null = null;
  private trackedPath: string | null = null;

  constructor(host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor("#06040d");
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.domElement = this.renderer.domElement;
    this.domElement.className = "astra-canvas";
    host.prepend(this.domElement);
    this.labelLayer = document.createElement("div");
    this.labelLayer.className = "astra-node-labels";
    this.leaderLayer = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.leaderLayer.setAttribute("class", "astra-label-leaders");
    this.leaderLayer.setAttribute("aria-hidden", "true");
    this.labelLayer.appendChild(this.leaderLayer);
    host.appendChild(this.labelLayer);

    this.scene.background = new THREE.Color("#06040d");
    this.scene.add(this.background);
    this.scene.add(this.galaxy);
    this.galaxy.add(this.linkLayer);
    this.galaxy.add(this.noteLayer);
    this.camera.position.set(0, 172, 267);
    this.camera.lookAt(0, 0, 0);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 1, 0.62, 0.08);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.controls = new OrbitControls(this.camera, this.domElement);
    this.controls.target.set(0, 0, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.055;
    this.controls.enablePan = true;
    this.controls.minDistance = 28;
    this.controls.maxDistance = 750;
    this.controls.minPolarAngle = 0.12;
    this.controls.maxPolarAngle = Math.PI - 0.12;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.18;
    this.controls.update();

    this.buildBackdrop();
    this.buildGalaxyDust();
    this.buildNebulae();
    this.animate();
  }

  private addField(
    parent: THREE.Group,
    positions: number[],
    colors: number[],
    sizes: number[],
    opacity: number,
    dims: boolean
  ): void {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("aColor", new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute("aSize", new THREE.Float32BufferAttribute(sizes, 1));
    geometry.setAttribute("aPhase", new THREE.Float32BufferAttribute(sizes.map((_, i) => random(i * 7 + positions.length)), 1));
    const material = new THREE.ShaderMaterial({
      vertexShader: STAR_VERTEX,
      fragmentShader: STAR_FRAGMENT,
      uniforms: { uTime: { value: 0 }, uScale: { value: 700 }, uOpacity: { value: opacity } },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    parent.add(points);
    this.geometries.push(geometry);
    this.materials.push(material);
    this.fields.push({ points, material, opacity, dims });
  }

  private addGlow(parent: THREE.Object3D, color: string, scale: number, opacity: number, position = new THREE.Vector3()): void {
    const material = new THREE.SpriteMaterial({
      map: this.glowMap,
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.materials.push(material);
    const sprite = new THREE.Sprite(material);
    sprite.position.copy(position);
    sprite.scale.set(scale, scale, 1);
    parent.add(sprite);
    this.glows.push({ sprite, opacity });
  }

  private buildBackdrop(): void {
    const positions: number[] = [];
    const colors: number[] = [];
    const sizes: number[] = [];
    for (let i = 0; i < 2200; i++) {
      const theta = random(i * 13 + 71) * TAU;
      const z = random(i * 31 + 82) * 2 - 1;
      const radius = 620 + random(i * 17 + 29) * 160;
      const planar = Math.sqrt(1 - z * z);
      positions.push(Math.cos(theta) * planar * radius, z * radius, Math.sin(theta) * planar * radius);
      const tone = 0.25 + random(i * 23 + 55) * 0.55;
      const warm = random(i * 41 + 9) < 0.15;
      colors.push(tone * (warm ? 1 : 0.78), tone * (warm ? 0.88 : 0.84), tone * (warm ? 0.78 : 1));
      sizes.push(random(i * 5 + 3) < 0.04 ? 3.4 : 1.4 + random(i * 3 + 1) * 1.2);
    }
    this.addField(this.background, positions, colors, sizes, 0.85, false);
  }

  private buildGalaxyDust(): void {
    const positions: number[] = [];
    const colors: number[] = [];
    const sizes: number[] = [];
    const push = (point: THREE.Vector3, color: THREE.Color, size: number) => {
      positions.push(point.x, point.y, point.z);
      colors.push(color.r, color.g, color.b);
      sizes.push(size);
    };

    // Bulge: a dense, warm heart that the bloom turns into the bright core of the galaxy.
    for (let i = 0; i < 2600; i++) {
      const seed = i * 29 + 17;
      const radius = Math.abs(gaussian(seed)) * 12 + random(seed ^ 0x1f) * 4;
      const angle = random(seed ^ 0x2e) * TAU;
      const point = new THREE.Vector3(Math.cos(angle) * radius, gaussian(seed ^ 0x3d) * 4.5 * Math.exp(-radius / 22), Math.sin(angle) * radius);
      const color = dustColor(radius / 170 * 0.8).multiplyScalar(0.1 + random(seed ^ 0x4c) * 0.26);
      push(point, color, 0.9 + random(seed ^ 0x5b) * 0.9);
    }

    // Spiral arms: most of the light, with scattered gold, cyan and pink stars like a real photo.
    for (let i = 0; i < 13000; i++) {
      const seed = i * 37 + 401;
      const point = armPosition(seed, 9, 182);
      const t = Math.min(1, Math.hypot(point.x, point.z) / 175);
      const pick = random(seed ^ 0x66);
      const color = pick < 0.07 ? new THREE.Color("#ffd27f")
        : pick < 0.12 ? new THREE.Color("#8fe9ff")
        : pick < 0.16 ? new THREE.Color("#ff8fd6")
        : dustColor(t);
      const bright = random(seed ^ 0x77) < 0.035;
      color.multiplyScalar(bright ? 0.85 : 0.18 + random(seed ^ 0x88) * 0.42);
      push(point, color, bright ? 2.4 + random(seed ^ 0x99) * 1.3 : 0.9 + random(seed ^ 0x99) * 0.9);
    }

    // A faint disc between the arms so the galaxy reads as one body instead of three ribbons.
    for (let i = 0; i < 3400; i++) {
      const seed = i * 53 + 1201;
      const radius = 14 + Math.sqrt(random(seed)) * 175;
      const angle = random(seed ^ 0xab) * TAU;
      const point = new THREE.Vector3(Math.cos(angle) * radius, gaussian(seed ^ 0xbc) * 2.5, Math.sin(angle) * radius);
      push(point, dustColor(radius / 175).multiplyScalar(0.1 + random(seed ^ 0xcd) * 0.16), 0.8 + random(seed ^ 0xde) * 0.6);
    }
    this.addField(this.galaxy, positions, colors, sizes, 1, true);
  }

  private buildNebulae(): void {
    this.addGlow(this.galaxy, "#fff0e4", 16, 0.7);
    this.addGlow(this.galaxy, "#ffb5e8", 46, 0.26);
    this.addGlow(this.galaxy, "#a46cf0", 130, 0.2);
    this.addGlow(this.galaxy, "#5b3fa8", 330, 0.12);
    const tints = ["#c06cf0", "#ff7fc8", "#6d7dff", "#57b8ff"];
    for (let i = 0; i < 27; i++) {
      const seed = 0x4e00 + i * 131;
      const arm = i % ARM_COUNT;
      const radius = 24 + (Math.floor(i / ARM_COUNT) / 8) * 140;
      const theta = armAngle(arm, radius) + gaussian(seed) * 0.05;
      const position = new THREE.Vector3(Math.cos(theta) * radius, 0, Math.sin(theta) * radius);
      const tint = tints[Math.min(tints.length - 1, Math.floor(radius / 45))];
      this.addGlow(this.galaxy, tint, 34 + radius * 0.22 + random(seed ^ 0x1) * 14, 0.07 + random(seed ^ 0x2) * 0.05, position);
    }
  }

  setNotes(notes: NoteStar[], links: NoteConnection[]): void {
    this.notes = notes;
    this.links = links;
    this.noteLayer.clear();
    for (const material of this.noteMaterials) material.dispose();
    this.noteMaterials = [];
    this.noteSprites.clear();
    this.rings = [];
    this.basePositions.clear();
    this.targetPositions.clear();
    this.noteLabels.clear();
    this.labelLayer.replaceChildren(this.leaderLayer);
    this.leaderLayer.replaceChildren();
    this.leaders = [];
    this.interactive = [];
    this.selectedPath = null;
    this.trackedPath = null;
    this.labelElapsed = 1;
    for (const note of notes) {
      const recency = THREE.MathUtils.clamp(note.recency, 0, 1);
      const color = new THREE.Color(note.color).lerp(RECENT_TINT, recency * 0.5);
      const material = new THREE.SpriteMaterial({
        map: recency > 0 ? this.sparkleMap : this.glowMap,
        color,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false
      });
      this.noteMaterials.push(material);
      const sprite = new THREE.Sprite(material);
      const size = 4.6 + Math.min(2.6, Math.log2(note.degree + 1) * 0.75) + recency * 4.2;
      const phase = (hash(note.file.path) % 1000) / 1000;
      sprite.scale.set(size, size, 1);
      sprite.userData = { kind: "note", note, baseSize: size, targetSize: size, recency, phase };
      sprite.renderOrder = 10;
      this.noteLayer.add(sprite);
      this.noteSprites.set(note.file.path, sprite);
      this.interactive.push(sprite);
      if (recency > 0) {
        const ringMaterial = new THREE.SpriteMaterial({
          map: this.ringMap,
          color,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          depthTest: false
        });
        this.noteMaterials.push(ringMaterial);
        const ring = new THREE.Sprite(ringMaterial);
        ring.renderOrder = 9;
        this.noteLayer.add(ring);
        this.rings.push({ ring, star: sprite, recency, phase });
      }
    }
    for (const note of notes) {
      const label = document.createElement("div");
      label.className = "astra-node-label";
      label.style.display = "none";
      label.classList.toggle("is-recent", note.recency > 0);
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
    this.defaultDistance = THREE.MathUtils.clamp(Math.max(radius, 150) * 1.75 + 40, 320, 420);
    if (this.initialFrame) {
      this.initialFrame = false;
      this.reset();
    }
    if (this.selectedPath) this.arrangeBranch(this.selectedPath);
    this.rebuildConstellations();
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
    this.targetPositions.set(path, new THREE.Vector3(0, BRANCH_HEIGHT, 0));
    related.forEach((neighbor, index) => {
      const ring = index < 8 ? 0 : index < 22 ? 1 : 2 + Math.floor((index - 22) / 20);
      const first = ring === 0 ? 0 : ring === 1 ? 8 : 22 + (ring - 2) * 20;
      const count = ring === 0 ? Math.min(8, related.length) : ring === 1 ? Math.min(14, related.length - 8) : Math.min(20, related.length - first);
      const angle = -Math.PI / 2 + (index - first + 0.5) * TAU / Math.max(count, 1) + ring * 0.15;
      const distance = 31 + ring * 25;
      this.targetPositions.set(neighbor, new THREE.Vector3(
        Math.cos(angle) * distance,
        BRANCH_HEIGHT - 1 + (ring % 2) * 5,
        Math.sin(angle) * distance
      ));
    });
  }

  /** Faint lines inside each linked island, so related ideas read as constellations in the overview. */
  private rebuildConstellations(): void {
    this.disposeLines(this.constellationLines);
    this.constellationLines = null;
    this.constellationPairs = [];
    const vertices: number[] = [];
    const colors: number[] = [];
    for (const link of this.links) {
      const a = this.noteSprites.get(link.source);
      const b = this.noteSprites.get(link.target);
      if (!a || !b) continue;
      const colorA = (a.material as THREE.SpriteMaterial).color;
      const colorB = (b.material as THREE.SpriteMaterial).color;
      vertices.push(a.position.x, a.position.y, a.position.z, b.position.x, b.position.y, b.position.z);
      colors.push(colorA.r, colorA.g, colorA.b, colorB.r, colorB.g, colorB.b);
      this.constellationPairs.push([a, b]);
    }
    if (!vertices.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false
    });
    this.constellationLines = new THREE.LineSegments(geometry, material);
    this.constellationLines.renderOrder = 7;
    this.linkLayer.add(this.constellationLines);
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
      color: "#f1d4ff",
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
    return { kind: "note", note: (hits[0].object.userData as StarHit).note };
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
      const recency = sprite.userData.recency as number;
      const factor = notePath === path ? 1.95 : neighbors.has(notePath) ? 1.35 : path ? 0.72 : 1;
      sprite.userData.targetSize = size * factor * (0.84 + this.glow * 0.16);
      (sprite.material as THREE.SpriteMaterial).opacity = path
        ? notePath === path ? 1 : neighbors.has(notePath) ? 0.9 : 0.16
        : Math.min(1, 0.55 + this.glow * 0.14 + recency * 0.3);
    }
    this.rebuildHighlightedLinks();
  }

  focus(path: string): void {
    const sprite = this.noteSprites.get(path);
    if (!sprite) return;
    this.select(path);
    const position = new THREE.Vector3(0, BRANCH_HEIGHT, 0);
    this.controls.target.copy(position);
    this.camera.position.copy(position).add(new THREE.Vector3(0, 78, 118));
    this.camera.lookAt(position);
    this.controls.update();
  }

  reset(): void {
    this.trackedPath = null;
    this.select(null);
    this.controls.target.set(0, -8, 0);
    this.camera.position.set(0, this.defaultDistance * 0.62, this.defaultDistance * 0.8);
    this.camera.lookAt(0, -8, 0);
    this.controls.update();
  }

  wideView(): void {
    this.trackedPath = null;
    this.select(null);
    this.controls.target.set(0, 0, 0);
    this.camera.position.set(0, 300, 360);
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
    this.bloom.strength = 0.45 + this.glow * 0.5;
    if (this.highlightedLines) (this.highlightedLines.material as THREE.LineBasicMaterial).opacity = Math.min(1, 0.8 * this.glow);
    this.select(this.selectedPath);
  }

  setShowLinks(visible: boolean): void {
    this.showLinks = visible;
    if (this.highlightedLines) this.highlightedLines.visible = visible;
  }

  setShowConstellations(visible: boolean): void {
    this.showConstellations = visible;
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
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(width, height);
    // Point sizes are in world units; this converts them to pixels at the current zoom and resolution.
    const scale = height * this.renderer.getPixelRatio() / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
    for (const field of this.fields) field.material.uniforms.uScale.value = scale;
  }

  private animate = (): void => {
    this.frame = requestAnimationFrame(this.animate);
    const delta = Math.min(this.clock.getDelta(), 0.05);
    if (this.motion) this.time += delta;
    const ease = Math.min(1, delta * 4);
    this.dim += ((this.selectedPath ? 0.22 : 1) - this.dim) * ease;

    let moved = false;
    for (const [path, sprite] of this.noteSprites) {
      const target = this.targetPositions.get(path);
      if (!target || sprite.position.distanceToSquared(target) < 0.001) continue;
      sprite.position.lerp(target, Math.min(1, delta * 7.5));
      moved = true;
    }
    if (moved) {
      this.syncLines(this.highlightedLines, this.highlightedPairs);
      this.syncLines(this.constellationLines, this.constellationPairs);
    }

    // Stars breathe gently; recent ideas pulse brighter and send out a slow ring.
    for (const sprite of this.noteSprites.values()) {
      const { targetSize, recency, phase } = sprite.userData as { targetSize: number; recency: number; phase: number };
      const pulse = 1 + Math.sin(this.time * (1.1 + phase) + phase * TAU) * (0.04 + recency * 0.14);
      sprite.scale.setScalar(targetSize * pulse);
    }
    for (const { ring, star, recency, phase } of this.rings) {
      const progress = (this.time * 0.38 + phase) % 1;
      ring.position.copy(star.position);
      ring.scale.setScalar((star.userData.targetSize as number) * (0.9 + progress * 1.9));
      const visible = !this.selectedPath || star.userData.note.file.path === this.selectedPath;
      (ring.material as THREE.SpriteMaterial).opacity = visible ? recency * 0.55 * (1 - progress) * Math.min(1, progress * 6) : 0;
    }

    if (this.constellationLines) {
      const material = this.constellationLines.material as THREE.LineBasicMaterial;
      const target = this.showConstellations && !this.selectedPath ? Math.min(0.5, 0.2 * this.glow) : 0;
      material.opacity += (target - material.opacity) * ease;
      this.constellationLines.visible = material.opacity > 0.005;
    }
    for (const field of this.fields) {
      field.material.uniforms.uTime.value = this.time;
      field.material.uniforms.uOpacity.value = field.opacity * (field.dims ? this.dim : 1);
    }
    for (const glow of this.glows) (glow.sprite.material as THREE.SpriteMaterial).opacity = glow.opacity * this.dim;

    if (this.motion) {
      this.galaxy.rotation.y += delta * 0.035;
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
    this.composer.render(delta);
    // Few labels follow their stars every frame; the "all titles" mode refreshes less often to stay cheap.
    this.labelElapsed += delta;
    if (this.labelElapsed >= (this.labelMode === "all" && !this.selectedPath ? 0.12 : 0)) {
      this.labelElapsed = 0;
      this.updateLabels();
    }
  };

  private syncLines(lines: THREE.LineSegments | null, pairs: Array<[THREE.Sprite, THREE.Sprite]>): void {
    if (!lines) return;
    const positions = lines.geometry.getAttribute("position") as THREE.BufferAttribute;
    pairs.forEach(([a, b], index) => {
      positions.setXYZ(index * 2, a.position.x, a.position.y, a.position.z);
      positions.setXYZ(index * 2 + 1, b.position.x, b.position.y, b.position.z);
    });
    positions.needsUpdate = true;
  }

  private updateLabels(): void {
    if (!this.showLabels || !this.noteLabels.size) return;
    const width = this.domElement.clientWidth;
    const height = this.domElement.clientHeight;
    if (!width || !height) return;
    const placed: Array<{ x: number; y: number; width: number; height: number }> = [];
    const segments: Array<{ x1: number; y1: number; x2: number; y2: number; recent: boolean }> = [];
    const visible = new Set<string>();
    if (this.selectedPath) {
      visible.add(this.selectedPath);
      for (const link of this.links) {
        if (link.source === this.selectedPath) visible.add(link.target);
        if (link.target === this.selectedPath) visible.add(link.source);
      }
    } else if (this.labelMode === "featured") {
      // A few recent ideas, then the brightest hub of each constellation: enough to orient, never a crowd.
      const recent = this.notes.filter((note) => note.recency > 0).sort((a, b) => b.recency - a.recency);
      for (const note of recent.slice(0, 4)) visible.add(note.file.path);
      const connected = [...this.notes].filter((note) => note.degree > 0)
        .sort((a, b) => b.degree - a.degree || a.file.basename.localeCompare(b.file.basename));
      const leaders = new Map<string, NoteStar>();
      for (const note of connected) if (!leaders.has(note.group)) leaders.set(note.group, note);
      for (const note of leaders.values()) visible.add(note.file.path);
      for (const note of connected) {
        if (visible.size >= 9) break;
        visible.add(note.file.path);
      }
      if (!visible.size) for (const note of this.notes.slice(0, 8)) visible.add(note.file.path);
    }
    const ordered = [...this.notes].sort((a, b) =>
      Number(b.file.path === this.selectedPath) - Number(a.file.path === this.selectedPath)
      || b.recency - a.recency
      || b.degree - a.degree
    );
    for (const label of this.noteLabels.values()) label.style.display = "none";
    this.galaxy.updateMatrixWorld(true);
    const safeTop = Math.min(200, height * 0.26);
    const safeBottom = height - Math.min(96, height * 0.14);
    for (const note of ordered) {
      if ((this.selectedPath || this.labelMode === "featured") && !visible.has(note.file.path)) continue;
      const label = this.noteLabels.get(note.file.path);
      const sprite = this.noteSprites.get(note.file.path);
      if (!label || !sprite) continue;
      const point = new THREE.Vector3();
      sprite.getWorldPosition(point);
      point.project(this.camera);
      if (point.z <= -1 || point.z >= 1) continue;
      const x = (point.x * 0.5 + 0.5) * width;
      const y = (-point.y * 0.5 + 0.5) * height;
      const selected = note.file.path === this.selectedPath;
      const name = note.file.basename;
      const labelWidth = Math.min(180, selected ? 16 + name.length * 7.6 : 14 + name.length * 6 + (note.recency > 0 ? 10 : 0));
      const labelHeight = selected ? 24 : 16;
      const side = labelWidth / 2 + 14;
      // Atlas-style placement: beside the star first, then above or below, always tied back by a leader line.
      const candidates: Array<[number, number]> = [
        [side, -12], [-side, -12], [side, 12], [-side, 12],
        [0, -24], [0, 24], [side + 6, -32], [-side - 6, -32],
        [0, -46], [0, 46], [side + 10, 36], [-side - 10, 36]
      ];
      let bestX = x;
      let bestY = y;
      let bestScore = Infinity;
      for (const [dx, dy] of candidates) {
        const cx = Math.max(labelWidth / 2 + 10, Math.min(width - labelWidth / 2 - 10, x + dx));
        const cy = Math.max(safeTop + labelHeight / 2, Math.min(safeBottom - labelHeight / 2, y + dy));
        let score = Math.hypot(cx - x, cy - y) * 0.05;
        for (const other of placed) {
          const overlapX = Math.max(0, (labelWidth + other.width) / 2 + 6 - Math.abs(cx - other.x));
          const overlapY = Math.max(0, (labelHeight + other.height) / 2 + 4 - Math.abs(cy - other.y));
          score += overlapX * overlapY;
        }
        if (score < bestScore) { bestScore = score; bestX = cx; bestY = cy; }
        if (score < 1.5) break;
      }
      label.style.display = "block";
      label.style.left = `${bestX}px`;
      label.style.top = `${bestY}px`;
      label.classList.toggle("is-selected", selected);
      placed.push({ x: bestX, y: bestY, width: labelWidth, height: labelHeight });
      // Leader from just outside the star to the nearest edge of the label.
      const edgeX = Math.max(bestX - labelWidth / 2, Math.min(bestX + labelWidth / 2, x));
      const edgeY = Math.max(bestY - labelHeight / 2, Math.min(bestY + labelHeight / 2, y));
      const length = Math.hypot(edgeX - x, edgeY - y);
      if (length > 9) {
        const gap = 5 / length;
        segments.push({ x1: x + (edgeX - x) * gap, y1: y + (edgeY - y) * gap, x2: edgeX, y2: edgeY, recent: note.recency > 0 });
      }
    }
    this.drawLeaders(segments);
  }

  private drawLeaders(segments: Array<{ x1: number; y1: number; x2: number; y2: number; recent: boolean }>): void {
    while (this.leaders.length < segments.length) {
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      this.leaderLayer.appendChild(line);
      this.leaders.push(line);
    }
    this.leaders.forEach((line, index) => {
      const segment = segments[index];
      line.style.display = segment ? "" : "none";
      if (!segment) return;
      line.setAttribute("x1", segment.x1.toFixed(1));
      line.setAttribute("y1", segment.y1.toFixed(1));
      line.setAttribute("x2", segment.x2.toFixed(1));
      line.setAttribute("y2", segment.y2.toFixed(1));
      line.classList.toggle("is-recent", segment.recent);
    });
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.controls.dispose();
    this.disposeLines(this.highlightedLines);
    this.disposeLines(this.constellationLines);
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    for (const material of this.noteMaterials) material.dispose();
    this.glowMap.dispose();
    this.sparkleMap.dispose();
    this.ringMap.dispose();
    this.bloom.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.labelLayer.remove();
    this.domElement.remove();
  }
}
