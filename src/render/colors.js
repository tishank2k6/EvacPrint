// Shared colour scales so the 2D plan, 3D model, charts, reports and
// illustrations all encode density identically.
export const BAND = ['#3b9a5c', '#c9a62c', '#e07b2a', '#c93a3a'];
export const BAND_LABEL = ['Low', 'Moderate', 'High', 'Critical'];
export const BAND_RANGE = ['< 1.08 p/m²', '1.08–2.15', '2.15–4.0', '≥ 4.0 p/m²'];
export const BAND_LOS = ['LOS A–D', 'LOS E', 'LOS F', 'LOS F+'];

// Stops: [density, r, g, b, alpha]
const STOPS = [
  [0.0, 59, 154, 92, 0],
  [0.35, 59, 154, 92, 0.18],
  [1.08, 59, 154, 92, 0.5],
  [1.6, 201, 166, 44, 0.62],
  [2.15, 224, 123, 42, 0.72],
  [4.0, 201, 58, 58, 0.82],
  [5.6, 168, 30, 40, 0.9],
];

const LUT = new Uint8ClampedArray(256 * 4);
const LUT_MAX = 6;
for (let i = 0; i < 256; i++) {
  const d = (i / 255) * LUT_MAX;
  let k = 0;
  while (k < STOPS.length - 2 && d > STOPS[k + 1][0]) k++;
  const a = STOPS[k], b = STOPS[k + 1];
  const t = Math.max(0, Math.min(1, (d - a[0]) / (b[0] - a[0])));
  for (let c = 0; c < 4; c++) {
    const v = a[c + 1] + (b[c + 1] - a[c + 1]) * t;
    LUT[i * 4 + c] = c === 3 ? Math.round(v * 255) : Math.round(v);
  }
}

/** write RGBA for density into out[o..o+3] */
export function densityRGBA(rho, out, o, alphaScale = 1) {
  const i = Math.max(0, Math.min(255, Math.round((rho / LUT_MAX) * 255))) * 4;
  out[o] = LUT[i];
  out[o + 1] = LUT[i + 1];
  out[o + 2] = LUT[i + 2];
  out[o + 3] = LUT[i + 3] * alphaScale;
}

export function densityCss(rho) {
  const o = [0, 0, 0, 0];
  densityRGBA(rho, o, 0);
  return `rgba(${o[0]},${o[1]},${o[2]},${(o[3] / 255).toFixed(3)})`;
}

export const bandOf = (rho) => (rho < 1.08 ? 0 : rho < 2.15 ? 1 : rho < 4 ? 2 : 3);

export const AGENT_COLORS = {
  adult: '#ece6da',
  slow: '#e3a03a',
  wheelchair: '#8b9be0',
  waiting: 'rgba(236,230,218,0.38)',
  congested: '#f06d64',
};
