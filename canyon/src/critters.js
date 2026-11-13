// Wildlife: a rattlesnake, a spiny lizard, a hawk and a flock of small birds. All procedural and posed as pure functions of time.
import * as THREE from 'three';
import { canvas, tex, RNG, clamp, sstep, lerp, noise2 } from './util.js';
import { std } from './mat.js';

const add = (geo, mat, parent, p = [0, 0, 0], r = [0, 0, 0], s) => { const m = new THREE.Mesh(geo, mat); m.position.fromArray(p); m.rotation.set(r[0], r[1], r[2]); if (s) m.scale.fromArray(s); m.castShadow = m.receiveShadow = true; parent.add(m); return m; };
function bone(mesh, a, b) { mesh.position.copy(a).add(b).multiplyScalar(0.5); mesh.scale.set(1, a.distanceTo(b), 1); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()); }

function scaleTex(kind) {
  const W = 1024, H = 128, c = canvas(W, H), x = c.getContext('2d'), b = canvas(W, H), y = b.getContext('2d'), r = new RNG(kind === 'snake' ? 4 : 9);
  x.fillStyle = kind === 'snake' ? '#b89a6a' : '#8d8674'; x.fillRect(0, 0, W, H); y.fillStyle = '#808080'; y.fillRect(0, 0, W, H);
  if (kind === 'snake') {
    for (let i = 0; i < 34; i++) { const cx = i * 30 + 15; x.fillStyle = '#4a3220'; x.beginPath(); x.moveTo(cx - 13, H * 0.5); x.lineTo(cx, H * 0.2); x.lineTo(cx + 13, H * 0.5); x.lineTo(cx, H * 0.8); x.fill(); x.strokeStyle = '#e4d2a8'; x.lineWidth = 2.5; x.stroke(); x.fillStyle = '#6b4a2c'; x.beginPath(); x.ellipse(cx, H * 0.5, 6, 12, 0, 0, 6.3); x.fill(); }
    x.fillStyle = '#d9c9a2'; x.fillRect(0, 0, W, H * 0.12); x.fillRect(0, H * 0.88, W, H * 0.12);
  } else {
    for (let i = 0; i < 16; i++) { x.fillStyle = i % 2 ? 'rgba(50,44,36,0.75)' : 'rgba(170,160,130,0.5)'; const cx = i * 64 + r.r(0, 20); x.beginPath(); x.moveTo(cx, H * 0.2); x.quadraticCurveTo(cx + 26, H * 0.5, cx, H * 0.8); x.lineTo(cx + 16, H * 0.8); x.quadraticCurveTo(cx + 44, H * 0.5, cx + 16, H * 0.2); x.fill(); }
    x.fillStyle = 'rgba(40,110,170,0.55)'; x.fillRect(0, 0, W, H * 0.1); x.fillRect(0, H * 0.9, W, H * 0.1);
  }
  for (let j = 0; j < 22; j++) for (let i = 0; i < 180; i++) { const px = i * 5.7 + (j % 2) * 2.85, py = j * 5.9; y.fillStyle = '#c0c0c0'; y.beginPath(); y.ellipse(px, py, 2.6, 2.7, 0, 0, 6.3); y.fill(); x.fillStyle = `rgba(0,0,0,${r.r(0, 0.14)})`; x.fillRect(px - 2.5, py - 2.5, 5, 5); }
  return { map: tex(c), bump: tex(b, { srgb: false }) };
}

/** Tube whose centreline is re-posed every frame. rad(u) = [rx, ry]. */
function tube(n, sides, mat) {
  const g = new THREE.BufferGeometry(), P = new Float32Array((n + 1) * (sides + 1) * 3), N = new Float32Array(P.length), UV = [], idx = [];
  for (let i = 0; i <= n; i++) for (let j = 0; j <= sides; j++) UV.push(i / n * 1, j / sides);
  for (let i = 0; i < n; i++) for (let j = 0; j < sides; j++) { const a = i * (sides + 1) + j, b = a + sides + 1; idx.push(a, a + 1, b, b, a + 1, b + 1); }
  g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2)); g.setIndex(idx);
  const m = new THREE.Mesh(g, mat); m.castShadow = m.receiveShadow = true; m.frustumCulled = false;
  const c = new THREE.Vector3(), t = new THREE.Vector3(), s = new THREE.Vector3(), u = new THREE.Vector3(), c2 = new THREE.Vector3();
  m.pose = (center, rad) => {
    for (let i = 0; i <= n; i++) {
      const f = i / n; center(f, c); center(Math.min(1, f + 0.004), c2); center(Math.max(0, f - 0.004), t); t.subVectors(c2, t).normalize(); s.set(t.z, 0, -t.x).normalize(); u.crossVectors(t, s).negate(); if (u.y < 0) u.negate();
      const [rx, ry] = rad(f);
      for (let j = 0; j <= sides; j++) { const a = (j / sides) * 6.2832, ca = Math.cos(a), sa = Math.sin(a), k = (i * (sides + 1) + j) * 3; P[k] = c.x + s.x * ca * rx + u.x * sa * ry; P[k + 1] = c.y + s.y * ca * rx + u.y * sa * ry; P[k + 2] = c.z + s.z * ca * rx + u.z * sa * ry; N[k] = s.x * ca + u.x * sa; N[k + 1] = s.y * ca + u.y * sa; N[k + 2] = s.z * ca + u.z * sa; }
    }
    g.attributes.position.needsUpdate = true; g.attributes.normal.needsUpdate = true;
  };
  return m;
}

export function buildSnake() {
  const T = scaleTex('snake'); T.map.repeat.set(1, 1);
  const mat = std({ map: T.map, bumpMap: T.bump, bumpScale: 0.6, roughness: 0.5 }), g = new THREE.Group(), body = tube(150, 14, mat); g.add(body);
  const head = new THREE.Group(); g.add(head);
  const hg = new THREE.SphereGeometry(1, 20, 14); hg.scale(0.021, 0.013, 0.031); add(hg, std({ color: 0x9c8156, roughness: 0.5, bumpMap: T.bump, bumpScale: 0.4 }), head, [0, 0, 0.012]);
  const eye = std({ color: 0x0a0806, roughness: 0.08 }); for (const sx of [1, -1]) add(new THREE.SphereGeometry(0.0042, 10, 8), eye, head, [sx * 0.0145, 0.006, 0.022]);
  const tongue = new THREE.Group(); head.add(tongue); const tm = std({ color: 0x1a0505, roughness: 0.4 }); add(new THREE.BoxGeometry(0.0022, 0.0008, 0.03), tm, tongue, [0, -0.002, 0.052]); for (const sx of [1, -1]) add(new THREE.BoxGeometry(0.0012, 0.0008, 0.014), tm, tongue, [sx * 0.003, -0.002, 0.072], [0, sx * 0.4, 0]);
  const L = 1.25;
  /** t seconds, alert 0..1 (raises the head and tightens the coils) */
  g.set = (t, alert = 0) => {
    const cen = (f, o) => {
      const env = 0.25 + 0.75 * Math.sin(Math.min(1, f * 1.15) * Math.PI), ph = f * 9.5 - t * 1.3, amp = lerp(0.085, 0.13, alert) * env;
      const len = lerp(1, 0.72, alert);
      const lift = sstep(0.80, 1.0, f) * (0.035 + alert * 0.16), neck = sstep(0.86, 1, f) * alert * 0.12;
      o.set(Math.sin(ph) * amp, 0.016 + lift, (f - 0.5) * L * len - neck); return o;
    };
    body.pose(cen, (f) => { const r = 0.004 + 0.0155 * Math.pow(Math.sin(Math.min(1, f * 1.02 + 0.03) * Math.PI * 0.94), 0.55) * (f > 0.93 ? lerp(1, 0.72, (f - 0.93) / 0.07) : 1); return [r * 1.12, r * 0.86]; });
    const a = cen(1, new THREE.Vector3()), b = cen(0.985, new THREE.Vector3()); head.position.copy(a); head.lookAt(a.clone().add(a.clone().sub(b)));
    const fl = Math.max(0, Math.sin(t * 5.2) - 0.55) / 0.45; tongue.scale.set(1, 1, 0.15 + fl * (0.85 + 0.15 * Math.sin(t * 70))); tongue.visible = fl > 0.02;
  };
  g.set(0); return g;
}

export function buildLizard() {
  const T = scaleTex('lizard'), mat = std({ map: T.map, bumpMap: T.bump, bumpScale: 0.5, roughness: 0.62 }), skin = std({ color: 0x7d7767, roughness: 0.65, bumpMap: T.bump, bumpScale: 0.4 });
  const g = new THREE.Group(), torso = new THREE.Group(); g.add(torso);
  const body = tube(40, 12, mat), tail = tube(40, 10, mat); torso.add(body); g.add(tail);
  const head = new THREE.Group(); torso.add(head);
  const hg = new THREE.SphereGeometry(1, 18, 12); hg.scale(0.017, 0.012, 0.024); add(hg, skin, head, [0, 0.002, 0.016]);
  const eye = std({ color: 0x080604, roughness: 0.06 }); for (const sx of [1, -1]) add(new THREE.SphereGeometry(0.0038, 10, 8), eye, head, [sx * 0.0125, 0.007, 0.018]);
  const legs = []; for (const [z, front] of [[0.045, 1], [-0.05, 0]]) for (const sx of [1, -1]) { const up = add(new THREE.CapsuleGeometry(0.0062, 1, 3, 8), skin, g); up.geometry.scale(1, 1 / 1.0124, 1); const lo = add(new THREE.CapsuleGeometry(0.005, 1, 3, 8), skin, g); lo.geometry.scale(1, 1 / 1.01, 1); const foot = add(new THREE.BoxGeometry(0.02, 0.004, 0.026), skin, g); legs.push({ z, front, sx, up, lo, foot }); }
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  /** t seconds; push 0..1 (push-up height), look (head yaw), run: forward offset metres */
  g.set = (t, push = 0, look = 0, pitch = 0) => {
    const h = 0.03 + push * 0.022; torso.position.set(0, 0, 0);
    body.pose((f, o) => o.set(Math.sin(f * 3 + 1) * 0.004, lerp(0.022, h, sstep(0.1, 0.9, f)) + 0.006 * Math.sin(f * Math.PI), lerp(-0.07, 0.075, f)), (f) => { const r = 0.008 + 0.016 * Math.sin(clamp(f * 1.05) * Math.PI); return [r * 1.25, r * 0.8]; });
    tail.pose((f, o) => o.set(Math.sin(f * 2.4) * 0.05 * f, 0.02 * (1 - f) + 0.004, -0.07 - f * 0.17), (f) => { const r = 0.0105 * (1 - f * 0.93); return [r, r * 0.85]; });
    head.position.set(0, h + 0.012, 0.078); head.rotation.set(-0.25 - push * 0.25 + pitch, look, 0, 'YXZ');
    for (const l of legs) { const sy = l.front ? h : 0.024, hip = V(l.sx * 0.017, sy, l.z), foot = V(l.sx * 0.05, 0.004, l.z + (l.front ? 0.012 : -0.014)), knee = hip.clone().lerp(foot, 0.5).add(V(l.sx * 0.012, 0.016, l.front ? -0.006 : 0.01)); bone(l.up, hip, knee); bone(l.lo, knee, foot); l.foot.position.copy(foot); l.foot.rotation.y = l.sx * 0.5; }
  };
  g.set(0); return g;
}

function wingTex() {
  const W = 512, H = 256, c = canvas(W, H), x = c.getContext('2d'), r = new RNG(12);
  for (let i = 0; i < 22; i++) { const u = i / 21, px = 20 + u * 470, len = 120 + 110 * Math.sin(Math.min(1, u * 1.25) * Math.PI * 0.62) - (u > 0.8 ? (u - 0.8) * 260 : 0), g = r.i(44, 76); x.fillStyle = `rgb(${g + 22},${g + 6},${g - 12})`; x.beginPath(); x.ellipse(px, 30 + len / 2, 15, len / 2, (u - 0.5) * 0.5, 0, 6.3); x.fill(); x.strokeStyle = 'rgba(210,190,150,0.35)'; x.lineWidth = 2; x.beginPath(); x.moveTo(px, 30); x.lineTo(px + (u - 0.5) * 30, 26 + len); x.stroke(); }
  x.fillStyle = '#4c3a2a'; x.fillRect(10, 14, 492, 40); return tex(c, { repeat: false });
}
export function buildHawk() {
  const g = new THREE.Group(), feath = std({ map: wingTex(), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.8 }), dark = std({ color: 0x3a2c20, roughness: 0.8 });
  const bg = new THREE.SphereGeometry(1, 16, 12); bg.scale(0.085, 0.075, 0.24); add(bg, dark, g);
  add(new THREE.SphereGeometry(0.055, 14, 10), std({ color: 0x6a5238, roughness: 0.8 }), g, [0, 0.02, 0.22]); add(new THREE.ConeGeometry(0.018, 0.05, 8).rotateX(Math.PI / 2), std({ color: 0x1a1612, roughness: 0.4 }), g, [0, 0.008, 0.285]);
  const tg = new THREE.PlaneGeometry(0.26, 0.3).rotateX(-Math.PI / 2); add(tg, feath, g, [0, 0, -0.34], [0, 0, 0]);
  const wings = [];
  for (const sx of [1, -1]) { const inner = new THREE.Group(); inner.position.set(sx * 0.06, 0.02, 0.04); g.add(inner); const w1 = new THREE.PlaneGeometry(0.42, 0.34); w1.rotateX(-Math.PI / 2); w1.translate(0.21, 0, 0); const m1 = add(w1, feath, inner); m1.scale.x = sx; { const uv = w1.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 0.5); }
    const outer = new THREE.Group(); outer.position.set(sx * 0.42, 0, 0); inner.add(outer); const w2 = new THREE.PlaneGeometry(0.44, 0.34); w2.rotateX(-Math.PI / 2); w2.translate(0.22, 0, 0); { const uv = w2.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, 0.5 + uv.getX(i) * 0.5); } const m2 = add(w2, feath, outer); m2.scale.x = sx; wings.push({ sx, inner, outer }); }
  /** flap 0..1 amount of wing-beat; otherwise a soaring dihedral that breathes */
  g.set = (t, flap = 0) => { for (const w of wings) { const a = 0.16 + 0.04 * Math.sin(t * 1.3) + flap * 0.55 * Math.sin(t * 9); w.inner.rotation.z = w.sx * a; w.outer.rotation.z = w.sx * (0.1 + flap * 0.5 * Math.sin(t * 9 - 0.9)); w.outer.rotation.y = -w.sx * 0.12; } };
  g.set(0); g.scale.setScalar(1.25); return g;
}

export function buildFlock(n = 46) {
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.04, 0.11, 0, -0.03, 0, 0, -0.02, 0, 0, 0.04, 0, 0, -0.02, -0.11, 0, -0.03], 3)); geo.computeVertexNormals();
  const mat = new THREE.MeshBasicMaterial({ color: 0x0c0a09, side: THREE.DoubleSide }); const ph = new Float32Array(n); const r = new RNG(31), dirs = [];
  for (let i = 0; i < n; i++) { ph[i] = r.r(0, 6.3); dirs.push([r.n() * 0.8, r.r(0.5, 1.3), r.n() * 0.8, r.r(0, 0.35), r.r(5, 9)]); }
  geo.setAttribute('aPh', new THREE.InstancedBufferAttribute(ph, 1));
  const U = { uT: { value: 0 } };
  mat.onBeforeCompile = (sh) => { sh.uniforms.uT = U.uT; sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aPh; uniform float uT;').replace('#include <begin_vertex>', '#include <begin_vertex>\n transformed.y += abs(position.x) * sin(uT * 26.0 + aPh) * 0.9;'); };
  const m = new THREE.InstancedMesh(geo, mat, n); m.frustumCulled = false; const M = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), e = new THREE.Euler();
  /** tau: seconds since the birds burst from `origin`; wind: Vector3 drift */
  m.set = (tau, origin, wind) => {
    U.uT.value = tau;
    for (let i = 0; i < n; i++) { const d = dirs[i], a = Math.max(0, tau - d[3]), k = d[4]; p.set(origin.x + d[0] * (a * k * 0.5) + wind.x * a * a * 1.6 + Math.sin(i * 7 + a * 3) * 0.3, origin.y + (a > 0 ? d[1] * a * 2.4 + 0.5 * Math.sin(a * 5 + i) : (i % 7) * 0.25 - 0.8), origin.z + d[2] * (a * k * 0.5) + wind.z * a * a * 1.6);
      e.set(0, Math.atan2(d[0] + wind.x * a * 2, d[2] + wind.z * a * 2), Math.sin(a * 4 + i) * 0.4); q.setFromEuler(e); s.setScalar(a > 0 ? 1.3 : 0.001); M.compose(p, q, s); m.setMatrixAt(i, M); }
    m.instanceMatrix.needsUpdate = true;
  };
  return m;
}
