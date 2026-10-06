// HALCYON TIDE (mobile) — entry for mobile.html / dist-mobile/index.html.
// Runs before the game exists: sets window.HT_MOBILE (main.js → game.mobile), picks a phone quality preset,
// injects the mobile stylesheet, the portrait "rotate your phone" overlay and browser-gesture suppression
// (pinch / double-tap zoom, pull-to-refresh, long-press callouts, text selection), then loads src/main.js.
import { pickMobileQuality } from './mobileQuality.js';
import { BOOT_CSS } from './mobileStyle.js';

window.HT_MOBILE = true;
window.HT_MOBILE_QUALITY = pickMobileQuality();
document.documentElement.classList.add('ht-mobile');

// stylesheet (boot part: page, loader, rotate overlay); the HUD part is injected by mobileHud.js
{
  const s = document.createElement('style'); s.id = 'htm-boot'; s.textContent = BOOT_CSS; document.head.appendChild(s);
}

// portrait overlay (shown by CSS media query)
{
  const o = document.createElement('div'); o.id = 'htm-rotate';
  o.innerHTML = `<div class="rb"><svg viewBox="0 0 120 120" class="ph"><g class="dev"><rect x="38" y="18" width="44" height="84" rx="8" fill="none" stroke="#c9a45b" stroke-width="3"/><circle cx="60" cy="93" r="3" fill="#c9a45b"/></g><path class="arr" d="M96 44a40 40 0 0 1-4 44" fill="none" stroke="#f1ece2" stroke-width="3" stroke-linecap="round"/><path class="arr" d="M86 84l6 5 3-8" fill="none" stroke="#f1ece2" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
    <div class="t">Rotate your phone</div><div class="s">Halcyon Tide is played in landscape</div></div>`;
  (document.body || document.documentElement).appendChild(o);
}

// browser gestures: the game surface never scrolls or zooms; scrollable lists (.scroll and other overflow areas) still scroll
const scrollable = (t) => {
  for (let n = t; n && n !== document.body && n.nodeType === 1; n = n.parentElement) {
    if (n.classList?.contains('scroll')) return true;
    const cs = getComputedStyle(n);
    if (/(auto|scroll)/.test(cs.overflowY + cs.overflowX) && (n.scrollHeight > n.clientHeight + 1 || n.scrollWidth > n.clientWidth + 1)) return true;
  }
  return false;
};
document.addEventListener('touchmove', (e) => { if (e.touches.length > 1 || !scrollable(e.target)) { if (e.cancelable) e.preventDefault(); } }, { passive: false });
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
document.addEventListener('contextmenu', (e) => { if (!(e.target.closest && e.target.closest('input,textarea'))) e.preventDefault(); });
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
let lastEnd = 0;
document.addEventListener('touchend', (e) => {
  // iOS double-tap zoom fallback (touch-action covers modern browsers): swallow a second quick tap on non-controls
  const now = performance.now();
  if (now - lastEnd < 300 && e.cancelable && !(e.target.closest && e.target.closest('button,input,a,[data-k],.op,.mi,.dk,.seg,.slot,.ptab,.act-btn,.act-chip'))) e.preventDefault();
  lastEnd = now;
}, { passive: false });

// fullscreen + landscape lock (both may be unsupported, e.g. iPhone Safari: that's fine)
window.HT_fullscreen = async () => {
  const d = document.documentElement;
  try {
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      if (d.requestFullscreen) await d.requestFullscreen({ navigationUI: 'hide' });
      else if (d.webkitRequestFullscreen) d.webkitRequestFullscreen();
    }
  } catch {}
  try { await screen.orientation?.lock?.('landscape'); } catch {}
};

await import('../main.js');
