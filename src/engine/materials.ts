import { Color, MeshLambertMaterial, Vector3 } from 'three';
import { FLOOR_HEIGHT } from '../config';

/** Number of tiles that can be highlighted at once (hover, fading-out hover, selection). */
export const HIGHLIGHT_SLOTS = 3;

/**
 * Shared uniforms for tile highlights. Each slot is (tileX, tileZ, strength) plus a colour; every
 * fragment whose world position falls inside a highlighted tile is tinted and made to glow, so a
 * hovered building lights up as a whole regardless of how its geometry was merged.
 */
export const highlightUniforms = {
  uHighlight: { value: Array.from({ length: HIGHLIGHT_SLOTS }, () => new Vector3(-1, -1, 0)) },
  uHighlightColor: { value: Array.from({ length: HIGHLIGHT_SLOTS }, () => new Color(0xffffff)) },
};

/** Exposure for the material's own tone mapping (only used with `manualToneMapping`). */
export const exposureUniform = { uCityExposure: { value: 1 } };

/** three.js' ACES filmic curve, inlined so it can run while rendering into an off-screen target. */
const ACES_GLSL = `
  uniform float uCityExposure;
  vec3 cityRRTAndODTFit(vec3 v) {
    vec3 a = v * (v + 0.0245786) - 0.000090537;
    vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
    return a / b;
  }
  vec3 cityAces(vec3 color) {
    const mat3 inputMat = mat3(
      vec3(0.59719, 0.07600, 0.02840),
      vec3(0.35458, 0.90834, 0.13383),
      vec3(0.04823, 0.01566, 0.83777));
    const mat3 outputMat = mat3(
      vec3(1.60475, -0.10208, -0.00327),
      vec3(-0.53108, 1.10813, -0.07276),
      vec3(-0.07367, -0.00605, 1.07602));
    color *= uCityExposure / 0.6;
    color = outputMat * cityRRTAndODTFit(inputMat * color);
    return clamp(color, 0.0, 1.0);
  }
`;

/**
 * The material used by every static chunk mesh and the map's base.
 *
 * Walls tagged with an `aWindow` style get a procedural window grid computed from world position,
 * so a 20-storey tower costs the same number of vertices as a shed. The grid fades to its average
 * tint at a distance to avoid moire.
 *
 * With `manualToneMapping` the material applies ACES itself. three.js skips tone mapping when
 * rendering into an off-screen target, and the FXAA path needs tone-mapped (LDR) colour there so it
 * can use a cheap 8-bit sRGB buffer without clipping highlights.
 */
export function createCityMaterial({ manualToneMapping = false } = {}): MeshLambertMaterial {
  const material = new MeshLambertMaterial({ vertexColors: true });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, highlightUniforms, exposureUniform);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float aWindow;
        varying float vWindow;
        varying vec3 vCityPos;
        varying vec3 vCityNormal;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vWindow = aWindow;
        #ifdef USE_INSTANCING
          vCityPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        #else
          vCityPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #endif
        vCityNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying float vWindow;
        varying vec3 vCityPos;
        varying vec3 vCityNormal;
        uniform vec3 uHighlight[${HIGHLIGHT_SLOTS}];
        uniform vec3 uHighlightColor[${HIGHLIGHT_SLOTS}];
        ${manualToneMapping ? ACES_GLSL : ''}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        if (vWindow > 0.5 && abs(vCityNormal.y) < 0.5) {
          float horiz = abs(vCityNormal.x) > 0.5 ? vCityPos.z : vCityPos.x;
          float style = floor(vWindow + 0.5);
          // Offices: tall glass bands. Homes: small punched windows. Industry: high clerestory strips.
          vec2 size = style == 2.0 ? vec2(0.1, ${FLOOR_HEIGHT.toFixed(3)}) : vec2(0.14, ${FLOOR_HEIGHT.toFixed(3)});
          vec2 cell = vec2(horiz, vCityPos.y) / size;
          vec2 f = fract(cell);
          vec2 lo = style == 2.0 ? vec2(0.08, 0.18) : style == 3.0 ? vec2(0.12, 0.62) : vec2(0.24, 0.32);
          vec2 hi = style == 2.0 ? vec2(0.92, 0.9) : style == 3.0 ? vec2(0.88, 0.86) : vec2(0.76, 0.8);
          float mask = step(lo.x, f.x) * step(f.x, hi.x) * step(lo.y, f.y) * step(f.y, hi.y);
          // Keep the ground floor of homes and industry solid-ish (doors, loading bays).
          if (style != 2.0 && vCityPos.y < ${(FLOOR_HEIGHT * 0.3).toFixed(3)}) mask = 0.0;
          vec2 fw = fwidth(cell);
          float fade = 1.0 - smoothstep(0.3, 0.7, max(fw.x, fw.y));
          float coverage = (hi.x - lo.x) * (hi.y - lo.y);
          vec3 glass = style == 2.0 ? vec3(0.06, 0.12, 0.2) : vec3(0.09, 0.11, 0.14);
          float amount = mix(coverage * 0.8, mask * 0.85, fade);
          diffuseColor.rgb = mix(diffuseColor.rgb, glass, amount);
        }
        vec2 cityTile = floor(vCityPos.xz);
        for (int k = 0; k < ${HIGHLIGHT_SLOTS}; k++) {
          float s = uHighlight[k].z;
          if (s > 0.001 && cityTile == uHighlight[k].xy) {
            diffuseColor.rgb = mix(diffuseColor.rgb, uHighlightColor[k], s * 0.26);
            totalEmissiveRadiance += uHighlightColor[k] * s * 0.14;
          }
        }`,
      );
    if (manualToneMapping) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <tonemapping_fragment>',
        'gl_FragColor.rgb = cityAces(gl_FragColor.rgb);',
      );
    }
  };
  material.customProgramCacheKey = () => `city-material-v3${manualToneMapping ? '-aces' : ''}`;
  return material;
}
