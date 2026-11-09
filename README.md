# Adder

A tiny vanilla TypeScript web app that asks for your location and shows the nearest street address — big, dark, and mobile-first.

- Live updates via `watchPosition`, re-looking-up only after you move ~15 m (throttled to respect the geocoder's rate limit)
- Reverse geocoding by [Nominatim](https://nominatim.org/) / OpenStreetMap (no API key)
- Copy-to-clipboard, accuracy and coordinates readout
- Dark mode only

## Develop

```sh
npm install
npm run dev
```

Geolocation requires a secure context: `localhost` works on your computer. To test on a phone, serve over HTTPS (e.g. a tunnel like `cloudflared` / `ngrok`, or deploy the `dist/` folder).

## Dev mode

A **Dev** pill in the bottom-right corner opens a panel for faking your location. It shows up automatically on `npm run dev`; in any other build, add `?dev` to the URL (it stays on for that browser session; `?dev=0` turns it off).

Choices:

- **Real GPS**: the device's actual location
- **West Valley City, UT presets**: points on Salt Lake grid streets (e.g. `4100 South 3974 West`, `4667 South 4800 West`), plus edge cases: a named street (City Hall, 3600 Constitution Blvd) and a road with no house number (Redwood Rd)
- **Drive 3500 S westbound**: moves from 2700 W to 5600 W at about 45 mph, to test live updates and throttling
- **Permission denied / Timeout**: show the error screens
- **Custom**: type in any `lat, lon`

The page remembers your last choice. A simulated location doesn't need geolocation permission or HTTPS, so you can try it on a phone over plain `http://<lan-ip>:5173`.

## Salt Lake grid addresses

OSM names Salt Lake County's numbered streets as just "4100 South", so a raw lookup would read "3974 4100 South". `src/grid.ts` rewrites these to grid form the way locals say it: south/north number first, then west/east, with directions spelled out and each on its own line:

```
4100 South
3974 West
```

A house on 4800 West reads "4667 South / 4800 West". It works out each direction from which side of the grid origin you're on. The origin is Main St & South Temple.

## Build

```sh
npm run build   # outputs dist/
npm run preview
```

## Notes

Nominatim's public instance has a [usage policy](https://operations.osmfoundation.org/policies/nominatim/) (max 1 request/second, attribution required). For heavy traffic, swap the endpoint in `src/geocode.ts` for a self-hosted instance or a commercial geocoder.
