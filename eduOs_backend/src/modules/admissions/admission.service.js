import { Lead, LeadInteraction } from '../../models/lead.model.js';
import { Student } from '../../models/student.model.js';
import { AppError } from '../../utils/AppError.js';

// Helper: map a raw Lead doc to the DTO the frontend expects
function toLeadDto(lead) {
  const raw = lead.toObject ? lead.toObject() : lead;
  return {
    id: raw._id,
    childName: raw.childName,
    guardianName: raw.guardianName,
    phone: raw.phone,
    email: raw.email,
    gradeApplying: raw.gradeApplying,
    source: raw.source,
    stage: raw.stage,
    notes: raw.notes,
    nextActionAt: raw.nextActionAt,
    assigneeProfileId: raw.assigneeProfileId,
    createdAt: raw.createdAt,
  };
}

export async function getPipeline() {
  const leads = await Lead.find().sort({ createdAt: -1 }).lean();

  const STAGES = ['NEW', 'CONTACTED', 'TOUR_SCHEDULED', 'APPLICATION', 'ENROLLED', 'LOST'];

  // Group leads by stage into arrays matching frontend Pipeline type
  const byStage = Object.fromEntries(STAGES.map((s) => [s, []]));

  leads.forEach((lead) => {
    const stage = lead.stage || 'NEW';
    if (byStage[stage]) {
      byStage[stage].push({
        id: lead._id,
        childName: lead.childName,
        guardianName: lead.guardianName,
        phone: lead.phone,
        gradeApplying: lead.gradeApplying,
        source: lead.source,
        stage: lead.stage,
        notes: lead.notes,
        nextActionAt: lead.nextActionAt,
        createdAt: lead.createdAt,
      });
    }
  });

  return { stages: STAGES, byStage };
}


async function ensureStudentForEnrolledLead(lead) {
  if (lead.stage !== 'ENROLLED') return;
  const existingStudent = await Student.findOne({ leadId: lead._id });
  if (!existingStudent) {
    const nameParts = lead.childName.trim().split(/\s+/);
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(' ') || '';

    const count = await Student.countDocuments();
    let admissionNo = `ADM-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`;
    let checkStudent = await Student.findOne({ admissionNo });
    let attempts = 0;
    while (checkStudent && attempts < 100) {
      attempts++;
      admissionNo = `ADM-${new Date().getFullYear()}-${String(count + 1 + attempts).padStart(4, '0')}`;
      checkStudent = await Student.findOne({ admissionNo });
    }

    await Student.create({
      admissionNo,
      firstName,
      lastName,
      leadId: lead._id,
      status: 'ACTIVE',
    });
  }
}

export async function createLead(data) {
  // Accept phoneE164 (frontend field name) or phone
  const phone = data.phoneE164 ?? data.phone;

  if (!data.childName || !data.guardianName || !phone) {
    throw new AppError('childName, guardianName, and phone are required', 400);
  }

  const lead = await Lead.create({
    childName: data.childName,
    guardianName: data.guardianName,
    phone,
    email: data.email ?? null,
    gradeApplying: data.gradeApplying ?? null,
    source: data.source ?? 'WALK_IN',
    stage: data.stage ?? 'NEW',
    notes: data.notes ?? null,
  });

  await ensureStudentForEnrolledLead(lead);

  return { id: lead._id };
}

export async function updateLead({ leadId, stage, notes, assigneeProfileId, nextActionAt, actorProfileId }) {
  const lead = await Lead.findById(leadId);
  if (!lead) throw new AppError('Lead not found', 404);

  const previousStage = lead.stage;
  if (stage !== undefined) lead.stage = stage;
  if (notes !== undefined) lead.notes = notes;
  if (assigneeProfileId !== undefined) lead.assigneeProfileId = assigneeProfileId;
  if (nextActionAt !== undefined) lead.nextActionAt = nextActionAt;
  await lead.save();

  if (stage && stage !== previousStage) {
    await LeadInteraction.create({
      leadId,
      type: 'STAGE_CHANGE',
      body: `${previousStage} → ${stage}`,
      authorProfileId: actorProfileId,
    });
  }

  // Ensure student record exists if lead is ENROLLED
  await ensureStudentForEnrolledLead(lead);

  return toLeadDto(lead);
}

