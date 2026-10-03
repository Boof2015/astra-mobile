/**
 * Colors for now-playing's living-gradient backdrop: up to three areas of the
 * cover, toned so they can sit behind text.
 *
 * Built on the adaptive extractor's clusters rather than by changing it — that
 * module is kept in step with desktop, and the backdrop wants something the
 * accent does not: several colors that read as the cover, not one that stands
 * out from it.
 */
import {
  buildHistogram,
  chromaOf,
  hueOf,
  quantizeWu,
  refineInOklab,
  scoreColors,
  type Oklab,
  type WeightedColor,
} from './adaptiveAccent.ts';

export const FIELD_SIZE = 3;

// Same near-grey cut the extractor uses, in its CAM16-like chroma units.
const CHROMA_UNITS = 360;
const CHROMA_CUTOFF = 5;
/** A cluster must cover this share of the cover to be part of the field. */
const MIN_SHARE = 0.02;
/** Distinct-hue picks must be at least this far apart on the hue wheel. */
const MIN_HUE_SEPARATION = 28;
/** Below this OKLab distance two picks are the same color. */
const MIN_LAB_DISTANCE = 0.08;

/**
 * Per-blob lightness is staggered slightly so three blobs of one hue still
 * read as depth rather than as one flat wash.
 */
const DARK_TONE = { lightness: [0.42, 0.37, 0.46], chromaScale: 0.95, chromaMax: 0.16 };
const LIGHT_TONE = { lightness: [0.86, 0.89, 0.83], chromaScale: 0.6, chromaMax: 0.09 };

export interface ArtworkField {
  /** Always FIELD_SIZE `#rrggbb` colors. */
  colors: string[];
  /** True when the cover has no real color; the field is then greys. */
  neutral: boolean;
}

const isColored = (lab: Oklab) => chromaOf(lab) * CHROMA_UNITS >= CHROMA_CUTOFF;

function hueDistance(a: Oklab, b: Oklab): number {
  const d = Math.abs(hueOf(a) - hueOf(b)) % 360;
  return d > 180 ? 360 - d : d;
}

function labDistance(a: Oklab, b: Oklab): number {
  return Math.hypot(a.L - b.L, a.a - b.a, a.b - b.b);
}

/**
 * Field order: what most of the cover looks like, then its most distinctive
 * color, then other distinct hues. A cover with fewer hues fills the rest from
 * the same family, then from its greys, so the field never invents a color the
 * cover does not have.
 */
export function pickFieldSources(clusters: WeightedColor[]): { sources: Oklab[]; neutral: boolean } {
  const total = clusters.reduce((sum, cluster) => sum + cluster.population, 0);
  if (total <= 0) return { sources: [], neutral: true };
  const byPopulation = clusters
    .filter((cluster) => cluster.population / total >= MIN_SHARE)
    .sort((a, b) => b.population - a.population);
  const colored = byPopulation.filter((cluster) => isColored(cluster.lab));

  const picks: Oklab[] = [];
  const tryAdd = (lab: Oklab, separateHue: boolean) => {
    if (picks.length >= FIELD_SIZE) return;
    if (picks.some((pick) => labDistance(pick, lab) < MIN_LAB_DISTANCE)) return;
    if (
      separateHue &&
      picks.some((pick) => isColored(pick) && hueDistance(pick, lab) < MIN_HUE_SEPARATION)
    ) {
      return;
    }
    picks.push(lab);
  };

  if (colored[0]) tryAdd(colored[0].lab, true);
  const distinctive = scoreColors(clusters)[0];
  if (distinctive) tryAdd(distinctive.lab, true);
  for (const cluster of colored) tryAdd(cluster.lab, true);
  for (const cluster of colored) tryAdd(cluster.lab, false);
  for (const cluster of byPopulation) tryAdd(cluster.lab, false);

  const found = picks.length;
  for (let i = 0; found > 0 && picks.length < FIELD_SIZE; i++) {
    picks.push(picks[i % found]);
  }
  return { sources: picks, neutral: colored.length === 0 };
}

// ── OKLCH → hex (gamut-mapped by chroma reduction) ─────────

function oklabToLinear(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function inGamut(rgb: [number, number, number]): boolean {
  return rgb.every((channel) => channel >= -1e-4 && channel <= 1 + 1e-4);
}

function linearChannelToHex(value: number): string {
  const c = value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
  return Math.round(Math.max(0, Math.min(1, c)) * 255)
    .toString(16)
    .padStart(2, '0');
}

export function oklchToHex(L: number, chroma: number, hueDegrees: number): string {
  const h = (hueDegrees * Math.PI) / 180;
  const at = (c: number) => oklabToLinear(L, c * Math.cos(h), c * Math.sin(h));
  let rgb = at(chroma);
  if (!inGamut(rgb)) {
    let low = 0;
    let high = chroma;
    for (let step = 0; step < 18; step++) {
      const middle = (low + high) / 2;
      if (inGamut(at(middle))) low = middle;
      else high = middle;
    }
    rgb = at(low);
  }
  return `#${rgb.map(linearChannelToHex).join('')}`;
}

export function toneField(sources: Oklab[], isDark: boolean): string[] {
  const tone = isDark ? DARK_TONE : LIGHT_TONE;
  return sources.map((lab, index) =>
    oklchToHex(
      tone.lightness[index % tone.lightness.length],
      Math.min(chromaOf(lab) * tone.chromaScale, tone.chromaMax),
      hueOf(lab),
    ),
  );
}

/**
 * The extractor's clusters for a pixel buffer: the expensive part of both the
 * accent and the field, so callers that want both should cluster once.
 */
export function clusterArtworkPixels(pixels: ArrayLike<number>): WeightedColor[] {
  const histogram = buildHistogram(pixels);
  if (histogram.total <= 0) return [];
  return refineInOklab(histogram, quantizeWu(histogram));
}

export function fieldFromClusters(clusters: WeightedColor[], isDark: boolean): ArtworkField | null {
  const { sources, neutral } = pickFieldSources(clusters);
  if (sources.length === 0) return null;
  return { colors: toneField(sources, isDark), neutral };
}

/** RGBA_8888 pixels (any size) → the backdrop field, or null for an empty image. */
export function fieldFromPixels(pixels: ArrayLike<number>, isDark: boolean): ArtworkField | null {
  return fieldFromClusters(clusterArtworkPixels(pixels), isDark);
}
