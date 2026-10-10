// Screen-space finish for the "High" graphics setting: ambient occlusion grounds buildings and darkens alleys,
// SMAA smooths edges, a light vignette pulls the eye to the centre. "Low" renders without a composer.
import { EffectComposer, N8AO, SMAA, Vignette } from '@react-three/postprocessing';

export function Effects() {
  return (
    <EffectComposer multisampling={0}>
      <N8AO aoRadius={7} distanceFalloff={1.2} intensity={2.4} quality="medium" halfRes color="#1a1612" />
      <SMAA />
      <Vignette offset={0.32} darkness={0.42} />
    </EffectComposer>
  );
}
