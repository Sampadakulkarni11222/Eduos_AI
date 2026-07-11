import { Schema, model } from 'mongoose';

const ticketSchema = new Schema(
  {
    subject: { type: String, required: true, trim: true },
    status: { type: String, enum: ['NEW', 'OPEN', 'WAITING', 'RESOLVED', 'CLOSED'], default: 'NEW' },
    priority: { type: String, default: 'NORMAL' },
    raisedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    routedToRoleKey: { type: String }, // ADMIN | WARDEN | LIBRARIAN | CLASS_TEACHER
    assigneeProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', default: null },
  },
  { timestamps: true }
);
ticketSchema.index({ status: 1 });

const ticketMessageSchema = new Schema(
  {
    ticketId: { type: Schema.Types.ObjectId, ref: 'Ticket', required: true },
    authorProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    body: { type: String, required: true },
    channel: { type: String, enum: ['WEB', 'MOBILE', 'WHATSAPP', 'SYSTEM'], default: 'WEB' },
  },
  { timestamps: true }
);
ticketMessageSchema.index({ ticketId: 1 });

export const Ticket = model('Ticket', ticketSchema);
export const TicketMessage = model('TicketMessage', ticketMessageSchema);
