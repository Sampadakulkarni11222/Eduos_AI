import { SustainabilityZone, Plant, WasteLog, EcoActivity, SanitationDuty } from '../../models/sustainability.model.js';
import { openSanitationTasks } from './sustainability.sanitation.js';

/**
 * What the campus map shows for sustainability, in one call.
 *
 * For the 3D map: each zone (with its facility, when linked, so it can be
 * placed), the plants in it and how many survive, the latest activity, and the
 * sanitation tasks that are open. Nothing restricted is included: no pupil
 * names, no evidence files, no individual's details beyond a task title.
 *
 * Runs inside the caller's school (the tenant plugin filters every query).
 *
 * @returns {Promise<{ zones: Array, recentActivity: Array, openSanitationTasks: Array }>}
 */
export async function sustainabilityFor({ limit = 20 } = {}) {
  const [zones, plants, duties, tasks, waste, activities] = await Promise.all([
    SustainabilityZone.find({ active: true }).select('name kind facilityId').lean(),
    Plant.find({}).select('zoneId count status').lean(),
    SanitationDuty.find({ active: true }).select('zoneId kind title nextDueAt').lean(),
    openSanitationTasks({ limit: 100 }),
    WasteLog.find({}).sort({ date: -1 }).limit(limit).select('date stream weightGrams zoneId refNo').lean(),
    EcoActivity.find({ status: 'VERIFIED' }).sort({ date: -1 }).limit(limit).select('date title category points refNo').lean(),
  ]);
  const dutyById = new Map(duties.map((d) => [String(d._id), d]));
  const out = zones.map((z) => {
    const id = String(z._id);
    const zp = plants.filter((p) => String(p.zoneId) === id);
    const planted = zp.reduce((s, p) => s + (p.count ?? 1), 0);
    const alive = zp.filter((p) => p.status === 'ALIVE' || p.status === 'NEEDS_CARE').reduce((s, p) => s + (p.count ?? 1), 0);
    const zoneTasks = tasks.filter((t) => t.dutyId && String(dutyById.get(t.dutyId)?.zoneId) === id);
    return {
      id, name: z.name, kind: z.kind, facilityId: z.facilityId ? String(z.facilityId) : null,
      plants: { planted, alive, survivalPct: planted ? Math.round((alive / planted) * 1000) / 10 : null },
      sanitationDuties: duties.filter((d) => String(d.zoneId) === id).length,
      openSanitationTasks: zoneTasks.length, overdueSanitationTasks: zoneTasks.filter((t) => t.overdue).length,
    };
  });
  const recentActivity = [
    ...waste.map((w) => ({ kind: 'WASTE', at: w.date, label: `${w.stream.replace(/_/g, ' ').toLowerCase()} waste ${Math.round(w.weightGrams / 100) / 10} kg`, ref: w.refNo, zoneId: w.zoneId ? String(w.zoneId) : null })),
    ...activities.map((a) => ({ kind: 'ACTIVITY', at: a.date, label: `${a.title} (+${a.points})`, ref: a.refNo, zoneId: null })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, limit);
  return { zones: out, recentActivity, openSanitationTasks: tasks.map(({ id, refNo, title, dueAt, overdue }) => ({ id, refNo, title, dueAt, overdue })) };
}
