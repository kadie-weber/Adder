import './style.css';
import { reverseGeocode, type Address } from './geocode';
import { distanceM, isSimulating, watchLocation } from './location';
import { devModeEnabled, mountDevPanel } from './dev';

type State = 'idle' | 'loading' | 'result' | 'error';

/** Only re-geocode after moving this far (meters)… */
const MIN_MOVE_M = 15;
/** …and no more often than this (Nominatim policy: max 1 req/s). */
const MIN_INTERVAL_MS = 5000;
/** Show "Live" while the last GPS fix is newer than this (seconds). */
const LIVE_FOR_S = 20;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const stage = $('stage');
const statusEl = $('status');
const loadingText = $('loading-text');
const addressEl = $('address');
const localityEl = $('locality');
const accuracyEl = $('accuracy');
const coordsEl = $('coords');
const coordsLabel = $('coords-label');
const errorTitle = $('error-title');
const errorDetail = $('error-detail');
const copyBtn = $<HTMLButtonElement>('copy');

let stopWatch: (() => void) | null = null;
let lastLookup: { lat: number; lon: number; at: number } | null = null;
let current: Address | null = null;
let inflight: AbortController | null = null;
let pending: GeolocationPosition | null = null;
let pendingTimer: number | undefined;
let lastCoords: string | null = null;
/** When the last position fix arrived. */
let lastFixAt = 0;
/** Temporary status ("Updating", "Offline", …) that overrides freshness while set. */
let statusNote: string | null = null;
let freshnessTimer: number | undefined;

function setState(state: State, status?: string) {
  stage.dataset.state = state;
  keepScreenOn(state === 'loading' || state === 'result');
  clearInterval(freshnessTimer);
  if (state === 'result') {
    renderStatus();
    freshnessTimer = window.setInterval(renderStatus, 1000);
  } else {
    if (status) statusEl.textContent = status;
    statusEl.dataset.live = 'false';
  }
}

/**
 * Screen Wake Lock: keep the display on while we're locating or showing an address.
 * The browser drops the lock whenever the page is hidden, so it's re-requested on return.
 */
let wakeLock: WakeLockSentinel | null = null;
let wantWakeLock = false;
let wakeLockRequesting = false;

async function keepScreenOn(on: boolean) {
  wantWakeLock = on;
  if (!on) {
    const lock = wakeLock;
    wakeLock = null;
    await lock?.release().catch(() => {});
    return;
  }
  if (wakeLock || wakeLockRequesting || document.hidden || !('wakeLock' in navigator)) return;
  wakeLockRequesting = true;
  try {
    const lock = await navigator.wakeLock.request('screen');
    if (!wantWakeLock) {
      await lock.release();
      return;
    }
    wakeLock = lock;
    lock.addEventListener('release', () => {
      if (wakeLock === lock) wakeLock = null;
    });
  } catch {
    // Can be refused (e.g. iOS Low Power Mode, or no user interaction yet): try again on the next tap.
    document.addEventListener('pointerdown', () => wantWakeLock && keepScreenOn(true), { once: true });
  } finally {
    wakeLockRequesting = false;
  }
}

function setStatusNote(note: string | null) {
  statusNote = note;
  if (stage.dataset.state === 'result') renderStatus();
}

/** Live (<20 s) → "Less than a minute ago" (<60 s) → "Updated 3:42 PM". */
function renderStatus() {
  const age = (Date.now() - lastFixAt) / 1000;
  let text: string;
  if (statusNote) text = statusNote;
  else if (age < LIVE_FOR_S) text = 'Live';
  else if (age < 60) text = 'Less than a minute ago';
  else text = `Updated ${new Date(lastFixAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  // Re-checked every second; only touch the DOM (and the live region) on change.
  if (statusEl.textContent !== text) statusEl.textContent = text;
  statusEl.dataset.live = String(!statusNote && age < LIVE_FOR_S);
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
  lastFixAt = Date.now();
  if (statusNote === 'Signal lost') statusNote = null;
  if (stage.dataset.state === 'result') renderStatus();
  accuracyEl.textContent = `±${Math.round(accuracy)} m`;
  lastCoords = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  coordsEl.textContent = lastCoords;

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
    setStatusNote('Updating');
  }

  try {
    const addr = await reverseGeocode(lat, lon, ctrl.signal);
    if (ctrl.signal.aborted) return;
    render(addr);
  } catch (err) {
    if (ctrl.signal.aborted) return;
    // If we already have an address, keep showing it rather than blanking the screen.
    if (current) {
      setStatusNote('Offline');
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
  statusNote = null;
  setState('result'); // visible first so fitAddress can measure
  fitAddress();
  if (changed) {
    addressEl.classList.remove('enter');
    void addressEl.offsetWidth; // restart animation
    addressEl.classList.add('enter');
  }
}

function onGeoError(err: GeolocationPositionError) {
  if (current && err.code !== err.PERMISSION_DENIED) {
    setStatusNote('Signal lost');
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

/** Copy text, then briefly swap `feedbackEl`'s label to "Copied" / "Copy failed". */
async function copyText(text: string, feedbackEl: HTMLElement) {
  const original = feedbackEl.dataset.label ?? (feedbackEl.dataset.label = feedbackEl.textContent ?? '');
  try {
    await navigator.clipboard.writeText(text);
    feedbackEl.textContent = 'Copied';
  } catch {
    feedbackEl.textContent = 'Copy failed';
  }
  clearTimeout(Number(feedbackEl.dataset.timer));
  feedbackEl.dataset.timer = String(setTimeout(() => (feedbackEl.textContent = original), 1600));
}

function copyAddress() {
  if (current) copyText(current.full, copyBtn);
}

function copyCoords() {
  if (lastCoords) copyText(lastCoords, coordsLabel);
}

/** Make a non-button element copy on click/tap, Enter or Space — but not when the user is selecting text. */
function onActivate(el: HTMLElement, action: () => void) {
  el.addEventListener('click', () => {
    if (!window.getSelection()?.toString()) action();
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      action();
    }
  });
}

$('start').addEventListener('click', start);
$('retry').addEventListener('click', start);
function restart() {
  current = null;
  start();
}

$('refresh').addEventListener('click', restart);
copyBtn.addEventListener('click', copyAddress);
onActivate(addressEl, copyAddress);
onActivate(coordsEl, copyCoords);
window.addEventListener('resize', fitAddress);

// Pause GPS when the tab is hidden; resume when visible.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (stopWatch) stop();
  } else {
    if (current && !stopWatch) stopWatch = watchLocation(onPosition, onGeoError);
    if (wantWakeLock) keepScreenOn(true);
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
