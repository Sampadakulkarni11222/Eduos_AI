import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';
import { historyEntry, attachmentEntry } from '../modules/ops/common.js';

/**
 * Meetings of governing bodies and committees: the trust/society board, the
 * School Management Committee, a college's Governing Body, Academic Council,
 * IQAC, finance or purchase committees.
 */
const memberSchema = new Schema(
  {
    profileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    name: { type: String, required: true },
    role: { type: String, default: 'MEMBER' }, // CHAIR | SECRETARY | MEMBER | INVITEE
    voting: { type: Boolean, default: true },
    rsvp: { type: String, enum: ['PENDING', 'ACCEPTED', 'DECLINED', 'TENTATIVE'], default: 'PENDING' },
    attended: { type: Boolean, default: null },
    conflicts: [{ agendaOrder: Number, declaration: String }],
  },
  { _id: true }
);

const boardMeetingSchema = new Schema(
  {
    refNo: { type: String, required: true },
    body: { type: String, enum: ['TRUST_BOARD', 'SCHOOL_MANAGEMENT_COMMITTEE', 'GOVERNING_BODY', 'ACADEMIC_COUNCIL', 'IQAC', 'FINANCE_COMMITTEE', 'PURCHASE_COMMITTEE', 'PTA_EXECUTIVE', 'OTHER'], required: true },
    title: { type: String, required: true, trim: true },
    // Proposed slots while scheduling; members mark which they can attend.
    proposedSlots: [{ at: Date, available: [{ type: Schema.Types.ObjectId }] }],
    scheduledAt: { type: Date, default: null },
    durationMinutes: { type: Number, default: 90 },
    mode: { type: String, enum: ['IN_PERSON', 'ONLINE', 'HYBRID'], default: 'IN_PERSON' },
    location: { type: String, default: null },
    meetingLink: { type: String, default: null },
    quorum: { type: Number, default: null }, // members present needed; null = not set
    members: [memberSchema],
    agenda: [{
      order: Number,
      title: String,
      presenter: String,
      decisionNeeded: { type: Boolean, default: false },
      papers: [attachmentEntry],
      notes: String,
    }],
    agendaStatus: { type: String, enum: ['DRAFT', 'APPROVED', 'CIRCULATED'], default: 'DRAFT' },
    status: { type: String, enum: ['PLANNING', 'SCHEDULED', 'HELD', 'CANCELLED'], default: 'PLANNING' },
    minutes: {
      body: { type: String, default: null },
      status: { type: String, enum: ['NONE', 'DRAFT', 'APPROVED'], default: 'NONE' },
      approvedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
      approvedAt: { type: Date, default: null },
    },
    resolutions: [{
      number: String,
      agendaOrder: Number,
      text: String,
      proposer: String,
      seconder: String,
      votesFor: { type: Number, default: 0 },
      votesAgainst: { type: Number, default: 0 },
      abstentions: { type: Number, default: 0 },
      outcome: { type: String, enum: ['PASSED', 'FAILED', 'DEFERRED', 'WITHDRAWN'], default: 'PASSED' },
    }],
    actions: [{
      title: String,
      ownerProfileId: { type: Schema.Types.ObjectId, ref: 'Profile' },
      ownerName: String,
      dueOn: Date,
      status: { type: String, enum: ['OPEN', 'DONE', 'DROPPED'], default: 'OPEN' },
      resolutionNumber: String,
    }],
    organiserProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    history: [historyEntry],
  },
  { timestamps: true }
);
boardMeetingSchema.index({ tenantId: 1, refNo: 1 }, { unique: true });
boardMeetingSchema.index({ scheduledAt: 1 });
boardMeetingSchema.index({ 'members.profileId': 1 });

boardMeetingSchema.plugin(tenantScoped);
export const BoardMeeting = model('BoardMeeting', boardMeetingSchema);
