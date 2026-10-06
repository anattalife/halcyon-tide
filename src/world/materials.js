// Shared materials and the shader patch that gives every surface (a) texture-array
// finishes selected per vertex and (b) a baked "interior artificial lighting" term
// that is independent of the sun, so cabins and venues stay lit at night while the
// exterior follows the time of day.
import * as THREE from 'three';

export const shared = {
  uIntLight: { value: new THREE.Color(1.0, 0.88, 0.74).multiplyScalar(0.82) },
  uTime: { value: 0 },
  uNight: { value: 0 },          // 0 day … 1 night (window glow, deck lights)
  uExtAmb: { value: new THREE.Color(0.3, 0.33, 0.38) },
  uWet: { value: 0 },            // 0 dry … 1 soaked exterior decks (driven from game.weather.wetness)
};

const VERT_PRE = `
attribute float aInt;
varying float vInt;
#ifdef USE_LAYERS
attribute float aLayer;
attribute float aRough;
varying float vLayer;
varying float vRough;
varying vec2 vUvA;
varying float vWetK;
#endif
`;
const FRAG_PRE = `
uniform vec3 uIntLight;
uniform float uIntDefault;
varying float vInt;
#ifdef USE_LAYERS
uniform highp sampler2DArray uArr;
uniform float uWet;
varying float vLayer;
varying float vRough;
varying vec2 vUvA;
varying float vWetK;
#endif
`;

export function patchSurface(mat, { array = null, intDefault = 0, key = '', wet = false, glowLayers = null } = {}) {
  mat.userData.intDefault = { value: intDefault };
  if (array) mat.defines = { ...(mat.defines || {}), USE_LAYERS: '' };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uIntLight = shared.uIntLight;
    sh.uniforms.uIntDefault = mat.userData.intDefault;
    if (array) { sh.uniforms.uArr = { value: array }; sh.uniforms.uWet = shared.uWet; }
    sh.vertexShader = VERT_PRE + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vInt = aInt;
      #ifdef USE_LAYERS
      vLayer = aLayer; vRough = aRough; vUvA = uv;
      // wet-deck mask: exterior (aInt == 0) surfaces facing up
      vWetK = (1.0 - step(0.01, aInt)) * smoothstep(0.6, 0.9, normalize(mat3(modelMatrix) * objectNormal).y);
      #endif`);
    let f = FRAG_PRE + sh.fragmentShader;
    if (array) {
      f = f.replace('#include <map_fragment>', `#include <map_fragment>
        vec4 layTex = texture(uArr, vec3(vUvA, floor(vLayer + 0.5)));
        diffuseColor *= layTex;
        float wetK = ${wet ? 'uWet * vWetK * (1.0 - step(0.01, uIntDefault))' : '0.0'};
        diffuseColor.rgb *= 1.0 - 0.25 * wetK;`);
      f = f.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(vRough, min(vRough, 0.08), wetK * 0.9);`);
      f = f.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        reflectedLight.indirectSpecular *= 1.0 + 0.2 * wetK;`);
    }
    if (array && glowLayers) {
      // self-lit details painted into dark ceiling finishes (cove strips, rigging spots): bright texels of the listed
      // layers glow with the interior lighting level (so blackouts / emergency mode dim them too)
      f = f.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        { float L = floor(vLayer + 0.5);
          if (L > ${(glowLayers[0] - 0.5).toFixed(1)} && L < ${(glowLayers[1] + 0.5).toFixed(1)}) {
            float lum = dot(layTex.rgb, vec3(0.3, 0.55, 0.15));
            totalEmissiveRadiance += layTex.rgb * smoothstep(0.42, 0.85, lum) * 2.2 * dot(uIntLight, vec3(0.42)) * step(0.01, vInt);
          } }`);
    }
    f = f.replace('#include <aomap_fragment>', `#include <aomap_fragment>
      { float ik = step(0.01, max(vInt, uIntDefault)); reflectedLight.indirectDiffuse *= mix(1.0, 0.22, ik); reflectedLight.indirectSpecular *= mix(1.0, 0.45, ik); }`);
    f = f.replace('vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;',
      'vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + diffuseColor.rgb * uIntLight * max(vInt, uIntDefault);');
    sh.fragmentShader = f;
  };
  mat.customProgramCacheKey = () => 'surf' + (array ? 'L' : '') + key + (glowLayers ? 'G' : '');
  return mat;
}

let cache = null;
export function getMaterials(arrays) {
  if (cache) return cache;
  const floor = patchSurface(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.0 }), { array: arrays.floor, key: 'f', wet: true });
  const wall = patchSurface(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.0 }), { array: arrays.wall, key: 'w' });
  const ceil = patchSurface(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.0 }), { array: arrays.ceil, key: 'c', glowLayers: [4, 5] });
  const plain = patchSurface(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.1 }), { key: 'p' });
  const metal = patchSurface(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.8, side: THREE.DoubleSide }), { key: 'm' });
  // Interior glazing: solar-tinted (darker, slightly bronze-grey) so a sunset seen from the dining rooms doesn't blow out
  // to white through the bloom pass; still clear enough to read the sea.
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x55636a, roughness: 0.04, metalness: 0.0, transmission: 0, transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.0 });
  const railGlass = new THREE.MeshPhysicalMaterial({ color: 0xbfd6dd, roughness: 0.05, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.2 });
  // Opaque lit windows for chunks whose interiors aren't shown. aInt carries a per-pane level (0 dark … 1 bright) whose
  // fractional digits pick a colour (warm lamp / cool TV / neutral) so the facade at night reads as individual rooms with
  // curtains, not one white sheet: the glow is strongest at the top of the pane (curtain gap) and well below bloom levels.
  const shellGlass = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.08, metalness: 0.6, envMapIntensity: 1.4 });
  shellGlass.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = shared.uNight;
    sh.vertexShader = 'attribute float aInt;\nvarying float vLit;\nvarying vec2 vPUv;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvLit = aInt; vPUv = uv;');
    sh.fragmentShader = 'uniform float uNight;\nvarying float vLit;\nvarying vec2 vPUv;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      { float pick = fract(vLit * 37.0);
        vec3 c = pick < 0.62 ? vec3(1.0,0.72,0.42) : pick < 0.82 ? vec3(1.0,0.86,0.66) : vec3(0.55,0.68,1.0);
        float curtain = mix(0.45, 1.0, smoothstep(0.15, 0.95, vPUv.y));
        totalEmissiveRadiance += c * (0.06 + 0.62 * uNight) * vLit * curtain; }`);
  };
  shellGlass.customProgramCacheKey = () => 'shellGlass';
  const fixture = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.92, 0.8).multiplyScalar(2.2), toneMapped: false });
  const contact = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, vertexColors: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  // Pool water: transparent, glossy, with animated ripples & caustic shimmer
  const water = new THREE.MeshStandardMaterial({ color: 0x2aa7c4, roughness: 0.04, metalness: 0.0, transparent: true, opacity: 0.78, envMapIntensity: 1.3, depthWrite: false });
  water.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = shared.uTime; sh.uniforms.uNight = shared.uNight;
    sh.vertexShader = 'varying vec3 vWPw;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPw = (modelMatrix * vec4(transformed,1.0)).xyz;');
    sh.fragmentShader = 'uniform float uTime; uniform float uNight; varying vec3 vWPw;\n' + sh.fragmentShader
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        { vec2 p = vWPw.xz; float t = uTime;
          float a = sin(p.x*3.1 + t*1.7) + sin(p.y*2.7 - t*1.3) + 0.6*sin((p.x+p.y)*5.3 + t*2.9) + 0.4*sin((p.x-p.y)*7.1 - t*3.3);
          float bx = cos(p.x*3.1 + t*1.7)*3.1 + 0.6*cos((p.x+p.y)*5.3 + t*2.9)*5.3 + 0.4*cos((p.x-p.y)*7.1 - t*3.3)*7.1;
          float bz = -cos(p.y*2.7 - t*1.3)*2.7*-1.0 + 0.6*cos((p.x+p.y)*5.3 + t*2.9)*5.3 - 0.4*cos((p.x-p.y)*7.1 - t*3.3)*7.1;
          vec3 pn = normalize(vec3(-bx*0.012, 1.0, -bz*0.012));
          normal = normalize((viewMatrix * vec4(pn, 0.0)).xyz); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        { vec2 p = vWPw.xz * 1.7; float t = uTime * 0.8;
          float c = abs(sin(p.x + sin(p.y*1.3 + t)) * sin(p.y + sin(p.x*1.1 - t*1.2)));
          totalEmissiveRadiance += vec3(0.25,0.75,0.9) * pow(1.0 - c, 6.0) * 0.18 + vec3(0.1,0.55,0.75) * uNight * 0.35; }`);
  };
  water.customProgramCacheKey = () => 'poolwater';
  // venue cove strips (emissive, vertex-coloured) and the soft additive wall wash under them
  const cove = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const wash = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  cache = { floor, wall, ceil, plain, metal, glass, railGlass, shellGlass, fixture, contact, water, cove, wash };
  return cache;
}
