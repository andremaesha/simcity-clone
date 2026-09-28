import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  ColorManagement,
  LinearToneMapping,
  NeutralToneMapping,
  RawShaderMaterial,
  SRGBTransfer,
  ToneMapping,
  Vector2,
  WebGLRenderTarget,
  WebGLRenderer,
} from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';

const vertexShader = /* glsl */ `
  precision highp float;
  uniform mat4 modelViewMatrix;
  uniform mat4 projectionMatrix;
  attribute vec3 position;
  attribute vec2 uv;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  uniform sampler2D tDiffuse;
  uniform vec2 texel;
  #include <tonemapping_pars_fragment>
  #include <colorspace_pars_fragment>
  varying vec2 vUv;

  #define FXAA_REDUCE_MIN (1.0 / 128.0)
  #define FXAA_REDUCE_MUL (1.0 / 8.0)
  #define FXAA_SPAN_MAX 8.0

  vec3 tap(vec2 uv) { return texture2D(tDiffuse, uv).rgb; }
  // Edge detection wants perceptual brightness; sqrt is a cheap stand-in for the sRGB curve.
  float luma(vec3 c) { return sqrt(dot(c, vec3(0.299, 0.587, 0.114))); }

  vec3 toDisplay(vec3 c) {
    #if defined(ACES_FILMIC_TONE_MAPPING)
      c = ACESFilmicToneMapping(c);
    #elif defined(AGX_TONE_MAPPING)
      c = AgXToneMapping(c);
    #elif defined(NEUTRAL_TONE_MAPPING)
      c = NeutralToneMapping(c);
    #elif defined(LINEAR_TONE_MAPPING)
      c = LinearToneMapping(c);
    #endif
    #ifdef SRGB_TRANSFER
      c = sRGBTransferOETF(vec4(c, 1.0)).rgb;
    #endif
    return c;
  }

  void main() {
    vec3 rgbM = tap(vUv);
    float lM = luma(rgbM);
    float lNW = luma(tap(vUv + vec2(-1.0, -1.0) * texel));
    float lNE = luma(tap(vUv + vec2(1.0, -1.0) * texel));
    float lSW = luma(tap(vUv + vec2(-1.0, 1.0) * texel));
    float lSE = luma(tap(vUv + vec2(1.0, 1.0) * texel));
    float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
    float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));

    vec3 color = rgbM;
    // Flat areas (most of the screen) skip the edge search.
    if (lMax - lMin >= max(0.0312, lMax * 0.125)) {
      vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
      float reduce = max((lNW + lNE + lSW + lSE) * 0.25 * FXAA_REDUCE_MUL, FXAA_REDUCE_MIN);
      float rcpMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + reduce);
      dir = clamp(dir * rcpMin, vec2(-FXAA_SPAN_MAX), vec2(FXAA_SPAN_MAX)) * texel;
      vec3 rgbA = 0.5 * (tap(vUv + dir * (1.0 / 3.0 - 0.5)) + tap(vUv + dir * (2.0 / 3.0 - 0.5)));
      vec3 rgbB = rgbA * 0.5 + 0.25 * (tap(vUv - dir * 0.5) + tap(vUv + dir * 0.5));
      float lB = luma(rgbB);
      color = (lB < lMin || lB > lMax) ? rgbA : rgbB;
    }
    gl_FragColor = vec4(toDisplay(color), 1.0);
  }
`;

const TONE_MAPPING_DEFINES: Partial<Record<ToneMapping, string>> = {
  [LinearToneMapping]: 'LINEAR_TONE_MAPPING',
  [ACESFilmicToneMapping]: 'ACES_FILMIC_TONE_MAPPING',
  [AgXToneMapping]: 'AGX_TONE_MAPPING',
  [NeutralToneMapping]: 'NEUTRAL_TONE_MAPPING',
};

/**
 * Final post-processing pass: a light FXAA (5 taps, plus 4 along detected edges) followed by the
 * renderer's tone mapping and sRGB encoding, all in one full-screen draw. Replaces OutputPass +
 * three's FXAAShader, which together cost about three times as much on integrated GPUs.
 */
export class OutputFxaaPass extends Pass {
  private readonly material: RawShaderMaterial;
  private readonly quad: FullScreenQuad;
  private configuredFor = '';

  constructor() {
    super();
    this.material = new RawShaderMaterial({
      name: 'OutputFxaa',
      uniforms: {
        tDiffuse: { value: null },
        toneMappingExposure: { value: 1 },
        texel: { value: new Vector2(1 / 1024, 1 / 1024) },
      },
      vertexShader,
      fragmentShader,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  /** Called by EffectComposer with the drawing-buffer size (pixel ratio already applied). */
  override setSize(width: number, height: number): void {
    this.material.uniforms.texel.value.set(1 / width, 1 / height);
  }

  override render(renderer: WebGLRenderer, writeBuffer: WebGLRenderTarget, readBuffer: WebGLRenderTarget): void {
    const u = this.material.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.toneMappingExposure.value = renderer.toneMappingExposure;

    const key = `${renderer.outputColorSpace}:${renderer.toneMapping}`;
    if (key !== this.configuredFor) {
      this.configuredFor = key;
      const defines: Record<string, string> = {};
      if (ColorManagement.getTransfer(renderer.outputColorSpace) === SRGBTransfer) defines.SRGB_TRANSFER = '';
      const tone = TONE_MAPPING_DEFINES[renderer.toneMapping];
      if (tone) defines[tone] = '';
      this.material.defines = defines;
      this.material.needsUpdate = true;
    }

    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  override dispose(): void {
    this.material.dispose();
    this.quad.dispose();
  }
}
