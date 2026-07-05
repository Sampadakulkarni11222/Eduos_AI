import { Schema, model } from 'mongoose';

const calendarEventSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String },
    type: { type: String, default: 'EVENT' }, // HOLIDAY | EXAM | PTM | SPORTS | EVENT
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    audience: { type: Schema.Types.Mixed, default: { all: true } },
    createdByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);
calendarEventSchema.index({ startsAt: 1 });

export const CalendarEvent = model('CalendarEvent', calendarEventSchema);
