import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import * as service from './customization.service.js';

/**
 * School customisation over HTTP.
 *
 * Every rule lives in the service, so the REST routes and the MCP tool apply
 * one set of them. The handlers only decide which school is being named — and
 * for a school-level caller that is never the body's business, it is whatever
 * middleware/auth.js already pinned.
 */

/** The acting school's render-time theme. Any signed-in member may read it. */
export const getMyTheme = asyncHandler(async (_req, res) => {
  sendSuccess(res, await service.getTheme(), 'Theme fetched');
});

/** One of the acting school's dropdowns, for a form that populates from it. */
export const getMyDropdown = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.getDropdown(req.params.key), 'Dropdown fetched');
});

/** The acting school's full configuration — what the customisation screen edits. */
export const getMyCustomization = asyncHandler(async (_req, res) => {
  sendSuccess(res, await service.getCustomization(), 'Customization fetched');
});

/* ── Platform ─────────────────────────────────────────────── */

export const listSchools = asyncHandler(async (_req, res) => {
  sendSuccess(res, await service.listSchoolCustomizations(), 'School customizations fetched');
});

export const getSchoolCustomization = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.getCustomization(req.params.tenantId), 'Customization fetched');
});

export const getSchoolTheme = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.getTheme(req.params.tenantId), 'Theme fetched');
});

export const updateSchoolCustomization = asyncHandler(async (req, res) => {
  const config = await service.updateCustomization(req.actor, req.params.tenantId, req.body ?? {});
  sendSuccess(res, config, 'Customization saved');
});

export const resetSchoolCustomization = asyncHandler(async (req, res) => {
  const config = await service.resetCustomization(req.actor, req.params.tenantId);
  sendSuccess(res, config, 'Customization reset to defaults');
});

/**
 * Validates a configuration without saving it — what the preview runs on.
 *
 * The same validator the save uses, so a preview that renders is a preview that
 * will save, and one that would be refused says so before the operator has
 * built a whole theme on top of it.
 */
export const previewCustomization = asyncHandler(async (req, res) => {
  const current = await service.getCustomization(req.params.tenantId);
  const candidate = service.validateCustomization(req.body ?? {}, current);
  sendSuccess(
    res,
    { ...candidate, cssVariables: service.cssVariablesFor(candidate.theme) },
    'Customization preview',
  );
});
