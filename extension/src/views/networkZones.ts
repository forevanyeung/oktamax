import { addActionsCell, findItems } from '../content/dom';
import {
  checkbox,
  inline,
  section,
  select,
  tags,
  text,
  textarea,
  type Field,
  type FormView,
} from '../form/schema';
import { getAll } from '../okta/api';
import type { NetworkZone } from '../okta/types';
import type { ViewProvider } from './types';

type Location = { country: string; region?: string | null };
type IncludeExclude<T> = { include?: T[]; exclude?: T[] };

/** Okta's dialog titles: "Edit IP Zone", "Edit Dynamic Zone", ... */
const ZONE_TYPES: Record<string, string> = {
  IP: 'IP Zone',
  DYNAMIC: 'Dynamic Zone',
  DYNAMIC_V2: 'Enhanced Dynamic Zone',
};

/** Okta's "IP type" dropdown; `null` in the API is "Any". */
const PROXY_TYPES = {
  '': 'Any',
  Any: 'Any proxy',
  Tor: 'Tor anonymizer proxy',
  TorAnonymizer: 'Tor anonymizer proxy',
  NotTorAnonymizer: 'Not Tor anonymizer proxy',
};

const IP_SERVICE_CATEGORIES: Record<string, string> = {
  ALL_ANONYMIZERS: 'All anonymizers',
  ALL_IP_SERVICES: 'All IP services',
};

const BLOCK_HINT = 'WARNING: Selecting this option will prevent matching IPs from accessing Okta.';

/** ISO 3166-2 names Okta shows in the "State/Region" dropdown (other countries fall back to the code). */
const REGIONS: Record<string, string> = {
  'US-AL': 'Alabama',
  'US-AK': 'Alaska',
  'US-AZ': 'Arizona',
  'US-AR': 'Arkansas',
  'US-CA': 'California',
  'US-CO': 'Colorado',
  'US-CT': 'Connecticut',
  'US-DE': 'Delaware',
  'US-DC': 'District of Columbia',
  'US-FL': 'Florida',
  'US-GA': 'Georgia',
  'US-HI': 'Hawaii',
  'US-ID': 'Idaho',
  'US-IL': 'Illinois',
  'US-IN': 'Indiana',
  'US-IA': 'Iowa',
  'US-KS': 'Kansas',
  'US-KY': 'Kentucky',
  'US-LA': 'Louisiana',
  'US-ME': 'Maine',
  'US-MD': 'Maryland',
  'US-MA': 'Massachusetts',
  'US-MI': 'Michigan',
  'US-MN': 'Minnesota',
  'US-MS': 'Mississippi',
  'US-MO': 'Missouri',
  'US-MT': 'Montana',
  'US-NE': 'Nebraska',
  'US-NV': 'Nevada',
  'US-NH': 'New Hampshire',
  'US-NJ': 'New Jersey',
  'US-NM': 'New Mexico',
  'US-NY': 'New York',
  'US-NC': 'North Carolina',
  'US-ND': 'North Dakota',
  'US-OH': 'Ohio',
  'US-OK': 'Oklahoma',
  'US-OR': 'Oregon',
  'US-PA': 'Pennsylvania',
  'US-RI': 'Rhode Island',
  'US-SC': 'South Carolina',
  'US-SD': 'South Dakota',
  'US-TN': 'Tennessee',
  'US-TX': 'Texas',
  'US-UT': 'Utah',
  'US-VT': 'Vermont',
  'US-VA': 'Virginia',
  'US-WA': 'Washington',
  'US-WV': 'West Virginia',
  'US-WI': 'Wisconsin',
  'US-WY': 'Wyoming',
  'CA-AB': 'Alberta',
  'CA-BC': 'British Columbia',
  'CA-MB': 'Manitoba',
  'CA-NB': 'New Brunswick',
  'CA-NL': 'Newfoundland and Labrador',
  'CA-NS': 'Nova Scotia',
  'CA-NT': 'Northwest Territories',
  'CA-NU': 'Nunavut',
  'CA-ON': 'Ontario',
  'CA-PE': 'Prince Edward Island',
  'CA-QC': 'Quebec',
  'CA-SK': 'Saskatchewan',
  'CA-YT': 'Yukon',
};

const countryNames = new Intl.DisplayNames(['en'], { type: 'region' });
const countryName = (code: string) => {
  try {
    return countryNames.of(code) ?? code;
  } catch {
    return code;
  }
};

const addresses = (list: NetworkZone['gateways']) => (list ?? []).map((g) => g.value);

/** Legacy dynamic zones use plain lists; enhanced dynamic zones use { include, exclude }. */
const split = <T>(value: T[] | IncludeExclude<T> | null | undefined): IncludeExclude<T> =>
  Array.isArray(value) ? { include: value } : (value ?? {});

/** Okta draws each location as a [Country] [State/Region (Optional)] row under one label. */
const locationRows = (label: string, locations: Location[] | undefined): Field[] => {
  const rows: Array<Location | undefined> = locations?.length ? locations : [undefined];
  return rows.map((l, i) =>
    inline(i === 0 ? label : '', [
      select('Country', l?.country ?? '', [
        { value: '', label: 'Country' },
        ...(l ? [{ value: l.country, label: countryName(l.country) }] : []),
      ]),
      select('State/Region', l?.region ?? '', [
        { value: '', label: 'State/Region (Optional)' },
        ...(l?.region ? [{ value: l.region, label: REGIONS[l.region] ?? l.region }] : []),
      ]),
    ]),
  );
};

/** Security › Networks › "Edit IP Zone" / "Edit Dynamic Zone" / "Edit Enhanced Dynamic Zone" */
export function networkZoneView(zone: NetworkZone): FormView {
  const locations = split(zone.locations);
  const asns = split(zone.asns);
  const categories = split(zone.ipServiceCategories);
  const category = (c: string) => IP_SERVICE_CATEGORIES[c] ?? c;

  const details: Array<Field | false> =
    zone.type === 'IP'
      ? [
          textarea('Gateway IPs', addresses(zone.gateways)),
          textarea('Trusted proxy IPs', addresses(zone.proxies)),
        ]
      : zone.type === 'DYNAMIC_V2'
        ? [
            tags('Include IP service categories', categories.include?.map(category)),
            tags('Exclude IP service categories', categories.exclude?.map(category)),
            ...locationRows('Include locations', locations.include),
            ...locationRows('Exclude locations', locations.exclude),
            textarea('Include ASNs', asns.include),
            textarea('Exclude ASNs', asns.exclude),
          ]
        : [
            select('IP type', zone.proxyType ?? '', PROXY_TYPES),
            ...locationRows('Locations', locations.include),
            textarea('ISP ASNs', asns.include),
          ];

  return {
    sections: [
      section(undefined, [
        text('Zone name', zone.name),
        checkbox(
          'Block access from IPs matching conditions listed in this zone',
          zone.usage === 'BLOCKLIST',
          BLOCK_HINT,
        ),
      ]),
      section(undefined, details),
    ],
    raw: zone,
  };
}

export const zoneTitle = (zone: Pick<NetworkZone, 'type'>) =>
  `View ${ZONE_TYPES[zone.type] ?? 'Zone'}`;

export const networkZonesProvider: ViewProvider = {
  name: 'Network zones',
  matches: (url) => url.pathname.startsWith('/admin/access/networks'),
  async findTargets() {
    const zones = await getAll<NetworkZone>('/api/v1/zones?limit=200');
    return findItems(zones, (z) => z.name).map(({ item, anchor, scope }) => ({
      key: `zone:${item.id}`,
      title: zoneTitle(item),
      anchor,
      scope,
      actions: scope.querySelector('.zone-actions'),
      addActions: () => addActionsCell(scope),
      load: async () => networkZoneView(item),
    }));
  },
};
