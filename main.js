import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// Eventually each entry gets its own model; for now they all share one.
const PRODUCTS = [
  { name: 'Mug No. 1', model: 'assets/handmade_pottery_mug.glb', href: 'product.html?id=1' },
  { name: 'Mug No. 2', model: 'assets/handmade_pottery_mug.glb', href: 'product.html?id=2' },
  { name: 'Mug No. 3', model: 'assets/handmade_pottery_mug.glb', href: 'product.html?id=3' },
  { name: 'Mug No. 4', model: 'assets/handmade_pottery_mug.glb', href: 'product.html?id=4' },
  { name: 'Mug No. 5', model: 'assets/handmade_pottery_mug.glb', href: 'product.html?id=5' },
];

const WINDOW_SIZE = 220;
// Mugs stay upright and lean their top slightly toward the cursor.
const MAX_LEAN = THREE.MathUtils.degToRad(12);  // lean when the cursor is far away
const LEAN_FALLOFF = 400;                       // px; lean eases toward max over roughly this distance
const IDLE_SPIN = 0.4;                          // radians per second around the mug's vertical axis
const TILT_EASE = 0.1;                          // slerp factor per frame
const DRAG_THRESHOLD = 5;                       // px of movement before a press becomes a drag/orbit
const ORBIT_SPEED = 0.01;                       // radians per px of pointer movement
const ORBIT_DAMPING = 0.92;                     // inertia decay per frame after release
const MAX_PITCH = THREE.MathUtils.degToRad(70);
const BASE_YAW = -Math.PI * 0.4;                // resting turn so the handle shows in profile

const MENU_BAR_HEIGHT = 20;                  // keep windows from sliding under the menu bar

const stage = document.getElementById('stage');
const mouse = { x: innerWidth / 2, y: innerHeight / 2 };
let dragging = null;
let topZ = 1;

// Load each distinct model file once, then clone it per window.
const loader = new GLTFLoader();
const modelCache = new Map();
function loadModel(url) {
  if (!modelCache.has(url)) {
    modelCache.set(url, loader.loadAsync(url).then((gltf) => normalize(gltf.scene)));
  }
  return modelCache.get(url);
}

// Center the model on the origin and scale it to a unit-ish size.
function normalize(object) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const scale = 1.4 / Math.max(size.x, size.y, size.z);
  object.position.sub(center).multiplyScalar(scale);
  object.scale.setScalar(scale);
  const wrapper = new THREE.Group();
  wrapper.add(object);
  wrapper.rotation.y = BASE_YAW;
  return wrapper;
}

const CLOSE_ICON = `<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
  <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>`;

function createWindow(product, index) {
  const el = document.createElement('div');
  el.className = 'pot-window';
  el.innerHTML = `
    <div class="titlebar">
      <span class="title">${product.name}</span>
      <button class="close" aria-label="Close window">${CLOSE_ICON}</button>
    </div>
    <div class="viewport"></div>`;

  // Scatter the windows in a loose row across the screen.
  const margin = 40;
  const step = (innerWidth - 2 * margin - WINDOW_SIZE) / Math.max(PRODUCTS.length - 1, 1);
  const x = margin + index * step + (Math.random() - 0.5) * 30;
  const y = innerHeight / 2 - WINDOW_SIZE / 2 + (index % 2 ? 70 : -50) + (Math.random() - 0.5) * 40;
  el.style.left = `${clamp(x, 0, innerWidth - WINDOW_SIZE - 10)}px`;
  el.style.top = `${clamp(y, MENU_BAR_HEIGHT + 10, innerHeight - WINDOW_SIZE - 40)}px`;
  el.style.zIndex = topZ++;
  stage.appendChild(el);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(WINDOW_SIZE, WINDOW_SIZE, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  el.querySelector('.viewport').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  const key = new THREE.DirectionalLight(0xffffff, 1.2);
  key.position.set(2, 3, 2);
  scene.add(key);

  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(0, 0.35, 3);
  camera.lookAt(0, 0, 0);

  // pivot: tilt toward the cursor. orbit: the user's grab-to-rotate.
  const pivot = new THREE.Group();
  const orbit = new THREE.Group();
  pivot.add(orbit);
  scene.add(pivot);

  const win = {
    el, renderer, scene, camera, pivot, orbit, product,
    velocity: { x: 0, y: 0 },
    orbiting: false,
  };

  loadModel(product.model).then((model) => {
    orbit.add(model.clone());
  });

  el.addEventListener('pointerdown', () => { el.style.zIndex = topZ++; });
  attachDrag(win);
  attachOrbit(win);
  const closeButton = el.querySelector('.close');
  // Keep presses on the close box from starting a title-bar drag.
  closeButton.addEventListener('pointerdown', (e) => e.stopPropagation());
  closeButton.addEventListener('click', () => closeWindow(win));
  return win;
}

// Tracks a press on `target` and reports movement once it passes DRAG_THRESHOLD.
// A press that never passes the threshold is reported as a click.
function trackPointer(target, { onStart, onMove, onEnd, onClick }) {
  let start = null;

  target.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    target.setPointerCapture(e.pointerId);
    start = { x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false };
  });

  target.addEventListener('pointermove', (e) => {
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (!start.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
      start.moved = true;
      onStart?.();
    }
    if (start.moved) onMove(dx, dy, e.clientX - start.lastX, e.clientY - start.lastY);
    start.lastX = e.clientX;
    start.lastY = e.clientY;
  });

  const end = (e) => {
    if (!start) return;
    const { moved } = start;
    start = null;
    if (moved) onEnd?.();
    else if (e.type === 'pointerup') onClick?.();
  };
  target.addEventListener('pointerup', end);
  target.addEventListener('pointercancel', end);
}

function attachDrag(win) {
  const { el } = win;
  let origin = null;

  trackPointer(el.querySelector('.titlebar'), {
    onStart() {
      origin = { left: el.offsetLeft, top: el.offsetTop };
      dragging = win;
      el.classList.add('dragging');
    },
    onMove(dx, dy) {
      el.style.left = `${clamp(origin.left + dx, 0, innerWidth - el.offsetWidth)}px`;
      el.style.top = `${clamp(origin.top + dy, MENU_BAR_HEIGHT, innerHeight - el.offsetHeight)}px`;
    },
    onEnd() {
      dragging = null;
      el.classList.remove('dragging');
    },
  });
}

function attachOrbit(win) {
  const viewport = win.el.querySelector('.viewport');

  trackPointer(viewport, {
    onStart() {
      win.orbiting = true;
      viewport.classList.add('orbiting');
    },
    onMove(_dx, _dy, stepX, stepY) {
      win.velocity.x = stepY * ORBIT_SPEED;
      win.velocity.y = stepX * ORBIT_SPEED;
      applyOrbit(win);
    },
    onEnd() {
      win.orbiting = false;
      viewport.classList.remove('orbiting');
    },
    onClick() {
      window.location.href = win.product.href;
    },
  });
}

function applyOrbit(win) {
  win.orbit.rotation.y += win.velocity.y;
  win.orbit.rotation.x = clamp(win.orbit.rotation.x + win.velocity.x, -MAX_PITCH, MAX_PITCH);
}

function closeWindow(win) {
  windows.splice(windows.indexOf(win), 1);
  win.el.classList.add('closing');
  win.el.addEventListener('transitionend', () => {
    win.el.remove();
    win.renderer.dispose();
    win.renderer.forceContextLoss();
  }, { once: true });
}

function clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}

addEventListener('pointermove', (e) => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
});

// Keep windows on-screen when the browser is resized.
addEventListener('resize', () => {
  for (const { el } of windows) {
    el.style.left = `${clamp(el.offsetLeft, 0, innerWidth - el.offsetWidth)}px`;
    el.style.top = `${clamp(el.offsetTop, MENU_BAR_HEIGHT, innerHeight - el.offsetHeight)}px`;
  }
});

const windows = PRODUCTS.map(createWindow);

const clockEl = document.getElementById('clock');
function updateClock() {
  clockEl.textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
updateClock();
setInterval(updateClock, 10_000);

Promise.all([...modelCache.values()]).then(() => {
  document.getElementById('loading').classList.add('done');
});

const leanEuler = new THREE.Euler();
const leanQuat = new THREE.Quaternion();

let lastTime = performance.now();

function animate(now = performance.now()) {
  const dt = Math.min((now - lastTime) / 1000, 0.1); // cap so a background tab doesn't jump on return
  lastTime = now;
  for (const win of windows) {
    if (!win.orbiting) win.orbit.rotation.y += IDLE_SPIN * dt;

    // Let a flicked model coast to a stop.
    if (!win.orbiting && (win.velocity.x || win.velocity.y)) {
      win.velocity.x *= ORBIT_DAMPING;
      win.velocity.y *= ORBIT_DAMPING;
      if (Math.abs(win.velocity.x) + Math.abs(win.velocity.y) < 1e-4) win.velocity.x = win.velocity.y = 0;
      applyOrbit(win);
    }

    // While a window is being dragged, all models hold their current pose.
    // A model being orbited also holds its tilt so it doesn't swim under the cursor.
    if (!dragging && !win.orbiting) {
      const rect = win.el.getBoundingClientRect();
      const dx = mouse.x - (rect.left + rect.width / 2);
      const dy = mouse.y - (rect.top + rect.height / 2);
      // Roll sideways toward the cursor; tip the rim toward you when it's below, away when above.
      leanEuler.set(
        Math.tanh(dy / LEAN_FALLOFF) * MAX_LEAN,
        0,
        -Math.tanh(dx / LEAN_FALLOFF) * MAX_LEAN,
      );
      leanQuat.setFromEuler(leanEuler);
      win.pivot.quaternion.slerp(leanQuat, TILT_EASE);
    }
    win.renderer.render(win.scene, win.camera);
  }
  requestAnimationFrame(animate);
}
animate();
