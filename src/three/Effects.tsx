// Screen-space finish. "High" gets the full treatment: ambient occlusion grounds buildings and darkens alleys,
// a tight bloom lifts genuinely bright things (glowing drains, lit tanks, sun glints) without washing the scene out,
// a touch of saturation and contrast gives the render some punch, SMAA smooths edges. "Low" skips the expensive
// passes (AO, bloom, SMAA) but keeps a cheap vignette and colour grade so weaker laptops don't fall back to a flat,
// untouched render.
import { EffectComposer, N8AO, SMAA, Vignette, Bloom, HueSaturation, BrightnessContrast } from '@react-three/postprocessing';

export function Effects({ tier }: { tier: 'high' | 'low' }) {
  if (tier === 'low') {
    return (
      <EffectComposer multisampling={0}>
        <HueSaturation saturation={0.04} />
        <BrightnessContrast contrast={0.04} brightness={0} />
        <Vignette offset={0.3} darkness={0.36} />
      </EffectComposer>
    );
  }
  return (
    <EffectComposer multisampling={0}>
      <N8AO aoRadius={7} distanceFalloff={1.2} intensity={1.8} quality="performance" halfRes color="#1a1612" />
      <Bloom luminanceThreshold={0.85} luminanceSmoothing={0.3} intensity={0.4} mipmapBlur radius={0.6} />
      <HueSaturation saturation={0.06} />
      <BrightnessContrast contrast={0.05} brightness={0} />
      <SMAA />
      <Vignette offset={0.32} darkness={0.42} />
    </EffectComposer>
  );
}
