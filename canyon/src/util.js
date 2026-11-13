// Shared helpers: seeded randomness, noise, canvas textures. Everything visual is generated from these.
import * as THREE from 'three';

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const ease = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };

export class RNG {
  constructor(seed = 1) { this.s = seed >>> 0 || 1; }
  f() { let t = (this.s += 0x6d2b79f5); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
  r(a = 0, b = 1) { return a + (b - a) * this.f(); }
  n() { return (this.f() + this.f() + this.f() + this.f() - 2) * 0.866; }
  i(a, b) { return Math.floor(this.r(a, b + 1)); }
}

// ---- value noise (2D / 3D), fbm, ridged ----
function h2(ix, iy) { let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; }
function h3(ix, iy, iz) { let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(iz, 1440662683); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; }
const q = (t) => t * t * t * (t * (t * 6 - 15) + 10);
export function noise2(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = q(x - ix), fy = q(y - iy);
  const a = h2(ix, iy), b = h2(ix + 1, iy), c = h2(ix, iy + 1), d = h2(ix + 1, iy + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
export function noise3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = q(x - ix), fy = q(y - iy), fz = q(z - iz);
  const l = (a, b, t) => a + (b - a) * t;
  return l(l(l(h3(ix, iy, iz), h3(ix + 1, iy, iz), fx), l(h3(ix, iy + 1, iz), h3(ix + 1, iy + 1, iz), fx), fy),
    l(l(h3(ix, iy, iz + 1), h3(ix + 1, iy, iz + 1), fx), l(h3(ix, iy + 1, iz + 1), h3(ix + 1, iy + 1, iz + 1), fx), fy), fz);
}
export function fbm2(x, y, oct = 5) { let s = 0, a = 0.5, n = 0; for (let i = 0; i < oct; i++) { s += a * noise2(x, y); n += a; x = x * 2.03 + 17.1; y = y * 2.03 - 9.7; a *= 0.5; } return s / n; }
export function fbm3(x, y, z, oct = 4) { let s = 0, a = 0.5, n = 0; for (let i = 0; i < oct; i++) { s += a * noise3(x, y, z); n += a; x = x * 2.03 + 17.1; y = y * 2.03 - 9.7; z = z * 2.03 + 4.3; a *= 0.5; } return s / n; }
export function ridged2(x, y, oct = 5) { let s = 0, a = 0.5, n = 0, w = 1; for (let i = 0; i < oct; i++) { let v = 1 - Math.abs(noise2(x, y) * 2 - 1); v *= v * w; w = clamp(v * 2); s += a * v; n += a; x = x * 2.1 + 31.3; y = y * 2.1 + 11.9; a *= 0.5; } return s / n; }

// ---- canvas / textures ----
export function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
export function tex(c, { srgb = true, repeat = true, aniso = 8, mip = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso; t.generateMipmaps = mip; t.minFilter = mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  return t;
}
/** Tiling fbm field (Float32Array n*n, 0..1) built from periodic value noise. */
export function tileNoise(n, cells, oct = 5, seed = 0, ridge = false) {
  const out = new Float32Array(n * n);
  let amp = 0.5, tot = 0;
  for (let o = 0; o < oct; o++) {
    const c = cells << o; if (c > n) break;
    const g = new Float32Array(c * c); for (let i = 0; i < c * c; i++) g[i] = h3(i % c, (i / c) | 0, seed + o * 13);
    for (let y = 0; y < n; y++) {
      const v = (y / n) * c, iy = Math.floor(v), fy = q(v - iy), y0 = iy % c, y1 = (iy + 1) % c;
      for (let x = 0; x < n; x++) {
        const u = (x / n) * c, ix = Math.floor(u), fx = q(u - ix), x0 = ix % c, x1 = (ix + 1) % c;
        const a = g[y0 * c + x0], b = g[y0 * c + x1], cc = g[y1 * c + x0], d = g[y1 * c + x1];
        let val = a + (b - a) * fx + (cc - a) * fy + (a - b - cc + d) * fx * fy;
        if (ridge) val = 1 - Math.abs(val * 2 - 1);
        out[y * n + x] += val * amp;
      }
    }
    tot += amp; amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}
/** Canvas from a per-pixel function fn(i, x, y) -> [r,g,b,a] in 0..255. */
export function pixelCanvas(n, fn, m = n) {
  const c = canvas(n, m), ctx = c.getContext('2d'), im = ctx.createImageData(n, m), d = im.data;
  for (let y = 0; y < m; y++) for (let x = 0; x < n; x++) { const i = y * n + x, p = fn(i, x, y); d[i * 4] = p[0]; d[i * 4 + 1] = p[1]; d[i * 4 + 2] = p[2]; d[i * 4 + 3] = p[3] === undefined ? 255 : p[3]; }
  ctx.putImageData(im, 0, 0); return c;
}
/** Normal map canvas from a tiling height field. */
export function normalCanvas(hf, n, strength = 2) {
  return pixelCanvas(n, (i, x, y) => {
    const xm = (x + n - 1) % n, xp = (x + 1) % n, ym = (y + n - 1) % n, yp = (y + 1) % n;
    const dx = (hf[y * n + xp] - hf[y * n + xm]) * strength, dy = (hf[yp * n + x] - hf[ym * n + x]) * strength;
    const l = 1 / Math.hypot(dx, dy, 1);
    return [(-dx * l * 0.5 + 0.5) * 255, (dy * l * 0.5 + 0.5) * 255, (l * 0.5 + 0.5) * 255];
  });
}
export const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
/** 1D Catmull-Rom through points [[x, y], ...] sorted by x. */
export function curve(pts) {
  return (x) => {
    const n = pts.length; if (x <= pts[0][0]) return pts[0][1]; if (x >= pts[n - 1][0]) return pts[n - 1][1];
    let i = 0; while (x > pts[i + 1][0]) i++;
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n - 1, i + 2)];
    const t = (x - p1[0]) / (p2[0] - p1[0]);
    const m1 = (p2[1] - p0[1]) / (p2[0] - p0[0]) * (p2[0] - p1[0]), m2 = (p3[1] - p1[1]) / (p3[0] - p1[0]) * (p2[0] - p1[0]);
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * p1[1] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2[1] + (t3 - t2) * m2;
  };
}
