/**
 * Typed client for "Ask your dashboard" (POST /genui/ask) and pinned panels
 * (/genui/panels). Kept in its own file so other modules' clients are untouched.
 */
import { request } from './api';
import type { GenUi } from '@/components/genui/genui';

export type GenUiSurface = 'analytics' | 'dashboard';
export interface GenUiAnswer {
  title: string;
  source: 'analytics' | 'dashboard' | 'none';
  plan: Record<string, unknown> | null;
  ui: GenUi | null;
}
export interface PinnedPanel { id: string; surface: GenUiSurface; title: string; prompt: string; childId: string | null; position: number; createdAt: string }

export const genuiApi = {
  ask: (prompt: string, child?: string | null) =>
    request<GenUiAnswer>('/genui/ask', { method: 'POST', body: JSON.stringify({ prompt, child: child ?? null }) }),
  pinned: (surface: GenUiSurface) => request<{ items: PinnedPanel[]; max: number }>(`/genui/panels?surface=${surface}`),
  pin: (surface: GenUiSurface, prompt: string, title?: string, childId?: string | null) =>
    request<PinnedPanel>('/genui/panels', { method: 'POST', body: JSON.stringify({ surface, prompt, title, childId: childId ?? null }) }),
  render: (id: string) => request<GenUiAnswer & { panel: PinnedPanel }>(`/genui/panels/${encodeURIComponent(id)}`),
  unpin: (id: string) => request<{ id: string; removed: boolean }>(`/genui/panels/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
