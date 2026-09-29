import { ROAD_ACCESS_RANGE } from '../config';
import { CAPACITY } from '../sim/demand';
import { maxLevel } from '../sim/growth';
import { Simulation } from '../sim/simulation';
import { Road, Terrain, ZONE_NAMES, Zone } from '../sim/types';

export interface TileInfo {
  title: string;
  subtitle: string;
  accent: string;
  rows: Array<[label: string, value: string]>;
  hint?: string;
}

const BUILDING_NAMES: Record<Zone, readonly string[]> = {
  [Zone.None]: [],
  [Zone.Residential]: ['Empty lot', 'Small house', 'Family home', 'Apartment block', 'Residential tower'],
  [Zone.Commercial]: ['Empty lot', 'Corner shop', 'Mixed-use block', 'Office building', 'Skyscraper'],
  [Zone.Industrial]: ['Empty lot', 'Workshop', 'Warehouse', 'Factory', 'Heavy industry'],
};

export const ZONE_ACCENT: Record<Zone, string> = {
  [Zone.None]: '#8fb573',
  [Zone.Residential]: '#5fd35f',
  [Zone.Commercial]: '#4fa3ff',
  [Zone.Industrial]: '#ffc933',
};

/** Human-readable description of a tile for the inspect panel. */
export function describeTile(sim: Simulation, x: number, z: number): TileInfo {
  const { world } = sim;
  const i = world.idx(x, z);
  const coords: [string, string] = ['Location', `${x}, ${z}`];

  if (world.road[i] === Road.Highway) {
    return {
      title: 'Highway',
      subtitle: world.terrain[i] === Terrain.Water ? 'Bridge' : 'Link to the outside world',
      accent: '#ec963c',
      rows: [coords],
      hint: 'New residents, workers and goods arrive here. Connect your streets to it.',
    };
  }
  if (world.terrain[i] === Terrain.Water) {
    return { title: 'Water', subtitle: 'Not buildable', accent: '#3f8fc4', rows: [coords] };
  }
  if (world.road[i]) {
    const links = [0, 1, 2, 3].filter((k) => world.roadMask(x, z) & (1 << k)).length;
    const kind = links >= 3 ? 'Intersection' : links === 2 ? 'Street' : 'Dead end';
    const connected = world.roadConnected[i] === 1;
    return {
      title: 'Road',
      subtitle: kind,
      accent: '#9aa0a6',
      rows: [coords, ['Highway link', connected ? 'Connected' : 'Not connected']],
      hint: connected ? undefined : 'Extend this road to the highway so people can reach it.',
    };
  }

  const zone = world.zone[i] as Zone;
  if (zone === Zone.None) {
    const trees = world.trees[i];
    return {
      title: trees > 1 ? 'Forest' : trees === 1 ? 'Tree' : 'Open land',
      subtitle: 'Unzoned',
      accent: ZONE_ACCENT[Zone.None],
      rows: [coords],
      hint: 'Zone it, or build a road here.',
    };
  }

  const level = world.level[i];
  const building = BUILDING_NAMES[zone][level];
  const done = world.construction[i] === 0;
  const access = world.hasRoadAccess(i);
  const rows: Array<[string, string]> = [coords, ['Zone', ZONE_NAMES[zone]]];
  if (level > 0) {
    const capacity = CAPACITY[zone][level];
    rows.push(['Density', `Level ${level} of 4`]);
    rows.push([zone === Zone.Residential ? 'Residents' : 'Jobs', done ? capacity.toLocaleString('en-US') : '—']);
  }
  rows.push(['Road access', access ? `Yes (${world.roadDist[i]} tile${world.roadDist[i] === 1 ? '' : 's'})` : 'No']);
  if (level > 0 && access) rows.push(['Growth cap', `Level ${maxLevel(world, i, sim.stats)}`]);

  let subtitle = done ? (level > 0 ? 'Occupied' : 'Waiting for development') : 'Under construction';
  let hint: string | undefined;
  if (!access) {
    subtitle = level > 0 ? 'Declining' : 'Cannot develop';
    hint = world.isDisconnected(i)
      ? 'Its road does not connect to the highway, so nobody can get here.'
      : `Needs a road within ${ROAD_ACCESS_RANGE} tiles.`;
  } else if (level === 0) {
    hint = 'Develops when there is demand for this zone.';
  }

  return { title: building, subtitle, accent: ZONE_ACCENT[zone], rows, hint };
}
