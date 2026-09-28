type Attrs = Record<string, string | number | boolean | undefined>;
type Child = Node | string | null | undefined | false;

/**
 * Tiny hyperscript helper: h('div.panel#id', { title: 'x' }, child, ...).
 * The `html` attribute is for trusted, static markup only (our SVG icons); user text goes in as children.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  spec: K | `${K}.${string}` | `${K}#${string}`,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const [tagAndId, ...classes] = spec.split('.');
  const [tag, id] = tagAndId.split('#');
  const el = document.createElement(tag as K);
  if (id) el.id = id;
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === 'html') el.innerHTML = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c);
  }
  return el;
}

/** Sets textContent only when it changed, to avoid needless layout work in per-frame updates. */
export function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

export function formatMoney(n: number): string {
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
}

export function formatNumber(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}
