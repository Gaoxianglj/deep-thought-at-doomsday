import type { EventDef } from '../../engine/schema';
import { characterEvents } from './characters';
import { cityCommonEvents } from './city-common';
import { itemEvents } from './items';
import { kiminaiEvents } from './kiminai';
import { rescueEvents } from './rescue';
import { selfRescueEvents } from './self-rescue';

export const events: EventDef[] = [
  ...kiminaiEvents,
  ...characterEvents,
  ...rescueEvents,
  ...selfRescueEvents,
  ...itemEvents,
  ...cityCommonEvents,
];
