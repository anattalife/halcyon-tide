(() => {
  const g = __game; const out = {};
  const tri = (o) => { const geo = o.geometry; if (!geo) return 0; const n = geo.index ? geo.index.count : (geo.attributes.position?.count || 0); let t = n / 3; if (o.isInstancedMesh) t *= o.count; else if (geo.isInstancedBufferGeometry) t *= (geo.instanceCount ?? 1); return t; };
  const D = g.world.decks; const res = { ext: 0, detail: 0, shell: 0, detailDecks: [] , shadowCasters: 0, shadowTris: 0};
  for (let k = 1; k < D.length; k++) { const d = D[k]; if (!d) continue;
    for (const key of ['ext', 'detail', 'shell']) { if (!d[key]) continue; let t = 0; d[key].traverse(o => { if (o.isMesh && o.visible) t += tri(o); }); if (key === 'detail' && !d.detailOn) continue; if (key==='shell' && !d.shell.visible) continue; res[key] += t; if (key === 'detail') res.detailDecks.push([k, Math.round(t)]); } }
  g.scene.traverseVisible(o => { if (o.isMesh && o.castShadow) { res.shadowCasters++; res.shadowTris += tri(o); } });
  let chars = 0; g.scene.traverseVisible(o => { if (o.isMesh && /char/i.test(o.name || o.parent?.name || '')) chars += tri(o); });
  const top = {}; g.scene.children.forEach(c => { let t = 0; c.traverseVisible(o => { if (o.isMesh || o.isPoints) t += tri(o); }); top[(c.name || c.type) + '#' + c.id] = Math.round(t); });
  res.top = top; res.hull = 0; g.hull.traverse(o => { if (o.isMesh) res.hull += tri(o); });
  res.activeDeck = g.world.activeDeck; res.detailRadius = g.world.detailRadius;
  res.shadowMap = g.env.sun.shadow.mapSize.x; res.pixelRatio = g.renderer.getPixelRatio(); res.lights = 0; g.scene.traverse(o => { if (o.isLight) res.lights++; });
  for (const k of ['ext','detail','shell','shadowTris','hull']) res[k] = Math.round(res[k]);
  return JSON.stringify(res);
})()
