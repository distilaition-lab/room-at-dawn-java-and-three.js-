// Scene assembly: sky, sun, environment light, fog, terrain bake.
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SUN, SUN_COLOR, U } from './mat.js';
import { buildTerrain } from './terrain.js';
import { buildProps } from './props.js';
import { tileNoise, pixelCanvas, tex, RNG } from './util.js';

const g = (v) => `vec3(${v.x.toFixed(4)}, ${v.y.toFixed(4)}, ${v.z.toFixed(4)})`;
function makeSky() {
  const n = tileNoise(512, 4, 6, 11), n2 = tileNoise(512, 3, 5, 12, true);
  const tN = tex(pixelCanvas(512, (i) => [n[i] * 255, n2[i] * 255, 0]), { srgb: false });
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms: { tN: { value: tN }, uDisc: { value: 1 } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0); gl_Position = p.xyww; }',
    fragmentShader: /* glsl */`precision highp float; varying vec3 vDir; uniform sampler2D tN; uniform float uDisc;
    void main(){
      vec3 d = normalize(vDir); float cs = dot(d, ${g(SUN)}), mu = max(cs, 0.0), y = max(d.y, 0.0);
      vec3 hor = mix(vec3(0.46, 0.56, 0.76), vec3(1.9, 1.12, 0.52), pow(mu, 2.2));
      vec3 c = mix(hor, vec3(0.085, 0.19, 0.50), pow(y, 0.40));
      c += vec3(1.5, 0.85, 0.38) * pow(mu, 22.0) * 0.7 + vec3(2.2, 1.5, 0.8) * pow(mu, 350.0) * 2.5;
      vec2 uv = d.xz / (d.y + 0.10);
      float cn = texture2D(tN, uv * vec2(0.021, 0.052) + vec2(0.13, 0.37)).r * 0.62 + texture2D(tN, uv * vec2(0.09, 0.17)).g * 0.38;
      float cl = smoothstep(0.50, 0.74, cn) * smoothstep(0.0, 0.14, d.y);
      vec3 cc = mix(vec3(0.62, 0.52, 0.60), vec3(2.6, 1.55, 0.85), pow(mu, 1.6)) * (0.75 + 0.5 * cn);
      c = mix(c, cc, cl * 0.8);
      c += vec3(1.0, 0.78, 0.5) * 42.0 * uDisc * smoothstep(0.99992, 0.99997, cs);
      c = mix(c, vec3(0.30, 0.25, 0.22), smoothstep(0.0, -0.06, d.y));
      gl_FragColor = vec4(c, 1.0);
    }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat); m.frustumCulled = false; m.renderOrder = -10; return m;
}

async function bakeTerrain(terrain, log) {
  const meshes = terrain.children, total = meshes.reduce((a, m) => a + m.geometry.attributes.position.count, 0);
  const url = `bake/terrain_${total}.bin`;
  let data = null;
  try { const r = await fetch(url); if (r.ok && (r.headers.get('content-type') || '').indexOf('html') < 0) { const b = new Float32Array(await r.arrayBuffer()); if (b.length === total * 2) data = b; } } catch (e) { /* bake below */ }
  if (!data) {
    log('baking canyon light…');
    const merged = mergeGeometries(meshes.map((m) => { const q = new THREE.BufferGeometry(); q.setAttribute('position', m.geometry.attributes.position); q.setIndex(m.geometry.index); return q; }));
    const bvh = new MeshBVH(merged), ray = new THREE.Ray(), rng = new RNG(5), T = new THREE.Vector3(), B = new THREE.Vector3(), N = new THREE.Vector3();
    data = new Float32Array(total * 2); let o = 0;
    const dirs = []; for (let i = 0; i < 10; i++) { const u = (i + 0.5) / 10, a = i * 2.399963, r = Math.sqrt(u); dirs.push([Math.cos(a) * r, Math.sin(a) * r, Math.sqrt(1 - u)]); }
    for (const m of meshes) {
      const P = m.geometry.attributes.position, Nn = m.geometry.attributes.normal;
      for (let i = 0; i < P.count; i++, o++) {
        N.fromBufferAttribute(Nn, i); ray.origin.fromBufferAttribute(P, i).addScaledVector(N, 0.25); ray.origin.y += 0.15;
        let vis = 0; for (let k = 0; k < 3; k++) { ray.direction.copy(SUN); ray.direction.x += (rng.f() - 0.5) * 0.03; ray.direction.y += (rng.f() - 0.5) * 0.03; ray.direction.normalize(); if (!bvh.raycastFirst(ray, THREE.DoubleSide)) vis++; }
        T.set(N.y, -N.x, 0); if (T.lengthSq() < 0.01) T.set(0, N.z, -N.y); T.normalize(); B.crossVectors(N, T);
        const rot = rng.f() * 6.283, cr = Math.cos(rot), sr = Math.sin(rot); let occ = 0;
        for (const d of dirs) { const dx = d[0] * cr - d[1] * sr, dy = d[0] * sr + d[1] * cr; ray.direction.set(0, 0, 0).addScaledVector(T, dx).addScaledVector(B, dy).addScaledVector(N, d[2]).normalize(); const h = bvh.raycastFirst(ray, THREE.DoubleSide); if (h && h.distance < 140) occ += 1 - 0.5 * h.distance / 140; }
        data[o * 2] = vis / 3; data[o * 2 + 1] = 1 - 0.68 * occ / dirs.length;
      }
    }
    try { await fetch('/api/save?path=canyon/bake/' + url.split('/')[1], { method: 'POST', body: data.buffer }); } catch (e) { /* not on the dev server */ }
  }
  let o = 0; for (const m of meshes) { const a = m.geometry.attributes.aBake; a.array.set(data.subarray(o * 2, (o + a.count) * 2)); a.needsUpdate = true; o += a.count; }
}

export async function buildWorld(renderer, log = () => {}) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x8090a0, 0.00042);
  const sky = makeSky(); sky.scale.setScalar(9000); scene.add(sky);
  const sun = new THREE.DirectionalLight(SUN_COLOR, 9.0);
  sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096); sun.shadow.bias = -0.00012; sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target, new THREE.HemisphereLight(0x9db6ff, 0xb9804c, 1.5));
  // environment light from the sky itself
  const pm = new THREE.PMREMGenerator(renderer), envScene = new THREE.Scene(); const s2 = makeSky(); s2.material.uniforms.uDisc.value = 0.25; s2.scale.setScalar(50); envScene.add(s2);
  let envRT = pm.fromScene(envScene, 0, 0.1, 100); scene.environment = envRT.texture; scene.environmentIntensity = 2.0;
  log('raising the canyon…');
  const terrain = buildTerrain(); scene.add(terrain);
  await bakeTerrain(terrain, log);
  const props = buildProps(log); scene.add(props);
  const cubeRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType, generateMipmaps: false }), cubeCam = new THREE.CubeCamera(0.5, 6000, cubeRT);
  const world = {
    scene, sun, sky, terrain, hide: [],
    /** Shadow map covers a square of half-size R around c. */
    setShadow(c, R) {
      sun.target.position.copy(c); sun.position.copy(c).addScaledVector(SUN, 900); sun.target.updateMatrixWorld(); sun.updateMatrixWorld();
      const sc = sun.shadow.camera; sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = 10; sc.far = 1500; sc.updateProjectionMatrix();
      sun.shadow.normalBias = 0.02 + R * 0.0009; U.uShadowC.value.copy(c); U.uShadowR.value = R;
    },
    /** Re-capture environment reflections at a point (the car is hidden while capturing). */
    captureEnv(p) {
      const vis = world.hide.map((o) => o.visible); world.hide.forEach((o) => (o.visible = false));
      cubeCam.position.copy(p); cubeCam.update(renderer, scene);
      const old = envRT; envRT = pm.fromCubemap(cubeRT.texture); scene.environment = envRT.texture; if (old) old.dispose();
      world.hide.forEach((o, i) => (o.visible = vis[i]));
    },
  };
  return world;
}
