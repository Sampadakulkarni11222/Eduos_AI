import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';

/**
 * A generated panel someone pinned to their analytics page or dashboard.
 *
 * Only the question is kept -- never the figures or the rendered program. A
 * pinned panel is rebuilt from the live records each time it is shown, with
 * the person's access at that moment, so a pin can never preserve data they
 * have since lost access to. It belongs to one person (profileId) and follows
 * them across devices.
 */
export const GENUI_SURFACES = ['analytics', 'dashboard'];
export const MAX_PINS_PER_SURFACE = 12;

const genUiPanelSchema = new Schema(
  {
    profileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    surface: { type: String, enum: GENUI_SURFACES, required: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    prompt: { type: String, required: true, trim: true, maxlength: 300 },
    // A parent's dashboard panel is about one child; kept so it shows the same child next time.
    childId: { type: Schema.Types.ObjectId, ref: 'Student', default: null },
    position: { type: Number, default: 0 },
  },
  { timestamps: true }
);

genUiPanelSchema.plugin(tenantScoped);
genUiPanelSchema.index({ tenantId: 1, profileId: 1, surface: 1, position: 1 });

export const GenUiPanel = model('GenUiPanel', genUiPanelSchema);
