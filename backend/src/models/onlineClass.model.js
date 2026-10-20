import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';
import { historyEntry, attachmentEntry } from '../modules/ops/common.js';

/**
 * A digital lecture or online meeting: who it is for, when it runs, where to
 * join, what was shared and who joined.
 *
 * The join link is held here and handed out one person at a time by the join
 * route, to people the class is for. "Joined" below means a person opened the
 * link through EduOS; it is not proof they stayed, which only the meeting
 * provider knows.
 */
const onlineClassSchema = new Schema(
  {
    refNo: { type: String, required: true },
    // A repeating class is a set of ordinary classes sharing a seriesId.
    seriesId: { type: String, default: null },
    kind: { type: String, enum: ['LECTURE', 'DOUBT_SESSION', 'PARENT_MEETING', 'STAFF_MEETING', 'WEBINAR', 'OTHER'], default: 'LECTURE' },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: null },

    hostProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    hostName: { type: String, default: null },

    // Who it is for. Any mix of whole sections, named people and staff roles.
    sectionIds: [{ type: Schema.Types.ObjectId, ref: 'Section' }],
    subjectOfferingId: { type: Schema.Types.ObjectId, ref: 'SubjectOffering', default: null },
    subjectName: { type: String, default: null },
    includeGuardians: { type: Boolean, default: false },
    inviteeProfileIds: [{ type: Schema.Types.ObjectId, ref: 'Profile' }],
    inviteeRoles: [{ type: String }],

    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },

    provider: { type: String, enum: ['JITSI', 'GOOGLE_MEET', 'ZOOM', 'TEAMS', 'OTHER'], required: true },
    joinUrl: { type: String, required: true },
    passcode: { type: String, default: null },

    status: { type: String, enum: ['SCHEDULED', 'LIVE', 'ENDED', 'CANCELLED'], default: 'SCHEDULED' },
    cancelReason: { type: String, default: null },
    startedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },

    materials: [attachmentEntry],
    recordingUrl: { type: String, default: null },
    summary: { type: String, default: null },

    joins: [{
      profileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
      name: { type: String, default: null },
      roleKey: { type: String, default: null },
      firstJoinedAt: { type: Date, default: Date.now },
      lastJoinedAt: { type: Date, default: Date.now },
      times: { type: Number, default: 1 },
    }],

    reminderSentAt: { type: Date, default: null },
    history: [historyEntry],
  },
  { timestamps: true },
);
onlineClassSchema.index({ tenantId: 1, refNo: 1 }, { unique: true });
onlineClassSchema.index({ startsAt: 1, status: 1 });
onlineClassSchema.index({ sectionIds: 1, startsAt: 1 });
onlineClassSchema.index({ hostProfileId: 1, startsAt: 1 });

onlineClassSchema.plugin(tenantScoped);
export const OnlineClass = model('OnlineClass', onlineClassSchema);
