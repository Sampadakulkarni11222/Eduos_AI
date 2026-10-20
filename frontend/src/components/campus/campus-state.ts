/**
 * Room-state colours and the rule that picks a room's state.
 *
 * Kept apart from campus-scene.ts, which imports three.js: the campus page
 * needs these for its legend and list on the first render, and importing them
 * from the scene module pulled the whole 3D engine into the page's initial
 * bundle even though the scene itself is loaded with a dynamic import.
 */
import type { CampusNodeDto } from '@/lib/ops-types';

export const STATE_COLORS: Record<string, string> = {
  FREE: '#8FD3A6',
  SCHEDULED_CLASS: '#4F86E8',
  EXAM: '#E0527A',
  BOOKED: '#9B7BE6',
  EVENT: '#F2B33D',
  UNDER_MAINTENANCE: '#F07F3C',
  CLOSED: '#B4B9C2',
  RESTRICTED: '#5D6470',
  OTHER: '#DDE3EC',
};

export function stateOf(n: CampusNodeDto): string {
  if (n.restricted && n.name === 'Restricted area') return 'RESTRICTED';
  if (n.status === 'UNDER_MAINTENANCE') return 'UNDER_MAINTENANCE';
  if (n.status === 'CLOSED') return 'CLOSED';
  const s = n.now?.[0]?.type;
  if (s === 'EXAM' || s === 'SCHEDULED_CLASS' || s === 'BOOKED' || s === 'EVENT') return s;
  if (n.now) return 'FREE';
  return 'OTHER';
}
