import { appsProvider } from './apps';
import { authenticatorsProvider } from './authenticators';
import { groupRulesProvider } from './groupRules';
import { networkZonesProvider } from './networkZones';
import { policiesProvider } from './policies';
import type { ViewProvider } from './types';

/** Every area of the admin console this extension adds read-only views to. */
export const providers: ViewProvider[] = [
  appsProvider,
  groupRulesProvider,
  networkZonesProvider,
  policiesProvider,
  authenticatorsProvider,
];
