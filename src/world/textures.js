// Procedural material library. All surface textures are painted at load time onto
// canvases and packed into WebGL2 texture arrays (one layer per finish), so a whole
// deck's floors / walls / ceilings render with a single material each.
import * as THREE from 'three';
import { Rng } from '../core/util.js';

const S = 512;

function cnv(w = S, h = S) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

// value noise for organic variation
function noiseCanvas(ctx, w, h, rng, alpha, scale, color = '0,0,0') {
  const g = ctx;
  for (let k = 0; k < scale; k++) {
    const x = rng.next() * w, y = rng.next() * h, r = 4 + rng.next() * 40;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, `rgba(${color},${alpha * rng.next()})`); grd.addColorStop(1, `rgba(${color},0)`);
    g.fillStyle = grd; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
}
function speckle(ctx, w, h, rng, n, a, light = false) {
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = (rng.next() - 0.5) * a;
    d[i] = Math.max(0, Math.min(255, d[i] + v)); d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + v)); d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + v));
  }
  ctx.putImageData(img, 0, 0);
}
// make an image tile seamlessly by blending edges — painting routines are already periodic by construction where it matters

// ── FLOORS ─────────────────────────────────────────────────────────────────
function carpet(ctx, rng, base, accent, motif, border = null) {
  ctx.fillStyle = base; ctx.fillRect(0, 0, S, S);
  noiseCanvas(ctx, S, S, rng, 0.08, 120);
  ctx.save();
  if (motif === 'wave') {
    ctx.strokeStyle = accent; ctx.lineWidth = 6;
    for (let row = 0; row < 4; row++) {
      ctx.beginPath();
      for (let x = 0; x <= S; x += 4) { const y = row * 128 + 64 + Math.sin(x / S * Math.PI * 4) * 22; x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
      ctx.stroke();
    }
  } else if (motif === 'compass') {
    for (const [cx, cy] of [[128, 128], [384, 384], [384, 128], [128, 384]]) {
      ctx.translate(cx, cy);
      ctx.fillStyle = accent;
      for (let k = 0; k < 8; k++) { ctx.rotate(Math.PI / 4); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(10, 0); ctx.lineTo(0, k % 2 ? 34 : 54); ctx.closePath(); ctx.fill(); }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
  } else if (motif === 'casino') {
    const cols = [accent, '#d9a63a', '#1d6f6a', '#5e1f6b'];
    for (let k = 0; k < 90; k++) {
      const x = rng.next() * S, y = rng.next() * S, r = 6 + rng.next() * 22;
      ctx.fillStyle = cols[k % 4]; ctx.globalAlpha = 0.85;
      ctx.beginPath(); if (k % 3 === 0) ctx.arc(x, y, r, 0, Math.PI * 2); else { ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); }
      ctx.fill();
      // wrap
      for (const [ox, oy] of [[S, 0], [-S, 0], [0, S], [0, -S]]) { ctx.beginPath(); ctx.arc(x + ox, y + oy, k % 3 === 0 ? r : 0, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
  } else if (motif === 'dots') {
    ctx.fillStyle = accent;
    for (let y = 16; y < S; y += 32) for (let x = (y / 32 % 2) * 16 + 16; x < S; x += 32) { ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill(); }
  } else if (motif === 'lattice') {
    ctx.strokeStyle = accent; ctx.lineWidth = 3;
    for (let k = -S; k < S * 2; k += 64) { ctx.beginPath(); ctx.moveTo(k, 0); ctx.lineTo(k + S, S); ctx.stroke(); ctx.beginPath(); ctx.moveTo(k, S); ctx.lineTo(k + S, 0); ctx.stroke(); }
  } else if (motif === 'swirl') {
    ctx.strokeStyle = accent; ctx.lineWidth = 4;
    for (let k = 0; k < 4; k++) { const cx = (k % 2) * 256 + 128, cy = Math.floor(k / 2) * 256 + 128; ctx.beginPath(); for (let a = 0; a < 14; a += 0.1) { const r = a * 7; ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); } ctx.stroke(); }
  }
  ctx.restore();
  if (border) { ctx.fillStyle = border; ctx.fillRect(0, 0, S, 10); ctx.fillRect(0, S - 10, S, 10); }
  speckle(ctx, S, S, rng, 0, 22);
}

function planks(ctx, rng, cols, plankW, seam, length = 4) {
  const n = Math.round(S / plankW);
  for (let k = 0; k < n; k++) {
    let y = 0;
    const off = rng.next() * S;
    const segs = [];
    for (let s = 0; s < length; s++) segs.push(S / length);
    let x = -off;
    while (x < S) {
      const L = S / length * (0.6 + rng.next() * 0.8);
      const c = cols[Math.floor(rng.next() * cols.length)];
      ctx.fillStyle = c; ctx.fillRect(x, k * plankW, L, plankW);
      ctx.fillStyle = c; ctx.fillRect(x + S, k * plankW, L, plankW);
      // grain
      ctx.strokeStyle = 'rgba(0,0,0,0.08)'; ctx.lineWidth = 1;
      for (let g = 0; g < 4; g++) { ctx.beginPath(); const gy = k * plankW + rng.next() * plankW; ctx.moveTo(x, gy); ctx.bezierCurveTo(x + L * 0.3, gy + 3, x + L * 0.6, gy - 3, x + L, gy); ctx.stroke(); }
      ctx.fillStyle = seam; ctx.fillRect(x, k * plankW, 2, plankW);
      x += L;
    }
    ctx.fillStyle = seam; ctx.fillRect(0, k * plankW + plankW - 3, S, 3);
  }
  speckle(ctx, S, S, rng, 0, 14);
}

function marble(ctx, rng, base, vein, tiles = 3, grout = 'rgba(0,0,0,0.25)') {
  ctx.fillStyle = base; ctx.fillRect(0, 0, S, S);
  noiseCanvas(ctx, S, S, rng, 0.12, 200, '120,110,100');
  ctx.strokeStyle = vein; ctx.lineCap = 'round';
  for (let k = 0; k < 26; k++) {
    ctx.lineWidth = 0.6 + rng.next() * 2.2; ctx.globalAlpha = 0.25 + rng.next() * 0.5;
    ctx.beginPath(); let x = rng.next() * S, y = rng.next() * S; ctx.moveTo(x, y);
    for (let s = 0; s < 12; s++) { x += (rng.next() - 0.3) * 50; y += (rng.next() - 0.5) * 40; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const t = S / tiles; ctx.fillStyle = grout;
  for (let k = 0; k <= tiles; k++) { ctx.fillRect(k * t - 1, 0, 2, S); ctx.fillRect(0, k * t - 1, S, 2); }
}

function tiles(ctx, rng, cols, n, grout, bevel = true) {
  const t = S / n;
  ctx.fillStyle = grout; ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    ctx.fillStyle = cols[Math.floor(rng.next() * cols.length)];
    ctx.fillRect(i * t + 2, j * t + 2, t - 4, t - 4);
    if (bevel) { ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(i * t + 2, j * t + 2, t - 4, 3); ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(i * t + 2, j * t + t - 5, t - 4, 3); }
  }
  speckle(ctx, S, S, rng, 0, 10);
}

function diamondPlate(ctx, rng) {
  ctx.fillStyle = '#7c8186'; ctx.fillRect(0, 0, S, S);
  noiseCanvas(ctx, S, S, rng, 0.25, 150, '60,50,40');
  for (let y = 0; y < S; y += 32) for (let x = 0; x < S; x += 32) {
    const o = (y / 32) % 2 ? 16 : 0;
    ctx.save(); ctx.translate(x + o + 8, y + 16); ctx.rotate(((x / 32 + y / 32) % 2 ? 1 : -1) * 0.7);
    ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(-9, -2, 18, 3); ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(-9, 1, 18, 2);
    ctx.restore();
  }
  speckle(ctx, S, S, rng, 0, 18);
}

function vinyl(ctx, rng, base) {
  ctx.fillStyle = base; ctx.fillRect(0, 0, S, S);
  const img = ctx.getImageData(0, 0, S, S), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (rng.next() < 0.04) { const v = rng.next() < 0.5 ? -40 : 40; d[i] += v; d[i + 1] += v; d[i + 2] += v; }
  }
  ctx.putImageData(img, 0, 0);
  noiseCanvas(ctx, S, S, rng, 0.06, 60);
  ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(0, 0, S, 1); ctx.fillRect(0, 0, 1, S);
}

function herringbone(ctx, rng) {
  ctx.fillStyle = '#6b4526'; ctx.fillRect(0, 0, S, S);
  const L = 128, W = 32;
  const cols = ['#8a5a33', '#7b4f2b', '#946238', '#6f4727', '#865732'];
  for (let y = -S; y < S * 2; y += W) for (let x = -S; x < S * 2; x += L) {
    for (const dir of [0, 1]) {
      ctx.save(); ctx.translate(x + dir * W + (y / W) * W % L, y); ctx.rotate(dir ? Math.PI / 4 : -Math.PI / 4);
      ctx.fillStyle = cols[Math.floor(rng.next() * cols.length)]; ctx.fillRect(0, 0, L * 0.7, W * 0.7);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1.5; ctx.strokeRect(0, 0, L * 0.7, W * 0.7);
      ctx.restore();
    }
  }
  speckle(ctx, S, S, rng, 0, 12);
}

function dance(ctx, rng) {
  const t = S / 4;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    ctx.fillStyle = (i + j) % 2 ? '#141018' : '#1d1424'; ctx.fillRect(i * t, j * t, t, t);
    ctx.strokeStyle = 'rgba(160,120,255,0.55)'; ctx.lineWidth = 3; ctx.strokeRect(i * t + 3, j * t + 3, t - 6, t - 6);
  }
}

// ── WALLS (each tile = 2 m wide × 3 m tall, v=0 at floor) ───────────────────
const WH = 3.0;
const wy = (m) => S - (m / WH) * S;   // metres above floor → canvas y

function wallBase(ctx, color, rng, noise = 0.05) { ctx.fillStyle = color; ctx.fillRect(0, 0, S, S); noiseCanvas(ctx, S, S, rng, noise, 80); }
function baseboard(ctx, color, h = 0.12) { ctx.fillStyle = color; ctx.fillRect(0, wy(h), S, S - wy(h)); ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(0, wy(h), S, 2); }
function rail(ctx, color, at = 0.95, h = 0.05) { ctx.fillStyle = color; ctx.fillRect(0, wy(at + h), S, (h / WH) * S); ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, wy(at), S, 2); }
function panels(ctx, x0, x1, y0, y1, n, stroke, fill = null) {
  const w = (x1 - x0) / n;
  for (let k = 0; k < n; k++) {
    const a = x0 + k * w + 10, b = a + w - 20;
    if (fill) { ctx.fillStyle = fill; ctx.fillRect(a, wy(y1), b - a, wy(y0) - wy(y1)); }
    ctx.strokeStyle = stroke; ctx.lineWidth = 3; ctx.strokeRect(a, wy(y1), b - a, wy(y0) - wy(y1));
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1; ctx.strokeRect(a + 3, wy(y1) + 3, b - a - 6, wy(y0) - wy(y1) - 6);
  }
}
function woodGrain(ctx, rng, cols, vertical = false) {
  for (let k = 0; k < 400; k++) {
    ctx.strokeStyle = cols[k % cols.length]; ctx.globalAlpha = 0.08 + rng.next() * 0.12; ctx.lineWidth = 1 + rng.next() * 3;
    ctx.beginPath();
    if (vertical) { const x = rng.next() * S; ctx.moveTo(x, 0); ctx.bezierCurveTo(x + 8, S / 3, x - 8, S * 2 / 3, x, S); }
    else { const y = rng.next() * S; ctx.moveTo(0, y); ctx.bezierCurveTo(S / 3, y + 6, S * 2 / 3, y - 6, S, y); }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function paintFloor(k, ctx, rng) {
  switch (k) {
    case 0: carpet(ctx, rng, '#26344f', '#3a5677', 'wave'); break;           // corridor
    case 1: carpet(ctx, rng, '#8b7a66', '#9c8a74', 'dots'); break;                        // cabin
    case 2: carpet(ctx, rng, '#3a0f22', '#b0273e', 'casino'); break;                      // casino
    case 3: carpet(ctx, rng, '#5a1418', '#7d2329', 'lattice'); break;                     // theater
    case 4: planks(ctx, rng, ['#a9764a', '#b27f50', '#9c6b41', '#b88757', '#a5734a'], 32, '#2a1f17', 2); break; // teak
    case 5: marble(ctx, rng, '#e8e2d8', '#8c8478', 3); break;                             // marble
    case 6: tiles(ctx, rng, ['#e7e9ea', '#dfe2e3', '#eceeee'], 6, '#b9bec0'); break;      // white tile
    case 7: vinyl(ctx, rng, '#8e9a96'); break;                                              // crew vinyl
    case 8: diamondPlate(ctx, rng); break;                                                  // steel
    case 9: tiles(ctx, rng, ['#2f8fb0', '#2b84a6', '#3a9bbb', '#26799b', '#45a8c4'], 16, '#d8f0f4', false); break; // pool
    case 10: ctx.fillStyle = '#3d6b55'; ctx.fillRect(0, 0, S, S); speckle(ctx, S, S, rng, 0, 30); break; // rubber
    case 11: herringbone(ctx, rng); break;                                                  // parquet
    case 12: carpet(ctx, rng, '#4a3328', '#6a4a35', 'swirl'); break;                       // lounge
    case 13: tiles(ctx, rng, ['#cfc7bb', '#d6cfc4'], 8, '#9d968c'); break;                 // bath
    case 14: ctx.fillStyle = '#4f6f5a'; ctx.fillRect(0, 0, S, S); noiseCanvas(ctx, S, S, rng, 0.2, 120); speckle(ctx, S, S, rng, 0, 20); break; // deck paint
    case 15: dance(ctx, rng); break;
  }
}

function paintWall(k, ctx, rng) {
  switch (k) {
    case 0: wallBase(ctx, '#e9dfcc', rng); panels(ctx, 0, S, 1.0, 2.25, 2, 'rgba(120,95,60,0.35)'); rail(ctx, '#6b4a2e', 0.95); baseboard(ctx, '#4e3522', 0.14); ctx.fillStyle = '#d8ccb4'; ctx.fillRect(0, 0, S, wy(2.42)); break;
    case 1: wallBase(ctx, '#ddd2c0', rng, 0.03); for (let x = 0; x < S; x += 32) { ctx.fillStyle = 'rgba(150,130,100,0.10)'; ctx.fillRect(x, 0, 12, S); } baseboard(ctx, '#5a4030', 0.1); break;
    case 2: wallBase(ctx, '#6e4628', rng); woodGrain(ctx, rng, ['#3e2412', '#8a5a35', '#2f1b0d'], true); for (let x = 0; x <= S; x += S / 2) { ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(x - 2, 0, 4, S); } ctx.fillStyle = '#b08d57'; ctx.fillRect(0, wy(2.3), S, 6); baseboard(ctx, '#2a190d', 0.12); break;
    case 3: marble(ctx, rng, '#efe9df', '#a39a8a', 2, 'rgba(0,0,0,0.12)'); baseboard(ctx, '#3a3530', 0.1); break;
    case 4: wallBase(ctx, '#d8dcd8', rng, 0.04); ctx.fillStyle = '#2d5e86'; ctx.fillRect(0, wy(1.15), S, (0.08 / WH) * S); ctx.fillStyle = '#9aa29e'; ctx.fillRect(0, wy(0.12), S, S); for (let x = 0; x < S; x += S / 2) { ctx.fillStyle = 'rgba(0,0,0,0.08)'; ctx.fillRect(x, 0, 2, S); } break;
    case 5: wallBase(ctx, '#b9bdb6', rng, 0.15); for (let x = 0; x < S; x += S / 3) { ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(x, 0, 10, S); ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(x + 10, 0, 3, S); } noiseCanvas(ctx, S, S, rng, 0.2, 60, '90,60,30'); ctx.fillStyle = '#7e847c'; ctx.fillRect(0, wy(0.15), S, S); break;
    case 6: tiles(ctx, rng, ['#f1f2f0', '#ecedeb'], 10, '#c9ccc9'); break;
    case 7: wallBase(ctx, '#5a0f1c', rng, 0.12); for (let x = 0; x < S; x += 64) { ctx.strokeStyle = 'rgba(214,170,80,0.55)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, wy(0.3)); ctx.lineTo(x + 32, wy(2.4)); ctx.lineTo(x + 64, wy(0.3)); ctx.stroke(); } ctx.fillStyle = '#c9a24a'; ctx.fillRect(0, wy(2.45), S, 6); ctx.fillRect(0, wy(0.3), S, 4); baseboard(ctx, '#1b0408', 0.12); break;
    case 8: wallBase(ctx, '#5e0f17', rng, 0.1); for (let x = 0; x < S; x += S / 4) { const g = ctx.createLinearGradient(x, 0, x + S / 4, 0); g.addColorStop(0, 'rgba(0,0,0,0.35)'); g.addColorStop(0.5, 'rgba(255,255,255,0.06)'); g.addColorStop(1, 'rgba(0,0,0,0.35)'); ctx.fillStyle = g; ctx.fillRect(x, 0, S / 4, S); } baseboard(ctx, '#220508', 0.12); break;
    case 9: wallBase(ctx, '#eef0ee', rng, 0.04); for (let x = 0; x < S; x += S / 2) { ctx.fillStyle = 'rgba(0,0,0,0.06)'; ctx.fillRect(x, 0, 2, S); } ctx.fillStyle = 'rgba(0,0,0,0.05)'; ctx.fillRect(0, wy(1.5), S, 2); break;
    case 10: wallBase(ctx, '#1d2e48', rng, 0.08); break;
    case 11: wallBase(ctx, '#9fb7c0', rng, 0.02); break;
    case 12: wallBase(ctx, '#7f7a70', rng, 0.1); for (let y = 0; y < S; y += 24) { ctx.fillStyle = `rgba(${rng.next() < 0.5 ? '0,0,0' : '255,255,255'},${0.06 + rng.next() * 0.08})`; ctx.fillRect(0, y, S, 20); } break;
    case 13: wallBase(ctx, '#2b1d16', rng, 0.08); woodGrain(ctx, rng, ['#170d08', '#4a3020'], false); for (let x = 0; x <= S; x += S / 4) { ctx.fillStyle = '#a37b45'; ctx.fillRect(x - 1, 0, 3, S); } baseboard(ctx, '#0f0805', 0.12); break;
    case 14: wallBase(ctx, '#f6e7b8', rng, 0.05); { const c = ['#ff7a59', '#4bb3fd', '#7ed957', '#ffcc3a', '#c86bfa']; for (let k2 = 0; k2 < 18; k2++) { ctx.fillStyle = c[k2 % 5]; ctx.beginPath(); ctx.arc(rng.next() * S, wy(0.4 + rng.next() * 1.6), 14 + rng.next() * 30, 0, Math.PI * 2); ctx.fill(); } } baseboard(ctx, '#2f7fd1', 0.18); break;
    case 15: { ctx.fillStyle = '#5a3a2c'; ctx.fillRect(0, 0, S, S); const bh = 18, bw = 52; for (let y = 0; y < S; y += bh) for (let x = -((y / bh) % 2) * bw / 2; x < S; x += bw) { ctx.fillStyle = ['#8b4a33', '#7a3f2b', '#97553a', '#6e3727'][Math.floor(rng.next() * 4)]; ctx.fillRect(x + 2, y + 2, bw - 4, bh - 4); } baseboard(ctx, '#2a190d', 0.12); break; }
  }
}

// Dark luxury ceilings (defect 5). Bright texels (cove strips, lamp lenses) are made self-lit by materials.js
// (ceil material glowLayers 4..5), everything else stays a deep, readable finish rather than a black void.
function paintLacquerCoffer(ctx, rng) {
  const n = 2, c = S / n;               // 2×2 coffers per 4 m tile → 2 m coffers
  ctx.fillStyle = '#2a1a1c'; ctx.fillRect(0, 0, S, S);          // beams: deep oxblood lacquer
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
    const x = a * c, y = b * c, m = 26;
    // beam bevel highlights
    ctx.fillStyle = '#3b2628'; ctx.fillRect(x + 4, y + 4, c - 8, 6); ctx.fillRect(x + 4, y + 4, 6, c - 8);
    // recess: gradient lacquer panel (darker in the middle, lit by the cove at its edge)
    const g = ctx.createRadialGradient(x + c / 2, y + c / 2, 8, x + c / 2, y + c / 2, c * 0.62);
    g.addColorStop(0, '#2c1d22'); g.addColorStop(0.7, '#3d2a2c'); g.addColorStop(1, '#6a4a3a');
    ctx.fillStyle = g; ctx.fillRect(x + m, y + m, c - 2 * m, c - 2 * m);
    // gold trim line inside the coffer
    ctx.strokeStyle = '#8a6a34'; ctx.lineWidth = 3; ctx.strokeRect(x + m + 10, y + m + 10, c - 2 * m - 20, c - 2 * m - 20);
    // warm cove strip hugging the recess edge (glows)
    ctx.strokeStyle = '#ffd9a0'; ctx.lineWidth = 4; ctx.strokeRect(x + m + 2, y + m + 2, c - 2 * m - 4, c - 2 * m - 4);
    ctx.strokeStyle = 'rgba(255,190,110,0.35)'; ctx.lineWidth = 10; ctx.strokeRect(x + m + 7, y + m + 7, c - 2 * m - 14, c - 2 * m - 14);
    // central pendant rose + lens
    ctx.fillStyle = '#7a5a30'; ctx.beginPath(); ctx.arc(x + c / 2, y + c / 2, 18, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff0d0'; ctx.beginPath(); ctx.arc(x + c / 2, y + c / 2, 8, 0, Math.PI * 2); ctx.fill();
  }
  noiseCanvas(ctx, S, S, rng, 0.05, 60);
}
function paintAcousticRig(ctx, rng) {
  ctx.fillStyle = '#20232b'; ctx.fillRect(0, 0, S, S);           // charcoal-blue fabric panels
  // panel grid 4×2 with soft fabric shading and dark seams
  const pw = S / 4, ph = S / 2;
  for (let a = 0; a < 4; a++) for (let b = 0; b < 2; b++) {
    const g = ctx.createLinearGradient(a * pw, b * ph, a * pw + pw, b * ph + ph);
    const v = 0.9 + rng.next() * 0.2;
    g.addColorStop(0, `rgb(${Math.round(38 * v)},${Math.round(41 * v)},${Math.round(52 * v)})`); g.addColorStop(1, `rgb(${Math.round(28 * v)},${Math.round(31 * v)},${Math.round(40 * v)})`);
    ctx.fillStyle = g; ctx.fillRect(a * pw + 3, b * ph + 3, pw - 6, ph - 6);
  }
  speckle(ctx, S, S, rng, 0, 10);
  ctx.fillStyle = '#121419'; for (let a = 0; a <= 4; a++) ctx.fillRect(a * pw - 3, 0, 6, S); for (let b = 0; b <= 2; b++) ctx.fillRect(0, b * ph - 3, S, 6);
  // lighting truss running across the tile
  const ty = S * 0.5;
  ctx.fillStyle = '#4a4e57'; ctx.fillRect(0, ty - 14, S, 4); ctx.fillRect(0, ty + 10, S, 4);
  ctx.strokeStyle = '#3a3e46'; ctx.lineWidth = 2; ctx.beginPath();
  for (let x = 0; x < S; x += 24) { ctx.moveTo(x, ty - 12); ctx.lineTo(x + 12, ty + 12); ctx.lineTo(x + 24, ty - 12); }
  ctx.stroke();
  // rigging spots hanging off the truss (glowing lenses with a halo)
  for (let k = 0; k < 4; k++) {
    const x = (k + 0.5) * S / 4, y = ty + (k % 2 ? 26 : -26);
    ctx.fillStyle = '#15171b'; ctx.beginPath(); ctx.arc(x, y, 15, 0, Math.PI * 2); ctx.fill();
    const g = ctx.createRadialGradient(x, y, 1, x, y, 13); g.addColorStop(0, '#fff4dc'); g.addColorStop(0.55, '#ffd08a'); g.addColorStop(1, '#6a5030');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.fill();
  }
  // tiny pin downlights in the panel centres
  for (let a = 0; a < 4; a++) for (const yy of [ph * 0.25, ph * 1.75]) { ctx.fillStyle = '#ffe6bf'; ctx.beginPath(); ctx.arc(a * pw + pw / 2, yy, 3.5, 0, Math.PI * 2); ctx.fill(); }
}

function paintCeil(k, ctx, rng) {
  switch (k) {
    case 0: ctx.fillStyle = '#f2efe8'; ctx.fillRect(0, 0, S, S); noiseCanvas(ctx, S, S, rng, 0.03, 40); break;
    case 1: ctx.fillStyle = '#eceae4'; ctx.fillRect(0, 0, S, S); speckle(ctx, S, S, rng, 0, 18); ctx.fillStyle = '#c4c1b8'; for (let k2 = 0; k2 <= S; k2 += S / 4) { ctx.fillRect(k2 - 2, 0, 4, S); ctx.fillRect(0, k2 - 2, S, 4); } break;
    case 2: ctx.fillStyle = '#2a1a10'; ctx.fillRect(0, 0, S, S); for (let x = 0; x < S; x += 32) { ctx.fillStyle = ['#8a5a35', '#93613a', '#7d5130'][Math.floor(rng.next() * 3)]; ctx.fillRect(x + 4, 0, 24, S); } break;
    case 3: ctx.fillStyle = '#dfe1df'; ctx.fillRect(0, 0, S, S); ctx.fillStyle = '#a9aeab'; for (let k2 = 0; k2 <= S; k2 += S / 2) { ctx.fillRect(k2 - 2, 0, 4, S); } for (let k2 = 0; k2 <= S; k2 += S / 6) ctx.fillRect(0, k2 - 1, S, 2); break;
    case 4: paintLacquerCoffer(ctx, rng); break;     // casino: dark lacquered coffers, warm cove strips, gold trim
    case 5: paintAcousticRig(ctx, rng); break;       // theatre / nightclub / bridge: dark acoustic panels + rigging spots
    case 6: ctx.fillStyle = '#f4f0e6'; ctx.fillRect(0, 0, S, S); for (const o of [0, S / 2]) for (const p of [0, S / 2]) { ctx.fillStyle = '#e2dccd'; ctx.fillRect(o + 24, p + 24, S / 2 - 48, S / 2 - 48); ctx.strokeStyle = '#c3a465'; ctx.lineWidth = 3; ctx.strokeRect(o + 30, p + 30, S / 2 - 60, S / 2 - 60); } break;
    case 7: ctx.fillStyle = '#bcd7e2'; ctx.fillRect(0, 0, S, S); ctx.fillStyle = '#e6eef0'; for (let k2 = 0; k2 <= S; k2 += S / 4) { ctx.fillRect(k2 - 3, 0, 6, S); ctx.fillRect(0, k2 - 3, S, 6); } break;
  }
}

// metres per texture repeat for each layer
export const FLOOR_TILE = [2.0, 1.6, 3.0, 2.0, 2.4, 2.4, 1.2, 2.0, 1.2, 1.0, 2.0, 1.6, 2.6, 1.0, 3.0, 2.0];
export const FLOOR_ROUGH = [0.98, 0.98, 0.98, 0.98, 0.72, 0.18, 0.35, 0.6, 0.5, 0.25, 0.9, 0.42, 0.98, 0.3, 0.75, 0.25];
export const WALL_TILE = 2.0;
export const WALL_ROUGH = [0.85, 0.9, 0.5, 0.2, 0.75, 0.6, 0.3, 0.8, 0.95, 0.55, 0.45, 0.1, 0.85, 0.45, 0.8, 0.9];
export const CEIL_TILE = [3.0, 2.4, 2.0, 2.4, 4.0, 3.0, 3.2, 3.0];

function buildArray(count, painter, seed, size = S) {
  const data = new Uint8Array(size * size * 4 * count);
  const rng = new Rng(seed);
  for (let k = 0; k < count; k++) {
    const c = cnv(size, size); const ctx = c.getContext('2d', { willReadFrequently: true });
    painter(k, ctx, rng);
    const img = ctx.getImageData(0, 0, size, size).data;
    // flip vertically so v=0 is the bottom of the canvas
    for (let y = 0; y < size; y++) data.set(img.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), (k * size * size + y * size) * 4);
  }
  const tex = new THREE.DataArrayTexture(data, size, size, count);
  tex.format = THREE.RGBAFormat; tex.type = THREE.UnsignedByteType;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true; tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function buildSurfaceArrays() {
  return {
    floor: buildArray(16, paintFloor, 11),
    wall: buildArray(16, paintWall, 23),
    ceil: buildArray(8, paintCeil, 37),
  };
}

// Simple standalone canvas textures used by props
export function canvasTexture(w, h, painter, { repeat = false, srgb = true } = {}) {
  const c = cnv(w, h); const ctx = c.getContext('2d'); painter(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function signTexture(text, style, sub = '') {
  const w = 1024, h = 256;
  return canvasTexture(w, h, (ctx) => {
    const styles = {
      brass: { bg: '#1e1a14', fg: '#d9b46a', font: '600 120px Georgia, serif', border: '#b48d45' },
      venue: { bg: 'rgba(0,0,0,0)', fg: '#f3d48a', font: 'italic 600 140px Georgia, serif', border: null, glow: '#ffb64a' },
      deck: { bg: '#0f2338', fg: '#f4efe4', font: '700 150px "Helvetica Neue", Arial, sans-serif', border: '#c9a45b' },
      crew: { bg: '#e8ece9', fg: '#1f4766', font: '700 120px Arial, sans-serif', border: '#1f4766' },
      warn: { bg: '#f2c230', fg: '#111', font: '800 92px Arial, sans-serif', border: '#111' },
    }[style] || {};
    ctx.fillStyle = styles.bg; ctx.fillRect(0, 0, w, h);
    if (styles.border) { ctx.strokeStyle = styles.border; ctx.lineWidth = 10; ctx.strokeRect(8, 8, w - 16, h - 16); }
    ctx.font = styles.font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    let size = parseInt(styles.font.match(/(\d+)px/)[1]);
    while (ctx.measureText(text).width > w - 80 && size > 30) { size -= 6; ctx.font = styles.font.replace(/\d+px/, size + 'px'); }
    if (styles.glow) { ctx.shadowColor = styles.glow; ctx.shadowBlur = 30; }
    ctx.fillStyle = styles.fg; ctx.fillText(text, w / 2, sub ? h * 0.42 : h / 2);
    if (sub) { ctx.shadowBlur = 0; ctx.font = '600 56px Arial, sans-serif'; ctx.fillText(sub, w / 2, h * 0.8); }
  });
}
