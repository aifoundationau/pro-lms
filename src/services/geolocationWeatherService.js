/**
 * Geolocation & Live Weather Service for AI Foundation (Pro-LMS)
 * Absolute reliability: safe fallbacks, timeout handling, no unhandled exceptions.
 */

export const DEFAULT_LOCATION = {
  suburb: 'South Bank',
  city: 'Brisbane',
  state: 'Queensland',
  country: 'Australia',
  latitude: -27.4748,
  longitude: 153.0180,
  source: 'AI Foundation HQ',
  timezone: 'Australia/Brisbane'
};

export const DEFAULT_WEATHER = {
  temperature: 24,
  apparentTemperature: 25,
  humidity: 62,
  windSpeed: 14,
  condition: 'Clear & Sunny',
  icon: '☀️',
  isFallback: true
};

const WMO_WEATHER_MAP = {
  0: { condition: 'Clear Sky', icon: '☀️' },
  1: { condition: 'Mainly Clear', icon: '🌤️' },
  2: { condition: 'Partly Cloudy', icon: '⛅' },
  3: { condition: 'Overcast', icon: '☁️' },
  45: { condition: 'Foggy', icon: '🌫️' },
  48: { condition: 'Depositing Rime Fog', icon: '🌫️' },
  51: { condition: 'Light Drizzle', icon: '🌦️' },
  53: { condition: 'Moderate Drizzle', icon: '🌦️' },
  55: { condition: 'Dense Drizzle', icon: '🌧️' },
  61: { condition: 'Slight Rain', icon: '🌧️' },
  63: { condition: 'Moderate Rain', icon: '🌧️' },
  65: { condition: 'Heavy Rain', icon: '🌧️' },
  71: { condition: 'Slight Snow', icon: '🌨️' },
  73: { condition: 'Moderate Snow', icon: '❄️' },
  75: { condition: 'Heavy Snow', icon: '❄️' },
  80: { condition: 'Slight Rain Showers', icon: '🌦️' },
  81: { condition: 'Moderate Rain Showers', icon: '🌧️' },
  82: { condition: 'Violent Rain Showers', icon: '⛈️' },
  95: { condition: 'Thunderstorm', icon: '⛈️' },
  96: { condition: 'Thunderstorm with Hail', icon: '⛈️' },
  99: { condition: 'Heavy Thunderstorm', icon: '⛈️' }
};

let cachedLocation = null;
let cachedWeather = null;
let lastWeatherFetchTime = 0;
const WEATHER_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch weather from Open-Meteo for coordinates.
 */
export async function fetchWeather(lat, lon) {
  const now = Date.now();
  if (cachedWeather && (now - lastWeatherFetchTime < WEATHER_CACHE_TTL_MS)) {
    return cachedWeather;
  }

  const latitude = typeof lat === 'number' && !isNaN(lat) ? lat : DEFAULT_LOCATION.latitude;
  const longitude = typeof lon === 'number' && !isNaN(lon) ? lon : DEFAULT_LOCATION.longitude;

  try {
    if (typeof fetch !== 'function') return DEFAULT_WEATHER;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4500);

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&timezone=auto`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!res.ok) throw new Error(`Weather service responded with ${res.status}`);
    const data = await res.json();
    const current = data?.current;

    if (!current || typeof current.temperature_2m === 'undefined') {
      return DEFAULT_WEATHER;
    }

    const weatherCode = current.weather_code ?? 0;
    const meta = WMO_WEATHER_MAP[weatherCode] || { condition: 'Pleasant', icon: '🌤️' };

    const result = {
      temperature: Math.round(current.temperature_2m),
      apparentTemperature: Math.round(current.apparent_temperature ?? current.temperature_2m),
      humidity: Math.round(current.relative_humidity_2m ?? 60),
      windSpeed: Math.round(current.wind_speed_10m ?? 12),
      condition: meta.condition,
      icon: meta.icon,
      isFallback: false
    };

    cachedWeather = result;
    lastWeatherFetchTime = now;
    return result;
  } catch (err) {
    // Graceful degradation: never crash
    return DEFAULT_WEATHER;
  }
}

/**
 * Reverse geocode latitude & longitude to extract suburb/city
 */
export async function reverseGeocode(lat, lon) {
  try {
    if (typeof fetch !== 'function') return null;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!res.ok) throw new Error(`Geocoding HTTP ${res.status}`);
    const data = await res.json();

    const suburb = data?.locality || data?.city || data?.localityInfo?.administrative?.[3]?.name || 'South Bank';
    const city = data?.city || data?.principalSubdivision || 'Brisbane';
    const state = data?.principalSubdivision || 'Queensland';
    const country = data?.countryName || 'Australia';

    return {
      suburb,
      city,
      state,
      country,
      latitude: lat,
      longitude: lon,
      source: 'GPS'
    };
  } catch {
    return null;
  }
}

/**
 * Try detecting location using IP lookup (fallback when browser GPS not triggered or denied)
 */
async function fetchIpLocation() {
  try {
    if (typeof fetch !== 'function') return null;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);

    const res = await fetch('https://ipapi.co/json/', { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!res.ok) throw new Error(`IP location HTTP ${res.status}`);
    const data = await res.json();

    if (data && data.latitude && data.longitude) {
      return {
        suburb: data.city || data.region || 'South Bank',
        city: data.city || 'Brisbane',
        state: data.region || 'Queensland',
        country: data.country_name || 'Australia',
        latitude: parseFloat(data.latitude),
        longitude: parseFloat(data.longitude),
        source: 'Network / IP',
        timezone: data.timezone || 'Australia/Brisbane'
      };
    }
  } catch {
    // Fail silently to default
  }
  return null;
}

/**
 * Detect location: returns cached, IP-based, or default location.
 */
export async function getInitialLocation() {
  if (cachedLocation) return cachedLocation;

  const ipLoc = await fetchIpLocation();
  if (ipLoc) {
    cachedLocation = ipLoc;
    return ipLoc;
  }

  return DEFAULT_LOCATION;
}

/**
 * Request exact browser GPS location (triggered on button click or consent).
 */
export function requestBrowserGps() {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.navigator || !window.navigator.geolocation) {
      resolve(null);
      return;
    }

    window.navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        const geocoded = await reverseGeocode(lat, lon);
        if (geocoded) {
          cachedLocation = geocoded;
          resolve(geocoded);
        } else {
          const fallbackGps = {
            ...DEFAULT_LOCATION,
            latitude: lat,
            longitude: lon,
            source: 'Exact GPS'
          };
          cachedLocation = fallbackGps;
          resolve(fallbackGps);
        }
      },
      () => {
        // Permission denied or error
        resolve(null);
      },
      { timeout: 6000, maximumAge: 300000 }
    );
  });
}
