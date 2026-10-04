// World clock cities: [name, country, IANA time zone, latitude, longitude] (coordinates for day / night).
export const CITIES = [
  // Middle East
  ['Jerusalem', 'Israel', 'Asia/Jerusalem', 31.77, 35.21], ['Tel Aviv', 'Israel', 'Asia/Jerusalem', 32.09, 34.78],
  ['Haifa', 'Israel', 'Asia/Jerusalem', 32.79, 34.99], ['Eilat', 'Israel', 'Asia/Jerusalem', 29.56, 34.95],
  ['Dubai', 'UAE', 'Asia/Dubai', 25.2, 55.27], ['Abu Dhabi', 'UAE', 'Asia/Dubai', 24.45, 54.38], ['Doha', 'Qatar', 'Asia/Qatar', 25.29, 51.53],
  ['Riyadh', 'Saudi Arabia', 'Asia/Riyadh', 24.71, 46.68], ['Amman', 'Jordan', 'Asia/Amman', 31.95, 35.93], ['Beirut', 'Lebanon', 'Asia/Beirut', 33.89, 35.5],
  ['Tehran', 'Iran', 'Asia/Tehran', 35.69, 51.39], ['Baghdad', 'Iraq', 'Asia/Baghdad', 33.31, 44.36], ['Kuwait City', 'Kuwait', 'Asia/Kuwait', 29.38, 47.99],
  ['Muscat', 'Oman', 'Asia/Muscat', 23.59, 58.41], ['Manama', 'Bahrain', 'Asia/Bahrain', 26.23, 50.59], ['Tbilisi', 'Georgia', 'Asia/Tbilisi', 41.72, 44.78],
  ['Yerevan', 'Armenia', 'Asia/Yerevan', 40.18, 44.51], ['Baku', 'Azerbaijan', 'Asia/Baku', 40.41, 49.87], ['Nicosia', 'Cyprus', 'Asia/Nicosia', 35.17, 33.36],
  // Europe
  ['London', 'United Kingdom', 'Europe/London', 51.51, -0.13], ['Edinburgh', 'United Kingdom', 'Europe/London', 55.95, -3.19],
  ['Dublin', 'Ireland', 'Europe/Dublin', 53.35, -6.26], ['Paris', 'France', 'Europe/Paris', 48.86, 2.35], ['Berlin', 'Germany', 'Europe/Berlin', 52.52, 13.4],
  ['Munich', 'Germany', 'Europe/Berlin', 48.14, 11.58], ['Madrid', 'Spain', 'Europe/Madrid', 40.42, -3.7], ['Barcelona', 'Spain', 'Europe/Madrid', 41.39, 2.17],
  ['Lisbon', 'Portugal', 'Europe/Lisbon', 38.72, -9.14], ['Rome', 'Italy', 'Europe/Rome', 41.9, 12.5], ['Milan', 'Italy', 'Europe/Rome', 45.46, 9.19],
  ['Amsterdam', 'Netherlands', 'Europe/Amsterdam', 52.37, 4.9], ['Brussels', 'Belgium', 'Europe/Brussels', 50.85, 4.35],
  ['Luxembourg', 'Luxembourg', 'Europe/Luxembourg', 49.61, 6.13], ['Zurich', 'Switzerland', 'Europe/Zurich', 47.38, 8.54],
  ['Geneva', 'Switzerland', 'Europe/Zurich', 46.2, 6.14], ['Vienna', 'Austria', 'Europe/Vienna', 48.21, 16.37], ['Prague', 'Czechia', 'Europe/Prague', 50.08, 14.44],
  ['Warsaw', 'Poland', 'Europe/Warsaw', 52.23, 21.01], ['Budapest', 'Hungary', 'Europe/Budapest', 47.5, 19.04], ['Copenhagen', 'Denmark', 'Europe/Copenhagen', 55.68, 12.57],
  ['Stockholm', 'Sweden', 'Europe/Stockholm', 59.33, 18.07], ['Oslo', 'Norway', 'Europe/Oslo', 59.91, 10.75], ['Helsinki', 'Finland', 'Europe/Helsinki', 60.17, 24.94],
  ['Reykjavík', 'Iceland', 'Atlantic/Reykjavik', 64.15, -21.94], ['Athens', 'Greece', 'Europe/Athens', 37.98, 23.73], ['Istanbul', 'Türkiye', 'Europe/Istanbul', 41.01, 28.98],
  ['Bucharest', 'Romania', 'Europe/Bucharest', 44.43, 26.1], ['Sofia', 'Bulgaria', 'Europe/Sofia', 42.7, 23.32], ['Belgrade', 'Serbia', 'Europe/Belgrade', 44.79, 20.45],
  ['Zagreb', 'Croatia', 'Europe/Zagreb', 45.81, 15.98], ['Kyiv', 'Ukraine', 'Europe/Kiev', 50.45, 30.52], ['Minsk', 'Belarus', 'Europe/Minsk', 53.9, 27.56],
  ['Riga', 'Latvia', 'Europe/Riga', 56.95, 24.11], ['Vilnius', 'Lithuania', 'Europe/Vilnius', 54.69, 25.28], ['Tallinn', 'Estonia', 'Europe/Tallinn', 59.44, 24.75],
  ['Moscow', 'Russia', 'Europe/Moscow', 55.76, 37.62], ['Saint Petersburg', 'Russia', 'Europe/Moscow', 59.93, 30.34], ['Valletta', 'Malta', 'Europe/Malta', 35.9, 14.51],
  ['Monaco', 'Monaco', 'Europe/Monaco', 43.74, 7.42], ['Las Palmas', 'Canary Islands', 'Atlantic/Canary', 28.12, -15.43], ['Ponta Delgada', 'Azores', 'Atlantic/Azores', 37.74, -25.67],
  // Africa
  ['Cairo', 'Egypt', 'Africa/Cairo', 30.04, 31.24], ['Casablanca', 'Morocco', 'Africa/Casablanca', 33.57, -7.59], ['Marrakesh', 'Morocco', 'Africa/Casablanca', 31.63, -8.0],
  ['Algiers', 'Algeria', 'Africa/Algiers', 36.75, 3.06], ['Tunis', 'Tunisia', 'Africa/Tunis', 36.81, 10.18], ['Lagos', 'Nigeria', 'Africa/Lagos', 6.52, 3.38],
  ['Accra', 'Ghana', 'Africa/Accra', 5.6, -0.19], ['Dakar', 'Senegal', 'Africa/Dakar', 14.72, -17.47], ['Addis Ababa', 'Ethiopia', 'Africa/Addis_Ababa', 9.03, 38.74],
  ['Nairobi', 'Kenya', 'Africa/Nairobi', -1.29, 36.82], ['Dar es Salaam', 'Tanzania', 'Africa/Dar_es_Salaam', -6.79, 39.21], ['Kinshasa', 'DR Congo', 'Africa/Kinshasa', -4.44, 15.27],
  ['Johannesburg', 'South Africa', 'Africa/Johannesburg', -26.2, 28.05], ['Cape Town', 'South Africa', 'Africa/Johannesburg', -33.92, 18.42],
  ['Port Louis', 'Mauritius', 'Indian/Mauritius', -20.16, 57.5],
  // Asia
  ['Tokyo', 'Japan', 'Asia/Tokyo', 35.68, 139.69], ['Osaka', 'Japan', 'Asia/Tokyo', 34.69, 135.5], ['Seoul', 'South Korea', 'Asia/Seoul', 37.57, 126.98],
  ['Beijing', 'China', 'Asia/Shanghai', 39.9, 116.41], ['Shanghai', 'China', 'Asia/Shanghai', 31.23, 121.47], ['Hong Kong', 'China', 'Asia/Hong_Kong', 22.32, 114.17],
  ['Taipei', 'Taiwan', 'Asia/Taipei', 25.03, 121.57], ['Manila', 'Philippines', 'Asia/Manila', 14.6, 120.98], ['Singapore', 'Singapore', 'Asia/Singapore', 1.35, 103.82],
  ['Kuala Lumpur', 'Malaysia', 'Asia/Kuala_Lumpur', 3.14, 101.69], ['Bangkok', 'Thailand', 'Asia/Bangkok', 13.76, 100.5], ['Hanoi', 'Vietnam', 'Asia/Ho_Chi_Minh', 21.03, 105.85],
  ['Ho Chi Minh City', 'Vietnam', 'Asia/Ho_Chi_Minh', 10.82, 106.63], ['Phnom Penh', 'Cambodia', 'Asia/Phnom_Penh', 11.56, 104.93], ['Yangon', 'Myanmar', 'Asia/Yangon', 16.87, 96.2],
  ['Jakarta', 'Indonesia', 'Asia/Jakarta', -6.21, 106.85], ['Bali', 'Indonesia', 'Asia/Makassar', -8.65, 115.22], ['New Delhi', 'India', 'Asia/Kolkata', 28.61, 77.21],
  ['Mumbai', 'India', 'Asia/Kolkata', 19.08, 72.88], ['Bengaluru', 'India', 'Asia/Kolkata', 12.97, 77.59], ['Kolkata', 'India', 'Asia/Kolkata', 22.57, 88.36],
  ['Karachi', 'Pakistan', 'Asia/Karachi', 24.86, 67.0], ['Dhaka', 'Bangladesh', 'Asia/Dhaka', 23.81, 90.41], ['Kathmandu', 'Nepal', 'Asia/Kathmandu', 27.72, 85.32],
  ['Colombo', 'Sri Lanka', 'Asia/Colombo', 6.93, 79.86], ['Malé', 'Maldives', 'Indian/Maldives', 4.18, 73.51], ['Kabul', 'Afghanistan', 'Asia/Kabul', 34.56, 69.21],
  ['Tashkent', 'Uzbekistan', 'Asia/Tashkent', 41.3, 69.24], ['Almaty', 'Kazakhstan', 'Asia/Almaty', 43.24, 76.89], ['Ulaanbaatar', 'Mongolia', 'Asia/Ulaanbaatar', 47.89, 106.91],
  ['Novosibirsk', 'Russia', 'Asia/Novosibirsk', 55.01, 82.93], ['Vladivostok', 'Russia', 'Asia/Vladivostok', 43.12, 131.89],
  // Oceania
  ['Sydney', 'Australia', 'Australia/Sydney', -33.87, 151.21], ['Melbourne', 'Australia', 'Australia/Melbourne', -37.81, 144.96],
  ['Brisbane', 'Australia', 'Australia/Brisbane', -27.47, 153.03], ['Perth', 'Australia', 'Australia/Perth', -31.95, 115.86],
  ['Adelaide', 'Australia', 'Australia/Adelaide', -34.93, 138.6], ['Darwin', 'Australia', 'Australia/Darwin', -12.46, 130.84],
  ['Auckland', 'New Zealand', 'Pacific/Auckland', -36.85, 174.76], ['Wellington', 'New Zealand', 'Pacific/Auckland', -41.29, 174.78],
  ['Suva', 'Fiji', 'Pacific/Fiji', -18.14, 178.44], ['Guam', 'USA', 'Pacific/Guam', 13.44, 144.79], ['Apia', 'Samoa', 'Pacific/Apia', -13.83, -171.76],
  ['Papeete', 'Tahiti', 'Pacific/Tahiti', -17.54, -149.57], ['Kiritimati', 'Kiribati', 'Pacific/Kiritimati', 1.87, -157.36], ['Honolulu', 'Hawaii, USA', 'Pacific/Honolulu', 21.31, -157.86],
  // Americas
  ['New York', 'USA', 'America/New_York', 40.71, -74.01], ['Washington, D.C.', 'USA', 'America/New_York', 38.91, -77.04], ['Boston', 'USA', 'America/New_York', 42.36, -71.06],
  ['Miami', 'USA', 'America/New_York', 25.76, -80.19], ['Atlanta', 'USA', 'America/New_York', 33.75, -84.39], ['Chicago', 'USA', 'America/Chicago', 41.88, -87.63],
  ['Houston', 'USA', 'America/Chicago', 29.76, -95.37], ['Dallas', 'USA', 'America/Chicago', 32.78, -96.8], ['Denver', 'USA', 'America/Denver', 39.74, -104.99],
  ['Phoenix', 'USA', 'America/Phoenix', 33.45, -112.07], ['Las Vegas', 'USA', 'America/Los_Angeles', 36.17, -115.14], ['Los Angeles', 'USA', 'America/Los_Angeles', 34.05, -118.24],
  ['San Francisco', 'USA', 'America/Los_Angeles', 37.77, -122.42], ['Seattle', 'USA', 'America/Los_Angeles', 47.61, -122.33], ['Anchorage', 'USA', 'America/Anchorage', 61.22, -149.9],
  ['Toronto', 'Canada', 'America/Toronto', 43.65, -79.38], ['Montreal', 'Canada', 'America/Toronto', 45.5, -73.57], ['Vancouver', 'Canada', 'America/Vancouver', 49.28, -123.12],
  ['Calgary', 'Canada', 'America/Edmonton', 51.05, -114.07], ['Halifax', 'Canada', 'America/Halifax', 44.65, -63.57], ["St. John's", 'Canada', 'America/St_Johns', 47.56, -52.71],
  ['Mexico City', 'Mexico', 'America/Mexico_City', 19.43, -99.13], ['Cancún', 'Mexico', 'America/Cancun', 21.16, -86.85], ['Guatemala City', 'Guatemala', 'America/Guatemala', 14.63, -90.51],
  ['Havana', 'Cuba', 'America/Havana', 23.11, -82.37], ['San Juan', 'Puerto Rico', 'America/Puerto_Rico', 18.47, -66.11], ['Panama City', 'Panama', 'America/Panama', 8.98, -79.52],
  ['Bogotá', 'Colombia', 'America/Bogota', 4.71, -74.07], ['Caracas', 'Venezuela', 'America/Caracas', 10.48, -66.9], ['Quito', 'Ecuador', 'America/Guayaquil', -0.18, -78.47],
  ['Lima', 'Peru', 'America/Lima', -12.05, -77.04], ['La Paz', 'Bolivia', 'America/La_Paz', -16.5, -68.15], ['Santiago', 'Chile', 'America/Santiago', -33.45, -70.67],
  ['Buenos Aires', 'Argentina', 'America/Argentina/Buenos_Aires', -34.6, -58.38], ['Montevideo', 'Uruguay', 'America/Montevideo', -34.9, -56.16],
  ['São Paulo', 'Brazil', 'America/Sao_Paulo', -23.55, -46.63], ['Rio de Janeiro', 'Brazil', 'America/Sao_Paulo', -22.91, -43.17],
  // —
  ['UTC', 'Coordinated Universal Time', 'UTC', 51.48, 0],
].map(([name, country, tz, lat, lon]) => ({ id: `${name}|${tz}`, name, country, tz, lat, lon }));

export const cityById = (id) => CITIES.find((c) => c.id === id) || null;

/** The sun's altitude in degrees at a place and moment (good to ~1°). */
export function sunAltitude(lat, lon, date = new Date()) {
  const rad = Math.PI / 180;
  const d = date.getTime() / 86400000 - 10957.5;            // days since J2000
  const g = (357.529 + 0.98560028 * d) * rad;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
  const e = (23.439 - 0.00000036 * d) * rad;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
  const ha = (gmst * 15 + lon) * rad - ra;
  return Math.asin(Math.sin(lat * rad) * Math.sin(dec) + Math.cos(lat * rad) * Math.cos(dec) * Math.cos(ha)) / rad;
}

const fmts = new Map();
function parts(tz, date) {
  let f = fmts.get(tz);
  if (!f) {
    try { f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short' }); }
    catch { f = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short' }); }
    fmts.set(tz, f);
  }
  const o = {};
  for (const p of f.formatToParts(date)) o[p.type] = p.value;
  return o;
}
/** Wall-clock time in a zone: { h, m, s, y, mo, d, wd, offsetMin (vs UTC) }. */
export function zoneTime(tz, date = new Date()) {
  const p = parts(tz, date);
  const y = +p.year, mo = +p.month, d = +p.day, h = +p.hour % 24, m = +p.minute, s = +p.second;
  const asUtc = Date.UTC(y, mo - 1, d, h, m, s);
  const offsetMin = Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
  return { h, m, s, y, mo, d, wd: p.weekday, offsetMin };
}
