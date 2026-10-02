// AMD FidelityFX Super Resolution 1 (FSR1) as the last post pass (engine core): EASU, the edge-adaptive spatial
// upsampler, from the scene's render resolution to the screen's, then RCAS, the robust contrast-adaptive sharpener.
// Ported to GLSL ES 3.0 from AMD's ffx_fsr1.h (FidelityFX, MIT licence, Copyright (c) 2021 Advanced Micro Devices).
// It runs on the display-referred picture (after tone mapping, OutputPass and AA), as FSR1 expects. With the scene at
// 75% scale this is ~44% fewer pixels shaded for an image close to native - the same trade Rainbow Six Siege made with
// checkerboarding and Fortnite makes with TSR. At native scale it is RCAS only; above native (supersampling) it is a
// linear downsample.
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

const VERT = /* glsl */`
out vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const EASU = /* glsl */`
precision highp float;
uniform sampler2D tSrc;
uniform vec2 inSize;     // source pixels
uniform vec2 outSize;    // destination pixels
in vec2 vUv;
out vec4 outColor;

vec3 tap(ivec2 p) { return clamp(texelFetch(tSrc, clamp(p, ivec2(0), ivec2(inSize) - 1), 0).rgb, 0.0, 1.0); }
float luma(vec3 c) { return c.b * 0.5 + (c.r * 0.5 + c.g); }

// accumulate direction and length from one of the four bilinear quadrants (a "+" of taps: A above, B left, C centre,
// D right, E below), weighted by the quadrant's bilinear weight
void setDir(inout vec2 dir, inout float len, float w, float lA, float lB, float lC, float lD, float lE) {
  float dc = lD - lC, cb = lC - lB;
  float lenX = max(abs(dc), abs(cb));
  lenX = 1.0 / max(lenX, 1.0 / 65536.0);
  float dirX = lD - lB;
  dir.x += dirX * w;
  lenX = clamp(abs(dirX) * lenX, 0.0, 1.0);
  len += lenX * lenX * w;
  float ec = lE - lC, ca = lC - lA;
  float lenY = max(abs(ec), abs(ca));
  lenY = 1.0 / max(lenY, 1.0 / 65536.0);
  float dirY = lE - lA;
  dir.y += dirY * w;
  lenY = clamp(abs(dirY) * lenY, 0.0, 1.0);
  len += lenY * lenY * w;
}

// one tap of the stretched, rotated lanczos-2 approximation
void tapW(inout vec3 aC, inout float aW, vec2 off, vec2 dir, vec2 len2, float lob, float clp, vec3 c) {
  vec2 v = vec2(off.x * dir.x + off.y * dir.y, off.x * -dir.y + off.y * dir.x) * len2;
  float d2 = min(dot(v, v), clp);
  float wB = 2.0 / 5.0 * d2 - 1.0;
  float wA = lob * d2 - 1.0;
  wB *= wB; wA *= wA;
  wB = 25.0 / 16.0 * wB - (25.0 / 16.0 - 1.0);
  float w = wB * wA;
  aC += c * w; aW += w;
}

void main() {
  // source position of this output pixel, texel centres on integers
  vec2 pp = gl_FragCoord.xy * (inSize / outSize) - 0.5;
  vec2 fp = floor(pp);
  pp -= fp;
  ivec2 f0 = ivec2(fp);
  //    b c
  //  e f g h
  //  i j k l
  //    n o
  vec3 bC = tap(f0 + ivec2(0, -1)), cC = tap(f0 + ivec2(1, -1));
  vec3 eC = tap(f0 + ivec2(-1, 0)), fC = tap(f0), gC = tap(f0 + ivec2(1, 0)), hC = tap(f0 + ivec2(2, 0));
  vec3 iC = tap(f0 + ivec2(-1, 1)), jC = tap(f0 + ivec2(0, 1)), kC = tap(f0 + ivec2(1, 1)), lC = tap(f0 + ivec2(2, 1));
  vec3 nC = tap(f0 + ivec2(0, 2)), oC = tap(f0 + ivec2(1, 2));
  float bL = luma(bC), cL = luma(cC), eL = luma(eC), fL = luma(fC), gL = luma(gC), hL = luma(hC);
  float iL = luma(iC), jL = luma(jC), kL = luma(kC), lL = luma(lC), nL = luma(nC), oL = luma(oC);
  vec2 dir = vec2(0.0); float len = 0.0;
  setDir(dir, len, (1.0 - pp.x) * (1.0 - pp.y), bL, eL, fL, gL, jL);
  setDir(dir, len, pp.x * (1.0 - pp.y), cL, fL, gL, hL, kL);
  setDir(dir, len, (1.0 - pp.x) * pp.y, fL, iL, jL, kL, nL);
  setDir(dir, len, pp.x * pp.y, gL, jL, kL, lL, oL);
  // normalise the direction (no edge = axis aligned)
  float dirR = dot(dir, dir);
  bool zro = dirR < 1.0 / 32768.0;
  dirR = zro ? 1.0 : inversesqrt(dirR);
  dir.x = zro ? 1.0 : dir.x;
  dir *= dirR;
  // edge length shapes the kernel: stretched along a long edge, a sharper lobe across it
  len = len * 0.5; len *= len;
  float stretch = dot(dir, dir) / max(abs(dir.x), abs(dir.y));
  vec2 len2 = vec2(1.0 + (stretch - 1.0) * len, 1.0 - 0.5 * len);
  float lob = 0.5 + ((1.0 / 4.0 - 0.04) - 0.5) * len;
  float clp = 1.0 / lob;
  vec3 aC = vec3(0.0); float aW = 0.0;
  tapW(aC, aW, vec2(0.0, -1.0) - pp, dir, len2, lob, clp, bC);
  tapW(aC, aW, vec2(1.0, -1.0) - pp, dir, len2, lob, clp, cC);
  tapW(aC, aW, vec2(-1.0, 1.0) - pp, dir, len2, lob, clp, iC);
  tapW(aC, aW, vec2(0.0, 1.0) - pp, dir, len2, lob, clp, jC);
  tapW(aC, aW, vec2(0.0, 0.0) - pp, dir, len2, lob, clp, fC);
  tapW(aC, aW, vec2(-1.0, 0.0) - pp, dir, len2, lob, clp, eC);
  tapW(aC, aW, vec2(1.0, 1.0) - pp, dir, len2, lob, clp, kC);
  tapW(aC, aW, vec2(2.0, 1.0) - pp, dir, len2, lob, clp, lC);
  tapW(aC, aW, vec2(2.0, 0.0) - pp, dir, len2, lob, clp, hC);
  tapW(aC, aW, vec2(1.0, 0.0) - pp, dir, len2, lob, clp, gC);
  tapW(aC, aW, vec2(1.0, 2.0) - pp, dir, len2, lob, clp, oC);
  tapW(aC, aW, vec2(0.0, 2.0) - pp, dir, len2, lob, clp, nC);
  // de-ring: stay inside the range of the 2x2 the pixel sits in
  vec3 mn = min(min(fC, gC), min(jC, kC)), mx = max(max(fC, gC), max(jC, kC));
  outColor = vec4(clamp(aC / aW, mn, mx), 1.0);
}`;

const RCAS = /* glsl */`
precision highp float;
uniform sampler2D tSrc;
uniform float sharp;     // exp2(-stops): 1 = strongest
in vec2 vUv;
out vec4 outColor;
#define RCAS_LIMIT (0.25 - 1.0 / 16.0)
vec3 tap(ivec2 p) { ivec2 s = textureSize(tSrc, 0); return clamp(texelFetch(tSrc, clamp(p, ivec2(0), s - 1), 0).rgb, 0.0, 1.0); }
float luma(vec3 c) { return c.b * 0.5 + (c.r * 0.5 + c.g); }
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  //   b
  // d e f
  //   h
  vec3 b = tap(p + ivec2(0, -1)), d = tap(p + ivec2(-1, 0)), e = tap(p), f = tap(p + ivec2(1, 0)), h = tap(p + ivec2(0, 1));
  float bL = luma(b), dL = luma(d), eL = luma(e), fL = luma(f), hL = luma(h);
  // noise detection: a lone bright/dark pixel is sharpened less
  float nz = 0.25 * (bL + dL + fL + hL) - eL;
  float rng = max(max(max(bL, dL), max(fL, hL)), eL) - min(min(min(bL, dL), min(fL, hL)), eL);
  nz = clamp(abs(nz) / max(rng, 1.0 / 65536.0), 0.0, 1.0);
  nz = -0.5 * nz + 1.0;
  // the strongest lobe that doesn't clip the ring's range
  vec3 mn4 = min(min(b, d), min(f, h)), mx4 = max(max(b, d), max(f, h));
  vec3 hitMin = min(mn4, e) / max(4.0 * mx4, vec3(1.0 / 65536.0));
  vec3 hitMax = (1.0 - max(mx4, e)) / min(4.0 * mn4 - 4.0, vec3(-1.0 / 65536.0));
  vec3 lobeRGB = max(-hitMin, hitMax);
  float lobe = max(-RCAS_LIMIT, min(max(lobeRGB.r, max(lobeRGB.g, lobeRGB.b)), 0.0)) * sharp;
  lobe *= nz;
  vec3 c = (lobe * (b + d + f + h) + e) / (4.0 * lobe + 1.0);
  outColor = vec4(c, 1.0);
}`;

const COPY = /* glsl */`
precision highp float;
uniform sampler2D tSrc;
in vec2 vUv;
out vec4 outColor;
void main() { outColor = vec4(texture(tSrc, vUv).rgb, 1.0); }`;

const mat = (frag: string, uniforms: Record<string, THREE.IUniform>) => new THREE.ShaderMaterial({
  glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, toneMapped: false,
});

const _size = new THREE.Vector2();

export class FsrPass extends Pass {
  /** RCAS strength in stops (0 = strongest, 2 = mild); FSR's default is 0.2 */
  sharpness = 0.25;
  /** what the last frame did: 'fsr' (EASU+RCAS), 'rcas', 'down' */
  mode: 'fsr' | 'rcas' | 'down' | 'linear' = 'rcas';
  /** A/B: upscale with plain bilinear filtering instead (what the browser does to a scaled canvas) */
  forceLinear = false;
  private easu = mat(EASU, { tSrc: { value: null }, inSize: { value: new THREE.Vector2() }, outSize: { value: new THREE.Vector2() } });
  private rcas = mat(RCAS, { tSrc: { value: null }, sharp: { value: 1 } });
  private copy = mat(COPY, { tSrc: { value: null } });
  private quad = new FullScreenQuad();
  private mid: THREE.WebGLRenderTarget | null = null;

  constructor() {
    super();
    this.needsSwap = true;
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    const src = readBuffer.texture;
    const iw = readBuffer.width, ih = readBuffer.height;
    let ow: number, oh: number;
    if (this.renderToScreen) { renderer.getDrawingBufferSize(_size); ow = _size.x; oh = _size.y; } else { ow = writeBuffer.width; oh = writeBuffer.height; }
    const target = this.renderToScreen ? null : writeBuffer;
    this.rcas.uniforms.sharp.value = Math.pow(2, -this.sharpness);
    if (iw > ow + 1 || ih > oh + 1) {
      // supersampled: plain linear downsample (sharpening a downsample only adds ringing)
      this.mode = 'down';
      this.copy.uniforms.tSrc.value = src;
      this.draw(renderer, this.copy, target);
    } else if ((iw < ow - 1 || ih < oh - 1) && this.forceLinear) {
      this.mode = 'linear';
      this.copy.uniforms.tSrc.value = src;
      this.draw(renderer, this.copy, target);
    } else if (iw < ow - 1 || ih < oh - 1) {
      this.mode = 'fsr';
      if (!this.mid) this.mid = new THREE.WebGLRenderTarget(ow, oh, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
      if (this.mid.width !== ow || this.mid.height !== oh) this.mid.setSize(ow, oh);
      this.easu.uniforms.tSrc.value = src;
      (this.easu.uniforms.inSize.value as THREE.Vector2).set(iw, ih);
      (this.easu.uniforms.outSize.value as THREE.Vector2).set(ow, oh);
      this.draw(renderer, this.easu, this.mid);
      this.rcas.uniforms.tSrc.value = this.mid.texture;
      this.draw(renderer, this.rcas, target);
    } else {
      this.mode = 'rcas';
      this.rcas.uniforms.tSrc.value = src;
      this.draw(renderer, this.rcas, target);
    }
  }

  /** compile every program variant this pass can use (into a target and onto the screen: three keys programs by the
   *  output colour space, which differs between the two) so none compiles in the middle of a match */
  warm(renderer: THREE.WebGLRenderer) {
    const prev = renderer.getRenderTarget();
    const src = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
    const dst = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
    for (const m of [this.easu, this.rcas, this.copy]) {
      m.uniforms.tSrc.value = src.texture;
      this.draw(renderer, m, dst);
      this.draw(renderer, m, null);
    }
    renderer.setRenderTarget(prev);
    src.dispose(); dst.dispose();
  }

  private draw(renderer: THREE.WebGLRenderer, m: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null) {
    this.quad.material = m;
    renderer.setRenderTarget(target);
    this.quad.render(renderer);
  }

  dispose() {
    this.easu.dispose(); this.rcas.dispose(); this.copy.dispose(); this.quad.dispose(); this.mid?.dispose();
  }
}
