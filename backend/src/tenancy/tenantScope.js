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

  // Upserts must not create a document in the wrong school.
  schema.pre(['findOneAndUpdate', 'updateOne', 'updateMany'], function stampUpsert() {
    const tenantId = currentTenantId();
    if (!tenantId) return;
    if (this.getOptions()?.upsert) this.setUpdate({ ...this.getUpdate(), $setOnInsert: { ...(this.getUpdate()?.$setOnInsert ?? {}), tenantId } });
  });

  schema.pre('aggregate', function applyTenantMatch() {
    const tenantId = currentTenantId();
    if (!tenantId) return;
    this.pipeline().unshift({ $match: { tenantId } });
  });

  schema.pre('save', function stampOnSave(next) {
    const tenantId = currentTenantId();
    if (tenantId && !this.tenantId) this.tenantId = tenantId;
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
        // A pipeline update takes no $setOnInsert; the filter still confines it.
        if (spec.upsert && spec.update && !Array.isArray(spec.update)) {
          spec.update = {
            ...spec.update,
            $setOnInsert: { ...(spec.update.$setOnInsert ?? {}), tenantId },
          };
        }
        if (spec.upsert && spec.replacement?.tenantId === undefined) {
          spec.replacement = { ...spec.replacement, tenantId };
        }
      }

      if (op.insertOne?.document && op.insertOne.document.tenantId === undefined) {
        op.insertOne.document.tenantId = tenantId;
      }
    }
    next();
  });

  schema.pre('insertMany', function stampOnInsertMany(next, docs) {
    const tenantId = currentTenantId();
    if (tenantId && Array.isArray(docs)) {
      for (const doc of docs) if (doc && !doc.tenantId) doc.tenantId = tenantId;
    }
    next();
  });
}
