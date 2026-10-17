import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';

const quarterlyFinancialReportSchema = new Schema(
  {
    year: { type: Number, required: true },
    quarter: { type: String, enum: ['Q1', 'Q2', 'Q3', 'Q4'], required: true },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    academicYearId: { type: Schema.Types.ObjectId, ref: 'AcademicYear', default: null },

    metrics: {
      openingReceivablesPaise: { type: Number, default: 0 },
      closingReceivablesPaise: { type: Number, default: 0 },
      totalBilledPaise: { type: Number, default: 0 },
      totalCollectedPaise: { type: Number, default: 0 },
      collectionRatePct: { type: Number, default: 0 },
      totalExpensesPaise: { type: Number, default: 0 },
      netOperatingMarginPaise: { type: Number, default: 0 },
      totalConcessionsPaise: { type: Number, default: 0 },
      totalRefundsPaise: { type: Number, default: 0 },
      unreconciledPaymentsPaise: { type: Number, default: 0 },
      potentialLeakagePaise: { type: Number, default: 0 },
      confirmedLeakagePaise: { type: Number, default: 0 },
      recoveredLeakagePaise: { type: Number, default: 0 },
    },

    ageingBuckets: {
      currentPaise: { type: Number, default: 0 }, // 0 - 30 days
      thirtyToSixtyPaise: { type: Number, default: 0 }, // 31 - 60 days
      sixtyToNinetyPaise: { type: Number, default: 0 }, // 61 - 90 days
      aboveNinetyPaise: { type: Number, default: 0 }, // 90+ days
    },

    segmentPerformance: [
      {
        segmentName: { type: String, required: true },
        billedPaise: { type: Number, default: 0 },
        collectedPaise: { type: Number, default: 0 },
        pendingPaise: { type: Number, default: 0 },
      },
    ],

    executiveSummary: { type: String, trim: true, default: null },
    status: { type: String, enum: ['DRAFT', 'FINALIZED', 'PUBLISHED', 'DISTRIBUTED'], default: 'FINALIZED' },
    generatedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    distributionHistory: [
      {
        recipientEmail: { type: String, required: true },
        sentAt: { type: Date, default: Date.now },
        deliveryStatus: { type: String, default: 'DELIVERED' },
      },
    ],
  },
  { timestamps: true }
);

quarterlyFinancialReportSchema.index({ tenantId: 1, year: 1, quarter: 1 }, { unique: true });

quarterlyFinancialReportSchema.plugin(tenantScoped);
export const QuarterlyFinancialReport = model('QuarterlyFinancialReport', quarterlyFinancialReportSchema);
