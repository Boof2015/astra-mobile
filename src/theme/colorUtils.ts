/**
 * Tiny color math helpers for palette derivation. No dependencies.
 * All hex I/O is 6-digit `#rrggbb` (the solid-token invariant — see palettes.ts).
 */

export function normalizeHexColor(value: string): string | null {
  const trimmed = value.trim();
  const short = /^#?([0-9a-fA-F]{3})$/.exec(trimmed);
  if (short) {
    const [r, g, b] = short[1].split('');
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  const full = /^#?([0-9a-fA-F]{6})$/.exec(trimmed);
  return full ? `#${full[1].toLowerCase()}` : null;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

function channelToHex(value: number): string {
  return Math.round(Math.min(255, Math.max(0, value)))
    .toString(16)
    .padStart(2, '0');
}

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${channelToHex(r)}${channelToHex(g)}${channelToHex(b)}`;
}

/** h in degrees [0,360), s/l in percent [0,100]. */
export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const { r, g, b } = hexToRgb(hex);
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return { h: h * 360, s: s * 100, l: l * 100 };
}

export function hslToHex(h: number, s: number, l: number): string {
  const sn = Math.min(100, Math.max(0, s)) / 100;
  const ln = Math.min(100, Math.max(0, l)) / 100;
  const hn = (((h % 360) + 360) % 360) / 360;
  if (sn === 0) {
    const v = ln * 255;
    return rgbToHex(v, v, v);
  }
  const q = ln < 0.5 ? ln * (1 + sn) : ln + sn - ln * sn;
  const p = 2 * ln - q;
  const hue = (t: number) => {
    let tn = t;
    if (tn < 0) tn += 1;
    if (tn > 1) tn -= 1;
    if (tn < 1 / 6) return p + (q - p) * 6 * tn;
    if (tn < 1 / 2) return q;
    if (tn < 2 / 3) return p + (q - p) * (2 / 3 - tn) * 6;
    return p;
  };
  return rgbToHex(hue(hn + 1 / 3) * 255, hue(hn) * 255, hue(hn - 1 / 3) * 255);
}

export function rgbaFromHex(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Linear RGB mix of two hex colors: t=0 → a, t=1 → b. */
export function mixHex(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return rgbToHex(
    ca.r + (cb.r - ca.r) * t,
    ca.g + (cb.g - ca.g) * t,
    ca.b + (cb.b - ca.b) * t,
  );
}

/** h in degrees [0, 360), s/v as fractions [0, 1]. */
export interface HsvColor {
  h: number;
  s: number;
  v: number;
}

export function hexToHsv(hex: string): HsvColor {
  const normalized = normalizeHexColor(hex) ?? '#000000';
  const { r, g, b } = hexToRgb(normalized);
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let h = 0;
  if (delta > 0) {
    if (max === rn) h = 60 * (((gn - bn) / delta) % 6);
    else if (max === gn) h = 60 * ((bn - rn) / delta + 2);
    else h = 60 * ((rn - gn) / delta + 4);
  }
  if (h < 0) h += 360;
  return {
    h,
    s: max === 0 ? 0 : delta / max,
    v: max,
  };
}

export function hsvToHex(h: number, s: number, v: number): string {
  const hue = ((h % 360) + 360) % 360;
  const saturation = Math.min(1, Math.max(0, s));
  const value = Math.min(1, Math.max(0, v));
  const chroma = value * saturation;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const match = value - chroma;
  let channels: [number, number, number];
  if (hue < 60) channels = [chroma, x, 0];
  else if (hue < 120) channels = [x, chroma, 0];
  else if (hue < 180) channels = [0, chroma, x];
  else if (hue < 240) channels = [0, x, chroma];
  else if (hue < 300) channels = [x, 0, chroma];
  else channels = [chroma, 0, x];
  return rgbToHex(
    (channels[0] + match) * 255,
    (channels[1] + match) * 255,
    (channels[2] + match) * 255,
  );
}
