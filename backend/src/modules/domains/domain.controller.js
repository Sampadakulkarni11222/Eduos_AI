import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { AppError } from '../../utils/AppError.js';
import * as service from './domain.service.js';

/**
 * School domains over HTTP.
 *
 * Every rule lives in domain.service.js, so the REST routes and the MCP tool
 * apply one set of them. The handlers only pass along which school is named —
 * and for a school-level caller that is whatever middleware/auth.js pinned.
 */

/** The acting school's own address and DNS instructions. */
export const getMine = asyncHandler(async (_req, res) => {
  sendSuccess(res, await service.getDomain(), 'Domain fetched');
});

/* ── Platform ─────────────────────────────────────────────── */

export const list = asyncHandler(async (_req, res) => {
  sendSuccess(res, await service.listDomains(), 'School domains fetched');
});

export const getOne = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.getDomain(req.params.tenantId), 'Domain fetched');
});

export const suggestSubdomain = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.suggestSubdomain(req.params.tenantId), 'Subdomain suggested');
});

export const configureSubdomain = asyncHandler(async (req, res) => {
  const result = await service.configureSubdomain(req.actor, req.params.tenantId, { subdomain: req.body?.subdomain });
  sendSuccess(res, result, result.changed ? 'Subdomain configured — pending verification' : 'Subdomain unchanged');
});

export const configureCustomDomain = asyncHandler(async (req, res) => {
  const result = await service.configureCustomDomain(req.actor, req.params.tenantId, { domain: req.body?.domain });
  sendSuccess(res, result, result.changed ? 'Custom domain configured — pending verification' : 'Custom domain unchanged');
});

export const verify = asyncHandler(async (req, res) => {
  const result = await service.verifyDomain(req.actor, req.params.tenantId);
  sendSuccess(res, result, `Verification ${result.outcome.toLowerCase()}`);
});

export const checkSsl = asyncHandler(async (req, res) => {
  const result = await service.checkSsl(req.actor, req.params.tenantId);
  sendSuccess(res, result, `Certificate check ${result.outcome.toLowerCase()}`);
});

export const activate = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.activateDomain(req.actor, req.params.tenantId), 'Domain activated');
});

export const deactivate = asyncHandler(async (req, res) => {
  const result = await service.deactivateDomain(req.actor, req.params.tenantId, { reason: req.body?.reason });
  sendSuccess(res, result, 'Domain deactivated');
});

/** Applies the School Admin profile's domain to the configuration — the review step. */
export const importProfileDomain = asyncHandler(async (req, res) => {
  const result = await service.importProfileDomain(req.actor, req.params.tenantId, {
    confirmReplace: req.body?.confirmReplace === true,
  });
  sendSuccess(res, result, result.changed ? 'Profile domain imported — pending verification' : 'Configuration already matches the profile');
});

export const dismissProfileDomainChange = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.dismissProfileDomainChange(req.actor, req.params.tenantId), 'Profile change dismissed');
});

/* ── Public ───────────────────────────────────────────────── */

/**
 * Which school a hostname serves. Unauthenticated: the frontend asks before
 * anyone has signed in. Answers only for an active domain of an active school,
 * and answers everything else with the same 404.
 */
export const resolve = asyncHandler(async (req, res) => {
  const found = await service.resolveHostname(req.query.host);
  if (!found) throw new AppError('No school is served at this address', 404, [], 'DOMAIN_NOT_FOUND');
  sendSuccess(res, found, 'Domain resolved');
});
