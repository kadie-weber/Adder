/**
 * Dev mode: a floating panel for simulating locations.
 *
 * Enabled automatically on the Vite dev server, or in any build with `?dev`
 * (sticky for the session; `?dev=0` turns it off).
 */
import { setSimulation, type Simulation } from './location';

interface Preset {
  id: string;
  label: string;
  note: string;
  sim: Simulation;
}

// West Valley City, UT test points. Coordinates are OSM address points, so the
// reverse lookup lands on the listed Salt Lake grid address.
const PRESETS: Preset[] = [
  { id: 'wvc-4100s', label: '4100 South 3974 West', note: 'East–west grid street', sim: { kind: 'fixed', lat: 40.68248, lon: -111.98596 } },
  { id: 'wvc-4800w', label: '4667 South 4800 West', note: 'North–south grid street', sim: { kind: 'fixed', lat: 40.6682, lon: -112.00514 } },
  { id: 'wvc-3500s', label: '3500 South 6339 West', note: 'Far west side, 84128', sim: { kind: 'fixed', lat: 40.69622, lon: -112.04236 } },
  { id: 'wvc-5600w', label: '3075 South 5600 West', note: 'Commercial strip', sim: { kind: 'fixed', lat: 40.70417, lon: -112.0244 } },
  { id: 'wvc-3520w', label: '3829 South 3520 West', note: 'Residential, odd-numbered street', sim: { kind: 'fixed', lat: 40.68881, lon: -111.97489 } },
  { id: 'wvc-3270w', label: '2251 South 3270 West', note: 'Industrial, north end', sim: { kind: 'fixed', lat: 40.72223, lon: -111.96886 } },
  { id: 'wvc-cityhall', label: '3600 Constitution Blvd', note: 'Named street (City Hall)', sim: { kind: 'fixed', lat: 40.69403, lon: -111.9586 } },
  { id: 'wvc-redwood', label: 'Redwood Rd (1700 W)', note: 'No house number', sim: { kind: 'fixed', lat: 40.69552, lon: -111.93925 } },
  {
    id: 'wvc-drive',
    label: 'Drive 3500 S westbound',
    note: '2700 W → 5600 W at ~45 mph',
    sim: { kind: 'route', speedMps: 20, points: [[40.6965, -111.9586], [40.6965, -112.025]] },
  },
  { id: 'err-denied', label: 'Permission denied', note: 'Error screen', sim: { kind: 'error', code: 1, message: 'User denied Geolocation' } },
  { id: 'err-timeout', label: 'Timeout', note: 'Error screen', sim: { kind: 'error', code: 3, message: 'Timeout expired' } },
];

const STORE_KEY = 'adder:dev:sim';
const SESSION_KEY = 'adder:dev';

export function devModeEnabled(): boolean {
  const param = new URLSearchParams(location.search).get('dev');
  try {
    if (param === '0') sessionStorage.removeItem(SESSION_KEY);
    else if (param !== null) sessionStorage.setItem(SESSION_KEY, '1');
    if (sessionStorage.getItem(SESSION_KEY)) return true;
  } catch {
    if (param !== null && param !== '0') return true;
  }
  return param !== '0' && import.meta.env.DEV;
}

/**
 * Mount the dev panel. Restores the last chosen simulation before returning,
 * so the caller's first start() already uses it. `onChange` is called after
 * the user picks a new source.
 */
export function mountDevPanel(onChange: () => void) {
  let selected = 'gps';
  let custom: Simulation | null = null;

  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as { id: string; sim?: Simulation } | null;
    if (saved) {
      const preset = PRESETS.find((p) => p.id === saved.id);
      if (preset) apply(preset.id, preset.sim, false);
      else if (saved.id === 'custom' && saved.sim) {
        custom = saved.sim;
        apply('custom', saved.sim, false);
      }
    }
  } catch {
    /* storage unavailable: start on real GPS */
  }

  const root = document.createElement('div');
  root.className = 'dev';
  root.innerHTML = `
    <button class="dev__toggle" type="button" aria-expanded="false" aria-controls="dev-panel"></button>
    <div class="dev__panel" id="dev-panel" hidden>
      <div class="dev__head">
        <span>Simulated location</span>
        <button class="dev__close" type="button" aria-label="Close dev panel">×</button>
      </div>
      <div class="dev__list" role="list"></div>
      <form class="dev__custom">
        <input name="coords" inputmode="decimal" autocomplete="off" spellcheck="false"
               placeholder="lat, lon" aria-label="Custom coordinates (lat, lon)" />
        <button type="submit">Go</button>
      </form>
    </div>`;
  document.body.append(root);

  const toggle = root.querySelector<HTMLButtonElement>('.dev__toggle')!;
  const panel = root.querySelector<HTMLElement>('.dev__panel')!;
  const list = root.querySelector<HTMLElement>('.dev__list')!;
  const form = root.querySelector<HTMLFormElement>('.dev__custom')!;
  const input = form.elements.namedItem('coords') as HTMLInputElement;

  const options: { id: string; label: string; note: string; sim: Simulation | null }[] = [
    { id: 'gps', label: 'Real GPS', note: 'Device location', sim: null },
    ...PRESETS,
  ];
  for (const o of options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dev__item';
    b.dataset.id = o.id;
    b.setAttribute('role', 'listitem');
    b.innerHTML = `<span class="dev__label"></span><span class="dev__note"></span>`;
    b.querySelector('.dev__label')!.textContent = o.label;
    b.querySelector('.dev__note')!.textContent = o.note;
    b.addEventListener('click', () => apply(o.id, o.sim, true));
    list.append(b);
  }

  if (custom?.kind === 'fixed') input.value = `${custom.lat}, ${custom.lon}`;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const m = /^\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(input.value);
    const lat = m ? Number(m[1]) : NaN;
    const lon = m ? Number(m[2]) : NaN;
    if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) {
      input.setCustomValidity('Enter "lat, lon"');
      input.reportValidity();
      return;
    }
    input.setCustomValidity('');
    custom = { kind: 'fixed', lat, lon };
    apply('custom', custom, true);
  });
  input.addEventListener('input', () => input.setCustomValidity(''));

  const setOpen = (open: boolean) => {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  };
  toggle.addEventListener('click', () => setOpen(panel.hidden));
  root.querySelector('.dev__close')!.addEventListener('click', () => setOpen(false));

  sync();

  function apply(id: string, sim: Simulation | null, restart: boolean) {
    selected = id;
    setSimulation(sim);
    try {
      if (sim) localStorage.setItem(STORE_KEY, JSON.stringify({ id, sim: id === 'custom' ? sim : undefined }));
      else localStorage.removeItem(STORE_KEY);
    } catch {
      /* ignore */
    }
    if (restart) {
      sync();
      onChange();
    }
  }

  function sync() {
    const active = options.find((o) => o.id === selected);
    toggle.textContent = selected === 'gps' ? 'Dev · GPS' : 'Dev · Sim';
    toggle.dataset.sim = String(selected !== 'gps');
    toggle.title = active ? active.label : selected === 'custom' ? input.value : '';
    for (const b of list.querySelectorAll<HTMLElement>('.dev__item')) {
      b.setAttribute('aria-current', String(b.dataset.id === selected));
    }
  }
}
