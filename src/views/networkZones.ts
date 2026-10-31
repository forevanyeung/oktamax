import { findItems } from '../content/dom';
import { checkbox, section, select, tags, text, textarea, type FormView } from '../form/schema';
import { getAll } from '../okta/api';
import type { NetworkZone } from '../okta/types';
import type { ViewProvider } from './types';

type Location = { country: string; region?: string | null };
type IncludeExclude<T> = { include?: T[]; exclude?: T[] };

const ZONE_TYPES = { IP: 'IP Zone', DYNAMIC: 'Dynamic Zone', DYNAMIC_V2: 'Enhanced Dynamic Zone' };

const PROXY_TYPES = {
  '': 'Any',
  Any: 'Block all anonymizers',
  TorAnonymizer: 'Tor anonymizer proxy',
  NotTorAnonymizer: 'Not Tor anonymizer proxy',
};

const IP_SERVICE_CATEGORIES: Record<string, string> = {
  ALL_ANONYMIZERS: 'All anonymizers',
  ALL_IP_SERVICES: 'All IP services',
};

const addresses = (list: NetworkZone['gateways']) => (list ?? []).map((g) => g.value);
const location = (l: Location) => (l.region ? `${l.country} - ${l.region}` : l.country);

/** Legacy dynamic zones use plain lists; enhanced dynamic zones use { include, exclude }. */
const split = <T>(value: T[] | IncludeExclude<T> | null | undefined): IncludeExclude<T> =>
  Array.isArray(value) ? { include: value } : (value ?? {});

/** Security › Networks › "Edit Zone" */
export function networkZoneView(zone: NetworkZone): FormView {
  const locations = split(zone.locations);
  const asns = split(zone.asns);
  const categories = split(zone.ipServiceCategories);

  return {
    sections: [
      section(undefined, [
        select('Zone type', zone.type, ZONE_TYPES),
        text('Zone name', zone.name),
        checkbox(
          'Block access from IPs matching conditions listed in this zone',
          zone.usage === 'BLOCKLIST',
        ),
      ]),
      zone.type === 'IP'
        ? section(undefined, [
            textarea('Gateway IPs', addresses(zone.gateways)),
            textarea('Trusted Proxy IPs', addresses(zone.proxies)),
          ])
        : section(undefined, [
            zone.type === 'DYNAMIC' && select('IP Type', zone.proxyType ?? '', PROXY_TYPES),
            zone.type === 'DYNAMIC_V2' &&
              tags(
                'Include IP service categories',
                categories.include?.map((c) => IP_SERVICE_CATEGORIES[c] ?? c),
              ),
            zone.type === 'DYNAMIC_V2' &&
              tags(
                'Exclude IP service categories',
                categories.exclude?.map((c) => IP_SERVICE_CATEGORIES[c] ?? c),
              ),
            tags(
              zone.type === 'DYNAMIC_V2' ? 'Include locations' : 'Locations',
              locations.include?.map(location),
            ),
            zone.type === 'DYNAMIC_V2' &&
              tags('Exclude locations', locations.exclude?.map(location)),
            tags(zone.type === 'DYNAMIC_V2' ? 'Include ASNs' : 'ISP ASNs', asns.include),
            zone.type === 'DYNAMIC_V2' && tags('Exclude ASNs', asns.exclude),
          ]),
    ],
    raw: zone,
  };
}

export const networkZonesProvider: ViewProvider = {
  name: 'Network zones',
  matches: (url) => url.pathname.startsWith('/admin/access/networks'),
  async findTargets() {
    const zones = await getAll<NetworkZone>('/api/v1/zones?limit=200');
    return findItems(zones, (z) => z.name).map(({ item, anchor, scope }) => ({
      key: `zone:${item.id}`,
      title: 'View Zone',
      anchor,
      scope,
      actions: scope.querySelector('.zone-actions'),
      load: async () => networkZoneView(item),
    }));
  },
};
