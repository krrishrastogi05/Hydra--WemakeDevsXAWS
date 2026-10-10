import { describe, expect, it } from 'vitest';
import { templateBrief, type BriefInput } from './brief';

const INPUT: BriefInput = {
  mode: 'flood', site: { name: 'Jacobpura, Old Gurugram', city: 'Gurugram', state: 'Haryana' },
  conditions: { en: 'Heavy monsoon spell: 65 mm in 2 h, normal soil', hi: 'भारी मानसूनी बारिश: 2 घंटे में 65 मिमी, सामान्य मिट्टी' },
  budget: 25e5, spent: 24.6e5,
  mix: [{ kind: { en: 'Drain desilting', hi: 'नाले की गाद सफ़ाई' }, count: 6, cost: 9e5 }],
  picks: [{ kind: { en: 'Drain desilting', hi: 'नाले की गाद सफ़ाई' }, where: '160 m along Sohna Road', cost: 96000, reason: 'Stops ~389 m³ overflowing onto the street.' }],
  metrics: [{ label: { en: 'Homes with water inside', hi: 'जिन घरों में पानी घुसा' }, unit: { en: '', hi: '' }, before: 40, after: 29, digits: 0, better: 'lower' }],
  hotspots: ['Sohna Road (42 cm deep)'],
};

describe('officer brief', () => {
  it('writes both languages from the numbers only', () => {
    const b = templateBrief(INPUT);
    expect(b.en).toContain('## Flood resilience brief: Jacobpura, Old Gurugram, Gurugram');
    expect(b.en).toContain('Homes with water inside: 40 → **29** (−28%)');
    expect(b.en).toContain('budget ₹25.0 L');
    expect(b.en).toContain('Sohna Road (42 cm deep)');
    expect(b.hi).toContain('बजट ₹25.0 लाख');
    expect(b.hi).toContain('जिन घरों में पानी घुसा: 40 → **29**');
  });
});
