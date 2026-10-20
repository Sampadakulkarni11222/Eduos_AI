import * as health from '../../../health/health.service.js';
import { FEATURES } from '../../../../constants/features.js';
import { featureEnabled } from '../../../../utils/features.js';
import { AppError } from '../../../../utils/AppError.js';
import { ok } from '../protocol.js';
import { RISK } from './_shared.js';

/**
 * Ask AI (p5 memory and coverage): the principal's and administrator's
 * health-room COUNTS, so "how many students visited the health room this
 * week?" is answered instead of "you have no access to medical records".
 *
 * Counts only, exactly what the Health page's summary shows to holders of
 * health.summary.read (health.service.summary()): visits by outcome, today's
 * visits, injuries, medication plans and missed doses, stock alerts. No
 * student's name, no complaint, no medicine given to anyone -- the service
 * returns none of those, and nothing else is read here.
 */
export const p5AskAiTools = {
  get_health_room_summary: {
    feature: 'healthRoom',
    module: 'Health room', operation: 'GET', risk: RISK.LOW,
    description: 'Health-room figures as counts only, for the principal and administrators: visits today and over a period (by outcome: returned to class, rested, first aid, sent home, referred), injuries, active medication plans, missed or refused doses, and first-aid stock alerts. Never names a student or says why anyone visited. Read-only.',
    inputSchema: {
      type: 'object',
      properties: { days: { type: 'integer', minimum: 1, maximum: 366, description: 'The period in days, counting back from today (default 30; "this week" is 7)' } },
      additionalProperties: false,
    },
    permission: 'health.summary.read', minScope: 'ALL',
    // The nurse may read the counts too, but the routing rule leaves the nurse's own questions to the visit lists.
    forRoles: ['PRINCIPAL', 'ADMIN', 'TRUSTEE', 'NURSE'],
    service: 'health.service.summary()',
    async run(ctx, args) {
      if (!(await featureEnabled('healthRoom'))) {
        throw new AppError(`${FEATURES.healthRoom.label} is switched off for this school.`, 403, [], 'FEATURE_OFF');
      }
      const s = await health.summary(ctx.actor, { days: args.days });
      const o = s.visits.byOutcome;
      return ok({
        periodDays: s.periodDays,
        visits: { today: s.visits.today, inPeriod: s.visits.inPeriod, byOutcome: o, injuries: s.visits.injuries },
        medication: s.medication,
        stockAlerts: s.stock,
      }, {
        speak: `Health room, last ${s.periodDays} day(s): ${s.visits.inPeriod} visit(s) (${s.visits.today} today) — `
          + `${o.RETURNED_TO_CLASS} returned to class, ${o.REST} rested, ${o.FIRST_AID} first aid, ${o.SENT_HOME} sent home, ${o.REFERRED} referred; `
          + `${s.visits.injuries} injury visit(s). ${s.medication.activePlans} active medication plan(s), ${s.medication.missedOrRefusedInPeriod} missed or refused dose(s). `
          + `Stock: ${s.stock.low} low, ${s.stock.expiringSoon} expiring soon, ${s.stock.expired} expired. Counts only — names and reasons stay with the nurse.`,
      });
    },
  },
};
