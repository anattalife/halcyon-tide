// Casino — The Gilded Reef (deck 5): slots, blackjack, roulette, the cage.
// Chips are tracked as inventory 'casino_chips' (value §1 each here for a clean wallet);
// buy at the cage/cashier with cash, cash out at the cage. Table minimums enforced.
// Cheating hook: wearing a croupier disguise (or paying a bribe) marks the deck/wheel for an
// edge, but the eye-in-the-sky may catch you → crime 'cheating' when game.security exists.
import { Rng } from '../../core/util.js';
import { Panel, chipRow, toast } from './ui.js';
import { fmt } from '../economy.js';
import * as R from './casinoRules.js';

const CHIP = 1;   // §1 per chip token

function chips(game) { return game.inventory?.count('casino_chips') || 0; }
function addChips(game, n) { if (n > 0) game.inventory?.add('casino_chips', n); }
function takeChips(game, n) { return game.inventory?.remove('casino_chips', n); }

function sfx(game, name, vol = 0.6) { game.bus?.emit('sfx', { name, vol }); }
function anim(game, name, secs) { game.player?.playAnim?.(name, secs); }

// eye-in-the-sky: cameras present in the casino + security installed
function caughtCheating(game, chance) {
  if (!game.security) return false;
  const rng = Math.random();
  return rng < chance;
}
function reportCheat(game, note) {
  const p = game.player;
  game.security?.report?.({ type: 'cheating', severity: 2, x: p?.x, y: p?.y, z: p?.z, deck: p?.deck, actor: p, note });
  game.bus?.emit('crime', { type: 'cheating', severity: 2, x: p?.x, y: p?.y, z: p?.z, deck: p?.deck, actor: p, victim: null });
}

// is the player able to mark the game? croupier disguise, or they already bribed this session
function cheatEdge(game, item) {
  const dis = game.player?.disguise;
  const hasRole = dis === 'croupier';
  const bribed = !!game.activities?._bribed;
  return hasRole || bribed;
}

// ═══ SLOTS ═══════════════════════════════════════════════════════════════════
function openSlots(game, item) {
  const rng = new Rng((Date.now() ^ (item?.x * 131 | 0)) >>> 0);
  const p = new Panel(game, { title: 'Slot Machine', sub: 'The Gilded Reef' });
  let bet = 5;
  const bets = [1, 5, 10, 25, 50];
  const paytable = R.SLOT_TRIPLE.map((m, i) => `${R.SLOT_SYMBOLS[i]}×3 = ${m}×`).join('   ');
  p.body.innerHTML = `
    <div style="display:flex;justify-content:center;gap:10px;margin:8px 0 4px">
      ${[0, 1, 2].map(i => `<div class="reel" data-r="${i}" style="width:84px;height:96px;border-radius:12px;border:2px solid #c9a45b66;background:#0a0d12;display:flex;align-items:center;justify-content:center;font-size:52px;overflow:hidden">${R.SLOT_SYMBOLS[1]}</div>`).join('')}
    </div>
    <div class="act-flash" data-flash></div>
    <div class="act-note" style="text-align:center">${paytable}</div>
    <div class="act-note" style="text-align:center">One leading 🍒 pays 1× · two pay 3× · credits: <b data-cr>${chips(game)}</b></div>
    <div style="text-align:center;margin:6px 0 2px">Bet</div>
    <div data-chips style="display:flex;justify-content:center"></div>
    <div style="text-align:center;margin-top:8px"><button class="act-btn" data-spin>SPIN</button>
      <button class="act-btn ghost" data-buy>Buy chips</button></div>`;
  const reels = [...p.body.querySelectorAll('.reel')];
  const flash = p.body.querySelector('[data-flash]');
  const crEl = p.body.querySelector('[data-cr]');
  const cr = chipRow(bets, bet, v => { bet = v; });
  p.body.querySelector('[data-chips]').appendChild(cr);
  p.body.querySelector('[data-buy]').onclick = () => { p.close(); openCage(game); };
  const spinBtn = p.body.querySelector('[data-spin]');
  let spinning = false;
  const refresh = () => { crEl.textContent = chips(game); };

  spinBtn.onclick = () => {
    if (spinning) return;
    if (chips(game) < bet) { flash.className = 'act-flash lose'; flash.textContent = 'Not enough credits'; return; }
    takeChips(game, bet); refresh();
    spinning = true; flash.textContent = '';
    anim(game, 'slots', 1.2); sfx(game, 'slot_spin', 0.6);
    const result = R.spinSlots(rng);
    // animated reel roll
    const start = performance.now();
    const stopT = [620, 900, 1200];
    const timer = setInterval(() => {
      const t = performance.now() - start;
      let allStopped = true;
      for (let i = 0; i < 3; i++) {
        if (t < stopT[i]) { reels[i].textContent = R.SLOT_SYMBOLS[Math.floor(Math.random() * 6)]; allStopped = false; }
        else reels[i].textContent = R.SLOT_SYMBOLS[result[i]];
      }
      if (allStopped) {
        clearInterval(timer); spinning = false;
        const pay = R.slotPayout(result, bet);
        if (pay.win > 0) {
          addChips(game, pay.win); refresh();
          flash.className = 'act-flash win';
          flash.textContent = pay.kind === 'triple' ? `${pay.line.toUpperCase()}!  +${pay.win}` : `Win +${pay.win}`;
          sfx(game, 'slot_win', 0.7);
          game.bus?.emit('activity:slot', { win: pay.win, bet });
        } else if (pay.near) {
          flash.className = 'act-flash lose'; flash.textContent = 'So close…';
        } else { flash.className = 'act-flash lose'; flash.textContent = 'No win'; }
      }
    }, 70);
  };
  // seated pose
  return p;
}

// ═══ BLACKJACK ════════════════════════════════════════════════════════════════
const SUITS = ['♠', '♥', '♦', '♣'];
function cardFace(r, suitIdx) {
  const n = r === 1 ? 'A' : r === 11 ? 'J' : r === 12 ? 'Q' : r === 13 ? 'K' : String(r);
  const s = SUITS[suitIdx % 4];
  const red = s === '♥' || s === '♦';
  return `<div class="bjc" style="display:inline-flex;flex-direction:column;justify-content:space-between;width:54px;height:76px;margin:3px;border-radius:7px;background:#faf6ec;color:${red ? '#c0392b' : '#1a1a1a'};padding:5px 7px;font:700 16px Inter;box-shadow:0 3px 8px #0006">
    <span>${n}</span><span style="text-align:right;font-size:20px">${s}</span></div>`;
}
function cardBack() { return `<div style="display:inline-block;width:54px;height:76px;margin:3px;border-radius:7px;background:repeating-linear-gradient(45deg,#2a3f66,#2a3f66 6px,#355080 6px,#355080 12px);box-shadow:0 3px 8px #0006"></div>`; }

function openBlackjack(game, item) {
  const high = item?.game === 'blackjack_hl';
  const min = high ? 100 : 10, max = high ? 1000 : 100;
  const rng = new Rng((Date.now() ^ 0x9e37) >>> 0);
  let shoe = R.makeShoe(rng, 6);
  const suits = [];
  const draw = () => { if (shoe.length < 20) shoe = R.makeShoe(rng, 6); const c = shoe.pop(); suits.push((Math.random() * 4) | 0); return c; };
  const p = new Panel(game, { title: high ? 'High-Limit Blackjack' : 'Blackjack', sub: `Table §${min}–§${max} · dealer stands on 17 · 3:2` });
  let bet = min, phase = 'bet';
  let dealer = [], hands = [], active = 0;
  const marked = cheatEdge(game, item);

  p.body.innerHTML = `
    <div data-dealer style="min-height:92px"></div>
    <div class="act-flash" data-flash></div>
    <div data-player style="min-height:92px"></div>
    <div class="act-note">Credits: <b data-cr>${chips(game)}</b>${marked ? ' · <span style="color:#d68a7a">deck marked</span>' : ''}</div>
    <div data-controls style="margin-top:8px"></div>`;
  const dealerEl = p.body.querySelector('[data-dealer]');
  const playerEl = p.body.querySelector('[data-player]');
  const flash = p.body.querySelector('[data-flash]');
  const crEl = p.body.querySelector('[data-cr]');
  const controls = p.body.querySelector('[data-controls]');
  const refreshCr = () => { crEl.innerHTML = chips(game) + (marked ? ' · <span style="color:#d68a7a">deck marked</span>' : ''); };

  function render(revealDealer) {
    // dealer
    let dh = '<div style="font-size:12px;color:#9fb0c0;margin-bottom:2px">Dealer</div>';
    dh += dealer.map((c, i) => (i === 1 && !revealDealer && phase === 'play') ? cardBack() : cardFace(c, suits[cardIndex(dealer, i, 'd')])).join('');
    if (revealDealer || phase !== 'play') dh += ` <span class="act-note">(${R.handValue(dealer).total})</span>`;
    dealerEl.innerHTML = dh;
    // player hands
    let ph = '';
    hands.forEach((h, hi) => {
      const v = R.handValue(h.cards);
      ph += `<div style="opacity:${hands.length > 1 && hi !== active && phase === 'play' ? 0.5 : 1}">
        <div style="font-size:12px;color:#9fb0c0;margin-bottom:2px">Your hand${hands.length > 1 ? ' ' + (hi + 1) : ''} — ${fmt(h.bet)} ${h.done ? '' : hi === active ? '◀' : ''}</div>
        ${h.cards.map((c, i) => cardFace(c, suits[cardIndex(h.cards, i, 'p' + hi)])).join('')}
        <span class="act-note">(${v.total}${v.soft ? ' soft' : ''}${v.bust ? ' BUST' : ''})</span></div>`;
    });
    playerEl.innerHTML = ph;
  }
  // stable suit index per card position
  const suitMap = new Map();
  function cardIndex(arr, i, tag) { const k = tag + ':' + i; if (!suitMap.has(k)) suitMap.set(k, (Math.random() * 4) | 0); return suitMap.get(k); }

  function setBetControls() {
    phase = 'bet'; flash.textContent = ''; flash.className = 'act-flash';
    const cr = chipRow([min, min * 2, min * 5, max].filter((v, i, a) => a.indexOf(v) === i), bet, v => { bet = v; });
    controls.innerHTML = '<div style="text-align:center;margin-bottom:4px">Bet</div>';
    const holder = document.createElement('div'); holder.style.cssText = 'display:flex;justify-content:center'; holder.appendChild(cr);
    controls.appendChild(holder);
    const deal = document.createElement('button'); deal.className = 'act-btn'; deal.textContent = 'Deal'; deal.style.display = 'block'; deal.style.margin = '8px auto 0';
    deal.onclick = startRound; controls.appendChild(deal);
    const buy = document.createElement('button'); buy.className = 'act-btn ghost'; buy.textContent = 'Buy chips'; buy.style.cssText = 'display:block;margin:8px auto 0';
    buy.onclick = () => { p.close(); openCage(game); }; controls.appendChild(buy);
    render(false);
  }

  function startRound() {
    if (chips(game) < bet) { flash.className = 'act-flash lose'; flash.textContent = 'Not enough credits'; return; }
    takeChips(game, bet); refreshCr();
    suitMap.clear();
    dealer = [draw(), draw()];
    // marked deck: nudge the player's first two cards toward a strong total
    hands = [{ cards: [draw(), draw()], bet, done: false, doubled: false }];
    if (marked) { biasHand(hands[0].cards); }
    active = 0; phase = 'play';
    anim(game, 'deal_cards', 1.0); sfx(game, 'card_flip', 0.6);
    // naturals
    const pbj = R.isBlackjack(hands[0].cards), dbj = R.isBlackjack(dealer);
    if (pbj || dbj) { render(true); return finishRound({ natural: true, pbj, dbj }); }
    render(false); setPlayControls();
  }

  function biasHand(cards) {
    // swap in cards for a 19-20 start when possible (cheat) — draw replacements
    const v = R.handValue(cards).total;
    if (v < 17) { cards[1] = 10; }   // give a ten
  }

  function setPlayControls() {
    const h = hands[active];
    const v = R.handValue(h.cards);
    controls.innerHTML = '';
    const mk = (label, fn, cls = '') => { const b = document.createElement('button'); b.className = 'act-btn ' + cls; b.textContent = label; b.style.margin = '0 4px'; b.onclick = fn; controls.appendChild(b); return b; };
    controls.style.textAlign = 'center';
    mk('Hit', () => { h.cards.push(draw()); sfx(game, 'card_flip', 0.6); const nv = R.handValue(h.cards); render(false); if (nv.bust || nv.total === 21) nextHandOrDealer(); else setPlayControls(); });
    mk('Stand', () => { nextHandOrDealer(); }, 'ghost');
    if (h.cards.length === 2 && chips(game) >= h.bet) mk('Double', () => {
      takeChips(game, h.bet); refreshCr(); h.bet *= 2; h.doubled = true; h.cards.push(draw()); sfx(game, 'card_flip', 0.6); render(false); nextHandOrDealer();
    }, 'ghost');
    if (h.cards.length === 2 && R.cardValue(h.cards[0]) === R.cardValue(h.cards[1]) && chips(game) >= h.bet && hands.length < 4) mk('Split', () => {
      takeChips(game, h.bet); refreshCr();
      const c = h.cards.pop(); hands.splice(active + 1, 0, { cards: [c, draw()], bet: h.bet, done: false }); h.cards.push(draw());
      sfx(game, 'card_flip', 0.6); render(false); setPlayControls();
    }, 'ghost');
  }

  function nextHandOrDealer() {
    hands[active].done = true;
    if (active < hands.length - 1) { active++; render(false); setPlayControls(); return; }
    // dealer plays if any hand is live
    const live = hands.some(h => !R.handValue(h.cards).bust);
    if (live) R.dealerPlay(dealer, draw);
    render(true);
    finishRound({});
  }

  function finishRound({ natural, pbj, dbj }) {
    phase = 'done';
    let net = 0, msgs = [];
    const dbjFlag = dbj ?? R.isBlackjack(dealer);
    for (const h of hands) {
      const pbjFlag = natural ? pbj : (hands.length === 1 && R.isBlackjack(h.cards));
      const mult = R.settle(h.cards, dealer, { blackjack3to2: true, playerBlackjack: pbjFlag && !h.doubled, dealerBlackjack: dbjFlag });
      const ret = Math.round(h.bet * (1 + mult));   // return stake + winnings
      addChips(game, Math.max(0, ret));
      net += ret - h.bet;
      msgs.push(mult > 1 ? 'Blackjack!' : mult === 1 ? 'Win' : mult === 0 ? 'Push' : 'Lose');
    }
    refreshCr();
    flash.className = 'act-flash ' + (net > 0 ? 'win' : net < 0 ? 'lose' : '');
    flash.textContent = `${msgs.join(' · ')}  (${net >= 0 ? '+' : ''}${net})`;
    if (net > 0) sfx(game, 'chips', 0.6);
    game.bus?.emit('activity:blackjack', { net });
    // cheating caught?
    if (marked && net > 0 && caughtCheating(game, 0.35)) { reportCheat(game, 'marked cards at blackjack'); toast(game, 'The eye-in-the-sky noticed.', 'warn'); }
    const again = document.createElement('button'); again.className = 'act-btn'; again.textContent = 'Next hand'; again.style.cssText = 'display:block;margin:10px auto 0';
    again.onclick = setBetControls; controls.innerHTML = ''; controls.appendChild(again);
  }

  setBetControls();
  return p;
}

// ═══ ROULETTE ═════════════════════════════════════════════════════════════════
function openRoulette(game, item) {
  const rng = new Rng((Date.now() ^ 0x51ed) >>> 0);
  const p = new Panel(game, { title: 'Roulette', sub: 'European · single zero' });
  let chip = 5, bets = [];
  const marked = cheatEdge(game, item);
  const outside = [['red', 'Red', 1], ['black', 'Black', 1], ['odd', 'Odd', 1], ['even', 'Even', 1], ['low', '1–18', 1], ['high', '19–36', 1], ['dozen1', '1st 12', 2], ['dozen2', '2nd 12', 2], ['dozen3', '3rd 12', 2]];
  p.body.innerHTML = `
    <div data-wheel style="text-align:center;font-family:'Cormorant Garamond',serif;font-size:40px;min-height:52px;color:#f3ead7">—</div>
    <div class="act-flash" data-flash></div>
    <div class="act-note">Chip size: <span data-chips></span></div>
    <div data-numbers style="display:grid;grid-template-columns:repeat(13,1fr);gap:3px;margin:8px 0"></div>
    <div data-outside style="display:flex;flex-wrap:wrap;gap:6px;margin:8px 0"></div>
    <div class="act-note">On table: <b data-stake>§0</b> · credits <b data-cr>${chips(game)}</b>${marked ? ' · <span style="color:#d68a7a">wheel rigged</span>' : ''}</div>
    <div style="text-align:center;margin-top:8px"><button class="act-btn" data-spin>Spin</button>
      <button class="act-btn ghost" data-clear>Clear</button>
      <button class="act-btn ghost" data-buy>Buy chips</button></div>`;
  const wheel = p.body.querySelector('[data-wheel]');
  const flash = p.body.querySelector('[data-flash]');
  const stakeEl = p.body.querySelector('[data-stake]');
  const crEl = p.body.querySelector('[data-cr]');
  const cr = chipRow([1, 5, 10, 25], chip, v => { chip = v; });
  p.body.querySelector('[data-chips]').appendChild(cr);
  const stakeTotal = () => bets.reduce((s, b) => s + b.amount, 0);
  const refresh = () => { stakeEl.textContent = fmt(stakeTotal()); crEl.innerHTML = chips(game) + (marked ? ' · <span style="color:#d68a7a">wheel rigged</span>' : ''); };

  function placeBet(type, value) {
    if (chips(game) < chip) { flash.className = 'act-flash lose'; flash.textContent = 'Not enough credits'; return; }
    takeChips(game, chip);
    const ex = bets.find(b => b.type === type && b.value === value);
    if (ex) ex.amount += chip; else bets.push({ type, value, amount: chip });
    sfx(game, 'chips', 0.4); refresh(); markBtns();
  }
  const numGrid = p.body.querySelector('[data-numbers]');
  numGrid.innerHTML = `<button class="rb" data-n="0" style="grid-column:1/14">0</button>` +
    Array.from({ length: 36 }, (_, i) => i + 1).map(n => `<button class="rb" data-n="${n}">${n}</button>`).join('');
  numGrid.querySelectorAll('.rb').forEach(b => {
    const n = +b.dataset.n; const col = R.rouletteColor(n);
    b.style.cssText = `pointer-events:auto;cursor:pointer;border:1px solid #ffffff22;border-radius:5px;padding:6px 0;font:600 12px Inter;color:#fff;background:${col === 'red' ? '#9e3b34' : col === 'green' ? '#2f7d4f' : '#2a2f38'}`;
    b.onclick = () => placeBet('straight', n);
  });
  const outWrap = p.body.querySelector('[data-outside]');
  outWrap.innerHTML = outside.map(([t, l]) => `<button class="ob act-chip" data-t="${t}">${l}</button>`).join('');
  outWrap.querySelectorAll('.ob').forEach(b => { b.onclick = () => placeBet(b.dataset.t, null); });
  function markBtns() {
    numGrid.querySelectorAll('.rb').forEach(b => { const has = bets.find(x => x.type === 'straight' && x.value === +b.dataset.n); b.style.outline = has ? '2px solid #c9a45b' : 'none'; });
    outWrap.querySelectorAll('.ob').forEach(b => { const has = bets.find(x => x.type === b.dataset.t); b.classList.toggle('on', !!has); });
  }
  p.body.querySelector('[data-clear]').onclick = () => { for (const b of bets) addChips(game, b.amount); bets = []; refresh(); markBtns(); flash.textContent = ''; };
  p.body.querySelector('[data-buy]').onclick = () => { p.close(); openCage(game); };
  p.body.querySelector('[data-spin]').onclick = () => {
    if (!bets.length) { flash.className = 'act-flash lose'; flash.textContent = 'Place a bet first'; return; }
    let n = R.spinRoulette(rng);
    if (marked) {
      // rig: if a straight bet exists, land it ~45%; else bias toward a covered outside bet
      const straight = bets.find(b => b.type === 'straight');
      if (straight && Math.random() < 0.45) n = straight.value;
      else { for (let tries = 0; tries < 8; tries++) { const t = R.spinRoulette(rng); if (bets.some(b => R.roulettePayout(b, t) > 0)) { n = t; break; } } }
    }
    sfx(game, 'slot_spin', 0.5);
    // ball animation
    const start = performance.now();
    const timer = setInterval(() => {
      const t = performance.now() - start;
      if (t < 1400) { const r = Math.floor(Math.random() * 37); wheel.textContent = r; wheel.style.color = ({ red: '#d66', black: '#ccc', green: '#7fd08a' })[R.rouletteColor(r)]; }
      else {
        clearInterval(timer);
        wheel.textContent = n; wheel.style.color = ({ red: '#e07a6a', black: '#e6ddcc', green: '#7fd08a' })[R.rouletteColor(n)];
        let ret = 0; for (const b of bets) ret += R.roulettePayout(b, n);
        const staked = stakeTotal();
        addChips(game, ret); refresh();
        const net = ret - staked;
        flash.className = 'act-flash ' + (net > 0 ? 'win' : 'lose');
        flash.textContent = `${n} ${R.rouletteColor(n)} — ${net >= 0 ? '+' : ''}${net}`;
        if (net > 0) sfx(game, 'slot_win', 0.6);
        game.bus?.emit('activity:roulette', { net, n });
        if (marked && net > 0 && caughtCheating(game, 0.3)) { reportCheat(game, 'rigged roulette wheel'); toast(game, 'Security clocked the wheel.', 'warn'); }
        bets = []; markBtns();
      }
    }, 60);
  };
  refresh();
  return p;
}

// ═══ CAGE / CASHIER ═══════════════════════════════════════════════════════════
export function openCage(game) {
  const p = new Panel(game, { title: 'Casino Cage', sub: 'Buy & cash out chips', small: true });
  const render = () => {
    p.updateBank();
    p.body.innerHTML = `
      <div class="act-note">Chips are §1 each. The cage buys them back at face value.</div>
      <div class="act-row"><div><div class="nm">Your chips</div><div class="ds">On hand</div></div><div class="pr">${chips(game)}</div></div>
      <div class="act-grid">
        <div style="display:flex;gap:6px;flex-wrap:wrap" data-buy></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px" data-out></div>
      </div>`;
    const buy = p.body.querySelector('[data-buy]');
    for (const v of [50, 100, 250, 500]) {
      const b = document.createElement('button'); b.className = 'act-btn'; b.textContent = 'Buy ' + fmt(v);
      b.disabled = !game.economy?.canAfford(v);
      b.onclick = () => { if (game.economy?.spend(v, 'Casino chips')) { addChips(game, v); sfx(game, 'chips', 0.6); render(); } };
      buy.appendChild(b);
    }
    const out = p.body.querySelector('[data-out]');
    const cashOut = (n) => { if (chips(game) >= n && takeChips(game, n)) { game.economy?.add(n, 'Cashed out chips'); render(); } };
    const half = document.createElement('button'); half.className = 'act-btn ghost'; half.textContent = 'Cash out all';
    half.disabled = chips(game) <= 0; half.onclick = () => cashOut(chips(game));
    out.appendChild(half);
  };
  render();
  return p;
}

// ═══ PROVIDER ═════════════════════════════════════════════════════════════════
export function registerCasino(game, A) {
  A.openSlots = (item) => openSlots(game, item);
  A.openBlackjack = (item) => openBlackjack(game, item);
  A.openRoulette = (item) => openRoulette(game, item);
  A.openCage = () => openCage(game);

  game.interact.addProvider((ctx) => {
    const pl = ctx.player; if (!pl || pl.state === 'dead') return null;
    const plan = game.world.plans[ctx.deck]; if (!plan) return null;
    const out = [];
    for (const it of plan.items) {
      if (!['slot', 'card_table', 'roulette', 'counter'].includes(it.t)) continue;
      const d = Math.hypot(it.x - ctx.x, it.z - ctx.z);
      if (d > 2.0) continue;
      const y = plan.y + 0.9;
      if (it.t === 'slot') out.push({ id: 'slot:' + mk(it), label: 'Play slots', key: 'E', x: it.x, y, z: it.z, dist: d, priority: 2, enabled: true, run: () => openSlots(game, it) });
      else if (it.t === 'card_table') out.push({ id: 'bj:' + mk(it), label: it.game === 'blackjack_hl' ? 'Play high-limit blackjack' : 'Play blackjack', key: 'E', x: it.x, y, z: it.z, dist: d, priority: 2, enabled: true, run: () => openBlackjack(game, it) });
      else if (it.t === 'roulette') out.push({ id: 'roul:' + mk(it), label: 'Play roulette', key: 'E', x: it.x, y, z: it.z, dist: d, priority: 2, enabled: true, run: () => openRoulette(game, it) });
      else if (it.t === 'counter' && (it.role === 'cashier' || it.cageWindow)) out.push({ id: 'cage:' + mk(it), label: 'Cashier', key: 'E', x: it.x, y, z: it.z, dist: d, priority: 2, enabled: true, run: () => openCage(game) });
    }
    return out;
  }, 'casino');
}
function mk(it) { return (it.x * 10 | 0) + ':' + (it.z * 10 | 0); }
