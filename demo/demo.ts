import { GalaxyScene, type NoteConnection, type NoteStar } from "../src/galaxy-scene";
import type { TFile } from "obsidian";

const host = document.getElementById("galaxy")!;
const status = document.getElementById("status")!;
const scene = new GalaxyScene(host);
const names = [
  "Ideas", "Proyectos", "Diseño", "Música", "Viajes", "Lecturas", "Conceptos", "Diario",
  "Fotografía", "Aprendizaje", "Investigación", "Arquitectura", "Cine", "Historias", "Estudio",
  "Creatividad", "Mapas", "Objetivos", "Recuerdos", "Inspiración", "Planetas", "Arte", "Futuro", "Universo"
];
const groups = ["Proyecto Astra", "Diseño visual", "Investigación"];
const notes: NoteStar[] = groups.flatMap((group, groupIndex) => names.map((name, index) => ({
  file: { path: `${group}/${String(index).padStart(2, "0")} - ${name}.md`, basename: `${String(index).padStart(2, "0")} - ${name}` } as TFile,
  group,
  color: ["#e1b7ff", "#a7d8ff", "#ffd4a7"][groupIndex],
  incoming: 0,
  outgoing: 0,
  degree: 0
})));
for (const name of ["Idea sin enlace", "Borrador", "Nota libre"]) {
  notes.push({ file: { path: `Sueltas/${name}.md`, basename: name } as TFile, group: "Sueltas", color: "#a9f3e1", incoming: 0, outgoing: 0, degree: 0 });
}
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
document.getElementById("count")!.textContent = `${notes.length} notas · ${links.length} enlaces · 240 estrellas vacías`;
if (new URLSearchParams(location.search).has("focus")) scene.focus(notes[0].file.path);

new ResizeObserver(() => scene.resize(host.clientWidth, host.clientHeight)).observe(host);
scene.resize(host.clientWidth, host.clientHeight);
scene.domElement.addEventListener("click", (event) => {
  const hit = scene.pick(event.clientX, event.clientY);
  if (hit?.kind === "note") scene.focus(hit.note.file.path);
  else scene.reset();
  status.textContent = hit?.kind === "note" ? `Nota: ${hit.note.file.basename}` : hit?.kind === "empty" ? `Nodo vacío ${hit.index}` : "Selecciona una estrella";
});
host.addEventListener("click", (event) => {
  const label = (event.target as HTMLElement).closest<HTMLElement>(".astra-node-label");
  const note = notes.find((item) => item.file.path === label?.dataset.path);
  if (note) {
    scene.focus(note.file.path);
    status.textContent = `Nota: ${note.file.basename}`;
  }
});
