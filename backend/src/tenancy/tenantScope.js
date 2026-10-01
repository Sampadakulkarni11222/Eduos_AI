import { currentTenantId } from './tenantContext.js';

/**
 * Makes a collection school-owned.
 *
 * Adds an indexed `tenantId`, filters every read and write by the acting
 * school, and stamps new documents with it. Applied in the model files of the
 * collections a school owns; identity and RBAC collections (Account, Profile,
 * Role, Permission, RefreshToken, OtpCode, Counter) are deliberately not
 * scoped — an account signs in before any school is known, and roles are
 * platform-wide definitions.
 *
 * With no tenant context the plugin does nothing, which is what lets seeds,
 * migrations and the platform-level Super Admin views read across schools.
 * Requests always carry one (see middleware/auth.js), so the open case cannot
 * be reached from the API.
 */

// Every query shape that can read or modify documents. `distinct` and
// `aggregate` are easy to forget and are exactly how a leak would look.
const QUERY_HOOKS = [
  'count', 'countDocuments', 'estimatedDocumentCount', 'distinct',
  'find', 'findOne', 'findOneAndDelete', 'findOneAndRemove', 'findOneAndReplace',
  'findOneAndUpdate', 'replaceOne', 'update', 'updateOne', 'updateMany',
  'deleteOne', 'deleteMany', 'remove',
];

const UPDATE_HOOKS = ['findOneAndUpdate', 'updateOne', 'updateMany', 'update'];
const REPLACE_HOOKS = ['replaceOne', 'findOneAndReplace'];

/**
 * Removes every attempt to write `tenantId` from an update document.
 *
 * Inside a school context the filter already confines *which* documents an
 * update reaches, but the update itself could still `$set: { tenantId }` and
 * hand a document to another school — and plenty of services pass a request
 * body through to an update. The school a document belongs to is not
 * something a school-level request may change, so the key is dropped from
 * every operator (and from the operator-less shorthand Mongoose accepts).
 */
function withoutTenantWrites(update) {
  if (!update || typeof update !== 'object' || Array.isArray(update)) return update;
  const out = { ...update };
  delete out.tenantId;
  for (const [op, value] of Object.entries(out)) {
    if (op.startsWith('$') && value && typeof value === 'object' && !Array.isArray(value) && 'tenantId' in value) {
      const { tenantId: _dropped, ...rest } = value;
      out[op] = rest;
    }
  }
  return out;
}

export function tenantScoped(schema) {
  schema.add({
    // Not `required`: documents that predate the migration, and rows written
    // by scripts running outside a tenant context, must still be readable.
    tenantId: { type: String, index: true, trim: true, lowercase: true },
  });

  for (const hook of QUERY_HOOKS) {
    schema.pre(hook, function applyTenantFilter() {
      const tenantId = currentTenantId();
      if (!tenantId) return;
      // Never widen an explicit filter the caller already set.
      const existing = this.getQuery()?.tenantId;
      if (existing === undefined) this.where({ tenantId });
    });
  }

  // An update can neither move a document to another school nor, as an
  // upsert, create one there: any tenantId the caller wrote is dropped and an
  // upsert is stamped with the acting school.
  schema.pre(UPDATE_HOOKS, function pinUpdateTenant() {
    const tenantId = currentTenantId();
    if (!tenantId) return;
    const update = withoutTenantWrites(this.getUpdate());
    if (this.getOptions()?.upsert && update && !Array.isArray(update)) {
      update.$setOnInsert = { ...(update.$setOnInsert ?? {}), tenantId };
    }
    this.setUpdate(update);
  });

  // A replacement document carries its own tenantId, so it is overwritten.
  schema.pre(REPLACE_HOOKS, function pinReplacementTenant() {
    const tenantId = currentTenantId();
    if (!tenantId) return;
    const replacement = this.getUpdate();
    if (replacement && typeof replacement === 'object' && !Array.isArray(replacement)) {
      this.setUpdate({ ...replacement, tenantId });
    }
  });

  schema.pre('aggregate', function applyTenantMatch() {
    const tenantId = currentTenantId();
    if (!tenantId) return;
    this.pipeline().unshift({ $match: { tenantId } });
  });

  // Pinned, not defaulted: `Model.create(req.body)` would otherwise keep a
  // client-supplied tenantId and file the document under another school, and
  // a loaded document could be re-assigned by setting the field before save.
  schema.pre('save', function stampOnSave(next) {
    const tenantId = currentTenantId();
    if (tenantId) this.tenantId = tenantId;
    next();
  });

  /**
   * bulkWrite is a model-level operation, so none of the query hooks above run
   * for it — attendance marks, exam marks and risk predictions were all written
   * through it and landed with no tenantId at all: invisible to every
   * school-scoped read, and owned by nobody.
   *
   * Each op is confined the same way its single-document equivalent is: the
   * filter gains the acting school, and an upsert stamps it on insert.
   */
  schema.pre('bulkWrite', function stampBulkWrite(next, ops) {
    const tenantId = currentTenantId();
    if (!tenantId || !Array.isArray(ops)) return next();

    for (const op of ops) {
      if (!op || typeof op !== 'object') continue;

      for (const key of ['updateOne', 'updateMany', 'replaceOne', 'deleteOne', 'deleteMany']) {
        const spec = op[key];
        if (!spec) continue;

        // Never widen a filter the caller set for itself.
        if (spec.filter?.tenantId === undefined) {
          spec.filter = { ...(spec.filter ?? {}), tenantId };
        }
        // An op may not move a document to another school. A pipeline update
        // takes no $setOnInsert; the filter still confines it.
        if (spec.update && !Array.isArray(spec.update)) {
          spec.update = withoutTenantWrites(spec.update);
          if (spec.upsert) {
            spec.update.$setOnInsert = { ...(spec.update.$setOnInsert ?? {}), tenantId };
          }
        }
        if (spec.replacement) {
          spec.replacement = { ...spec.replacement, tenantId };
        }
      }

      if (op.insertOne?.document) {
        op.insertOne.document.tenantId = tenantId;
      }
    }
    next();
  });

  schema.pre('insertMany', function stampOnInsertMany(next, docs) {
    const tenantId = currentTenantId();
    if (tenantId && Array.isArray(docs)) {
      for (const doc of docs) if (doc) doc.tenantId = tenantId;
    }
    next();
  });
}
