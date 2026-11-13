// Material plumbing shared by everything: aerial-perspective fog, the "dynamic object" flag the motion blur
// reads from alpha, and baked sun visibility / sky occlusion for the terrain.
import * as THREE from 'three';

export const SUN = new THREE.Vector3(0.227, 0.342, 0.912).normalize();
export const SUN_COLOR = new THREE.Color(1.0, 0.62, 0.34);
export const U = {                       // uniforms shared by patched materials
  uShadowC: { value: new THREE.Vector3() }, uShadowR: { value: 60 }, uTime: { value: 0 },
};
const g = (v) => `vec3(${v.x.toFixed(4)}, ${v.y.toFixed(4)}, ${v.z.toFixed(4)})`;
export const FOG_GLSL = /* glsl */`
vec3 applyFog(vec3 col, vec3 dirW, float camY, float density) {
  float dist = length(dirW); vec3 fd = dirW / max(dist, 1e-4);
  const float k = 0.0075; float dy = fd.y * dist;
  float od = density * exp(-k * (camY - 20.0)) * (abs(dy) < 1e-2 ? dist : dist * (1.0 - exp(-k * dy)) / (k * dy));
  float f = 1.0 - exp(-od);
  float mu = max(dot(fd, ${g(SUN)}), 0.0);
  vec3 fc = mix(vec3(0.30, 0.42, 0.62), vec3(1.25, 0.80, 0.46), pow(mu, 5.0) * 0.85 + 0.12) * (1.0 + 2.5 * pow(mu, 40.0));
  return mix(col, fc, f);
}`;
THREE.ShaderChunk.fog_pars_vertex = '#ifdef USE_FOG\n varying float vFogDepth; varying vec3 vFogDir;\n#endif';
THREE.ShaderChunk.fog_vertex = '#ifdef USE_FOG\n vFogDepth = -mvPosition.z; vFogDir = mvPosition.xyz * mat3(viewMatrix);\n#endif';
THREE.ShaderChunk.fog_pars_fragment = '#ifdef USE_FOG\n uniform vec3 fogColor; uniform float fogDensity; varying float vFogDepth; varying vec3 vFogDir;\n' + FOG_GLSL + '\n#endif';
THREE.ShaderChunk.fog_fragment = '#ifdef USE_FOG\n gl_FragColor.rgb = applyFog(gl_FragColor.rgb, vFogDir, cameraPosition.y, fogDensity);\n#endif';
// alpha channel of the HDR buffer: 1 = static world, DYN_FLAG = rigid body the camera may be tracking
THREE.ShaderChunk.dithering_fragment += '\n#ifdef DYN_FLAG\n gl_FragColor.a = DYN_FLAG;\n#endif\n';

/** Mark a material as belonging to the car (its screen motion comes from the car's transform, not the camera's). */
export function dyn(m) { m.defines = m.defines || {}; m.defines.DYN_FLAG = '0.5'; return m; }

/** Terrain-type material: attribute aBake = (sun visibility, sky occlusion). Baked sun is used outside the shadow-map radius. */
export function baked(m, extra) {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aBake; varying vec2 vBake; uniform vec3 uShadowC; uniform float uShadowR;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n { vec4 w4 = modelMatrix * vec4(position, 1.0); float w = smoothstep(uShadowR * 0.82, uShadowR * 0.98, max(abs(w4.x - uShadowC.x), abs(w4.z - uShadowC.z))); vBake = vec2(mix(1.0, aBake.x, w), aBake.y); }');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vBake;')
      .replace('getDirectionalLightInfo( directionalLight, directLight );', 'getDirectionalLightInfo( directionalLight, directLight ); directLight.color *= vBake.x;')
      .replace('#include <aomap_fragment>', 'reflectedLight.indirectDiffuse *= vBake.y; reflectedLight.indirectSpecular *= vBake.y;');
  };
  m.customProgramCacheKey = () => 'baked' + (extra || '');
  return m;
}
export const std = (p) => new THREE.MeshStandardMaterial(p);
export const phys = (p) => new THREE.MeshPhysicalMaterial(p);
