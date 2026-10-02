// Per-map colour grade (desktop edition), after tone mapping on the display-referred picture: the split-tone, contrast and
// vibrance a colourist would give each map's mood (dusk harbour: violet shadows under gold light; the foundry: teal
// shadows, ember highlights; the desert: hot, clean light), plus a soft vignette that holds the eye on the crosshair.
// Kept gentle on purpose - heroes must read against any map, so saturation lifts the muted colours (vibrance) more
// than the already vivid ones and skin stays where it was.
import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

export interface Grade {
  /** contrast around mid grey */
  contrast: number;
  /** vibrance: saturation added in proportion to how unsaturated a colour is */
  vibrance: number;
  /** split tone: added to the shadows / highlights (sRGB offsets, about +-0.06) */
  shadows: [number, number, number];
  highlights: [number, number, number];
  /** vignette darkening at the corners */
  vignette: number;
}

const NEUTRAL: Grade = { contrast: 1.04, vibrance: 0.12, shadows: [0, 0.004, 0.02], highlights: [0.02, 0.01, -0.01], vignette: 0.16 };

export const GRADES: Record<string, Grade> = {
  // Hanabi Harbor at dusk: violet shadows, lantern-gold light
  hanabi: { contrast: 1.07, vibrance: 0.18, shadows: [0.01, -0.004, 0.026], highlights: [0.045, 0.02, -0.025], vignette: 0.2 },
  // Cloudstep Terraces: clean, airy, cool shade and sunlit warmth
  cloudstep: { contrast: 1.05, vibrance: 0.16, shadows: [-0.01, 0.01, 0.035], highlights: [0.025, 0.018, -0.008], vignette: 0.14 },
  // Kagura Avenue in daylight
  kagura: { contrast: 1.06, vibrance: 0.16, shadows: [-0.005, 0.005, 0.03], highlights: [0.03, 0.015, -0.01], vignette: 0.15 },
  // Sakura Lantern District at night: deep blue-violet, warm lantern pools
  lantern: { contrast: 1.08, vibrance: 0.2, shadows: [0.006, -0.003, 0.035], highlights: [0.035, 0.015, -0.02], vignette: 0.22 },
  // Starfall Observatory: teal sky shade, gold sunset
  starfall: { contrast: 1.06, vibrance: 0.18, shadows: [-0.015, 0.012, 0.04], highlights: [0.04, 0.022, -0.012], vignette: 0.18 },
  // Dawnforge Foundry: teal shadows, ember highlights (the forge glow)
  foundry: { contrast: 1.1, vibrance: 0.14, shadows: [-0.02, 0.012, 0.03], highlights: [0.05, 0.018, -0.03], vignette: 0.22 },
  // Sunset Mile: hot desert light, a cool sky in the shade
  mile: { contrast: 1.07, vibrance: 0.18, shadows: [-0.012, 0.004, 0.032], highlights: [0.04, 0.018, -0.02], vignette: 0.17 },
  // Iron Gulch at golden hour
  gulch: { contrast: 1.08, vibrance: 0.18, shadows: [-0.008, 0.0, 0.03], highlights: [0.05, 0.022, -0.024], vignette: 0.2 },
  training: NEUTRAL,
};
export const gradeFor = (mapId: string | undefined): Grade => (mapId && GRADES[mapId]) || NEUTRAL;

const SHADER = {
  name: 'ZuGrade',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    contrast: { value: 1 }, vibrance: { value: 0 },
    shadows: { value: new THREE.Vector3() }, highlights: { value: new THREE.Vector3() },
    vignette: { value: 0 }, aspect: { value: 16 / 9 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float contrast; uniform float vibrance; uniform vec3 shadows; uniform vec3 highlights;
    uniform float vignette; uniform float aspect; varying vec2 vUv;
    void main(){
      vec4 src = texture2D(tDiffuse, vUv); vec3 c = src.rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      // vibrance: lift the muted colours, leave the vivid ones
      float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
      float sat = mx > 1e-4 ? (mx - mn) / mx : 0.0;
      c = mix(vec3(l), c, 1.0 + vibrance * (1.0 - sat));
      // contrast: a soft S around mid grey (no clipping of the ends)
      c = clamp(c, 0.0, 1.0);
      vec3 s = c * c * (3.0 - 2.0 * c);
      c = mix(c, s, clamp((contrast - 1.0) * 2.5, 0.0, 1.0));
      // split tone
      float ls = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c += shadows * (1.0 - smoothstep(0.0, 0.55, ls)) + highlights * smoothstep(0.45, 1.0, ls);
      // vignette (round on any aspect)
      vec2 d = (vUv - 0.5) * vec2(aspect, 1.0) / max(aspect, 1.0) * 2.0;
      c *= 1.0 - vignette * smoothstep(0.45, 1.35, length(d));
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), src.a);
    }`,
};

export function gradePass(g: Grade): ShaderPass {
  const p = new ShaderPass(SHADER);
  setGrade(p, g);
  return p;
}
export function setGrade(p: ShaderPass, g: Grade) {
  const u = p.uniforms;
  u.contrast.value = g.contrast; u.vibrance.value = g.vibrance;
  (u.shadows.value as THREE.Vector3).set(...g.shadows); (u.highlights.value as THREE.Vector3).set(...g.highlights);
  u.vignette.value = g.vignette;
  u.aspect.value = innerWidth / Math.max(1, innerHeight);
}
