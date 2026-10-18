import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import { School } from '../src/models/school.model.js';
import { runWithTenant } from '../src/tenancy/tenantContext.js';
import { dispatchFeeReminders, dispatchQuarterlyFinancialReport } from '../src/modules/fees/fee.service.js';

// Run from a platform scheduler once daily (not from every web process). Each
// delivery is durable and idempotent, so scheduler retries are safe.
await connectDB();
try {
  const schools = await School.find({ status: 'ACTIVE' }).select('slug').lean();
  const results = [];
  for (const school of schools) {
    results.push(await runWithTenant(school.slug, async () => ({
      school: school.slug,
      reminders: await dispatchFeeReminders({ dueSoonDays: 7 }),
      quarterly: await dispatchQuarterlyFinancialReport(),
    })));
  }
  console.log(JSON.stringify({ ok: true, schools: results }, null, 2));
} finally {
  await mongoose.disconnect();
}
