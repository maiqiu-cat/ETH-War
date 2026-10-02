/**
 * Cloudflare Web Analytics: cookie-less page-view counts. The beacon is the one script this site
 * loads from a third-party origin (see docs/decisions/0008); if it fails to load, nothing else is
 * affected. It is never loaded on local hosts, so development, previews and the verify:* scripts
 * do not report anything. Once the production domain is known, set `host` to load only there.
 */
export const ANALYTICS = {
  /** Production hostname; empty = any non-local host (the domain is not decided yet). */
  host: '',
  /** Site token from the Cloudflare Web Analytics dashboard (public by design; empty = disabled). */
  token: '1ec4764a78f64e7c80ae6bfda921631d',
  script: 'https://static.cloudflareinsights.com/beacon.min.js',
} as const;

const LOCAL_HOST = /^(localhost|127(\.\d{1,3}){3}|\[?::1\]?|0\.0\.0\.0|10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2}|.*\.(local|localhost|test|internal))$/i;

/** True on the production host (or, while `host` is empty, on any host that is not local) with a well-formed token. */
export function shouldLoadAnalytics(hostname: string, token: string = ANALYTICS.token, host: string = ANALYTICS.host): boolean {
  if (!/^[0-9a-f]{32}$/.test(token)) return false;
  if (host) return hostname === host;
  return hostname !== '' && !LOCAL_HOST.test(hostname);
}

/** Appends the beacon script to <head> when `shouldLoadAnalytics` allows it; returns the element or null. */
export function loadAnalytics(doc: Document = document, hostname: string = location.hostname): HTMLScriptElement | null {
  if (!shouldLoadAnalytics(hostname)) return null;
  const s = doc.createElement('script');
  s.defer = true;
  s.src = ANALYTICS.script;
  s.dataset.cfBeacon = JSON.stringify({ token: ANALYTICS.token });
  doc.head.appendChild(s);
  return s;
}
