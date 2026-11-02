import { describe, expect, it } from 'vite-plus/test';

import { nextLink } from '../../okta/api';
import { humanize, isoDuration, minutesToText } from '../format';

describe('format', () => {
  it('humanizes camelCase and snake_case keys', () => {
    expect(humanize('maxSessionIdleMinutes')).toBe('Max session idle minutes');
    expect(humanize('post_logout_redirect_uris')).toBe('Post logout redirect uris');
  });

  it('formats durations the way Okta shows them', () => {
    expect(isoDuration('PT2H')).toBe('2 hours');
    expect(isoDuration('PT0S')).toBe('0 minutes');
    expect(isoDuration('P1D')).toBe('1 day');
    expect(isoDuration('PT90M')).toBe('90 minutes');
    expect(minutesToText(2880)).toBe('2 days');
  });

  it('reads the next page from a Link header', () => {
    const header =
      '<https://acme.okta.com/api/v1/zones?limit=2>; rel="self", <https://acme.okta.com/api/v1/zones?after=abc&limit=2>; rel="next"';
    expect(nextLink(header)).toBe('https://acme.okta.com/api/v1/zones?after=abc&limit=2');
    expect(nextLink(null)).toBeUndefined();
  });
});
