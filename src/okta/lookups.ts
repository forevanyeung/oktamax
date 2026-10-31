/**
 * Okta stores references as IDs; edit dialogs show names. These helpers turn
 * IDs into the labels Okta shows, falling back to the ID if a lookup fails
 * (e.g. the read-only role can't see that object).
 */
import { get, getAll } from './api';
import type { Group, NetworkZone, User } from './types';

const settle = async <T>(ids: string[] | undefined, lookup: (id: string) => Promise<T>) =>
  Promise.all((ids ?? []).map((id) => lookup(id).catch(() => id)));

export const groupNames = (ids: string[] | undefined) =>
  settle(ids, async (id) => (await get<Group>(`/api/v1/groups/${id}`)).profile.name);

export const userLogins = (ids: string[] | undefined) =>
  settle(ids, async (id) => {
    const { profile } = await get<User>(`/api/v1/users/${id}`);
    return `${profile.firstName ?? ''} ${profile.lastName ?? ''} (${profile.login})`.trim();
  });

export const zoneNames = (ids: string[] | undefined) =>
  settle(ids, async (id) => {
    if (id === 'ALL_ZONES') return 'All zones';
    if (id === 'DEFAULT_ENHANCED_DYNAMIC_ZONE') return 'Default enhanced dynamic zone';
    const zones = await getAll<NetworkZone>('/api/v1/zones?limit=200');
    return zones.find((z) => z.id === id)?.name ?? id;
  });

export const userTypeNames = (ids: string[] | undefined) =>
  settle(ids, async (id) => {
    const types = await get<Array<{ id: string; displayName: string }>>('/api/v1/meta/types/user');
    return types.find((t) => t.id === id)?.displayName ?? id;
  });

export const deviceAssuranceNames = (ids: string[] | undefined) =>
  settle(ids, async (id) => (await get<{ name: string }>(`/api/v1/device-assurances/${id}`)).name);
