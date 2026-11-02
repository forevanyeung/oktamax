import { describe, expect, it } from 'vite-plus/test';

import type { PageContext } from '@oktamax/shared';

import { routeTools } from '../guide';

const page = (url: string): PageContext => ({
  url,
  title: '',
  headings: [],
  text: '',
  objectIds: url.match(/\b(00[a-z]|0o[a-z])\w{17}\b/g) ?? [],
});

const GROUP = page('https://acme-admin.okta.com/admin/group/00g19d8c6cbWi2wAC698');
const APP = page('https://acme-admin.okta.com/admin/app/saml/instance/0oa19d897gxt2Scwa698/');
const USERS = page('https://acme-admin.okta.com/admin/users');

describe('routeTools', () => {
  it('offers the tools a question needs', () => {
    expect(routeTools('How many users are in this org?', USERS)).toContain('find_users');
    expect(routeTools("Which users haven't been activated yet?", USERS)).toContain('find_users');
    expect(routeTools("What's Grace Hopper's account status?")).toContain('user_details');
    expect(routeTools('Which groups is ada.lovelace@oktamax.example in?')[0]).toBe('user_groups');
    expect(routeTools('What groups do we have?')).toEqual(['find_groups']);
    expect(routeTools('Which apps use SAML?')).toContain('find_apps');
    expect(routeTools('What password policies are there?')).toEqual(['policies']);
    expect(routeTools('Take me to the Oktamax Contractors group')[0]).toBe('navigate');
  });

  it('goes by the page for "this" and "here"', () => {
    expect(routeTools('Who is in this group?', GROUP)[0]).toBe('group_members');
    expect(routeTools('How do users sign in to this app?', APP)[0]).toBe('app_details');
    expect(routeTools('Bring up today’s sign-ins to this app', APP)).toEqual(
      expect.arrayContaining(['open_in_api_console', 'sign_ins']),
    );
  });

  it('offers nothing for changes, which the assistant can’t make', () => {
    expect(routeTools('Deactivate Grace Hopper')).toEqual([]);
    expect(routeTools('Please reset Ada’s password')).toEqual([]);
  });

  it('offers at most three tools', () => {
    expect(routeTools('Show me sign-ins, groups, apps and policies for users', APP).length).toBe(3);
  });
});
