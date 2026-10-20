// Lists every API route by walking the Express router (no docs used) and writes
// them to qa-out/routes.json for the sweeps.  Run from backend: node scripts/qa/list-routes.mjs
process.env.NODE_ENV = 'test';
const { default: api } = await import(new URL('../../src/routes/index.js', import.meta.url).href);
const fs = await import('node:fs');
const out = [];
function mountOf(layer) {
  if (layer.regexp?.fast_slash) return '';
  let src = layer.regexp.source;
  src = src.replace(/^\^/, '').replace(/\\\/\?\(\?=\\\/\|\$\)$/, '').replace(/\\\//g, '/');
  // Path parameters in a mount path ((?:([^\/]+?))) become :param.
  src = src.replace(/\(\?:\(\[\^\/\]\+\?\)\)/g, ':param');
  return src;
}
function walk(stack, prefix) {
  for (const layer of stack) {
    if (layer.route) {
      for (const method of Object.keys(layer.route.methods)) {
        out.push({ method: method.toUpperCase(), path: `${prefix}${layer.route.path}`.replace(/\/+/g, '/'), mw: layer.route.stack.map((l) => l.name).filter((n) => n && n !== '<anonymous>') });
      }
    } else if (layer.handle?.stack) {
      walk(layer.handle.stack, prefix + mountOf(layer));
    }
  }
}
walk(api.stack, '/api/v1');
fs.mkdirSync(new URL('./qa-out/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('./qa-out/routes.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(out.length, 'routes', JSON.stringify(out.reduce((m, r) => ({ ...m, [r.method]: (m[r.method] ?? 0) + 1 }), {})));
console.log(out.filter((_, i) => i % 60 === 0).map((r) => `${r.method} ${r.path} [${r.mw.join(',')}]`).join('\n'));
process.exit(0);
