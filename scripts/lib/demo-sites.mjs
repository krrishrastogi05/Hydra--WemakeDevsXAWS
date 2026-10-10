// The three demo neighbourhoods built by scripts/fetch-site.mjs into public/data.
// Site settings. Everything marked synthetic here is surfaced in the app's provenance panel.
export const SITES = {
  gurugram: {
    name: 'Jacobpura, Old Gurugram', city: 'Gurugram', state: 'Haryana', lat: 28.4624763, lon: 77.0276631,
    soil: { name: 'Sandy loam (Aravalli foothill alluvium)', factor: 1.25 },
    smoothSigma: 5, levels: [1, 2, 2, 3, 3, 4], infill: 0.45, ground: '#d9c7a3',
    blurb: 'Dense old-city core on the Aravalli foothill slope; heavy paving sends runoff downhill to low chowks.',
  },
  chennai: {
    name: 'Velachery', city: 'Chennai', state: 'Tamil Nadu', lat: 12.9801655, lon: 80.2228506,
    soil: { name: 'Clayey marsh soil (Pallikaranai basin), high water table', factor: 0.45 },
    smoothSigma: 7, levels: [1, 2, 2, 3, 4, 5], infill: 0.5, ground: '#cfc6b4',
    blurb: 'Very flat, low-lying former wetland that flooded in 2015 and 2023; water has few places to go.',
  },
  ranchi: {
    name: 'Lalpur', city: 'Ranchi', state: 'Jharkhand', lat: 23.375328, lon: 85.3384361,
    soil: { name: 'Lateritic red soil (Chota Nagpur plateau)', factor: 0.85 },
    smoothSigma: 4, levels: [1, 1, 2, 2, 3], infill: 0.85, ground: '#c99a7a',
    blurb: 'Undulating plateau town; OSM has few buildings here, so most footprints are synthetic infill.',
  },
};
