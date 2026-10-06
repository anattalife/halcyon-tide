// HALCYON TIDE — UI stylesheet (injected once). All sizes in em relative to .hx (scaled by viewport in ui.js).
export const CSS = `
.hx{position:fixed;inset:0;pointer-events:none;font-family:Inter,system-ui,sans-serif;color:#f1ece2;font-size:calc(16px * var(--hs,1));
  --navy:#0b1520;--navy2:#111e2c;--ink:rgba(8,13,20,.74);--ivory:#f1ece2;--ivory2:#cfc7b6;--mute:#8e99a5;--brass:#c9a45b;--brass2:#e6c784;--red:#e0604d;--blue:#62a8ff;--good:#86c79f;
  --serif:'Cormorant Garamond','Lora',Georgia,serif;-webkit-font-smoothing:antialiased;user-select:none;-webkit-user-select:none;z-index:10}
.hx *{box-sizing:border-box}
.hx.titling .toasts,.hx.titling .notes,.hx.titling .subs,.hx.titling .saving{display:none}
.hx .serif{font-family:var(--serif)}
.hx .num{font-variant-numeric:tabular-nums}
:where(.hx) button{font:inherit;color:inherit}
.hx svg{display:block}

/* ── HUD ───────────────────────────────────────────────────────────── */
.hud{position:absolute;inset:0;transition:opacity .45s ease}
.hud.hide{opacity:0}
.hud .sh{text-shadow:0 1px 2px rgba(0,0,0,.75),0 0 18px rgba(0,0,0,.35)}
.tl{position:absolute;left:2.4em;top:2.2em;width:23em;display:flex;flex-direction:column;align-items:flex-start;gap:.7em}
.obj{position:relative;width:23em;padding:.9em 1.2em 1em 1.15em;border-left:2px solid var(--brass);border-radius:0 .45em .45em 0;
  background:linear-gradient(90deg,rgba(7,12,19,.86),rgba(7,12,19,.74) 70%,rgba(7,12,19,.5));backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);
  box-shadow:0 .4em 1.6em rgba(0,0,0,.28);text-shadow:0 1px 2px rgba(0,0,0,.85);transition:opacity .4s,transform .4s}
.obj.off{opacity:0;transform:translateX(-1em)}
.obj .k{font-size:.66em;letter-spacing:.24em;text-transform:uppercase;color:var(--brass);font-weight:600}
.obj .t{font-family:var(--serif);font-size:1.6em;line-height:1.1;font-weight:600;margin:.18em 0 .2em;color:#f6f0e3}
.obj .x{font-size:max(.9em,11px);line-height:1.4;color:#ddd5c5}
.obj ul{list-style:none;margin:.55em 0 0;padding:0}
.obj li{display:flex;align-items:flex-start;gap:.6em;font-size:max(.92em,11.5px);line-height:1.35;color:#f6f1e6;margin:.3em 0}
.obj li i{flex:none;width:.95em;height:.95em;margin-top:.17em;border:1.5px solid rgba(241,236,226,.6);border-radius:2px;display:flex;align-items:center;justify-content:center}
.obj li.done{color:#a9b2bb;text-decoration:line-through;text-decoration-color:rgba(142,153,165,.6)}
.obj li.done i{background:var(--brass);border-color:var(--brass);color:#14100a}
.obj li.done i svg{width:.8em;height:.8em}
.obj .d{display:inline-flex;align-items:center;gap:.5em;margin-top:.65em;padding:.32em .75em .32em .55em;border-radius:1em;background:rgba(201,164,91,.16);border:1px solid rgba(201,164,91,.38);font-size:max(.86em,11px);color:#f3d79b;font-weight:600;letter-spacing:.03em}
.obj .d svg{width:1.05em;height:1.05em;flex:none}
.obj .d:empty{display:none}
.wpchip{position:relative;display:flex;align-items:center;gap:.55em;padding:.5em .9em .5em .7em;border-radius:2em;background:rgba(7,12,19,.78);border:1px solid rgba(143,208,255,.25);
  font-size:max(.86em,11px);color:#f6f1e6;text-shadow:0 1px 2px rgba(0,0,0,.8);transition:opacity .3s}
.wpchip svg{width:1.1em;height:1.1em;color:var(--brass)}
.wpchip b{color:#f3d79b;font-weight:600}
.wpchip.off{display:none}
.obj.off{display:none}

.tr{position:absolute;right:2.4em;top:2em;text-align:right}
.tr::before{content:'';position:absolute;right:-2.4em;top:-2em;width:22em;height:12em;background:radial-gradient(ellipse at 88% 22%,rgba(5,9,15,.32),rgba(5,9,15,0) 65%);z-index:-1}
.tr .clock{font-size:1.7em;font-weight:600;letter-spacing:.02em;line-height:1}
.tr .day{font-size:.66em;letter-spacing:.26em;text-transform:uppercase;color:var(--ivory2);margin-top:.5em;font-weight:500}
.tr .cash{font-size:1.25em;font-weight:600;color:var(--brass2);margin-top:.55em;line-height:1;transition:color .3s}
.tr .cash.up{color:var(--good)}.tr .cash.down{color:#e39a89}
.tr .credit{font-size:.68em;color:var(--ivory2);letter-spacing:.08em;margin-top:.3em}
.heat{display:flex;justify-content:flex-end;align-items:center;gap:.32em;margin-top:.8em;transition:opacity .4s}
.heat.off{opacity:0}
.heat .lbl{font-size:.66em;letter-spacing:.2em;text-transform:uppercase;font-weight:600;color:#ffb2a4;margin-right:.6em}
.heat i{width:.72em;height:.72em;transform:rotate(45deg);border:1.5px solid rgba(255,255,255,.35);background:transparent}
.heat i.on{background:var(--red);border-color:var(--red);box-shadow:0 0 .6em rgba(224,96,77,.7)}
.heat.rise i.on{animation:hxflash .5s steps(2) 6}
@keyframes hxflash{50%{background:#fff;border-color:#fff}}

.mm{position:absolute;left:2.2em;bottom:2.2em;width:14em;height:14em}
.mm canvas{position:absolute;inset:.75em;width:12.5em;height:12.5em;border-radius:50%}
.mm svg.ring{position:absolute;inset:0;width:14em;height:14em;overflow:visible}
.mm .deckb{position:absolute;left:50%;bottom:-.25em;transform:translateX(-50%);padding:.18em .7em;border-radius:1em;background:var(--navy);border:1px solid rgba(201,164,91,.7);
  font-size:max(.74em,10px);font-weight:700;letter-spacing:.18em;color:#f3d79b;white-space:nowrap}
.loc{position:absolute;left:17.2em;bottom:2.7em;max-width:26em;padding:.55em .9em .6em;border-radius:.45em;background:linear-gradient(90deg,rgba(7,12,19,.62),rgba(7,12,19,0));text-shadow:0 1px 2px rgba(0,0,0,.9),0 0 10px rgba(0,0,0,.5)}
.loc .r{font-family:var(--serif);font-size:1.45em;font-weight:600;line-height:1.1;color:#f6f0e3}
.loc .dn{font-size:max(.72em,9.5px);letter-spacing:.22em;text-transform:uppercase;color:#e2bf78;font-weight:600;margin-top:.45em}
.loc .dis{font-size:.64em;letter-spacing:.18em;text-transform:uppercase;color:var(--blue);font-weight:600;margin-top:.35em}
.loc .dis:empty{display:none}
.fps{position:absolute;right:.8em;bottom:.6em;font:600 .7em/1 Inter;color:#9fb0c0;opacity:.8}

.subs{position:absolute;left:50%;bottom:calc(5em + 3%);transform:translateX(-50%);width:min(52em,80vw);display:flex;flex-direction:column;align-items:center;gap:.5em}
.sub{max-width:100%;padding:.5em 1em;border-radius:.3em;background:rgba(6,10,16,.66);font-size:1.12em;line-height:1.4;text-align:center;color:#f4efe5;
  animation:hxin .25s ease-out both;transition:opacity .4s}
.sub b{color:var(--brass2);font-weight:600;margin-right:.35em}
.sub.pa{background:linear-gradient(180deg,rgba(14,26,40,.86),rgba(9,17,27,.86));border:1px solid rgba(201,164,91,.45);padding:.7em 1.3em .8em;max-width:46em}
.sub.pa .h{display:flex;align-items:center;justify-content:center;gap:.5em;font-size:.62em;letter-spacing:.28em;text-transform:uppercase;color:var(--brass);font-weight:700;margin-bottom:.4em}
.sub.pa .h svg{width:1.3em;height:1.3em}
.sub.pa .tx{font-family:var(--serif);font-style:italic;font-size:1.18em;line-height:1.35}
.sub.out{opacity:0}
@keyframes hxin{from{opacity:0;transform:translateY(.4em)}to{opacity:1;transform:none}}

.toasts{position:absolute;left:50%;top:2.2em;transition:top .3s;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:.45em;z-index:5}
.toasts.low{top:8.5em}
.toast{display:flex;align-items:center;gap:.6em;padding:.55em 1.1em .55em .9em;border-radius:2em;background:rgba(8,13,20,.78);border:1px solid rgba(255,255,255,.1);
  font-size:.86em;font-weight:500;color:var(--ivory);white-space:nowrap;animation:hxdrop .3s cubic-bezier(.2,.8,.2,1) both;transition:opacity .35s,transform .35s;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
.toast i{width:.5em;height:.5em;border-radius:50%;background:var(--ivory2);flex:none}
.toast.good i{background:var(--good)}.toast.bad i{background:var(--red)}.toast.warn i{background:#e8a54a}.toast.mission i{background:var(--brass)}
.toast.mission{border-color:rgba(201,164,91,.55);color:#f6ecd4}
.toast.out{opacity:0;transform:translateY(-.5em)}
@keyframes hxdrop{from{opacity:0;transform:translateY(-.6em)}to{opacity:1;transform:none}}

.notes{position:absolute;right:2.2em;top:12.5em;width:21em;display:flex;flex-direction:column;gap:.55em}
.note{display:flex;gap:.8em;padding:.8em .95em;border-radius:.9em;background:rgba(18,26,36,.82);border:1px solid rgba(255,255,255,.08);box-shadow:0 .8em 2em rgba(0,0,0,.35);
  backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);animation:hxslide .4s cubic-bezier(.2,.8,.2,1) both;transition:opacity .4s,transform .4s}
.note .ic{flex:none;width:2.3em;height:2.3em;border-radius:.6em;background:linear-gradient(160deg,#1f3550,#122236);display:flex;align-items:center;justify-content:center;color:var(--brass2);font-size:1.1em}
.note .ic svg{width:1.15em;height:1.15em}
.note .bd{min-width:0;flex:1}
.note .tt{display:flex;justify-content:space-between;gap:.5em;font-size:.82em;font-weight:600;color:#f6f0e3}
.note .tt span{font-weight:500;color:var(--mute);font-size:.9em}
.note .tx{font-size:.8em;line-height:1.35;color:var(--ivory2);margin-top:.2em;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.note.out{opacity:0;transform:translateX(1.5em)}
@keyframes hxslide{from{opacity:0;transform:translateX(1.5em)}to{opacity:1;transform:none}}

.saving{position:absolute;left:3.4em;bottom:23.7em;display:flex;align-items:center;gap:.5em;font-size:.72em;letter-spacing:.18em;text-transform:uppercase;color:var(--ivory2);opacity:0;transition:opacity .5s}
.saving.on{opacity:1}
.saving svg{width:1.3em;height:1.3em;color:var(--brass);animation:hxspin 1.2s linear infinite}
@keyframes hxspin{to{transform:rotate(360deg)}}

/* lift ride progress (next to the car panel) */
.liftp{position:fixed;right:2.2em;top:40%;width:13.5em;padding:.75em .9em .8em;border-radius:.8em;background:rgba(7,12,19,.8);border:1px solid rgba(201,164,91,.35);
  backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);opacity:0;transform:translateX(.6em);transition:opacity .25s,transform .25s;pointer-events:none}
.liftp.on{opacity:1;transform:none}
.liftp .lh{display:flex;align-items:center;justify-content:center;gap:.5em;font:600 1.9em/1 'Courier New',monospace;color:#ffb052;text-shadow:0 0 .4em rgba(255,150,40,.5)}
.liftp .la{font-style:normal;font-size:.6em}
.liftp .lt{color:#ffe0b0;opacity:.75;font-size:.62em}
.liftp .lb{height:.32em;margin:.6em 0 .45em;border-radius:.2em;background:rgba(255,255,255,.12);overflow:hidden}
.liftp .lb i{display:block;height:100%;background:linear-gradient(90deg,#c9a45b,#ffcf7a);transform-origin:left;transform:scaleX(0);transition:transform .12s linear}
.liftp .le{font-size:.74em;text-align:center;color:#ddd5c5;letter-spacing:.03em}

/* in-world markers */
.wm{position:absolute;left:0;top:0;display:flex;flex-direction:column;align-items:center;gap:.15em;transform:translate(-50%,-100%);transition:opacity .25s;will-change:transform}
.wm .g{width:1.5em;height:1.5em;color:var(--brass2);filter:drop-shadow(0 0 .3em rgba(0,0,0,.8))}
.wm.wp .g{color:#8fd0ff}
.wm .l{font-size:max(.8em,10.5px);font-weight:600;letter-spacing:.04em;color:#f6f0e3;text-shadow:0 1px 2px #000,0 0 8px #000;white-space:nowrap}
.wm.edge .l{display:none}
.wm.off{opacity:0}

/* ── overlays: fade, bars, chapter title ───────────────────────────── */
.fade{position:absolute;inset:0;background:#03060a;opacity:0;transition:opacity .6s ease;z-index:80}
.bars i{position:absolute;left:0;right:0;height:11vh;background:#000;transition:transform .7s cubic-bezier(.6,0,.2,1);z-index:30}
.bars i:first-child{top:0;transform:translateY(-100%)}.bars i:last-child{bottom:0;transform:translateY(100%)}
.bars.on i{transform:none}
.chap{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:40;opacity:0;transition:opacity 1.2s ease;pointer-events:none}
.chap.on{opacity:1}
.chap .rule{width:0;height:1px;background:linear-gradient(90deg,transparent,var(--brass),transparent);transition:width 1.6s cubic-bezier(.2,.8,.2,1) .2s}
.chap.on .rule{width:22em}
.chap .t{font-family:var(--serif);font-weight:500;font-size:4.2em;letter-spacing:.04em;color:#f6efdf;margin:.15em 0 .1em;text-shadow:0 .1em 1em rgba(0,0,0,.6)}
.chap .s{font-size:.82em;letter-spacing:.42em;text-transform:uppercase;color:var(--brass2);font-weight:600;margin-bottom:.9em;text-shadow:0 1px 4px #000}

/* ── panels (shared chrome) ────────────────────────────────────────── */
.scrim{position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse at 30% 40%,rgba(10,22,36,.8),rgba(3,6,10,.93));backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
  opacity:0;visibility:hidden;transition:opacity .2s ease,visibility 0s linear .2s;z-index:50}
.scrim.on{opacity:1;visibility:visible;pointer-events:auto;transition:opacity .2s ease,visibility 0s}
.pnl{position:absolute;inset:0;display:flex;flex-direction:column;pointer-events:auto;opacity:0;transform:scale(1.01);transition:opacity .28s ease,transform .28s ease;z-index:60}
.pnl.on{opacity:1;transform:none}
.pnl.instant{transition:none!important}
.ptop{flex:none;display:flex;align-items:flex-end;gap:2em;padding:2.2em 3em 1.2em;border-bottom:1px solid rgba(201,164,91,.22)}
.ptop .brand{font-size:.62em;letter-spacing:.42em;color:var(--brass);font-weight:600;text-transform:uppercase}
.ptop h1{font-family:var(--serif);font-weight:500;font-size:2.4em;line-height:1;margin:.12em 0 0;color:#f6efdf;letter-spacing:.01em}
.ptabs{display:flex;gap:.3em;margin-left:1.5em}
.ptab{pointer-events:auto;cursor:pointer;padding:.55em 1.1em;border:none;background:none;font-size:.78em;letter-spacing:.16em;text-transform:uppercase;font-weight:600;color:var(--mute);border-bottom:2px solid transparent;transition:color .2s,border-color .2s}
.ptab:hover{color:var(--ivory)}
.ptab.on{color:var(--brass2);border-bottom-color:var(--brass)}
.ptop .sp{flex:1}
.ptop .money{text-align:right;font-size:.8em;color:var(--mute);letter-spacing:.06em}
.ptop .money b{display:block;font-size:1.45em;color:var(--brass2);font-weight:600;letter-spacing:0}
.pfoot{flex:none;display:flex;gap:1.6em;justify-content:flex-end;align-items:center;padding:1em 3em 1.4em;border-top:1px solid rgba(255,255,255,.06);font-size:.74em;color:var(--mute);letter-spacing:.05em}
.kc{display:inline-flex;align-items:center;justify-content:center;min-width:1.9em;height:1.9em;padding:0 .5em;margin-right:.55em;border-radius:.35em;background:rgba(241,236,226,.92);color:#11161d;font-weight:700;font-size:.9em;letter-spacing:0}
.pbody{flex:1;min-height:0;display:flex;padding:1.6em 3em;gap:2.4em}
.btn{pointer-events:auto;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:.5em;padding:.7em 1.4em;border-radius:.35em;border:1px solid rgba(201,164,91,.7);
  background:linear-gradient(180deg,#d4b06a,#b8924c);color:#17110a;font-weight:600;font-size:.86em;letter-spacing:.06em;transition:filter .15s,transform .15s,opacity .2s}
.btn:hover{filter:brightness(1.1)}
.btn:active{transform:translateY(1px)}
.btn.ghost{background:rgba(241,236,226,.06);color:var(--ivory);border-color:rgba(241,236,226,.2)}
.btn.ghost:hover{background:rgba(241,236,226,.12)}
.btn:disabled,.btn.dis{opacity:.35;cursor:not-allowed;filter:none}
.scroll{overflow-y:auto;scrollbar-width:thin;scrollbar-color:rgba(201,164,91,.4) transparent}
.scroll::-webkit-scrollbar{width:6px}.scroll::-webkit-scrollbar-thumb{background:rgba(201,164,91,.35);border-radius:3px}
.empty{color:var(--mute);font-size:.86em;padding:2em 0;text-align:center;font-style:italic}
.sec{font-size:.66em;letter-spacing:.26em;text-transform:uppercase;color:var(--brass);font-weight:600;margin:1.6em 0 .8em}
.sec:first-child{margin-top:0}

/* ── pause menu ────────────────────────────────────────────────────── */
.pause{flex-direction:row}
.pause .side{width:30em;flex:none;padding:5.5em 0 3em 5em;display:flex;flex-direction:column;background:linear-gradient(90deg,rgba(5,9,15,.75),rgba(5,9,15,0))}
.pause .brand{font-size:.62em;letter-spacing:.46em;color:var(--brass);font-weight:600}
.pause .logo{font-family:var(--serif);font-size:3.1em;font-weight:500;line-height:1;margin:.15em 0 .15em;color:#f6efdf;letter-spacing:.02em}
.pause .when{font-size:.74em;color:var(--mute);letter-spacing:.12em;margin-bottom:3em}
.mi{pointer-events:auto;cursor:pointer;display:flex;align-items:center;gap:.8em;width:100%;text-align:left;border:none;background:none;padding:.42em 0;font-family:var(--serif);font-size:1.4em;font-weight:500;color:rgba(241,236,226,.68);
  transition:color .18s,padding .18s;letter-spacing:.01em}
.mi::before{content:'';width:0;height:1px;background:var(--brass);transition:width .2s}
.mi:hover,.mi.sel{color:#fff6e4}
.mi:hover::before,.mi.sel::before{width:1.4em}
.mi.dim{color:rgba(241,236,226,.3);cursor:default}
.mi.dim::before{display:none}
.pause .psub{position:static;flex:1;min-width:0;padding:5.5em 5em 3em 2em;display:flex;flex-direction:column}
.pause .psub h2{font-family:var(--serif);font-weight:500;font-size:2em;margin:0 0 .2em;color:#f6efdf}
.pause .psub .hint{font-size:.78em;color:var(--mute);margin-bottom:1.6em}
.srow{display:grid;grid-template-columns:15em 1fr 4em;align-items:center;gap:1.2em;padding:.62em 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:.88em;max-width:52em}
.srow label{color:var(--ivory)}
.srow .v{text-align:right;color:var(--brass2);font-weight:600;font-variant-numeric:tabular-nums}
.seg{display:flex;gap:.3em}
.seg button{pointer-events:auto;cursor:pointer;flex:1;padding:.5em .6em;border-radius:.3em;border:1px solid rgba(241,236,226,.16);background:rgba(241,236,226,.04);color:var(--ivory2);font-size:.86em;font-weight:600;letter-spacing:.04em;transition:all .15s}
.seg button:hover{border-color:rgba(241,236,226,.35)}
.seg button.on{background:rgba(201,164,91,.18);border-color:var(--brass);color:var(--brass2)}
input[type=range].rng{pointer-events:auto;-webkit-appearance:none;appearance:none;width:100%;height:1.6em;background:transparent;cursor:pointer}
input[type=range].rng::-webkit-slider-runnable-track{height:3px;border-radius:2px;background:linear-gradient(90deg,var(--brass) var(--p,50%),rgba(241,236,226,.18) var(--p,50%))}
input[type=range].rng::-webkit-slider-thumb{-webkit-appearance:none;width:1em;height:1em;border-radius:50%;background:#f6efdf;margin-top:calc(-.5em + 1.5px);box-shadow:0 0 0 3px rgba(201,164,91,.35)}
input[type=range].rng::-moz-range-track{height:3px;background:rgba(241,236,226,.18)}
input[type=range].rng::-moz-range-progress{height:3px;background:var(--brass)}
input[type=range].rng::-moz-range-thumb{width:1em;height:1em;border-radius:50%;background:#f6efdf;border:none}
.slots{display:grid;grid-template-columns:repeat(2,minmax(0,22em));gap:1em}
.slot{pointer-events:auto;cursor:pointer;text-align:left;padding:1.1em 1.2em;border-radius:.5em;border:1px solid rgba(241,236,226,.12);background:rgba(241,236,226,.035);transition:all .15s}
.slot:hover{border-color:var(--brass);background:rgba(201,164,91,.08)}
.slot .n{font-size:.62em;letter-spacing:.24em;text-transform:uppercase;color:var(--brass);font-weight:700}
.slot .w{font-family:var(--serif);font-size:1.3em;font-weight:600;margin:.25em 0 .1em;color:#f6efdf}
.slot .m{font-size:.76em;color:var(--mute);line-height:1.4}
.slot.emp .w{color:var(--mute);font-style:italic;font-weight:500}
.slot.dis{opacity:.4;cursor:default;border-color:rgba(241,236,226,.12);background:rgba(241,236,226,.035)}
.ctl{display:grid;grid-template-columns:repeat(2,minmax(0,24em));column-gap:3em}
.ctl div{display:flex;justify-content:space-between;align-items:center;padding:.55em 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:.86em;color:var(--ivory2)}
.ctl div span:last-child{display:flex;gap:.3em}
.ctl .kc{margin:0}

/* ── map ───────────────────────────────────────────────────────────── */
.map{background:#07111b}
.map .mcv{position:absolute;inset:0;width:100%;height:100%;cursor:grab}
.map .mcv.drag{cursor:grabbing}
.map .ptop{position:relative;z-index:3;background:linear-gradient(180deg,rgba(5,10,16,.95) 60%,rgba(5,10,16,0));border:none}
.decks{position:absolute;left:2.4em;top:8.4em;max-height:calc(100% - 28.4em);width:15em;display:flex;flex-direction:column;gap:.12em;z-index:2;pointer-events:auto;padding:.35em;border-radius:.5em;background:rgba(6,11,18,.9);box-shadow:0 .6em 2em rgba(0,0,0,.35)}
.dk{pointer-events:auto;cursor:pointer;display:flex;align-items:center;gap:.7em;flex:0 1 2.2em;min-height:1.2em;border:none;border-radius:.3em;background:transparent;padding:0 .8em;text-align:left;color:var(--ivory2);font-size:.78em;transition:background .15s,color .15s}
.dk b{width:1.8em;font-weight:700;color:var(--ivory);font-variant-numeric:tabular-nums}
.dk:hover{background:rgba(30,44,60,.85);color:#fff}
.dk.on{background:linear-gradient(90deg,rgba(201,164,91,.32),rgba(201,164,91,.08));color:#fff4dc;box-shadow:inset 2px 0 0 var(--brass)}
.dk .me{margin-left:auto;width:.5em;height:.5em;border-radius:50%;background:#7fd0ff;box-shadow:0 0 .5em #7fd0ff}
.dk .ob{margin-left:auto;width:.55em;height:.55em;transform:rotate(45deg);background:var(--brass2)}
.msearch{position:relative;width:22em;pointer-events:auto}
.msearch input{pointer-events:auto;width:100%;padding:.7em 1em .7em 2.5em;border-radius:2em;border:1px solid rgba(241,236,226,.18);background:rgba(8,14,22,.75);color:var(--ivory);font:500 .86em Inter,sans-serif;outline:none}
.msearch input:focus{border-color:var(--brass)}
.msearch svg{position:absolute;left:.95em;top:50%;width:1em;height:1em;transform:translateY(-50%);color:var(--mute)}
.mres{position:absolute;left:0;right:0;top:calc(100% + .4em);max-height:22em;border-radius:.6em;background:rgba(10,17,26,.97);border:1px solid rgba(241,236,226,.12);box-shadow:0 1em 3em rgba(0,0,0,.5);z-index:5}
.mres:empty{display:none}
.mres button{pointer-events:auto;cursor:pointer;display:flex;width:100%;justify-content:space-between;gap:1em;padding:.6em 1em;border:none;background:none;text-align:left;font-size:.82em;color:var(--ivory)}
.mres button:hover,.mres button.sel{background:rgba(201,164,91,.14)}
.mres button span{color:var(--mute);white-space:nowrap}
.legend{position:absolute;right:2.4em;top:8.4em;width:13em;padding:1em 1.1em;border-radius:.5em;background:rgba(8,14,22,.9);z-index:2;font-size:.74em}
.legend div{display:flex;align-items:center;gap:.7em;margin:.38em 0;color:var(--ivory2)}
.legend i{flex:none;width:1.25em;height:.85em;border-radius:2px}
.legend i.h{background-image:repeating-linear-gradient(135deg,transparent 0 3px,var(--hc) 3px 4.5px)}
.legend hr{border:none;border-top:1px solid rgba(255,255,255,.08);margin:.7em 0}
.legend svg{width:1.2em;height:1.2em;color:var(--ivory)}
.legend .pm{width:1.2em;height:1.2em;display:flex;align-items:center;justify-content:center}
.prof{position:absolute;left:2.4em;right:2.4em;bottom:4.2em;height:14.5em;z-index:2;border-radius:.5em;background:linear-gradient(180deg,rgba(7,13,21,.94),rgba(6,11,18,.97));box-shadow:0 -.6em 2em rgba(0,0,0,.35);border:1px solid rgba(241,236,226,.08)}
.prof canvas{position:absolute;inset:0;width:100%;height:100%;cursor:pointer}
.prof .pl{position:absolute;left:1em;top:.7em;font-size:.6em;letter-spacing:.26em;text-transform:uppercase;color:var(--brass);font-weight:600;pointer-events:none}
.map .pfoot{position:absolute;left:0;right:0;bottom:0;border:none;z-index:2;background:#07111b;padding:1em 2.4em 1.2em}
.mtip{position:absolute;padding:.45em .75em;border-radius:.35em;background:rgba(5,10,16,.92);border:1px solid rgba(201,164,91,.4);font-size:.76em;color:var(--ivory);pointer-events:none;z-index:4;white-space:nowrap;transform:translate(-50%,calc(-100% - .8em))}
.mtip span{color:var(--mute);margin-left:.5em}
.mtip:empty{display:none}

/* ── inventory / journal / shop ────────────────────────────────────── */
.igrid{flex:1;min-width:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(7.4em,1fr));grid-auto-rows:7.4em;gap:.7em;align-content:start;padding-right:.5em}
.it{pointer-events:auto;cursor:pointer;position:relative;border-radius:.5em;border:1px solid rgba(241,236,226,.1);background:linear-gradient(170deg,rgba(241,236,226,.06),rgba(241,236,226,.015));
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.4em;padding:.5em;transition:border-color .15s,background .15s}
.it:hover{border-color:rgba(201,164,91,.55)}
.it.sel{border-color:var(--brass);background:linear-gradient(170deg,rgba(201,164,91,.2),rgba(201,164,91,.05))}
.it .em{font-size:2.1em;line-height:1;filter:saturate(.85)}
.it .nm{font-size:.7em;text-align:center;color:var(--ivory2);line-height:1.2;max-height:2.4em;overflow:hidden}
.it .q{position:absolute;right:.45em;top:.35em;font-size:.68em;font-weight:700;color:var(--brass2)}
.it .eq{position:absolute;left:.45em;top:.4em;font-size:.56em;letter-spacing:.14em;font-weight:700;color:#0f1a12;background:var(--good);padding:.1em .4em;border-radius:.2em}
.idet{width:24em;flex:none;padding:1.6em;border-radius:.6em;background:rgba(241,236,226,.035);border:1px solid rgba(241,236,226,.08);display:flex;flex-direction:column}
.idet .em{font-size:3.4em;line-height:1}
.idet .kd{font-size:.64em;letter-spacing:.24em;text-transform:uppercase;color:var(--brass);font-weight:700;margin-top:1.2em}
.idet h3{font-family:var(--serif);font-size:1.8em;font-weight:600;margin:.15em 0 .4em;color:#f6efdf;line-height:1.1}
.idet p{font-size:.86em;line-height:1.55;color:var(--ivory2);margin:0}
.idet .meta{display:flex;gap:2em;margin-top:1.2em;font-size:.76em;color:var(--mute)}
.idet .meta b{display:block;color:var(--ivory);font-size:1.25em;margin-top:.15em;font-weight:600}
.idet .acts{margin-top:auto;display:flex;gap:.6em;padding-top:1.4em}
.ifilt{display:flex;gap:.4em;margin-bottom:1.1em;flex-wrap:wrap}
.chip{pointer-events:auto;cursor:pointer;padding:.42em .9em;border-radius:2em;border:1px solid rgba(241,236,226,.14);background:none;font-size:.74em;font-weight:600;color:var(--mute);letter-spacing:.04em}
.chip:hover{color:var(--ivory)}
.chip.on{border-color:var(--brass);color:var(--brass2);background:rgba(201,164,91,.1)}
.icol{flex:1;min-width:0;display:flex;flex-direction:column}
.jlist{flex:1;min-width:0;padding-right:1em;max-width:64em}
.jcard{padding:1.1em 1.3em;border-radius:.5em;border:1px solid rgba(241,236,226,.08);background:rgba(241,236,226,.03);margin-bottom:.8em}
.jcard.cur{border-color:rgba(201,164,91,.45);background:linear-gradient(90deg,rgba(201,164,91,.1),rgba(201,164,91,.02))}
.jcard .t{font-family:var(--serif);font-size:1.35em;font-weight:600;color:#f6efdf}
.jcard .x{font-size:.82em;color:var(--ivory2);margin-top:.3em;line-height:1.5}
.jcard ul{list-style:none;padding:0;margin:.6em 0 0}
.jcard li{font-size:.8em;color:var(--ivory);margin:.25em 0;padding-left:1.3em;position:relative}
.jcard li::before{content:'';position:absolute;left:0;top:.45em;width:.6em;height:.6em;border:1px solid rgba(241,236,226,.5);border-radius:2px}
.jcard li.done{color:var(--mute);text-decoration:line-through}
.jcard li.done::before{background:var(--brass);border-color:var(--brass)}
.jcard.fin{opacity:.6}
.jcard .tag{float:right;font-size:.62em;letter-spacing:.2em;text-transform:uppercase;font-weight:700;color:var(--brass)}
.prog{display:grid;grid-template-columns:6.5em 1fr auto;gap:0 1.4em;align-items:center}
.prog>div{padding:.75em 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:.86em}
.prog .tm{font-variant-numeric:tabular-nums;color:var(--brass2);font-weight:600}
.prog .nm{color:#f6efdf}
.prog .nm small{display:block;color:var(--mute);font-size:.86em;margin-top:.15em}
.prog .st{font-size:.66em;letter-spacing:.18em;text-transform:uppercase;font-weight:700;color:var(--mute)}
.prog .st.live{color:var(--good)}
.prog .past{opacity:.45}
.msg{display:flex;gap:.9em;padding:.9em 0;border-bottom:1px solid rgba(255,255,255,.05)}
.msg .av{flex:none;width:2.6em;height:2.6em;border-radius:50%;background:linear-gradient(160deg,#2a4565,#162a40);display:flex;align-items:center;justify-content:center;font-family:var(--serif);font-weight:600;font-size:1.05em;color:var(--brass2)}
.msg .w{font-size:.84em;font-weight:600;color:#f6efdf}
.msg .w span{font-weight:500;color:var(--mute);margin-left:.6em;font-size:.9em}
.msg .tx{font-size:.84em;color:var(--ivory2);margin-top:.25em;line-height:1.5}
.stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(13em,1fr));gap:.8em;align-content:start}
.stat{padding:1.1em 1.2em;border-radius:.5em;background:rgba(241,236,226,.035);border:1px solid rgba(241,236,226,.07)}
.stat .k{font-size:.62em;letter-spacing:.22em;text-transform:uppercase;color:var(--mute);font-weight:600}
.stat .v{font-family:var(--serif);font-size:1.9em;font-weight:600;color:#f6efdf;margin-top:.2em;line-height:1}
.shop .pbody{max-width:64em;margin:0 auto;width:100%;flex-direction:column;gap:0}
.srowi{display:flex;align-items:center;gap:1.1em;padding:.9em 1.1em;border-radius:.5em;border:1px solid transparent;transition:background .15s,border-color .15s}
.srowi:hover{background:rgba(241,236,226,.04);border-color:rgba(241,236,226,.08)}
.srowi .em{width:2.4em;font-size:1.6em;text-align:center;flex:none}
.srowi .nm{flex:1;min-width:0}
.srowi .nm b{display:block;font-weight:600;color:#f6efdf;font-size:.95em}
.srowi .nm span{display:block;font-size:.78em;color:var(--mute);margin-top:.2em;line-height:1.4}
.srowi .pr{font-weight:700;color:var(--brass2);font-variant-numeric:tabular-nums;min-width:5em;text-align:right}
.srowi .pr.no{color:#c98a7a}
.srowi .btn{min-width:7em}
.shop .note2{font-size:.76em;color:var(--mute);margin:0 0 1em 1.1em}

/* ── dialogue ──────────────────────────────────────────────────────── */
.dlg{position:absolute;left:50%;bottom:13vh;transform:translateX(-50%);width:min(56em,86vw);pointer-events:auto;z-index:35;opacity:0;transition:opacity .3s,transform .3s}
.dlg.on{opacity:1}
.dlg .who{display:flex;align-items:center;gap:.9em;margin-bottom:.8em}
.dlg .pt{width:3.6em;height:3.6em;border-radius:50%;border:1.5px solid var(--brass);background:linear-gradient(160deg,#243c58,#132235) center/cover;display:flex;align-items:center;justify-content:center;font-family:var(--serif);font-size:1.5em;font-weight:600;color:var(--brass2);flex:none}
.dlg .np{display:flex;flex-direction:column}
.dlg .np b{font-family:var(--serif);font-size:1.6em;font-weight:600;color:#f6efdf;line-height:1}
.dlg .np span{font-size:.66em;letter-spacing:.24em;text-transform:uppercase;color:var(--brass);font-weight:600;margin-top:.45em}
.dlg .ln{font-size:1.3em;line-height:1.55;color:#f4efe5;min-height:3.2em;text-shadow:0 1px 3px rgba(0,0,0,.9)}
.dlg .ln .cur{display:inline-block;width:.5em;height:1em;vertical-align:-.12em;background:var(--brass);margin-left:.2em;animation:hxblink 1s steps(2) infinite}
@keyframes hxblink{50%{opacity:0}}
.dlg .opts{display:flex;flex-direction:column;gap:.35em;margin-top:1em}
.dlg .op{pointer-events:auto;cursor:pointer;display:flex;align-items:center;gap:.9em;width:100%;text-align:left;padding:.65em 1em;border-radius:.35em;border:1px solid rgba(241,236,226,.1);background:rgba(8,13,20,.62);
  font-size:1.05em;color:var(--ivory);transition:all .15s;animation:hxin .3s ease-out both}
.dlg .op .kc{flex:none}
.dlg .op:hover,.dlg .op.sel{border-color:var(--brass);background:rgba(201,164,91,.14);color:#fff6e4}
.dlg .op.dis{opacity:.42;cursor:not-allowed}
.dlg .op .hn{margin-left:auto;font-size:.76em;color:var(--mute);font-style:italic}
.dlg .more{margin-top:.8em;font-size:.72em;letter-spacing:.14em;text-transform:uppercase;color:var(--mute);display:flex;align-items:center}
.dlgshade{position:absolute;left:0;right:0;bottom:0;height:62vh;background:linear-gradient(0deg,rgba(3,6,10,.92),rgba(3,6,10,.7) 45%,rgba(3,6,10,0));opacity:0;transition:opacity .35s;z-index:34}
.dlgshade.on{opacity:1}

/* ── title ─────────────────────────────────────────────────────────── */
.title{position:absolute;inset:0;pointer-events:auto;z-index:90;transition:opacity 1.2s ease}
.title.out{opacity:0;pointer-events:none}
.title .vig{position:absolute;inset:0;background:linear-gradient(90deg,rgba(3,7,12,.82) 0%,rgba(3,7,12,.5) 32%,rgba(3,7,12,0) 60%),linear-gradient(0deg,rgba(3,7,12,.65),rgba(3,7,12,0) 35%),linear-gradient(180deg,rgba(3,7,12,.45),rgba(3,7,12,0) 22%)}
.title .lft{position:absolute;left:7vw;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center;width:44em}
.title .brand{font-size:.72em;letter-spacing:.6em;color:var(--brass2);font-weight:600;opacity:0;animation:hxup 1.4s .3s ease-out forwards}
.title .logo{font-family:var(--serif);font-weight:500;font-size:6.2em;line-height:.95;white-space:nowrap;color:#f8f1e1;letter-spacing:.02em;margin:.22em 0 .15em;text-shadow:0 .08em .6em rgba(0,0,0,.45);opacity:0;animation:hxup 1.8s .5s ease-out forwards}
.title .sublogo{font-size:.78em;letter-spacing:.42em;color:var(--ivory2);font-weight:500;margin:0 0 1.4em;opacity:0;animation:hxup 1.6s .8s ease-out forwards}
.title .rule{height:1px;width:0;background:linear-gradient(90deg,var(--brass),transparent);animation:hxrule 2s 1s cubic-bezier(.2,.8,.2,1) forwards}
.title .tag{font-family:var(--serif);font-style:italic;font-size:1.5em;color:#e2dacb;margin:.9em 0 2.4em;white-space:nowrap;text-shadow:0 1px 6px rgba(0,0,0,.5);opacity:0;animation:hxup 1.6s 1.1s ease-out forwards}
.title .menu{display:flex;flex-direction:column;align-items:flex-start;opacity:0;animation:hxup 1.4s 1.5s ease-out forwards}
.title .menu .mi{font-size:1.75em;padding:.4em 0}
.title .menu .mi small{font-family:Inter,sans-serif;font-size:.42em;letter-spacing:.14em;color:var(--mute);margin-left:.8em;text-transform:uppercase}
.title .foot{position:absolute;left:7vw;right:6vw;bottom:3.2vh;display:flex;justify-content:space-between;font-size:.64em;letter-spacing:.22em;text-transform:uppercase;color:rgba(241,236,226,.6);opacity:0;animation:hxup 1.4s 2s ease-out forwards}
.title .card{position:absolute;right:6vw;bottom:9vh;text-shadow:0 1px 6px rgba(0,0,0,.6);text-align:right;opacity:0;animation:hxup 1.6s 2.2s ease-out forwards}
.title .card .k{font-size:.6em;letter-spacing:.36em;text-transform:uppercase;color:var(--brass);font-weight:600}
.title .card .v{font-family:var(--serif);font-size:1.3em;color:var(--ivory);margin-top:.3em}
.title .card .s{font-size:.7em;color:var(--ivory2);letter-spacing:.1em;margin-top:.35em}
.title .credits{position:absolute;left:7vw;top:50%;transform:translateY(-50%);width:34em;opacity:0;pointer-events:none;transition:opacity .5s}
.title.cr .credits{opacity:1;pointer-events:auto}
.title.cr .lft{opacity:0;pointer-events:none}
.title .lft{transition:opacity .5s}
.title:not(.go) *{animation-play-state:paused!important}
.title .credits h2{font-family:var(--serif);font-weight:500;font-size:2.6em;margin:0 0 .8em;color:#f6efdf}
.title .credits p{font-size:.86em;line-height:1.7;color:var(--ivory2);margin:0 0 1em}
.title .credits b{color:var(--brass2);font-weight:600;letter-spacing:.12em;font-size:.8em;text-transform:uppercase;display:block}
@keyframes hxup{from{opacity:0;transform:translateY(.6em)}to{opacity:1;transform:none}}
@keyframes hxrule{to{width:18em}}
.title .press{position:absolute;left:50%;bottom:16vh;transform:translateX(-50%);font-size:.76em;letter-spacing:.4em;text-transform:uppercase;color:var(--ivory2)}
`;
