import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

import {
  MindARThree
} from "https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image-three.prod.js";

import {
  parseGIF,
  decompressFrames
} from "gifuct-js";


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
  { id: "logo",      url: "/assets/03.png", left: 45,   top: 10,   scale: 0.52, delay: 0   },
  { id: "mountains", url: "/assets/11.png", left: 170,  top: 369,  scale: 1,    delay: 300 },
  { id: "waves",     url: "/assets/12.png", left: -104, top: 1307, scale: 1,    delay: 500 }
];

const FRAME_W = 1080;        // width of the sample brochure frame (px)
const MAP_TOP = 369;         // y (px) in the frame where india-map.png starts
const DECOR_SPAWN_DURATION = 700;   // ms for each decor layer to fade in
const DECOR_RISE = 0.03;            // decor slides up this far while fading in


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
anchor.group.add(stage);


// ============================================================
// READ BROCHURE ASPECT RATIO
// ============================================================

const textureLoader = new THREE.TextureLoader();

const mapTexture =
  await textureLoader.loadAsync(INDIA_MAP);

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
    mesh,
    material,
    basePos: mesh.position.clone(),
    delay: d.delay,
    time: 0,
    active: false
  };
}).filter(Boolean);


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
    spawnDelay: 0
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
const TEXT_BOX_ALPHA = 0.55;    // dark box behind each text row. 0 = no box
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
  const PAD = showBox ? 10 : 4;   // spare page pixels around the block
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil((blockW + PAD * 2) * TEXT_RES);
  canvas.height = Math.ceil((blockH + PAD * 2) * TEXT_RES);

  const ctx = canvas.getContext("2d");
  ctx.textBaseline = "alphabetic";

  // Optional dark box behind each row of text (off by default)
  if (showBox) {
    const rows = new Map();
    lines.forEach((l) => {
      const r = rows.get(l.baseline) || { x0: Infinity, x1: -Infinity, size: 0 };
      r.x0 = Math.min(r.x0, l.x);
      r.x1 = Math.max(r.x1, l.x + l.w);
      r.size = Math.max(r.size, l.size);
      rows.set(l.baseline, r);
    });
    ctx.fillStyle = `rgba(0, 0, 0, ${TEXT_BOX_ALPHA})`;
    rows.forEach((r, baseline) => {
      ctx.fillRect(
        (PAD + r.x0 - 7) * TEXT_RES,
        (PAD + baseline - TEXT_ASCENT * r.size - 2.5) * TEXT_RES,
        (r.x1 - r.x0 + 14) * TEXT_RES,
        (r.size + 5) * TEXT_RES
      );
    });
  }

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
function placeTextBlock(mesh, left, top, z = 0.10) {
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
    lines.push({ text, font: "bd", size: TEXT_HEAD_SIZE, x: 0, baseline });
  });

  let firstBullet = true;
  bullets.forEach((bullet) => {
    bullet.forEach((text, j) => {
      baseline += firstBullet ? TEXT_HEAD_GAP : TEXT_BODY_PITCH;
      firstBullet = false;
      if (j === 0) {
        lines.push({ text: "•", font: "md", size: TEXT_BODY_SIZE, x: TEXT_BULLET_X, baseline });
      }
      lines.push({ text, font: "md", size: TEXT_BODY_SIZE, x: TEXT_INDENT, baseline });
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
  brain:   { left: 555, top: 556  },   // right of the brain, in the mountain gap
  animals: { left: 555, top: 556  },   // same slot (only one panel shows at a time)
  crm:     { left: 107, top: 1010 },   // under the CRM ring
  drop:    { left: 687, top: 1190 },   // under the drop icon
  doctor:  { left: 561, top: 1366 },   // under the scientist
  earth:   { left: 109, top: 1197 }    // upper-left of the globe
};

function placeCallout(mesh, spot, z = 0.10) {
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

anchor.onTargetFound = () => {
  console.log("✅ BROCHURE TARGET FOUND");
  startMapSpawn();                // map first, icons follow after ICON_START_DELAY
  startDecorSpawn();              // logo, mountains, waves fade in with the map
  icons.forEach((icon, i) => {
    setIconVisible(icon, true);
    startSpawn(icon, i);          // i = order in which they pop in
  });
};

anchor.onTargetLost = () => {
  console.log("❌ BROCHURE TARGET LOST");
  hideMap();
  hideDecor();
  icons.forEach((icon) => {
    icon.spawning = false;
    setIconVisible(icon, false);
  });
};


// ============================================================
// START
// ============================================================

await mindarThree.start();

console.log("📷 MindAR camera started");
console.log("🔎 Looking for brochure...");


// ============================================================
// ANIMATION LOOP
// ============================================================

let previousTime = performance.now();

renderer.setAnimationLoop(() => {

  const now = performance.now();
  const delta = now - previousTime;
  previousTime = now;

  updateMapSpawn(delta);
  updateDecorSpawn(delta);
  icons.forEach((icon) => updateSpawn(icon, delta));
  icons.forEach((icon) => updateTextFade(icon, delta));

  icons.forEach((icon) => {
    if (icon.state !== 1) return; // only advance frames while active
    icon.sprites.forEach((sprite) => {
      if (sprite.mesh.visible) sprite.update(delta);
    });
  });

  renderer.render(scene, camera);
});