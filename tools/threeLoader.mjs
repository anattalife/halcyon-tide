// Node ESM loader mapping the browser importmap ('three', 'three/addons/') to the vendored copy (tests only).
const ROOT = new URL('../', import.meta.url);
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: new URL('vendor/build/three.module.js', ROOT).href, shortCircuit: true };
  if (spec.startsWith('three/addons/')) return { url: new URL('vendor/examples/jsm/' + spec.slice(13), ROOT).href, shortCircuit: true };
  return next(spec, ctx);
}
