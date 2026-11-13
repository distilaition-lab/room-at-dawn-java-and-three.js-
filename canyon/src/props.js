// Road surface, barriers, signs, boulders and vegetation – all instanced, all generated.
import * as THREE from 'three';
import { LEN, HW, ground, narrow, curvAt, headingAt, K } from './track.js';
import { RNG, canvas, tex, tileNoise, pixelCanvas, normalCanvas, clamp, sstep, fbm3 } from './util.js';
import { std } from './mat.js';
import { rockMat } from './terrain.js';

const ROAD_TILE = 15.6;
function roadTextures() {
  const W = 1024, H = 2048, r = new RNG(3);
  const sp = tileNoise(1024, 256, 2, 21), bl = tileNoise(1024, 6, 5, 22), md = tileNoise(1024, 48, 3, 23);
  const at = (f, x, y) => f[(y & 1023) * 1024 + (x & 1023)];
  const c = pixelCanvas(W, (i, x, y) => {
    const m = (x / W - 0.5) * 7.8, lane = Math.abs(m);
    const track = Math.exp(-Math.pow((lane - 1.15) / 0.38, 2)) + Math.exp(-Math.pow((lane - 2.75) / 0.38, 2));
    let v = 0.235 + 0.085 * (at(sp, x, y) - 0.5) + 0.07 * (at(bl, x >> 1, y >> 1) - 0.5) + 0.04 * (at(md, x, y) - 0.5) - 0.045 * track + 0.03 * sstep(3.3, 3.9, lane);
    return [255 * v * 1.0, 255 * v * 0.985, 255 * v * 0.95];
  }, H), ctx = c.getContext('2d');
  const ro = canvas(W, H), rc = ro.getContext('2d'); rc.fillStyle = 'rgb(0,205,0)'; rc.fillRect(0, 0, W, H);
  // tar crack sealing + patches
  for (let k = 0; k < 26; k++) {
    let x = r.r(0, W), y = r.r(0, H); const long = r.f() < 0.6, n = r.i(20, 70);
    for (const [cx, col, lw] of [[ctx, 'rgba(14,14,15,0.85)', r.r(3, 6)], [rc, 'rgb(0,90,0)', 5]]) {
      const rr = new RNG(k + 100); let px = x, py = y; cx.strokeStyle = col; cx.lineWidth = lw; cx.lineCap = 'round'; cx.beginPath(); cx.moveTo(px, py);
      for (let i = 0; i < n; i++) { px += long ? rr.r(-5, 5) : rr.r(4, 14); py += long ? rr.r(6, 16) : rr.r(-5, 5); cx.lineTo(px, py); } cx.stroke();
    }
  }
  // old rubber
  for (let k = 0; k < 7; k++) { const x = r.r(0.15, 0.85) * W, y = r.r(0, H), l = r.r(200, 700), b = r.r(-60, 60); ctx.strokeStyle = `rgba(10,10,10,${r.r(0.10, 0.28)})`; ctx.lineWidth = r.r(14, 22); for (const o of [0, 215]) { ctx.beginPath(); ctx.moveTo(x + o, y); ctx.quadraticCurveTo(x + o + b, y + l / 2, x + o + b * 2.5, y + l); ctx.stroke(); } }
  // paint: double yellow centre, white edges – worn
  const px = (m) => (m / 7.8 + 0.5) * W, wear = tileNoise(1024, 64, 3, 31);
  const line = (m, w, col) => { for (let y = 0; y < H; y += 2) { const a = at(wear, (m * 97) | 0, y), b = at(wear, 300, y >> 3); if (a * 0.6 + b * 0.5 < 0.36) continue; const g = clamp(0.55 + a * 0.6); ctx.fillStyle = col.replace('A', g.toFixed(2)); ctx.fillRect(px(m - w / 2), y, (w / 7.8) * W, 2); rc.fillStyle = 'rgb(0,150,0)'; rc.fillRect(px(m - w / 2), y, (w / 7.8) * W, 2); } };
  line(-0.11, 0.11, 'rgba(226,168,34,A)'); line(0.11, 0.11, 'rgba(226,168,34,A)'); line(-3.5, 0.13, 'rgba(225,222,210,A)'); line(3.5, 0.13, 'rgba(225,222,210,A)');
  const hf = new Float32Array(1024 * 1024); for (let i = 0; i < hf.length; i++) hf[i] = sp[i] * 0.7 + md[i] * 0.3;
  const o = { srgb: false };
  return { map: tex(c), roughnessMap: tex(ro, o), normalMap: tex(normalCanvas(hf, 1024, 5), o) };
}

function buildRoad() {
  const T = roadTextures(), nr = LEN + 1, nc = 9, P = [], UV = [], idx = [], o = {};
  for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) { const d = -HW + (2 * HW * j) / (nc - 1); ground(i, d, o); P.push(o.x, o.y, o.z); UV.push(j / (nc - 1), i / ROAD_TILE); }
  for (let i = 0; i < nr - 1; i++) for (let j = 0; j < nc - 1; j++) { const a = i * nc + j, b = a + 1, c = a + nc, d = c + 1; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2)); g.setIndex(idx); g.computeVertexNormals();
  T.normalMap.repeat.set(4, 8); T.normalMap.wrapS = T.normalMap.wrapT = THREE.RepeatWrapping;
  const m = std({ map: T.map, roughnessMap: T.roughnessMap, roughness: 1, metalness: 0, normalMap: T.normalMap, normalScale: new THREE.Vector2(0.9, 0.9) });
  // normal map tiles finer than the albedo: sample it with scaled UVs
  m.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n'); };
  const mesh = new THREE.Mesh(g, m); mesh.receiveShadow = true; mesh.frustumCulled = false; return mesh;
}

function inst(geo, mat, list, { cast = true, receive = true, depthMat } = {}) {
  const m = new THREE.InstancedMesh(geo, mat, list.length), M = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  list.forEach((it, i) => { p.set(it.x, it.y, it.z); e.set(it.rx || 0, it.ry || 0, it.rz || 0, 'YXZ'); q.setFromEuler(e); s.set(it.sx ?? it.s ?? 1, it.sy ?? it.s ?? 1, it.sz ?? it.s ?? 1); M.compose(p, q, s); m.setMatrixAt(i, M); });
  m.castShadow = cast; m.receiveShadow = receive; m.frustumCulled = false; if (depthMat) m.customDepthMaterial = depthMat; return m;
}
function foliage(map, color, rough = 0.8) {
  const m = std({ map, color, alphaTest: 0.42, side: THREE.DoubleSide, roughness: rough });
  m.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n normal = normalize(vNormal);'); };
  return m;
}
function card(w, h, y0 = 0, n = [0, 1, 0]) {   // quad in the XY plane, bottom centre at origin
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-w / 2, y0, 0, w / 2, y0, 0, w / 2, y0 + h, 0, -w / 2, y0 + h, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2)); g.setAttribute('normal', new THREE.Float32BufferAttribute([...n, ...n, ...n, ...n], 3)); g.setIndex([0, 1, 2, 0, 2, 3]); return g;
}
function mergeGeo(list) {      // list of [geometry, Matrix4]; positions / normals / uv only
  const P = [], N = [], UV = [], I = []; let base = 0; const v = new THREE.Vector3(), nm = new THREE.Matrix3();
  for (const [g, M] of list) {
    const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv; nm.getNormalMatrix(M);
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(M); P.push(v.x, v.y, v.z); v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize(); N.push(v.x, v.y, v.z); UV.push(u ? u.getX(i) : 0, u ? u.getY(i) : 0); }
    const ix = g.index ? g.index.array : [...Array(p.count).keys()]; for (const k of ix) I.push(k + base); base += p.count;
  }
  const o = new THREE.BufferGeometry(); o.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); o.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); o.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2)); o.setIndex(I); return o;
}
export { mergeGeo, inst, card };
const TM = (x, y, z, rx, ry, rz, s = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(s, s, s));

function branchTex(seed, tree) {
  const W = tree ? 256 : 256, H = tree ? 512 : 128, c = canvas(W, H), x = c.getContext('2d'), r = new RNG(seed);
  const needle = (px, py, a, l, w) => { const g = r.i(58, 110), rr = g * r.r(0.42, 0.7), b = g * r.r(0.22, 0.4); x.strokeStyle = `rgb(${rr | 0},${g},${b | 0})`; x.lineWidth = w; x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); x.stroke(); };
  if (!tree) {
    x.strokeStyle = '#3a2a1c'; x.lineWidth = 4; x.beginPath(); x.moveTo(0, H / 2); x.lineTo(W * 0.9, H / 2); x.stroke();
    for (let i = 0; i < 520; i++) { const t = r.f(), px = t * W * 0.95, s = r.f() < 0.5 ? -1 : 1, l = (1 - t * 0.6) * r.r(22, 58); needle(px, H / 2, s * r.r(0.5, 1.25), l, r.r(1.2, 2.4)); }
  } else {
    x.strokeStyle = '#2e2218'; x.lineWidth = 7; x.beginPath(); x.moveTo(W / 2, H); x.lineTo(W / 2, 20); x.stroke();
    for (let i = 0; i < 2600; i++) { const t = Math.pow(r.f(), 0.8), y = 14 + t * (H * 0.84), hw = 6 + t * W * 0.44, px = W / 2 + r.r(-1, 1) * hw * r.f(), a = (px < W / 2 ? Math.PI : 0) + r.r(-0.3, 0.9) * (px < W / 2 ? -1 : 1); needle(px, y, a, r.r(6, 16), r.r(1.5, 3)); }
  }
  return tex(c, { repeat: false });
}
function grassTex(seed, sage) {
  const W = 256, H = 256, c = canvas(W, H), x = c.getContext('2d'), r = new RNG(seed);
  for (let i = 0; i < (sage ? 900 : 46); i++) {
    if (sage) { const a = r.r(0, Math.PI), d = Math.pow(r.f(), 0.6) * 118, px = W / 2 + Math.cos(a) * d * 1.0, py = H - 6 - Math.sin(a) * d * 1.7; const g = r.i(95, 150); x.fillStyle = `rgb(${(g * 0.82) | 0},${g},${(g * 0.66) | 0})`; x.beginPath(); x.ellipse(px, py, r.r(3, 7), r.r(1.5, 3), r.r(0, 3), 0, 6.3); x.fill(); if (i % 9 === 0) { x.strokeStyle = '#4a3a2a'; x.lineWidth = 2; x.beginPath(); x.moveTo(W / 2, H); x.lineTo(px, py); x.stroke(); } }
    else { const px = W / 2 + r.n() * 22, lean = r.n() * 95, h = r.r(90, 245), g = r.i(120, 190); x.strokeStyle = `rgb(${g},${(g * r.r(0.74, 0.86)) | 0},${(g * r.r(0.36, 0.5)) | 0})`; x.lineWidth = r.r(2.2, 4.2); x.beginPath(); x.moveTo(px, H); x.quadraticCurveTo(px + lean * 0.2, H - h * 0.6, px + lean, H - h); x.stroke(); }
  }
  return tex(c, { repeat: false });
}

function signTex(dir) {
  const c = canvas(128, 160), x = c.getContext('2d'); x.fillStyle = '#e8b414'; x.fillRect(0, 0, 128, 160); x.strokeStyle = '#111'; x.lineWidth = 7; x.strokeRect(5, 5, 118, 150);
  x.fillStyle = '#111'; x.translate(64, 80); x.scale(dir, 1); x.beginPath(); x.moveTo(-34, -56); x.lineTo(4, -56); x.lineTo(38, 0); x.lineTo(4, 56); x.lineTo(-34, 56); x.lineTo(0, 0); x.closePath(); x.fill(); return tex(c, { repeat: false });
}

export function buildProps(log = () => {}) {
  const group = new THREE.Group(), r = new RNG(42), o = {}, o2 = {};
  group.add(buildRoad());
  const slope = (s, d) => { ground(s, d - 1, o); ground(s, d + 1, o2); return Math.abs(o.y - o2.y) / 2; };
  // --- barrier blocks (valley edge) ---
  const bg = new THREE.BoxGeometry(0.52, 0.74, 2.3, 3, 3, 8); { const p = bg.attributes.position, rr = new RNG(9); for (let i = 0; i < p.count; i++) { const k = (fbm3(p.getX(i) * 3, p.getY(i) * 3, p.getZ(i) * 3) - 0.5) * 0.07; p.setXYZ(i, p.getX(i) * (1 + k) * (p.getY(i) > 0.3 ? 0.9 : 1), p.getY(i) + 0.37, p.getZ(i) * (1 + k * 0.3)); } bg.computeVertexNormals(); }
  const cn = tileNoise(512, 8, 6, 41), cs = tileNoise(512, 128, 2, 42);
  const cmap = tex(pixelCanvas(512, (i) => { const v = 0.56 + 0.26 * (cn[i] - 0.5) + 0.2 * (cs[i] - 0.5); const li = cn[i] > 0.66 ? 0.8 : 1; return [255 * v * 0.98 * li, 255 * v * 0.92 * li, 255 * v * 0.80 * li]; }));
  const cbump = tex(pixelCanvas(512, (i) => { const v = 255 * (cs[i] * 0.6 + cn[i] * 0.4); return [v, v, v]; }), { srgb: false });
  const concrete = std({ map: cmap, bumpMap: cbump, bumpScale: 1.5, roughness: 0.92 });
  const bl = []; for (let s = 4; s < LEN - 4; s += 3.15) { if (narrow(s) > 0.25) continue; ground(s, 4.95, o); bl.push({ x: o.x, y: o.y - 0.06, z: o.z, ry: headingAt(s) + r.n() * 0.012, rz: r.n() * 0.012, sy: r.r(0.94, 1.06) }); }
  group.add(inst(bg, concrete, bl));
  // --- delineator posts + chevrons ---
  const pg = new THREE.BoxGeometry(0.1, 1.05, 0.03).translate(0, 0.52, 0), posts = [], chevL = [], chevR = [];
  for (let s = 10; s < LEN; s += 22) { ground(s, -4.55, o); posts.push({ x: o.x, y: o.y, z: o.z, ry: headingAt(s) }); }
  for (let s = 10; s < LEN; s += 14) { const k = curvAt(s + 12); if (Math.abs(k) < 0.0072) continue; const d = k > 0 ? -4.9 : 5.75; ground(s + 12, d, o); (k > 0 ? chevL : chevR).push({ x: o.x, y: o.y + (k > 0 ? 0 : 0.2), z: o.z, ry: headingAt(s + 12) + Math.PI + k * 14 }); }
  group.add(inst(pg, std({ color: 0xd8d8d0, roughness: 0.6, emissive: 0x200800 }), posts));
  const sg = mergeGeo([[new THREE.PlaneGeometry(0.62, 0.78), TM(0, 1.55, 0.03, 0, 0, 0)], [new THREE.BoxGeometry(0.06, 1.95, 0.05).translate(0, 0.975, 0), TM(0, 0, 0, 0, 0, 0)]]);
  group.add(inst(sg, std({ map: signTex(1), roughness: 0.45, metalness: 0.2 }), chevL), inst(sg, std({ map: signTex(-1), roughness: 0.45, metalness: 0.2 }), chevR));
  // --- boulders ---
  const rm = rockMat(false, [1.02, 0.98, 0.94]);
  for (let v = 0; v < 3; v++) {
    const g = new THREE.IcosahedronGeometry(1, 3), p = g.attributes.position, sq = [1, 0.7 + v * 0.1, 0.85];
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 0.62 + 0.75 * fbm3(x * 1.1 + v * 7, y * 1.1, z * 1.1, 4); p.setXYZ(i, x * k * sq[0], y * k * sq[1], z * k * sq[2]); }
    g.computeVertexNormals(); const list = [];
    for (let i = 0; i < 330; i++) {
      const s = r.r(0, LEN), u = r.f(); let d, sc;
      if (u < 0.3) { d = -r.r(4.5, 6.6); sc = r.r(0.07, 0.42); if (r.f() < 0.75) sc *= 0.5; } else if (u < 0.5) { d = r.r(5.6, 9); sc = r.r(0.15, 0.9); } else if (u < 0.8) { d = r.r(8, 150); sc = r.r(0.4, 3.2); } else { d = (r.f() < 0.5 ? -1 : 1) * r.r(12, 320); sc = r.r(0.8, 5); }
      if (d > 4.3 && d < 5.6) continue; ground(s, d, o); list.push({ x: o.x, y: o.y - sc * 0.22, z: o.z, ry: r.r(0, 6.3), rx: r.n() * 0.4, s: sc });
    }
    group.add(inst(g, rm, list));
  }
  // --- pines ---
  log('planting…');
  const bt = branchTex(5, false), tt = branchTex(6, true), parts = [], pr = new RNG(8);
  const trunk = new THREE.CylinderGeometry(0.05, 0.2, 10.5, 6, 3).translate(0, 5.25, 0);
  for (let w = 0; w < 14; w++) { const y = 2.2 + w * 0.6, len = 2.9 * (1 - w / 15) + 0.3; for (let b = 0; b < 5; b++) { const a = b * 1.2566 + w * 0.7 + pr.n() * 0.3, dr = 1.95 + pr.n() * 0.14 - w * 0.02; for (const roll of [0.25, 1.82]) parts.push([card(len * 0.6, len, 0, [0, 0.75, 0.66]), TM(Math.sin(a) * 0.08, y + pr.n() * 0.12, Math.cos(a) * 0.08, dr, a, roll)]); } }
  // branch texture runs along +x of the canvas -> rotate UVs of the cards so the twig starts at the trunk
  for (const [cg] of parts) cg.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 1, 1, 0], 2));
  const crown = mergeGeo(parts), tg = mergeGeo([[trunk, new THREE.Matrix4()]]);
  const near = [], far = [], shrubs = [], grass = [];
  for (let i = 0; i < 5200; i++) {
    const s = r.r(0, LEN), u = r.f(); let d = u < 0.4 ? r.r(6.4, 70) : u < 0.62 ? -r.r(14, 120) : (r.f() < 0.62 ? 1 : -1) * r.r(60, 900);
    const sl = slope(s, d); if (sl > 0.85 || r.f() < sl * 0.7) continue; ground(s, d, o);
    const it = { x: o.x, y: o.y - 0.3, z: o.z, ry: r.r(0, 6.3), s: r.r(0.62, 1.5), rx: r.n() * 0.04, rz: r.n() * 0.04 }; it.sy = it.s * r.r(0.9, 1.3);
    (Math.abs(d) < 75 ? near : far).push(it);
  }
  const fmat = foliage(bt, 0xb8c8a0), dm = new THREE.MeshDepthMaterial({ map: bt, alphaTest: 0.42 });
  group.add(inst(crown, fmat, near, { depthMat: dm }), inst(tg, std({ color: 0x3a2b20, roughness: 0.95 }), near));
  const fc = mergeGeo([0, 1.05, 2.1].map((a) => [card(5.2, 11.5, 0, [0, 0.8, 0.6]), TM(0, 0, 0, 0, a, 0)]));
  group.add(inst(fc, foliage(tt, 0xa8b890), far, { depthMat: new THREE.MeshDepthMaterial({ map: tt, alphaTest: 0.42 }) }));
  // --- shrubs + dry grass ---
  for (let i = 0; i < 2600; i++) { const s = r.r(0, LEN), d = (r.f() < 0.55 ? 1 : -1) * (r.f() < 0.5 ? r.r(5.5, 16) : r.r(10, 200)); if (d < 0 && d > -7 && r.f() < 0.6) continue; const sl = slope(s, d); if (sl > 1.1) continue; ground(s, d, o); shrubs.push({ x: o.x, y: o.y - 0.08, z: o.z, ry: r.r(0, 6.3), s: r.r(0.45, 1.5) }); }
  for (let i = 0; i < 9000; i++) { const s = r.r(0, LEN), d = (r.f() < 0.5 ? 1 : -1) * (r.f() < 0.72 ? r.r(4.35, 7.5) : r.r(6, 60)); if (d > 4.5 && d < 5.4 && narrow(s) < 0.25) continue; const sl = slope(s, d); if (sl > 1.3) continue; ground(s, d, o); grass.push({ x: o.x, y: o.y - 0.03, z: o.z, ry: r.r(0, 6.3), s: r.r(0.25, 0.75), sy: r.r(0.25, 0.9) }); }
  const st = grassTex(3, true), gt = grassTex(4, false);
  const sgeo = mergeGeo([0, 1, 2, 3, 4].map((k) => [card(1.5, 1.05, 0, [0, 0.85, 0.5]), TM(0, 0, 0, k === 4 ? -1.1 : -0.25, k * 1.5708 + 0.4, 0)]));
  group.add(inst(sgeo, foliage(st, 0xb9c0a8), shrubs, { depthMat: new THREE.MeshDepthMaterial({ map: st, alphaTest: 0.42 }) }));
  const ggeo = mergeGeo([0, 1.05, 2.1].map((a) => [card(1.0, 1.0, 0, [0, 0.9, 0.4]), TM(0, 0, 0, 0, a, 0)]));
  const gm = foliage(gt, 0xffffff, 0.7); gm.emissive = new THREE.Color(0x120c04); gm.emissiveMap = gt;
  group.add(inst(ggeo, gm, grass, { cast: false }));
  return group;
}
