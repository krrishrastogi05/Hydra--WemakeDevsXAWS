// Builds the brief input (src/brief.ts) from the active mode's plan and its last run. Only numbers the engines
// produced go in, so the brief never has to invent any.
import { useStore } from './store';
import { useHeat } from './heatStore';
import { CATALOG, STORMS, costOf, planCost } from './sim/flood/model';
import { HEAT_CATALOG, HEAT_SCENARIOS, HEAT_WINDOWS, heatCostOf, heatPlanCost } from './sim/heat/model';
import type { InterventionType } from './sim/flood/types';
import type { HeatInterventionType } from './sim/heat/types';
import type { BriefInput, BriefMetric, BriefText } from './brief';
import { describe } from './ui/Panel';
import { describeHeat } from './ui/heat/HeatPanel';

const FLOOD_HI: Record<InterventionType, string> = {
  drain: 'नया स्टॉर्मवॉटर नाला', garden: 'रेन गार्डन', rwh: 'छत पर वर्षा जल संचयन', pit: 'रिचार्ज पिट', desilt: 'नाले की गाद सफ़ाई',
};
const HEAT_HI: Record<HeatInterventionType, string> = {
  tree: 'सड़क किनारे छायादार पेड़', canopy: 'छाया शेड', walkway: 'छायादार पैदल पथ', coolroof: 'कूल रूफ़ (सफ़ेद परावर्तक छत)',
};
const STORM_HI: Record<string, string> = { heavy: 'भारी मानसूनी बारिश', veryheavy: 'बहुत भारी बारिश', cloudburst: 'बादल फटने जैसी बारिश', extreme: 'अत्यधिक बारिश का दिन (2015 जैसा)' };
const SOIL: Record<string, BriefText> = {
  dry: { en: 'dry soil (early monsoon)', hi: 'सूखी मिट्टी (मानसून की शुरुआत)' },
  normal: { en: 'normal soil moisture', hi: 'सामान्य नमी वाली मिट्टी' },
  wet: { en: 'wet soil (after days of rain)', hi: 'गीली मिट्टी (कई दिनों की बारिश के बाद)' },
};
const SCENARIO_HI: Record<string, string> = { heatwave: 'मानसून-पूर्व लू', humid: 'उमस भरा गर्म दिन', summer: 'सामान्य गर्मी का दिन', break: 'मानसून के बीच धूप वाला दिन' };
const WINDOW_HI: Record<string, string> = { afternoon: 'दोपहर 12:00–16:00', morning: 'सुबह 8:00–11:00', evening: 'शाम 16:00–19:00', day: 'पूरा दिन 7:00–18:00' };
const NO_UNIT = { en: '', hi: '' };

const metric = (en: string, hi: string, before: number, after: number, digits: number, unit: BriefText = NO_UNIT, better: 'lower' | 'higher' = 'lower'): BriefMetric =>
  ({ label: { en, hi }, unit, before: +before.toFixed(digits), after: +after.toFixed(digits), digits, better });

/** The brief input for the active mode, or an error message when there is no plan with results yet. */
export function collectBriefInput(): BriefInput | string {
  const s = useStore.getState();
  if (!s.site || !s.grid) return 'The neighbourhood is still loading';
  const site = { name: s.site.name, city: s.site.city, state: s.site.state };
  return s.mode === 'flood' ? floodInput(site) : heatInput(site);
}

function floodInput(site: BriefInput['site']): BriefInput | string {
  const s = useStore.getState(), g = s.grid!;
  if (!s.plan.length || !s.baseline || !s.current || !s.currentKey) return 'Add interventions and run the storm first';
  const b = s.baseline.metrics, a = s.current.metrics, storm = STORMS.find(x => x.id === s.stormId) ?? STORMS[0], h = storm.durationMin / 60;
  const types = (Object.keys(CATALOG) as InterventionType[]).filter(t => s.plan.some(p => p.type === t));
  return {
    mode: 'flood', site,
    conditions: { en: `${storm.name}: ${storm.totalMm} mm in ${h} h, ${SOIL[s.antecedent].en}`, hi: `${STORM_HI[storm.id] ?? storm.name}: ${h} घंटे में ${storm.totalMm} मिमी, ${SOIL[s.antecedent].hi}` },
    budget: s.budget, spent: planCost(g, s.plan),
    mix: types.map(t => { const items = s.plan.filter(p => p.type === t); return { kind: { en: CATALOG[t].name, hi: FLOOD_HI[t] }, count: items.length, cost: planCost(g, items) }; }),
    picks: [...s.plan].sort((x, y) => costOf(g, y) - costOf(g, x)).slice(0, 8)
      .map(iv => ({ kind: { en: CATALOG[iv.type].name, hi: FLOOD_HI[iv.type] }, where: describe(g, iv).slice(0, 160), cost: costOf(g, iv), ...(iv.reason ? { reason: iv.reason.slice(0, 400) } : {}) })),
    metrics: [
      metric('Homes with water inside', 'जिन घरों में पानी घुसा', b.buildingsFlooded, a.buildingsFlooded, 0),
      metric('Residents affected (estimate)', 'प्रभावित निवासी (अनुमान)', b.residentsAffected, a.residentsAffected, 0),
      metric('Roads cut (water over 15 cm)', 'कटी सड़कें (15 सेमी से ज़्यादा पानी)', b.roadKmAffected, a.roadKmAffected, 2, { en: 'km', hi: 'किमी' }),
      metric('Waterlogged area', 'जलभराव क्षेत्र', b.floodedArea / 1e4, a.floodedArea / 1e4, 2, { en: 'ha', hi: 'हेक्टेयर' }),
      metric('Road disruption', 'सड़क बाधा', b.roadKmHours, a.roadKmHours, 1, { en: 'km·h', hi: 'किमी·घंटे' }),
      metric('Flood impact index (no action = 100)', 'बाढ़ प्रभाव सूचकांक (कोई कदम नहीं = 100)', 100, (a.impact / Math.max(1e-9, b.impact)) * 100, 0),
    ],
    hotspots: s.baseline.hotspots.slice(0, 5).map(x => `${x.road} (${Math.round(x.maxDepth * 100)} cm deep)`),
  };
}

function heatInput(site: BriefInput['site']): BriefInput | string {
  const g = useStore.getState().grid!, h = useHeat.getState();
  if (!h.heat || !h.plan.length || !h.baseline || !h.current || !h.currentKey) return 'Add shade and run the day first';
  const b = h.baseline.metrics, a = h.current.metrics;
  const sc = HEAT_SCENARIOS.find(x => x.id === h.scenarioId) ?? HEAT_SCENARIOS[0], win = HEAT_WINDOWS.find(x => x.id === h.windowId) ?? HEAT_WINDOWS[0];
  const types = (Object.keys(HEAT_CATALOG) as HeatInterventionType[]).filter(t => h.plan.some(p => p.type === t));
  const n = h.heat.receptors.length;
  return {
    mode: 'heat', site,
    conditions: { en: `${sc.name} (${sc.tempC} °C, ${sc.rh} % humidity), ${win.name.toLowerCase()}`, hi: `${SCENARIO_HI[sc.id] ?? sc.name} (${sc.tempC} °C, ${sc.rh}% नमी), ${WINDOW_HI[win.id] ?? win.name}` },
    budget: h.budget, spent: heatPlanCost(g, h.plan),
    mix: types.map(t => { const items = h.plan.filter(p => p.type === t); return { kind: { en: HEAT_CATALOG[t].name, hi: HEAT_HI[t] }, count: items.length, cost: heatPlanCost(g, items) }; }),
    picks: [...h.plan].sort((x, y) => heatCostOf(g, y) - heatCostOf(g, x)).slice(0, 8)
      .map(iv => ({ kind: { en: HEAT_CATALOG[iv.type].name, hi: HEAT_HI[iv.type] }, where: describeHeat(g, h.heat!, iv).slice(0, 160), cost: heatCostOf(g, iv), ...(iv.reason ? { reason: iv.reason.slice(0, 400) } : {}) })),
    metrics: [
      metric(`High-exposure places (of ${n} bus stops, markets, gates and parks)`, `अधिक धूप-गर्मी वाली जगहें (${n} बस स्टॉप, बाज़ार, गेट और पार्क में से)`, b.hotReceptors, a.hotReceptors, 0),
      metric('Shade where people wait', 'जहाँ लोग इंतज़ार करते हैं वहाँ छाया', b.receptorShade * 100, a.receptorShade * 100, 0, { en: '%', hi: '%' }, 'higher'),
      metric('Exposure index at busy places (0–100)', 'भीड़ वाली जगहों पर धूप-गर्मी सूचकांक (0–100)', b.weightedIndex, a.weightedIndex, 1),
      metric('Street space in sun at midday', 'दोपहर में धूप में पैदल क्षेत्र', b.exposedShare * 100, a.exposedShare * 100, 0, { en: '%', hi: '%' }),
      metric('Direct sun per spot', 'हर जगह पर सीधी धूप', b.sunHours, a.sunHours, 1, { en: 'h', hi: 'घंटे' }),
      metric('Heat absorbed by roofs', 'छतों द्वारा सोखी गई गर्मी', b.roofHeat, a.roofHeat, 0, { en: 'MWh', hi: 'MWh' }),
    ],
    hotspots: h.baseline.hotspots.slice(0, 5).map(x => `${x.name} (index ${Math.round(x.index)})`),
  };
}
