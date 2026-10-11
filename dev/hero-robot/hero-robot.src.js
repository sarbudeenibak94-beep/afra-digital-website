// AFRA DIGITAL hero robot (Design D6) — original procedural Three.js model, no external assets.
// Source for assets/js/hero-robot.js (bundled + minified with only the Three.js parts used): see dev/hero-robot/build.mjs.
//
// Loaded by assets/js/site.js only on capable desktops (≥1024 px, fine pointer, no reduced motion, no Save-Data,
// no 2G). Everyone else keeps the static poster (assets/img/hero-robot-*.webp, rendered from this same model by
// dev/hero-robot/render-poster.mjs). The poster stays visible until the first frame is drawn and returns if
// WebGL fails or the context is lost.
import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Mesh, Points, Sprite,
  MeshPhysicalMaterial, MeshStandardMaterial, MeshBasicMaterial, PointsMaterial, SpriteMaterial,
  SphereGeometry, CylinderGeometry, TorusGeometry, BoxGeometry, CapsuleGeometry, LatheGeometry, ExtrudeGeometry,
  CircleGeometry, TubeGeometry, BufferGeometry, Float32BufferAttribute, Shape, Vector2, Vector3, CatmullRomCurve3,
  HemisphereLight, DirectionalLight, PointLight, PMREMGenerator, BackSide, DoubleSide,
  ACESFilmicToneMapping, SRGBColorSpace, AdditiveBlending, CanvasTexture,
  CubeUVReflectionMapping, Texture, DataTexture, LinearFilter, DataUtils,
} from 'three';

const GOLD = 0xd4af37, GOLD_BRIGHT = 0xf0cf5a;

// ---------- materials ----------
function materials() {
  return {
    shell: new MeshPhysicalMaterial({ color: 0x15171d, metalness: 0.9, roughness: 0.24, clearcoat: 1, clearcoatRoughness: 0.08 }),
    plate: new MeshPhysicalMaterial({ color: 0x1b1e25, metalness: 0.85, roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.15 }),
    matte: new MeshStandardMaterial({ color: 0x1a1c22, metalness: 0.6, roughness: 0.5 }),
    gold: new MeshPhysicalMaterial({ color: GOLD, metalness: 1, roughness: 0.2, clearcoat: 0.5, clearcoatRoughness: 0.12 }),
    goldSoft: new MeshPhysicalMaterial({ color: 0xb08b2a, metalness: 1, roughness: 0.34 }),
    visor: new MeshPhysicalMaterial({ color: 0x010102, metalness: 0.2, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, side: DoubleSide }),
    seam: new MeshStandardMaterial({ color: 0x050506, metalness: 0.4, roughness: 0.7, side: DoubleSide }),
    eye: new MeshBasicMaterial({ color: 0xffc24a, toneMapped: false }),
    eyeCore: new MeshBasicMaterial({ color: 0xfff3cf, toneMapped: false }),
    glowDim: new MeshBasicMaterial({ color: 0xc9962a, toneMapped: false }),
    socket: new MeshStandardMaterial({ color: 0x030304, metalness: 0.3, roughness: 0.5 }),
  };
}

// Soft round sprite texture for glows and particles.
function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,220,130,1)'); r.addColorStop(0.22, 'rgba(240,190,80,0.4)'); r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace; return t;
}

// ---------- head geometry helpers ----------
// Helmet profile (radius, height) from crown to chin; the head is a lathe of it, slightly deeper than wide.
const HEAD_CTRL = [[0.001, 1.06], [0.3, 1.03], [0.55, 0.94], [0.74, 0.77], [0.85, 0.54], [0.88, 0.3], [0.86, 0.06], [0.8, -0.18], [0.7, -0.4], [0.55, -0.58], [0.35, -0.71], [0.001, -0.76]];
const HEAD = new CatmullRomCurve3(HEAD_CTRL.map(([r, y]) => new Vector3(r, y, 0)), false, 'centripetal').getPoints(90).map(p => [Math.max(0.001, p.x), p.y]);
const rAt = y => { for (let i = 0; i < HEAD.length - 1; i++) { const [r0, y0] = HEAD[i], [r1, y1] = HEAD[i + 1]; if (y <= y0 && y >= y1) return r0 + (r1 - r0) * (y0 - y) / (y0 - y1); } return 0.001; };
// A band of the helmet surface between heights y0 > y1, pushed out by `off`, spanning phi in [-w, w] around the front.
const band = (y0, y1, off, w, mat, steps = 16) => { const pts = []; for (let i = 0; i <= steps; i++) { const y = y1 + (y0 - y1) * i / steps; pts.push(new Vector2(rAt(y) + off, y)); } return new Mesh(new LatheGeometry(pts, 96, -w, 2 * w), mat); };
// A thin ribbon on the surface at height y (for trims and seams).
const ribbon = (y, off, h, w, mat) => new Mesh(new LatheGeometry([new Vector2(rAt(y - h) + off, y - h), new Vector2(rAt(y) + off + 0.006, y), new Vector2(rAt(y + h) + off, y + h)], 96, -w, 2 * w), mat);
// Point on the surface at height y and angle phi (0 = front, positive = robot's left / viewer's right).
const surf = (y, phi, off = 0) => { const r = rAt(y) + off; return new Vector3(Math.sin(phi) * r, y, Math.cos(phi) * r); };

// ---------- the robot ----------
function buildRobot(M) {
  const robot = new Group();
  const glowTex = glowTexture();

  // ---- body: torso, shoulders, chest ----
  const body = new Group(); robot.add(body);
  const torso = new Mesh(new LatheGeometry([[0.001, 0.08], [0.46, 0.08], [0.58, -0.02], [1.0, -0.36], [1.4, -0.74], [1.6, -1.15], [1.68, -1.7], [1.64, -2.4], [1.5, -3.1], [0.001, -3.1]].map(([x, y]) => new Vector2(x, y)), 96), M.shell);
  torso.scale.set(1, 1, 0.62); body.add(torso);
  const collar = new Mesh(new TorusGeometry(0.56, 0.07, 16, 80), M.gold); collar.rotation.x = Math.PI / 2; collar.position.y = 0.06; collar.scale.set(1, 0.62, 1); body.add(collar);

  for (const side of [-1, 1]) {
    // layered shoulder armour
    const sh = new Group(); sh.position.set(side * 1.48, -0.9, 0); sh.rotation.z = side * -0.34; body.add(sh);
    const cap = new Mesh(new SphereGeometry(0.66, 64, 32, 0, Math.PI * 2, 0, Math.PI * 0.52), M.shell); cap.scale.set(1.22, 0.78, 0.95); sh.add(cap);
    const rim = new Mesh(new TorusGeometry(0.66 * Math.sin(Math.PI * 0.52), 0.032, 12, 80), M.gold); rim.rotation.x = Math.PI / 2; rim.position.y = 0.66 * Math.cos(Math.PI * 0.52) * 0.78; rim.scale.set(1.22, 0.95, 1); sh.add(rim);
    const cap2 = new Mesh(new SphereGeometry(0.48, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.42), M.plate); cap2.scale.set(1.15, 0.7, 0.9); cap2.position.set(side * 0.1, 0.14, 0); sh.add(cap2);
    const rim2 = new Mesh(new TorusGeometry(0.48 * Math.sin(Math.PI * 0.42), 0.02, 10, 64), M.goldSoft); rim2.rotation.x = Math.PI / 2; rim2.position.set(side * 0.1, 0.14 + 0.48 * Math.cos(Math.PI * 0.42) * 0.7, 0); rim2.scale.set(1.15, 0.9, 1); sh.add(rim2);
    // trapezius plates between neck and shoulder
    const trap = new Mesh(new BoxGeometry(0.75, 0.08, 0.55), M.plate); trap.position.set(side * 0.78, -0.3, 0.05); trap.rotation.z = side * -0.6; body.add(trap);
    const trapEdge = new Mesh(new BoxGeometry(0.75, 0.02, 0.02), M.gold); trapEdge.position.set(side * 0.78, -0.27, 0.33); trapEdge.rotation.z = side * -0.6; body.add(trapEdge);
    // pectoral plate
    const pec = new Shape(); pec.moveTo(0, 0); pec.lineTo(0.78, 0.08); pec.quadraticCurveTo(0.9, -0.25, 0.7, -0.55); pec.lineTo(0.08, -0.5); pec.quadraticCurveTo(-0.02, -0.25, 0, 0);
    const pm = new Mesh(new ExtrudeGeometry(pec, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.02, bevelSegments: 3, curveSegments: 16 }), M.plate);
    pm.position.set(side * 0.12, -0.72, 0.9); pm.scale.x = side; pm.rotation.y = side * 0.32; pm.rotation.x = -0.18; body.add(pm);
    const pe = new Mesh(new BoxGeometry(0.66, 0.018, 0.02), M.gold); pe.position.set(side * 0.5, -0.66, 1.0); pe.rotation.z = side * 0.06; pe.rotation.y = side * 0.32; body.add(pe);
  }

  // chest core
  const chest = new Group(); chest.position.set(0, -1.42, 0.98); chest.rotation.x = -0.14; body.add(chest);
  const hex = new Shape(); for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + i * Math.PI / 3; (i ? hex.lineTo : hex.moveTo).call(hex, Math.cos(a) * 0.36, Math.sin(a) * 0.36); }
  chest.add(new Mesh(new ExtrudeGeometry(hex, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2 }), M.gold));
  const hexIn = new Mesh(new ExtrudeGeometry(hex, { depth: 0.05, bevelEnabled: false }), M.plate); hexIn.scale.setScalar(0.82); hexIn.position.z = 0.02; chest.add(hexIn);
  const core = new Group(); core.position.z = 0.09; chest.add(core);
  const coreRing = new Mesh(new TorusGeometry(0.17, 0.022, 12, 48), M.gold); core.add(coreRing);
  const coreGlowRing = new Mesh(new TorusGeometry(0.12, 0.012, 10, 48), M.glowDim); core.add(coreGlowRing);
  const coreLight = new Mesh(new CircleGeometry(0.085, 40), M.eye.clone()); coreLight.position.z = 0.005; core.add(coreLight);
  const coreGlow = new Sprite(new SpriteMaterial({ map: glowTex, color: 0xffc85a, transparent: true, opacity: 0.55, depthWrite: false, blending: AdditiveBlending })); coreGlow.scale.set(0.8, 0.8, 1); coreGlow.position.z = 0.04; core.add(coreGlow);
  // sternum line
  const stern = new Mesh(new BoxGeometry(0.02, 0.5, 0.02), M.goldSoft); stern.position.set(0, -0.98, 1.0); stern.rotation.x = -0.2; body.add(stern);

  // ---- neck ----
  const neck = new Group(); neck.position.y = 0.06; robot.add(neck);
  const neckCore = new Mesh(new CylinderGeometry(0.32, 0.38, 0.44, 40), M.matte); neckCore.position.y = 0.22; neck.add(neckCore);
  for (const [i, y] of [0.08, 0.22, 0.36].entries()) { const ring = new Mesh(new TorusGeometry(0.33 - i * 0.03, 0.026, 12, 64), i === 1 ? M.gold : M.goldSoft); ring.rotation.x = Math.PI / 2; ring.position.y = y; neck.add(ring); }
  for (const a of [0.6, -0.6, Math.PI - 0.6, Math.PI + 0.6]) {
    const p = new Group(); p.position.set(Math.sin(a) * 0.33, 0.02, Math.cos(a) * 0.3); neck.add(p);
    const sleeve = new Mesh(new CylinderGeometry(0.04, 0.04, 0.24, 16), M.plate); sleeve.position.y = 0.12; p.add(sleeve);
    const rod = new Mesh(new CylinderGeometry(0.02, 0.02, 0.26, 12), M.gold); rod.position.y = 0.34; p.add(rod);
  }

  // ---- head (pivots at the top of the neck) ----
  const headPivot = new Group(); headPivot.position.y = 0.5; robot.add(headPivot);
  const head = new Group(); head.position.y = 0.72; headPivot.add(head);
  const S = new Group(); S.scale.set(1, 1, 1.06); head.add(S);
  S.add(new Mesh(new LatheGeometry(HEAD.map(([r, y]) => new Vector2(r, y)), 128), M.shell)); // helmet

  // visor: dark glass band across the eyes with gold trims
  const VY0 = 0.52, VY1 = 0.02, VW = 1.12;
  S.add(band(VY0, VY1, 0.018, VW, M.visor));
  S.add(ribbon(VY0 + 0.012, 0.03, 0.016, VW + 0.02, M.gold));
  S.add(ribbon(VY1 - 0.012, 0.03, 0.016, VW + 0.02, M.gold));
  for (const side of [-1, 1]) { // side caps of the visor
    const a = surf(VY0, side * (VW + 0.02), 0.03), b = surf(VY1, side * (VW + 0.02), 0.03);
    S.add(new Mesh(new TubeGeometry(new CatmullRomCurve3([a, surf((VY0 + VY1) / 2, side * (VW + 0.02), 0.04), b]), 16, 0.018, 8), M.gold));
  }
  // jaw plate with vents
  S.add(band(-0.1, -0.5, 0.012, 0.78, M.plate));
  S.add(ribbon(-0.09, 0.024, 0.012, 0.8, M.gold));
  for (const y of [-0.22, -0.3, -0.38]) S.add(ribbon(y, 0.02, 0.01, 0.42 - (y + 0.22) * 0.6, M.seam));
  // crest: gold ribbon from brow over the crown, plus a seam ring at the back
  const crestPts = [0.56, 0.66, 0.76, 0.85, 0.92, 0.98].map(y => new Vector3(0, y, rAt(y) + 0.02));
  S.add(new Mesh(new TubeGeometry(new CatmullRomCurve3(crestPts), 48, 0.022, 8), M.gold));
  S.add(ribbon(0.66, 0.008, 0.01, Math.PI, M.seam));
  // side sensor pods
  for (const side of [-1, 1]) {
    const pod = new Group(); const pos = surf(0.24, side * Math.PI / 2, 0.02); pod.position.copy(pos); pod.lookAt(pos.clone().multiplyScalar(3)); S.add(pod);
    const base = new Mesh(new CylinderGeometry(0.24, 0.27, 0.1, 48), M.plate); base.rotation.x = Math.PI / 2; pod.add(base);
    const rim = new Mesh(new TorusGeometry(0.24, 0.024, 12, 64), M.gold); rim.position.z = 0.05; pod.add(rim);
    const gl = new Mesh(new TorusGeometry(0.14, 0.012, 10, 48), M.glowDim); gl.position.z = 0.055; pod.add(gl);
    const hub = new Mesh(new CylinderGeometry(0.08, 0.08, 0.04, 32), M.gold); hub.rotation.x = Math.PI / 2; hub.position.z = 0.06; pod.add(hub);
  }

  // eyes: horizontal slits in the visor; the bright core tracks the pointer
  const eyes = [];
  for (const side of [-1, 1]) {
    const pos = surf(0.27, side * 0.36, 0.024);
    const eye = new Group(); eye.position.copy(pos); eye.lookAt(pos.clone().multiplyScalar(3)); S.add(eye);
    const socket = new Mesh(new CapsuleGeometry(0.075, 0.2, 8, 24), M.socket); socket.rotation.z = Math.PI / 2; socket.scale.z = 0.15; eye.add(socket);
    const lid = new Group(); lid.position.z = 0.012; eye.add(lid);
    const slit = new Mesh(new CapsuleGeometry(0.048, 0.19, 8, 24), M.eye); slit.rotation.z = Math.PI / 2; slit.scale.z = 0.2; lid.add(slit);
    const iris = new Group(); iris.position.z = 0.012; lid.add(iris);
    const core = new Mesh(new CapsuleGeometry(0.03, 0.05, 6, 16), M.eyeCore); core.rotation.z = Math.PI / 2; core.scale.z = 0.2; iris.add(core);
    const glow = new Sprite(new SpriteMaterial({ map: glowTex, color: 0xffc85a, transparent: true, opacity: 0.9, depthWrite: false, blending: AdditiveBlending }));
    glow.scale.set(0.75, 0.38, 1); glow.position.z = 0.03; lid.add(glow);
    eyes.push({ lid, iris });
  }

  return { robot, body, neck, headPivot, head, eyes, coreLight, coreGlowRing, coreGlow, glowTex };
}

// ---------- environment (studio reflections) ----------
function studioEnvironmentTarget(renderer) {
  const env = new Scene();
  env.add(new Mesh(new BoxGeometry(20, 20, 20), new MeshBasicMaterial({ color: 0x040405, side: BackSide })));
  const panel = (w, h, color, x, y, z, ry = 0, rx = 0) => { const m = new Mesh(new BoxGeometry(w, h, 0.1), new MeshBasicMaterial({ color })); m.position.set(x, y, z); m.rotation.set(rx, ry, 0); env.add(m); };
  panel(6, 4, 0xfff1d6, -5, 4, 6, 0.6, -0.3); // warm key softbox
  panel(10, 1.2, 0xffffff, 0, 9, 0, 0, Math.PI / 2); // top strip
  panel(1.4, 9, 0xf0cf5a, 8, 1, -2, -1.2); // gold strip right
  panel(1.4, 9, 0xd4af37, -8, 0, -3, 1.2); // gold strip left
  panel(4, 1, 0xffffff, 4, 3, 7, -0.5); // small front-right highlight
  panel(5, 2, 0x3a3020, 0, -6, 5, 0, 0.6); // floor bounce
  const pmrem = new PMREMGenerator(renderer);
  const target = pmrem.fromScene(env, 0.03);
  pmrem.dispose();
  return target;
}
function studioEnvironment(renderer) { return studioEnvironmentTarget(renderer).texture; }

// ---------- baked environment (D6.1 Fix B1) ----------
// The studio reflections above are pre-filtered once at build time (bakeEnvironment) with exactly the same PMREM call and
// shipped as a PNG in three.js' cube-UV layout. Loading it means no PMREM shaders are compiled in the browser; compiling
// them synchronously blocked the main thread for 1–2 s at start-up. The data is low dynamic range (≤ 1), so 8-bit sRGB
// storage is enough; rows are stored in WebGL order (bottom row first), so the texture is uploaded unflipped.
export const ENV_URL = '/assets/img/hero-robot-env.png?v=d61';
const ENV_W = 768, ENV_H = 1024, ENV_STRIPS = 4; // three.js cube-UV layout for a 256 px PMREM
async function decodeBakedEnvironment(url) {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error('environment ' + res.status);
  const blob = await res.blob();
  const ihdr = new DataView(await blob.slice(16, 24).arrayBuffer()); // PNG IHDR width/height
  if (ihdr.getUint32(0) !== ENV_W || ihdr.getUint32(4) !== ENV_H) throw new Error('environment size');
  const h = ENV_H / ENV_STRIPS, opts = { premultiplyAlpha: 'none', colorSpaceConversion: 'none' };
  return Promise.all(Array.from({ length: ENV_STRIPS }, (_, i) => createImageBitmap(blob, 0, i * h, ENV_W, h, opts))); // decoded off the main thread
}
const envTexture = () => {
  const t = new DataTexture(null, ENV_W, ENV_H); // RGBA, 8 bit
  t.mapping = CubeUVReflectionMapping; t.colorSpace = SRGBColorSpace; t.flipY = false; t.generateMipmaps = false;
  t.minFilter = t.magFilter = LinearFilter; t.source.dataReady = false; t.needsUpdate = true; // allocate only; strips are copied in
  return t;
};
// Uploads strip i into rows [i*h, (i+1)*h) — PNG row order is WebGL row order, so nothing is flipped.
const uploadStrip = (renderer, tex, strips, i) => renderer.copyTextureToTexture(new Texture(strips[i]), tex, null, new Vector2(0, i * (ENV_H / ENV_STRIPS)));
// Lets the GPU finish queued work without blocking (WebGL2 fence polled across tasks), so the next synchronous WebGL
// call does not stall the main thread. Gives up waiting after max ms.
async function gpuIdle(gl, max = 3000) {
  if (!gl.fenceSync) return;
  const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush();
  const t0 = performance.now();
  while (gl.getSyncParameter(sync, gl.SYNC_STATUS) !== gl.SIGNALED && performance.now() - t0 < max) await new Promise(r => setTimeout(r, 16));
  gl.deleteSync(sync);
}
// dev only (dev/hero-robot/bake-environment.mjs): returns the PMREM result as a PNG data URL + stats
export function bakeEnvironment() {
  const canvas = document.createElement('canvas');
  const renderer = createRenderer({ width: 16, height: 16, pixelRatio: 1, canvas });
  const target = studioEnvironmentTarget(renderer);
  const w = target.width, h = target.height, half = new Uint16Array(w * h * 4);
  renderer.readRenderTargetPixels(target, 0, 0, w, h, half);
  const out = new Uint8ClampedArray(w * h * 4); let maxLinear = 0, minAlpha = Infinity;
  const enc = c => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
  for (let i = 0; i < half.length; i += 4) {
    for (let c = 0; c < 3; c++) { const v = DataUtils.fromHalfFloat(half[i + c]); if (v > maxLinear) maxLinear = v; out[i + c] = Math.round(255 * Math.min(1, Math.max(0, enc(v)))); }
    const a = DataUtils.fromHalfFloat(half[i + 3]); if (a < minAlpha) minAlpha = a; out[i + 3] = 255;
  }
  const c2 = document.createElement('canvas'); c2.width = w; c2.height = h;
  c2.getContext('2d').putImageData(new ImageData(out, w, h), 0, 0); // row 0 of the PNG = WebGL row 0 (bottom)
  renderer.dispose();
  return { url: c2.toDataURL('image/png'), width: w, height: h, maxLinear, minAlpha };
}
// dev only: render the poster pose with the baked environment (for fidelity comparison with renderPoster)
export async function renderWithBakedEnvironment(size = 640, url = ENV_URL) {
  const canvas = document.createElement('canvas');
  const renderer = createRenderer({ width: size, height: size, pixelRatio: 1, preserveDrawingBuffer: true, canvas });
  const stage = { renderer, ...buildScene(size, size) };
  const strips = await decodeBakedEnvironment(url), tex = envTexture();
  renderer.initTexture(tex);
  for (let i = 0; i < ENV_STRIPS; i++) uploadStrip(renderer, tex, strips, i);
  stage.scene.environment = tex;
  pose(stage, POSTER_POSE);
  renderer.render(stage.scene, stage.camera);
  const out = canvas.toDataURL('image/png');
  renderer.dispose();
  return out;
}

function particles(tex) {
  let seed = 0x5eed; const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; // fixed seed: identical poster on every build
  const n = 110, pos = [];
  for (let i = 0; i < n; i++) { const r = 2.4 + rnd() * 1.8, a = rnd() * Math.PI * 2, y = -2 + rnd() * 4.4; pos.push(Math.cos(a) * r, y, Math.sin(a) * r * 0.7 - 0.8); }
  const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  return new Points(g, new PointsMaterial({ color: GOLD_BRIGHT, size: 0.065, map: tex, transparent: true, opacity: 0.7, depthWrite: false, blending: AdditiveBlending, sizeAttenuation: true }));
}

// ---------- scene assembly ----------
// Set-up is split into steps so the live mount can yield to the browser between them (no multi-second long task);
// the poster renders them back to back. No shadow map: it doubled the shader work for barely visible soft shadows.
function createRenderer({ width, height, pixelRatio, preserveDrawingBuffer = false, canvas }) {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer, powerPreference: 'high-performance' });
  renderer.setPixelRatio(pixelRatio); renderer.setSize(width, height, false);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = ACESFilmicToneMapping; renderer.toneMappingExposure = 1.08;
  renderer.outputColorSpace = SRGBColorSpace;
  return renderer;
}
function buildScene(width, height) {
  const scene = new Scene();
  const parts = buildRobot(materials());
  parts.robot.position.y = -0.55;
  scene.add(parts.robot);
  scene.add(new HemisphereLight(0xfff3dc, 0x0a0806, 0.45));
  const key = new DirectionalLight(0xfff0d2, 2.9); key.position.set(-3.5, 5, 6); scene.add(key);
  // rim lights behind the robot separate the dark silhouette from the dark page
  for (const [x, y, z, c, i] of [[-3.4, 2.8, -3.5, 0xfff0cc, 110], [3.6, 2.2, -3.5, 0xf0cf5a, 110], [0, 4.2, -3, 0xffe6b0, 50]]) {
    const l = new PointLight(c, i, 14, 2); l.position.set(x, y, z); scene.add(l);
  }
  // front fills: one for the face, one low and wide so the dark torso keeps its form (no separate eye light — its
  // reflection showed as a bright dot between the eyes; the eyes glow on their own)
  const fill = new PointLight(0xffe2a8, 9, 10, 2); fill.position.set(2.5, 0.5, 5); scene.add(fill);
  const torsoFill = new PointLight(0xffe6b8, 16, 9, 2); torsoFill.position.set(-1.8, -1.6, 4.2); scene.add(torsoFill);
  const dots = particles(parts.glowTex); scene.add(dots);
  const camera = new PerspectiveCamera(26, width / height, 0.1, 60);
  camera.position.set(0, 0.6, 10.6); camera.lookAt(0, 0.0, 0);
  return { scene, camera, parts, dots };
}
function createStage(opts) {
  const renderer = createRenderer(opts);
  const stage = { renderer, ...buildScene(opts.width, opts.height) };
  stage.scene.environment = studioEnvironment(renderer);
  return stage;
}

// Apply a pose: yaw/pitch in radians (yaw > 0 turns towards the viewer's right), eye offset in [-1, 1].
function pose(stage, { yaw, pitch, eyeX, eyeY, t, blink = 0 }) {
  const { parts, dots } = stage;
  parts.headPivot.rotation.set(pitch, yaw, -yaw * 0.06);
  parts.neck.rotation.y = yaw * 0.3;
  const breath = Math.sin(t * 1.15);
  parts.body.position.y = breath * 0.012; parts.body.scale.set(1 + breath * 0.004, 1, 1 + breath * 0.004);
  parts.head.position.y = 0.72 + Math.sin(t * 1.15 + 0.6) * 0.01;
  for (const e of parts.eyes) { e.iris.position.x = eyeX * 0.07; e.iris.position.y = eyeY * 0.015; e.lid.scale.y = 1 - blink * 0.92; }
  const pulse = 0.78 + 0.22 * Math.sin(t * 1.15);
  parts.coreLight.material.color.setRGB(pulse * 1.0 + 0.15, pulse * 0.78 + 0.1, pulse * 0.35 + 0.04);
  parts.coreGlow.material.opacity = 0.35 + 0.25 * pulse;
  parts.coreGlowRing.rotation.z = t * 0.4;
  dots.rotation.y = t * 0.03; dots.position.y = Math.sin(t * 0.4) * 0.05;
}

// ---------- poster (used by dev/hero-robot/render-poster.mjs) ----------
export const POSTER_POSE = { yaw: -0.2, pitch: 0.04, eyeX: -0.7, eyeY: 0.1, t: 1.4 };
export function renderPoster(size = 960, format = 'image/webp', quality = 0.86) {
  const canvas = document.createElement('canvas');
  const stage = createStage({ width: size, height: size, pixelRatio: 1, preserveDrawingBuffer: true, canvas });
  pose(stage, POSTER_POSE);
  stage.renderer.render(stage.scene, stage.camera);
  const url = canvas.toDataURL(format, quality);
  stage.renderer.dispose();
  return url;
}

// ---------- live mount ----------
const nextTask = () => new Promise(r => setTimeout(r, 0)); // yield so input can be handled between set-up steps
export async function mount(host) {
  const envPromise = decodeBakedEnvironment(ENV_URL).catch(() => null); // fetch + off-thread decode in parallel with set-up
  const setState = s => host.setAttribute('data-robot', s);
  const canvas = document.createElement('canvas');
  canvas.className = 'hero-robot-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const box = () => { const r = host.getBoundingClientRect(); return [Math.max(1, Math.round(r.width)), Math.max(1, Math.round(r.height))]; };
  let [w, h] = box();
  let renderer;
  try { renderer = createRenderer({ width: w, height: h, pixelRatio: Math.min(window.devicePixelRatio || 1, 2), canvas }); }
  catch (e) { setState('unsupported'); return null; }
  await nextTask();
  const stage = { renderer, ...buildScene(w, h) };
  await nextTask();
  await gpuIdle(renderer.getContext());
  const strips = await envPromise;
  let envTex = null;
  if (strips) {
    try { // allocate, then one strip per task: no single long upload
      envTex = envTexture(); renderer.initTexture(envTex);
      for (let i = 0; i < ENV_STRIPS; i++) { await nextTask(); uploadStrip(renderer, envTex, strips, i); }
    } catch (e) { if (envTex) envTex.dispose(); envTex = null; }
    strips.forEach(b => b.close());
  }
  if (envTex) stage.scene.environment = envTex;
  else stage.scene.environment = studioEnvironment(renderer); // fallback: runtime PMREM (blocking, as before)
  await nextTask();
  // compile every shader before the first frame; uses KHR_parallel_shader_compile where available (non-blocking)
  try { await renderer.compileAsync(stage.scene, stage.camera); } catch (e) {}
  await nextTask();
  if (renderer.getContext().isContextLost()) { renderer.dispose(); setState('context-lost'); return null; }
  host.appendChild(canvas);

  // start from the poster's pose so the hand-over from the static image is seamless
  const P = POSTER_POSE;
  const state = { yaw: P.yaw, pitch: P.pitch, eyeX: P.eyeX, eyeY: P.eyeY, tYaw: 0, tPitch: 0, tEyeX: 0, tEyeY: 0, lastMove: -1e9, inside: false, blinkAt: 3.5, blinkT: -1 };
  const LIM_YAW = 0.42, LIM_PITCH = 0.2;
  let visible = true, raf = 0, last = performance.now(), t = P.t, dead = false, firstFrame = true;

  const onMove = e => {
    if (e.pointerType && e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
    const r = host.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height * 0.35;
    // normalise by the distance to the viewport edge on each side, so both directions reach the full (clamped) range
    const dx = e.clientX - cx, dy = e.clientY - cy;
    const nx = Math.max(-1, Math.min(1, dx / Math.max(80, dx < 0 ? cx : window.innerWidth - cx)));
    const ny = Math.max(-1, Math.min(1, dy / Math.max(80, dy < 0 ? cy : window.innerHeight - cy)));
    state.tYaw = nx * LIM_YAW; state.tPitch = ny * LIM_PITCH; state.tEyeX = nx; state.tEyeY = -ny;
    state.lastMove = t; state.inside = true;
  };
  const onLeave = () => { state.inside = false; };
  window.addEventListener('pointermove', onMove, { passive: true });
  document.documentElement.addEventListener('pointerleave', onLeave);
  window.addEventListener('blur', onLeave);

  const frame = now => {
    raf = 0; if (dead) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
    const idle = !state.inside || t - state.lastMove > 3;
    const tYaw = idle ? Math.sin(t * 0.3) * 0.14 : state.tYaw;
    const tPitch = idle ? 0.03 + Math.sin(t * 0.45) * 0.04 : state.tPitch;
    const tEyeX = idle ? Math.sin(t * 0.3 + 0.5) * 0.45 : state.tEyeX;
    const tEyeY = idle ? Math.sin(t * 0.45) * 0.2 : state.tEyeY;
    const kHead = 1 - Math.exp(-dt * 3), kEye = 1 - Math.exp(-dt * 8);
    state.yaw += (tYaw - state.yaw) * kHead; state.pitch += (tPitch - state.pitch) * kHead;
    state.eyeX += (tEyeX - state.eyeX) * kEye; state.eyeY += (tEyeY - state.eyeY) * kEye;
    // calm blink every 4–7 s, 180 ms long
    if (state.blinkT < 0 && t > state.blinkAt) state.blinkT = 0;
    let blink = 0;
    if (state.blinkT >= 0) { state.blinkT += dt; const p = state.blinkT / 0.18; if (p >= 1) { state.blinkT = -1; state.blinkAt = t + 4 + Math.random() * 3; } else blink = Math.sin(p * Math.PI); }
    pose(stage, { yaw: state.yaw, pitch: state.pitch, eyeX: state.eyeX, eyeY: state.eyeY, t, blink });
    stage.renderer.render(stage.scene, stage.camera);
    if (firstFrame) { firstFrame = false; setState('live'); }
    if (visible && !document.hidden) raf = requestAnimationFrame(frame);
  };
  const start = () => { if (!raf && !dead && visible && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(frame); } };
  const stop = () => { if (raf) cancelAnimationFrame(raf); raf = 0; };

  const io = 'IntersectionObserver' in window ? new IntersectionObserver(en => { visible = en[0].isIntersecting; if (visible) start(); else stop(); }) : null;
  if (io) io.observe(host);
  const onVis = () => { if (document.hidden) stop(); else start(); };
  document.addEventListener('visibilitychange', onVis);
  const ro = 'ResizeObserver' in window ? new ResizeObserver(() => { const [nw, nh] = box(); if (nw !== w || nh !== h) { w = nw; h = nh; stage.renderer.setSize(w, h, false); stage.camera.aspect = w / h; stage.camera.updateProjectionMatrix(); start(); } }) : null;
  if (ro) ro.observe(host);

  const destroy = (finalState = 'poster') => {
    if (dead) return; dead = true; stop();
    window.removeEventListener('pointermove', onMove); document.documentElement.removeEventListener('pointerleave', onLeave); window.removeEventListener('blur', onLeave);
    document.removeEventListener('visibilitychange', onVis); if (io) io.disconnect(); if (ro) ro.disconnect();
    try { stage.renderer.dispose(); } catch (e) {}
    canvas.remove(); setState(finalState);
  };
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); destroy('context-lost'); });

  start();
  const api = { destroy, get pose() { return { yaw: state.yaw, pitch: state.pitch, eyeX: state.eyeX, eyeY: state.eyeY }; }, get running() { return !!raf; }, renderer: stage.renderer };
  if (window.__afraRobotTest) window.__afraRobot = api; // test hook only (the e2e suite sets the flag before load)
  return api;
}

// Auto-mount when the loader in site.js has marked the host as eligible.
const host = document.querySelector('.hero-robot[data-robot="loading"]');
if (host) mount(host).then(api => { if (!api && host.getAttribute('data-robot') === 'loading') host.setAttribute('data-robot', 'unsupported'); }, () => host.setAttribute('data-robot', 'failed'));
