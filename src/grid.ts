/**
 * Salt Lake valley grid formatting.
 *
 * Salt Lake County numbers streets by distance from the grid origin at the
 * southeast corner of Temple Square (Main St & South Temple). OSM usually tags
 * these streets as just "4100 South" / "4800 West", so a raw house number +
 * road reads "3974 4100 South".
 *
 * Output is the north/south coordinate first, then east/west, with directions
 * spelled out, the way people say it locally: ["4100 South", "3974 West"].
 */

/** Main St (0 E/W) and South Temple (0 N/S). */
export const SL_GRID_ORIGIN = { lat: 40.76917, lon: -111.89106 };

const DIR: Record<string, Dir> = {
  north: 'North', south: 'South', east: 'East', west: 'West',
  n: 'North', s: 'South', e: 'East', w: 'West',
};
type Dir = 'North' | 'South' | 'East' | 'West';

// "4100 South", "4100 S", "West 4100 South", "W. 4100 S."
const GRID_ROAD = /^(?:(north|south|east|west|[nsew])\.?\s+)?(\d{1,5})\s+(north|south|east|west|[nsew])\.?$/i;

export interface GridContext {
  lat: number;
  lon: number;
  /** Only infer the house-number direction from coordinates inside the SL grid. */
  inSaltLakeGrid: boolean;
}

/**
 * Returns the grid address as display lines (one per coordinate), or null if
 * the road isn't a numbered grid street.
 */
export function formatGridAddress(
  road: string,
  houseNumber: string | undefined,
  ctx: GridContext,
): string[] | null {
  const m = GRID_ROAD.exec(road.trim());
  if (!m) return null;

  const prefix = m[1] ? DIR[m[1].toLowerCase()] : undefined;
  const axis = DIR[m[3].toLowerCase()];
  const street = `${m[2]} ${axis}`;

  if (!houseNumber) return [prefix ? `${prefix} ${street}` : street];

  // East–west streets ("… South"/"… North") are numbered east/west of Main St;
  // north–south streets ("… East"/"… West") are numbered north/south of South Temple.
  let houseDir = prefix;
  if (!houseDir && ctx.inSaltLakeGrid) {
    const eastWestStreet = axis === 'North' || axis === 'South';
    houseDir = eastWestStreet
      ? ctx.lon < SL_GRID_ORIGIN.lon ? 'West' : 'East'
      : ctx.lat < SL_GRID_ORIGIN.lat ? 'South' : 'North';
  }
  if (!houseDir) return [`${houseNumber} ${street}`];

  // Locals always say the north/south coordinate first, then east/west:
  // a house at 3974 West on 4100 South is "4100 South / 3974 West".
  const house = `${houseNumber} ${houseDir}`;
  const houseIsEastWest = houseDir === 'East' || houseDir === 'West';
  return houseIsEastWest ? [street, house] : [house, street];
}
