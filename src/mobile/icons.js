// HALCYON TIDE (mobile) — line icons for the touch controls (24×24 viewBox, currentColor-free: ivory strokes).
const S = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="#f1ece2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;

export const IC = {
  fire: S('<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.2" fill="#f1ece2"/><path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4"/>'),
  fist: S('<path d="M7 11V7.5a1.5 1.5 0 0 1 3 0V10M10 9.5V6.5a1.5 1.5 0 0 1 3 0v3.5M13 9.5V7a1.5 1.5 0 0 1 3 0v4M16 10.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-1.5A5.5 5.5 0 0 1 6 14.5V12a1.5 1.5 0 0 1 3 0v1"/>'),
  aim: S('<circle cx="12" cy="12" r="8"/><path d="M12 4v4M12 16v4M4 12h4M16 12h4"/>'),
  block: S('<path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6z"/>'),
  crouch: S('<circle cx="11" cy="4.5" r="2"/><path d="M11 7.5l-1 5 4 2 1 6M10 12.5l-4 1.5M14 14.5l-4.5 6M11 8.5l4 2"/>'),
  stand: S('<circle cx="12" cy="4" r="2"/><path d="M12 7v7M12 14l-3 7M12 14l3 7M8 10l4-2 4 2"/>'),
  jump: S('<path d="M12 20V6M6 11l6-6 6 6"/><path d="M5 21h14"/>'),
  reload: S('<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/>'),
  hand: S('<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10V4a1.5 1.5 0 0 1 3 0v6M14 10V5.5a1.5 1.5 0 0 1 3 0V13M17 9.5a1.5 1.5 0 0 1 3 0V15a7 7 0 0 1-7 7h-1a6 6 0 0 1-5.2-3L4.5 15a1.5 1.5 0 0 1 2.5-1.6L8 15"/>'),
  door: S('<path d="M5 21V4a1 1 0 0 1 1-1h9v18M3 21h18M15 3l4 1.5V21"/><circle cx="12" cy="12.5" r=".8" fill="#f1ece2"/>'),
  talk: S('<path d="M4 5h16v10H9l-5 4z"/><path d="M8 9h8M8 12h5"/>'),
  seat: S('<path d="M6 3v10h11M6 13l-1 8M17 13l1 8M6 9h10a1 1 0 0 1 1 1v3"/>'),
  buy: S('<path d="M5 8h14l-1.2 12H6.2z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>'),
  lift: S('<rect x="5" y="2.5" width="14" height="19" rx="2"/><path d="M12 6l3 3.5H9zM12 18l3-3.5H9z"/>'),
  pick: S('<path d="M9 13V5.5a1.5 1.5 0 0 1 3 0V12M12 11.5V6a1.5 1.5 0 0 1 3 0v6"/><path d="M15 12V8.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1a5 5 0 0 1-4-2l-3-4"/><path d="M3 4l3 3M6 2.5l.5 3"/>'),
  takedown: S('<circle cx="8" cy="5" r="2"/><path d="M8 8l3 5 5 1M11 13l-3 7M16 14l3 6M4 12l4-3"/>'),
  drag: S('<path d="M4 14h11l4-4M15 14l4 4"/><circle cx="6" cy="8" r="2"/>'),
  lock: S('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  pause: S('<path d="M8 5v14M16 5v14"/>'),
  bag: S('<path d="M6 8h12l1 12H5z"/><path d="M9 8V6a3 3 0 0 1 6 0v2M9 12h6"/>'),
  phone: S('<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/>'),
  map: S('<path d="M3 6l6-2.5 6 2.5 6-2.5v14.5l-6 2.5-6-2.5L3 20.5z"/><path d="M9 3.5v14.5M15 6v14.5"/>'),
  eye: S('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  cam3: S('<circle cx="12" cy="7" r="3"/><path d="M6 21v-2a6 6 0 0 1 12 0v2"/><path d="M3 4h3M18 4h3"/>'),
  hands: S('<path d="M7 11V4.5a1.5 1.5 0 0 1 3 0V10M10 9V3.5a1.5 1.5 0 0 1 3 0V9M14 9.5V5.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7 6 6 0 0 1-6-6v-2a1.5 1.5 0 0 1 3 0"/>'),
  close: S('<path d="M5 5l14 14M19 5L5 19"/>', 'stroke-width="2.4"'),
  fullscreen: S('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  sprint: S('<circle cx="14" cy="4.5" r="2"/><path d="M5 20l4-5 3 1 1-5-3-1-3 3M13 11l3 3 4-1M10 8l3 3"/>'),
  minus: S('<path d="M5 12h14"/>'), plus: S('<path d="M5 12h14M12 5v14"/>'),
  locate: S('<circle cx="12" cy="12" r="4"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>'),
  // weapons (slot bar)
  w_fists: S('<path d="M7 11V7.5a1.5 1.5 0 0 1 3 0V10M10 9.5V6.5a1.5 1.5 0 0 1 3 0v3.5M13 9.5V7a1.5 1.5 0 0 1 3 0v4M16 10.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-1.5A5.5 5.5 0 0 1 6 14.5V12a1.5 1.5 0 0 1 3 0v1"/>'),
  w_baton: S('<path d="M5 20L19 4M7.5 13.5l3 3"/>', 'stroke-width="2.6"'),
  w_taser: S('<path d="M3 8h13l2 2v2H10l-1.5 6H5l1.5-6H3z"/><path d="M20 3l-2 3h2.5l-2 3"/>'),
  w_pistol: S('<path d="M3 7h17v4h-8l-.8 2H9l-1.6 7H4l1.6-8H3z"/>'),
  w_extinguisher: S('<rect x="8" y="8" width="8" height="13" rx="3"/><path d="M10 8V5h4v3M14 5.5h4l2 2"/>'),
};

// icon for an interaction (label / id heuristics)
export function interactIcon(it) {
  const s = ((it?.label || '') + ' ' + (it?.id || '')).toLowerCase();
  if (/takedown/.test(s)) return IC.takedown;
  if (/pickpocket|pocket it|steal/.test(s)) return IC.pick;
  if (/drag/.test(s)) return IC.drag;
  if (/door|open|close|unlock|pick lock|force/.test(s)) return IC.door;
  if (/talk|ask|speak|chat|greet/.test(s)) return IC.talk;
  if (/sit|lie|stand up|seat|bed|lounger/.test(s)) return IC.seat;
  if (/buy|order|shop|drink|bar|menu|cage|chips|casino|play|bet/.test(s)) return IC.buy;
  if (/lift|elevator|call/.test(s)) return IC.lift;
  return IC.hand;
}
