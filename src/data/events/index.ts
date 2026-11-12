import { cityCommonEvents } from './city-common';
import { kiminaiEvents } from './kiminai';
import { rescueEvents } from './rescue';
import { selfRescueEvents } from './self-rescue';

export const events = [...kiminaiEvents, ...rescueEvents, ...selfRescueEvents, ...cityCommonEvents];
