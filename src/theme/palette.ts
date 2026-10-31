/**
 * The dark palette, and how the console's light colors map onto it.
 *
 * Okta's console uses a small set of neutrals plus its brand blue (Odyssey).
 * The colors it uses most have hand-picked dark equivalents (`TOKENS`); any
 * other color is converted by role in OKLCH: backgrounds and borders flip
 * lightness, text gets light, and hues stay the same, so the console keeps
 * its look with a dark mood.
 */
export const DARK = {
  canvas: '#131417',
  surface: '#1c1d21',
  raised: '#26272c',
  hover: '#2c2d33',
  border: '#34353c',
  borderStrong: '#4a4c55',
  text: '#e6e6ea',
  heading: '#f3f3f6',
  muted: '#a1a2ab',
  disabled: '#6c6d76',
  primary: '#4c64e1',
  link: '#8b9cf6',
  primaryTint: '#232a4d',
  focus: '#3e4d9e',
  errorBg: '#3a1a1c',
  errorText: '#ff9c94',
} as const;

export type Role = 'background' | 'text' | 'border' | 'shadow';

/** Exact light → dark mappings for the console's most used colors. */
const TOKENS: Record<Exclude<Role, 'shadow'>, Record<string, string>> = {
  background: {
    '#ffffff': DARK.surface,
    '#fafafa': DARK.surface,
    '#f4f4f4': DARK.raised,
    '#f4f4f5': DARK.raised,
    '#f5f5f6': DARK.raised,
    '#ededed': DARK.hover,
    '#e1e1e1': '#303137',
    '#d9d9d9': '#37383f',
    '#f2f3fd': DARK.primaryTint,
    '#ebf1fc': '#1f2a44',
  },
  text: {
    '#000000': DARK.heading,
    '#1d1d21': DARK.heading,
    '#272727': DARK.text,
    '#333333': DARK.text,
    '#6e6e6e': DARK.muted,
    '#6e6e78': DARK.muted,
    '#4c64e1': DARK.link,
    '#546be7': DARK.link,
    '#1662dd': DARK.link,
  },
  border: {
    '#cbcbcb': DARK.borderStrong,
    '#d7d7dc': DARK.borderStrong,
    '#e1e1e1': DARK.border,
    '#ededed': DARK.border,
  },
};

type Rgba = [r: number, g: number, b: number, a: number];
type Oklch = [l: number, c: number, h: number];

const NAMED: Record<string, Rgba> = {
  white: [255, 255, 255, 1],
  black: [0, 0, 0, 1],
  gray: [128, 128, 128, 1],
  grey: [128, 128, 128, 1],
  silver: [192, 192, 192, 1],
  red: [255, 0, 0, 1],
  blue: [0, 0, 255, 1],
};

/** Colors as the CSSOM serializes them: rgb()/rgba(), hex, or a few names. */
const COLOR = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|\b(?:white|black|gr[ae]y|silver|red|blue)\b/gi;

export function parseColor(value: string): Rgba | undefined {
  const v = value.trim().toLowerCase();
  if (NAMED[v]) return NAMED[v];
  if (v.startsWith('#')) {
    let hex = v.slice(1);
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join('');
    if (hex.length !== 6 && hex.length !== 8) return undefined;
    const n = (i: number) => parseInt(hex.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), hex.length === 8 ? n(6) / 255 : 1];
  }
  const parts = v
    .match(/^rgba?\(([^)]*)\)$/)?.[1]
    ?.split(/[\s,/]+/)
    .filter(Boolean);
  if (!parts || parts.length < 3) return undefined;
  const channel = (p: string) => (p.endsWith('%') ? (parseFloat(p) * 255) / 100 : parseFloat(p));
  const alpha =
    parts[3] === undefined
      ? 1
      : parts[3].endsWith('%')
        ? parseFloat(parts[3]) / 100
        : parseFloat(parts[3]);
  const rgba: Rgba = [channel(parts[0]!), channel(parts[1]!), channel(parts[2]!), alpha];
  return rgba.some(Number.isNaN) ? undefined : rgba;
}

const toHex = ([r, g, b]: Rgba) =>
  '#' + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');

const format = (rgba: Rgba) => {
  const [r, g, b, a] = rgba.map((c, i) => (i < 3 ? Math.round(c) : +c.toFixed(3)));
  return a === 1 ? toHex(rgba) : `rgba(${r}, ${g}, ${b}, ${a})`;
};

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

// OKLab/OKLCH conversions (Björn Ottosson).
const toLinear = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) =>
  255 * clamp(c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055, 0, 1);

function toOklch([r8, g8, b8]: Rgba): Oklch {
  const [r, g, b] = [r8, g8, b8].map(toLinear) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), Math.atan2(B, A)];
}

function oklchToLinear([L, C, h]: Oklch): [number, number, number] {
  const A = C * Math.cos(h);
  const B = C * Math.sin(h);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** Back to sRGB, lowering chroma until the color fits the gamut. */
function fromOklch([L, C, h]: Oklch, alpha: number): Rgba {
  const inGamut = (c: number) => oklchToLinear([L, c, h]).every((v) => v >= -1e-4 && v <= 1 + 1e-4);
  let lo = 0;
  let hi = C;
  if (!inGamut(C)) {
    for (let i = 0; i < 16; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(mid)) lo = mid;
      else hi = mid;
    }
    C = lo;
  }
  const [r, g, b] = oklchToLinear([L, C, h]).map(fromLinear) as [number, number, number];
  return [r, g, b, alpha];
}

/** Neutral enough to treat as gray (Okta's grays have a slight blue tint at most). */
const NEUTRAL_CHROMA = 0.04;

function convert(rgba: Rgba, role: Role): Rgba {
  const alpha = rgba[3];
  if (role === 'shadow') return [0, 0, 0, Math.min(1, alpha * 2)];

  const token = TOKENS[role][toHex(rgba)];
  if (token) return [...parseColor(token)!.slice(0, 3), alpha] as Rgba;

  const [L, C, h] = toOklch(rgba);
  const neutral = C < NEUTRAL_CHROMA;
  let l = L;
  let c = C;
  if (role === 'background') {
    if (alpha < 1 && L < 0.45) l = 0.08; // scrims and dark overlays
    else if (neutral) l = L >= 0.45 ? 0.22 + (1 - L) * 0.78 : 0.27 + L * 0.3;
    else if (L > 0.85) [l, c] = [0.28, Math.min(C * 1.5, 0.07)]; // pale tints: status chips, selection
    else l = clamp(L, 0.45, 0.65); // brand-colored fills keep their color
  } else if (role === 'text') {
    if (neutral) l = L >= 0.8 ? L : 0.96 - 0.45 * L;
    else l = clamp(L, 0.72, 0.88);
  } else if (neutral) {
    l = L >= 0.45 ? 0.2 + (1 - L) * 0.9 : 0.6;
  } else {
    l = clamp(L, 0.6, 0.8);
  }
  return fromOklch([l, c, h], alpha);
}

const cache = new Map<string, string>();

/** The dark equivalent of one light color, or `undefined` if it isn't a color. */
export function darkColor(value: string, role: Role): string | undefined {
  const key = `${role}|${value}`;
  let out = cache.get(key);
  if (out === undefined) {
    const rgba = parseColor(value);
    if (!rgba || rgba[3] === 0) return undefined;
    out = format(convert(rgba, role));
    cache.set(key, out);
  }
  return out;
}

/** Rewrites every color inside a CSS value (shadows, gradients, shorthands). */
export const darkenValue = (value: string, role: Role) =>
  value.replace(COLOR, (color) => darkColor(color, role) ?? color);
