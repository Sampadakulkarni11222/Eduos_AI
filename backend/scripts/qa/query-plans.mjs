// Query-plan audit against a THROWAWAY database:
//   MONGO_URI=… node scripts/qa/query-plans.mjs on      (profile every operation)
//   …exercise the app (e.g. run route-sweep.mjs get)…
//   MONGO_URI=… node scripts/qa/query-plans.mjs report  (collection scans, and queries reading 20x more than they return)
import mongoose from 'mongoose';
await mongoose.connect(process.env.MONGO_URI);
const db = mongoose.connection.db;
const mode = process.argv[2];
if (mode === 'on') {
  await db.command({ profile: 0 });
  await db.collection('system.profile').drop().catch(() => {});
  await db.createCollection('system.profile', { capped: true, size: 400 * 1024 * 1024 });
  await db.command({ profile: 2 });
  console.log('profiler on');
} else {
  await db.command({ profile: 0 });
  const rows = await db.collection('system.profile').find({ planSummary: /COLLSCAN/, docsExamined: { $gt: 50 } }).toArray();
  const shapes = new Map();
  const shapeOf = (f) => Object.keys(f ?? {}).filter((k) => k !== 'tenantId').sort().map((k) => (k.startsWith('$') ? k : k)).join(',');
  for (const r of rows) {
    const coll = r.ns.split('.').slice(1).join('.');
    if (coll.startsWith('system.')) continue;
    const filter = r.command?.filter ?? r.command?.query ?? r.command?.pipeline?.[0]?.$match ?? r.command?.q ?? {};
    const k = `${coll} {${shapeOf(filter)}} ${r.op}${r.command?.aggregate ? ':agg' : ''}`;
    const e = shapes.get(k) ?? { k, n: 0, maxExamined: 0, totalMs: 0, example: JSON.stringify(filter).slice(0, 160) };
    e.n += 1; e.maxExamined = Math.max(e.maxExamined, r.docsExamined); e.totalMs += r.millis ?? 0;
    shapes.set(k, e);
  }
  const list = [...shapes.values()].sort((a, b) => b.maxExamined * b.n - a.maxExamined * a.n);
  console.log(`${rows.length} collection scans, ${list.length} query shapes`);
  for (const e of list.slice(0, 40)) console.log(`${String(e.n).padStart(5)}x  max ${String(e.maxExamined).padStart(6)} docs  ${String(e.totalMs).padStart(6)}ms  ${e.k}  e.g. ${e.example}`);
  const counts = await db.collection('system.profile').aggregate([{ $group: { _id: '$planSummary', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 8 }]).toArray();
  console.log('plans:', JSON.stringify(counts));
  // Queries that used an index but still read 20x more documents than they returned.
  const wide = await db.collection('system.profile').find({ docsExamined: { $gt: 300 } }).toArray();
  const waste = new Map();
  for (const r of wide) {
    const coll = r.ns.split('.').slice(1).join('.');
    if (coll.startsWith('system.')) continue;
    const ret = r.nreturned ?? 0;
    if (r.docsExamined < 20 * Math.max(ret, 1)) continue;
    const filter = r.command?.filter ?? r.command?.query ?? r.command?.pipeline?.[0]?.$match ?? {};
    const k = `${coll} {${Object.keys(filter).sort().join(',')}} via ${r.planSummary}`;
    const e = waste.get(k) ?? { k, n: 0, maxExamined: 0, ret: 0 };
    e.n += 1; e.maxExamined = Math.max(e.maxExamined, r.docsExamined); e.ret = Math.max(e.ret, ret);
    waste.set(k, e);
  }
  console.log(`
${waste.size} query shapes read 20x more documents than they returned:`);
  for (const e of [...waste.values()].sort((a, b) => b.maxExamined * b.n - a.maxExamined * a.n).slice(0, 30)) {
    console.log(`${String(e.n).padStart(4)}x examined ${String(e.maxExamined).padStart(6)} returned ${String(e.ret).padStart(4)}  ${e.k}`);
  }
}
await mongoose.disconnect();
