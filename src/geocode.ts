export interface Address {
  /** Primary line, e.g. "1600 Pennsylvania Ave NW" */
  line1: string;
  /** Secondary line, e.g. "Washington, DC 20500" */
  line2: string;
  /** Single-line form for copying */
  full: string;
}

interface NominatimAddress {
  house_number?: string;
  road?: string;
  pedestrian?: string;
  footway?: string;
  path?: string;
  cycleway?: string;
  neighbourhood?: string;
  suburb?: string;
  hamlet?: string;
  village?: string;
  town?: string;
  city?: string;
  municipality?: string;
  county?: string;
  state?: string;
  postcode?: string;
  country?: string;
  country_code?: string;
  [key: string]: string | undefined;
}

interface NominatimResponse {
  display_name?: string;
  name?: string;
  address?: NominatimAddress;
  error?: string;
}

const ENDPOINT = 'https://nominatim.openstreetmap.org/reverse';

export async function reverseGeocode(
  lat: number,
  lon: number,
  signal?: AbortSignal,
): Promise<Address> {
  const url = new URL(ENDPOINT);
  url.search = new URLSearchParams({
    format: 'jsonv2',
    lat: lat.toFixed(6),
    lon: lon.toFixed(6),
    zoom: '18', // building-level detail
    addressdetails: '1',
    'accept-language': navigator.language || 'en',
  }).toString();

  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Lookup failed (${res.status})`);

  const data = (await res.json()) as NominatimResponse;
  if (data.error || !data.address) throw new Error(data.error ?? 'No address found here');

  return format(data);
}

function format(data: NominatimResponse): Address {
  const a = data.address!;
  const street = a.road ?? a.pedestrian ?? a.footway ?? a.cycleway ?? a.path;
  const place = a.city ?? a.town ?? a.village ?? a.hamlet ?? a.municipality ?? a.suburb;

  let line1: string;
  if (street) {
    line1 = a.house_number ? `${a.house_number} ${street}` : street;
  } else {
    line1 = data.name || a.neighbourhood || a.suburb || place || 'Unnamed location';
  }

  // "City, ST 12345" for US; "City 12345, Region" style elsewhere is close enough.
  const isUS = a.country_code === 'us';
  const region = isUS ? abbreviateState(a.state) : a.state;
  const cityRegion = [place, region].filter(Boolean).join(', ');
  const line2Parts = [cityRegion && a.postcode ? `${cityRegion} ${a.postcode}` : cityRegion || a.postcode];
  if (!isUS && a.country) line2Parts.push(a.country);
  const line2 = line2Parts.filter(Boolean).join(', ');

  return { line1, line2, full: [line1, line2].filter(Boolean).join(', ') };
}

const US_STATES: Record<string, string> = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA',
  Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', 'District of Columbia': 'DC',
  Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL',
  Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA',
  Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN',
  Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV',
  'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK',
  Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
  'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT',
  Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI',
  Wyoming: 'WY', 'Puerto Rico': 'PR',
};

function abbreviateState(state?: string): string | undefined {
  return state ? (US_STATES[state] ?? state) : undefined;
}
