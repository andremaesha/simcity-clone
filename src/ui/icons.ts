/** Inline 24x24 stroke icons, so the UI has no asset dependencies. */
const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  inspect: svg('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/><path d="M11 8.5v5M8.5 11h5"/>'),
  bulldoze: svg(
    '<path d="M3 15h11v-4H9l-2-4H4v8"/><path d="M14 13h3l3 4"/><path d="M17 9v8h4"/><circle cx="6" cy="18" r="2"/><circle cx="12" cy="18" r="2"/>',
  ),
  road: svg('<path d="M8 3L4 21M16 3l4 18"/><path d="M12 4v3M12 10.5v3M12 17v3"/>'),
  residential: svg('<path d="M3 11l9-7 9 7"/><path d="M5 9.5V20h14V9.5"/><path d="M10 20v-5h4v5"/>'),
  commercial: svg(
    '<path d="M4 9h16l-1.5-5h-13z"/><path d="M4 9c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3"/><path d="M5 12v8h14v-8"/><path d="M10 20v-4h4v4"/>',
  ),
  industrial: svg(
    '<path d="M3 20V10l5 3v-3l5 3v-3l5 3V4h3v16z"/><path d="M7 17h2M12 17h2M17 17h1"/>',
  ),
  dezone: svg('<path d="M4 17l9-9 6 6-6 6H8z"/><path d="M9 11l6 6"/><path d="M13 20h8"/>'),
  pause: svg('<path d="M9 5v14M15 5v14"/>'),
  play: svg('<path d="M7 5l12 7-12 7z"/>'),
  fast: svg('<path d="M3 6l8 6-8 6zM12 6l8 6-8 6z"/>'),
  faster: svg('<path d="M2 7l6 5-6 5zM9 7l6 5-6 5zM16 7l6 5-6 5z"/>'),
  save: svg('<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v5h7V3"/><path d="M8 21v-7h8v7"/>'),
  load: svg('<path d="M3 7V5a1 1 0 011-1h5l2 2h8a1 1 0 011 1v2"/><path d="M3 9h18l-2 11H5z"/>'),
  newCity: svg('<path d="M12 5v14M5 12h14"/>'),
  grid: svg('<path d="M4 4h16v16H4zM4 9.3h16M4 14.6h16M9.3 4v16M14.6 4v16"/>'),
  help: svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 015 .5c0 1.7-2.5 2-2.5 3.5"/><path d="M12 17h.01"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  people: svg('<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 5a3 3 0 010 6M18 14c2 .8 3 2.9 3 6"/>'),
  money: svg('<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9v.01M18 15v.01"/>'),
  calendar: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
} as const;

export type IconName = keyof typeof ICONS;
