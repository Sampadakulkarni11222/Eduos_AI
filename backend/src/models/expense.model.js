import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';

const expenseCategorySchema = new Schema(
  {
    name: { type: String, required: true, trim: true }, // e.g. "Utilities", "Salaries", "Supplies", "Maintenance"
    code: { type: String, trim: true }, // e.g. "UTIL-01"
    description: { type: String, trim: true, default: null },
  },
  { timestamps: true }
);
expenseCategorySchema.index({ tenantId: 1, name: 1 }, { unique: true });

const budgetSchema = new Schema(
  {
    academicYearId: { type: Schema.Types.ObjectId, ref: 'AcademicYear', required: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'ExpenseCategory', required: true },
    quarter: { type: String, enum: ['Q1', 'Q2', 'Q3', 'Q4', 'ANNUAL'], default: 'ANNUAL' },
    allocatedPaise: { type: Number, required: true }, // in paise
    notes: { type: String, trim: true, default: null },
  },
  { timestamps: true }
);
budgetSchema.index({ tenantId: 1, academicYearId: 1, categoryId: 1, quarter: 1 }, { unique: true });

const expenseSchema = new Schema(
  {
    categoryId: { type: Schema.Types.ObjectId, ref: 'ExpenseCategory', required: true },
    academicYearId: { type: Schema.Types.ObjectId, ref: 'AcademicYear', default: null },
    title: { type: String, required: true, trim: true },
    amountPaise: { type: Number, required: true }, // in paise
    expenseDate: { type: Date, required: true },
    paymentMode: { type: String, enum: ['CASH', 'CHEQUE', 'BANK', 'ONLINE'], default: 'BANK' },
    vendorName: { type: String, trim: true, default: null },
    invoiceRef: { type: String, trim: true, default: null },
    receiptUrl: { type: String, trim: true, default: null },
    status: { type: String, enum: ['DRAFT', 'APPROVED', 'PAID', 'CANCELLED'], default: 'PAID' },
    recordedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    approvedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    notes: { type: String, trim: true, default: null },
  },
  { timestamps: true }
);
expenseSchema.index({ tenantId: 1, expenseDate: -1 });
expenseSchema.index({ tenantId: 1, categoryId: 1 });

expenseCategorySchema.plugin(tenantScoped);
export const ExpenseCategory = model('ExpenseCategory', expenseCategorySchema);

budgetSchema.plugin(tenantScoped);
export const Budget = model('Budget', budgetSchema);

expenseSchema.plugin(tenantScoped);
export const Expense = model('Expense', expenseSchema);
