// Entry: builds the canyon, exposes window.__api for the still / film tools, plays the film live when opened by hand.
import * as THREE from 'three';
import { buildWorld } from './world.js';
import { Pipeline } from './pipeline.js';

const qs = new URLSearchParams(location.search), msg = document.getElementById('msg'), log = (s) => { msg.textContent = s; console.log('[canyon] ' + s); };
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; renderer.toneMapping = THREE.NoToneMapping; renderer.setPixelRatio(1);
const camera = new THREE.PerspectiveCamera(40, 2.39, 0.08, 12000);
try {
  const world = await buildWorld(renderer, log);
  const pipe = new Pipeline(renderer, world.scene, camera);
  const api = { THREE, renderer, camera, world, pipe, log,
    resize(w, h) { renderer.setSize(w, h, false); canvas.style.aspectRatio = w + '/' + h; pipe.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); } };
  window.__api = api;
  const film = await import('./film.js'); await film.init(api);
  window.__ready = true; log('');
  if (!qs.has('tool')) film.playLive(api);
} catch (e) { console.error(e); window.__error = String(e && e.stack || e); log(String(e)); }
