import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';
import { historyEntry } from '../modules/ops/common.js';

/**
 * "Give back": an alumnus offers something to the school community — a career
 * talk, mentoring hours, an internship, a job, a scholarship or volunteering.
 *
 * Every offer from an alumnus waits for a person with alumni.manage before
 * anyone sees it. Students never contact an alumnus directly: a student's
 * "I'm interested" goes to the school's alumni coordinator, who makes the
 * introduction (supervised, as mentoring is). The alumnus sees only how many
 * people are interested, never who.
 */
export const OPPORTUNITY_KINDS = ['CAREER_TALK', 'MENTORING', 'INTERNSHIP', 'JOB', 'SCHOLARSHIP', 'VOLUNTEER'];
// SENIOR_STUDENTS = Classes 9 to 12.
export const OPPORTUNITY_AUDIENCES = ['SENIOR_STUDENTS', 'ALL_STUDENTS', 'ALUMNI', 'EVERYONE'];
export const OPPORTUNITY_STATUSES = ['PENDING_REVIEW', 'PUBLISHED', 'REJECTED', 'WITHDRAWN', 'CLOSED'];

const interestSchema = new Schema(
  {
    profileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    name: { type: String, default: null },
    roleKey: { type: String, default: null },
    // The class, for a student, so the coordinator can judge fit.
    className: { type: String, default: null },
    note: { type: String, default: null },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const opportunitySchema = new Schema(
  {
    kind: { type: String, enum: OPPORTUNITY_KINDS, required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true },
    organisation: { type: String, default: null },
    location: { type: String, default: null },
    mode: { type: String, enum: ['IN_PERSON', 'ONLINE', 'HYBRID'], default: 'ONLINE' },
    applyBy: { type: Date, default: null },
    audience: { type: String, enum: OPPORTUNITY_AUDIENCES, default: 'SENIOR_STUDENTS' },
    // https only; shown to adults (alumni and staff), never to students.
    link: { type: String, default: null },
    postedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    postedByName: { type: String, default: null },
    postedByRole: { type: String, default: null },
    batchLabel: { type: String, default: null },
    status: { type: String, enum: OPPORTUNITY_STATUSES, default: 'PENDING_REVIEW' },
    review: {
      byProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
      at: { type: Date, default: null },
      note: { type: String, default: null },
    },
    interests: { type: [interestSchema], default: [] },
    history: [historyEntry],
  },
  { timestamps: true }
);
opportunitySchema.index({ status: 1, createdAt: -1 });
opportunitySchema.index({ postedByProfileId: 1, createdAt: -1 });
opportunitySchema.plugin(tenantScoped);

export const AlumniOpportunity = model('AlumniOpportunity', opportunitySchema);
