import { COSTS, SPEEDS } from '../config';
import { MessageKind, Simulation } from '../sim/simulation';
import { Tool } from '../sim/types';
import { formatMoney, formatNumber, h, setText } from './dom';
import { ICONS, IconName } from './icons';
import { TileInfo } from './inspector';
import { Minimap } from './minimap';

export interface UiCallbacks {
  onTool(tool: Tool): void;
  onSpeed(speed: number): void;
  onSave(): void;
  onLoad(): void;
  onNewCity(name: string): void;
  onToggleGrid(): void;
  onRename(name: string): void;
  onMinimapPick(x: number, z: number): void;
  onCloseInfo(): void;
}

interface ToolDef {
  tool: Tool;
  label: string;
  icon: IconName;
  key: string;
  tip: string;
  className?: string;
}

export const TOOL_DEFS: ToolDef[] = [
  { tool: Tool.Inspect, label: 'Inspect', icon: 'inspect', key: '1', tip: 'Click a tile to see its details' },
  { tool: Tool.Bulldoze, label: 'Bulldoze', icon: 'bulldoze', key: '2', tip: `Demolish roads, buildings and trees · from $${COSTS.bulldoze}` },
  { tool: Tool.Road, label: 'Road', icon: 'road', key: '3', tip: `Drag to build · $${COSTS.road} per tile` },
  { tool: Tool.Residential, label: 'Residential', icon: 'residential', key: '4', tip: `Homes · $${COSTS.zone} per tile`, className: 'zone-r' },
  { tool: Tool.Commercial, label: 'Commercial', icon: 'commercial', key: '5', tip: `Shops and offices · $${COSTS.zone} per tile`, className: 'zone-c' },
  { tool: Tool.Industrial, label: 'Industrial', icon: 'industrial', key: '6', tip: `Factories · $${COSTS.zone} per tile`, className: 'zone-i' },
  { tool: Tool.Dezone, label: 'De-zone', icon: 'dezone', key: '7', tip: 'Remove zoning from empty lots · free' },
];

const SPEED_ICONS: IconName[] = ['pause', 'play', 'fast', 'faster'];
const SPEED_LABELS = ['Pause', 'Normal speed', 'Fast', 'Very fast'];

const icon = (name: IconName) => h('span.icon', { html: ICONS[name] });

/** All DOM UI. Owns no game state: it renders what it is given and reports clicks through callbacks. */
export class Ui {
  readonly minimap: Minimap;
  private readonly toolButtons = new Map<Tool, HTMLButtonElement>();
  private readonly speedButtons: HTMLButtonElement[] = [];
  private readonly gridButton: HTMLButtonElement;
  private readonly cityName: HTMLButtonElement;
  private readonly date: HTMLElement;
  private readonly funds: HTMLElement;
  private readonly income: HTMLElement;
  private readonly population: HTMLElement;
  private readonly jobs: HTMLElement;
  private readonly demandBars: HTMLElement[] = [];
  private readonly info: HTMLElement;
  private readonly toasts: HTMLElement;
  private readonly dragTip: HTMLElement;
  private readonly perf: HTMLElement;
  private readonly notice: HTMLElement;
  private readonly modalRoot: HTMLElement;

  constructor(
    root: HTMLElement,
    private readonly cb: UiCallbacks,
    mapSize: number,
  ) {
    // --- Top bar ------------------------------------------------------------------------------
    this.cityName = h('button.city-name', { title: 'Rename city' });
    this.cityName.addEventListener('click', () => this.openRename());
    this.date = h('span.value');
    const speedGroup = h('div.speed-group');
    SPEEDS.forEach((_, s) => {
      const btn = h('button.icon-btn', { title: s === 0 ? 'Pause (Space)' : SPEED_LABELS[s], 'aria-label': SPEED_LABELS[s] });
      btn.append(icon(SPEED_ICONS[s]));
      btn.addEventListener('click', () => cb.onSpeed(s));
      this.speedButtons.push(btn);
      speedGroup.append(btn);
    });

    this.funds = h('span.value');
    this.income = h('span.sub');
    this.population = h('span.value');
    this.jobs = h('span.sub');

    const demand = h('div.demand', { title: 'Demand for Residential, Commercial and Industrial zones' });
    for (const [label, cls] of [
      ['R', 'zone-r'],
      ['C', 'zone-c'],
      ['I', 'zone-i'],
    ] as const) {
      const fill = h(`div.fill.${cls}`);
      this.demandBars.push(fill);
      demand.append(h('div.bar', {}, h('div.track', {}, fill), h('span', {}, label)));
    }

    const menu = h('div.menu');
    const menuButton = (name: IconName, title: string, fn: () => void) => {
      const btn = h('button.icon-btn', { title, 'aria-label': title });
      btn.append(icon(name));
      btn.addEventListener('click', fn);
      menu.append(btn);
      return btn;
    };
    menuButton('save', 'Save city (Ctrl+S)', () => cb.onSave());
    menuButton('load', 'Load saved city', () => cb.onLoad());
    menuButton('newCity', 'New city', () => this.openNewCity());
    this.gridButton = menuButton('grid', 'Toggle grid (G)', () => cb.onToggleGrid());
    menuButton('help', 'Controls (H)', () => this.openHelp());

    root.append(
      h(
        'div.topbar',
        {},
        h('div.panel.city', {}, this.cityName, h('div.stat', {}, icon('calendar'), this.date), speedGroup),
        h(
          'div.panel.stats',
          {},
          h('div.stat', { title: 'City funds and last month\'s income' }, icon('money'), h('div.stack', {}, this.funds, this.income)),
          h('div.stat', { title: 'Population and jobs' }, icon('people'), h('div.stack', {}, this.population, this.jobs)),
          demand,
        ),
        h('div.panel.menu-panel', {}, menu),
      ),
    );

    // --- Toolbar ------------------------------------------------------------------------------
    const toolbar = h('div.panel.toolbar');
    for (const def of TOOL_DEFS) {
      const btn = h(`button.tool${def.className ? '.' + def.className : ''}`, { 'data-tip': def.tip, 'aria-label': def.label });
      btn.append(icon(def.icon), h('span.label', {}, def.label), h('kbd', {}, def.key));
      btn.addEventListener('click', () => cb.onTool(def.tool));
      this.toolButtons.set(def.tool, btn);
      toolbar.append(btn);
    }
    root.append(toolbar);
    this.notice = h('div.notice.hidden', { role: 'status' });
    root.append(this.notice);

    // --- Info panel, minimap, toasts, drag tooltip, modals ----------------------------------------
    this.info = h('div.panel.info.collapsed');
    root.append(this.info);

    this.minimap = new Minimap(mapSize, (x, z) => cb.onMinimapPick(x, z));
    root.append(h('div.panel.minimap', {}, this.minimap.canvas));

    this.toasts = h('div.toasts');
    this.dragTip = h('div.drag-tip.hidden');
    this.perf = h('div.perf.hidden');
    this.modalRoot = h('div.modal-root');
    root.append(this.toasts, this.dragTip, this.perf, this.modalRoot);
  }

  update(sim: Simulation): void {
    setText(this.cityName, sim.cityName);
    setText(this.date, sim.dateLabel);
    setText(this.funds, formatMoney(sim.funds));
    this.funds.classList.toggle('negative', sim.funds < 0);
    setText(this.income, `${sim.lastMonthIncome >= 0 ? '+' : ''}${formatMoney(sim.lastMonthIncome)}/mo`);
    setText(this.population, formatNumber(sim.stats.population));
    setText(this.jobs, `${formatNumber(sim.stats.comJobs + sim.stats.indJobs)} jobs`);

    const d = sim.demand;
    [d.residential, d.commercial, d.industrial].forEach((v, k) => {
      const bar = this.demandBars[k];
      const pct = Math.min(1, Math.abs(v)) * 50;
      bar.style.height = `${pct}%`;
      bar.style.bottom = v >= 0 ? '50%' : `${50 - pct}%`;
      bar.classList.toggle('negative', v < 0);
    });
    this.speedButtons.forEach((btn, s) => btn.classList.toggle('active', s === sim.speed));

    const cut = sim.stats.disconnectedTiles;
    this.notice.classList.toggle('hidden', cut === 0);
    if (cut > 0) {
      setText(
        this.notice,
        `${formatNumber(cut)} zoned tile${cut === 1 ? " isn't" : "s aren't"} connected to the highway, so nobody can move in.`,
      );
    }
  }

  setTool(tool: Tool): void {
    for (const [t, btn] of this.toolButtons) btn.classList.toggle('active', t === tool);
  }

  setGrid(on: boolean): void {
    this.gridButton.classList.toggle('active', on);
  }

  showInfo(info: TileInfo | null): void {
    if (!info) {
      this.info.classList.add('collapsed');
      return;
    }
    const close = h('button.icon-btn.close', { title: 'Close', 'aria-label': 'Close' });
    close.append(icon('close'));
    close.addEventListener('click', () => this.cb.onCloseInfo());
    const rows = h('dl');
    for (const [k, v] of info.rows) rows.append(h('dt', {}, k), h('dd', {}, v));
    this.info.replaceChildren(
      h('div.info-head', {}, h('span.swatch', { style: `background:${info.accent}` }), h('div', {}, h('h3', {}, info.title), h('p', {}, info.subtitle)), close),
      rows,
      ...(info.hint ? [h('p.hint', {}, info.hint)] : []),
    );
    this.info.classList.remove('collapsed');
  }

  toast(text: string, kind: MessageKind = 'info'): void {
    const el = h(`div.toast.toast-${kind}`, {}, text);
    this.toasts.append(el);
    setTimeout(() => el.classList.add('leaving'), 3500);
    setTimeout(() => el.remove(), 4000);
    while (this.toasts.children.length > 4) this.toasts.firstElementChild?.remove();
  }

  showDragTip(x: number, y: number, text: string, bad: boolean): void {
    setText(this.dragTip, text);
    this.dragTip.classList.remove('hidden');
    this.dragTip.classList.toggle('bad', bad);
    this.moveDragTip(x, y);
  }

  moveDragTip(x: number, y: number): void {
    this.dragTip.style.transform = `translate(${x + 16}px, ${y + 18}px)`;
  }

  /** Performance readout (toggled with the backquote key); null hides it. */
  setPerf(text: string | null): void {
    this.perf.classList.toggle('hidden', text === null);
    if (text !== null) setText(this.perf, text);
  }

  hideDragTip(): void {
    this.dragTip.classList.add('hidden');
  }

  get modalOpen(): boolean {
    return this.modalRoot.childElementCount > 0;
  }

  /** Resolves true when the player confirms. */
  confirm(title: string, message: string, okLabel = 'OK'): Promise<boolean> {
    return new Promise((resolve) => {
      const ok = h('button.btn.primary', {}, okLabel);
      const cancel = h('button.btn', {}, 'Cancel');
      let answer = false;
      const close = this.modal([h('h2', {}, title), h('p', {}, message), h('div.actions', {}, cancel, ok)], () => resolve(answer));
      ok.addEventListener('click', () => {
        answer = true;
        close();
      });
      cancel.addEventListener('click', close);
      ok.focus();
    });
  }

  openHelp(): void {
    const rows: Array<[string, string]> = [
      ['Left drag', 'Use the selected tool'],
      ['Right drag', 'Pan the camera'],
      ['Middle drag / Alt + drag', 'Rotate and tilt'],
      ['Mouse wheel', 'Zoom toward the cursor'],
      ['W A S D / arrows', 'Pan (hold Shift for faster)'],
      ['Q / E', 'Rotate'],
      ['R / F', 'Tilt'],
      ['1 – 7', 'Select tool'],
      ['Esc', 'Cancel / back to Inspect'],
      ['Space', 'Pause / resume'],
      ['G', 'Toggle grid'],
      ['Ctrl + S', 'Save'],
      ['` (backquote)', 'Performance stats'],
    ];
    const table = h('dl.help-table');
    for (const [k, v] of rows) table.append(h('dt', {}, k), h('dd', {}, v));
    const ok = h('button.btn.primary', {}, 'Got it');
    const close = this.modal([
      h('h2', {}, 'How to play'),
      h(
        'p',
        {},
        'Everyone arrives by the highway, so start with a road off it. Zone land along your roads: ' +
          'residential needs jobs, commercial needs residents, and industry needs workers. ' +
          'Watch the R/C/I demand bars to see what your city wants next.',
      ),
      table,
      h('div.actions', {}, ok),
    ]);
    ok.addEventListener('click', close);
  }

  private openNewCity(): void {
    const input = h('input.text', { type: 'text', maxlength: 32, value: 'New City', 'aria-label': 'City name' });
    const create = h('button.btn.primary', {}, 'Found city');
    const cancel = h('button.btn', {}, 'Cancel');
    const close = this.modal([
      h('h2', {}, 'Found a new city'),
      h('p', {}, 'A fresh random map will be generated. Your current city will be lost unless you saved it.'),
      h('label.field', {}, h('span', {}, 'City name'), input),
      h('div.actions', {}, cancel, create),
    ]);
    const submit = () => {
      close();
      this.cb.onNewCity(input.value.trim() || 'New City');
    };
    create.addEventListener('click', submit);
    cancel.addEventListener('click', close);
    input.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
    input.focus();
    input.select();
  }

  private openRename(): void {
    const input = h('input.text', { type: 'text', maxlength: 32, value: this.cityName.textContent ?? '', 'aria-label': 'City name' });
    const ok = h('button.btn.primary', {}, 'Rename');
    const cancel = h('button.btn', {}, 'Cancel');
    const close = this.modal([h('h2', {}, 'Rename city'), h('label.field', {}, h('span', {}, 'City name'), input), h('div.actions', {}, cancel, ok)]);
    const submit = () => {
      const name = input.value.trim();
      close();
      if (name) this.cb.onRename(name);
    };
    ok.addEventListener('click', submit);
    cancel.addEventListener('click', close);
    input.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
    input.focus();
    input.select();
  }

  /** Shows a modal dialog and returns a function that closes it. Esc and backdrop clicks close it too. */
  private modal(content: Node[], onClose?: () => void): () => void {
    const dialog = h('div.panel.modal', { role: 'dialog', 'aria-modal': 'true' }, ...content);
    const backdrop = h('div.backdrop', {}, dialog);
    const close = () => {
      if (!backdrop.isConnected) return;
      backdrop.remove();
      window.removeEventListener('keydown', onKey, true);
      onClose?.();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    backdrop.addEventListener('pointerdown', (e) => e.target === backdrop && close());
    window.addEventListener('keydown', onKey, true);
    this.modalRoot.append(backdrop);
    return close;
  }
}
