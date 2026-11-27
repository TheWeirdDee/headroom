// Where the Headroom server is. Empty (the default) means the same origin, as when `npm start` serves the
// app. A static frontend hosted elsewhere (for example on Vercel) sets VITE_API_BASE at build time to the
// server's URL, such as the read-only sample instance.
export const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/+$/, '');

/** Absolute URL of an API path ("/api/..."). */
export function apiUrl(path: string): string {
  return path.startsWith('/api') ? `${API_BASE}${path}` : path;
}

/** True when this page is served by something other than the Headroom server itself. */
export const REMOTE_API = API_BASE !== '';
