// HALCYON TIDE (mobile) — stylesheets. BOOT_CSS is injected by boot.js before the game loads; HUD_CSS by mobileHud.js.
// Everything is scoped to html.ht-mobile so nothing here can touch the desktop page.
// Safe-area insets are exposed as --sl/--sr/--st/--sb (px) on :root by mobileHud.js (env() fallback here).

export const BOOT_CSS = `
html.ht-mobile{--sl:env(safe-area-inset-left,0px);--sr:env(safe-area-inset-right,0px);--st:env(safe-area-inset-top,0px);--sb:env(safe-area-inset-bottom,0px)}
html.ht-mobile,html.ht-mobile body{touch-action:none;overscroll-behavior:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;
  -webkit-tap-highlight-color:transparent;-webkit-text-size-adjust:100%;text-size-adjust:100%;position:fixed;inset:0;overflow:hidden;width:100%;height:100%}
html.ht-mobile #app,html.ht-mobile #app canvas{touch-action:none}
html.ht-mobile .scroll,html.ht-mobile .act-body,html.ht-mobile .mres{touch-action:pan-y;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}
html.ht-mobile input,html.ht-mobile textarea{-webkit-user-select:text;user-select:text;font-size:16px!important}
html.ht-mobile .loader h1{font-size:44px}
html.ht-mobile .loader .msg{font-size:12px}
#htm-rotate{display:none}
@media (orientation:portrait){
  html.ht-mobile #htm-rotate{display:flex;position:fixed;inset:0;z-index:100000;align-items:center;justify-content:center;text-align:center;
    background:radial-gradient(circle at 50% 40%,#123049,#04070c 75%);color:#f1ece2;font-family:Inter,system-ui,sans-serif;pointer-events:auto;touch-action:none}
  #htm-rotate .rb{padding:24px}
  #htm-rotate .ph{width:120px;height:120px;margin:0 auto 18px;display:block}
  #htm-rotate .dev{transform-origin:60px 60px;animation:htmrot 2.4s cubic-bezier(.6,0,.3,1) infinite}
  #htm-rotate .t{font-family:'Cormorant Garamond',Georgia,serif;font-size:30px;font-weight:600;color:#f6efdf}
  #htm-rotate .s{margin-top:8px;font-size:12px;letter-spacing:.22em;text-transform:uppercase;color:#c9a45b}
}
@keyframes htmrot{0%,20%{transform:rotate(0)}55%,100%{transform:rotate(-90deg)}}
`;

export const HUD_CSS = `
/* ── touch control layer ─────────────────────────────────────────────── */
#htm-hud{position:fixed;inset:0;pointer-events:none;z-index:15;font-family:Inter,system-ui,sans-serif;color:#f1ece2;--bo:.9;--bs:1}
#htm-hud.off .mb,#htm-hud.off .htm-stick,#htm-hud.off .htm-slots,#htm-hud.off .htm-top{display:none}
#htm-hud .mb{position:absolute;left:0;top:0;transform:translate(-50%,-50%);border-radius:50%;pointer-events:auto;touch-action:none;
  display:flex;align-items:center;justify-content:center;flex-direction:column;background:rgba(9,14,21,.42);
  border:1.5px solid rgba(241,236,226,.42);box-shadow:0 2px 10px rgba(0,0,0,.25),inset 0 0 0 1px rgba(0,0,0,.15);opacity:var(--bo);
  -webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);transition:background .08s,border-color .08s,transform .08s}
#htm-hud .mb svg{width:46%;height:46%;pointer-events:none;overflow:visible}
#htm-hud .mb svg *{vector-effect:non-scaling-stroke}
#htm-hud .mb .lb{position:absolute;bottom:-15px;left:50%;transform:translateX(-50%);font:700 9px/1 Inter,sans-serif;letter-spacing:.12em;text-transform:uppercase;
  color:rgba(241,236,226,.8);text-shadow:0 1px 2px #000;white-space:nowrap;pointer-events:none}
#htm-hud .mb.dn{background:rgba(201,164,91,.55);border-color:#e6c784;transform:translate(-50%,-50%) scale(.94)}
#htm-hud .mb.on{background:rgba(201,164,91,.38);border-color:#e6c784}
#htm-hud .mb.hide{display:none}
#htm-hud .mb.dim{opacity:calc(var(--bo) * .45)}
#htm-hud .mb.fire{background:radial-gradient(circle at 50% 45%,rgba(224,96,77,.38),rgba(9,14,21,.5) 70%);border:2px solid rgba(241,236,226,.6)}
#htm-hud .mb.fire::after{content:'';position:absolute;inset:7px;border-radius:50%;border:1.5px dashed rgba(241,236,226,.28)}
#htm-hud .mb.fire.dn{background:rgba(224,96,77,.7)}
#htm-hud .mb.fire svg{width:52%;height:52%}
#htm-hud .mb .cnt{position:absolute;top:-6px;right:-6px;min-width:20px;height:20px;padding:0 5px;border-radius:10px;background:#c9a45b;color:#14100a;font:700 11px/20px Inter,sans-serif;text-align:center}
#htm-hud .mb .ring{position:absolute;inset:-5px;width:calc(100% + 10px);height:calc(100% + 10px);transform:rotate(-90deg);pointer-events:none}
#htm-hud .mb .ring circle{fill:none;stroke:#e6c784;stroke-width:4;stroke-linecap:round}
#htm-hud .mb.small{border-width:1.2px}
/* contextual interact pill */
#htm-hud .mb.pill{border-radius:30px;flex-direction:row;justify-content:flex-start;gap:9px;padding:0 16px 0 6px;width:auto!important;max-width:240px;
  background:rgba(9,14,21,.66);border-color:rgba(230,199,132,.75);animation:htmpop .16s ease-out}
#htm-hud .mb.pill .ic{flex:none;position:relative;border-radius:50%;background:#f1ece2;color:#11161d;display:flex;align-items:center;justify-content:center}
#htm-hud .mb.pill .ic svg{width:56%;height:56%}
#htm-hud .mb.pill .ic svg *{stroke:#11161d}
#htm-hud .mb.pill .tx{display:flex;flex-direction:column;min-width:0}
#htm-hud .mb.pill .tx b{font:600 14px/1.15 Inter,sans-serif;color:#f6efdf;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:170px}
#htm-hud .mb.pill .tx small{font:600 9.5px/1.2 Inter,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#c9a45b;margin-top:2px}
#htm-hud .mb.pill.off{border-color:rgba(160,166,174,.5)}
#htm-hud .mb.pill.off .ic{background:#59606a}
#htm-hud .mb.pill.off .tx small{color:#c98a72}
#htm-hud .mb.pill.alt{border-color:rgba(232,122,96,.75)}
#htm-hud .mb.pill.alt .ic{background:#e8806a}
#htm-hud .mb.pill.dn{transform:translate(-50%,-50%) scale(.96);background:rgba(201,164,91,.4)}
@keyframes htmpop{from{transform:translate(-50%,-50%) scale(.85);opacity:0}to{transform:translate(-50%,-50%) scale(1)}}
/* joystick */
.htm-stick{position:absolute;left:0;top:0;pointer-events:none;opacity:.55;transition:opacity .15s}
.htm-stick.act{opacity:1}
.htm-stick .base{position:absolute;border-radius:50%;transform:translate(-50%,-50%);border:2px solid rgba(241,236,226,.45);
  background:radial-gradient(circle,rgba(9,14,21,.12),rgba(9,14,21,.38));box-shadow:0 0 0 1px rgba(0,0,0,.15)}
.htm-stick .base::before{content:'';position:absolute;inset:-14%;border-radius:50%;border:1px dashed rgba(241,236,226,.18)}
.htm-stick .knob{position:absolute;border-radius:50%;transform:translate(-50%,-50%);background:rgba(241,236,226,.82);box-shadow:0 2px 8px rgba(0,0,0,.4);border:2px solid #fff}
.htm-stick.spr .knob{background:#e6c784;border-color:#fff6dc}
.htm-stick .arrows{position:absolute;transform:translate(-50%,-50%);pointer-events:none}
.htm-lock{position:absolute;transform:translate(-50%,-50%);width:46px;height:46px;border-radius:50%;display:none;align-items:center;justify-content:center;
  background:rgba(9,14,21,.55);border:1.5px solid rgba(241,236,226,.5);pointer-events:none}
.htm-lock svg{width:22px;height:22px}
.htm-lock.show{display:flex}
.htm-lock.hot,.htm-lock.locked{background:rgba(201,164,91,.7);border-color:#fff2d0}
.htm-lock .lt{position:absolute;top:-16px;font:700 9px/1 Inter,sans-serif;letter-spacing:.14em;color:#e6c784;text-shadow:0 1px 2px #000;white-space:nowrap}
/* weapon slots */
.htm-slots{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(var(--sb) + 6px);display:flex;gap:6px;pointer-events:none;opacity:var(--bo)}
.htm-slot{pointer-events:auto;touch-action:none;position:relative;width:58px;height:46px;border-radius:9px;background:rgba(9,14,21,.5);border:1.5px solid rgba(241,236,226,.25);
  display:flex;align-items:center;justify-content:center}
.htm-slot svg{width:30px;height:30px}
.htm-slot .n{position:absolute;left:5px;top:3px;font:700 9px/1 Inter,sans-serif;color:rgba(241,236,226,.55)}
.htm-slot .am{position:absolute;right:4px;bottom:3px;font:700 10px/1 Inter,sans-serif;color:#f6efdf;font-variant-numeric:tabular-nums;text-shadow:0 1px 2px #000}
.htm-slot.cur{border-color:#e6c784;background:rgba(201,164,91,.3);box-shadow:0 0 10px rgba(201,164,91,.35)}
.htm-slot.cur .n{color:#e6c784}
.htm-slot.dn{transform:scale(.94)}
.htm-slot .bar{position:absolute;left:5px;right:5px;bottom:2px;height:2px;border-radius:1px;background:rgba(255,255,255,.15);overflow:hidden}
.htm-slot .bar i{display:block;height:100%;background:#e8b04a;transform-origin:left}
/* top-right system buttons */
.htm-top{position:absolute;right:calc(var(--sr) + 8px);top:calc(var(--st) + 8px);display:flex;gap:8px;pointer-events:none;opacity:var(--bo)}
.htm-top .tb{pointer-events:auto;touch-action:none;width:44px;height:44px;border-radius:12px;background:rgba(9,14,21,.5);border:1.5px solid rgba(241,236,226,.3);
  display:flex;align-items:center;justify-content:center}
.htm-top .tb svg{width:22px;height:22px}
.htm-top .tb.dn{background:rgba(201,164,91,.5)}
.htm-top .tb .dot{position:absolute;margin:-26px -26px 0 0;width:9px;height:9px;border-radius:50%;background:#e0604d;display:none}
.htm-top .tb.badge .dot{display:block}
/* close button over panels */
#htm-close{position:fixed;right:calc(var(--sr) + 10px);top:calc(var(--st) + 10px);width:46px;height:46px;border-radius:50%;z-index:200;display:none;
  align-items:center;justify-content:center;background:rgba(9,14,21,.8);border:1.5px solid rgba(230,199,132,.7);pointer-events:auto;touch-action:none}
#htm-close svg{width:20px;height:20px}
#htm-close.on{display:flex}
/* map touch extras */
#htm-mapx{position:fixed;right:calc(var(--sr) + 12px);bottom:calc(var(--sb) + 12px);z-index:200;display:none;flex-direction:column;gap:8px;pointer-events:none}
#htm-mapx.on{display:flex}
#htm-mapx button{pointer-events:auto;touch-action:none;width:46px;height:46px;border-radius:50%;background:rgba(9,14,21,.85);border:1.5px solid rgba(241,236,226,.35);color:#f1ece2;
  font:600 22px/1 Inter,sans-serif;display:flex;align-items:center;justify-content:center;padding:0}
#htm-mapx button.wpc{font-size:10px;letter-spacing:.06em;line-height:1.1;text-transform:uppercase;font-weight:700;color:#8fd0ff}
#htm-mapx button svg{width:20px;height:20px}
/* CCTV console controls */
#htm-cctv{position:fixed;inset:0;z-index:200;display:none;pointer-events:none}
#htm-cctv.on{display:block}
#htm-cctv button{position:absolute;pointer-events:auto;touch-action:none;min-width:52px;height:52px;padding:0 14px;border-radius:26px;background:rgba(0,0,0,.6);border:1.5px solid rgba(216,245,220,.5);
  color:#d8f5dc;font:700 13px/1 'Courier New',monospace;letter-spacing:.08em}
#htm-cctv button:active{background:rgba(216,245,220,.3)}
/* layout editor */
#htm-edit{position:fixed;inset:0;z-index:300;display:none;pointer-events:auto;touch-action:none;background:rgba(3,6,10,.45)}
#htm-edit.on{display:block}
#htm-edit .grid{position:absolute;inset:0;background-image:linear-gradient(rgba(241,236,226,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(241,236,226,.05) 1px,transparent 1px);background-size:24px 24px;pointer-events:none}
#htm-edit .eb{position:absolute;transform:translate(-50%,-50%);border-radius:50%;border:2px dashed rgba(241,236,226,.6);background:rgba(9,14,21,.55);
  display:flex;align-items:center;justify-content:center;touch-action:none}
#htm-edit .eb svg{width:46%;height:46%;pointer-events:none}
#htm-edit .eb .el{position:absolute;bottom:-14px;font:700 9px/1 Inter,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:#e6c784;white-space:nowrap;text-shadow:0 1px 2px #000;pointer-events:none}
#htm-edit .eb.sel{border-style:solid;border-color:#e6c784;background:rgba(201,164,91,.35);box-shadow:0 0 0 4px rgba(201,164,91,.2)}
#htm-edit .eb.pillish{border-radius:26px}
#htm-edit .bar{position:absolute;left:50%;top:calc(var(--st) + 8px);transform:translateX(-50%);display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:14px;
  background:rgba(9,14,21,.92);border:1px solid rgba(201,164,91,.5);font:600 12px/1 Inter,sans-serif;color:#f1ece2;white-space:nowrap}
#htm-edit .bar .nm{min-width:84px;color:#e6c784;letter-spacing:.06em;text-transform:uppercase;font-size:11px}
#htm-edit .bar input[type=range]{width:120px;accent-color:#c9a45b;touch-action:none}
#htm-edit .bar button{height:38px;padding:0 14px;border-radius:9px;border:1px solid rgba(241,236,226,.25);background:rgba(241,236,226,.06);color:#f1ece2;font:600 12px Inter,sans-serif;touch-action:none}
#htm-edit .bar button.pri{background:#c9a45b;color:#1a140a;border-color:#c9a45b}
#htm-edit .hint{position:absolute;left:50%;bottom:calc(var(--sb) + 70px);transform:translateX(-50%);font:500 12px/1.4 Inter,sans-serif;color:#cfc7b6;text-align:center;pointer-events:none;text-shadow:0 1px 3px #000}

/* ── desktop HUD re-layout for a 6" landscape screen ─────────────────── */
html.ht-mobile .hx .mm{left:calc(var(--sl) + 8px);top:calc(var(--st) + 6px);bottom:auto;transform:scale(.62);transform-origin:0 0;pointer-events:auto}
html.ht-mobile .hx .loc{left:calc(var(--sl) + 10px);top:calc(var(--st) + 6px + 9.7em);bottom:auto;max-width:12em;padding:.2em .2em;background:none}
html.ht-mobile .hx .loc .r{font-size:1.05em}
html.ht-mobile .hx .loc .dn{font-size:max(.6em,8.5px);margin-top:.25em;letter-spacing:.16em}
html.ht-mobile .hx .tl{left:calc(var(--sl) + 9.4em);top:calc(var(--st) + 6px);width:14.5em;gap:.35em}
html.ht-mobile .hx .obj{width:14.5em;padding:.45em .7em .5em .65em;pointer-events:auto}
html.ht-mobile .hx .obj .k{font-size:.56em;letter-spacing:.2em}
html.ht-mobile .hx .obj .t{font-size:1.08em;margin:.08em 0}
html.ht-mobile .hx .obj ul{margin-top:.3em}
html.ht-mobile .hx .obj .x{display:none}
html.ht-mobile .hx .obj li{font-size:max(.8em,10.5px);margin:.18em 0}
html.ht-mobile .hx .obj li.done{display:none}
html.ht-mobile .hx .obj li:not(.done)~li:not(.done)~li{display:none}
html.ht-mobile .hx .obj .d{margin-top:.3em;font-size:max(.72em,9.5px);max-width:100%;line-height:1.25}
html.ht-mobile .hx .obj.mini ul,html.ht-mobile .hx .obj.mini .k{display:none}
html.ht-mobile .hx .wpchip{font-size:.8em}
html.ht-mobile .hx .tl .obj:not(.off)~.wpchip{display:none}
html.ht-mobile .hx .tr{right:calc(var(--sr) + 166px);top:calc(var(--st) + 8px)}
html.ht-mobile .hx .tr::before{display:none}
html.ht-mobile .hx .tr .clock{font-size:1.2em}
html.ht-mobile .hx .tr .day{font-size:.55em;margin-top:.3em;letter-spacing:.18em}
html.ht-mobile .hx .tr .cash{font-size:.95em;margin-top:.3em}
html.ht-mobile .hx .tr .credit{display:none}
html.ht-mobile .hx .toasts{top:calc(var(--st) + 58px)}
html.ht-mobile .hx .toasts.low{top:calc(var(--st) + 92px)}
html.ht-mobile .hx .toast{font-size:.86em;max-width:44vw}
html.ht-mobile .hx .notes{right:calc(var(--sr) + 74px);top:calc(var(--st) + 58px);width:15em;font-size:.86em}
html.ht-mobile .hx .note:nth-last-child(n+3){display:none}
html.ht-mobile .hx .note .tx{-webkit-line-clamp:2}
html.ht-mobile .hx .note{padding:.55em .7em}
html.ht-mobile .hx .subs{bottom:calc(var(--sb) + 74px);width:44vw}
html.ht-mobile .hx .sub{font-size:.95em;padding:.35em .8em}
html.ht-mobile .hx .sub.pa .tx{font-size:1em}
html.ht-mobile .hx .saving{left:calc(var(--sl) + 12px);bottom:auto;top:calc(var(--st) + 8.6em)}
html.ht-mobile .hx .fps{left:50%;right:auto;bottom:auto;top:calc(var(--st) + 2px);transform:translateX(-50%);font-size:.75em}
html.ht-mobile .hx .liftp{right:calc(var(--sr) + 280px);top:calc(var(--st) + 70px);width:11em}
html.ht-mobile .hx .wm .l{font-size:max(.7em,9.5px)}
html.ht-mobile .ph-prompt,html.ht-mobile .ph-hint{display:none!important}
html.ht-mobile .ph-vitals{bottom:calc(var(--sb) + 62px)}
html.ht-mobile .ph-bar{width:200px;height:4px}
html.ht-mobile .sh-weapon{display:none!important}
html.ht-mobile .sh-busted,html.ht-mobile .sh-title,html.ht-mobile .sh-root,html.ht-mobile .sh-fade{pointer-events:none}
html.ht-mobile .sh-heat{top:calc(var(--st) + 6px)}
html.ht-mobile .sh-wheel{width:18px;height:18px}
html.ht-mobile .sh-wanted{max-width:40vw;font-size:10.5px}
html.ht-mobile .sh-radio{left:50%;transform:translateX(-50%);bottom:auto;top:calc(var(--st) + 120px);width:min(320px,40vw)}
html.ht-mobile .sh-toast{bottom:calc(var(--sb) + 112px)}
html.ht-mobile .sh-toast div{max-width:46vw;font-size:12px}
html.ht-mobile .sh-pa{top:calc(var(--st) + 100px);max-width:46vw;font-size:12px}
html.ht-mobile .sh-surr{bottom:calc(var(--sb) + 112px)!important}
html.ht-mobile .sh-cctv .sh-ctl{display:none}
html.ht-mobile .sh-cctv .shc-hdr,html.ht-mobile .sh-cctv .shc-ts{font-size:12px;top:calc(var(--st) + 12px)}
html.ht-mobile .sh-cctv .shc-hdr{left:calc(var(--sl) + 16px)}
html.ht-mobile .sh-dlg{max-width:80vw}
html.ht-mobile .sh-dlg button{min-height:44px;font-size:14px}

/* ── elevator deck selector ─────────────────────────────────────────── */
html.ht-mobile .lift-ui{right:calc(var(--sr) + 10px);width:236px;padding:10px;max-height:calc(100% - 20px)}
html.ht-mobile .lift-ui .lu-top{margin-bottom:6px}
html.ht-mobile .lift-ui .lu-cur{font-size:24px}
html.ht-mobile .lift-ui .lu-grid{grid-template-columns:repeat(4,1fr);gap:5px}
html.ht-mobile .lift-ui button{height:44px;line-height:44px;border-radius:12px;font-size:16px}
html.ht-mobile .lift-ui button.wide{grid-column:span 4;height:40px;line-height:40px}
html.ht-mobile .lift-ui .lu-hint{display:none}
html.ht-mobile.htm-busy .lift-ui{display:none}

/* ── panels: compact chrome, ≥44 px targets, no keyboard hints ──────── */
html.ht-mobile .pfoot{display:none!important}
html.ht-mobile .ptop{padding:calc(var(--st) + .8em) calc(var(--sr) + 66px) .6em calc(var(--sl) + 1.4em);gap:1em;align-items:center;flex-wrap:nowrap}
html.ht-mobile .ptop h1{font-size:1.7em}
html.ht-mobile .ptabs{margin-left:.4em;overflow-x:auto;scrollbar-width:none;touch-action:pan-x}
html.ht-mobile .ptab{min-height:44px;padding:.4em .9em;font-size:.8em;white-space:nowrap}
html.ht-mobile .ptop .money{font-size:.72em}
html.ht-mobile .pbody{padding:.8em calc(var(--sr) + 1.4em) calc(var(--sb) + .8em) calc(var(--sl) + 1.4em);gap:1.2em}
html.ht-mobile .btn{min-height:44px;padding:.6em 1.2em}
html.ht-mobile .chip{min-height:36px;padding:.5em 1em;font-size:.82em}
html.ht-mobile .igrid{grid-template-columns:repeat(auto-fill,minmax(6.6em,1fr));grid-auto-rows:6.6em;gap:.5em}
html.ht-mobile .idet{width:19em;padding:1em}
html.ht-mobile .idet .em{font-size:2.4em}
html.ht-mobile .idet h3{font-size:1.4em}
html.ht-mobile .srowi{padding:.6em .6em;min-height:52px}
html.ht-mobile .srowi .btn{min-width:6em}
html.ht-mobile .pause .side{width:15em;padding:calc(var(--st) + 1.2em) 0 1em calc(var(--sl) + 1.6em)}
html.ht-mobile .pause .logo{font-size:2em}
html.ht-mobile .pause .when{margin-bottom:1em;font-size:.68em}
html.ht-mobile .pause .menu{overflow-y:auto;touch-action:pan-y}
html.ht-mobile .mi{min-height:38px;padding:.15em 0;font-size:1.22em}
html.ht-mobile .pause .psub{padding:calc(var(--st) + 1.2em) calc(var(--sr) + 4.4em) calc(var(--sb) + .8em) 1em}
html.ht-mobile .pause .psub h2{font-size:1.5em}
html.ht-mobile .pause .psub .hint{margin-bottom:.8em}
html.ht-mobile .srow{grid-template-columns:minmax(9em,13em) 1fr 3.4em;gap:.8em;padding:.35em 0;min-height:48px}
html.ht-mobile .seg button{min-height:40px}
html.ht-mobile .rng{height:36px}
html.ht-mobile .slots{grid-template-columns:repeat(2,minmax(0,1fr))}
html.ht-mobile .slot{padding:.8em}
html.ht-mobile .ctl{display:none}
html.ht-mobile .pause .mi[data-k=controls]{display:none}
html.ht-mobile .jcard{padding:.8em 1em}
/* map */
html.ht-mobile .map .ptop{padding-bottom:.4em}
html.ht-mobile .map .msearch{width:15em}
html.ht-mobile .decks{left:calc(var(--sl) + .8em);top:4.6em;width:9.6em;max-height:calc(100% - 5.4em - var(--sb));overflow-y:auto;touch-action:pan-y;flex-wrap:nowrap}
html.ht-mobile .dk{flex:0 0 auto;min-height:36px;padding:0 .6em;font-size:.86em}
html.ht-mobile .dk span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
html.ht-mobile .legend{display:none}
html.ht-mobile .prof{display:none}
html.ht-mobile .mres button{min-height:44px}
html.ht-mobile .map .mcv{touch-action:none}
/* dialogue */
html.ht-mobile .dlg{bottom:calc(var(--sb) + 3vh);width:min(56em,80vw)}
html.ht-mobile .dlg .ln{font-size:1.12em;min-height:2.4em}
html.ht-mobile .dlg .op{min-height:44px;font-size:1em;padding:.5em .9em}
html.ht-mobile .dlg .op .kc{display:none}
html.ht-mobile .dlg .more .kc{display:none}
html.ht-mobile .dlgshade{height:80vh}
/* title */
html.ht-mobile .title .lft{left:calc(var(--sl) + 5vw);width:auto}
html.ht-mobile .title .logo{font-size:4em}
html.ht-mobile .title .tag{font-size:1.15em;margin:.5em 0 1em;white-space:normal;max-width:24em}
html.ht-mobile .title .sublogo{margin-bottom:.8em}
html.ht-mobile .title .menu .mi{font-size:1.45em;min-height:44px;padding:.15em 0}
html.ht-mobile .title .foot{display:none}
html.ht-mobile .title .card{right:calc(var(--sr) + 5vw);bottom:calc(var(--sb) + 5vh)}
html.ht-mobile .title .credits{left:calc(var(--sl) + 5vw);width:min(34em,80vw);max-height:90vh;overflow-y:auto}
html.ht-mobile .title .mi.fs{font-family:Inter,sans-serif;font-size:.86em;letter-spacing:.18em;text-transform:uppercase;color:var(--brass2);display:flex;align-items:center;gap:.6em;margin-top:.6em}
html.ht-mobile .title .mi.fs svg{width:1.2em;height:1.2em}
/* activity panels (casino, shops, fence, wardrobe) */
html.ht-mobile .act-scrim{padding:calc(var(--st) + 6px) calc(var(--sr) + 6px) calc(var(--sb) + 6px) calc(var(--sl) + 6px)}
html.ht-mobile .act-panel{max-height:calc(100vh - 12px)!important;max-width:calc(100vw - 24px)!important;touch-action:pan-y}
html.ht-mobile .act-x{width:44px!important;height:44px!important;font-size:20px!important}
html.ht-mobile .act-btn{min-height:44px;padding:10px 18px!important;font-size:14px!important}
html.ht-mobile .act-chip{min-height:44px;min-width:56px;font-size:14px}
`;
