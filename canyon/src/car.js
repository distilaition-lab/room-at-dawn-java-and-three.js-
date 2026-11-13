// The car: an original mid-engined hypercar lofted from section curves, with wheels, cockpit, driver, dash
// stopwatch and engine. Local axes: +Z forward, +X left, +Y up, origin on the ground under the centre.
import * as THREE from 'three';
import { curve, canvas, tex, RNG, clamp, tileNoise, pixelCanvas } from './util.js';
import { dyn, std, phys } from './mat.js';
import { mergeGeo } from './props.js';

const Z0 = -2.28, Z1 = 2.28, ZL = Z1 - Z0, WR = 0.345, AX = [1.36, -1.34], TRACK = 0.835, ARCH = 0.388;
const fW = curve([[-2.28, 0.80], [-2.0, 0.94], [-1.4, 1.0], [-0.6, 0.985], [0.2, 0.945], [0.9, 0.955], [1.4, 0.98], [1.9, 0.93], [2.15, 0.80], [2.28, 0.56]]);
const fBot = curve([[-2.28, 0.37], [-1.9, 0.30], [-1.5, 0.17], [-0.5, 0.13], [1.6, 0.13], [2.1, 0.15], [2.28, 0.19]]);
const fTop = curve([[-2.28, 0.80], [-2.0, 0.86], [-1.4, 0.90], [-0.9, 0.85], [-0.3, 0.74], [0.4, 0.70], [0.9, 0.72], [1.4, 0.765], [1.8, 0.70], [2.1, 0.58], [2.28, 0.46]]);
const fDeck = curve([[-2.28, 0.79], [-1.6, 0.86], [-0.9, 0.88], [0.9, 0.72], [1.4, 0.66], [1.9, 0.58], [2.28, 0.42]]);
const fWc = curve([[-1.78, 0.28], [-1.2, 0.52], [-0.4, 0.66], [0.3, 0.68], [0.8, 0.62], [1.06, 0.50]]);
const fYc = curve([[-1.78, 0.88], [-1.2, 1.02], [-0.5, 1.14], [-0.05, 1.17], [0.4, 1.12], [0.8, 0.95], [1.06, 0.73]]);
const NV = 36, NZ = 128, CZ0 = -1.78, CZ1 = 1.06;

function section(z) {     // half section, bottom centre -> top centre
  const W = fW(z), yb = fBot(z), yt = fTop(z), yd = fDeck(z), h = yt - yb;
  const P = [[0, yb], [0.55 * W, yb], [0.93 * W, yb + 0.02], [W, yb + 0.38 * h], [0.975 * W, yb + 0.72 * h], [0.84 * W, yt], [0.5 * W, yd + (yt - yd) * 0.4], [0, yd]];
  const g = (i) => (i < 0 ? [-P[1][0], P[1][1]] : i > 7 ? [-P[6][0], P[6][1]] : P[i]), out = [];
  for (let k = 0; k < NV; k++) {
    const f = (k / (NV - 1)) * 7, i = Math.min(6, Math.floor(f)), t = f - i, p0 = g(i - 1), p1 = g(i), p2 = g(i + 1), p3 = g(i + 2), t2 = t * t, t3 = t2 * t;
    out.push([0, 1].map((c) => 0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3)));
  }
  out[0][0] = 0; out[NV - 1][0] = 0; return out;
}
// UV-space lookups so the livery can be drawn in side / top view
const sideV = (z, y) => { const s = section(z); for (let j = 10; j < 26; j++) if (s[j + 1][1] >= y) return (j + clamp((y - s[j][1]) / (s[j + 1][1] - s[j][1] || 1))) / (NV - 1); return 25 / (NV - 1); };
const topV = (z, x) => { const s = section(z); for (let j = 25; j < NV - 1; j++) if (s[j + 1][0] <= x) return (j + clamp((s[j][0] - x) / (s[j][0] - s[j + 1][0] || 1))) / (NV - 1); return 1; };

function bodyTextures() {
  const W = 2048, H = 1024, c = canvas(W, H), x = c.getContext('2d'), m = canvas(W, H), y = m.getContext('2d');
  const PAINT = '#4b5058', CARBON = '#0b0b0c', ACC = '#ff5a14';
  x.fillStyle = PAINT; x.fillRect(0, 0, W, H); y.fillStyle = 'rgb(255,80,210)'; y.fillRect(0, 0, W, H);       // R clearcoat, G roughness, B metalness
  const px = (z) => ((z - Z0) / ZL) * W, py = (v) => (1 - v) * H;
  const poly = (pts, mapv, fill, mfill, stroke, lw = 3) => {
    for (const [cx, f] of [[x, fill], [y, mfill]]) { if (!f) continue; cx.beginPath(); pts.forEach((p, i) => { const X = px(p[0]), Y = py(mapv(p[0], p[1])); i ? cx.lineTo(X, Y) : cx.moveTo(X, Y); }); if (stroke) { cx.strokeStyle = f; cx.lineWidth = lw; cx.lineJoin = cx.lineCap = 'round'; cx.stroke(); } else { cx.closePath(); cx.fillStyle = f; cx.fill(); } }
  };
  const dense = (pts, n = 14) => { const o = []; for (let i = 0; i < pts.length - 1; i++) for (let k = 0; k < n; k++) o.push([pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k / n, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k / n]); o.push(pts[pts.length - 1]); return o; };
  const MC = 'rgb(255,95,0)', MV = 'rgb(0,235,0)';
  // carbon lower body
  x.fillStyle = CARBON; x.fillRect(0, py(0.335), W, H); y.fillStyle = MC; y.fillRect(0, py(0.335), W, H);
  // twin gloss stripes over the deck
  for (const sx of [0.10, 0.20]) poly(dense([[Z0, sx], [Z1, sx * 0.9]]), topV, '#15171a', 'rgb(255,40,120)', true, 26);
  // accent pinstripe along the sill, door shut lines
  poly(dense([[-1.0, 0.245], [0.9, 0.225]]), sideV, ACC, 'rgb(255,70,0)', true, 5);
  for (const zz of [0.78, -0.42]) poly(dense([[zz, 0.2], [zz + 0.03, 0.5], [zz - 0.04, fTop(zz) - 0.01]]), sideV, '#101114', MV, true, 3);
  poly(dense([[0.78, 0.215], [-0.42, 0.215]]), sideV, '#101114', MV, true, 3);
  // side intake behind the door, front fascia mouth, fender louvres, hood vents
  poly(dense([[-0.50, 0.36], [-0.52, 0.55], [-0.68, 0.60], [-0.94, 0.52], [-0.90, 0.38], [-0.50, 0.36]], 8), sideV, '#050506', MV);
  poly(dense([[2.28, 0.2], [2.28, 0.36], [2.12, 0.40], [1.98, 0.36], [1.96, 0.21], [2.28, 0.2]], 8), sideV, '#050506', MV);
  for (let k = 0; k < 4; k++) poly(dense([[1.16 + k * 0.11, 0.62], [1.20 + k * 0.11, 0.82]]), topV, '#060607', MV, true, 9);
  poly(dense([[1.55, 0.14], [1.9, 0.12], [1.92, 0.36], [1.6, 0.44], [1.55, 0.14]], 8), topV, '#070708', MV);
  poly(dense([[1.0, 0.0], [1.02, 0.5]]), topV, '#101114', MV, true, 3);
  return { map: tex(c, { repeat: false }), mat: tex(m, { repeat: false, srgb: false }) };
}

function loft() {
  const P = [], UV = [], flag = [], idx = [];
  for (let i = 0; i <= NZ; i++) {
    const z0 = Z0 + (ZL * i) / NZ, s = section(z0);
    for (let j = 0; j < NV; j++) {
      let [x, y] = s[j], z = z0, f = 0;
      if (j >= 9 && j <= 27) for (const zc of AX) { const dz = z - zc, dy = y - WR, r = Math.hypot(dz, dy); if (r < ARCH) { f = 1; if (dy < 0) z = zc + Math.sign(dz || 1) * Math.sqrt(ARCH * ARCH - dy * dy); else if (r > 1e-3) { z = zc + (dz / r) * ARCH; y = WR + (dy / r) * ARCH; } } }
      if (j < 9 && x > 0.6) for (const zc of AX) if (Math.abs(z - zc) < ARCH - 0.01) f = 1;
      if (j > 25 && ((z0 > -0.72 && z0 < 0.97) || (z0 > -1.46 && z0 < -0.8)) && x < fWc(z0) - 0.05) f = 1;
      P.push(x, y, z); UV.push(i / NZ, j / (NV - 1)); flag.push(f);
    }
  }
  for (let i = 0; i < NZ; i++) for (let j = 0; j < NV - 1; j++) { const a = i * NV + j, b = a + NV, c = a + 1, d = b + 1; if (!(flag[a] && flag[c] && flag[b])) idx.push(a, c, b); if (!(flag[b] && flag[c] && flag[d])) idx.push(b, c, d); }
  return finishHalf(P, UV, idx, NV);
}
function finishHalf(P, UV, idx, nv) {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2)); g.setIndex(idx); g.computeVertexNormals();
  const n = g.attributes.normal, p = g.attributes.position; for (let i = 0; i < n.count; i++) if (Math.abs(p.getX(i)) < 1e-5) { const l = Math.hypot(n.getY(i), n.getZ(i)) || 1; n.setXYZ(i, 0, n.getY(i) / l, n.getZ(i) / l); }
  const mir = g.clone(); mir.scale(-1, 1, 1); const mi = mir.index.array; for (let i = 0; i < mi.length; i += 3) { const t = mi[i + 1]; mi[i + 1] = mi[i + 2]; mi[i + 2] = t; }
  return mergeGeo([[g, new THREE.Matrix4()], [mir, new THREE.Matrix4()]]);
}
function canopy() {
  const nz = 70, nv = 20, P = [], UV = [], idx = [];
  for (let i = 0; i <= nz; i++) { const z = CZ0 + ((CZ1 - CZ0) * i) / nz, w = fWc(z), b = fDeck(z) - 0.07, t = fYc(z); for (let j = 0; j <= nv; j++) { const th = (j / nv) * Math.PI / 2; P.push(w * Math.pow(Math.cos(th), 0.72), b + (t - b) * Math.pow(Math.sin(th), 0.86), z); UV.push(i / nz, j / nv); } }
  for (let i = 0; i < nz; i++) for (let j = 0; j < nv; j++) { const a = i * (nv + 1) + j, b = a + nv + 1, c = a + 1, d = b + 1; idx.push(a, c, b, b, c, d); }
  return finishHalf(P, UV, idx, nv + 1);
}
function canopyMask() {
  const W = 1024, H = 512, c = canvas(W, H), x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, W, H); x.fillStyle = '#fff';
  const px = (z) => ((z - CZ0) / (CZ1 - CZ0)) * W, py = (v) => (1 - v) * H;
  const blob = (pts) => { x.beginPath(); pts.forEach((p, i) => (i ? x.lineTo(px(p[0]), py(p[1])) : x.moveTo(px(p[0]), py(p[1])))); x.closePath(); x.lineJoin = 'round'; x.lineWidth = 14; x.strokeStyle = '#fff'; x.fill(); x.stroke(); };
  blob([[0.50, 1.02], [0.47, 0.62], [0.60, 0.40], [0.98, 0.34], [1.0, 1.02]]);                       // windscreen
  blob([[0.40, 0.56], [0.52, 0.34], [0.86, 0.20], [0.80, 0.13], [-0.36, 0.15], [-0.44, 0.44], [-0.2, 0.56]]);   // side window
  blob([[-0.78, 1.02], [-0.78, 0.60], [-1.42, 0.50], [-1.46, 1.02]]);                                 // engine cover
  return tex(c, { repeat: false, srgb: false });
}

function tyreTex() {
  const W = 1024, H = 256, c = canvas(W, H), x = c.getContext('2d'); x.fillStyle = '#808080'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#b0b0b0'; x.fillRect(0, H * 0.3, W, H * 0.4);
  x.fillStyle = '#303030'; for (const v of [0.4, 0.5, 0.6]) x.fillRect(0, H * v - 3, W, 6);
  x.strokeStyle = '#3a3a3a'; x.lineWidth = 4; for (let i = 0; i < 64; i++) { const u = (i / 64) * W; x.beginPath(); x.moveTo(u, H * 0.3); x.lineTo(u + 10, H * 0.39); x.moveTo(u + 8, H * 0.61); x.lineTo(u, H * 0.7); x.stroke(); }
  x.fillStyle = '#c8c8c8'; x.font = 'bold 30px sans-serif'; for (let k = 0; k < 4; k++) for (const v of [0.14, 0.86]) { x.save(); x.translate(k * 256 + 30, H * v + 10); x.fillText('VELOCE  R/S', 0, 0); x.restore(); }
  x.fillStyle = '#9a9a9a'; for (const v of [0.05, 0.24, 0.76, 0.95]) x.fillRect(0, H * v, W, 3);
  return tex(c, { srgb: false });
}
function wheel(front, mats) {
  const w = front ? 0.275 : 0.325, rim = 0.262, g = new THREE.Group(), spin = new THREE.Group(); g.add(spin);
  const prof = []; const pts = [[-0.5, rim], [-0.5, rim + 0.035], [-0.47, WR - 0.03], [-0.36, WR - 0.004], [0, WR], [0.36, WR - 0.004], [0.47, WR - 0.03], [0.5, rim + 0.035], [0.5, rim]];
  for (const [a, r] of pts) prof.push(new THREE.Vector2(r, a * w));
  const sp = new THREE.SplineCurve(prof).getPoints(40), tg = new THREE.LatheGeometry(sp, 56); tg.rotateZ(Math.PI / 2);
  { const uv = tg.attributes.uv; for (let i = 0; i < uv.count; i++) { const u = uv.getX(i), v = uv.getY(i); uv.setXY(i, u * 4, v); } }
  spin.add(new THREE.Mesh(tg, mats.tyre));
  // rim: barrel + twin spokes + hub
  const parts = [], B = (geo, M) => parts.push([geo, M || new THREE.Matrix4()]);
  const barrel = new THREE.LatheGeometry([[rim + 0.004, -0.5], [rim - 0.012, -0.44], [rim - 0.03, -0.2], [rim - 0.045, 0.1], [rim - 0.022, 0.4], [rim + 0.006, 0.5]].map(([r, a]) => new THREE.Vector2(r, a * w)), 48); barrel.rotateZ(Math.PI / 2);
  const bi = barrel.clone(); bi.index.array.reverse(); bi.computeVertexNormals(); B(barrel); B(bi);
  const off = w * 0.34;      // spoke face offset towards the outside (+x for a left wheel)
  for (let k = 0; k < 7; k++) for (const s of [-1, 1]) {
    const sh = new THREE.Shape(); sh.moveTo(0.05, -0.011); sh.lineTo(rim - 0.02, -0.008); sh.lineTo(rim - 0.02, 0.008); sh.lineTo(0.05, 0.011); sh.closePath();
    const eg = new THREE.ExtrudeGeometry(sh, { depth: 0.028, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 1 });
    eg.rotateY(Math.PI / 2); eg.rotateX((k / 7) * Math.PI * 2 + s * 0.09); eg.translate(off - 0.03, 0, 0); B(eg);     // radial along local y after rotation
  }
  const hub = new THREE.CylinderGeometry(0.068, 0.085, 0.07, 20); hub.rotateZ(Math.PI / 2); hub.translate(off - 0.02, 0, 0); B(hub);
  const spokes = new THREE.Mesh(mergeGeo(parts), mats.rim); spin.add(spokes);
  for (let k = 0; k < 5; k++) { const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.02, 6).rotateZ(Math.PI / 2), mats.chrome); const a = (k / 5) * 6.283; nut.position.set(off + 0.02, Math.cos(a) * 0.045, Math.sin(a) * 0.045); spin.add(nut); }
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.205, 0.205, 0.03, 40).rotateZ(Math.PI / 2), mats.disc.clone()); disc.position.x = off - 0.09; spin.add(disc);
  const cal = new THREE.Mesh(new THREE.TorusGeometry(0.185, 0.034, 6, 14, 1.25).rotateY(Math.PI / 2), mats.caliper); cal.position.x = off - 0.085; cal.rotation.x = front ? -0.6 : 2.5; cal.scale.set(1.5, 1, 1); g.add(cal);
  const blur = new THREE.Mesh(new THREE.CircleGeometry(rim - 0.01, 40).rotateY(Math.PI / 2), mats.blur.clone()); blur.position.x = off + 0.012; g.add(blur);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); blur.castShadow = false;
  return { g, spin, spokes, blur, disc };
}

function dialTex() {
  const S = 1024, c = canvas(S, S), x = c.getContext('2d'); x.fillStyle = '#ece6d6'; x.fillRect(0, 0, S, S); x.translate(S / 2, S / 2);
  const rg = x.createRadialGradient(0, 0, 80, 0, 0, 500); rg.addColorStop(0, '#f3eee0'); rg.addColorStop(1, '#d8d0bc'); x.fillStyle = rg; x.beginPath(); x.arc(0, 0, 500, 0, 6.3); x.fill();
  x.strokeStyle = '#111'; x.fillStyle = '#111';
  for (let i = 0; i < 300; i++) { const a = (i / 300) * 6.2832, big = i % 25 === 0, mid = i % 5 === 0; x.lineWidth = big ? 9 : mid ? 5 : 2; const r0 = big ? 400 : mid ? 420 : 438; x.beginPath(); x.moveTo(Math.sin(a) * r0, -Math.cos(a) * r0); x.lineTo(Math.sin(a) * 462, -Math.cos(a) * 462); x.stroke(); }
  x.font = 'bold 74px Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  for (let i = 1; i <= 12; i++) { const a = (i / 12) * 6.2832; x.fillText(String(i * 5), Math.sin(a) * 335, -Math.cos(a) * 335); }
  x.lineWidth = 4; x.beginPath(); x.arc(0, -165, 92, 0, 6.3); x.stroke(); x.font = 'bold 30px Georgia, serif';
  for (let i = 0; i < 30; i++) { const a = (i / 30) * 6.2832; x.lineWidth = i % 5 ? 2 : 5; x.beginPath(); x.moveTo(Math.sin(a) * 78, -165 - Math.cos(a) * 78); x.lineTo(Math.sin(a) * 90, -165 - Math.cos(a) * 90); x.stroke(); }
  x.font = 'italic 40px Georgia, serif'; x.fillText('Chronographe', 0, 150); x.font = '26px Georgia, serif'; x.fillText('1/5 SEC  ·  7 JEWELS', 0, 205);
  return tex(c, { repeat: false });
}
function helmetTex() {
  const c = canvas(512, 256), x = c.getContext('2d'); x.fillStyle = '#0d0e10'; x.fillRect(0, 0, 512, 256);
  x.fillStyle = '#ff5a14'; x.fillRect(236, 0, 40, 256); x.fillStyle = '#e9e6df'; x.fillRect(226, 0, 6, 256); x.fillRect(280, 0, 6, 256);
  x.fillStyle = '#ff5a14'; x.beginPath(); x.moveTo(0, 190); x.lineTo(512, 150); x.lineTo(512, 162); x.lineTo(0, 202); x.fill(); return tex(c, { repeat: false });
}
function bone(mesh, a, b) { mesh.position.copy(a).add(b).multiplyScalar(0.5); mesh.scale.set(1, a.distanceTo(b), 1); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()); }

export function buildCar() {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const BT = bodyTextures(), mask = canopyMask(), tn = tileNoise(256, 32, 3, 51);
  const quilt = tex(pixelCanvas(256, (i, x, y) => { const v = 255 * (0.5 + 0.3 * Math.abs(Math.sin(x * 0.2) * Math.sin(y * 0.2)) + 0.2 * tn[i]); return [v, v, v]; }), { srgb: false });
  const M = {
    paint: dyn(phys({ map: BT.map, roughnessMap: BT.mat, metalnessMap: BT.mat, clearcoatMap: BT.mat, roughness: 1, metalness: 1, clearcoat: 1, clearcoatRoughness: 0.07, envMapIntensity: 1.25 })),
    roof: dyn(phys({ color: 0x15171a, roughness: 0.22, metalness: 0.5, clearcoat: 1, clearcoatRoughness: 0.05, alphaMap: null, alphaTest: 0.5 })),
    glass: phys({ color: 0x05070a, roughness: 0.02, metalness: 0, transparent: true, opacity: 0.5, alphaMap: mask, depthWrite: false, envMapIntensity: 2.2, specularIntensity: 1 }),
    liner: dyn(std({ color: 0x0b0b0c, roughness: 0.95, side: THREE.BackSide })),
    linerC: dyn(std({ color: 0x0b0b0c, roughness: 0.95, side: THREE.BackSide, alphaTest: 0.5 })),
    carbon: dyn(phys({ color: 0x0c0c0d, roughness: 0.32, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.1 })),
    black: dyn(std({ color: 0x050506, roughness: 0.9 })),
    alc: dyn(std({ color: 0x141416, roughness: 0.97, bumpMap: quilt, bumpScale: 0.6 })),
    tyre: dyn(std({ color: 0x0e0e0f, roughness: 0.86, bumpMap: tyreTex(), bumpScale: 2.2 })),
    rim: dyn(std({ color: 0x1b1c20, roughness: 0.24, metalness: 0.95 })),
    chrome: dyn(std({ color: 0xcfd2d6, roughness: 0.12, metalness: 1 })),
    disc: dyn(std({ color: 0x77736c, roughness: 0.42, metalness: 0.9, emissive: 0xff3c08, emissiveIntensity: 0 })),
    caliper: dyn(phys({ color: 0xff4a0c, roughness: 0.3, clearcoat: 1 })),
    blur: std({ color: 0x18191c, roughness: 0.3, metalness: 0.9, transparent: true, opacity: 0, depthWrite: false }),
    head: dyn(std({ color: 0xffffff, emissive: 0xdfeaff, emissiveIntensity: 26, roughness: 0.3 })),
    tail: dyn(std({ color: 0x300000, emissive: 0xff1404, emissiveIntensity: 9, roughness: 0.3 })),
    suit: dyn(std({ color: 0x17181b, roughness: 0.9, bumpMap: quilt, bumpScale: 0.8 })),
    glove: dyn(std({ color: 0x0c0c0d, roughness: 0.75, bumpMap: quilt, bumpScale: 0.3 })),
    helmet: dyn(phys({ map: helmetTex(), roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.04 })),
    visor: dyn(phys({ color: 0xffb060, roughness: 0.03, metalness: 1, envMapIntensity: 1.6 })),
    steel: dyn(std({ color: 0x8a8d92, roughness: 0.3, metalness: 1 })),
    glow: dyn(std({ color: 0x1a0d08, roughness: 0.5, metalness: 0.6, emissive: 0xff4a10, emissiveIntensity: 0 })),
    red: dyn(std({ color: 0x8a1208, roughness: 0.55 })),
    led: dyn(std({ color: 0x050505, emissive: 0x00ff40, emissiveIntensity: 0 })),
    dial: dyn(phys({ map: dialTex(), roughness: 0.55, clearcoat: 1, clearcoatRoughness: 0.03 })),
    hand: dyn(std({ color: 0xc81408, roughness: 0.4, emissive: 0x300400 })),
    flame: new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.4, 5), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
  };
  M.roof.alphaMap = pixelInvert(mask); M.linerC.alphaMap = M.roof.alphaMap;
  const add = (geo, mat, p = [0, 0, 0], r = [0, 0, 0], parent = body, s) => { const m = new THREE.Mesh(geo, mat); m.position.fromArray(p); m.rotation.set(r[0], r[1], r[2]); if (s) m.scale.fromArray(s); m.castShadow = m.receiveShadow = true; parent.add(m); return m; };
  const box = (w, h, d, r = 0.01) => new RB(w, h, d, r);
  // --- shell ---
  const lg = loft(), cg = canopy();
  add(lg, M.paint); add(lg, M.liner).castShadow = false;
  const roof = add(cg, M.roof); roof.customDepthMaterial = new THREE.MeshDepthMaterial({ alphaMap: M.roof.alphaMap, alphaTest: 0.5 });
  add(cg, M.linerC).castShadow = false; const glass = add(cg, M.glass); glass.castShadow = false; glass.renderOrder = 5;
  // tail + nose fascias
  const cap = (z, flip) => { const s = section(z), sh = new THREE.Shape(); s.forEach((p, i) => (i ? sh.lineTo(p[0], p[1]) : sh.moveTo(p[0], p[1]))); for (let i = s.length - 1; i >= 0; i--) sh.lineTo(-s[i][0], s[i][1]); const g = new THREE.ShapeGeometry(sh); if (flip) g.rotateY(Math.PI); g.translate(0, 0, z); return g; };
  add(cap(Z0 + 0.004, true), M.black); add(cap(Z1 - 0.004, false), M.black);
  // wheel wells
  for (const zc of AX) for (const sx of [1, -1]) { const wl = new THREE.CylinderGeometry(ARCH + 0.012, ARCH + 0.012, 0.42, 28, 1, true); wl.rotateZ(Math.PI / 2); const m = add(wl, M.liner, [sx * 0.77, WR, zc]); m.castShadow = false; add(new THREE.CircleGeometry(ARCH + 0.012, 28).rotateY(sx > 0 ? Math.PI / 2 : -Math.PI / 2), M.black, [sx * 0.56, WR, zc]).castShadow = false; }
  add(new THREE.PlaneGeometry(1.5, 4.3).rotateX(Math.PI / 2), M.black, [0, 0.135, 0]);
  // aero: splitter, skirts, diffuser, wing, mirrors
  add(box(1.62, 0.018, 0.24), M.carbon, [0, 0.118, 2.2]);
  for (const sx of [1, -1]) { add(box(0.05, 0.03, 1.9), M.carbon, [sx * 0.965, 0.112, 0.02]); add(box(0.012, 0.1, 0.2), M.carbon, [sx * 0.8, 0.17, 2.2]); }
  for (let k = -3; k <= 3; k++) add(box(0.014, 0.15, 0.44), M.carbon, [k * 0.19, 0.27, -2.06], [0.3, 0, 0]);
  add(box(1.5, 0.02, 0.46), M.carbon, [0, 0.335, -2.06], [0.3, 0, 0]);
  const wing = new THREE.Shape(); wing.moveTo(-0.19, 0); wing.quadraticCurveTo(-0.05, 0.05, 0.19, 0.02); wing.quadraticCurveTo(0.0, -0.012, -0.19, 0);
  const wgeo = new THREE.ExtrudeGeometry(wing, { depth: 1.9, bevelEnabled: false, curveSegments: 14 }); wgeo.translate(0, 0, -0.95); wgeo.rotateY(Math.PI / 2);
  add(wgeo, M.carbon, [0, 1.20, -2.08], [0.14, 0, 0]);
  for (const sx of [1, -1]) { add(box(0.012, 0.13, 0.4), M.carbon, [sx * 0.955, 1.185, -2.08]); add(box(0.022, 0.4, 0.09), M.carbon, [sx * 0.42, 1.02, -1.97], [0.42, 0, 0]);
    add(box(0.2, 0.09, 0.11, 0.03), M.carbon, [sx * 1.04, 0.92, 0.62], [0, sx * 0.25, 0]); add(box(0.16, 0.02, 0.04), M.carbon, [sx * 0.92, 0.88, 0.62], [0, 0, sx * 0.5]); }
  // lights + exhaust
  M.headL = M.head; const heads = [];
  for (const sx of [1, -1]) { heads.push(add(box(0.3, 0.026, 0.02, 0.006), M.head, [sx * 0.60, 0.52, 2.165], [0.5, -sx * 0.5, sx * 0.14])); heads.push(add(box(0.014, 0.014, 0.2, 0.004), M.head, [sx * 0.735, 0.555, 2.02], [0.24, -sx * 0.23, 0])); add(new THREE.SphereGeometry(0.032, 12, 8), M.chrome, [sx * 0.64, 0.49, 2.12]); }
  add(box(1.5, 0.022, 0.02, 0.004), M.tail, [0, 0.742, Z0 - 0.004]); for (const sx of [1, -1]) add(box(0.02, 0.1, 0.02, 0.004), M.tail, [sx * 0.74, 0.70, Z0 - 0.004]);
  const flames = [];
  for (const sx of [1, -1]) { const tip = new THREE.CylinderGeometry(0.052, 0.046, 0.16, 20, 1, true).rotateX(Math.PI / 2); add(tip, M.steel, [sx * 0.085, 0.55, Z0 - 0.02]).material.side = THREE.DoubleSide; add(new THREE.CircleGeometry(0.045, 16).rotateY(Math.PI), M.glow, [sx * 0.085, 0.55, Z0 + 0.03]);
    const fl = add(new THREE.ConeGeometry(0.05, 0.75, 12, 1, true).rotateX(-Math.PI / 2), M.flame, [sx * 0.085, 0.55, Z0 - 0.42]); fl.castShadow = false; flames.push(fl); const f2 = add(new THREE.ConeGeometry(0.028, 0.45, 10, 1, true).rotateX(-Math.PI / 2), M.flame, [sx * 0.085, 0.55, Z0 - 0.28]); f2.castShadow = false; flames.push(f2); }
  // --- engine under glass ---
  add(box(0.5, 0.1, 0.5, 0.04), M.carbon, [0, 0.83, -1.12]);
  for (const sx of [1, -1]) { add(box(0.15, 0.07, 0.52, 0.02), M.red, [sx * 0.33, 0.78, -1.12], [0, 0, -sx * 0.5]); for (let k = 0; k < 4; k++) add(new THREE.CylinderGeometry(0.028, 0.028, 0.16, 10).rotateZ(Math.PI / 2), M.steel, [sx * 0.24, 0.80, -0.94 - k * 0.12], [0, 0, -sx * 0.4]); }
  const turbos = []; for (const sx of [1, -1]) { turbos.push(add(new THREE.TorusGeometry(0.065, 0.034, 10, 20), M.glow, [sx * 0.2, 0.80, -1.5], [0.5, 0, 0])); add(new THREE.CylinderGeometry(0.035, 0.035, 0.3, 12).rotateX(Math.PI / 2), M.steel, [sx * 0.2, 0.78, -1.66]); }
  add(new THREE.PlaneGeometry(1.5, 0.9), M.black, [0, 0.72, -0.74]); add(new THREE.PlaneGeometry(1.3, 0.9).rotateX(-Math.PI / 2), M.black, [0, 0.70, -1.2]);
  // --- cockpit ---
  add(new THREE.PlaneGeometry(1.4, 1.9).rotateX(-Math.PI / 2), M.alc, [0, 0.16, 0.1]);
  add(box(1.36, 0.16, 0.42, 0.06), M.alc, [0, 0.74, 0.86], [-0.12, 0, 0]);
  add(box(0.3, 0.34, 1.1, 0.04), M.carbon, [0, 0.3, 0.1]);
  const DX = 0.36;
  for (const sx of [1, -1]) { add(box(0.46, 0.1, 0.5, 0.04), M.alc, [sx * DX, 0.24, -0.2]); add(box(0.46, 0.66, 0.1, 0.05), M.carbon, [sx * DX, 0.56, -0.47], [-0.3, 0, 0]); add(box(0.3, 0.2, 0.1, 0.05), M.alc, [sx * DX, 0.9, -0.36], [-0.2, 0, 0]); }
  add(box(0.34, 0.11, 0.14, 0.03), M.carbon, [DX, 0.80, 0.74]);
  const screen = add(new THREE.PlaneGeometry(0.24, 0.085), dyn(std({ color: 0x020202, emissive: 0x9fd8ff, emissiveIntensity: 0.6, roughness: 0.2 })), [DX, 0.80, 0.668], [0, Math.PI, 0]);
  const leds = []; for (let k = 0; k < 12; k++) { const m = add(box(0.014, 0.008, 0.006, 0.002), M.led.clone(), [DX + 0.094 - k * 0.0171, 0.853, 0.668]); m.castShadow = false; leds.push(m); }
  const col = new THREE.Group(); col.position.set(DX, 0.70, 0.52); col.rotation.x = -0.38; body.add(col);
  const sw = new THREE.Group(); col.add(sw);
  add(new THREE.TorusGeometry(0.165, 0.019, 12, 40), M.alc, [0, 0, 0], [0, 0, 0], sw); add(box(0.3, 0.05, 0.03, 0.012), M.carbon, [0, 0, 0.012], [0, 0, 0], sw); add(box(0.05, 0.16, 0.03, 0.012), M.carbon, [0, -0.08, 0.012], [0, 0, 0], sw);
  add(new THREE.CylinderGeometry(0.05, 0.05, 0.035, 20).rotateX(Math.PI / 2), M.carbon, [0, 0, 0.005], [0, 0, 0], sw); add(box(0.016, 0.02, 0.008, 0.003), M.caliper, [0, 0.165, -0.02], [0, 0, 0], sw);
  add(new THREE.CylinderGeometry(0.022, 0.022, 0.3, 10).rotateX(Math.PI / 2), M.black, [0, 0, 0.17], [0, 0, 0], col);
  // stopwatch on the dash
  const watch = new THREE.Group(); watch.position.set(0, 0.868, 0.70); watch.rotation.set(0.32, Math.PI, 0); body.add(watch);
  add(new THREE.CylinderGeometry(0.047, 0.047, 0.016, 48).rotateX(Math.PI / 2), M.chrome, [0, 0, -0.008], [0, 0, 0], watch);
  add(new THREE.CircleGeometry(0.0425, 48), M.dial, [0, 0, 0.0006], [0, 0, 0], watch); add(new THREE.TorusGeometry(0.045, 0.0045, 10, 48), M.chrome, [0, 0, 0.002], [0, 0, 0], watch);
  add(new THREE.CylinderGeometry(0.006, 0.006, 0.012, 12), M.chrome, [0, 0.055, -0.006], [0, 0, 0], watch); add(new THREE.TorusGeometry(0.011, 0.002, 6, 16), M.chrome, [0, 0.068, -0.006], [0, 0, 0], watch);
  add(box(0.05, 0.03, 0.03, 0.006), M.black, [0, -0.052, -0.02], [0, 0, 0], watch);
  const hand = new THREE.Group(); hand.position.z = 0.0022; watch.add(hand); add(box(0.0016, 0.05, 0.0006, 0.0002), M.hand, [0, 0.016, 0], [0, 0, 0], hand); add(new THREE.CylinderGeometry(0.003, 0.003, 0.0012, 12).rotateX(Math.PI / 2), M.hand, [0, 0, 0], [0, 0, 0], hand);
  const hand2 = new THREE.Group(); hand2.position.set(0, 0.0137, 0.0018); watch.add(hand2); add(box(0.001, 0.009, 0.0005, 0.0002), M.black, [0, 0.0035, 0], [0, 0, 0], hand2);
  const wglass = add(new THREE.CircleGeometry(0.0425, 32), phys({ color: 0xffffff, transparent: true, opacity: 0.14, roughness: 0.02, depthWrite: false, envMapIntensity: 2 }), [0, 0, 0.004], [0, 0, 0], watch); wglass.castShadow = false;
  // --- driver ---
  const drv = new THREE.Group(); drv.position.set(DX, 0, 0); body.add(drv);
  add(new THREE.CapsuleGeometry(0.15, 0.3, 6, 14), M.suit, [0, 0.52, -0.26], [-0.24, 0, 0], drv, [1.15, 1, 0.8]);
  add(box(0.34, 0.14, 0.5, 0.06), M.suit, [0, 0.33, 0.0], [0, 0, 0], drv);
  for (const sx of [1, -1]) add(box(0.05, 0.5, 0.012, 0.004), M.caliper, [sx * 0.09, 0.56, -0.155], [-0.26, 0, sx * 0.08], drv);
  const head = new THREE.Group(); head.position.set(0, 0.905, -0.2); drv.add(head);
  const hs = new THREE.SphereGeometry(0.138, 40, 28); hs.scale(0.96, 1.02, 1.14); add(hs, M.helmet, [0, 0, 0], [0, -Math.PI / 2, 0], head);
  const vz = new THREE.SphereGeometry(0.1395, 40, 14, Math.PI / 2 - 1.12, 2.24, 1.18, 0.5); vz.scale(0.96, 1.02, 1.14); add(vz, M.visor, [0, 0, 0.001], [0, -Math.PI / 2, 0], head);
  add(box(0.2, 0.05, 0.06, 0.02), M.carbon, [0, -0.085, 0.118], [0.2, 0, 0], head); add(new THREE.CylinderGeometry(0.075, 0.09, 0.09, 16), M.suit, [0, -0.15, -0.02], [0, 0, 0], head);
  const arms = [];
  for (const sx of [1, -1]) { const up = add(new THREE.CapsuleGeometry(0.045, 1, 4, 10), M.suit, [0, 0, 0], [0, 0, 0], drv); up.geometry.scale(1, 1 / 1.09, 1); const lo = add(new THREE.CapsuleGeometry(0.038, 1, 4, 10), M.suit, [0, 0, 0], [0, 0, 0], drv); lo.geometry.scale(1, 1 / 1.076, 1);
    const hd = new THREE.Group(); body.add(hd); add(box(0.085, 0.05, 0.1, 0.022), M.glove, [0, 0, 0], [0, 0, 0], hd); for (let k = 0; k < 4; k++) add(new THREE.CapsuleGeometry(0.0095, 0.05, 3, 6).rotateZ(Math.PI / 2), M.glove, [0, -0.012 - 0.004 * k, 0.04 - k * 0.022], [0, 0, 0], hd, [1, 1, 1]); add(new THREE.CapsuleGeometry(0.011, 0.04, 3, 6), M.glove, [-sx * 0.03, 0.01, 0.045], [0.9, 0, 0], hd); add(box(0.03, 0.012, 0.05, 0.004), M.caliper, [0, 0.03, 0], [0, 0, 0], hd);
    arms.push({ sx, up, lo, hd }); }
  const W4 = [];
  for (const [zi, zc] of AX.entries()) for (const sx of [1, -1]) { const w = wheel(zi === 0, M); w.g.position.set(sx * TRACK, WR, zc); if (sx < 0) w.g.scale.x = -1; w.front = zi === 0; w.sx = sx; root.add(w.g); W4.push(w); }
  if (W4[1]) { /* mirrored wheels keep outward faces because of scale.x = -1 */ }
  body.traverse((o) => { if (o.isMesh && o.material.side === undefined) o.material.side = THREE.FrontSide; });

  const v = () => new THREE.Vector3(), sh = v(), el = v(), hp = v(), tmp = v(), q = new THREE.Quaternion();
  const car = {
    root, body, M, wheels: W4, head, watch, hand, flames, col, sw, DX,
    /** s: { steer (rad at the road wheels), spin (rad), spinRate (rad/s), roll, pitch, heave, rpm 0..1, brake 0..1, heat 0..1, flame 0..1, head (yaw), headPitch, ticks, lights 0..1, shake } */
    set(s) {
      body.rotation.set(s.pitch || 0, 0, s.roll || 0, 'YXZ'); body.position.set(0, (s.heave || 0), 0);
      if (s.shake) { body.position.x += s.shake[0]; body.position.y += s.shake[1]; }
      for (const w of W4) {
        w.g.rotation.y = w.front ? (s.steer || 0) * w.sx * (w.sx) : 0; w.spin.rotation.x = (w.front ? s.spinF ?? s.spin : s.spin) || 0;
        const rate = Math.abs((w.front ? s.rateF ?? s.spinRate : s.spinRate) || 0), b = clamp((rate - 22) / 30);
        w.blur.material.opacity = b * 0.9; w.spokes.visible = b < 0.75; w.disc.material.emissiveIntensity = (s.heat || 0) * (w.front ? 9 : 5);
      }
      const rpm = s.rpm || 0; leds.forEach((l, k) => { const on = rpm * 12.6 > k + 1; const blink = rpm > 0.96 && (Math.floor((s.t || 0) * 22) % 2 === 0); l.material.emissive.setHex(blink ? 0x3050ff : k < 4 ? 0x10ff30 : k < 8 ? 0xffc000 : 0xff1808); l.material.emissiveIntensity = on || blink ? 14 : 0; });
      screen.material.emissiveIntensity = 0.5 + rpm * 1.2;
      M.tail.emissiveIntensity = 7 + (s.brake || 0) * 30; M.head.emissiveIntensity = 26 * (s.lights ?? 1);
      M.glow.emissiveIntensity = (s.flame || 0) * 30 + rpm * rpm * 7; M.flame.opacity = s.flame || 0;
      flames.forEach((f, i) => { f.scale.set(1, 1, 0.5 + (s.flame || 0) * (0.8 + 0.4 * Math.sin((s.t || 0) * 190 + i))); });
      head.rotation.set(s.headPitch || 0, s.head || 0, (s.headRoll || 0), 'YXZ');
      hand.rotation.z = -(Math.floor(s.ticks || 0) / 300) * Math.PI * 2; hand2.rotation.z = -(Math.floor((s.ticks || 0) / 300) / 30) * Math.PI * 2;
      // steering wheel + arms (2-bone IK to the rim at 9 and 3 o'clock)
      const a = clamp(-(s.steer || 0) * 7, -1.9, 1.9); sw.rotation.z = a;
      body.updateMatrixWorld(true);
      for (const A of arms) {
        tmp.set(A.sx * 0.166, 0.0, -0.012); sw.localToWorld(tmp); body.worldToLocal(tmp); hp.copy(tmp);
        A.hd.position.copy(hp); col.getWorldQuaternion(q); A.hd.quaternion.copy(body.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(q)); A.hd.rotateZ(a + A.sx * 0.25); A.hd.rotateX(-1.2);
        sh.set(DX + A.sx * 0.2, 0.74, -0.2); const d = hp.distanceTo(sh), L1 = 0.32, L2 = 0.31, dd = Math.min(d, L1 + L2 - 0.005);
        const x1 = (L1 * L1 - L2 * L2 + dd * dd) / (2 * dd), hgt = Math.sqrt(Math.max(0, L1 * L1 - x1 * x1));
        el.copy(hp).sub(sh).normalize(); const dn = tmp.set(A.sx * 0.6, -1, -0.15).addScaledVector(el, -tmp.dot(el)).normalize(); el.multiplyScalar(x1).add(sh).addScaledVector(dn, hgt);
        const toL = (p) => p.clone().sub(new THREE.Vector3(DX, 0, 0)); bone(A.up, toL(sh), toL(el)); bone(A.lo, toL(el), toL(hp));
      }
    },
  };
  return car;
}
function pixelInvert(t) { const s = t.image, c = canvas(s.width, s.height), x = c.getContext('2d'); x.drawImage(s, 0, 0); x.globalCompositeOperation = 'difference'; x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); return tex(c, { repeat: false, srgb: false }); }
// small bevelled box
class RB extends THREE.BufferGeometry {
  constructor(w, h, d, r) { super(); const b = new THREE.BoxGeometry(w, h, d, 2, 2, 2), p = b.attributes.position; r = Math.min(r, w / 2.01, h / 2.01, d / 2.01);
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const cx = clamp(x, -w / 2 + r, w / 2 - r), cy = clamp(y, -h / 2 + r, h / 2 - r), cz = clamp(z, -d / 2 + r, d / 2 - r); const v = new THREE.Vector3(x - cx, y - cy, z - cz); if (v.lengthSq() > 0) v.normalize().multiplyScalar(r); p.setXYZ(i, cx + v.x, cy + v.y, cz + v.z); }
    this.copy(b); this.computeVertexNormals(); }
}
