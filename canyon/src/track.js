// The road: a centreline integrated from (length, turn) segments, and the canyon profile around it.
// Heading 0 = +Z. Lateral coordinate d is positive to the LEFT of travel (the valley side); the rock wall is d < 0.
import { noise2, fbm2, ridged2, sstep, clamp, lerp } from './util.js';

const SEG = [[200, -30], [380, 0], [90, -55], [60, 0], [110, 70], [50, 0], [80, -50], [140, 0], [100, 45], [70, -60], [60, 0], [120, 65], [90, -50], [340, 0], [100, 40], [100, -40], [320, 0], [220, 40]];
export const LEN = SEG.reduce((a, s) => a + s[0], 0);
export const HW = 3.9;                       // half width of the asphalt
export const NARROWS = [[905, 1015], [1745, 1840]];   // rock on both sides
const N = LEN + 1;
const LV = [0, 12, 25, 50, 100, 200, 400];   // centreline smoothing levels (metres of arc length)

const curv = new Float32Array(N);
{ let i = 0; for (const [len, deg] of SEG) { const k = (deg * Math.PI / 180) / len; for (let j = 0; j < len; j++) curv[i++] = k; } curv[N - 1] = 0; }
function box(a, w) { const o = new Float32Array(a.length), n = a.length; let s = 0; const pre = new Float64Array(n + 1); for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + a[i]; for (let i = 0; i < n; i++) { const lo = Math.max(0, i - w), hi = Math.min(n - 1, i + w); o[i] = (pre[hi + 1] - pre[lo]) / (hi - lo + 1); } return o; }
export const K = box(box(curv, 18), 18);
const px0 = new Float32Array(N), pz0 = new Float32Array(N), py0 = new Float32Array(N), th0 = new Float32Array(N);
{ let th = 0.35, x = 0, z = 0; for (let i = 0; i < N; i++) { th0[i] = th; px0[i] = x; pz0[i] = z; py0[i] = 40 + i * 0.018 + 3.2 * Math.sin(i / 150) + 1.2 * Math.sin(i / 47 + 1); x += Math.sin(th); z += Math.cos(th); th += K[i]; } }
function gsmooth(a, sig) {       // gaussian-ish (3 box passes), ends padded by linear extrapolation
  if (!sig) return a; const pad = Math.ceil(sig * 3), n = a.length, e = new Float32Array(n + pad * 2);
  const s0 = a[1] - a[0], s1 = a[n - 1] - a[n - 2];
  for (let i = 0; i < e.length; i++) { const j = i - pad; e[i] = j < 0 ? a[0] + s0 * j : j >= n ? a[n - 1] + s1 * (j - n + 1) : a[j]; }
  const w = Math.max(1, Math.round(sig * 0.58)); const r = box(box(box(e, w), w), w); return r.subarray(pad, pad + n);
}
const L = LV.map((sig) => {
  const x = gsmooth(px0, sig), z = gsmooth(pz0, sig), y = gsmooth(py0, sig), lx = new Float32Array(N), lz = new Float32Array(N);
  for (let i = 0; i < N; i++) { const a = Math.max(0, i - 1), b = Math.min(N - 1, i + 1); const tx = x[b] - x[a], tz = z[b] - z[a], l = Math.hypot(tx, tz); lx[i] = tz / l; lz[i] = -tx / l; }
  return { x, z, y, lx, lz };
});
const at = (arr, s) => { const f = clamp(s, 0, N - 1.001), i = Math.floor(f), t = f - i; return arr[i] + (arr[i + 1] - arr[i]) * t; };
export const curvAt = (s) => at(K, s);
export const headingAt = (s) => at(th0, s);
export const roadY = (s) => at(py0, s);
const BANK = 4.2;

/** Horizontal position + base height for road coordinate (s, d). Far from the road the centreline is smoothed so offsets never fold. */
export function base(s, d, out = {}) {
  const sig = Math.max(0, 1.5 * (Math.abs(d) - 7)); let li = 0; while (li < LV.length - 2 && LV[li + 1] < sig) li++;
  const t = clamp((sig - LV[li]) / (LV[li + 1] - LV[li])), A = L[li], B = L[li + 1];
  const ax = at(A.x, s) + at(A.lx, s) * d, az = at(A.z, s) + at(A.lz, s) * d, bx = at(B.x, s) + at(B.lx, s) * d, bz = at(B.z, s) + at(B.lz, s) * d;
  out.x = lerp(ax, bx, t); out.z = lerp(az, bz, t); out.y = lerp(at(A.y, s), at(B.y, s), t); return out;
}
export function narrow(s) { let v = 0; for (const [a, b] of NARROWS) v = Math.max(v, sstep(a - 25, a + 10, s) * (1 - sstep(b - 10, b + 25, s))); return v; }

/** Height above the (smoothed) road level at lateral distance d. */
export function profile(s, d, x, z) {
  const a = Math.abs(d), n1 = noise2(s / 95, 3.1), n2 = noise2(s / 55, 9.2), n3 = noise2(s / 130, 20.5), nar = narrow(s);
  let h; const led = (hh, step, k) => { if (hh < 1) return hh; const q = hh / step + 0.7 * noise2(x / 34, z / 34); const f = Math.floor(q); return lerp(hh, (f + sstep(0.3, 0.9, q - f)) * step, k * sstep(1, 6, hh)); };
  if (d < 0) {
    const wb = 5.5 + 2.4 * n2 - nar * 0.5, Hw = 26 + 36 * n1 + nar * 10;
    if (a < wb) h = -0.2 * sstep(HW, 4.9, a) + 0.3 * sstep(wb - 1.0, wb, a);
    else { const run = Hw * 0.3, t = (a - wb) / run; h = 0.1 + (t < 1 ? Hw * (1 - Math.pow(1 - t, 2.4)) : Hw + (a - wb - run) * 0.36); h = led(h, 6.5, 0.65); }
  } else {
    const eb = 5.4, Dv = 24 + 20 * n3, run = Dv * 0.8;
    if (a < eb) h = -0.08 * sstep(HW, eb, a);
    else {
      const t = (a - eb) / run;
      if (t < 1) h = -0.08 - Dv * Math.pow(sstep(0, 1, t), 0.85);
      else {
        const fw = 90 + 80 * n2, b = a - eb - run;
        if (b < fw) h = -Dv - 2.5 * Math.sin((b / fw) * Math.PI);
        else { const Hf = 60 + 60 * n1, r2 = Hf * 0.5, t2 = (b - fw) / r2; h = -Dv + led(t2 < 1 ? Hf * (1 - Math.pow(1 - t2, 2.0)) : Hf + (b - fw - r2) * 0.28, 9, 0.6); }
      }
    }
    if (nar > 0) h += nar * (15 + 7 * n2) * sstep(5.0, 7.2, a) * (1 - sstep(11, 23, a));
  }
  h += (fbm2(x / 300, z / 300, 4) - 0.5) * 150 * sstep(40, 420, a) + ridged2(x / 950, z / 950, 5) * 480 * sstep(380, 1700, a)
    + (fbm2(x / 45, z / 45, 4) - 0.5) * 15 * sstep(7, 45, a) + (fbm2(x / 6, z / 6, 3) - 0.5) * 1.2 * sstep(4.7, 7.5, a);
  return h;
}
/** World position of the ground at road coordinate (s, d). */
export function ground(s, d, out = {}) {
  base(s, d, out);
  const a = Math.abs(d);
  out.y += -d * curvAt(s) * BANK * (1 - sstep(6, 14, a)) + (a <= HW ? 0 : profile(s, d, out.x, out.z));
  return out;
}
/** Car / camera frame on the road: position, forward (fx,fy,fz), left (lx,lz), up-ish bank roll. */
export function frame(s, d = 0) {
  const p = ground(s, clamp(d, -HW, HW)), q = ground(s + 0.5, clamp(d, -HW, HW)), th = headingAt(s);
  if (Math.abs(d) > HW) { const e = base(s, d); p.x = e.x; p.z = e.z; }
  return { x: p.x, y: p.y, z: p.z, th, slope: (q.y - p.y) / 0.5, bank: -curvAt(s) * BANK };
}
