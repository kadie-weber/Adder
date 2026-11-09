import './style.css';
import { reverseGeocode, type Address } from './geocode';

type State = 'idle' | 'loading' | 'result' | 'error';

/** Only re-geocode after moving this far (meters)… */
const MIN_MOVE_M = 15;
/** …and no more often than this (Nominatim policy: max 1 req/s). */
const MIN_INTERVAL_MS = 5000;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const stage = $('stage');
const statusEl = $('status');
const loadingText = $('loading-text');
const addressEl = $('address');
const localityEl = $('locality');
const accuracyEl = $('accuracy');
const coordsEl = $('coords');
const updatedEl = $('updated');
const errorTitle = $('error-title');
const errorDetail = $('error-detail');
const copyBtn = $<HTMLButtonElement>('copy');

let watchId: number | null = null;
let lastLookup: { lat: number; lon: number; at: number } | null = null;
let current: Address | null = null;
let inflight: AbortController | null = null;
let pending: GeolocationPosition | null = null;
let pendingTimer: number | undefined;

function setState(state: State, status?: string) {
  stage.dataset.state = state;
  if (status) statusEl.textContent = status;
  statusEl.dataset.live = String(state === 'result');
}

function start() {
  if (!('geolocation' in navigator)) {
    return showError("Location isn't supported", 'This browser has no geolocation support.');
  }
  if (!window.isSecureContext) {
    return showError('Needs a secure connection', 'Location only works over HTTPS or on localhost.');
  }

  stop();
  lastLookup = null;
  loadingText.textContent = 'Locating…';
  setState('loading', 'Locating');

  watchId = navigator.geolocation.watchPosition(onPosition, onGeoError, {
    enableHighAccuracy: true,
    maximumAge: 5000,
    timeout: 20000,
  });
}

function stop() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  inflight?.abort();
  clearTimeout(pendingTimer);
  pending = null;
}

function onPosition(pos: GeolocationPosition) {
  const { latitude: lat, longitude: lon, accuracy } = pos.coords;
  accuracyEl.textContent = `±${Math.round(accuracy)} m`;
  coordsEl.textContent = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;

  if (lastLookup) {
    const moved = distanceM(lastLookup.lat, lastLookup.lon, lat, lon);
    if (moved < MIN_MOVE_M) return;
    const wait = MIN_INTERVAL_MS - (Date.now() - lastLookup.at);
    if (wait > 0) {
      // Throttle: keep only the latest fix and look it up when allowed.
      pending = pos;
      clearTimeout(pendingTimer);
      pendingTimer = window.setTimeout(() => {
        if (pending) lookup(pending);
      }, wait);
      return;
    }
  }
  lookup(pos);
}

async function lookup(pos: GeolocationPosition) {
  pending = null;
  const { latitude: lat, longitude: lon } = pos.coords;
  lastLookup = { lat, lon, at: Date.now() };

  inflight?.abort();
  const ctrl = (inflight = new AbortController());

  if (!current) {
    loadingText.textContent = 'Finding address…';
  } else {
    statusEl.textContent = 'Updating';
  }

  try {
    const addr = await reverseGeocode(lat, lon, ctrl.signal);
    if (ctrl.signal.aborted) return;
    render(addr);
  } catch (err) {
    if (ctrl.signal.aborted) return;
    // If we already have an address, keep showing it rather than blanking the screen.
    if (current) {
      statusEl.textContent = 'Offline';
      return;
    }
    showError("Couldn't look up an address", err instanceof Error ? err.message : String(err));
  }
}

function render(addr: Address) {
  const changed = current?.full !== addr.full;
  current = addr;
  addressEl.textContent = addr.line1;
  localityEl.textContent = addr.line2;
  updatedEl.textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  fitAddress();
  setState('result', 'Live');
  if (changed) {
    addressEl.classList.remove('enter');
    void addressEl.offsetWidth; // restart animation
    addressEl.classList.add('enter');
  }
}

function onGeoError(err: GeolocationPositionError) {
  if (current && err.code !== err.PERMISSION_DENIED) {
    statusEl.textContent = 'Signal lost';
    return;
  }
  stop();
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return showError(
        'Location access is off',
        'Allow location for this site in your browser settings, then try again.',
      );
    case err.POSITION_UNAVAILABLE:
      return showError("Can't find your position", 'Try moving somewhere with a clearer view of the sky.');
    case err.TIMEOUT:
      return showError('Location timed out', 'Getting a fix took too long. Try again.');
    default:
      return showError('Something went wrong', err.message);
  }
}

function showError(title: string, detail: string) {
  errorTitle.textContent = title;
  errorDetail.textContent = detail;
  setState('error', 'Error');
}

/** Shrink very long addresses so they never overflow on narrow screens. */
function fitAddress() {
  const len = addressEl.textContent?.length ?? 0;
  addressEl.dataset.size = len > 40 ? 'xs' : len > 28 ? 's' : len > 18 ? 'm' : 'l';
}

function distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function copyAddress() {
  if (!current) return;
  try {
    await navigator.clipboard.writeText(current.full);
    copyBtn.textContent = 'Copied';
  } catch {
    copyBtn.textContent = 'Copy failed';
  }
  setTimeout(() => (copyBtn.textContent = 'Copy address'), 1600);
}

$('start').addEventListener('click', start);
$('retry').addEventListener('click', start);
$('refresh').addEventListener('click', () => {
  current = null;
  start();
});
copyBtn.addEventListener('click', copyAddress);

// Pause GPS when the tab is hidden; resume when visible.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (watchId !== null) stop();
  } else if (current) {
    watchId = navigator.geolocation.watchPosition(onPosition, onGeoError, {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 20000,
    });
  }
});

// Skip the prompt screen if permission was already granted.
navigator.permissions
  ?.query({ name: 'geolocation' })
  .then((p) => {
    if (p.state === 'granted') start();
  })
  .catch(() => {});

setState('idle', 'Idle');
