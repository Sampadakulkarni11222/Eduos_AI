import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';

const expenseSchema = new Schema({
  category: { type: String, required: true, trim: true, maxlength: 80 },
  description: { type: String, required: true, trim: true, maxlength: 500 },
  amountPaise: { type: Number, required: true, min: 1 },
  incurredOn: { type: Date, required: true },
  vendor: { type: String, trim: true, maxlength: 120, default: null },
  reference: { type: String, trim: true, maxlength: 120, default: null },
  createdByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
}, { timestamps: true });
expenseSchema.index({ incurredOn: -1, category: 1 });
expenseSchema.plugin(tenantScoped);
export const Expense = model('Expense', expenseSchema);
