import { GalaxyScene, type NoteConnection, type NoteStar } from "../src/galaxy-scene";
import { registerFonts } from "../src/fonts";
import { recencyByPath } from "../src/recency";
import type { TFile } from "obsidian";

registerFonts();
const host = document.getElementById("galaxy")!;
const scene = new GalaxyScene(host);
const names = [
  "Ideas", "Proyectos", "Diseño", "Música", "Viajes", "Lecturas", "Conceptos", "Diario",
  "Fotografía", "Aprendizaje", "Investigación", "Arquitectura", "Cine", "Historias", "Estudio",
  "Creatividad", "Mapas", "Objetivos", "Recuerdos", "Inspiración", "Planetas", "Arte", "Futuro", "Universo"
];
const groups = ["Proyecto Astra", "Diseño visual", "Investigación"];
const day = 86_400_000;
const now = Date.now();
// Sample edit times: a handful of notes touched in the last days, the rest weeks or months ago.
const mtime = (index: number) => now - (index % 9 === 0 ? (index % 5) * 0.4 * day : (12 + (index * 7) % 160) * day);
const fileFor = (path: string, basename: string, index: number) => ({ path, basename, stat: { mtime: mtime(index) } } as TFile);
const notes: NoteStar[] = groups.flatMap((group, groupIndex) => names.map((name, index) => ({
  file: fileFor(`${group}/${String(index).padStart(2, "0")} - ${name}.md`, `${String(index).padStart(2, "0")} - ${name}`, groupIndex * 31 + index),
  group,
  color: GalaxyScene.colorForGroup(group),
  incoming: 0,
  outgoing: 0,
  degree: 0,
  recency: 0
})));
for (const [index, name] of ["Idea sin enlace", "Borrador", "Nota libre"].entries()) {
  notes.push({ file: fileFor(`Sueltas/${name}.md`, name, 200 + index * 9), group: "Sueltas", color: GalaxyScene.colorForGroup("Sueltas"), incoming: 0, outgoing: 0, degree: 0, recency: 0 });
}
const recency = recencyByPath(notes.map((note) => note.file), now);
for (const note of notes) note.recency = recency.get(note.file.path) ?? 0;
const links: NoteConnection[] = [];
for (let group = 0; group < groups.length; group++) {
  const start = group * names.length;
  for (let i = 1; i < names.length; i++) {
    const parent = start + Math.floor((i - 1) / 2);
    const child = start + i;
    links.push({ source: notes[parent].file.path, target: notes[child].file.path, weight: 1 });
    notes[parent].outgoing++;
    notes[child].incoming++;
    notes[parent].degree++;
    notes[child].degree++;
  }
}
scene.setNotes(notes, links);
scene.setGlow(0.9);
document.getElementById("stat-notes")!.textContent = String(notes.length);
document.getElementById("stat-links")!.textContent = String(links.length);
document.getElementById("stat-recent")!.textContent = String(recency.size);
const details = document.getElementById("details")!;
const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent: HTMLElement, text?: string) => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  parent.appendChild(node);
  return node;
};

// Mirrors AstraGalaxyView.renderDetails so the preview shows the same sheet as Obsidian.
function show(note: NoteStar | null): void {
  details.replaceChildren();
  details.hidden = !note;
  if (!note) { scene.reset(); return; }
  scene.focus(note.file.path);
  const top = make("div", "astra-detail-top", details);
  const kicker = make("span", "astra-detail-kicker", top, note.recency > 0 ? "Idea reciente" : note.group);
  kicker.style.setProperty("--astra-node-color", note.color);
  kicker.classList.toggle("is-recent", note.recency > 0);
  make("h2", "astra-detail-title", details, note.file.basename);
  make("p", "astra-detail-path", details, note.file.path);
  make("p", "astra-detail-path astra-detail-edited", details, `Editada el ${new Date(note.file.stat.mtime).toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" })}`);
  const metrics = make("div", "astra-detail-metrics", details);
  for (const [value, label] of [[note.incoming, "entrantes"], [note.outgoing, "salientes"]] as const) {
    const cell = make("div", "", metrics);
    make("strong", "", cell, String(value));
    make("span", "", cell, label);
  }
  const related = links
    .filter((link) => link.source === note.file.path || link.target === note.file.path)
    .map((link) => notes.find((item) => item.file.path === (link.source === note.file.path ? link.target : link.source))!)
    .slice(0, 8);
  make("div", "astra-related-title", details, "Ideas relacionadas");
  const list = make("div", "astra-related-list", details);
  for (const item of related) make("button", "astra-related-item", list, item.file.basename).addEventListener("click", () => show(item));
  make("button", "astra-button astra-open-note", details, "Abrir nota");
}

const params = new URLSearchParams(location.search);
if (params.has("focus")) show(notes.find((note) => note.recency > 0 && note.degree > 1) ?? notes[0]);
if (params.has("still")) scene.setMotion(false);

new ResizeObserver(() => scene.resize(host.clientWidth, host.clientHeight)).observe(host);
scene.resize(host.clientWidth, host.clientHeight);
scene.domElement.addEventListener("click", (event) => show(scene.pick(event.clientX, event.clientY)?.note ?? null));
host.addEventListener("click", (event) => {
  const label = (event.target as HTMLElement).closest<HTMLElement>(".astra-node-label");
  const note = notes.find((item) => item.file.path === label?.dataset.path);
  if (note) show(note);
});
document.getElementById("wide")!.addEventListener("click", () => { show(null); scene.wideView(); });
for (const id of ["recenter", "recenter-icon"]) document.getElementById(id)!.addEventListener("click", () => show(null));
document.getElementById("zoom-in")!.addEventListener("click", () => scene.zoom(1.3));
document.getElementById("zoom-out")!.addEventListener("click", () => scene.zoom(1 / 1.3));
