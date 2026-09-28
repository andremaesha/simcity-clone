import { Matrix4 } from 'three';
import { AUTOSAVE_INTERVAL_MS, MAP_SIZE, SAVE_KEY } from './config';
import { CameraController } from './engine/cameraController';
import { ChunkManager } from './engine/chunkManager';
import { Overlay } from './engine/overlay';
import { pickTile } from './engine/picker';
import { Renderer } from './engine/renderer';
import { generateTerrain } from './sim/mapgen';
import { randomSeed } from './sim/rng';
import { CameraState, SaveData, deserialize, serialize } from './sim/save';
import { Simulation } from './sim/simulation';
import { planTool } from './sim/tools';
import { Tool } from './sim/types';
import { World } from './sim/world';
import { formatMoney } from './ui/dom';
import { TileInfo, describeTile } from './ui/inspector';
import { TOOL_DEFS, Ui } from './ui/ui';

interface TileRef {
  x: number;
  z: number;
}

/** Grid lines are shown automatically for build tools, but only when zoomed in enough to be useful. */
const AUTO_GRID_MAX_DISTANCE = 80;
/** Frames are only rendered when something changed; this is the safety-net interval otherwise (s). */
const IDLE_RENDER_INTERVAL = 1;

/** Wires simulation, rendering, input and UI together and runs the frame loop. */
export class Game {
  private sim: Simulation;
  private readonly renderer: Renderer;
  private readonly camera: CameraController;
  private readonly chunks: ChunkManager;
  private readonly overlay: Overlay;
  private readonly ui: Ui;

  private tool: Tool = Tool.Inspect;
  private gridOn = false;
  private resumeSpeed = 1;
  private dragStart: TileRef | null = null;
  private hover: TileRef | null = null;
  private pointer = { x: 0, y: 0, over: false };
  private inspected: TileRef | null = null;
  private lastInfo = '';
  private lastTime = performance.now();
  private uiTimer = 0;
  private infoTimer = 0;
  private minimapTimer = 0;

  private needsRender = true;
  private renderedLastFrame = false;
  private sinceRender = 0;
  private readonly lastCameraMatrix = new Matrix4();
  private readonly perf = { visible: false, frames: 0, renders: 0, since: 0 };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    uiRoot: HTMLElement,
  ) {
    this.renderer = new Renderer(canvas);
    const saved = this.readSave();
    this.sim = saved?.sim ?? createCity('New City', randomSeed());
    this.camera = new CameraController(this.renderer.camera, canvas, MAP_SIZE);
    if (saved?.camera) this.camera.setState(saved.camera);

    this.chunks = new ChunkManager(this.renderer.scene, this.sim.world, this.renderer.cityMaterial);
    this.chunks.flush();
    this.renderer.buildMapBase(this.sim.world);
    this.overlay = new Overlay(this.renderer.scene, MAP_SIZE);

    this.ui = new Ui(
      uiRoot,
      {
        onTool: (t) => this.setTool(t),
        onSpeed: (s) => this.setSpeed(s),
        onSave: () => this.save(false),
        onLoad: () => void this.loadFromStorage(),
        onNewCity: (name) => this.switchCity(createCity(name, randomSeed())),
        onToggleGrid: () => this.toggleGrid(),
        onRename: (name) => (this.sim.cityName = name),
        onMinimapPick: (x, z) => this.camera.lookAt(x, z),
        onCloseInfo: () => this.inspect(null),
      },
      MAP_SIZE,
    );

    this.bindSimulation();
    this.bindInput();
    this.setTool(Tool.Inspect);
    window.addEventListener('resize', () => {
      this.renderer.resize();
      this.needsRender = true;
    });
    window.setInterval(() => this.save(true), AUTOSAVE_INTERVAL_MS);

    if (saved) {
      this.ui.toast(`Welcome back to ${this.sim.cityName}!`);
    } else {
      this.ui.openHelp();
    }
  }

  start(): void {
    requestAnimationFrame(this.frame);
  }

  // ---------------------------------------------------------------------------------------------
  // Frame loop

  private frame = (now: number): void => {
    const frameMs = now - this.lastTime;
    const dt = Math.min(0.1, frameMs / 1000);
    this.lastTime = now;

    if (!this.ui.modalOpen) this.sim.update(dt);
    if (this.chunks.update(this.camera.target.x, this.camera.target.z) > 0) {
      this.renderer.requestShadowUpdate();
      this.needsRender = true;
    }
    this.camera.update(dt);
    this.renderer.updateView(this.camera.target, this.camera.distance);
    if (!this.lastCameraMatrix.equals(this.renderer.camera.matrixWorld)) {
      this.lastCameraMatrix.copy(this.renderer.camera.matrixWorld);
      this.needsRender = true;
    }

    // Re-pick every frame, not only on mouse moves: zooming or keyboard panning slides the map under a still cursor.
    this.refreshHover();
    this.overlay.gridVisible =
      this.gridOn || (this.tool !== Tool.Inspect && this.camera.distance < AUTO_GRID_MAX_DISTANCE);
    if (this.overlay.update(dt)) this.needsRender = true;

    this.uiTimer += dt;
    if (this.uiTimer >= 0.1) {
      this.uiTimer = 0;
      this.ui.update(this.sim);
      // The world keeps changing under an active drag (buildings grow), so keep its preview fresh.
      if (this.dragStart) this.updatePreview();
    }
    this.infoTimer += dt;
    if (this.infoTimer >= 0.5) {
      this.infoTimer = 0;
      this.refreshInfo();
    }
    this.minimapTimer += dt;
    if (this.minimapTimer >= 0.25) {
      this.minimapTimer = 0;
      this.ui.minimap.draw(this.sim.world, this.viewFootprint());
    }

    this.sinceRender += dt;
    if (this.needsRender || this.sinceRender >= IDLE_RENDER_INTERVAL) {
      this.renderer.render();
      if (this.renderedLastFrame) this.renderer.recordFrame(frameMs);
      this.renderedLastFrame = true;
      this.needsRender = false;
      this.sinceRender = 0;
      this.perf.renders++;
    } else {
      this.renderedLastFrame = false;
    }
    this.updatePerf(now);
    requestAnimationFrame(this.frame);
  };

  private togglePerf(): void {
    this.perf.visible = !this.perf.visible;
    this.perf.frames = this.perf.renders = 0;
    this.perf.since = performance.now();
    this.ui.setPerf(this.perf.visible ? 'measuring...' : null);
  }

  private updatePerf(now: number): void {
    const p = this.perf;
    if (!p.visible) return;
    p.frames++;
    const elapsed = now - p.since;
    if (elapsed < 500) return;
    const s = this.renderer.stats;
    const fps = (p.frames * 1000) / elapsed;
    const renders = (p.renders * 1000) / elapsed;
    this.ui.setPerf(
      `${fps.toFixed(0)} fps · ${renders.toFixed(0)} renders/s · ` +
        `${s.antialiasing} · res ${s.pixelRatio}x/${s.maxPixelRatio}x · ${s.calls} draws · ${(s.triangles / 1000).toFixed(0)}k tris`,
    );
    p.frames = p.renders = 0;
    p.since = now;
  }

  // ---------------------------------------------------------------------------------------------
  // Tools and input

  private setTool(tool: Tool): void {
    this.cancelDrag();
    this.tool = tool;
    this.ui.setTool(tool);
    if (tool !== Tool.Inspect) this.inspect(null);
    this.canvas.style.cursor = tool === Tool.Inspect ? 'default' : 'crosshair';
    this.updateHoverMarker();
  }

  private setSpeed(speed: number): void {
    if (speed > 0) this.resumeSpeed = speed;
    this.sim.speed = speed;
    this.ui.update(this.sim);
  }

  private toggleGrid(): void {
    this.gridOn = !this.gridOn;
    this.ui.setGrid(this.gridOn);
  }

  private bindInput(): void {
    const { canvas } = this;

    canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 2 && this.dragStart) {
        this.cancelDrag();
        return;
      }
      if (e.button !== 0 || e.altKey) return;
      const tile = this.pick(e.clientX, e.clientY);
      if (!tile) return;
      if (this.tool === Tool.Inspect) {
        this.inspect(tile);
        return;
      }
      this.dragStart = tile;
      this.hover = tile;
      this.updatePreview();
      this.updateHoverMarker();
    });

    // Pointer events only record the position; picking happens once per frame in refreshHover().
    window.addEventListener('pointermove', (e) => {
      this.pointer.x = e.clientX;
      this.pointer.y = e.clientY;
      this.pointer.over = e.target === canvas;
      if (this.dragStart) this.ui.moveDragTip(e.clientX, e.clientY);
    });

    window.addEventListener('pointerup', (e) => {
      if (e.button === 0 && this.dragStart) this.applyDrag();
    });

    canvas.addEventListener('pointerleave', () => (this.pointer.over = false));

    window.addEventListener('keydown', (e) => {
      if (this.ui.modalOpen || e.target instanceof HTMLInputElement) return;
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') {
        e.preventDefault();
        this.save(false);
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const def = TOOL_DEFS.find((d) => `Digit${d.key}` === e.code || `Numpad${d.key}` === e.code);
      if (def) {
        this.setTool(def.tool);
        return;
      }
      switch (e.code) {
        case 'Escape':
          if (this.dragStart) this.cancelDrag();
          else if (this.inspected) this.inspect(null);
          else this.setTool(Tool.Inspect);
          break;
        case 'Space':
          // A focused toolbar button would otherwise also be "clicked" by the space bar.
          e.preventDefault();
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
          this.setSpeed(this.sim.speed === 0 ? this.resumeSpeed : 0);
          break;
        case 'KeyG':
          this.toggleGrid();
          break;
        case 'KeyH':
          this.ui.openHelp();
          break;
        case 'Backquote':
          this.togglePerf();
          break;
      }
    });
  }

  /**
   * Tile under the cursor. Object tools (inspect, bulldoze) hit what you point at, so aiming at a
   * tower selects the tower rather than the ground behind it; build tools project onto the ground,
   * which keeps drag rectangles predictable.
   */
  private pick(clientX: number, clientY: number): TileRef | null {
    const objects = this.tool === Tool.Inspect || this.tool === Tool.Bulldoze;
    const ray = this.camera.rayFrom(clientX, clientY).ray;
    return pickTile(ray, this.sim.world.size, objects ? this.chunks.heights : undefined);
  }

  private refreshHover(): void {
    let tile: TileRef | null = null;
    if (this.pointer.over || this.dragStart) {
      // While dragging, keep the last tile if the cursor leaves the map.
      tile = this.pick(this.pointer.x, this.pointer.y) ?? (this.dragStart ? this.hover : null);
    }
    const changed = tile?.x !== this.hover?.x || tile?.z !== this.hover?.z;
    this.hover = tile;
    if (changed && this.dragStart) this.updatePreview();
    this.updateHoverMarker();
  }

  private updateHoverMarker(): void {
    const h = this.hover;
    if (!h || this.dragStart) {
      this.overlay.setHover(null);
      return;
    }
    let invalid = false;
    if (this.tool !== Tool.Inspect) {
      const plan = planTool(this.sim.world, this.tool, h.x, h.z, h.x, h.z);
      invalid = plan.tiles.length > 0 && !plan.tiles[0].ok;
    }
    this.overlay.setHover(h, this.tool, invalid);
  }

  private updatePreview(): void {
    const start = this.dragStart;
    const end = this.hover ?? start;
    if (!start || !end) return;
    const plan = planTool(this.sim.world, this.tool, start.x, start.z, end.x, end.z);
    this.overlay.showPlan(plan);
    const tooExpensive = plan.cost > this.sim.funds;
    const text =
      plan.count === 0
        ? 'Nothing to change'
        : `${plan.count} tile${plan.count === 1 ? '' : 's'} · ${plan.cost === 0 ? 'free' : formatMoney(plan.cost)}` +
          (tooExpensive ? ' · not enough funds' : '');
    this.ui.showDragTip(this.pointer.x, this.pointer.y, text, tooExpensive);
  }

  private applyDrag(): void {
    const start = this.dragStart!;
    const end = this.hover ?? start;
    const plan = planTool(this.sim.world, this.tool, start.x, start.z, end.x, end.z);
    const result = this.sim.applyTool(plan);
    if (!result.ok && result.reason) this.ui.toast(result.reason, 'warn');
    this.cancelDrag();
    this.updateHoverMarker();
  }

  private cancelDrag(): void {
    this.dragStart = null;
    this.overlay.clearPlan();
    this.ui.hideDragTip();
  }

  private inspect(tile: TileRef | null): void {
    this.inspected = tile;
    this.lastInfo = '';
    this.overlay.setSelection(tile);
    this.refreshInfo();
  }

  private refreshInfo(): void {
    const t = this.inspected;
    const info: TileInfo | null = t ? describeTile(this.sim, t.x, t.z) : null;
    // Only touch the DOM when something changed, so buttons in the panel stay clickable.
    const key = JSON.stringify(info);
    if (key === this.lastInfo) return;
    this.lastInfo = key;
    this.ui.showInfo(info);
  }

  /** The camera's view on the ground, as a polygon in tile coordinates, for the minimap. */
  private viewFootprint(): Array<[number, number]> {
    const rect = this.canvas.getBoundingClientRect();
    const corners: Array<[number, number]> = [
      [rect.left, rect.top],
      [rect.right, rect.top],
      [rect.right, rect.bottom],
      [rect.left, rect.bottom],
    ];
    const out: Array<[number, number]> = [];
    for (const [cx, cy] of corners) {
      const p = this.camera.groundPoint(cx, cy);
      if (!p) return [];
      out.push([p.x, p.z]);
    }
    return out;
  }

  // ---------------------------------------------------------------------------------------------
  // City lifecycle

  private bindSimulation(): void {
    this.sim.onMessage = (text, kind) => this.ui.toast(text, kind);
    this.resumeSpeed = this.sim.speed || 1;
  }

  private switchCity(sim: Simulation, camera?: CameraState): void {
    this.cancelDrag();
    this.inspect(null);
    this.sim = sim;
    this.bindSimulation();
    this.chunks.setWorld(sim.world);
    this.chunks.flush();
    this.renderer.buildMapBase(sim.world);
    this.needsRender = true;
    if (camera) this.camera.setState(camera);
    else this.camera.reset();
    this.ui.update(sim);
    this.ui.toast(`Welcome to ${sim.cityName}!`, 'good');
  }

  private save(auto: boolean): void {
    try {
      const data = serialize(this.sim, this.camera.getState());
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      this.ui.toast(auto ? 'Autosaved' : `${this.sim.cityName} saved`, auto ? 'info' : 'good');
    } catch (err) {
      console.error(err);
      this.ui.toast('Could not save: browser storage is full or unavailable', 'warn');
    }
  }

  private readSave(): { sim: Simulation; camera?: CameraState } | null {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw) as SaveData;
      return { sim: deserialize(data), camera: data.camera };
    } catch (err) {
      console.warn('Ignoring unreadable save', err);
      return null;
    }
  }

  private async loadFromStorage(): Promise<void> {
    if (!localStorage.getItem(SAVE_KEY)) {
      this.ui.toast('There is no saved city yet', 'warn');
      return;
    }
    const ok = await this.ui.confirm('Load saved city?', 'Any progress since your last save will be lost.', 'Load');
    if (!ok) return;
    const saved = this.readSave();
    if (!saved) {
      this.ui.toast('The saved city could not be read', 'warn');
      return;
    }
    this.switchCity(saved.sim, saved.camera);
  }

  /** Debug handle for the browser console. */
  get debug() {
    return { sim: this.sim, camera: this.camera, chunks: this.chunks };
  }
}

function createCity(name: string, seed: number): Simulation {
  const world = new World(MAP_SIZE, seed);
  generateTerrain(world, seed);
  const sim = new Simulation(world);
  sim.cityName = name;
  return sim;
}
