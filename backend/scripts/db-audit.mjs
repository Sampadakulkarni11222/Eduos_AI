#!/usr/bin/env node
/**
 * Database audit: integrity checks over a real (seeded or live) database.
 *
 *   MONGO_URI=mongodb://127.0.0.1:27017/eduos node scripts/db-audit.mjs [--json]
 *
 * Read-only. For every model it reports:
 *   - documents of a school-owned collection with no school (tenantId)
 *   - references (paths declared with `ref`) pointing at documents that do not exist
 *   - references pointing at a document of ANOTHER school
 *   - money fields (*Paise) holding fractions, negatives or non-numbers
 *   - indexes declared in the schema that are missing from the database
 * and exits non-zero when it finds a problem, so it can run in CI against a
 * freshly seeded database.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import mongoose from 'mongoose';

const here = path.dirname(fileURLToPath(import.meta.url));
const modelsDir = path.join(here, '..', 'src', 'models');
for (const f of fs.readdirSync(modelsDir).filter((x) => x.endsWith('.js'))) {
  await import(pathToFileURL(path.join(modelsDir, f)).href);
}

const uri = process.env.MONGO_URI;
if (!uri) { console.error('Set MONGO_URI'); process.exit(2); }
// Read-only by construction: nothing below writes.
await mongoose.connect(uri);

const problems = [];
const note = (kind, model, detail, count, sample) => problems.push({ kind, model, detail, count, sample });

/** Every schema path that references another model, including inside arrays and subdocuments. */
function refPaths(schema, prefix = '') {
  const out = [];
  schema.eachPath((p, type) => {
    const full = prefix ? `${prefix}.${p}` : p;
    const ref = type.options?.ref ?? type.caster?.options?.ref;
    if (ref && typeof ref === 'string') out.push({ path: full, ref, array: Boolean(type.caster) });
    if (type.schema) out.push(...refPaths(type.schema, full));
  });
  return out;
}

const SAMPLE = 3;
for (const name of mongoose.modelNames().sort()) {
  const Model = mongoose.model(name);
  const coll = Model.collection;
  const total = await coll.estimatedDocumentCount();
  if (!total) continue;
  const scoped = Boolean(Model.schema.path('tenantId'));

  if (scoped) {
    const missing = await coll.countDocuments({ $or: [{ tenantId: { $exists: false } }, { tenantId: null }, { tenantId: '' }] });
    if (missing) note('NO_SCHOOL', name, 'school-owned documents with no tenantId (invisible to every school)', missing);
  }

  for (const { path: p, ref } of refPaths(Model.schema)) {
    if (!mongoose.modelNames().includes(ref)) continue;
    const Target = mongoose.model(ref);
    // Distinct referenced ids, then which of them are missing (bounded per path).
    const ids = (await coll.distinct(p, { [p]: { $ne: null } })).filter((x) => x instanceof mongoose.Types.ObjectId).slice(0, 50_000);
    if (!ids.length) continue;
    const found = await Target.collection.find({ _id: { $in: ids } }, { projection: { _id: 1, tenantId: 1 } }).toArray();
    const foundIds = new Set(found.map((d) => String(d._id)));
    const dangling = ids.filter((id) => !foundIds.has(String(id)));
    if (dangling.length) {
      const n = await coll.countDocuments({ [p]: { $in: dangling } });
      note('DANGLING_REF', name, `${p} → ${ref}: points at documents that do not exist`, n, dangling.slice(0, SAMPLE).map(String));
    }
    // Cross-school references: the referencing and referenced documents belong to different schools.
    const targetScoped = Boolean(Target.schema.path('tenantId'));
    if (scoped && targetScoped) {
      const schoolOf = new Map(found.map((d) => [String(d._id), d.tenantId]));
      const rows = await coll.find({ [p]: { $in: ids } }, { projection: { tenantId: 1, [p]: 1 } }).limit(200_000).toArray();
      let cross = 0; const sample = [];
      for (const r of rows) {
        const vals = [].concat(p.split('.').reduce((o, k) => (Array.isArray(o) ? o.map((x) => x?.[k]) : o?.[k]), r)).flat();
        for (const v of vals) {
          const t = schoolOf.get(String(v));
          if (t && r.tenantId && t !== r.tenantId) { cross += 1; if (sample.length < SAMPLE) sample.push(String(r._id)); }
        }
      }
      if (cross) note('CROSS_SCHOOL_REF', name, `${p} → ${ref}: refers to another school's document`, cross, sample);
    }
  }

  // Money is stored as whole paise.
  const moneyPaths = [];
  Model.schema.eachPath((p, type) => { if (/Paise$/.test(p) && type.instance === 'Number') moneyPaths.push(p); });
  for (const p of moneyPaths) {
    const bad = await coll.countDocuments({ [p]: { $exists: true, $ne: null }, $or: [{ $expr: { $ne: [{ $mod: [`$${p}`, 1] }, 0] } }, { [p]: { $not: { $type: 'number' } } }] }).catch(() => 0);
    if (bad) note('MONEY_NOT_WHOLE_PAISE', name, `${p} holds fractions or non-numbers`, bad);
  }

  // Declared indexes that the database does not have (autoIndex off, failed build, duplicates blocking a unique index).
  const built = await coll.indexes();
  const existing = built.map((i) => JSON.stringify(i.key));
  // A text index is stored as { _fts: 'text', _ftsx: 1 } plus its non-text fields.
  const textBuilt = built.some((i) => i.key?._fts === 'text');
  for (const [fields, options] of Model.schema.indexes()) {
    if (Object.values(fields).includes('text') && textBuilt) continue;
    if (!existing.includes(JSON.stringify(fields))) note('MISSING_INDEX', name, `${JSON.stringify(fields)}${options?.unique ? ' (unique)' : ''} declared but not built`, 1);
  }
}

await mongoose.disconnect();
if (process.argv.includes('--json')) console.log(JSON.stringify(problems, null, 1));
else {
  const by = problems.reduce((m, p) => ({ ...m, [p.kind]: (m[p.kind] ?? 0) + 1 }), {});
  console.log(`Database audit: ${problems.length} problem(s)`, by);
  for (const p of problems) console.log(`- ${p.kind} ${p.model}: ${p.detail} (${p.count})${p.sample?.length ? ` e.g. ${p.sample.join(', ')}` : ''}`);
}
process.exit(problems.length ? 1 : 0);
