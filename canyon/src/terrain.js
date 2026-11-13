// Canyon terrain: one swept grid around the road (dense near it, coarse far away), craggy rock displacement,
// triplanar procedural rock/dirt material with strata.
import * as THREE from 'three';
import { LEN, HW, ground, profile, base } from './track.js';
import { fbm3, noise2, tileNoise, sstep, clamp, RNG, lerp } from './util.js';
import { baked, std } from './mat.js';

function dataTex(n, m, fn, srgb = true) {
  const d = new Uint8Array(n * m * 4);
  for (let y = 0; y < m; y++) for (let x = 0; x < n; x++) { const i = y * n + x, p = fn(i, x, y); d[i * 4] = p[0]; d[i * 4 + 1] = p[1]; d[i * 4 + 2] = p[2]; d[i * 4 + 3] = p[3]; }
  const t = new THREE.DataTexture(d, n, m, THREE.RGBAFormat); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 8; t.needsUpdate = true; return t;
}
export function rockTextures() {
  const n = 1024;
  const a = tileNoise(n, 4, 7, 1), b = tileNoise(n, 6, 6, 2, true), c = tileNoise(n, 24, 4, 3), cr = tileNoise(n, 5, 5, 4, true), sp = tileNoise(n, 96, 2, 5);
  const tRock = dataTex(n, n, (i) => {
    const crack = Math.pow(cr[i], 7) * 0.9, h = clamp(a[i] * 0.55 + b[i] * 0.35 + c[i] * 0.18 - crack * 0.6);
    const v = 0.50 + 0.55 * a[i] + 0.30 * (c[i] - 0.5) - crack * 0.75, sk = sp[i] > 0.74 ? 0.86 : 1;
    return [255 * clamp(v * 0.92 * sk), 255 * clamp(v * 0.80 * sk), 255 * clamp(v * 0.68 * sk), 255 * h];
  });
  const p = tileNoise(n, 40, 3, 6), g = tileNoise(n, 128, 2, 7), l = tileNoise(n, 5, 4, 8);
  const tDirt = dataTex(n, n, (i) => {
    const peb = sstep(0.55, 0.72, p[i]), v = 0.58 + 0.25 * l[i] + 0.2 * (g[i] - 0.5) + peb * 0.12;
    return [255 * clamp(v * 0.84), 255 * clamp(v * 0.70), 255 * clamp(v * 0.52), 255 * clamp(peb * 0.7 + g[i] * 0.3)];
  });
  const r = new RNG(77), bands = []; let y = 0;
  const pal = [[0.80, 0.60, 0.42], [0.72, 0.50, 0.34], [0.86, 0.72, 0.56], [0.62, 0.44, 0.32], [0.76, 0.66, 0.56], [0.68, 0.48, 0.30], [0.58, 0.50, 0.44], [0.84, 0.64, 0.44]];
  while (y < 512) { const w = r.i(2, 22); bands.push([y, pal[r.i(0, pal.length - 1)], r.f() < 0.2 ? r.r(0.5, 0.7) : r.r(0.8, 1.15)]); y += w; }
  const tStrata = dataTex(1, 512, (i, x, yy) => { let k = 0; while (k < bands.length - 1 && bands[k + 1][0] <= yy) k++; const A = bands[k], B = bands[(k + 1) % bands.length], t = sstep(0.6, 1, (yy - A[0]) / Math.max(1, (k < bands.length - 1 ? B[0] : 512) - A[0])); return [0, 1, 2].map((j) => 255 * clamp(lerp(A[1][j] * A[2], B[1][j] * B[2], t) * 0.5)).concat(255); });
  return { tRock, tDirt, tStrata };
}

let TX = null;
/** Triplanar rock material. bakedAttr: uses the aBake vertex attribute (terrain) – boulders pass false. */
export function rockMat(bakedAttr = true, tint = [1, 1, 1]) {
  TX = TX || rockTextures();
  const m = std({ color: 0xffffff, roughness: 0.93, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.tRock = { value: TX.tRock }; sh.uniforms.tDirt = { value: TX.tDirt }; sh.uniforms.tStrata = { value: TX.tStrata }; sh.uniforms.uTint = { value: new THREE.Color(...tint) };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        { vec4 w4 = vec4(transformed, 1.0); vec3 n3 = objectNormal;
        #ifdef USE_INSTANCING
          w4 = instanceMatrix * w4; n3 = mat3(instanceMatrix) * n3;
        #endif
          vWP = (modelMatrix * w4).xyz; vWN = normalize(mat3(modelMatrix) * n3); }`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vWP; varying vec3 vWN; uniform sampler2D tRock, tDirt, tStrata; uniform vec3 uTint; float tH;
      vec3 bumpN(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection) {
        vec3 vSigmaX = normalize(dFdx(surf_pos.xyz)); vec3 vSigmaY = normalize(dFdy(surf_pos.xyz)); vec3 vN = surf_norm;
        vec3 R1 = cross(vSigmaY, vN); vec3 R2 = cross(vN, vSigmaX); float fDet = dot(vSigmaX, R1) * faceDirection;
        vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2); return normalize(abs(fDet) * surf_norm - vGrad); }`)
      .replace('#include <map_fragment>', `{
        vec3 nW = normalize(vWN); vec3 bw = pow(abs(nW), vec3(6.0)); bw /= (bw.x + bw.y + bw.z);
        vec4 rock = texture2D(tRock, vWP.zy * 0.11) * bw.x + texture2D(tRock, vWP.xz * 0.11) * bw.y + texture2D(tRock, vWP.xy * 0.11) * bw.z;
        vec4 det = texture2D(tRock, vWP.zy * 0.9) * bw.x + texture2D(tRock, vWP.xz * 0.9) * bw.y + texture2D(tRock, vWP.xy * 0.9) * bw.z;
        vec4 mac = texture2D(tRock, vWP.zy * 0.013) * bw.x + texture2D(tRock, vWP.xz * 0.013) * bw.y + texture2D(tRock, vWP.xy * 0.013) * bw.z;
        vec4 dirt = texture2D(tDirt, vWP.xz * 0.31); vec4 dirtL = texture2D(tDirt, vWP.xz * 0.023);
        vec3 strata = texture2D(tStrata, vec2(0.5, vWP.y * 0.0085 + mac.a * 0.10 + dot(vWP.xz, vec2(0.0006, 0.0003)))).rgb * 2.0;
        vec3 rc = rock.rgb * mix(0.6, 1.25, det.r) * strata * mix(0.6, 1.25, mac.r) * mix(0.5, 1.12, smoothstep(0.15, 0.7, rock.a));
        rc *= mix(1.0, 0.55, smoothstep(0.5, 0.75, mac.g * (1.0 - bw.y)));                 // dark desert varnish streaks on steep faces
        float fl = smoothstep(0.60, 0.84, nW.y + (rock.a - 0.5) * 0.3);
        vec3 dc = dirt.rgb * mix(0.75, 1.15, dirtL.r) * vec3(0.92, 0.78, 0.60);
        dc = mix(dc, vec3(0.30, 0.31, 0.16) * (0.6 + dirt.r), smoothstep(0.50, 0.64, dirtL.g + mac.b * 0.2) * 0.75);   // dry scrub
        diffuseColor.rgb = mix(rc, dc, fl) * uTint;
        tH = mix(rock.a * 0.85 + det.a * 0.08 + mac.a * 2.6, dirt.a * 0.035, fl);
      }`)
      .replace('#include <normal_fragment_maps>', 'normal = bumpN(-vViewPosition, normal, vec2(dFdx(tH), dFdy(tH)), faceDirection);');
  };
  if (bakedAttr) baked(m, 'rock'); else m.customProgramCacheKey = () => 'rockplain';
  return m;
}

function cols(a0, a1, mul, add) { const o = []; for (let a = a0; a < a1; a = a * mul + add) o.push(a); o.push(a1); return o; }

function sweep(ds, sideCols, drop, chunkRows, mat, group, crag) {
  const lat = [...sideCols.slice().reverse().map((a) => -a), ...sideCols];   // d from -far ... -near, +near ... +far
  const nc = lat.length, nr = Math.floor(LEN / ds) + 1, half = sideCols.length;
  const P = new Float32Array(nr * nc * 3), Nn = new Float32Array(nr * nc * 3), o = {};
  for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) { ground(i * ds, lat[j], o); const k = (i * nc + j) * 3; P[k] = o.x; P[k + 1] = o.y - drop - (Math.abs(lat[j]) < HW ? 0.05 : 0); P[k + 2] = o.z; }
  const normals = () => {
    for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) {
      const k = (i * nc + j) * 3, ia = Math.max(0, i - 1), ib = Math.min(nr - 1, i + 1);
      let ja = Math.max(0, j - 1), jb = Math.min(nc - 1, j + 1); if (j === half) ja = j; if (j === half - 1) jb = j;   // don't difference across the road gap
      const a = (ia * nc + j) * 3, b = (ib * nc + j) * 3, c = (i * nc + ja) * 3, d = (i * nc + jb) * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[d] - P[c], vy = P[d + 1] - P[c + 1], vz = P[d + 2] - P[c + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
      Nn[k] = nx / l; Nn[k + 1] = ny / l; Nn[k + 2] = nz / l;
    }
  };
  normals();
  if (crag) {
    for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) {
      const a = Math.abs(lat[j]); if (a < 6.2) continue; const k = (i * nc + j) * 3, st = 1 - Nn[k + 1];
      const x = P[k], y = P[k + 1], z = P[k + 2];
      const pill = Math.pow(1 - Math.abs(2 * noise2(x / 5.5 + y * 0.03, z / 5.5) - 1), 2.2), blk = fbm3(x / 15, y / 6, z / 15, 3), stp = (Math.floor(blk * 9) / 9 - blk) * 9;
      const dsp = ((fbm3(x / 11, y / 11, z / 11, 4) - 0.5) * 7 + (fbm3(x / 3.1, y / 3.1, z / 3.1, 3) - 0.5) * 2.0 + pill * 2.4 + stp * 1.3 + 1.0) * sstep(0.12, 0.6, st) * sstep(6.2, 10, a) * Math.min(1, 0.4 + a / 60);
      P[k] += Nn[k] * dsp; P[k + 1] += Nn[k + 1] * dsp * 0.4; P[k + 2] += Nn[k + 2] * dsp;
    }
    normals();
  }
  for (let r0 = 0; r0 < nr - 1; r0 += chunkRows) {
    const r1 = Math.min(nr - 1, r0 + chunkRows), rows = r1 - r0 + 1, g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P.slice(r0 * nc * 3, (r1 + 1) * nc * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(Nn.slice(r0 * nc * 3, (r1 + 1) * nc * 3), 3));
    g.setAttribute('aBake', new THREE.BufferAttribute(new Float32Array(rows * nc * 2).fill(1), 2));
    const idx = [];
    for (let i = 0; i < rows - 1; i++) for (let j = 0; j < nc - 1; j++) { if (j === half - 1) continue; const a = i * nc + j, b = a + 1, c = a + nc, d = c + 1; idx.push(a, c, b, b, c, d); }
    g.setIndex(idx); g.computeBoundingSphere(); g.computeBoundingBox();
    const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true; m.userData.terrain = true; group.add(m);
  }
}

export function buildTerrain() {
  const group = new THREE.Group(), mat = rockMat(true);
  sweep(2, cols(HW - 0.25, 62, 1.06, 0.25).concat(cols(70, 124, 1.12, 0).slice(0)), 0, 40, mat, group, true);
  sweep(8, cols(104, 2700, 1.13, 2), 1.2, 60, mat, group, true);
  return group;
}
