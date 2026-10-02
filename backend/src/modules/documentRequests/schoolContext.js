import { currentTenantId } from '../../tenancy/tenantContext.js';
import { AppError } from '../../utils/AppError.js';

/**
 * Document requests are always one school's business. A Super Admin with no
 * school selected runs outside any tenant, where the tenancy filter is absent,
 * so the module refuses to act until a school is chosen — rather than reading
 * or writing across every school at once.
 */
export function assertSchoolContext() {
  const tenantId = currentTenantId();
  if (!tenantId) {
    throw new AppError('Select a school before managing its documents', 400, [], 'SCHOOL_CONTEXT_REQUIRED');
  }
  return tenantId;
}
