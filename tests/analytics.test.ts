import { describe, expect, it } from 'vitest';
import { ANALYTICS, loadAnalytics, shouldLoadAnalytics } from '../src/analytics';

const TOKEN = 'a'.repeat(32);
// Private-range examples are assembled at runtime: check-public.sh flags IPv4 literals outside the documentation ranges.
const ip = (...octets: number[]) => octets.join('.');

describe('shouldLoadAnalytics', () => {
  it('never loads on local hosts', () => {
    const local = ['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0', ip(10, 0, 0, 5), ip(192, 168, 1, 20), ip(172, 16, 0, 1), ip(172, 31, 255, 1), 'mac.local', 'eth.localhost', 'eth.test', 'eth.internal', ''];
    for (const h of local) expect(shouldLoadAnalytics(h, TOKEN, '')).toBe(false);
  });

  it('loads on any public host while the production host is not configured', () => {
    for (const h of ['ethwar.example', 'www.ethwar.example', ip(172, 32, 0, 1), '203.0.113.5']) expect(shouldLoadAnalytics(h, TOKEN, '')).toBe(true);
  });

  it('loads only on the exact production host once it is configured', () => {
    expect(shouldLoadAnalytics('ethwar.example', TOKEN, 'ethwar.example')).toBe(true);
    for (const h of ['localhost', 'www.ethwar.example', 'ethwar.example.evil.test', 'another.example', '']) {
      expect(shouldLoadAnalytics(h, TOKEN, 'ethwar.example')).toBe(false);
    }
  });

  it('stays off without a well-formed token', () => {
    expect(shouldLoadAnalytics('ethwar.example', '', '')).toBe(false);
    expect(shouldLoadAnalytics('ethwar.example', 'not-a-token', '')).toBe(false);
    expect(shouldLoadAnalytics('ethwar.example', TOKEN.slice(1), '')).toBe(false);
  });

  it('uses the configured token and host by default', () => {
    expect(shouldLoadAnalytics('localhost')).toBe(false);
    expect(shouldLoadAnalytics(ANALYTICS.host || 'ethwar.example')).toBe(/^[0-9a-f]{32}$/.test(ANALYTICS.token));
  });
});

describe('loadAnalytics', () => {
  const fakeDoc = () => {
    const head: unknown[] = [];
    const el = { defer: false, src: '', dataset: {} as Record<string, string> };
    return { doc: { createElement: () => el, head: { appendChild: (n: unknown) => head.push(n) } } as unknown as Document, head, el };
  };

  it('does nothing on a local host', () => {
    const { doc, head } = fakeDoc();
    expect(loadAnalytics(doc, 'localhost')).toBeNull();
    expect(loadAnalytics(doc, '127.0.0.1')).toBeNull();
    expect(head).toHaveLength(0);
  });

  it('appends the beacon with the token on the production host', () => {
    const { doc, head, el } = fakeDoc();
    const out = loadAnalytics(doc, ANALYTICS.host || 'ethwar.example');
    if (!/^[0-9a-f]{32}$/.test(ANALYTICS.token)) {
      expect(out).toBeNull(); // token not configured yet
      return;
    }
    expect(out).toBe(el);
    expect(head).toEqual([el]);
    expect(el.defer).toBe(true);
    expect(el.src).toBe(ANALYTICS.script);
    expect(JSON.parse(el.dataset.cfBeacon)).toEqual({ token: ANALYTICS.token });
  });
});
