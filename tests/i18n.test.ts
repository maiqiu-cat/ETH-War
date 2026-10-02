import { describe, expect, it } from 'vitest';
import { DICTIONARIES, setLang, t } from '../src/ui/i18n';

const STATUS = [
  'deploying',
  'bullsStorm',
  'bearsStorm',
  'askAbsorbed',
  'bidAbsorbed',
  'bullsCharging',
  'bullsAdvancing',
  'bearsCharging',
  'bearsAdvancing',
  'askReinforced',
  'bidReinforced',
  'bullsProbing',
  'bearsProbing',
  'skirmishes',
];
const FEED = ['bigBuy', 'bigSell', 'optBuy', 'optSell', 'liqShort', 'liqLong'];

describe('i18n', () => {
  it('zh and en define exactly the same keys', () => {
    expect(Object.keys(DICTIONARIES.zh).sort()).toEqual(Object.keys(DICTIONARIES.en).sort());
  });

  it('covers every status and feed type', () => {
    for (const lang of ['zh', 'en'] as const) {
      for (const k of STATUS) expect(DICTIONARIES[lang][`status.${k}`], `${lang} status.${k}`).toBeTruthy();
      for (const k of FEED) expect(DICTIONARIES[lang][`feed.${k}`], `${lang} feed.${k}`).toBeTruthy();
      for (const k of FEED) expect(DICTIONARIES[lang][`feedShort.${k}`], `${lang} feedShort.${k}`).toBeTruthy();
    }
  });

  it('keeps placeholders consistent between languages', () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const k of Object.keys(DICTIONARIES.en)) expect(ph(DICTIONARIES.zh[k]), k).toEqual(ph(DICTIONARIES.en[k]));
  });

  it('substitutes variables and switches language', () => {
    setLang('en');
    expect(t('score', { id: 3, b: 2, r: 1 })).toBe('Round 3 · Bulls 2 — 1 Bears');
    setLang('zh');
    expect(t('score', { id: 3, b: 2, r: 1 })).toBe('第 3 回合 · 牛 2 : 1 熊');
    expect(t('banner.winSub', { id: 1, price: '84,000.00' })).toBe('第 1 回合 · 于 $84,000.00 攻陷敌方基地');
    expect(t('missing.key')).toBe('missing.key');
  });
});
