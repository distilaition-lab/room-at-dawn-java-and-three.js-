import * as THREE from 'three';
import { frame } from './track.js';
import { buildCar } from './car.js';
export async function init(api) {
  const car = buildCar(); api.car = car; api.world.scene.add(car.root); api.world.hide.push(car.root);
  api.placeCar = (s, d = 0, drift = 0) => { const f = frame(s, d); car.root.position.set(f.x, f.y, f.z); car.root.rotation.set(-Math.atan(f.slope), f.th + drift, f.bank, 'YXZ'); car.root.updateMatrixWorld(true); return f; };
  // camera given in car-local coordinates (x left, y up, z forward)
  api.carShot = ({ s = 620, d = -1.8, pos, target, fov = 40, w = 960, h = 402, n = 1, R = 12, ap = 0, set = {}, exp }) => {
    api.resize(w, h); const cam = api.camera; api.placeCar(s, d); car.set(set);
    const P = car.root.localToWorld(new THREE.Vector3().fromArray(pos)), T = car.root.localToWorld(new THREE.Vector3().fromArray(target));
    const pose = () => { cam.position.copy(P); cam.fov = fov; cam.up.set(0, 1, 0); cam.lookAt(T); cam.updateProjectionMatrix(); };
    api.world.setShadow(car.root.position, R); if (!api._env) { api.world.captureEnv(car.root.position.clone().add(new THREE.Vector3(0, 1, 0))); api._env = 1; }
    if (exp) api.pipe.look.exposure = exp;
    api.pipe.renderFrame({ t: 0, shutter: 0.02, n, pose, full: pose, car: car.root, lens: { ap, focus: P.distanceTo(T) }, toScreen: true }); api.renderer.getContext().finish(); return 1;
  };
  api.frame = frame;
}
export function playLive() {}
