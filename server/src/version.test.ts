import { describe, expect, it } from 'vite-plus/test';

import { compareVersions, isAtLeast, UNVERSIONED } from '@oktamax/shared/version';

describe('compareVersions', () => {
  it('orders by major, then minor, then patch, numerically', () => {
    expect(compareVersions('1.0.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0);
    expect(compareVersions('0.1.2', '0.1.10')).toBeLessThan(0);
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0);
  });
});

describe('isAtLeast', () => {
  it('compares against the minimum', () => {
    expect(isAtLeast('0.2.0', '0.2.0')).toBe(true);
    expect(isAtLeast('0.1.9', '0.2.0')).toBe(false);
  });

  it('takes a missing or malformed version as the one from before versions were reported', () => {
    expect(isAtLeast(undefined, UNVERSIONED)).toBe(true);
    expect(isAtLeast('', '0.2.0')).toBe(false);
    expect(isAtLeast('garbage', UNVERSIONED)).toBe(true);
  });
});
