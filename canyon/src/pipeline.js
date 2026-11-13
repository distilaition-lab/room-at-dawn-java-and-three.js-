// Film pipeline. Every frame is the average of N sub-frames spread over a 180° shutter. Each sub-frame is
// additionally smeared along its own screen motion (camera reprojection from depth; the car, flagged in alpha,
// uses the car's transform instead) so a handful of sub-frames give continuous motion blur. Lens jitter +
// a small gather blur give depth of field. Then bloom, an anamorphic streak and the grade.
import * as THREE from 'three';

const tri = new THREE.BufferGeometry();
tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const ADD = { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor };
class Pass {
  constructor(frag, uniforms, opts = {}) {
    this.mat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: 'precision highp float; varying vec2 vUv;\n' + frag, uniforms, depthTest: false, depthWrite: false, ...opts });
    this.mesh = new THREE.Mesh(tri, this.mat); this.mesh.frustumCulled = false; this.cam = new THREE.Camera();
  }
  get u() { return this.mat.uniforms; }
  render(r, target) { r.setRenderTarget(target); r.render(this.mesh, this.cam); }
}
const HASH = 'float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }\n';

const DOF_FS = HASH + /* glsl */`
uniform sampler2D tColor, tDepth; uniform mat4 uProjInv; uniform vec2 uRes; uniform float uFocus, uK, uSeed;
float vz(vec2 uv){ float d = texture2D(tDepth, uv).x; vec4 c = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); return -c.z / c.w; }
void main(){
  float z = vz(vUv); float coc = min(uK * abs(1.0 / z - 1.0 / uFocus), 22.0);
  vec4 c0 = texture2D(tColor, vUv);
  if (coc < 0.6) { gl_FragColor = c0; return; }
  float a0 = ign(gl_FragCoord.xy + uSeed) * 6.2831853; vec4 s = c0; float w = 1.0;
  for (int i = 0; i < 10; i++) {
    float fi = (float(i) + 0.5) / 10.0, a = a0 + float(i) * 2.399963, r = sqrt(fi) * coc;
    vec2 uv = vUv + vec2(cos(a), sin(a)) * r / uRes;
    float zs = vz(uv), cs = min(uK * abs(1.0 / zs - 1.0 / uFocus), 22.0);
    float k = (zs < z - 0.02 * z) ? smoothstep(0.0, 1.0, cs / max(r, 0.5)) : 1.0;   // nearer samples only bleed if they are blurry themselves
    s += texture2D(tColor, uv) * k; w += k;
  }
  gl_FragColor = vec4(s.rgb / w, c0.a);
}`;

const MB_FS = HASH + /* glsl */`
uniform sampler2D tColor, tDepth; uniform mat4 uInvVP, uVP0, uVP1, uCar0, uCar1; uniform float uWeight, uSeed, uMax;
void main(){
  vec4 c0 = texture2D(tColor, vUv); float d = texture2D(tDepth, vUv).x;
  vec4 wp = uInvVP * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); wp /= wp.w;
  bool car = abs(c0.a - 0.5) < 0.22 && d < 0.99999;
  vec4 p0 = uVP0 * (car ? uCar0 * wp : wp), p1 = uVP1 * (car ? uCar1 * wp : wp);
  vec2 vel = (p1.xy / p1.w - p0.xy / p0.w) * 0.5;
  if (p0.w <= 0.0 || p1.w <= 0.0) vel = vec2(0.0);
  float l = length(vel); if (l > uMax) vel *= uMax / l;
  vec3 s = vec3(0.0); float j = ign(gl_FragCoord.xy + uSeed) - 0.5;
  if (l < 0.0004) s = c0.rgb * 7.0;
  else for (int i = 0; i < 7; i++) {
    vec4 c = texture2D(tColor, vUv + vel * ((float(i) + 0.5 + j) / 7.0 - 0.5));
    bool cc = abs(c.a - 0.5) < 0.22;
    s += (cc == car || !car) ? c.rgb : c0.rgb;
  }
  gl_FragColor = vec4(min(s / 7.0, vec3(48.0)) * uWeight, 1.0);
}`;

const DOWN_FS = /* glsl */`
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThresh;
void main(){
  vec3 a = texture2D(tSrc, vUv).rgb * 4.0;
  a += texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  a /= 8.0;
  if (uThresh > 0.0) { float l = max(a.r, max(a.g, a.b)); a *= smoothstep(uThresh * 0.6, uThresh * 2.2, l); }
  gl_FragColor = vec4(a, 1.0);
}`;
const UP_FS = /* glsl */`
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uK;
void main(){
  vec3 s = texture2D(tSrc, vUv + uTexel * vec2(-1.0, 0.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, 0.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(0.0, -1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(0.0, 1.0)).rgb;
  s = s * 2.0 + texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  gl_FragColor = vec4(s / 12.0 * uK, 1.0);
}`;
const STREAK_FS = /* glsl */`
uniform sampler2D tSrc; uniform vec2 uStep; uniform float uThresh;
void main(){
  vec3 s = vec3(0.0); float w = 0.0;
  for (int i = -8; i <= 8; i++) { float k = exp(-float(i * i) / 26.0); vec3 c = texture2D(tSrc, vUv + uStep * float(i)).rgb;
    if (uThresh > 0.0) c *= smoothstep(uThresh, uThresh * 3.0, max(c.r, max(c.g, c.b))); s += c * k; w += k; }
  gl_FragColor = vec4(s / w, 1.0);
}`;
const FINAL_FS = /* glsl */`
uniform sampler2D tColor, tBloom, tStreak;
uniform float uExposure, uBloom, uStreak, uVignette, uGrain, uSeed, uSat, uContrast, uFade, uCA, uFlash;
uniform vec3 uShadowTint, uHighTint, uWB; uniform vec2 uRes;
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float uchi(float x){
  const float P = 1.0, a = 1.0, m = 0.22, l = 0.4, c = 1.33, b = 0.0;
  float l0 = ((P - m) * l) / a, S0 = m + l0, S1 = m + a * l0, C2 = (a * P) / (P - S1), CP = -C2 / P;
  float w0 = 1.0 - smoothstep(0.0, m, x), w2 = step(m + l0, x), w1 = 1.0 - w0 - w2;
  float T = m * pow(x / m, c) + b, Lc = m + a * (x - m), Sc = P - (P - S1) * exp(CP * (x - S0));
  return T * w0 + Lc * w1 + Sc * w2;
}
vec3 tonemap(vec3 c){
  float l = max(luma(c), 1e-5); vec3 byLum = c * (uchi(l) / l); vec3 byCh = vec3(uchi(c.r), uchi(c.g), uchi(c.b));
  vec3 o = mix(byLum, byCh, 0.6); float over = smoothstep(0.75, 1.05, max(o.r, max(o.g, o.b)));
  return mix(o, vec3(min(luma(o), 1.0)), over * 0.55);
}
vec3 srgb(vec3 c){ return mix(c * 12.92, 1.055 * pow(max(c, 0.0), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main(){
  vec2 q = vUv - 0.5; float r2 = dot(q, q);
  vec2 ca = q * r2 * uCA;
  vec3 c = vec3(texture2D(tColor, vUv - ca).r, texture2D(tColor, vUv).g, texture2D(tColor, vUv + ca).b);
  c += texture2D(tBloom, vUv).rgb * uBloom + texture2D(tStreak, vUv).rgb * uStreak * vec3(0.55, 0.75, 1.3);
  c *= uExposure * uWB;
  q.x *= uRes.x / uRes.y * 0.62; c *= mix(1.0, smoothstep(1.0, 0.22, length(q)), uVignette);
  float l = luma(c); float sh = 1.0 - smoothstep(0.0, 0.22, l), hi = smoothstep(0.3, 1.4, l);
  c *= mix(mix(vec3(1.0), uShadowTint, sh), uHighTint, hi);
  l = luma(c); c = mix(vec3(l), c, uSat);
  c = pow(max(c, 0.0) / 0.18, vec3(uContrast)) * 0.18;
  c = c * uFade + uFlash;
  c = srgb(clamp(tonemap(c), 0.0, 1.0));
  float g = hash(gl_FragCoord.xy + uSeed * 91.7) - 0.5; c += g * (uGrain * (1.0 - 0.6 * luma(c)) + 1.0 / 255.0);
  gl_FragColor = vec4(c, 1.0);
}`;

export const LOOK = {
  exposure: 1.0, bloom: 0.07, streak: 0.10, vignette: 0.42, grain: 0.035, sat: 1.12, contrast: 1.12, ca: 0.012, fade: 1, flash: 0,
  shadowTint: [0.82, 0.98, 1.16], highTint: [1.06, 1.0, 0.92], wb: [1.0, 1.0, 1.0],
};

export class Pipeline {
  constructor(renderer, scene, camera) {
    this.r = renderer; this.scene = scene; this.camera = camera; this.look = { ...LOOK }; this.frame = 0; this.w = 0;
    const M = () => ({ value: new THREE.Matrix4() }), T = () => ({ value: null }), F = (v = 0) => ({ value: v }), V2 = () => ({ value: new THREE.Vector2() });
    this.dof = new Pass(DOF_FS, { tColor: T(), tDepth: T(), uProjInv: M(), uRes: V2(), uFocus: F(10), uK: F(0), uSeed: F() });
    this.mb = new Pass(MB_FS, { tColor: T(), tDepth: T(), uInvVP: M(), uVP0: M(), uVP1: M(), uCar0: M(), uCar1: M(), uWeight: F(1), uSeed: F(), uMax: F(0.2) }, ADD);
    this.down = new Pass(DOWN_FS, { tSrc: T(), uTexel: V2(), uThresh: F() });
    this.up = new Pass(UP_FS, { tSrc: T(), uTexel: V2(), uK: F(1) }, ADD);
    this.streak = new Pass(STREAK_FS, { tSrc: T(), uStep: V2(), uThresh: F() });
    this.final = new Pass(FINAL_FS, { tColor: T(), tBloom: T(), tStreak: T(), uExposure: F(1), uBloom: F(), uStreak: F(), uVignette: F(), uGrain: F(), uSeed: F(), uSat: F(1), uContrast: F(1), uFade: F(1), uCA: F(), uFlash: F(),
      uShadowTint: { value: new THREE.Color() }, uHighTint: { value: new THREE.Color() }, uWB: { value: new THREE.Color() }, uRes: V2() });
  }
  setSize(w, h) {
    if (w === this.w && h === this.h) return; this.w = w; this.h = h;
    const opt = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
    this.rtMain = new THREE.WebGLRenderTarget(w, h, { ...opt, depthBuffer: true });
    this.rtMain.depthTexture = new THREE.DepthTexture(w, h, THREE.UnsignedIntType); this.rtMain.depthTexture.minFilter = this.rtMain.depthTexture.magFilter = THREE.NearestFilter;
    this.rtDof = new THREE.WebGLRenderTarget(w, h, opt); this.rtAccum = new THREE.WebGLRenderTarget(w, h, { ...opt, type: THREE.FloatType });
    this.rtOut = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
    this.mips = []; let mw = w, mh = h;
    for (let i = 0; i < 6; i++) { mw = Math.max(2, Math.ceil(mw / 2)); mh = Math.max(2, Math.ceil(mh / 2)); this.mips.push(new THREE.WebGLRenderTarget(mw, mh, opt)); }
    this.rtS1 = new THREE.WebGLRenderTarget(this.mips[1].width, this.mips[1].height, opt); this.rtS2 = new THREE.WebGLRenderTarget(this.mips[1].width, this.mips[1].height, opt);
  }
  /** opts: t (frame start), shutter (seconds open), n sub-frames, pose(t) sets camera + car transforms, full(t) sets everything,
   *  car: Object3D whose matrixWorld is the tracked rigid body, lens: { ap (m, aperture radius), focus (m) }, toScreen */
  renderFrame({ t, shutter, n, pose, full, car, lens = { ap: 0, focus: 10 }, toScreen = false, out = true }) {
    const r = this.r, cam = this.camera, w = this.w, h = this.h, mb = this.mb.u;
    const VPa = new THREE.Matrix4(), VPb = new THREE.Matrix4(), Ca = new THREE.Matrix4(), Cb = new THREE.Matrix4(), Cm = new THREE.Matrix4(), tmp = new THREE.Matrix4();
    const grab = (tt, VP, C) => { pose(tt); cam.updateMatrixWorld(true); VP.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); if (car) { car.updateMatrixWorld(true); C.copy(car.matrixWorld); } };
    r.setRenderTarget(this.rtAccum); r.setClearColor(0x000000, 0); r.clear();
    grab(t, VPa, Ca);
    const right = new THREE.Vector3(), up = new THREE.Vector3(), fwd = new THREE.Vector3(), fp = new THREE.Vector3();
    for (let k = 0; k < n; k++) {
      const t1 = t + shutter * (k + 1) / n, tm = t + shutter * (k + 0.5) / n;
      grab(t1, VPb, Cb);
      full(tm); cam.updateMatrixWorld(true); if (car) { car.updateMatrixWorld(true); Cm.copy(car.matrixWorld).invert(); }
      // sub-pixel jitter (AA) + lens jitter (DOF)
      const i = this.frame * n + k, jx = ((i * 0.754877666) % 1) - 0.5, jy = ((i * 0.569840291) % 1) - 0.5;
      cam.setViewOffset(w, h, jx, jy, w, h);
      if (lens.ap > 0) {
        const a = (k + ((this.frame * 0.618) % 1)) * 2.399963, rr = Math.sqrt((k + 0.5) / n) * lens.ap;
        cam.matrixWorld.extractBasis(right, up, fwd); fp.copy(cam.position).addScaledVector(fwd, -lens.focus);
        cam.position.addScaledVector(right, Math.cos(a) * rr).addScaledVector(up, Math.sin(a) * rr); cam.up.copy(up); cam.lookAt(fp);
      }
      cam.updateMatrixWorld(true);
      r.setRenderTarget(this.rtMain); r.setClearColor(0x000000, 0); r.clear(); r.render(this.scene, cam);
      let src = this.rtMain;
      if (lens.ap > 0) {
        const u = this.dof.u; u.tColor.value = this.rtMain.texture; u.tDepth.value = this.rtMain.depthTexture; u.uProjInv.value.copy(cam.projectionMatrixInverse); u.uRes.value.set(w, h);
        u.uFocus.value = lens.focus; u.uK.value = lens.ap * (h / 2) / Math.tan(cam.fov * Math.PI / 360) * 0.95 / Math.sqrt(n); u.uSeed.value = i % 61;
        this.dof.render(r, this.rtDof); src = this.rtDof;
      }
      mb.tColor.value = src.texture; mb.tDepth.value = this.rtMain.depthTexture;
      tmp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); mb.uInvVP.value.copy(tmp).invert();
      mb.uVP0.value.copy(VPa); mb.uVP1.value.copy(VPb); mb.uCar0.value.multiplyMatrices(Ca, Cm); mb.uCar1.value.multiplyMatrices(Cb, Cm);
      mb.uWeight.value = 1 / n; mb.uSeed.value = (i * 7) % 61;
      this.mb.render(r, this.rtAccum);
      cam.clearViewOffset(); VPa.copy(VPb); Ca.copy(Cb);
    }
    this.frame++;
    if (out) this.present(toScreen);
  }
  present(toScreen) {
    const r = this.r, L = this.look, m = this.mips;
    this.down.u.tSrc.value = this.rtAccum.texture; this.down.u.uTexel.value.set(1 / this.w, 1 / this.h); this.down.u.uThresh.value = 1.1; this.down.render(r, m[0]);
    for (let i = 1; i < m.length; i++) { this.down.u.tSrc.value = m[i - 1].texture; this.down.u.uTexel.value.set(1 / m[i - 1].width, 1 / m[i - 1].height); this.down.u.uThresh.value = 0; this.down.render(r, m[i]); }
    const s = this.streak.u; s.tSrc.value = m[1].texture; s.uStep.value.set(2.2 / m[1].width, 0); s.uThresh.value = 3.0; this.streak.render(r, this.rtS1);
    s.tSrc.value = this.rtS1.texture; s.uStep.value.set(9 / m[1].width, 0); s.uThresh.value = 0; this.streak.render(r, this.rtS2);
    for (let i = m.length - 1; i > 0; i--) { this.up.u.tSrc.value = m[i].texture; this.up.u.uTexel.value.set(1 / m[i].width, 1 / m[i].height); this.up.u.uK.value = 1; this.up.render(r, m[i - 1]); }
    const f = this.final.u; f.tColor.value = this.rtAccum.texture; f.tBloom.value = m[0].texture; f.tStreak.value = this.rtS2.texture;
    f.uExposure.value = L.exposure; f.uBloom.value = L.bloom; f.uStreak.value = L.streak; f.uVignette.value = L.vignette; f.uGrain.value = L.grain; f.uSeed.value = this.frame % 97;
    f.uSat.value = L.sat; f.uContrast.value = L.contrast; f.uFade.value = L.fade; f.uCA.value = L.ca; f.uFlash.value = L.flash;
    f.uShadowTint.value.fromArray(L.shadowTint); f.uHighTint.value.fromArray(L.highTint); f.uWB.value.fromArray(L.wb); f.uRes.value.set(this.w, this.h);
    this.final.render(r, toScreen ? null : this.rtOut);
  }
}
