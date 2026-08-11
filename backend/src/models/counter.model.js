import { Schema, model } from 'mongoose';

/**
 * Generic atomic counter — used for sequential invoice numbering.
 * findOneAndUpdate with $inc is atomic in MongoDB, so concurrent invoice
 * creation can never produce duplicate numbers.
 */
const counterSchema = new Schema({
  _id: { type: String, required: true }, // e.g. "invoice"
  seq: { type: Number, default: 0 },
});

export const Counter = model('Counter', counterSchema);

/**
 * Returns the next sequential number for the given key.
 * Creates the counter document if it doesn't exist yet.
 */
export async function nextSeq(key) {
  const doc = await Counter.findByIdAndUpdate(
    key,
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );
  return doc.seq;
}
