/**
 * Location source. Normally wraps navigator.geolocation; dev mode can swap in a
 * simulated source (fixed point, moving route, or a forced error).
 */

export type Simulation =
  | { kind: 'fixed'; lat: number; lon: number; accuracy?: number }
  | { kind: 'route'; points: [lat: number, lon: number][]; speedMps: number; accuracy?: number }
  | { kind: 'error'; code: 1 | 2 | 3; message: string };

type OnPosition = (pos: GeolocationPosition) => void;
type OnError = (err: GeolocationPositionError) => void;

const GEO_OPTIONS: PositionOptions = { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 };

let simulation: Simulation | null = null;

export function setSimulation(sim: Simulation | null) {
  simulation = sim;
}

export function isSimulating(): boolean {
  return simulation !== null;
}

/** Start watching position. Returns a function that stops watching. */
export function watchLocation(onPosition: OnPosition, onError: OnError): () => void {
  if (simulation) return watchSimulated(simulation, onPosition, onError);
  const id = navigator.geolocation.watchPosition(onPosition, onError, GEO_OPTIONS);
  return () => navigator.geolocation.clearWatch(id);
}

/** Small delay so loading states are still visible while testing. */
const FIRST_FIX_MS = 400;
const ROUTE_TICK_MS = 1000;

function watchSimulated(sim: Simulation, onPosition: OnPosition, onError: OnError): () => void {
  if (sim.kind === 'error') {
    const t = setTimeout(() => onError(fakeError(sim.code, sim.message)), FIRST_FIX_MS);
    return () => clearTimeout(t);
  }

  if (sim.kind === 'fixed') {
    const t = setTimeout(() => onPosition(fakePosition(sim.lat, sim.lon, sim.accuracy ?? 8)), FIRST_FIX_MS);
    return () => clearTimeout(t);
  }

  // Route: advance along the polyline at a constant speed, holding at the end.
  const startedAt = Date.now();
  const tick = () => {
    const travelled = ((Date.now() - startedAt) / 1000) * sim.speedMps;
    const [lat, lon] = pointAlong(sim.points, travelled);
    onPosition(fakePosition(lat, lon, sim.accuracy ?? 8));
  };
  const first = setTimeout(tick, FIRST_FIX_MS);
  const interval = setInterval(tick, ROUTE_TICK_MS);
  return () => {
    clearTimeout(first);
    clearInterval(interval);
  };
}

function pointAlong(points: [number, number][], metres: number): [number, number] {
  let remaining = metres;
  for (let i = 1; i < points.length; i++) {
    const [aLat, aLon] = points[i - 1];
    const [bLat, bLon] = points[i];
    const seg = distanceM(aLat, aLon, bLat, bLon);
    if (remaining <= seg) {
      const f = seg === 0 ? 0 : remaining / seg;
      return [aLat + (bLat - aLat) * f, aLon + (bLon - aLon) * f];
    }
    remaining -= seg;
  }
  return points[points.length - 1];
}

function fakePosition(latitude: number, longitude: number, accuracy: number): GeolocationPosition {
  const coords = {
    latitude,
    longitude,
    accuracy,
    altitude: null,
    altitudeAccuracy: null,
    heading: null,
    speed: null,
  };
  const timestamp = Date.now();
  return {
    coords: { ...coords, toJSON: () => coords },
    timestamp,
    toJSON: () => ({ coords, timestamp }),
  } as GeolocationPosition;
}

function fakeError(code: 1 | 2 | 3, message: string): GeolocationPositionError {
  return { code, message, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError;
}

export function distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
