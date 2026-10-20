import { AppError } from '../../utils/AppError.js';
import { GenUiPanel, GENUI_SURFACES, MAX_PINS_PER_SURFACE } from '../../models/genUiPanel.model.js';
import { askDashboard } from './ask.service.js';

/**
 * Pinned "Ask your dashboard" panels: per person, per surface, on the server
 * (they follow the person across devices). Each one is only a saved question;
 * showing it asks again with the person's current access.
 */

const surfaceOf = (s) => {
  if (!GENUI_SURFACES.includes(s)) throw new AppError(`surface must be one of ${GENUI_SURFACES.join(', ')}`, 400, [], 'BAD_SURFACE');
  return s;
};
const idOk = (id) => /^[a-f0-9]{24}$/i.test(String(id ?? ''));
const dto = (p) => ({ id: String(p._id), surface: p.surface, title: p.title, prompt: p.prompt, childId: p.childId ? String(p.childId) : null, position: p.position, createdAt: p.createdAt });

export async function list(actor, { surface } = {}) {
  const rows = await GenUiPanel.find({ profileId: actor.profileId, surface: surfaceOf(surface) }).sort({ position: 1, createdAt: 1 }).lean();
  return { items: rows.map(dto), max: MAX_PINS_PER_SURFACE };
}

export async function pin(actor, { surface, prompt, title, childId = null } = {}) {
  const s = surfaceOf(surface);
  const text = typeof prompt === 'string' ? prompt.trim() : '';
  if (!text || text.length > 300) throw new AppError('prompt is required (at most 300 characters)', 400, [], 'PROMPT_REQUIRED');
  if (childId !== null && childId !== undefined && !idOk(childId)) throw new AppError('childId must be a student id', 400, [], 'BAD_CHILD');
  const count = await GenUiPanel.countDocuments({ profileId: actor.profileId, surface: s });
  if (count >= MAX_PINS_PER_SURFACE) throw new AppError(`You can pin up to ${MAX_PINS_PER_SURFACE} panels here. Unpin one first.`, 409, [], 'TOO_MANY_PINS');
  const same = await GenUiPanel.findOne({ profileId: actor.profileId, surface: s, prompt: text, childId: childId || null }).lean();
  if (same) return dto(same);
  const name = (typeof title === 'string' && title.trim() ? title.trim() : text).slice(0, 120);
  const row = await GenUiPanel.create({ profileId: actor.profileId, surface: s, prompt: text, title: name, childId: childId || null, position: count });
  return dto(row);
}

export async function unpin(actor, id) {
  if (!idOk(id)) throw new AppError('Panel not found', 404, [], 'NOT_FOUND');
  const row = await GenUiPanel.findOneAndDelete({ _id: id, profileId: actor.profileId });
  if (!row) throw new AppError('Panel not found', 404, [], 'NOT_FOUND');
  return { id: String(row._id), removed: true };
}

/** A pinned panel, rebuilt now. Only the owner can show it. */
export async function render(actor, id) {
  if (!idOk(id)) throw new AppError('Panel not found', 404, [], 'NOT_FOUND');
  const row = await GenUiPanel.findOne({ _id: id, profileId: actor.profileId }).lean();
  if (!row) throw new AppError('Panel not found', 404, [], 'NOT_FOUND');
  const built = await askDashboard(actor, { prompt: row.prompt, child: row.childId ? String(row.childId) : null });
  return { panel: dto(row), ...built };
}
