import { Counter } from '../models/counter.model.js';
import { Invoice } from '../models/fee.model.js';

/**
 * Generates the next sequential invoice number formatted as INV-YYYY-XXXX.
 * Safe for concurrent callers via MongoDB atomic findOneAndUpdate with $inc.
 * Auto-detects the highest existing invoice number in DB if counter is not yet initialized.
 */
export async function getNextInvoiceNumber(year = new Date().getFullYear()) {
  const counterId = `invoices_${year}`;
  const prefix = `INV-${year}-`;

  const counterExists = await Counter.exists({ _id: counterId });
  if (!counterExists) {
    const regex = new RegExp(`^INV-${year}-(\\d+)$`);
    const invoices = await Invoice.find({ invoiceNo: { $regex: regex } })
      .select('invoiceNo')
      .lean();

    let maxSeq = 0;
    for (const inv of invoices) {
      const match = inv.invoiceNo.match(regex);
      if (match && match[1]) {
        const num = parseInt(match[1], 10);
        if (num > maxSeq) maxSeq = num;
      }
    }

    await Counter.updateOne(
      { _id: counterId },
      { $setOnInsert: { seq: maxSeq } },
      { upsert: true }
    );
  }

  let invoiceNo;
  let attempts = 0;
  do {
    const updated = await Counter.findOneAndUpdate(
      { _id: counterId },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );
    invoiceNo = `${prefix}${String(updated.seq).padStart(4, '0')}`;
    const exists = await Invoice.exists({ invoiceNo });
    if (!exists) break;
    attempts++;
  } while (attempts < 100);

  return invoiceNo;
}
