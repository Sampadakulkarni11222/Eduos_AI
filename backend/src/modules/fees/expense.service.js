import { ExpenseCategory, Budget, Expense } from '../../models/expense.model.js';
import { AppError } from '../../utils/AppError.js';
import { recordAudit } from '../../utils/auditTrail.js';

export async function listExpenseCategories() {
  return ExpenseCategory.find().sort({ name: 1 }).lean();
}

export async function createExpenseCategory(actor, data) {
  const category = await ExpenseCategory.create(data);
  await recordAudit({
    actor,
    action: 'expense.category.create',
    entityType: 'ExpenseCategory',
    entityId: category._id,
    after: category.toObject(),
  });
  return category;
}

export async function listExpenses({ categoryId, from, to, page = 1, pageSize = 25 } = {}) {
  const filter = {};
  if (categoryId) filter.categoryId = categoryId;
  if (from || to) {
    filter.expenseDate = {};
    if (from) filter.expenseDate.$gte = new Date(from);
    if (to) {
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);
      filter.expenseDate.$lte = end;
    }
  }

  const p = Math.max(1, parseInt(page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 25));
  const total = await Expense.countDocuments(filter);
  const items = await Expense.find(filter)
    .populate('categoryId', 'name code')
    .sort({ expenseDate: -1 })
    .skip((p - 1) * limit)
    .limit(limit)
    .lean();

  return { items, total, page: p, pageSize: limit, totalPages: Math.ceil(total / limit) || 1 };
}

export async function recordExpense(actor, data) {
  if (!data.categoryId) throw new AppError('categoryId is required', 400);
  if (!data.title) throw new AppError('Expense title is required', 400);
  const amountPaise = Number(data.amountPaise);
  if (!Number.isFinite(amountPaise) || amountPaise <= 0) {
    throw new AppError('amountPaise must be a positive integer', 400);
  }

  const expense = await Expense.create({
    ...data,
    amountPaise,
    expenseDate: data.expenseDate ? new Date(data.expenseDate) : new Date(),
    recordedByProfileId: actor?.profileId,
  });

  await recordAudit({
    actor,
    action: 'expense.create',
    entityType: 'Expense',
    entityId: expense._id,
    after: expense.toObject(),
  });

  return expense;
}

export async function listBudgets({ academicYearId, quarter } = {}) {
  const filter = {};
  if (academicYearId) filter.academicYearId = academicYearId;
  if (quarter) filter.quarter = quarter;
  return Budget.find(filter)
    .populate('categoryId', 'name code')
    .populate('academicYearId', 'name')
    .lean();
}

export async function setBudget(actor, data) {
  if (!data.academicYearId || !data.categoryId) {
    throw new AppError('academicYearId and categoryId are required', 400);
  }
  const allocatedPaise = Number(data.allocatedPaise);
  if (!Number.isFinite(allocatedPaise) || allocatedPaise < 0) {
    throw new AppError('allocatedPaise must be non-negative', 400);
  }

  const budget = await Budget.findOneAndUpdate(
    {
      academicYearId: data.academicYearId,
      categoryId: data.categoryId,
      quarter: data.quarter || 'ANNUAL',
    },
    { $set: { allocatedPaise, notes: data.notes ?? null } },
    { new: true, upsert: true }
  );

  await recordAudit({
    actor,
    action: 'budget.set',
    entityType: 'Budget',
    entityId: budget._id,
    after: budget.toObject(),
  });

  return budget;
}

export async function getBudgetUtilization({ academicYearId } = {}) {
  const budgets = await listBudgets({ academicYearId });
  const categoryIds = budgets.map((b) => b.categoryId?._id || b.categoryId);

  const expensesAgg = await Expense.aggregate([
    { $match: { categoryId: { $in: categoryIds }, status: { $ne: 'CANCELLED' } } },
    { $group: { _id: '$categoryId', totalSpentPaise: { $sum: '$amountPaise' } } },
  ]);

  const spentMap = new Map(expensesAgg.map((e) => [String(e._id), e.totalSpentPaise]));

  return budgets.map((b) => {
    const catId = String(b.categoryId?._id || b.categoryId);
    const spentPaise = spentMap.get(catId) || 0;
    const allocatedPaise = b.allocatedPaise || 0;
    const utilizationPct = allocatedPaise > 0 ? Math.round((spentPaise / allocatedPaise) * 100) : 0;
    return {
      budgetId: b._id,
      category: b.categoryId?.name ?? 'General',
      quarter: b.quarter,
      allocatedPaise,
      spentPaise,
      remainingPaise: Math.max(0, allocatedPaise - spentPaise),
      overrunPaise: Math.max(0, spentPaise - allocatedPaise),
      utilizationPct,
    };
  });
}
