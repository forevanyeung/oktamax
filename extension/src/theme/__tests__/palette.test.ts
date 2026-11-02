import { describe, expect, it } from 'vite-plus/test';

import { DARK, darkColor, darkenValue, parseColor } from '../palette';

const lightness = (color: string) => {
  const [r, g, b] = parseColor(color)!;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};

describe('dark palette', () => {
  it('parses the forms the CSSOM serializes', () => {
    expect(parseColor('#fff')).toEqual([255, 255, 255, 1]);
    expect(parseColor('rgba(39, 39, 39, 0.75)')).toEqual([39, 39, 39, 0.75]);
    expect(parseColor('rgb(76 100 225 / 50%)')).toEqual([76, 100, 225, 0.5]);
    expect(parseColor('white')).toEqual([255, 255, 255, 1]);
    expect(parseColor('var(--x)')).toBeUndefined();
  });

  it('maps Okta tokens to their dark equivalents', () => {
    expect(darkColor('rgb(255, 255, 255)', 'background')).toBe(DARK.surface);
    expect(darkColor('#272727', 'text')).toBe(DARK.text);
    expect(darkColor('#6e6e6e', 'text')).toBe(DARK.muted);
    expect(darkColor('#4c64e1', 'text')).toBe(DARK.link);
    expect(darkColor('#cbcbcb', 'border')).toBe(DARK.borderStrong);
  });

  it('keeps alpha and skips transparent', () => {
    expect(darkColor('rgba(255, 255, 255, 0.5)', 'background')).toMatch(/^rgba\(.*, 0\.5\)$/);
    expect(darkColor('rgba(0, 0, 0, 0)', 'background')).toBeUndefined();
  });

  it('turns light backgrounds dark and dark text light', () => {
    for (const color of ['#f9f9f9', '#e5e5e5', '#d0d0d0']) {
      expect(lightness(darkColor(color, 'background')!)).toBeLessThan(0.3);
    }
    for (const color of ['#111111', '#444444', '#5a5a5a']) {
      expect(lightness(darkColor(color, 'text')!)).toBeGreaterThan(0.55);
    }
  });

  it('keeps hues: brand fills stay blue, pale tints stay tinted', () => {
    const [r, g, b] = parseColor(darkColor('#4c64e1', 'background')!)!;
    expect(b).toBeGreaterThan(r + 80);
    expect(b).toBeGreaterThan(g + 60);
    const [tr, tg, tb] = parseColor(darkColor('#defae7', 'background')!)!;
    expect(tg).toBeGreaterThan(tr);
    expect(tg).toBeGreaterThan(tb);
    expect(lightness(toHex(tr, tg, tb))).toBeLessThan(0.3);
  });

  it('rewrites every color in shadows and gradients', () => {
    expect(darkenValue('rgba(39, 39, 39, 0.2) 0px 6px 24px 0px', 'shadow')).toBe(
      'rgba(0, 0, 0, 0.4) 0px 6px 24px 0px',
    );
    expect(darkenValue('linear-gradient(#ffffff, #f4f4f4)', 'background')).toBe(
      `linear-gradient(${DARK.surface}, ${DARK.raised})`,
    );
    expect(darkenValue('var(--x)', 'text')).toBe('var(--x)');
  });
});

const toHex = (...c: number[]) =>
  '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
