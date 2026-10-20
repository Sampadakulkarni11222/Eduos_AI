import { request } from './api';
import type { NavGroup } from './portals';

/** One record the server found, with the pages (portal-relative keys) that can open it. */
export interface SearchItem { id: string; title: string; subtitle: string | null; params?: Record<string, string> }
export interface SearchGroup { type: string; label: string; pages: string[]; items: SearchItem[] }
export interface SearchResult { q: string; groups: SearchGroup[]; total: number }

export const searchApi = {
  search: (q: string) => request<SearchResult>(`/search?q=${encodeURIComponent(q)}`),
};

/**
 * Words people type for a page whose menu label says something else
 * ("fees" for Payments, "homework" for Assignments). Matched against the
 * label and the page key.
 */
const SYNONYMS: Record<string, string[]> = {
  fees: ['payments', 'fees', 'fee health', 'concessions'], fee: ['payments', 'fees', 'fee health'], pay: ['payments', 'payslips', 'payroll'],
  salary: ['payslips', 'payroll'], homework: ['assignments'], marks: ['performance', 'exams', 'report cards'], results: ['performance', 'exams', 'report cards'],
  notice: ['announcements'], notices: ['announcements'], circular: ['announcements', 'correspondence'], bus: ['transport', 'bus', 'fleet'],
  leave: ['leave', 'staff leave'], holiday: ['calendar'], events: ['calendar', 'events'], books: ['library', 'catalog'], help: ['user guide', 'support', 'tickets'],
  complaint: ['tickets', 'support'], enquiry: ['admission', 'admissions'], admission: ['admission', 'online applications'], ads: ['connectors', 'campaigns'],
  marketing: ['marketing', 'campaigns', 'connectors', 'attribution'], roi: ['attribution'], qr: ['campaigns'], poster: ['campaigns'], banner: ['campaigns'],
  attendance: ['attendance'], timetable: ['timetable'], news: ['newsroom'], social: ['social', 'newsroom'], gate: ['gate', 'pickup'],
};

export interface PageHit { label: string; href: string; group: string; icon: string }

/** Pages of the caller's own menu (already filtered by permission) that match the query. */
export function matchPages(nav: NavGroup[], q: string, limit = 8): PageHit[] {
  const query = q.trim().toLowerCase();
  if (query.length < 2) return [];
  const words = [query, ...(SYNONYMS[query] ?? [])];
  const hits: Array<PageHit & { score: number }> = [];
  for (const g of nav) {
    for (const it of g.items) {
      if (!it.ready) continue;
      const label = it.label.toLowerCase();
      const key = it.href.split('/').pop()?.replace(/-/g, ' ') ?? '';
      let score = 0;
      if (label.startsWith(query)) score = 3;
      else if (label.split(/[\s&/]+/).some((w) => w.startsWith(query)) || key.startsWith(query)) score = 2;
      else if (words.some((w) => label.includes(w) || key.includes(w))) score = 1;
      if (score && !hits.some((h) => h.href === it.href)) hits.push({ label: it.label, href: it.href, group: g.title, icon: it.icon, score });
    }
  }
  return hits.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label)).slice(0, limit).map(({ score: _s, ...h }) => h);
}

/** The first of a result's pages that the caller's menu has, as a portal path with the result's query. */
export function resultHref(portalSlug: string, navHrefs: Set<string>, pages: string[], params?: Record<string, string>): string | null {
  const page = pages.find((p) => navHrefs.has(`/${portalSlug}/${p}`));
  if (!page) return null;
  const qs = params && Object.keys(params).length ? `?${new URLSearchParams(params).toString()}` : '';
  return `/${portalSlug}/${page}${qs}`;
}
