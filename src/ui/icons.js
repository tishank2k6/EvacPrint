// EvacPrint icon set — 24px grid, 1.6px stroke, square-ish terminals,
// drawn to match the drafting style of the floor plans.
const P = {
  logo: '<path d="M4 4h12v4"/><path d="M4 4v16h12v-4"/><path d="M9 12h11"/><path d="M16.5 8.5 20 12l-3.5 3.5"/><path d="M7 8h2M7 16h2" stroke-width="1.2"/>',
  overview: '<rect x="3.5" y="3.5" width="17" height="17" rx="1.5"/><path d="M3.5 9h17M9 9v11.5"/><path d="M12.5 13h5M12.5 16.5h3"/>',
  simulator: '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M3.5 9.5h17" stroke-dasharray="1.5 2"/><circle cx="8" cy="14" r="1.2" fill="currentColor"/><circle cx="12" cy="15.5" r="1.2" fill="currentColor"/><path d="m15 12.5 2.5 2-2.5 2"/>',
  cube: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>',
  flow: '<rect x="3.5" y="3.5" width="7" height="5" rx="1"/><rect x="13.5" y="15.5" width="7" height="5" rx="1"/><path d="M7 8.5V12a2 2 0 0 0 2 2h6a2 2 0 0 1 2 2v-.5"/><path d="m15.5 13.5 1.5 2 1.5-2"/>',
  chip: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.5"/><path d="M9.5 3v3.5M14.5 3v3.5M9.5 17.5V21M14.5 17.5V21M3 9.5h3.5M3 14.5h3.5M17.5 9.5H21M17.5 14.5H21"/><path d="M10 10h4v4h-4z"/>',
  learn: '<path d="M3.5 6.5 12 3l8.5 3.5L12 10z"/><path d="M7 8.2v5.3c0 1.4 2.2 2.8 5 2.8s5-1.4 5-2.8V8.2"/><path d="M20.5 6.5V12"/>',
  report: '<path d="M6 3.5h8.5L18.5 7.5v13H6z"/><path d="M14 3.5v4.5h4.5"/><path d="M9 17v-3M12 17v-5M15 17v-2"/>',
  user: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c.9-3.6 4-5.5 7.5-5.5s6.6 1.9 7.5 5.5"/>',
  logout: '<path d="M14 4.5H6.5v15H14"/><path d="M10 12h10M17 8.5l3.5 3.5-3.5 3.5"/>',
  play: '<path d="M7.5 5.2v13.6a.6.6 0 0 0 .9.5l10.8-6.8a.6.6 0 0 0 0-1L8.4 4.7a.6.6 0 0 0-.9.5z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6.5" y="5" width="3.6" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="13.9" y="5" width="3.6" height="14" rx="1" fill="currentColor" stroke="none"/>',
  step: '<path d="M6 5.5v13l8.5-6.5z" fill="currentColor" stroke="none"/><path d="M17.5 5.5v13"/>',
  reset: '<path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5"/><path d="M4.5 4.5V9H9"/>',
  layers: '<path d="m12 4 8.5 4.5L12 13 3.5 8.5z"/><path d="m3.5 12.5 8.5 4.5 8.5-4.5"/><path d="m3.5 16 8.5 4.5 8.5-4.5" opacity=".5"/>',
  heat: '<path d="M12 3.5c3 3.3 5.5 6.3 5.5 9.8a5.5 5.5 0 0 1-11 0c0-1.9.8-3.6 2.1-5.1.3 1.6 1.2 2.8 2.4 3.3C10.4 8.9 10.9 6.1 12 3.5z"/>',
  arrows: '<path d="M4 7h11M12 4l3 3-3 3"/><path d="M4 17h16M17 14l3 3-3 3"/>',
  door: '<path d="M5 20.5V4.5h9v16"/><path d="M14 4.5 19 7v13.5h-5"/><circle cx="11.5" cy="12.5" r=".9" fill="currentColor"/><path d="M3 20.5h18"/>',
  exit: '<path d="M10 4.5H4.5v15H10"/><circle cx="14.5" cy="5.5" r="1.6"/><path d="m13 9 2.5 1 1.5 3 2.5 1M15.5 10l-1.5 4.5 2.5 2.5v3.5M14 14.5l-2.5 1.5-1.5 3"/>',
  warning: '<path d="M12 4 21 19.5H3z"/><path d="M12 10v4.5"/><circle cx="12" cy="17" r=".9" fill="currentColor" stroke="none"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  checkCircle: '<circle cx="12" cy="12" r="8.5"/><path d="m8.5 12.2 2.4 2.4 4.6-4.9"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r=".9" fill="currentColor" stroke="none"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M4 4l16 16"/><path d="M9.9 6A9.9 9.9 0 0 1 12 5.5C18 5.5 21.5 12 21.5 12a17 17 0 0 1-2.9 3.6M6.3 7.6A16 16 0 0 0 2.5 12S6 18.5 12 18.5c1.6 0 3-.4 4.2-1"/><path d="M10 10.2a3 3 0 0 0 4 4"/>',
  mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="1.5"/><path d="m4 6.5 8 6.5 8-6.5"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="1.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/><path d="M12 14.5v2.5"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 8.5-8.5M16 7l2.5 2.5M14 9l2 2"/>',
  iso: '<path d="m12 3.5 7.5 4.2v8.6L12 20.5l-7.5-4.2V7.7z"/><path d="m4.5 7.7 7.5 4.3 7.5-4.3M12 12v8.5" opacity=".55"/>',
  top: '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M4 9.5h16M9.5 9.5V20" opacity=".55"/><circle cx="15" cy="15" r="1.4" fill="currentColor" stroke="none"/>',
  camera: '<path d="M4 8.5h3l1.5-2h7L17 8.5h3v10H4z"/><circle cx="12" cy="13" r="3.2"/>',
  split: '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M12 4.5v15"/>',
  plan: '<rect x="3.5" y="4.5" width="17" height="15" rx="1"/><path d="M3.5 12h6M14.5 12h6M12 4.5v4M12 15.5v4"/>',
  edit: '<path d="M4.5 19.5 5.5 15l10-10 3.5 3.5-10 10z"/><path d="m13.5 7 3.5 3.5"/>',
  brush: '<path d="M14 4.5 19.5 10l-6.8 6.8-5.5-5.5z"/><path d="M7.2 11.3 4.5 16.5l3 3 5.2-2.7"/>',
  sparkle: '<path d="M12 3.5 13.8 10.2 20.5 12l-6.7 1.8L12 20.5l-1.8-6.7L3.5 12l6.7-1.8z"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".8" fill="currentColor"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  users: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3 19.5c.6-3 3-4.8 6-4.8s5.4 1.8 6 4.8"/><path d="M15.5 5.6a3.2 3.2 0 0 1 0 5.8M17.5 14.9c1.8.6 3.1 2.2 3.5 4.6"/>',
  gauge: '<path d="M4 16a8 8 0 1 1 16 0"/><path d="m12 16 4-5"/><circle cx="12" cy="16" r="1.2" fill="currentColor"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path d="M4.5 19.5h15"/>',
  print: '<path d="M7 9V4h10v5"/><rect x="4" y="9" width="16" height="7.5" rx="1.5"/><path d="M7 14h10v6H7z"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/><path d="M10 11v5.5M14 11v5.5"/>',
  arrowRight: '<path d="M5 12h14M13.5 6.5 19 12l-5.5 5.5"/>',
  arrowLeft: '<path d="M19 12H5M10.5 6.5 5 12l5.5 5.5"/>',
  chevronDown: '<path d="m6.5 9.5 5.5 5.5 5.5-5.5"/>',
  chevronRight: '<path d="m9.5 6.5 5.5 5.5-5.5 5.5"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  compare: '<rect x="3.5" y="5" width="7" height="14" rx="1"/><rect x="13.5" y="5" width="7" height="14" rx="1"/><path d="M12 3v18" stroke-dasharray="2 2"/>',
  route: '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h6.5a3.5 3.5 0 0 0 0-7h-5a3.5 3.5 0 0 1 0-7H16"/>',
  wheelchair: '<circle cx="11" cy="4.8" r="1.6"/><path d="M11 7.5v6h5l2 5"/><path d="M8.2 10.2a5.2 5.2 0 1 0 7.3 6.6"/>',
  shield: '<path d="M12 3.5 19.5 6v6c0 4.3-3.2 7.5-7.5 8.5-4.3-1-7.5-4.2-7.5-8.5V6z"/><path d="m8.8 12 2.2 2.2 4.4-4.4"/>',
  grid: '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M4 9.3h16M4 14.6h16M9.3 4v16M14.6 4v16"/>',
  bottleneck: '<path d="M3 6h7l3 4.5h8M3 18h7l3-4.5h8"/><circle cx="6" cy="12" r="1" fill="currentColor"/><circle cx="9" cy="10.5" r="1" fill="currentColor"/><circle cx="9" cy="13.5" r="1" fill="currentColor"/>',
  film: '<rect x="3.5" y="5" width="17" height="14" rx="1.5"/><path d="m10.5 9.5 4 2.5-4 2.5z" fill="currentColor"/>',
  cc: '<rect x="3.5" y="6" width="17" height="12" rx="1.5"/><path d="M10.5 10.3a2 2 0 1 0 0 3.4M16.5 10.3a2 2 0 1 0 0 3.4"/>',
  hand: '<path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V11M11 10V5a1.5 1.5 0 0 1 3 0v6M14 10.5V7a1.5 1.5 0 0 1 3 0v6.5c0 4-2.5 7-6 7-2.5 0-4-1.3-5.5-3.5L4 14.5a1.5 1.5 0 0 1 2.4-1.8L8 14.5"/>',
  zoomIn: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5M10.5 7.5v6M7.5 10.5h6"/>',
  zoomOut: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5M7.5 10.5h6"/>',
  rotate: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5V9H15"/>',
  building: '<path d="M4 20.5V8l8-4.5L20 8v12.5"/><path d="M2.5 20.5h19M9 20.5v-5h6v5M8 10.5h2M14 10.5h2"/>',
  alarm: '<path d="M6.5 17.5V12a5.5 5.5 0 0 1 11 0v5.5"/><path d="M4.5 17.5h15M10 20.5h4M12 3v2M4.2 6.2l1.4 1.4M19.8 6.2l-1.4 1.4"/>',
};

export function icon(name, cls = '') {
  const body = P[name] || P.info;
  return `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

export const logoMark = (size = 28) => `
<svg width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true">
  <rect x="1" y="1" width="30" height="30" rx="7" fill="#1b2025" stroke="rgba(236,230,218,.16)"/>
  <path d="M8 8h13v4.5M8 8v16h13v-4.5" fill="none" stroke="#ece6da" stroke-width="2" stroke-linecap="square"/>
  <path d="M12.5 16h13" stroke="#2fb8a6" stroke-width="2.2" stroke-linecap="round"/>
  <path d="m21.5 12 4 4-4 4" fill="none" stroke="#2fb8a6" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
