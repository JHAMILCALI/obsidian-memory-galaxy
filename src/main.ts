import { ItemView, Plugin, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import { GalaxyScene, type NoteConnection, type NoteStar, type StarHit } from "./galaxy-scene";
import { registerFonts } from "./fonts";
import { recencyByPath } from "./recency";

const VIEW_TYPE = "astra-galaxy-view";

interface GalaxySettings {
  spacing: number;
  glow: number;
  motion: boolean;
  showLinks: boolean;
  showConstellations: boolean;
  showLabels: boolean;
  labelMode: "featured" | "all";
}

const DEFAULT_SETTINGS: GalaxySettings = {
  spacing: 15,
  glow: 0.9,
  motion: true,
  showLinks: true,
  showConstellations: true,
  showLabels: true,
  labelMode: "featured"
};

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  parent: HTMLElement,
  text?: string
): HTMLElementTagNameMap[K] {
  const created = document.createElement(tag);
  created.className = className;
  if (text !== undefined) created.textContent = text;
  parent.appendChild(created);
  return created;
}

class AstraGalaxyView extends ItemView {
  private plugin: AstraGalaxyPlugin;
  private stage!: HTMLElement;
  private scene: GalaxyScene | null = null;
  private search!: HTMLInputElement;
  private results!: HTMLElement;
  private details!: HTMLElement;
  private noteCount!: HTMLElement;
  private linkCount!: HTMLElement;
  private recentCount!: HTMLElement;
  private notes: NoteStar[] = [];
  private links: NoteConnection[] = [];
  private selected: StarHit | null = null;
  private motionEnabled = true;
  private events: AbortController | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private pointerStart: { x: number; y: number } | null = null;
  private unregisterFonts: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: AstraGalaxyPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return "Galaxia 3D"; }
  getIcon(): string { return "orbit"; }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("astra-view");
    this.unregisterFonts = registerFonts(this.contentEl.ownerDocument);
    this.events = new AbortController();
    const signal = this.events.signal;
    this.stage = element("div", "astra-stage", this.contentEl);

    try {
      this.scene = new GalaxyScene(this.stage);
      this.scene.setSpacing(this.plugin.settings.spacing);
      this.scene.setGlow(this.plugin.settings.glow);
      this.scene.setMotion(this.plugin.settings.motion);
      this.scene.setShowLinks(this.plugin.settings.showLinks);
      this.scene.setShowConstellations(this.plugin.settings.showConstellations);
      this.scene.setShowLabels(this.plugin.settings.showLabels);
      this.scene.setLabelMode(this.plugin.settings.labelMode);
      this.motionEnabled = this.plugin.settings.motion;
    } catch (error) {
      console.error("Astra Galaxy: no se pudo iniciar la escena 3D", error);
      element("div", "astra-webgl-error", this.stage, "No se pudo iniciar la galaxia 3D. Comprueba que la aceleración gráfica de Obsidian esté disponible.");
    }

    const top = element("header", "astra-top", this.stage);
    const brand = element("div", "astra-brand", top);
    element("div", "astra-eyebrow", brand, "Astra · Atlas de memoria");
    const title = element("h1", "astra-title", brand, "Memory ");
    element("em", "", title, "Galaxy");
    element("p", "astra-subtitle", brand, "Elige una estrella para explorar sus ideas.");

    const stats = element("div", "astra-stats", top);
    const noteStat = element("div", "astra-stat", stats);
    this.noteCount = element("strong", "astra-stat-value", noteStat, "0");
    element("span", "astra-stat-label", noteStat, "notas");
    const linkStat = element("div", "astra-stat", stats);
    this.linkCount = element("strong", "astra-stat-value", linkStat, "0");
    element("span", "astra-stat-label", linkStat, "enlaces");
    const recentStat = element("div", "astra-stat astra-stat-recent", stats);
    this.recentCount = element("strong", "astra-stat-value", recentStat, "0");
    element("span", "astra-stat-label", recentStat, "recientes");

    const tools = element("div", "astra-tools", this.stage);
    const explore = this.textButton(tools, "orbit", "Galaxia completa", "astra-button astra-button-primary");
    explore.addEventListener("click", () => { this.select(null); this.scene?.wideView(); }, { signal });
    const center = this.textButton(tools, "locate-fixed", "Recentrar");
    center.addEventListener("click", () => this.select(null), { signal });
    const searchWrap = element("div", "astra-search-wrap", tools);
    const searchIcon = element("span", "astra-search-icon", searchWrap);
    setIcon(searchIcon, "search");
    this.search = element("input", "astra-search", searchWrap);
    this.search.type = "search";
    this.search.placeholder = "Buscar una nota…";
    this.search.setAttribute("aria-label", "Buscar notas en la galaxia");
    this.search.autocomplete = "off";
    this.results = element("div", "astra-results", searchWrap);
    this.results.hidden = true;
    this.search.addEventListener("input", () => this.renderSearchResults(), { signal });
    this.search.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        this.search.value = "";
        this.results.hidden = true;
        this.search.blur();
      } else if (event.key === "Enter") {
        const first = this.findMatchingNotes()[0];
        if (first) this.focusNote(first);
      }
    }, { signal });

    const adjust = this.textButton(tools, "sliders-horizontal", "Ajustes", "astra-button astra-button-settings");
    adjust.setAttribute("aria-expanded", "false");
    const settingsPanel = element("section", "astra-settings", this.stage);
    settingsPanel.hidden = true;
    element("h2", "astra-settings-title", settingsPanel, "Ajustar galaxia");
    this.addRange(settingsPanel, "Separación de ideas", 8, 20, 1, this.plugin.settings.spacing, (value) => {
      this.scene?.setSpacing(value);
      void this.plugin.updateSettings({ spacing: value });
    });
    this.addRange(settingsPanel, "Brillo", 0.5, 2, 0.05, this.plugin.settings.glow, (value) => {
      this.scene?.setGlow(value);
      void this.plugin.updateSettings({ glow: value });
    });
    this.addToggle(settingsPanel, "Constelaciones en el mapa", this.plugin.settings.showConstellations, (value) => {
      this.scene?.setShowConstellations(value);
      void this.plugin.updateSettings({ showConstellations: value });
    });
    this.addToggle(settingsPanel, "Mostrar ramas al elegir idea", this.plugin.settings.showLinks, (value) => {
      this.scene?.setShowLinks(value);
      void this.plugin.updateSettings({ showLinks: value });
    });
    this.addToggle(settingsPanel, "Mostrar nombres", this.plugin.settings.showLabels, (value) => {
      this.scene?.setShowLabels(value);
      void this.plugin.updateSettings({ showLabels: value });
    });
    this.addToggle(settingsPanel, "Mostrar todos los títulos", this.plugin.settings.labelMode === "all", (value) => {
      const labelMode = value ? "all" : "featured";
      this.scene?.setLabelMode(labelMode);
      void this.plugin.updateSettings({ labelMode });
    });
    adjust.addEventListener("click", () => {
      settingsPanel.hidden = !settingsPanel.hidden;
      adjust.setAttribute("aria-expanded", String(!settingsPanel.hidden));
    }, { signal });

    const legend = element("div", "astra-legend", this.stage);
    element("div", "astra-legend-title", legend, "Leyenda");
    this.legendItem(legend, "dot", "Nota, en el color de su carpeta");
    this.legendItem(legend, "diamond", "Editada hace poco");
    this.legendItem(legend, "line", "Notas enlazadas");
    this.details = element("aside", "astra-details", this.stage);
    this.details.hidden = true;

    const controls = element("div", "astra-controls", this.stage);
    this.iconButton(controls, "plus", "Acercar", () => this.scene?.zoom(1.3));
    this.iconButton(controls, "minus", "Alejar", () => this.scene?.zoom(1 / 1.3));
    this.iconButton(controls, "locate-fixed", "Recentrar", () => this.select(null));
    const motion = this.iconButton(controls, this.motionEnabled ? "pause" : "play", this.motionEnabled ? "Pausar movimiento" : "Reanudar movimiento", () => {
      this.motionEnabled = !this.motionEnabled;
      this.scene?.setMotion(this.motionEnabled);
      void this.plugin.updateSettings({ motion: this.motionEnabled });
      setIcon(motion, this.motionEnabled ? "pause" : "play");
      motion.setAttribute("aria-label", this.motionEnabled ? "Pausar movimiento" : "Reanudar movimiento");
      motion.title = this.motionEnabled ? "Pausar movimiento" : "Reanudar movimiento";
    });

    element("div", "astra-hint", this.stage, "Clic en una estrella para ver su rama, doble clic para abrir la nota");

    this.stage.addEventListener("click", (event) => {
      const label = (event.target as HTMLElement).closest<HTMLElement>(".astra-node-label");
      const note = this.notes.find((item) => item.file.path === label?.dataset.path);
      if (note) this.select({ kind: "note", note });
    }, { signal });
    this.stage.addEventListener("dblclick", (event) => {
      const label = (event.target as HTMLElement).closest<HTMLElement>(".astra-node-label");
      const note = this.notes.find((item) => item.file.path === label?.dataset.path);
      if (note) void this.openNote(note.file);
    }, { signal });

    if (this.scene) {
      const canvas = this.scene.domElement;
      canvas.addEventListener("pointerdown", (event) => {
        this.pointerStart = { x: event.clientX, y: event.clientY };
      }, { signal });
      canvas.addEventListener("pointermove", (event) => {
        if (this.pointerStart) return;
        canvas.style.cursor = this.scene?.pick(event.clientX, event.clientY) ? "pointer" : "grab";
      }, { signal });
      canvas.addEventListener("pointerup", (event) => {
        const start = this.pointerStart;
        this.pointerStart = null;
        if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) return;
        this.select(this.scene?.pick(event.clientX, event.clientY) ?? null);
      }, { signal });
      canvas.addEventListener("pointercancel", () => { this.pointerStart = null; }, { signal });
      canvas.addEventListener("dblclick", (event) => {
        const hit = this.scene?.pick(event.clientX, event.clientY);
        if (hit?.kind === "note") void this.openNote(hit.note.file);
      }, { signal });
    }

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.stage);
    this.reloadNotes();
    this.resize();
  }

  async onClose(): Promise<void> {
    this.events?.abort();
    this.events = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.scene?.dispose();
    this.scene = null;
    this.contentEl.removeClass("astra-view");
    this.unregisterFonts?.();
    this.unregisterFonts = null;
  }

  reloadNotes(): void {
    if (!this.stage) return;
    const selectedPath = this.selected?.kind === "note" ? this.selected.note.file.path : null;
    this.notes = this.app.vault.getMarkdownFiles().map((file) => {
      const group = file.path.includes("/") ? file.path.split("/")[0] : "Sin carpeta";
      return { file, group, color: GalaxyScene.colorForGroup(group), incoming: 0, outgoing: 0, degree: 0, recency: 0 };
    });
    const recency = recencyByPath(this.notes.map((note) => note.file));
    for (const note of this.notes) note.recency = recency.get(note.file.path) ?? 0;
    const byPath = new Map(this.notes.map((note) => [note.file.path, note]));
    const neighbors = new Map(this.notes.map((note) => [note.file.path, new Set<string>()]));
    const connections = new Map<string, NoteConnection>();
    for (const [sourcePath, targets] of Object.entries(this.app.metadataCache.resolvedLinks)) {
      const source = byPath.get(sourcePath);
      if (!source) continue;
      for (const [targetPath, count] of Object.entries(targets)) {
        const target = byPath.get(targetPath);
        if (!target || target === source) continue;
        source.outgoing += count;
        target.incoming += count;
        neighbors.get(sourcePath)!.add(targetPath);
        neighbors.get(targetPath)!.add(sourcePath);
        const [a, b] = sourcePath < targetPath ? [sourcePath, targetPath] : [targetPath, sourcePath];
        const key = JSON.stringify([a, b]);
        const connection = connections.get(key) ?? { source: a, target: b, weight: 0 };
        connection.weight += count;
        connections.set(key, connection);
      }
    }
    for (const note of this.notes) note.degree = neighbors.get(note.file.path)!.size;
    this.links = [...connections.values()];
    this.scene?.setNotes(this.notes, this.links);
    this.scene?.setGlow(this.plugin.settings.glow);
    this.noteCount.textContent = this.notes.length.toLocaleString("es");
    this.linkCount.textContent = this.links.length.toLocaleString("es");
    this.recentCount.textContent = String(recency.size);
    if (selectedPath) {
      const note = this.notes.find((item) => item.file.path === selectedPath);
      this.selected = note ? { kind: "note", note } : null;
      this.scene?.select(note?.file.path ?? null);
    }
    this.renderDetails();
    this.renderSearchResults();
  }

  private resize(): void {
    if (!this.scene) return;
    const rect = this.stage.getBoundingClientRect();
    this.scene.resize(rect.width, rect.height);
  }

  private addRange(
    parent: HTMLElement, label: string, min: number, max: number, step: number, current: number,
    onChange: (value: number) => void
  ): void {
    const row = element("label", "astra-setting-range", parent);
    const caption = element("span", "astra-setting-caption", row);
    element("span", "", caption, label);
    const value = element("strong", "", caption, String(current));
    const input = element("input", "", row);
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(current);
    input.addEventListener("input", () => {
      const parsed = Number(input.value);
      value.textContent = parsed.toFixed(step < 1 ? 2 : 0).replace(/\.00$/, "");
      onChange(parsed);
    }, { signal: this.events!.signal });
  }

  private addToggle(parent: HTMLElement, label: string, current: boolean, onChange: (value: boolean) => void): void {
    const row = element("label", "astra-setting-toggle", parent);
    element("span", "", row, label);
    const input = element("input", "", row);
    input.type = "checkbox";
    input.checked = current;
    input.addEventListener("change", () => onChange(input.checked), { signal: this.events!.signal });
  }

  private legendItem(parent: HTMLElement, shape: "dot" | "diamond" | "line", label: string): void {
    const chip = element("div", "astra-legend-chip", parent);
    element("span", `astra-legend-mark is-${shape}`, chip);
    element("span", "", chip, label);
  }

  private textButton(parent: HTMLElement, icon: string, label: string, className = "astra-button"): HTMLButtonElement {
    const button = element("button", className, parent);
    button.type = "button";
    setIcon(element("span", "astra-button-icon", button), icon);
    element("span", "", button, label);
    return button;
  }

  private iconButton(parent: HTMLElement, icon: string, label: string, action: () => void): HTMLButtonElement {
    const button = element("button", "astra-icon-button", parent);
    button.type = "button";
    button.setAttribute("aria-label", label);
    button.title = label;
    setIcon(button, icon);
    button.addEventListener("click", action);
    return button;
  }

  private select(hit: StarHit | null): void {
    this.selected = hit;
    if (hit?.kind === "note") this.scene?.focus(hit.note.file.path);
    else this.scene?.reset();
    this.renderDetails();
  }

  private renderDetails(): void {
    this.details.empty();
    const hit = this.selected;
    this.details.hidden = !hit;
    if (!hit) return;
    const top = element("div", "astra-detail-top", this.details);
    const kicker = element("span", "astra-detail-kicker", top, hit.note.recency > 0 ? "Idea reciente" : hit.note.group);
    kicker.style.setProperty("--astra-node-color", hit.note.color);
    kicker.classList.toggle("is-recent", hit.note.recency > 0);
    this.iconButton(top, "x", "Cerrar detalle", () => this.select(null));
    element("h2", "astra-detail-title", this.details, hit.note.file.basename);
    element("p", "astra-detail-path", this.details, hit.note.file.path);
    const edited = hit.note.file.stat?.mtime;
    if (edited) element("p", "astra-detail-path astra-detail-edited", this.details, `Editada el ${new Date(edited).toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" })}`);
    const metrics = element("div", "astra-detail-metrics", this.details);
    const incoming = element("div", "", metrics);
    element("strong", "", incoming, String(hit.note.incoming));
    element("span", "", incoming, "entrantes");
    const outgoing = element("div", "", metrics);
    element("strong", "", outgoing, String(hit.note.outgoing));
    element("span", "", outgoing, "salientes");
    const related = this.links
      .filter((link) => link.source === hit.note.file.path || link.target === hit.note.file.path)
      .map((link) => this.notes.find((note) => note.file.path === (link.source === hit.note.file.path ? link.target : link.source)))
      .filter((note): note is NoteStar => Boolean(note))
      .sort((a, b) => b.degree - a.degree)
      .slice(0, 8);
    if (related.length) {
      element("div", "astra-related-title", this.details, "Ideas relacionadas");
      const list = element("div", "astra-related-list", this.details);
      for (const note of related) {
        const button = element("button", "astra-related-item", list, note.file.basename);
        button.type = "button";
        button.addEventListener("click", () => this.focusNote(note));
      }
    } else {
      element("p", "astra-detail-path astra-no-links", this.details, "Esta nota aún no tiene enlaces con otras notas.");
    }
    const open = this.textButton(this.details, "arrow-up-right", "Abrir nota", "astra-button astra-open-note");
    open.addEventListener("click", () => void this.openNote(hit.note.file));
  }

  private findMatchingNotes(): NoteStar[] {
    const query = this.search.value.trim().toLocaleLowerCase();
    if (!query) return [];
    return this.notes
      .filter((note) => note.file.basename.toLocaleLowerCase().includes(query) || note.file.path.toLocaleLowerCase().includes(query))
      .sort((a, b) => b.degree - a.degree || a.file.basename.localeCompare(b.file.basename))
      .slice(0, 8);
  }

  private renderSearchResults(): void {
    if (!this.results || !this.search) return;
    this.results.empty();
    const query = this.search.value.trim();
    this.results.hidden = !query;
    if (!query) return;
    const matches = this.findMatchingNotes();
    if (!matches.length) {
      element("div", "astra-result-empty", this.results, "No se encontraron notas.");
      return;
    }
    for (const note of matches) {
      const result = element("button", "astra-result", this.results);
      result.type = "button";
      const dot = element("span", "astra-result-dot", result);
      dot.style.backgroundColor = note.color;
      const body = element("span", "astra-result-body", result);
      element("strong", "", body, note.file.basename);
      element("small", "", body, note.group);
      result.addEventListener("click", () => this.focusNote(note));
    }
  }

  private focusNote(note: NoteStar): void {
    this.selected = { kind: "note", note };
    this.scene?.focus(note.file.path);
    this.renderDetails();
    this.results.hidden = true;
    this.search.blur();
  }

  private async openNote(file: TFile): Promise<void> {
    const leaf = this.app.workspace.getLeaf(true);
    await leaf.openFile(file);
    await this.app.workspace.revealLeaf(leaf);
  }
}

export default class AstraGalaxyPlugin extends Plugin {
  settings: GalaxySettings = { ...DEFAULT_SETTINGS };
  private refreshTimer: number | null = null;
  private saveTimer: number | null = null;

  async onload(): Promise<void> {
    const stored = await this.loadData() as Partial<GalaxySettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...stored };
    this.registerView(VIEW_TYPE, (leaf: WorkspaceLeaf) => new AstraGalaxyView(leaf, this));
    this.addRibbonIcon("orbit", "Abrir galaxia 3D", () => void this.activateView());
    this.addCommand({
      id: "open-astra-galaxy",
      name: "Abrir galaxia 3D",
      callback: () => void this.activateView()
    });
    const refresh = () => this.scheduleRefresh();
    this.registerEvent(this.app.vault.on("create", refresh));
    this.registerEvent(this.app.vault.on("delete", refresh));
    this.registerEvent(this.app.vault.on("rename", refresh));
    this.registerEvent(this.app.metadataCache.on("changed", refresh));
    this.registerEvent(this.app.metadataCache.on("resolved", refresh));
  }

  updateSettings(change: Partial<GalaxySettings>): void {
    this.settings = { ...this.settings, ...change };
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.saveData(this.settings);
    }, 250);
  }

  onunload(): void {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      void this.saveData(this.settings);
    }
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
        if (leaf.view instanceof AstraGalaxyView) leaf.view.reloadNotes();
      }
    }, 300);
  }

  private async activateView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    const leaf = existing ?? this.app.workspace.getLeaf(true);
    if (!existing) await leaf.setViewState({ type: VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }
}
