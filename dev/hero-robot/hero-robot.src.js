// AFRA DIGITAL hero robot (Design D6) — original procedural Three.js model, no external assets.
// Source for assets/js/hero-robot.js (bundled + minified with only the Three.js parts used): see dev/hero-robot/build.mjs.
//
// Loaded by assets/js/site.js after page load on desktops and phones alike, unless the visitor prefers reduced
// motion, has Save-Data or a 2G connection, or the device reports < 2 GB memory; those keep the static poster
// (assets/img/hero-robot-*.webp, rendered from this same model by dev/hero-robot/render-poster.mjs). The poster stays
// visible until the first frame is drawn and returns if WebGL fails or the context is lost. Phones and tablets get a
// lighter renderer (pixel ratio ≤ 1.5) and the idle animation; desktops with a mouse also get head and eye tracking.
import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Mesh, Points, Sprite,
  MeshPhysicalMaterial, MeshStandardMaterial, MeshBasicMaterial, PointsMaterial, SpriteMaterial,
  SphereGeometry, CylinderGeometry, TorusGeometry, BoxGeometry, CapsuleGeometry, LatheGeometry,
  CircleGeometry, TubeGeometry, BufferGeometry, Float32BufferAttribute, Vector2, Vector3, CatmullRomCurve3,
  HemisphereLight, DirectionalLight, PointLight, PMREMGenerator, BackSide,
  ACESFilmicToneMapping, SRGBColorSpace, AdditiveBlending, CanvasTexture,
  CubeUVReflectionMapping, Texture, DataTexture, LinearFilter, DataUtils,
} from 'three';

const GOLD = 0xd4af37, GOLD_BRIGHT = 0xf0cf5a;
const FONT = '"Inter", "Segoe UI", Arial, sans-serif';
const LOGO_URL = '/assets/img/afra-logo-256.webp'; // the official logo, shown unaltered on a badge on the robot's back

// ---------- materials ----------
function materials() {
  return {
    shell: new MeshPhysicalMaterial({ color: 0x111318, metalness: 0.88, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.06 }),
    plate: new MeshPhysicalMaterial({ color: 0x1b1e25, metalness: 0.85, roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.15 }),
    matte: new MeshStandardMaterial({ color: 0x17191f, metalness: 0.6, roughness: 0.5 }),
    gold: new MeshPhysicalMaterial({ color: GOLD, metalness: 1, roughness: 0.2, clearcoat: 0.5, clearcoatRoughness: 0.12 }),
    goldSoft: new MeshPhysicalMaterial({ color: 0xb08b2a, metalness: 1, roughness: 0.34 }),
    visor: new MeshPhysicalMaterial({ color: 0x010102, metalness: 0.2, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02 }),
    glow: new MeshBasicMaterial({ color: 0xc8902f, toneMapped: false }), // softly lit gold seams, joints and soles
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
// Radial alpha map (white = opaque) for soft-edged floor and shadow discs.
function radialTexture(stops) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'), r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (const [o, col] of stops) r.addColorStop(o, col);
  g.fillStyle = r; g.fillRect(0, 0, 128, 128); return new CanvasTexture(c);
}
// LED-dot eye: a disc of small gold dots, brighter towards the centre.
function eyeTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  for (let y = 4; y < 128; y += 8) for (let x = 4; x < 128; x += 8) {
    const d = Math.hypot(x - 64, y - 64) / 60; if (d > 1) continue;
    g.fillStyle = `rgba(255,${Math.round(200 + 40 * (1 - d))},${Math.round(90 + 80 * (1 - d))},${(0.55 + 0.45 * (1 - d)).toFixed(2)})`;
    g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill();
  }
  const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace; return t;
}
// "AFRA DIGITAL" chest lettering in gold (transparent background).
function chestTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256; const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 30, 0, 230); grad.addColorStop(0, '#fff0b8'); grad.addColorStop(0.45, '#f0cf5a'); grad.addColorStop(1, '#b8892a');
  g.fillStyle = grad; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = 'rgba(255,190,70,0.55)'; g.shadowBlur = 10;
  g.font = `900 132px ${FONT}`; g.fillText('AFRA', 256, 96);
  g.font = `700 58px ${FONT}`; if ('letterSpacing' in g) g.letterSpacing = '10px'; g.fillText('DIGITAL', 261, 192);
  const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace; t.anisotropy = 4; return t;
}
// Back badge: champagne disc with a gold rim; the official logo is drawn on it once loaded (its dark lettering needs a
// light ground — on the black shell it would disappear). Returns the texture and a promise that settles when drawn.
function badgeTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d');
  const paint = img => {
    g.clearRect(0, 0, 512, 512);
    g.beginPath(); g.arc(256, 256, 248, 0, Math.PI * 2); g.fillStyle = '#d4af37'; g.fill();
    g.beginPath(); g.arc(256, 256, 232, 0, Math.PI * 2); g.fillStyle = '#f6efdc'; g.fill();
    if (img) { g.save(); g.beginPath(); g.arc(256, 256, 226, 0, Math.PI * 2); g.clip(); g.drawImage(img, 76, 76, 360, 360); g.restore(); }
  };
  paint(null);
  const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace; t.anisotropy = 4;
  const ready = new Promise(resolve => {
    const img = new Image(); img.decoding = 'async';
    img.onload = () => { paint(img); t.needsUpdate = true; resolve(true); };
    img.onerror = () => resolve(false); // badge stays plain; never blocks the robot
    img.src = LOGO_URL;
  });
  return { t, ready };
}

// ---------- the robot ----------
// Full-body, black-and-gold character: large helmet with a visor face (LED eyes, smile) and headphone ear cups,
// compact torso with "AFRA DIGITAL" on the chest and the logo badge on the back, right hand raised and pointing.
// Units: the robot stands from y ≈ -2.2 (soles) to y ≈ 2.3 (crown); +z faces the viewer.
const sp = (r, theta, a) => new Vector3(Math.sin(a) * Math.sin(theta) * r, Math.cos(theta) * r, Math.cos(a) * Math.sin(theta) * r); // sphere point: theta from top, a from front (+ = robot's left / viewer's right)
const capsule = (r, len, mat, seg = 20) => new Mesh(new CapsuleGeometry(r, len, 6, seg), mat);
const ring = (r, tube, mat, seg = 48) => new Mesh(new TorusGeometry(r, tube, 8, seg), mat);

function buildArm(M, side, glowTex, pointing) {
  // pivot at the shoulder; segments hang along -y and are posed by rotating the pivot and the elbow
  const arm = new Group();
  arm.add(new Mesh(new SphereGeometry(0.2, 32, 20), M.shell));
  const paul = new Mesh(new SphereGeometry(0.29, 40, 20, 0, Math.PI * 2, 0, Math.PI * 0.5), M.shell); paul.scale.set(1.05, 0.72, 1); paul.position.y = 0.04; arm.add(paul);
  const pTrim = ring(0.29, 0.022, M.gold, 56); pTrim.rotation.x = Math.PI / 2; pTrim.scale.set(1.05, 1, 1); pTrim.position.y = 0.04; arm.add(pTrim);
  const paul2 = new Mesh(new SphereGeometry(0.21, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.42), M.plate); paul2.scale.set(1.05, 0.7, 0.95); paul2.position.y = 0.17; arm.add(paul2);
  const pGlow = ring(0.2, 0.01, M.glow, 48); pGlow.rotation.x = Math.PI / 2; pGlow.position.y = 0.17 + 0.21 * Math.cos(Math.PI * 0.42) * 0.7; arm.add(pGlow);
  const shRing = ring(0.17, 0.018, M.glow); shRing.rotation.y = Math.PI / 2; arm.add(shRing);
  const upper = capsule(0.135, 0.3, M.plate); upper.position.y = -0.3; arm.add(upper);
  const elbow = new Group(); elbow.position.y = -0.56; arm.add(elbow);
  elbow.add(new Mesh(new SphereGeometry(0.125, 24, 16), M.matte));
  const eRing = ring(0.125, 0.014, M.glow); eRing.rotation.x = Math.PI / 2; elbow.add(eRing);
  const fore = capsule(0.13, 0.26, M.shell); fore.position.y = -0.26; elbow.add(fore);
  const cuff = ring(0.12, 0.02, M.gold); cuff.rotation.x = Math.PI / 2; cuff.position.y = -0.44; elbow.add(cuff);
  const hand = new Group(); hand.position.y = -0.58; elbow.add(hand);
  const palm = new Mesh(new SphereGeometry(0.13, 24, 16), M.matte); palm.scale.set(1, 1.12, 0.78); hand.add(palm);
  let tip = null;
  for (let i = 0; i < 4; i++) { // fingers: curled knuckles, except the index finger when pointing
    const x = (i - 1.5) * 0.058 * side;
    if (pointing && i === 0) {
      const f = capsule(0.034, 0.17, M.matte, 12); f.position.set(x, -0.2, 0.03); hand.add(f);
      tip = new Mesh(new SphereGeometry(0.042, 16, 12), M.eye); tip.position.set(x, -0.31, 0.03); hand.add(tip);
      const tg = new Sprite(new SpriteMaterial({ map: glowTex, color: 0xffc85a, transparent: true, opacity: 0.55, depthWrite: false, blending: AdditiveBlending }));
      tg.scale.set(0.42, 0.42, 1); tg.position.copy(tip.position); hand.add(tg); tip.userData.glow = tg;
    } else {
      const k = new Mesh(new SphereGeometry(0.045, 12, 10), M.matte); k.position.set(x, -0.12, 0.06); hand.add(k);
    }
  }
  const thumb = capsule(0.03, 0.08, M.matte, 10); thumb.position.set(-0.11 * side, -0.05, 0.07); thumb.rotation.z = side * 0.6; hand.add(thumb);
  return { arm, elbow, hand, tip };
}

function buildLeg(M) {
  const leg = new Group();
  leg.add(new Mesh(new SphereGeometry(0.19, 24, 16), M.matte));
  const thigh = capsule(0.17, 0.2, M.shell); thigh.position.y = -0.24; leg.add(thigh);
  const knee = new Mesh(new SphereGeometry(0.15, 24, 16), M.plate); knee.position.y = -0.5; leg.add(knee);
  const kneeCap = new Mesh(new SphereGeometry(0.13, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.45), M.gold); kneeCap.rotation.x = Math.PI / 2; kneeCap.scale.set(1, 1, 0.55); kneeCap.position.set(0, -0.5, 0.11); leg.add(kneeCap);
  const kRing = ring(0.15, 0.016, M.glow); kRing.rotation.x = Math.PI / 2; kRing.position.y = -0.5; leg.add(kRing);
  const shin = new Mesh(new LatheGeometry([[0.001, -0.5], [0.15, -0.52], [0.17, -0.7], [0.21, -0.92], [0.001, -0.94]].map(([x, y]) => new Vector2(x, y)), 32), M.shell); leg.add(shin);
  const boot = capsule(0.19, 0.22, M.shell, 24); boot.rotation.x = Math.PI / 2; boot.scale.set(1.08, 1, 0.82); boot.position.set(0, -1.03, 0.1); leg.add(boot);
  const toe = ring(0.165, 0.02, M.gold); toe.rotation.x = Math.PI / 2; toe.scale.set(1.12, 1.5, 1); toe.position.set(0, -0.98, 0.12); leg.add(toe);
  const sole = ring(0.18, 0.014, M.glow); sole.rotation.x = Math.PI / 2; sole.scale.set(1.12, 1.62, 1); sole.position.set(0, -1.16, 0.1); leg.add(sole); // glowing sole rim
  return leg;
}

// Built as a generator: each `yield` is a point where the live mount lets the browser handle input (phones take
// several hundred ms for the whole model); the poster and dev renders run it straight through.
function* buildRobot(M) {
  const robot = new Group();
  const glowTex = glowTexture();
  const badge = badgeTexture();

  // ---- body: torso with chest lettering and back badge ----
  const body = new Group(); robot.add(body);
  const torsoG = new Group(); torsoG.scale.set(1, 1, 0.78); body.add(torsoG);
  torsoG.add(new Mesh(new LatheGeometry([[0.001, 0.58], [0.4, 0.56], [0.62, 0.42], [0.69, 0.16], [0.66, -0.18], [0.55, -0.48], [0.46, -0.62], [0.001, -0.62]].map(([x, y]) => new Vector2(x, y)), 64), M.shell));
  const chestMat = new MeshBasicMaterial({ map: chestTexture(), transparent: true, toneMapped: false, depthWrite: false });
  const chestText = new Mesh(new CylinderGeometry(0.7, 0.7, 0.42, 48, 1, true, -0.78, 1.56), chestMat); chestText.position.y = 0.13; torsoG.add(chestText);
  for (const y of [0.4, -0.15]) { const t = new Mesh(new CylinderGeometry(0.7, 0.7, 0.012, 48, 1, true, -0.95, 1.9), M.glow); t.position.y = y; torsoG.add(t); }
  const badgeMat = new MeshStandardMaterial({ map: badge.t, transparent: true, metalness: 0.25, roughness: 0.45 });
  const back = new Mesh(new CylinderGeometry(0.705, 0.705, 0.86, 48, 1, true, Math.PI - 0.62, 1.24), badgeMat); back.position.y = 0.0; torsoG.add(back);
  // side seams, belt and hips
  for (const side of [-1, 1]) { const s = new Mesh(new CylinderGeometry(0.695, 0.695, 0.7, 4, 1, true, side * 1.25 - 0.02, 0.04), M.glow); s.position.y = 0.0; torsoG.add(s); }
  const belt = ring(0.5, 0.045, M.gold, 64); belt.rotation.x = Math.PI / 2; belt.scale.set(1, 0.78, 1); belt.position.y = -0.55; body.add(belt);
  const pelvis = new Mesh(new SphereGeometry(0.47, 40, 24, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55), M.plate); pelvis.scale.set(1, 0.7, 0.74); pelvis.position.y = -0.55; body.add(pelvis);
  const collar = ring(0.36, 0.05, M.gold, 64); collar.rotation.x = Math.PI / 2; collar.scale.set(1, 0.78, 1); collar.position.y = 0.58; body.add(collar);

  yield;
  // ---- arms (robot's right = viewer's left is raised and pointing up) ----
  const armR = buildArm(M, -1, glowTex, true); armR.arm.position.set(-0.78, 0.3, 0); body.add(armR.arm);
  armR.arm.rotation.set(0.25, 0, -2.62); armR.elbow.rotation.z = -0.42;
  const armL = buildArm(M, 1, glowTex, false); armL.arm.position.set(0.78, 0.3, 0); body.add(armL.arm);
  armL.arm.rotation.set(-0.12, 0, 0.2); armL.elbow.rotation.x = -0.35;

  yield;
  // ---- legs and floor glow ----
  for (const side of [-1, 1]) { const leg = buildLeg(M); leg.position.set(side * 0.3, -0.78, 0); leg.rotation.z = side * 0.04; body.add(leg); }
  const floor = new Group(); floor.position.y = -2.0; robot.add(floor);
  const fade = radialTexture([[0, '#9a9a9a'], [0.35, '#6a6a6a'], [0.75, '#1c1c1c'], [1, '#000']]); // alpha maps read the green channel
  const floorMat = new MeshPhysicalMaterial({ color: 0x07080b, metalness: 0.8, roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.2, transparent: true, alphaMap: fade, depthWrite: false });
  const plate = new Mesh(new CircleGeometry(1.5, 64), floorMat); plate.rotation.x = -Math.PI / 2; plate.scale.set(1.2, 1, 1); plate.position.y = -0.01; floor.add(plate);
  const shadow = new Mesh(new CircleGeometry(0.9, 48), new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, alphaMap: radialTexture([[0, '#fff'], [0.5, '#888'], [1, '#000']]), depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.scale.set(1, 0.55, 1); floor.add(shadow);
  const floorGlow = new Sprite(new SpriteMaterial({ map: glowTex, color: 0xffb84a, transparent: true, opacity: 0.1, depthWrite: false, blending: AdditiveBlending })); floorGlow.scale.set(2.6, 0.5, 1); floor.add(floorGlow);

  // ---- neck ----
  const neck = new Group(); neck.position.y = 0.58; robot.add(neck);
  const neckCore = new Mesh(new CylinderGeometry(0.2, 0.24, 0.16, 32), M.matte); neckCore.position.y = 0.06; neck.add(neckCore);
  const nRing = ring(0.21, 0.016, M.glow); nRing.rotation.x = Math.PI / 2; nRing.position.y = 0.08; neck.add(nRing);

  yield;
  // ---- head (pivots at the top of the neck) ----
  const headPivot = new Group(); headPivot.position.y = 0.66; robot.add(headPivot);
  const head = new Group(); head.position.y = 0.9; head.scale.setScalar(1.13); headPivot.add(head);
  const S = new Group(); S.scale.set(1.12, 0.98, 1); head.add(S);
  const R = 0.92, VR = 0.932;
  S.add(new Mesh(new SphereGeometry(R, 64, 48), M.shell));
  // visor face: wide dark glass patch on the front of the helmet, framed with gold
  const VA = 1.02, VT0 = 0.98, VT1 = 1.92; // half width (rad), top and bottom (rad from crown)
  S.add(new Mesh(new SphereGeometry(VR, 64, 32, Math.PI / 2 - VA, 2 * VA, VT0, VT1 - VT0), M.visor));
  for (const th of [VT0 - 0.02, VT1 + 0.02]) S.add(new Mesh(new SphereGeometry(VR + 0.004, 64, 2, Math.PI / 2 - VA - 0.03, 2 * VA + 0.06, th - 0.018, 0.036), M.gold));
  for (const side of [-1, 1]) {
    const pts = []; for (let i = 0; i <= 12; i++) pts.push(sp(VR + 0.006, VT0 + (VT1 - VT0) * i / 12, side * (VA + 0.015)));
    S.add(new Mesh(new TubeGeometry(new CatmullRomCurve3(pts), 24, 0.018, 8), M.gold));
  }
  // crown seam
  S.add(new Mesh(new SphereGeometry(R + 0.004, 64, 2, 0, Math.PI * 2, 0.62, 0.018), M.glowDim));

  // eyes: LED-dot discs inside glowing gold rings; the bright pupil tracks the pointer
  const eyeTex = eyeTexture(), eyes = [];
  for (const side of [-1, 1]) {
    const pos = sp(VR + 0.012, 1.3, side * 0.36);
    const eye = new Group(); eye.position.copy(pos); eye.lookAt(pos.clone().multiplyScalar(3)); S.add(eye);
    eye.add(new Mesh(new CircleGeometry(0.2, 40), M.socket));
    const rim = ring(0.185, 0.02, M.eye, 48); rim.position.z = 0.005; eye.add(rim);
    const lid = new Group(); lid.position.z = 0.008; eye.add(lid);
    const dots = new Mesh(new CircleGeometry(0.165, 40), new MeshBasicMaterial({ map: eyeTex, transparent: true, toneMapped: false, depthWrite: false })); lid.add(dots);
    const iris = new Group(); iris.position.z = 0.006; lid.add(iris);
    const pupil = new Mesh(new CircleGeometry(0.07, 32), M.eyeCore); iris.add(pupil);
    const glow = new Sprite(new SpriteMaterial({ map: glowTex, color: 0xffc85a, transparent: true, opacity: 0.5, depthWrite: false, blending: AdditiveBlending }));
    glow.scale.set(0.62, 0.62, 1); glow.position.z = 0.02; lid.add(glow);
    eyes.push({ lid, iris });
  }
  // smile
  const smilePos = sp(VR + 0.01, 1.68, 0);
  const smile = new Group(); smile.position.copy(smilePos); smile.lookAt(smilePos.clone().multiplyScalar(3)); S.add(smile);
  const arc = new Mesh(new TorusGeometry(0.16, 0.016, 8, 32, Math.PI * 0.62), M.eye); arc.rotation.z = -Math.PI / 2 - Math.PI * 0.31; arc.position.y = 0.1; smile.add(arc);

  // headphone ear cups with glowing rings, joined by a band over the crown
  for (const side of [-1, 1]) {
    const cup = new Group(); cup.position.set(side * (R * 1.12 + 0.02), -0.02, 0); cup.rotation.z = side * -Math.PI / 2; head.add(cup);
    const shell = new Mesh(new CylinderGeometry(0.3, 0.33, 0.2, 40), M.shell); cup.add(shell);
    const gRim = ring(0.3, 0.03, M.gold, 48); gRim.rotation.x = Math.PI / 2; gRim.position.y = -0.1; cup.add(gRim);
    const lit = ring(0.21, 0.022, M.glow, 48); lit.rotation.x = Math.PI / 2; lit.position.y = -0.105; cup.add(lit);
    const hub = new Mesh(new CylinderGeometry(0.13, 0.13, 0.04, 32), M.plate); hub.position.y = -0.11; cup.add(hub);
  }
  const bandArc = new Mesh(new TorusGeometry(1.08, 0.055, 10, 64, Math.PI), M.plate); bandArc.scale.set(1, 0.95, 1); bandArc.position.y = -0.02; bandArc.rotation.y = 0.0; head.add(bandArc);
  const bandTrim = new Mesh(new TorusGeometry(1.08, 0.012, 6, 64, Math.PI), M.glowDim); bandTrim.scale.set(1, 0.95, 1); bandTrim.position.set(0, -0.02, 0.05); head.add(bandTrim);

  return { robot, body, neck, headPivot, head, eyes, armR, tip: armR.tip, floorGlow, glowTex, logoReady: badge.ready };
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
  const n = 18, pos = [];
  for (let i = 0; i < n; i++) pos.push(-4.2 + rnd() * 8.4, -1.4 + rnd() * 4.4, -2.5 - rnd() * 3); // behind the robot
  const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  return new Points(g, new PointsMaterial({ color: GOLD_BRIGHT, size: 0.32, map: tex, transparent: true, opacity: 0.16, depthWrite: false, blending: AdditiveBlending, sizeAttenuation: true }));
}

// ---------- scene assembly ----------
// Set-up is split into steps so the live mount can yield to the browser between them (no multi-second long task);
// the poster renders them back to back. No shadow map: it doubled the shader work for barely visible soft shadows.
function createRenderer({ width, height, pixelRatio, preserveDrawingBuffer = false, canvas, antialias = true }) {
  const renderer = new WebGLRenderer({ canvas, antialias, alpha: true, preserveDrawingBuffer, powerPreference: 'high-performance' });
  renderer.setPixelRatio(pixelRatio); renderer.setSize(width, height, false);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = ACESFilmicToneMapping; renderer.toneMappingExposure = 1.08;
  renderer.outputColorSpace = SRGBColorSpace;
  return renderer;
}
const nextTask = () => new Promise(r => setTimeout(r, 0)); // yield so input can be handled between set-up steps
const runSync = g => { let r; while (!(r = g.next()).done); return r.value; };
const runAsync = async g => { let r; while (!(r = g.next()).done) await nextTask(); return r.value; };
const ROBOT_X = 0.18, ROBOT_YAW = -0.1, ROBOT_SCREEN_X = 0.53; // world x offset, body turn, robot's horizontal position in the box
function buildScene(width, height) { return runSync(sceneSteps(width, height)); }
function* sceneSteps(width, height) {
  const scene = new Scene();
  const parts = yield* buildRobot(materials());
  parts.robot.position.set(ROBOT_X, -0.12, 0); parts.robot.rotation.y = ROBOT_YAW;
  scene.add(parts.robot);
  scene.add(new HemisphereLight(0xfff3dc, 0x0a0806, 0.45));
  const key = new DirectionalLight(0xfff0d2, 2.9); key.position.set(-3.5, 5, 6); scene.add(key);
  // rim lights behind the robot separate the dark silhouette from the dark page
  for (const [x, y, z, c, i] of [[-3.4, 2.8, -3.5, 0xfff0cc, 120], [3.6, 2.2, -3.5, 0xf0cf5a, 120], [0, 4.2, -3, 0xffe6b0, 55], [-2.2, -0.6, -2.4, 0xffb84a, 35]]) {
    const l = new PointLight(c, i, 14, 2); l.position.set(x, y, z); scene.add(l);
  }
  // front fills: one for the face, one low and wide so the dark torso keeps its form (no separate eye light — its
  // reflection showed as a bright dot between the eyes; the eyes glow on their own)
  const fill = new PointLight(0xffe2a8, 9, 10, 2); fill.position.set(2.5, 0.5, 5); scene.add(fill);
  const torsoFill = new PointLight(0xffe6b8, 16, 9, 2); torsoFill.position.set(-1.8, -1.6, 4.2); scene.add(torsoFill);
  const dots = particles(parts.glowTex); scene.add(dots);
  const camera = new PerspectiveCamera(26, width / height, 0.1, 60);
  camera.position.set(0, 0.3, 11.9); camera.lookAt(0, 0.0, 0);
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
  parts.head.position.y = 0.9 + Math.sin(t * 1.15 + 0.6) * 0.012;
  for (const e of parts.eyes) { e.iris.position.x = eyeX * 0.06; e.iris.position.y = eyeY * 0.04; e.lid.scale.y = 1 - blink * 0.92; }
  // the raised arm sways gently; the pointing fingertip and the floor glow pulse
  parts.armR.arm.rotation.z = -2.62 + Math.sin(t * 1.3) * 0.05; parts.armR.elbow.rotation.z = -0.42 + Math.sin(t * 1.3 + 0.8) * 0.04;
  const pulse = 0.78 + 0.22 * Math.sin(t * 2);
  parts.tip.userData.glow.material.opacity = 0.32 + 0.22 * pulse;
  parts.floorGlow.material.opacity = 0.07 + 0.04 * pulse;
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

// dev only: render the robot turned by bodyYaw (π = back view) once the logo badge is drawn
export async function renderView(size = 640, { bodyYaw = 0, ...p } = {}) {
  const canvas = document.createElement('canvas');
  const stage = createStage({ width: size, height: size, pixelRatio: 1, preserveDrawingBuffer: true, canvas });
  await stage.parts.logoReady;
  pose(stage, { ...POSTER_POSE, ...p }); stage.parts.robot.rotation.y = ROBOT_YAW + bodyYaw;
  stage.renderer.render(stage.scene, stage.camera);
  const url = canvas.toDataURL('image/png');
  stage.renderer.dispose();
  return url;
}

// ---------- live mount ----------
export async function mount(host) {
  const envPromise = decodeBakedEnvironment(ENV_URL).catch(() => null); // fetch + off-thread decode in parallel with set-up
  const setState = s => host.setAttribute('data-robot', s);
  const canvas = document.createElement('canvas');
  canvas.className = 'hero-robot-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const box = () => { const r = host.getBoundingClientRect(); return [Math.max(1, Math.round(r.width)), Math.max(1, Math.round(r.height))]; };
  let [w, h] = box();
  let renderer;
  await nextTask(); // the module has just been evaluated: let pending input run before creating the WebGL context
  const dpr = window.devicePixelRatio || 1, lite = !(window.matchMedia && window.matchMedia('(pointer: fine)').matches) || window.innerWidth < 1024;
  try { renderer = createRenderer({ width: w, height: h, pixelRatio: Math.min(dpr, lite ? 1.5 : 2), antialias: !lite || dpr < 2, canvas }); }
  catch (e) { setState('unsupported'); return null; }
  await nextTask();
  const stage = { renderer, ...(await runAsync(sceneSteps(w, h))) };
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
  await Promise.race([stage.parts.logoReady, new Promise(r => setTimeout(r, 2500))]); // back badge texture (never blocks > 2.5 s)
  // compile every shader before the first frame; uses KHR_parallel_shader_compile where available (non-blocking)
  try { await renderer.compileAsync(stage.scene, stage.camera); } catch (e) {}
  await nextTask();
  const units = [...stage.parts.robot.children.filter(c => c !== stage.parts.body), ...stage.parts.body.children], per = Math.ceil(units.length / 4);
  for (let i = 0; i < units.length; i += per) {
    units.forEach((u, k) => { u.visible = k >= i && k < i + per; });
    try { renderer.render(stage.scene, stage.camera); } catch (e) {}
    await nextTask();
  }
  units.forEach(u => { u.visible = true; });
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
    const cx = r.left + r.width * ROBOT_SCREEN_X, cy = r.top + r.height * 0.35;
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
