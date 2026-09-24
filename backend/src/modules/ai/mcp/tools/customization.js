import * as customization from '../../../customization/customization.service.js';
import { ok } from '../protocol.js';
import { RISK, summarise } from './_shared.js';

/**
 * What this school's forms offer, and what it calls itself.
 *
 * One read tool, and it is here for the option lists rather than the colours.
 * "Which houses do we have?" and "what are the transport zones?" are questions
 * about school data that only this configuration can answer — every other route
 * to them would be the assistant guessing from records that happen to use the
 * values. The branding comes along because it is in the same document and is
 * the cheapest possible answer to "what is our school called on the portal".
 *
 * There is no write tool, for the reason the seat tools give: changing a
 * school's theme is `customization.manage`, a Super-Admin-only key, and
 * SUPER_ADMIN is the role deliberately withheld `ai.copilot.use`. A write tool
 * would therefore have to be exposed to a school-level role, which would hand
 * every School Admin an assistant that can restyle their school — the opposite
 * of the rule this configuration is governed by.
 *
 * Scoped to the caller's own school by the service, which is scoped by the
 * tenancy plugin. There is no argument for naming a school, so an assistant
 * cannot be steered into reading another one's.
 */

export const customizationTools = {
  get_school_customization: {
    module: 'Customization',
    operation: 'GET',
    risk: RISK.LOW,
    description:
      "This school's own branding and the option lists its forms offer — houses, zones, and any other dropdown the platform has configured for it. Use it to answer what values a field accepts at this school. Read-only, and always about the caller's own school.",
    inputSchema: {
      type: 'object',
      properties: {
        dropdownKey: {
          type: 'string',
          maxLength: 40,
          description: 'Narrow to one list, e.g. "house". Omit for all of them.',
        },
      },
      additionalProperties: false,
    },
    permission: 'settings.manage',
    minScope: 'ALL',
    service: 'customization.service.getCustomization()',
    resultShape: 'LIST',
    async run(_ctx, args) {
      const config = await customization.getCustomization();
      const wanted = args?.dropdownKey ? String(args.dropdownKey).trim().toLowerCase() : null;
      const dropdowns = wanted ? config.dropdowns.filter((d) => d.key === wanted) : config.dropdowns;

      const data = {
        schoolName: config.branding.displayName,
        tagline: config.branding.tagline,
        customized: config.customized,
        dropdowns: dropdowns.map((d) => ({
          key: d.key,
          label: d.label,
          options: d.options.map((o) => o.label),
        })),
        count: dropdowns.length,
      };

      if (wanted && dropdowns.length === 0) {
        return ok(data, { speak: `This school has no "${wanted}" list configured.` });
      }
      if (dropdowns.length === 0) {
        return ok(data, { speak: 'This school has no configured dropdown lists.' });
      }

      const view = summarise(dropdowns, (d) => `${d.label}: ${d.options.map((o) => o.label).join(', ')}`);
      return ok(data, { speak: `${view.list}.` });
    },
  },
};
