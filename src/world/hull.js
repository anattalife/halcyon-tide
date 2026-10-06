// Hull shell, livery, name boards, lifeboats, funnel, mast and other exterior equipment.
import * as THREE from 'three';
import { SHIP, deckY } from '../core/config.js';
import { hullHalf, stemX, transomX, superLimits } from './hullShape.js';
import { canvasTexture } from './textures.js';
import { shared } from './materials.js';

const HULL_TOP = deckY(5);   // hull plating runs up to the promenade deck

export function buildHull() {
  const group = new THREE.Group(); group.name = 'hull';
  // ── lofted shell ───────────────────────────────────────────────────────
  const ys = [];
  for (let y = SHIP.keelY; y < HULL_TOP - 1e-3; y += 0.5) ys.push(y);
  ys.push(HULL_TOP);
  const NU = 220;
  const pos = [], nor = [], idxs = [];
  const sideVerts = (sgn) => {
    const base = pos.length / 3;
    for (let r = 0; r < ys.length; r++) {
      const y = ys[r]; const tx = transomX(y) + 0.02, sx = stemX(y) - 0.02;
      for (let k = 0; k <= NU; k++) {
        let u = k / NU;
        u = u < 0.6 ? u : 0.6 + (u - 0.6);   // linear
        const x = tx + (sx - tx) * u;
        const h = hullHalf(x, y);
        pos.push(x, y, sgn * h);
        nor.push(0, 0, sgn);
      }
    }
    for (let r = 0; r < ys.length - 1; r++) for (let k = 0; k < NU; k++) {
      const a = base + r * (NU + 1) + k, b = a + 1, c = a + NU + 1, d = c + 1;
      if (sgn > 0) idxs.push(a, b, d, a, d, c); else idxs.push(a, d, b, a, c, d);
    }
    return base;
  };
  const sb = sideVerts(1), pb = sideVerts(-1);
  // transom (u=0) closing quads, faces -x
  for (let r = 0; r < ys.length - 1; r++) {
    const a = sb + r * (NU + 1), b = pb + r * (NU + 1), c = sb + (r + 1) * (NU + 1), d = pb + (r + 1) * (NU + 1);
    idxs.push(a, c, b, b, c, d);
  }
  // bottom (keel row) faces -y
  for (let k = 0; k < NU; k++) { const a = sb + k, b = sb + k + 1, c = pb + k, d = pb + k + 1; idxs.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idxs);
  g.computeVertexNormals();
  const hullMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.32, metalness: 0.15, envMapIntensity: 0.9 });
  // Livery + hull openings. Windows are framed (light alloy frame, dark tinted glass reflecting a sky gradient, a little
  // specular) and grouped like a real hull: deck 3 portholes in pairs, deck 4 windows in pairs per cabin module; faint
  // plate seams + a shadow line under the sheer strake break up the flat white.
  hullMat.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = shared.uNight;
    sh.vertexShader = 'varying vec3 vWP;\nvarying vec3 vWN;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix * vec4(transformed,1.0)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = 'varying vec3 vWP;\nvarying vec3 vWN;\nuniform float uNight;\n' + `
float hwH(float x){ return fract(sin(x * 91.7) * 437.5); }
// returns vec3(glass mask, frame mask, lit flag)
vec3 hullWin(vec3 p){
  float yy = p.y;
  vec3 r = vec3(0.0);
  if (p.x > -150.0 && p.x < 128.0 && yy > 3.5 && yy < 5.0) {
    float m = mod(p.x + 3.5, 7.0) - 3.5;
    float c = abs(m) - 1.05;
    vec2 q = vec2(abs(c), abs(yy - 4.25));
    vec2 hs = vec2(0.62, 0.42);
    vec2 dd = max(q - hs + 0.12, 0.0);
    float sd = length(dd) - 0.12 + min(max(q.x - hs.x, q.y - hs.y) + 0.12, 0.0);
    float glass = 1.0 - smoothstep(-0.01, 0.01, sd);
    float frame = (1.0 - smoothstep(0.05, 0.07, sd)) * (1.0 - glass);
    float lit = step(0.45, hwH(floor((p.x + 3.5) / 7.0) * 2.0 + step(0.0, m) + 13.1));
    r = vec3(glass, frame, lit);
  }
  if (abs(p.x) < 150.0 && yy > 1.35 && yy < 2.2) {
    float m = mod(p.x + 2.4, 4.8) - 2.4;
    float c = abs(m) - 0.7;
    float d = length(vec2(c, yy - 1.75));
    float glass = 1.0 - smoothstep(0.23, 0.245, d);
    float frame = (1.0 - smoothstep(0.29, 0.305, d)) * (1.0 - glass);
    float lit = step(0.5, hwH(floor((p.x + 2.4) / 4.8) * 2.0 + step(0.0, m) + 7.0));
    r = max(r, vec3(glass, frame, lit));
  }
  return r;
}
` + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      float yy = vWP.y;
      vec3 navy = vec3(0.035, 0.085, 0.14);
      vec3 teal = vec3(0.05, 0.36, 0.40);
      vec3 white = vec3(0.93, 0.93, 0.92);
      vec3 red = vec3(0.36, 0.07, 0.06);
      vec3 col = white;
      float seam = (1.0 - smoothstep(0.0, 0.025, abs(mod(yy + 0.3, 2.4) - 1.2) - 1.17)) * 0.5 + (1.0 - smoothstep(0.0, 0.02, abs(mod(vWP.x, 9.6) - 4.8) - 4.78)) * 0.35;
      col *= 1.0 - 0.06 * seam;
      if (yy < 1.0) col = navy * (1.0 - 0.15 * seam);
      if (yy > 1.0 && yy < 1.25) col = vec3(0.78,0.62,0.30);
      if (yy > 1.25 && yy < 1.4) col *= 0.82;
      if (yy < -1.6) col = vec3(0.04,0.04,0.045);
      if (yy < -2.4) col = red;
      if (yy > 4.95 && yy < 5.55) col = teal;
      if (yy > 5.55 && yy < 5.7) col = vec3(0.82,0.84,0.85);
      vec3 hw = hullWin(vWP);
      if (hw.x + hw.y > 0.001) {
        vec3 Vd = normalize(cameraPosition - vWP);
        float up = clamp(reflect(-Vd, normalize(vWN)).y * 0.5 + 0.5, 0.0, 1.0);
        vec3 glassC = mix(vec3(0.03, 0.05, 0.07), vec3(0.22, 0.3, 0.38), up * (1.0 - uNight));
        glassC = mix(glassC, vec3(1.0, 0.78, 0.5) * 0.25, hw.z * uNight * 0.9);
        col = mix(col, glassC, hw.x);
        col = mix(col, vec3(0.72, 0.74, 0.76), hw.y);
      }
      diffuseColor.rgb = col;
      `).replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      if (vWP.y < -1.6) roughnessFactor = 0.7;
      { vec3 hwr = hullWin(vWP); roughnessFactor = mix(roughnessFactor, 0.06, hwr.x); }`).replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      { vec3 hwe = hullWin(vWP); totalEmissiveRadiance += vec3(1.0,0.75,0.45) * hwe.x * hwe.z * uNight * 0.9; }`);
  };
  hullMat.customProgramCacheKey = () => 'hullLivery';
  const hull = new THREE.Mesh(g, hullMat);
  hull.castShadow = true; hull.receiveShadow = true; hull.name = 'hullShell';
  group.add(hull);

  // ── name boards (conforming strips) ─────────────────────────────────────
  const nameTex = canvasTexture(2048, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.font = '700 170px Georgia, "Times New Roman", serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f2ead8'; ctx.fillText('HALCYON  TIDE', w / 2, h / 2 + 6);
  });
  for (const sgn of [1, -1]) {
    const strip = conformingStrip(sgn, 118, 146, 2.0, 3.6, 0.04);
    const m = new THREE.Mesh(strip, new THREE.MeshStandardMaterial({ map: nameTex, transparent: true, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -4, depthWrite: false }));
    if (sgn < 0) { m.geometry = conformingStrip(sgn, 118, 146, 2.0, 3.6, 0.04, true); }
    group.add(m);
  }
  const sternTex = canvasTexture(2048, 512, (ctx, w, h) => {
    ctx.font = '700 190px Georgia, serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#f2ead8';
    ctx.fillText('HALCYON TIDE', w / 2, 230); ctx.font = '600 110px Georgia, serif'; ctx.fillText('NASSAU', w / 2, 400);
  });
  const sternPlane = new THREE.Mesh(new THREE.PlaneGeometry(16, 4), new THREE.MeshStandardMaterial({ map: sternTex, transparent: true, roughness: 0.4, depthWrite: false }));
  sternPlane.position.set(-165.05, 2.6, 0); sternPlane.rotation.y = -Math.PI / 2; group.add(sternPlane);

  group.add(buildLifeboats());
  group.add(buildFunnel());
  group.add(buildMast());
  group.add(buildBowGear());
  return group;
}

function conformingStrip(sgn, x0, x1, y0, y1, off, flip = false) {
  const N = 48, pos = [], uv = [], ind = [];
  for (let k = 0; k <= N; k++) {
    const x = x0 + (x1 - x0) * k / N;
    for (const [r, y] of [[0, y0], [1, y1]]) {
      const h = hullHalf(x, y);
      pos.push(x, y, sgn * (h + off));
      uv.push(flip ? 1 - k / N : k / N, r);
    }
  }
  for (let k = 0; k < N; k++) { const a = k * 2, b = a + 1, c = a + 2, d = a + 3; if (sgn > 0) ind.push(a, c, d, a, d, b); else ind.push(a, d, c, a, b, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(ind); g.computeVertexNormals();
  return g;
}

function lifeboatGeometry() {
  // Enclosed lifeboat: rounded hull + canopy. 10.8 m × 3.9 m × 3.3 m
  const L = 10.8, W = 3.9;
  const lower = new THREE.CylinderGeometry(1, 1, L, 24, 1, false, 0, Math.PI);
  lower.rotateZ(Math.PI / 2); lower.rotateX(Math.PI / 2);
  lower.scale(1, 1.25, W / 2);
  const g1 = lower;
  const upper = new THREE.CapsuleGeometry(1, L - 2.0, 6, 16);
  upper.rotateZ(Math.PI / 2); upper.scale(1, 0.95, W / 2 * 0.98); upper.translate(0, 0.35, 0);
  return { lower: g1, upper };
}

function buildLifeboats() {
  const grp = new THREE.Group(); grp.name = 'lifeboats';
  const { lower, upper } = lifeboatGeometry();
  const orange = new THREE.MeshStandardMaterial({ color: 0xf26a1b, roughness: 0.45 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf1efe9, roughness: 0.4 });
  const davitMat = new THREE.MeshStandardMaterial({ color: 0xd9dbd9, roughness: 0.5, metalness: 0.3 });
  const xs = []; for (let x = -118; x <= 82; x += 12.5) { if (Math.abs(x - -10) < 9) continue; xs.push(x); }
  const n = xs.length * 2;
  const mL = new THREE.InstancedMesh(lower, orange, n), mU = new THREE.InstancedMesh(upper, white, n);
  // Davits: a post standing on the deck-5 promenade edge, an arm sloping out over the boat, and two falls (wires)
  // down to the canopy, so the arm visibly carries the boat (previously a short box floated above each boat).
  const davit = new THREE.BoxGeometry(0.35, 4.3, 0.35).translate(0, 2.15, 0);
  const arm = new THREE.BoxGeometry(0.28, 0.32, 2.9).translate(0, 0, 1.45);
  const fall = new THREE.CylinderGeometry(0.025, 0.025, 1, 6).translate(0, -0.5, 0);
  const mD = new THREE.InstancedMesh(davit, davitMat, n * 2), mA = new THREE.InstancedMesh(arm, davitMat, n * 2);
  const wireMat = new THREE.MeshStandardMaterial({ color: 0x333638, roughness: 0.5, metalness: 0.6 });
  const mF = new THREE.InstancedMesh(fall, wireMat, n * 2);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pv = new THREE.Vector3(), sv = new THREE.Vector3(1, 1, 1);
  let k = 0, kd = 0;
  const yDeck = deckY(5), yTop = yDeck + 4.3, boatTop = yDeck + 2.0 + 1.3;
  for (const x of xs) for (const s of [1, -1]) {
    const z = s * 22.9, y = yDeck + 2.0;
    m4.makeTranslation(x, y, z); mL.setMatrixAt(k, m4); mU.setMatrixAt(k, m4); k++;
    for (const o of [-4.2, 4.2]) {
      m4.makeTranslation(x + o, yDeck, s * 20.2); mD.setMatrixAt(kd, m4);
      // arm from the post head outward (+z for starboard), drooping 12°
      q.setFromEuler(new THREE.Euler(s * 0.21, s > 0 ? 0 : Math.PI, 0)); pv.set(x + o, yTop - 0.1, s * 20.2); sv.set(1, 1, 1);
      m4.compose(pv, q, sv); mA.setMatrixAt(kd, m4);
      const tipY = yTop - 0.1 - Math.sin(0.21) * 2.75;
      q.identity(); pv.set(x + o * 0.92, tipY, z); sv.set(1, Math.max(0.2, tipY - boatTop), 1);
      m4.compose(pv, q, sv); mF.setMatrixAt(kd, m4);
      kd++;
    }
  }
  for (const m of [mL, mU, mD, mA]) { m.castShadow = true; m.receiveShadow = true; grp.add(m); }
  mF.castShadow = false; grp.add(mF);
  grp.userData.boats = xs.flatMap(x => [{ x, z: 22.9 }, { x, z: -22.9 }]);
  return grp;
}

function buildFunnel() {
  const grp = new THREE.Group(); grp.name = 'funnel';
  // swept elliptical funnel aft
  const shape = new THREE.Shape();
  const a = 13, b = 6.5;
  for (let k = 0; k <= 48; k++) { const t = k / 48 * Math.PI * 2; const x = Math.cos(t) * a * (Math.cos(t) < 0 ? 1.0 : 0.82), z = Math.sin(t) * b * (Math.cos(t) < 0 ? 0.75 : 1); k ? shape.lineTo(x, z) : shape.moveTo(x, z); }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 14, bevelEnabled: true, bevelThickness: 0.5, bevelSize: 0.5, bevelSegments: 3, steps: 6 });
  geo.rotateX(-Math.PI / 2);
  // shear the top aft for a raked look
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setX(i, p.getX(i) - y * 0.22); }
  geo.computeVertexNormals();
  const logoTex = canvasTexture(1024, 1024, (ctx, w, h) => {
    ctx.fillStyle = '#0e3a52'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#e8d9b0'; ctx.fillRect(0, h * 0.12, w, 22); ctx.fillRect(0, h * 0.88, w, 22);
    // stylised larkspur: stacked florets on a stem
    ctx.translate(w / 2, h / 2);
    ctx.strokeStyle = '#e8d9b0'; ctx.lineWidth = 16; ctx.beginPath(); ctx.moveTo(0, 260); ctx.quadraticCurveTo(20, 0, 0, -280); ctx.stroke();
    for (let k = 0; k < 7; k++) {
      const yy = 180 - k * 70, r = 60 - k * 6;
      for (const s of [-1, 1]) { ctx.fillStyle = k % 2 ? '#7fb8d6' : '#a9d3e8'; ctx.beginPath(); ctx.ellipse(s * r * 0.9, yy, r, r * 0.55, s * 0.5, 0, Math.PI * 2); ctx.fill(); }
    }
  });
  const mat = new THREE.MeshStandardMaterial({ color: 0x0e3a52, roughness: 0.35, metalness: 0.2 });
  const f = new THREE.Mesh(geo, mat);
  f.position.set(-103, deckY(16) + 3.0, 0); f.castShadow = true; grp.add(f);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 2.5, 16), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8 }));
  for (const z of [-2.5, 0, 2.5]) { const c = cap.clone(); c.position.set(-108 - 3, deckY(16) + 3 + 15.3, z); grp.add(c); }
  // logo discs on both sides
  for (const s of [1, -1]) {
    const lg = new THREE.Mesh(new THREE.CircleGeometry(4.5, 48), new THREE.MeshStandardMaterial({ map: logoTex, roughness: 0.4 }));
    lg.position.set(-104.5, deckY(16) + 10.5, s * 6.62); lg.rotation.y = s > 0 ? 0 : Math.PI; grp.add(lg);
  }
  grp.userData.exhaust = new THREE.Vector3(-111, deckY(16) + 19, 0);
  return grp;
}

function buildMast() {
  const grp = new THREE.Group(); grp.name = 'mast';
  const mat = new THREE.MeshStandardMaterial({ color: 0xf2f2f0, roughness: 0.4 });
  const top = deckY(17) + 3;
  const mast = new THREE.Mesh(new THREE.BoxGeometry(1.4, 9, 1.4), mat); mast.position.set(96, top + 4.5, 0); mast.castShadow = true; grp.add(mast);
  const yard = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.5, 14), mat); yard.position.set(96, top + 7.5, 0); grp.add(yard);
  const domeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
  for (const z of [-5.5, 5.5]) { const dm = new THREE.Mesh(new THREE.SphereGeometry(1.4, 24, 16), domeMat); dm.position.set(94, top + 1.4, z); grp.add(dm); }
  const radarMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5 });
  const radars = [];
  for (const [y, len] of [[top + 9.6, 5], [top + 8.2, 3.5]]) {
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.3, len), radarMat); r.position.set(96, y, 0); grp.add(r); radars.push(r);
  }
  grp.userData.radars = radars;
  // navigation lights
  const lightGeo = new THREE.SphereGeometry(0.18, 8, 8);
  const mk = (c, x, y, z) => { const m = new THREE.Mesh(lightGeo, new THREE.MeshBasicMaterial({ color: c, toneMapped: false })); m.position.set(x, y, z); grp.add(m); return m; };
  grp.userData.navLights = [mk(0xffffff, 96, top + 9.2, 0), mk(0x00ff40, 123, deckY(13) + 2.6, 24.6), mk(0xff2020, 123, deckY(13) + 2.6, -24.6), mk(0xffffff, -164.5, deckY(9), 0)];
  return grp;
}

function buildBowGear() {
  const grp = new THREE.Group(); grp.name = 'bowgear';
  const mat = new THREE.MeshStandardMaterial({ color: 0x2b3a2f, roughness: 0.6, metalness: 0.4 });
  const y = deckY(6);
  const winch = new THREE.CylinderGeometry(0.6, 0.6, 1.6, 16); winch.rotateX(Math.PI / 2);
  for (const z of [-5, 5]) { const w = new THREE.Mesh(winch, mat); w.position.set(146, y + 0.8, z); w.castShadow = true; grp.add(w); }
  const boll = new THREE.CylinderGeometry(0.22, 0.25, 0.6, 12);
  for (const [x, z] of [[140, 9], [140, -9], [152, 6], [152, -6], [158, 2.5], [158, -2.5]]) { const b = new THREE.Mesh(boll, mat); b.position.set(x, y + 0.3, z); grp.add(b); b.castShadow = true; }
  // anchors on the hull flare
  const anc = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.6, 0.3), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6, metalness: 0.5 }));
  for (const s of [1, -1]) { const a = anc.clone(); const x = 148; a.position.set(x, 3.0, s * (hullHalf(x, 3.0) + 0.1)); a.rotation.y = s * 0.45; grp.add(a); }
  return grp;
}
