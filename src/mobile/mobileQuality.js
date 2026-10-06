// HALCYON TIDE (mobile) — device-based quality pick + adaptive resolution scaler.
//
// pickMobileQuality() → 'mobile-low' | 'mobile' (called by boot.js before the game is created; main.js reads
//   window.HT_MOBILE_QUALITY unless the player chose a preset — stored under localStorage 'ht.mquality').
// installAdaptiveResolution(game) → game.mobileRes { scale, min, max, enabled, fps, setEnabled(b) }
//   Every ~1.5 s the average frame rate is compared with the target band (27…40 fps): below → render scale ×0.86,
//   comfortably above for 4 s → ×1.07, clamped to [min, max]. Applied as renderer pixel ratio (+ composer).
//   A preset change (game.applyQuality) resets the scale to 1.

export function pickMobileQuality() {
  try {
    const cores = navigator.hardwareConcurrency || 4;
    const mem = navigator.deviceMemory || 4;              // Chrome only (GB, rounded); Safari → undefined
    const dpr = window.devicePixelRatio || 1;
    const px = Math.max(screen.width, screen.height) * Math.min(dpr, 3);
    const ua = navigator.userAgent || '';
    const iOS = /iPhone|iPad|iPod/.test(ua) || (/Mac/.test(ua) && navigator.maxTouchPoints > 1);
    let score = 0;
    if (cores >= 8) score += 2; else if (cores >= 6) score += 1;
    if (mem >= 6) score += 2; else if (mem >= 4) score += 1; else score -= 1;
    if (iOS) score += 1;                                     // recent iPhones have strong GPUs but report few cores
    if (px > 2800) score -= 1;                               // very high-res panels cost fill rate
    return score >= 3 ? 'mobile' : 'mobile-low';
  } catch { return 'mobile-low'; }
}

export function installAdaptiveResolution(game) {
  let store = {};
  try { store = JSON.parse(localStorage.getItem('ht.m.res') || '{}'); } catch {}
  const R = game.mobileRes = {
    scale: 1, min: 0.5, max: 1.15, enabled: store.enabled !== false, fps: 0,
    setEnabled(b) { R.enabled = !!b; if (!b) R.scale = 1; apply(); try { localStorage.setItem('ht.m.res', JSON.stringify({ enabled: R.enabled })); } catch {} },
  };
  let acc = 0, n = 0, good = 0, cool = 0;
  const base = () => Math.min(window.devicePixelRatio || 1, 2) * (game.quality.pixelRatio ?? 1);
  const apply = () => {
    const r = game.renderer; if (!r) return;
    const pr = Math.max(0.35, base() * R.scale);
    if (Math.abs(r.getPixelRatio() - pr) < 0.01) return;
    r.setPixelRatio(pr);
    r.setSize(window.innerWidth, window.innerHeight);
    try { game.composer?.setPixelRatio?.(pr); game.composer?.setSize?.(window.innerWidth, window.innerHeight); } catch {}
  };
  R.apply = apply;
  // a preset change re-applies its own pixel ratio: start the scaler again from 1 on top of it
  const origApply = game.applyQuality.bind(game);
  game.applyQuality = () => { origApply(); R.scale = 1; good = 0; cool = 1; apply(); };
  window.addEventListener('resize', () => setTimeout(apply, 50));
  apply();
  game.addSystem({
    name: 'mobileRes', order: 98, runWhilePaused: true,
    lateUpdate(dt, realDt) {
      if (!(realDt > 0)) return;
      acc += realDt; n++;
      if (acc < 1.5) return;
      const fps = n / acc; acc = 0; n = 0; R.fps = fps;
      if (cool > 0) { cool--; return; }
      if (!R.enabled || document.hidden) return;
      if (fps < 27 && R.scale > R.min) { R.scale = Math.max(R.min, R.scale * (fps < 18 ? 0.8 : 0.86)); good = 0; cool = 1; apply(); }
      else if (fps > 40) { if (++good >= 3 && R.scale < R.max) { R.scale = Math.min(R.max, R.scale * 1.07); good = 0; cool = 1; apply(); } }
      else good = 0;
    },
  });
  return R;
}
