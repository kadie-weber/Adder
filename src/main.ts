import './style.css';
import { reverseGeocode, type Address } from './geocode';
import { distanceM, isSimulating, watchLocation } from './location';
import { devModeEnabled, mountDevPanel } from './dev';

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

let stopWatch: (() => void) | null = null;
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
  if (!isSimulating()) {
    if (!('geolocation' in navigator)) {
      return showError("Location isn't supported", 'This browser has no geolocation support.');
    }
    if (!window.isSecureContext) {
      return showError('Needs a secure connection', 'Location only works over HTTPS or on localhost.');
    }
  }

  stop();
  lastLookup = null;
  loadingText.textContent = 'Locating…';
  setState('loading', 'Locating');

  stopWatch = watchLocation(onPosition, onGeoError);
}

function stop() {
  stopWatch?.();
  stopWatch = null;
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
  addressEl.replaceChildren(
    ...addr.line1Parts.map((part) => {
      const line = document.createElement('span');
      line.className = 'address__line';
      line.textContent = part;
      return line;
    }),
  );
  // Grid addresses ("4100 South" / "3974 West") keep each line whole.
  addressEl.classList.toggle('address--lines', addr.line1Parts.length > 1);
  localityEl.textContent = addr.line2;
  updatedEl.textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  setState('result', 'Live'); // visible first so fitAddress can measure
  fitAddress();
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

const SIZES = ['l', 'm', 's', 'xs'] as const;

/** Shrink long addresses so they never overflow on narrow screens. */
function fitAddress() {
  if (!current) return;
  const len = Math.max(...current.line1Parts.map((l) => l.length));
  let i = len > 40 ? 3 : len > 28 ? 2 : len > 18 ? 1 : 0;
  addressEl.dataset.size = SIZES[i];
  // Unbreakable grid lines: step down until the widest one fits.
  while (i < SIZES.length - 1 && addressEl.scrollWidth > addressEl.clientWidth) {
    addressEl.dataset.size = SIZES[++i];
  }
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
function restart() {
  current = null;
  start();
}

$('refresh').addEventListener('click', restart);
copyBtn.addEventListener('click', copyAddress);
window.addEventListener('resize', fitAddress);

// Pause GPS when the tab is hidden; resume when visible.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (stopWatch) stop();
  } else if (current && !stopWatch) {
    stopWatch = watchLocation(onPosition, onGeoError);
  }
});

if (devModeEnabled()) mountDevPanel(restart);

// Skip the prompt screen if permission was already granted (or a location is simulated).
if (isSimulating()) start();
else navigator.permissions
  ?.query({ name: 'geolocation' })
  .then((p) => {
    if (p.state === 'granted') start();
  })
  .catch(() => {});

setState('idle', 'Idle');
