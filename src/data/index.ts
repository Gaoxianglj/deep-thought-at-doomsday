import type { ContentDB } from '../engine/schema';
import { characters } from './characters';
import { config } from './config';
import { diary } from './diary';
import { difficulties } from './difficulties';
import { endings } from './endings';
import { events } from './events';
import { items } from './items';
import { locations } from './locations';
import { maps } from './maps';
import { scenes } from './scenes';
import { stats } from './stats';
import { statuses } from './statuses';
import { weathers } from './weathers';

export const contentDB: ContentDB = {
  config,
  stats,
  statuses,
  items,
  characters,
  difficulties,
  weathers,
  maps,
  locations,
  events,
  diary,
  endings,
  scenes,
};
