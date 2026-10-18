import { Expense } from '../../models/expense.model.js';
import { AppError } from '../../utils/AppError.js';
import { recordAudit } from '../../utils/auditTrail.js';

export async function list(query = {}) {
  const filter = {};
  if (query.from || query.to) filter.incurredOn = { ...(query.from && { $gte: new Date(query.from) }), ...(query.to && { $lte: new Date(query.to) }) };
  return Expense.find(filter).sort({ incurredOn: -1, _id: -1 }).lean();
}
export async function create(actor, body) {
  const amountPaise = Number(body.amountPaise);
  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) throw new AppError('amountPaise must be a positive integer', 400);
  if (!body.category?.trim() || !body.description?.trim() || !body.incurredOn) throw new AppError('category, description and incurredOn are required', 400);
  const expense = await Expense.create({ category: body.category.trim(), description: body.description.trim(), amountPaise, incurredOn: new Date(body.incurredOn), vendor: body.vendor?.trim() || null, reference: body.reference?.trim() || null, createdByProfileId: actor.profileId });
  await recordAudit({ actor, action: 'expenses.create', entityType: 'Expense', entityId: expense._id, after: { category: expense.category, amountPaise } });
  return expense;
}
export async function summary() {
  const [row] = await Expense.aggregate([{ $group: { _id: null, totalPaise: { $sum: '$amountPaise' }, count: { $sum: 1 } } }]);
  const byCategory = await Expense.aggregate([{ $group: { _id: '$category', amountPaise: { $sum: '$amountPaise' }, count: { $sum: 1 } } }, { $sort: { amountPaise: -1 } }]);
  return { totalPaise: row?.totalPaise ?? 0, count: row?.count ?? 0, byCategory: byCategory.map((r) => ({ category: r._id, amountPaise: r.amountPaise, count: r.count })) };
}
