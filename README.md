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

## Build

```sh
npm run build   # outputs dist/
npm run preview
```

## Notes

Nominatim's public instance has a [usage policy](https://operations.osmfoundation.org/policies/nominatim/) (max 1 request/second, attribution required). For heavy traffic, swap the endpoint in `src/geocode.ts` for a self-hosted instance or a commercial geocoder.
