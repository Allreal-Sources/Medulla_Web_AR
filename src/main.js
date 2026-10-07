import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

import {
  MindARThree
} from "https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image-three.prod.js";

import {
  parseGIF,
  decompressFrames
} from "gifuct-js";


// ============================================================
// OPENING SCREEN (shown while loading, before the scan starts)
// ============================================================
// Dark green page with a spinner, progress bar and 3 quick steps.
// It is built here, so nothing else is needed. (If index.html already
// contains an element with id="ar-loader" -- see loader-snippet.html --
// that one is used instead, which also removes the blank flash while the
// libraries download.)
//   arLoader.set(percent, "text")  move the bar (never goes backwards)
//   arLoader.tick()                one loading step finished
//   arLoader.done()                fade the screen out
//   arLoader.error("text")         show a problem instead of spinning forever

const LOADER_STEPS = 9;   // 8 GIFs + the fonts: each one moves the bar a little

const arLoader = (() => {

  const css = `
#ar-loader{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;background:radial-gradient(120% 90% at 50% 0%,#12372f 0%,#0a2a23 45%,#06201a 100%);color:#eafaf1;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;transition:opacity .5s ease}
#ar-loader.arl-hide{opacity:0;pointer-events:none}
#ar-loader .arl-wrap{width:min(360px,100%);text-align:center}
#ar-loader .arl-spinner{width:48px;height:48px;margin:0 auto 22px;border-radius:50%;border:4px solid rgba(255,255,255,.14);border-top-color:#17e06b;animation:arl-spin 1s linear infinite}
#ar-loader.arl-err .arl-spinner{animation:none;border-color:#ff6b6b}
#ar-loader .arl-title{font-size:18px;font-weight:700;color:#fff;margin:0 0 6px}
#ar-loader .arl-sub{font-size:14px;color:#9fb8ae;margin:0 0 16px;min-height:1.3em}
#ar-loader .arl-bar{height:5px;border-radius:99px;background:rgba(255,255,255,.12);overflow:hidden}
#ar-loader .arl-fill{height:100%;width:0;border-radius:99px;background:#17e06b;transition:width .35s ease}
#ar-loader .arl-card{margin-top:26px;padding:18px 20px;border-radius:14px;background:rgba(255,255,255,.07);text-align:left}
#ar-loader .arl-step{display:flex;gap:12px;align-items:flex-start;font-size:14px;font-weight:500;line-height:1.35;color:#f2fbf6}
#ar-loader .arl-step+.arl-step{margin-top:14px}
#ar-loader .arl-step b{color:#fff;font-weight:700}
#ar-loader .arl-num{flex:none;width:22px;height:22px;border-radius:50%;background:#17e06b;color:#04261c;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center}
#ar-loader .arl-note{margin:18px 0 0;font-size:11.5px;line-height:1.4;color:#8aa69b;text-align:center}
@keyframes arl-spin{to{transform:rotate(360deg)}}`;

  const html = `
<div class="arl-wrap">
  <div class="arl-spinner"></div>
  <p class="arl-title">Preparing your AR experience</p>
  <p class="arl-sub" id="arl-sub">Loading... please wait</p>
  <div class="arl-bar"><div class="arl-fill" id="arl-fill"></div></div>
  <div class="arl-card">
    <div class="arl-step"><span class="arl-num">1</span><span>Tap <b>Allow</b> when asked for camera access</span></div>
    <div class="arl-step"><span class="arl-num">2</span><span>Point your phone at the brochure page and keep the whole page in view</span></div>
    <div class="arl-step"><span class="arl-num">3</span><span>Hold steady, then tap an icon to explore</span></div>
  </div>
  <p class="arl-note">The first load can take a few seconds. Please keep this screen open.</p>
</div>`;

  let root = document.getElementById("ar-loader");
  if (!root) {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    root = document.createElement("div");
    root.id = "ar-loader";
    root.innerHTML = html;
    document.body.appendChild(root);
  }

  const fill = root.querySelector("#arl-fill");
  const sub = root.querySelector("#arl-sub");
  let pct = 0;
  let finished = false;

  const api = {
    set(p, text) {
      if (finished) return;
      pct = Math.max(pct, Math.min(100, p));
      fill.style.width = pct + "%";
      if (text) sub.textContent = text;
    },
    tick() {
      // each loading step moves the bar from 20% towards 85%
      api.set(pct + (85 - 20) / LOADER_STEPS);
    },
    done() {
      if (finished) return;
      api.set(100, "Ready");
      finished = true;
      setTimeout(() => {
        root.classList.add("arl-hide");
        setTimeout(() => root.remove(), 600);
      }, 350);
    },
    error(text) {
      finished = true;
      root.classList.add("arl-err");
      sub.textContent = text;
    }
  };

  // If something fails while loading, say so instead of spinning forever.
  window.addEventListener("unhandledrejection", () => {
    if (!finished) api.error("Something went wrong. Please reload the page.");
  });
  window.addEventListener("error", () => {
    if (!finished) api.error("Something went wrong. Please reload the page.");
  });

  return api;
})();


// ============================================================
// CONFIG
// ============================================================

const IMAGE_TARGET = "/targets/brochure.mind";

const INDIA_MAP = "/assets/india-map.png";

// 0.5 = faster than original GIF
const GIF_SPEED = 0.5;

// Spawn animation (icons pop in one after another)
const SPAWN_STAGGER = 200;    // ms between each icon starting
const SPAWN_DURATION = 700;   // ms for one icon's pop-in
const SPAWN_RISE = 0.04;      // icons start this far below their spot

// India map overlay spawns first, then the icons follow
const MAP_SPAWN_DURATION = 800;   // ms for the map to fade/scale in
const ICON_START_DELAY = 500;     // ms after target found before first icon pops

// Text panel fade-in when an icon is tapped
const TEXT_FADE_DURATION = 350;   // ms
const TEXT_RISE = 0.02;           // text slides up this far while fading in

// ------------------------------------------------------------
// Decor layers: logo, mountains, waves
// Put the files in /assets:  03.png = logo, 11.png = mountains,
// 12.png = waves.
//
// left / top / scale are measured on the 1080 x 1920 sample
// brochure frame (BI-Brochure_A4-frame-8-layered.png):
//   left, top = where the PNG's top-left corner sits, in frame pixels
//   scale     = PNG size relative to its own pixels (1 = same size)
//   delay     = ms after target found before it starts appearing
// ------------------------------------------------------------
const DECOR = [
  { id: "logo",      url: "/assets/03.png", left: 45,   top: 10,   scale: 0.52, delay: 0, face: true },
  { id: "mountains", url: "/assets/11.png", left: 170,  top: 369,  scale: 1,    delay: 300 },
  { id: "waves",     url: "/assets/12.png", left: -104, top: 1307, scale: 1,    delay: 500 }
];

const FRAME_W = 1080;        // width of the sample brochure frame (px)
const MAP_TOP = 369;         // y (px) in the frame where india-map.png starts
const DECOR_SPAWN_DURATION = 700;   // ms for each decor layer to fade in
const DECOR_RISE = 0.03;            // decor slides up this far while fading in

// Keep text upright on screen. When the phone is tilted (or the camera is wide-angle),
// anything far from the brochure's centre leans over. These layers keep their spot on
// the page but turn to face the camera, so their lines stay horizontal.
const FACE_CAMERA_PAGE_TEXT = true;   // logo, headline, tagline, footnote
const FACE_CAMERA_CALLOUTS = true;    // the panels that open when an icon is tapped


// ============================================================
// MINDAR
// ============================================================

const mindarThree = new MindARThree({
  container: document.body,
  imageTargetSrc: IMAGE_TARGET,

  // Jitter smoothing (One-Euro filter).
  //   filterMinCF -- lower = smoother/less jitter, more lag on real motion
  //   filterBeta  -- higher = snappier on real motion, more jitter let in
  filterMinCF: 0.0001,
  filterBeta: 10,

  // Frames the target can go undetected before "lost" fires.
  missTolerance: 5,
  warmupTolerance: 5,
});

const {
  renderer,
  scene,
  camera
} = mindarThree;


// ============================================================
// TARGET
// ============================================================

const anchor = mindarThree.addAnchor(0);

// Everything (map, decor, icons, text) lives in this "stage" group.
// Nudge it here if the overlay does not sit exactly on the printed
// brochure. Units: 1 = full brochure width.
//   STAGE_OFFSET_X  + moves right,  - moves left
//   STAGE_OFFSET_Y  + moves up,     - moves down
//   STAGE_SCALE     > 1 bigger,     < 1 smaller (around the centre)
const STAGE_OFFSET_X = 0;
const STAGE_OFFSET_Y = 0;
const STAGE_SCALE = 1;

const stage = new THREE.Group();
stage.position.set(STAGE_OFFSET_X, STAGE_OFFSET_Y, 0);
stage.scale.set(STAGE_SCALE, STAGE_SCALE, 1);

// ---- Adaptive pose smoothing -------------------------------------------
// MindAR writes the raw (noisy) pose into anchor.group. Instead of parenting
// the content to it directly, content hangs off `smoothRoot`, which chases
// the raw pose every frame:
//   - holding still / tiny shake  -> heavy smoothing (jitter disappears)
//   - real, fast movement         -> light smoothing (follows with little lag)
// Tune these three if needed.
const SMOOTH_MIN_ALPHA = 0.06;   // lower = steadier when still (0.03 - 0.15)
const SMOOTH_POS_GAIN  = 12;     // how fast alpha rises with movement (units/frame)
const SMOOTH_ROT_GAIN  = 4;      // same, for rotation (radians/frame)

const smoothRoot = new THREE.Group();
smoothRoot.visible = false;
scene.add(smoothRoot);
smoothRoot.add(stage);

const _rawPos = new THREE.Vector3();
const _rawQuat = new THREE.Quaternion();
const _rawScale = new THREE.Vector3();
let smoothHasPose = false;

// ---- SCAN ONCE, THEN LOCK IN SPACE --------------------------------------
// After the brochure is found, the content is given LOCK_DELAY ms to settle,
// then LOCKED: tracking is ignored and the map / icons / text stay at that
// exact spot in the room, even if the phone moves or the brochure leaves the
// view. The phone's gyroscope counter-rotates the content so it stays put
// when the phone turns or tilts. (Phone sliding sideways is not tracked --
// that needs full SLAM, which WebAR on iPhone does not offer.)
// The Re-scan button unlocks it and waits for the brochure again.
const LOCK_DELAY = 1200;            // ms after first detection before locking
const RESCAN_BUTTON_POS = "right";  // "right" or "center" (bottom of screen)

let locked = false;
let lockTimer = null;

const lockPos = new THREE.Vector3();
const lockQuat = new THREE.Quaternion();
const lockQ0 = new THREE.Quaternion();     // phone orientation at lock time
let lockHasBase = false;                   // true once we have a gyro baseline

// -- phone orientation (same maths as three.js DeviceOrientationControls) --
const motionQ = new THREE.Quaternion();    // camera orientation in the room
const _mEuler = new THREE.Euler();
const _mQ1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
const _mQs = new THREE.Quaternion();
const _mZ = new THREE.Vector3(0, 0, 1);
let motionHasData = false;

window.addEventListener("deviceorientation", (e) => {
  if (e.alpha == null || e.beta == null || e.gamma == null) return;
  const rad = THREE.MathUtils.degToRad;
  const screenAngle =
    (screen.orientation && typeof screen.orientation.angle === "number")
      ? screen.orientation.angle
      : (window.orientation || 0);
  _mEuler.set(rad(e.beta), rad(e.alpha), -rad(e.gamma), "YXZ");
  motionQ.setFromEuler(_mEuler);
  motionQ.multiply(_mQ1);                                    // camera looks out the back
  motionQ.multiply(_mQs.setFromAxisAngle(_mZ, -rad(screenAngle)));
  motionHasData = true;
});

// iPhone only gives motion data after a permission prompt that must come
// from a tap. The first tap anywhere asks for it; Android needs nothing.
let motionAsked = false;
function askMotionPermission() {
  if (motionAsked) return;
  motionAsked = true;
  const DOE = window.DeviceOrientationEvent;
  if (DOE && typeof DOE.requestPermission === "function") {
    DOE.requestPermission().catch((err) => console.warn("Motion permission:", err));
  }
}
document.addEventListener("touchend", askMotionPermission, { passive: true });
document.addEventListener("click", askMotionPermission, { passive: true });

// Gyro tuning (this is what makes the locked content sway left/right):
//   GYRO_COMPENSATION = false -> content is simply pinned to the screen at
//                                its first position and never moves at all.
//   GYRO_DEADZONE_DEG  -> turns smaller than this are ignored (stops idle sway)
//   GYRO_MIN_ALPHA     -> smoothing of the gyro signal (lower = steadier,
//                         but slower to follow a real turn)
const GYRO_COMPENSATION = false;   // true = content sways with the phone, false = pinned to screen
const GYRO_DEADZONE_DEG = 0.35;
const GYRO_MIN_ALPHA = 0.12;
const GYRO_FOLLOW_GAIN = 6;        // bigger real turns follow faster

const motionS = new THREE.Quaternion();    // smoothed phone orientation
let motionSReady = false;

function updateMotionSmooth() {
  if (!motionSReady) {
    motionS.copy(motionQ);
    motionSReady = true;
    return;
  }
  const ang = motionS.angleTo(motionQ);
  if (ang < THREE.MathUtils.degToRad(GYRO_DEADZONE_DEG)) return;   // sensor noise
  const a = THREE.MathUtils.clamp(ang * GYRO_FOLLOW_GAIN, GYRO_MIN_ALPHA, 1);
  motionS.slerp(motionQ, a);
}

const _qrel = new THREE.Quaternion();

function updateWorldLock() {
  if (!GYRO_COMPENSATION || !motionHasData) return;   // pinned to the screen

  updateMotionSmooth();

  if (!lockHasBase) {                        // first gyro reading since locking
    lockPos.copy(smoothRoot.position);
    lockQuat.copy(smoothRoot.quaternion);
    lockQ0.copy(motionS);
    lockHasBase = true;
    return;
  }

  // Where a point fixed in the room appears now, relative to the phone.
  _qrel.copy(motionS).invert().multiply(lockQ0);
  smoothRoot.position.copy(lockPos).applyQuaternion(_qrel);
  smoothRoot.quaternion.copy(_qrel).multiply(lockQuat);
}

function lockContent() {
  lockTimer = null;
  if (!smoothRoot.visible) return;
  locked = true;
  lockPos.copy(smoothRoot.position);
  lockQuat.copy(smoothRoot.quaternion);
  motionSReady = false;                      // restart gyro smoothing from now
  if (motionHasData) { motionS.copy(motionQ); motionSReady = true; }
  lockQ0.copy(motionS);
  lockHasBase = motionHasData && GYRO_COMPENSATION;
  rescanButton.style.display = "block";
  showHint("Locked in place  -  tap Re-scan to realign", 2500);
  console.log("🔒 Content locked in place");
}

function updateSmoothPose() {
  if (locked) {
    updateWorldLock();
    return;                     // tracking is ignored while locked
  }

  if (!anchor.group.visible) {
    smoothHasPose = false;      // next detection snaps straight to the pose
    return;                     // (content stays put until it locks)
  }

  anchor.group.matrix.decompose(_rawPos, _rawQuat, _rawScale);

  if (!smoothHasPose) {
    smoothRoot.position.copy(_rawPos);
    smoothRoot.quaternion.copy(_rawQuat);
    smoothRoot.scale.copy(_rawScale);
    smoothHasPose = true;
  } else {
    const moved = smoothRoot.position.distanceTo(_rawPos) / Math.max(_rawScale.x, 1e-6);
    const rotated = smoothRoot.quaternion.angleTo(_rawQuat);
    const a = THREE.MathUtils.clamp(
      Math.max(moved * SMOOTH_POS_GAIN, rotated * SMOOTH_ROT_GAIN),
      SMOOTH_MIN_ALPHA,
      1
    );
    smoothRoot.position.lerp(_rawPos, a);
    smoothRoot.quaternion.slerp(_rawQuat, a);
    smoothRoot.scale.lerp(_rawScale, a);
  }

  smoothRoot.visible = true;
}


// ============================================================
// READ BROCHURE ASPECT RATIO
// ============================================================

const textureLoader = new THREE.TextureLoader();

const mapTexture =
  await textureLoader.loadAsync(INDIA_MAP);

arLoader.set(10, "Loading brochure...");

const BROCHURE_ASPECT =
  mapTexture.image.height / mapTexture.image.width;

console.log(
  `📐 Brochure aspect ratio: ${BROCHURE_ASPECT.toFixed(3)}`
);


// ============================================================
// INDIA MAP OVERLAY
// ============================================================
// Plane exactly the size of the brochure (width 1, height =
// aspect), sitting just behind the icons. It was only being
// loaded for its aspect ratio before -- never added to the
// scene -- which is why it never showed.

mapTexture.colorSpace = THREE.SRGBColorSpace;

const mapMaterial = new THREE.MeshBasicMaterial({
  map: mapTexture,
  transparent: true,
  opacity: 0,
  depthTest: false,
  depthWrite: false,
  side: THREE.DoubleSide
});

const mapMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(1, BROCHURE_ASPECT),
  mapMaterial
);
mapMesh.position.set(0.05, -0.06, 0.005);   // just above the brochure, below icons (offset tuned on device)
mapMesh.renderOrder = 50;            // icons are 100, text is 200
mapMesh.frustumCulled = false;
mapMesh.visible = false;
stage.add(mapMesh);

const mapSpawn = { active: false, time: 0 };


// ============================================================
// DECOR LAYERS (logo, mountains, waves)
// ============================================================
// Converts a spot on the 1080 x 1920 sample frame into anchor
// units (brochure width = 1). The india map covers the frame from
// MAP_TOP down, so frame y is measured from the map's centre.
// Same mapping as positionFromFraction, just in frame pixels.

function frameToAnchor(px, py, z = 0.01) {
  return {
    x: (px - FRAME_W / 2) / FRAME_W,
    y: (MAP_TOP + (BROCHURE_ASPECT * FRAME_W) / 2 - py) / FRAME_W,
    z
  };
}

// A missing file is skipped (with a console warning) instead of
// crashing the whole page -- the AR scene still starts without it.
const decorTextures = await Promise.all(
  DECOR.map((d) =>
    textureLoader.loadAsync(d.url).catch(() => {
      console.warn(`⚠️ Decor "${d.id}" not found at ${d.url} -- skipped. Check the file name and that it is inside /assets (names are case-sensitive).`);
      return null;
    })
  )
);

arLoader.set(20, "Loading animations...");

const faceMeshes = [];   // meshes that are turned to face the camera every frame

const decorLayers = DECOR.map((d, i) => {

  const tex = decorTextures[i];
  if (!tex) return null;
  tex.colorSpace = THREE.SRGBColorSpace;

  const wPx = tex.image.width * d.scale;
  const hPx = tex.image.height * d.scale;

  const material = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide
  });

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(wPx / FRAME_W, hPx / FRAME_W),
    material
  );

  // Centre of the PNG in frame pixels -> anchor position
  const pos = frameToAnchor(d.left + wPx / 2, d.top + hPx / 2);
  mesh.position.set(pos.x, pos.y, pos.z);

  mesh.renderOrder = 60;          // above the map (50), below icons (100)
  mesh.frustumCulled = false;
  mesh.visible = false;
  stage.add(mesh);

  console.log(`🖼️ Decor "${d.id}" loaded (${tex.image.width}x${tex.image.height})`);

  return {
    id: d.id,
    face: !!d.face,
    mesh,
    material,
    basePos: mesh.position.clone(),
    delay: d.delay,
    time: 0,
    active: false
  };
}).filter(Boolean);

if (FACE_CAMERA_PAGE_TEXT) {
  decorLayers.filter((l) => l.face).forEach((l) => faceMeshes.push(l.mesh));
}


// ============================================================
// POSITION HELPER
// ============================================================

function positionFromFraction(fx, fy, z = 0.015) {
  return {
    x: (fx - 0.5) * 1,
    y: (0.5 - fy) * BROCHURE_ASPECT,
    z
  };
}


// ============================================================
// GIF SPRITE
// ============================================================

class GifSprite {

  constructor(frames, width, height, speed = 0.5) {

    this.frames = frames;
    this.width = width;
    this.height = height;
    this.speed = speed;

    this.canvas = document.createElement("canvas");
    this.canvas.width = width;
    this.canvas.height = height;

    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;

    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 1,
      alphaTest: 0.001,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    const gifAspect = height / width;
    this.geometry = new THREE.PlaneGeometry(1, gifAspect);

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.renderOrder = 100;
    this.mesh.frustumCulled = false;

    this.currentFrame = 0;
    this.elapsed = 0;
    this.lastFrame = null;
    this.restoreCanvas = null;

    this.drawFrame(0);
  }

  drawFrame(index) {

    const frame = this.frames[index];
    if (!frame) return;

    if (this.lastFrame) {
      const previous = this.lastFrame;

      if (previous.disposalType === 2) {
        this.ctx.clearRect(
          previous.dims.left, previous.dims.top,
          previous.dims.width, previous.dims.height
        );
      } else if (previous.disposalType === 3 && this.restoreCanvas) {
        this.ctx.clearRect(0, 0, this.width, this.height);
        this.ctx.drawImage(this.restoreCanvas, 0, 0);
      }
    }

    if (frame.disposalType === 3) {
      if (!this.restoreCanvas) {
        this.restoreCanvas = document.createElement("canvas");
        this.restoreCanvas.width = this.width;
        this.restoreCanvas.height = this.height;
      }
      const restoreCtx = this.restoreCanvas.getContext("2d");
      restoreCtx.clearRect(0, 0, this.width, this.height);
      restoreCtx.drawImage(this.canvas, 0, 0);
    }

    const imageData = new ImageData(frame.patch, frame.dims.width, frame.dims.height);
    this.ctx.putImageData(imageData, frame.dims.left, frame.dims.top);

    this.texture.needsUpdate = true;
    this.lastFrame = frame;
  }

  update(deltaTime) {

    if (this.frames.length <= 1) return;

    this.elapsed += deltaTime;

    const currentFrame = this.frames[this.currentFrame];
    const originalDelay = Math.max(currentFrame.delay * 1, 20);
    const actualDelay = Math.max(originalDelay * this.speed, 20);

    if (this.elapsed >= actualDelay) {
      this.elapsed = 0;
      this.currentFrame++;

      if (this.currentFrame >= this.frames.length) {
        this.currentFrame = 0;
        this.ctx.clearRect(0, 0, this.width, this.height);
        this.lastFrame = null;
        this.restoreCanvas = null;
      }

      this.drawFrame(this.currentFrame);
    }
  }

  resetToIdle() {
    this.currentFrame = 0;
    this.elapsed = 0;
    this.lastFrame = null;
    this.restoreCanvas = null;
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.drawFrame(0);
  }
}


// ============================================================
// LOAD GIF
// ============================================================

async function loadGif(url, speed = 0.5) {

  console.log(`🎞️ Loading ${url}`);

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url}`);

  const buffer = await response.arrayBuffer();
  const gif = parseGIF(buffer);
  const frames = decompressFrames(gif, true);

  if (!frames || frames.length === 0) {
    throw new Error(`No GIF frames found: ${url}`);
  }

  const width = gif.lsd.width;
  const height = gif.lsd.height;

  console.log(`✅ ${url} → ${frames.length} frames`);
  arLoader.tick();

  return new GifSprite(frames, width, height, speed);
}


// ============================================================
// ICON SYSTEM (2-state: idle -> active(animation+text together))
// ============================================================
// Each icon = { id, sprites, textMesh, state }.
//   state 0 = idle   (sprites visible & static, text hidden)
//   state 1 = active (sprites visible & playing, text visible)
// Icons are MUTUALLY EXCLUSIVE: activating one deactivates
// whichever other icon was previously active.

const icons = [];

const meshToIcon = new Map();

let activeIcon = null;

function registerIcon(id, sprites, textMesh = null) {
  const icon = {
    id,
    sprites,
    textMesh,
    state: 0,
    spawning: false,
    spawnTime: 0,
    spawnDelay: 0,
    zoom: 1
  };
  icons.push(icon);
  sprites.forEach((sprite) => meshToIcon.set(sprite.mesh, icon));
  return icon;
}

function applyIconState(icon) {

  const active = icon.state === 1;

  icon.sprites.forEach((sprite) => {
    sprite.mesh.visible = true;
    if (!active) sprite.resetToIdle();
  });

  if (icon.textMesh) {
    icon.textMesh.visible = active;
    if (active) {
      startTextFade(icon);      // fade/slide in instead of popping
    } else {
      icon.textFading = false;
    }
  }
}

function toggleIcon(icon) {

  // Deactivate whatever other icon was active, if any.
  if (activeIcon && activeIcon !== icon) {
    activeIcon.state = 0;
    applyIconState(activeIcon);
  }

  // Toggle THIS icon: active -> idle, idle -> active.
  icon.state = icon.state === 1 ? 0 : 1;
  applyIconState(icon);

  activeIcon = icon.state === 1 ? icon : null;

  console.log(`👆 ${icon.id} -> ${icon.state === 1 ? "active" : "idle"}`);
}

function setIconVisible(icon, visible) {
  if (!visible) {
    icon.state = 0;
    if (activeIcon === icon) activeIcon = null;
  }
  icon.sprites.forEach((sprite) => {
    sprite.mesh.visible = visible;
    sprite.resetToIdle();
  });
  if (icon.textMesh) {
    icon.textMesh.visible = false;
  }
}


// ============================================================
// TEXT (fonts, callout panels, page text)
// ============================================================
// Every size below is in "page pixels": pixels of the 1080 x 1920
// brochure page the client's design was made on. They were measured
// from the PDF pages, so the text matches the design.

const FONT_FACES = {
  bd:   { family: "BIFwd-Bd",   url: "/fonts/BoehringerForwardText-Bd.ttf"   },  // headings
  md:   { family: "BIFwd-Md",   url: "/fonts/BoehringerForwardText-Md.ttf"   },  // bullets
  bdit: { family: "BIFwd-BdIt", url: "/fonts/BoehringerForwardText-BdIt.ttf" }   // italic tagline
};

// A font that fails to load falls back to Bold, then a system font,
// so one missing file never breaks the page.
async function loadBoehringerFonts() {
  await Promise.all(
    Object.entries(FONT_FACES).map(async ([key, f]) => {
      try {
        const face = new FontFace(f.family, `url('${f.url}')`);
        await face.load();
        document.fonts.add(face);
        console.log(`✅ Font "${key}" loaded`);
      } catch (e) {
        console.warn(`⚠️ Font "${key}" not found at ${f.url} -- using a fallback. Check it is inside /fonts (names are case-sensitive).`);
      }
    })
  );
  arLoader.tick();
}

function cssFont(key, sizePx) {
  return `${sizePx}px "${FONT_FACES[key].family}", "${FONT_FACES.bd.family}", sans-serif`;
}

const TEXT_HEAD_SIZE = 23.1;    // callout heading (Bold)
const TEXT_BODY_SIZE = 19.6;    // callout bullets (Medium)
const TEXT_HEAD_PITCH = 30.5;   // line spacing between heading lines
const TEXT_HEAD_GAP = 31;       // last heading line -> first bullet line
const TEXT_BODY_PITCH = 30;     // line spacing inside the bullet list
const TEXT_BULLET_X = 2;        // bullet dot, from the text edge
const TEXT_INDENT = 17;         // bullet text and its wrapped lines
const TEXT_ASCENT = 0.78;       // top of tall letters, as a fraction of font size

const TEXT_RES = 2;             // canvas pixels per page pixel (sharper text)
const TEXT_BOX_ALPHA = 1;       // box behind the text. 1 = solid black, lower = see-through, 0 = none
const BOX_PAD_X = 12;           // space between the text and the box edge (page px)
const BOX_RADIUS = 9;           // rounded corner size (page px)
const BOX_GROUP_TRIM = 2.5;     // trims each group's top/bottom, leaving a small gap between bullets
const SUP_SCALE = 0.6;          // size of a ^superscript character
const SUP_RAISE = 0.38;         // how far it is lifted (fraction of font size)

// "223 opnMe^®" -> [{ t: "223 opnMe" }, { t: "®", sup: true }]
function splitSup(text) {
  const parts = [];
  const re = /\^(.)/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push({ t: text.slice(last, m.index), sup: false });
    parts.push({ t: m[1], sup: true });
    last = m.index + 2;
  }
  if (last < text.length) parts.push({ t: text.slice(last), sup: false });
  return parts;
}

const _measureCtx = document.createElement("canvas").getContext("2d");

function lineWidth(line) {
  return splitSup(line.text).reduce((sum, p) => {
    _measureCtx.font = cssFont(line.font, line.size * (p.sup ? SUP_SCALE : 1) * TEXT_RES);
    return sum + _measureCtx.measureText(p.t).width / TEXT_RES;
  }, 0);
}

// Rectangle path with its own radius on each corner (0 = square corner).
function cornerRectPath(ctx, x, y, w, h, tl, tr, br, bl) {
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  if (tr) ctx.arc(x + w - tr, y + tr, tr, -Math.PI / 2, 0);
  ctx.lineTo(x + w, y + h - br);
  if (br) ctx.arc(x + w - br, y + h - br, br, 0, Math.PI / 2);
  ctx.lineTo(x + bl, y + h);
  if (bl) ctx.arc(x + bl, y + h - bl, bl, Math.PI / 2, Math.PI);
  ctx.lineTo(x, y + tl);
  if (tl) ctx.arc(x + tl, y + tl, tl, Math.PI, Math.PI * 1.5);
  ctx.closePath();
}

// Smooth "inside corner" where two rows of different width meet.
// (cx, cy) is the corner; the empty space is to its right, above it
// (below = false) or under it (below = true).
function filletPath(ctx, cx, cy, r, below) {
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + r, cy);
  if (below) ctx.arc(cx + r, cy + r, r, -Math.PI / 2, -Math.PI, true);
  else ctx.arc(cx + r, cy - r, r, Math.PI / 2, Math.PI, false);
  ctx.closePath();
}

// Black rounded boxes behind the text. Every group of lines (the heading, or one
// bullet with its wrapped lines) becomes ONE joined shape with rounded outer corners
// and smooth inside corners, like a text highlight. Groups are separated by a small gap.
// Drawn solid on a scratch canvas, then laid over the text canvas at TEXT_BOX_ALPHA,
// so overlaps never look darker.
function drawTextBoxes(ctx, lines, pad) {

  const groups = new Map();
  lines.forEach((l) => {
    const rows = groups.get(l.group) || new Map();
    const r = rows.get(l.baseline) || { baseline: l.baseline, x1: -Infinity, size: 0 };
    r.x1 = Math.max(r.x1, l.x + l.w);
    r.size = Math.max(r.size, l.size);
    rows.set(l.baseline, r);
    groups.set(l.group, rows);
  });

  const left = Math.min(...lines.map((l) => l.x)) - BOX_PAD_X;   // one straight left edge
  const R = BOX_RADIUS;

  const layer = document.createElement("canvas");
  layer.width = ctx.canvas.width;
  layer.height = ctx.canvas.height;
  const lc = layer.getContext("2d");
  lc.scale(TEXT_RES, TEXT_RES);
  lc.translate(pad, pad);
  lc.fillStyle = "#000";

  groups.forEach((rowMap) => {

    const rows = [...rowMap.values()].sort((a, b) => a.baseline - b.baseline);
    const n = rows.length;
    const right = rows.map((r) => r.x1 + BOX_PAD_X);
    const mid = rows.map((r) => r.baseline - 0.26 * r.size);                    // middle of the letters
    const halfH = rows.map((r) => Math.max(TEXT_BODY_PITCH + 2, r.size * 1.5) / 2);

    // a step smaller than a corner looks fussy: make those neighbours equally wide
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < n - 1; i++) {
        if (Math.abs(right[i] - right[i + 1]) < 2 * R) {
          right[i] = right[i + 1] = Math.max(right[i], right[i + 1]);
        }
      }
    }

    // row edges: rows touch each other; the group is trimmed at both ends
    const edge = [mid[0] - halfH[0] + BOX_GROUP_TRIM];
    for (let i = 0; i < n - 1; i++) edge.push((mid[i] + mid[i + 1]) / 2);
    edge.push(mid[n - 1] + halfH[n - 1] - BOX_GROUP_TRIM);

    for (let i = 0; i < n; i++) {
      const top = edge[i] - (i > 0 ? 0.5 : 0);                 // tiny overlap hides seams
      const bottom = edge[i + 1] + (i < n - 1 ? 0.5 : 0);
      const tr = i === 0 || right[i] > right[i - 1] ? R : 0;
      const br = i === n - 1 || right[i] > right[i + 1] ? R : 0;
      lc.beginPath();
      cornerRectPath(lc, left, top, right[i] - left, bottom - top, i === 0 ? R : 0, tr, br, i === n - 1 ? R : 0);
      lc.fill();
    }

    // smooth inside corners where neighbouring rows have different widths
    for (let i = 0; i < n - 1; i++) {
      if (right[i] === right[i + 1]) continue;
      lc.beginPath();
      if (right[i + 1] > right[i]) filletPath(lc, right[i], edge[i + 1], R, false);
      else filletPath(lc, right[i + 1], edge[i + 1], R, true);
      lc.fill();
    }
  });

  ctx.globalAlpha = TEXT_BOX_ALPHA;
  ctx.drawImage(layer, 0, 0);
  ctx.globalAlpha = 1;
}

// Draws pre-positioned lines onto one transparent canvas and returns a mesh.
//   line = { text, font, size, x, baseline }
//   x / baseline are in page pixels from the block's top-left; the block's
//   top is the top of the first line's tall letters.
// mesh.userData.blockW / blockH hold the block size in page pixels.
function buildTextMesh(lines, { align = "left", box = true } = {}) {

  lines.forEach((l) => { l.w = lineWidth(l); });

  const maxW = Math.max(...lines.map((l) => l.w));
  if (align === "right") lines.forEach((l) => { l.x = maxW - l.w; });

  const blockW = Math.max(...lines.map((l) => l.x + l.w));
  const blockH = Math.max(...lines.map((l) => l.baseline + l.size * 0.26));

  const showBox = box && TEXT_BOX_ALPHA > 0;
  const PAD = showBox ? 18 : 4;   // spare page pixels around the block
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil((blockW + PAD * 2) * TEXT_RES);
  canvas.height = Math.ceil((blockH + PAD * 2) * TEXT_RES);

  const ctx = canvas.getContext("2d");
  ctx.textBaseline = "alphabetic";

  if (showBox) drawTextBoxes(ctx, lines, PAD);

  ctx.fillStyle = "#ffffff";
  lines.forEach((l) => {
    let x = (PAD + l.x) * TEXT_RES;
    const y = (PAD + l.baseline) * TEXT_RES;
    splitSup(l.text).forEach((p) => {
      ctx.font = cssFont(l.font, l.size * (p.sup ? SUP_SCALE : 1) * TEXT_RES);
      ctx.fillText(p.t, x, y - (p.sup ? l.size * SUP_RAISE * TEXT_RES : 0));
      x += ctx.measureText(p.t).width;
    });
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true;                         // steadier text when small
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide
  });

  // 1 page pixel = 1 / FRAME_W of the brochure width
  const geometry = new THREE.PlaneGeometry(
    canvas.width / (TEXT_RES * FRAME_W),
    canvas.height / (TEXT_RES * FRAME_W)
  );

  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 200;
  mesh.frustumCulled = false;
  mesh.userData = { blockW, blockH };

  return mesh;
}

// Puts a text block's top-left corner at (left, top) on the 1080 x 1920 page.
function placeTextBlock(mesh, left, top, z = 0.02) {
  const { blockW, blockH } = mesh.userData;
  const pos = frameToAnchor(left + blockW / 2, top + blockH / 2, z);
  mesh.position.set(pos.x, pos.y, pos.z);
}

// Callout: Bold heading, then Medium bullets with a hanging indent.
//   heading: ["line", ...]        bullets: [["line", "wrapped line"], ...]
function createTextPanel({ heading, bullets }) {

  const lines = [];
  let baseline = TEXT_ASCENT * TEXT_HEAD_SIZE;

  heading.forEach((text, i) => {
    if (i > 0) baseline += TEXT_HEAD_PITCH;
    lines.push({ text, font: "bd", size: TEXT_HEAD_SIZE, x: 0, baseline, group: 0 });
  });

  let firstBullet = true;
  bullets.forEach((bullet, k) => {
    const group = k + 1;            // the heading is group 0, each bullet is its own group
    bullet.forEach((text, j) => {
      baseline += firstBullet ? TEXT_HEAD_GAP : TEXT_BODY_PITCH;
      firstBullet = false;
      if (j === 0) {
        lines.push({ text: "•", font: "md", size: TEXT_BODY_SIZE, x: TEXT_BULLET_X, baseline, group });
      }
      lines.push({ text, font: "md", size: TEXT_BODY_SIZE, x: TEXT_INDENT, baseline, group });
    });
  });

  return buildTextMesh(lines);
}

// Plain multi-line text (headline, tagline, footnote).
//   lines: strings, or { text, font } to change the font on one line
function createPageText({ lines, font = "bd", size, pitch, align = "left" }) {
  const specs = lines.map((l, i) => {
    const spec = typeof l === "string" ? { text: l } : l;
    return {
      text: spec.text,
      font: spec.font || font,
      size,
      x: 0,
      baseline: TEXT_ASCENT * size + i * pitch
    };
  });
  return buildTextMesh(specs, { align, box: false });   // page text has no box
}


// ============================================================
// LOAD ALL ICONS
// ============================================================

console.log("🎬 Loading icon GIFs + font (in parallel)...");

const [
  , // font load result unused, just needed to finish before text panels draw
  cowSprite,
  duckSprite,
  henSprite,
  brainSprite,
  crmSprite,
  dropSprite,
  doctorSprite,
  earthSprite
] = await Promise.all([
  loadBoehringerFonts(),
  loadGif("/assets/Cow.gif", GIF_SPEED),
  loadGif("/assets/Duck.gif", GIF_SPEED),
  loadGif("/assets/Hen.gif", GIF_SPEED),
  loadGif("/assets/Brain.gif", GIF_SPEED),
  loadGif("/assets/3_Organs.gif", GIF_SPEED),
  loadGif("/assets/Drop.gif", GIF_SPEED),
  loadGif("/assets/Doctor.gif", GIF_SPEED),
  loadGif("/assets/earth.gif", GIF_SPEED)
]);

console.log("✅ All icon GIFs + font loaded");

// --------------------------------------------------------------
// Text content per icon (client copy). Each bullet is a list of lines,
// broken exactly as in the design. "^" makes the next character a
// raised superscript, e.g. "opnMe^®".
// --------------------------------------------------------------

const animalsText = createTextPanel({
  heading: ["Connecting animal health and", "community wellbeing"],
  bullets: [
    ["Advancing disease prevention through", "vaccination and biosecurity"],
    ["Supporting poultry, ruminant and", "companion animal health"],
    ["Strengthening food security, livelihoods", "and healthier communities"]
  ]
});

const brainText = createTextPanel({
  heading: ["Strengthening the stroke ecosystem"],
  bullets: [
    ["450+ stroke-ready hospitals", "supported since 2016"],
    ["14 states and Union Territories", "within EMRI collaboration footprint"],
    ["Guinness World Record for", "stroke-awareness pledges"]
  ]
});

const crmText = createTextPanel({
  heading: ["Creating impact beyond healthcare"],
  bullets: [
    ["40+ villages reached in Nandurbar"],
    ["7,000+ health check-ups"],
    ["150+ frontline workers trained in NCD", "early detection"],
    ["350+ women supported through", "livelihood programmes"],
    ["Mobile health access expanded to", "underserved communities"]
  ]
});

const dropText = createTextPanel({
  heading: ["Advancing science through", "research collaboration"],
  bullets: [
    ["Research collaborations", "with NIPER institutions"],
    ["223 opnMe^®", "molecules shipped"],
    ["3 winning research", "collaborations"]
  ]
});

const doctorText = createTextPanel({
  heading: ["Contributing to", "global clinical research"],
  bullets: [
    ["13 active Phase II/III studies*"],
    ["8 therapy areas*"],
    ["2,500+ patients involved in", "clinical research since inception*"]
  ]
});

const earthText = createTextPanel({
  heading: ["Bringing innovation to India"],
  bullets: [
    ["13+ innovative", "molecules introduced"],
    ["400+ colleagues"],
    ["70+ locations"]
  ]
});

[animalsText, brainText, crmText, dropText, doctorText, earthText].forEach((mesh) => {
  stage.add(mesh);
  mesh.visible = false;
  if (FACE_CAMERA_CALLOUTS) faceMeshes.push(mesh);
});

// Registration order = spawn order (animals first, earth last).
const animalsIcon = registerIcon("animals", [cowSprite, duckSprite, henSprite], animalsText);
const brainIcon = registerIcon("brain", [brainSprite], brainText);
const crmIcon = registerIcon("crm", [crmSprite], crmText);
const dropIcon = registerIcon("drop", [dropSprite], dropText);
const doctorIcon = registerIcon("doctor", [doctorSprite], doctorText);
const earthIcon = registerIcon("earth", [earthSprite], earthText);

icons.forEach((icon) => stage.add(...icon.sprites.map((s) => s.mesh)));


// ============================================================
// ANIMAL CLUSTER POSITION (ground-aligned)
// ============================================================

const DUCK_FX = 0.495;
const COW_FX = 0.565;
const HEN_FX = 0.665;
const GROUND_FY = 0.428;

const COW_SCALE = 0.17;
const DUCK_SCALE = 0.095;
const HEN_SCALE = 0.10;

function positionOnGround(sprite, fx, scale, groundFy) {
  const base = positionFromFraction(fx, groundFy);
  const worldHeight = scale * sprite.geometry.parameters.height;
  return { x: base.x, y: base.y + worldHeight / 2, z: base.z };
}

cowSprite.mesh.scale.set(COW_SCALE, COW_SCALE, 1);
duckSprite.mesh.scale.set(DUCK_SCALE, DUCK_SCALE, 1);
henSprite.mesh.scale.set(HEN_SCALE, HEN_SCALE, 1);

const cowPos = positionOnGround(cowSprite, COW_FX, COW_SCALE, GROUND_FY);
const duckPos = positionOnGround(duckSprite, DUCK_FX, DUCK_SCALE, GROUND_FY);
const henPos = positionOnGround(henSprite, HEN_FX, HEN_SCALE, GROUND_FY);

cowSprite.mesh.position.set(cowPos.x, cowPos.y, cowPos.z);
duckSprite.mesh.position.set(duckPos.x, duckPos.y, duckPos.z);
henSprite.mesh.position.set(henPos.x, henPos.y, henPos.z);


// ============================================================
// SINGLE-SPRITE ICON POSITIONS
// ============================================================

function placeSingleIcon(sprite, fx, fy, scale) {
  const pos = positionFromFraction(fx, fy);
  sprite.mesh.scale.set(scale, scale, 1);
  sprite.mesh.position.set(pos.x, pos.y, pos.z);
}

placeSingleIcon(brainSprite, 0.38, 0.20, 0.16);   // brain, top of map
placeSingleIcon(crmSprite, 0.25, 0.50, 0.28);      // CRM organ cluster, left
placeSingleIcon(dropSprite, 0.58, 0.60, 0.22);     // teardrop/blob icon
placeSingleIcon(doctorSprite, 0.47, 0.75, 0.16);   // scientist
placeSingleIcon(earthSprite, 0.31, 0.83, 0.25);    // globe

// --------------------------------------------------------------
// Text panel positions -- measured on the client's brochure pages.
// left / top = where the heading's ink starts, in pixels of the
// 1080 x 1920 page. Each callout sits exactly where it does in the PDF.
// --------------------------------------------------------------

const TEXT_SPOTS = {
  brain:   { left: 555, top: 500  },   // right of the brain, in the mountain gap
  animals: { left: 620, top: 483  },   // same slot (only one panel shows at a time)
  crm:     { left: 107, top: 1010 },   // under the CRM ring
  drop:    { left: 687, top: 1190 },   // under the drop icon
  doctor:  { left: 561, top: 1366 },   // under the scientist
  earth:   { left: 109, top: 1197 }    // upper-left of the globe
};

function placeCallout(mesh, spot, z = 0.02) {
  // -1: the text origin sits 1px left of the first letter's ink
  placeTextBlock(mesh, spot.left - 1, spot.top, z);
}

placeCallout(brainText, TEXT_SPOTS.brain);
placeCallout(animalsText, TEXT_SPOTS.animals);
placeCallout(crmText, TEXT_SPOTS.crm);
placeCallout(dropText, TEXT_SPOTS.drop);
placeCallout(doctorText, TEXT_SPOTS.doctor);
placeCallout(earthText, TEXT_SPOTS.earth);


// ============================================================
// PAGE TEXT (headline, tagline, footnote)
// ============================================================
// Always-visible text from the page design. These fade in with the
// logo / mountains / waves (they join the decor layers).
// Set SHOW_PAGE_TEXT = false if the printed brochure already
// carries this text, to avoid drawing it twice.

const SHOW_PAGE_TEXT = true;

const PAGE_TEXT = [
  {
    id: "headline", align: "right", right: 1001, top: 170,
    font: "bd", size: 34.7, pitch: 41.7, delay: 600,
    lines: [
      "22+ years. One India story.",
      "Connecting science, health and ",   // trailing space matches the design
      "partnerships to create impact"
    ]
  },
  {
    id: "tagline", left: 85, top: 1740,
    font: "bd", size: 34.7, pitch: 42.9, delay: 800,
    lines: [
      { text: "Many Milestones. One India Story.", font: "bd" },
      { text: "Driven by Science. Across Every Life.", font: "bdit" }
    ]
  },
  {
    id: "footnote", left: 85, top: 1854,
    font: "md", size: 11.6, pitch: 15, delay: 1000,
    lines: [
      "Clinical research data as of September 2026. Patient figure represents cumulative participation in",
      "Boehringer Ingelheim clinical research studies in India since inception. Further studies are ongoing."
    ]
  }
];

if (SHOW_PAGE_TEXT) {
  PAGE_TEXT.forEach((t) => {

    const mesh = createPageText(t);
    const left = t.align === "right" ? t.right - mesh.userData.blockW : t.left;
    placeTextBlock(mesh, left, t.top, 0.012);

    mesh.renderOrder = 60;            // same layer as the decor
    mesh.material.opacity = 0;
    mesh.visible = false;
    stage.add(mesh);
    if (FACE_CAMERA_PAGE_TEXT) faceMeshes.push(mesh);

    decorLayers.push({
      id: t.id,
      mesh,
      material: mesh.material,
      basePos: mesh.position.clone(),
      delay: t.delay,
      time: 0,
      active: false
    });
  });
}



// ============================================================
// SPAWN ANIMATION
// ============================================================
// Runs AFTER all positions/scales are set, so it can remember
// each sprite's final scale + position and animate toward them.

icons.forEach((icon) => {
  icon.sprites.forEach((s) => {
    s.baseScale = s.mesh.scale.clone();
    s.basePos = s.mesh.position.clone();
  });
});

// Overshoots slightly past 1, then settles (the "bounce")
function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

// ---------------- text panel fade-in (on tap) ----------------

icons.forEach((icon) => {
  if (icon.textMesh) {
    icon.textBasePos = icon.textMesh.position.clone();
    icon.textMesh.material.opacity = 0;
  }
  icon.textFading = false;
  icon.textFadeTime = 0;
});

function startTextFade(icon) {
  icon.textFading = true;
  icon.textFadeTime = 0;
  icon.textMesh.material.opacity = 0;
  icon.textMesh.position.y = icon.textBasePos.y - TEXT_RISE;
}

function updateTextFade(icon, delta) {
  if (!icon.textFading || !icon.textMesh) return;

  icon.textFadeTime += delta;
  const t = Math.min(1, icon.textFadeTime / TEXT_FADE_DURATION);
  const eased = 1 - Math.pow(1 - t, 3);          // ease-out cubic

  icon.textMesh.material.opacity = eased;
  icon.textMesh.position.y = icon.textBasePos.y - TEXT_RISE * (1 - eased);

  if (t >= 1) icon.textFading = false;
}

// ---------------- india map spawn ----------------

function startMapSpawn() {
  mapSpawn.active = true;
  mapSpawn.time = 0;
  mapMesh.visible = true;
  mapMesh.scale.set(0.9, 0.9, 1);
  mapMaterial.opacity = 0;
}

function updateMapSpawn(delta) {
  if (!mapSpawn.active) return;

  mapSpawn.time += delta;
  const t = Math.min(1, mapSpawn.time / MAP_SPAWN_DURATION);
  const eased = 1 - Math.pow(1 - t, 3);

  mapMesh.scale.set(0.9 + 0.1 * eased, 0.9 + 0.1 * eased, 1);
  mapMaterial.opacity = eased;

  if (t >= 1) mapSpawn.active = false;
}

function hideMap() {
  mapSpawn.active = false;
  mapMesh.visible = false;
  mapMaterial.opacity = 0;
}

// ---------------- decor spawn (logo / mountains / waves) ----------------

function startDecorSpawn() {
  decorLayers.forEach((layer) => {
    layer.active = true;
    layer.time = 0;
    layer.material.opacity = 0;
    layer.mesh.position.copy(layer.basePos);
    layer.mesh.position.y -= DECOR_RISE;
    layer.mesh.visible = true;
  });
}

function updateDecorSpawn(delta) {
  decorLayers.forEach((layer) => {
    if (!layer.active) return;

    layer.time += delta;
    const t = Math.min(1, Math.max(0, (layer.time - layer.delay) / DECOR_SPAWN_DURATION));
    const eased = 1 - Math.pow(1 - t, 3);          // ease-out cubic

    layer.material.opacity = eased;
    layer.mesh.position.y = layer.basePos.y - DECOR_RISE * (1 - eased);

    if (t >= 1) layer.active = false;
  });
}

function hideDecor() {
  decorLayers.forEach((layer) => {
    layer.active = false;
    layer.mesh.visible = false;
    layer.material.opacity = 0;
    layer.mesh.position.copy(layer.basePos);
  });
}

// ---------------- icon spawn ----------------

function startSpawn(icon, order) {
  icon.spawning = true;
  icon.spawnTime = 0;
  icon.spawnDelay = ICON_START_DELAY + order * SPAWN_STAGGER;

  icon.sprites.forEach((s) => {
    s.mesh.scale.set(0, 0, 1);
    s.material.opacity = 0;
    s.mesh.position.y = s.basePos.y - SPAWN_RISE;
  });
}

function finishSpawn(icon) {
  icon.spawning = false;
  icon.sprites.forEach((s) => {
    s.mesh.scale.copy(s.baseScale);
    s.mesh.position.copy(s.basePos);
    s.material.opacity = 1;
  });
}

function updateSpawn(icon, delta) {
  if (!icon.spawning) return;

  icon.spawnTime += delta;
  const raw = (icon.spawnTime - icon.spawnDelay) / SPAWN_DURATION;

  if (raw < 0) return;                       // still waiting its turn
  if (raw >= 1) { finishSpawn(icon); return; }

  const k = easeOutBack(raw);                // scale / position (bouncy)
  const fade = Math.min(1, raw * 2.5);       // fade in over first 40%

  icon.sprites.forEach((s) => {
    s.mesh.scale.set(s.baseScale.x * k, s.baseScale.y * k, 1);
    s.mesh.position.y = s.basePos.y - SPAWN_RISE * (1 - raw);
    s.material.opacity = fade;
  });
}


// ---------------- slight zoom on the tapped icon ----------------
// The active icon grows a little and eases back when it is deselected.

const ICON_ACTIVE_ZOOM = 1.25;   // 1.0 = no zoom, 1.25 = noticeable
const ICON_ZOOM_SMOOTH = 90;     // ms time constant, lower = snappier

function updateIconZoom(icon, delta) {
  if (icon.spawning) return;                       // spawn animation owns the scale
  const target = icon.state === 1 ? ICON_ACTIVE_ZOOM : 1;
  if (Math.abs(target - icon.zoom) < 0.0005 && icon.zoom === target) return;

  icon.zoom += (target - icon.zoom) * (1 - Math.exp(-delta / ICON_ZOOM_SMOOTH));
  if (Math.abs(target - icon.zoom) < 0.0005) icon.zoom = target;

  icon.sprites.forEach((s) => {
    s.mesh.scale.set(s.baseScale.x * icon.zoom, s.baseScale.y * icon.zoom, 1);
  });
}


// ============================================================
// VISIBILITY (all hidden until target found)
// ============================================================

icons.forEach((icon) => setIconVisible(icon, false));


// ============================================================
// TAP HANDLING (works across ALL icons)
// ============================================================

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function allMeshes() {
  return icons.flatMap((icon) => icon.sprites.map((s) => s.mesh));
}

function handleTap(clientX, clientY) {

  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);

  const hits = raycaster.intersectObjects(allMeshes(), false);

  console.log(
    `👆 tap at (${clientX}, ${clientY}) -> NDC (${pointer.x.toFixed(2)}, ${pointer.y.toFixed(2)}) -> ${hits.length} hit(s)`
  );

  if (hits.length === 0) return;

  const hitMesh = hits[0].object;
  const icon = meshToIcon.get(hitMesh);

  if (icon) toggleIcon(icon);
}

document.addEventListener(
  "pointerdown",
  (event) => {
    if (event.pointerType === "touch") return;
    handleTap(event.clientX, event.clientY);
  },
  { passive: true }
);

document.addEventListener(
  "touchstart",
  (event) => {
    if (event.touches.length > 0) {
      const touch = event.touches[0];
      handleTap(touch.clientX, touch.clientY);
    }
  },
  { passive: true }
);


// ============================================================
// TARGET FOUND / LOST
// ============================================================

let contentShown = false;

function showContent() {
  contentShown = true;
  hideHint();
  startMapSpawn();                // map first, icons follow after ICON_START_DELAY
  startDecorSpawn();              // logo, mountains, waves fade in with the map
  icons.forEach((icon, i) => {
    setIconVisible(icon, true);
    startSpawn(icon, i);          // i = order in which they pop in
  });
  // Give the pose a moment to settle, then lock everything in place.
  clearTimeout(lockTimer);
  lockTimer = setTimeout(lockContent, LOCK_DELAY);
}

function hideContent() {
  contentShown = false;
  hideMap();
  hideDecor();
  icons.forEach((icon) => {
    icon.spawning = false;
    setIconVisible(icon, false);
  });
  smoothRoot.visible = false;
}

anchor.onTargetFound = () => {
  console.log("✅ BROCHURE TARGET FOUND");
  if (contentShown) return;       // already shown (and locked): ignore re-detections
  showContent();
};

anchor.onTargetLost = () => {
  console.log("❌ BROCHURE TARGET LOST");
  // Nothing to do: content stays where it is (frozen, then world-locked).
};

// ---------------- Re-scan button + hint ----------------

const rescanButton = document.createElement("button");
rescanButton.textContent = "⟳  Re-scan";
rescanButton.setAttribute("aria-label", "Re-scan brochure");
Object.assign(rescanButton.style, {
  position: "fixed",
  bottom: "calc(env(safe-area-inset-bottom, 0px) + 22px)",
  zIndex: "10000",
  display: "none",
  padding: "12px 20px",
  border: "1px solid rgba(255,255,255,0.35)",
  borderRadius: "999px",
  background: "rgba(0,0,0,0.6)",
  color: "#fff",
  font: "600 15px system-ui, -apple-system, sans-serif",
  letterSpacing: "0.02em",
  backdropFilter: "blur(6px)",
  webkitBackdropFilter: "blur(6px)",
  touchAction: "manipulation",
  userSelect: "none",
  cursor: "pointer"
});
if (RESCAN_BUTTON_POS === "center") {
  rescanButton.style.left = "50%";
  rescanButton.style.transform = "translateX(-50%)";
} else {
  rescanButton.style.right = "16px";
}
document.body.appendChild(rescanButton);

const hintEl = document.createElement("div");
Object.assign(hintEl.style, {
  position: "fixed",
  top: "calc(env(safe-area-inset-top, 0px) + 18px)",
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: "10000",
  display: "none",
  maxWidth: "86vw",
  padding: "10px 16px",
  borderRadius: "999px",
  background: "rgba(0,0,0,0.6)",
  color: "#fff",
  font: "500 14px system-ui, -apple-system, sans-serif",
  textAlign: "center",
  pointerEvents: "none"
});
document.body.appendChild(hintEl);

let hintTimer = null;
function showHint(text, ms = 0) {
  hintEl.textContent = text;
  hintEl.style.display = "block";
  clearTimeout(hintTimer);
  if (ms > 0) hintTimer = setTimeout(hideHint, ms);
}
function hideHint() {
  clearTimeout(hintTimer);
  hintEl.style.display = "none";
}

function rescan() {
  console.log("🔄 Re-scan requested");
  clearTimeout(lockTimer);
  lockTimer = null;
  locked = false;
  lockHasBase = false;
  smoothHasPose = false;
  activeIcon = null;
  hideContent();
  rescanButton.style.display = "none";
  if (anchor.group.visible) {
    showContent();                // brochure is already in view: pop straight back in
  } else {
    showHint("Point the camera at the brochure");
  }
}

// Keep button presses from also counting as taps on the AR scene.
["pointerdown", "touchstart"].forEach((type) =>
  rescanButton.addEventListener(type, (e) => e.stopPropagation(), { passive: true })
);
rescanButton.addEventListener("click", (e) => {
  e.stopPropagation();
  askMotionPermission();
  rescan();
});

showHint("Point the camera at the brochure");


// ============================================================
// START
// ============================================================

arLoader.set(88, "Almost ready... tap Allow if asked");
try {
  await mindarThree.start();
} catch (err) {
  arLoader.error("Camera could not start. Please allow camera access and reload.");
  throw err;
}
arLoader.done();

console.log("📷 MindAR camera started");
console.log("🔎 Looking for brochure...");


// ============================================================
// UPRIGHT TEXT (face the camera)
// ============================================================
// Each mesh's world rotation is set to the camera's, so it sits flat to the
// screen with no tilt. Its POSITION still follows the brochure, so it stays
// in its place on the page. (The stage group has no rotation of its own.)

const _pageQ = new THREE.Quaternion();
const _camQ = new THREE.Quaternion();

function updateFaceCamera() {
  if (faceMeshes.length === 0 || !smoothRoot.visible) return;
  smoothRoot.updateWorldMatrix(true, false);
  smoothRoot.getWorldQuaternion(_pageQ).invert();      // undo the page's rotation
  camera.getWorldQuaternion(_camQ);
  _pageQ.multiply(_camQ);                              // ...then apply the camera's
  faceMeshes.forEach((m) => m.quaternion.copy(_pageQ));
}


// ============================================================
// ANIMATION LOOP
// ============================================================

let previousTime = performance.now();

renderer.setAnimationLoop(() => {

  const now = performance.now();
  const delta = now - previousTime;
  previousTime = now;

  updateSmoothPose();   // must run before anything that reads the page pose
  updateFaceCamera();
  updateMapSpawn(delta);
  updateDecorSpawn(delta);
  icons.forEach((icon) => updateSpawn(icon, delta));
  icons.forEach((icon) => updateIconZoom(icon, delta));
  icons.forEach((icon) => updateTextFade(icon, delta));

  icons.forEach((icon) => {
    if (icon.state !== 1) return; // only advance frames while active
    icon.sprites.forEach((sprite) => {
      if (sprite.mesh.visible) sprite.update(delta);
    });
  });

  renderer.render(scene, camera);
});