import { NewsletterFeedSource, NewsletterFeedItem } from '../models/newsletterAi.model.js';
import * as alerts from '../modules/newsletter/alerts.service.js';

/**
 * Sample data for the newsletter's alert feeds (part 5):
 *   - one Google Alert source with a clearly made-up feed address (all zeros,
 *     marked `sample`), which is never fetched: not here, not by the hourly job;
 *   - five fictional items "found" by it (titles end "(sample)", links point at
 *     made-up pages), run through the real extraction without reading any page
 *     and without the model, so the review queue shows auto-extracted
 *     candidates with the text each detail came from, one duplicate of a
 *     starter-list programme and one news item skipped.
 * Nothing is published: the candidates wait for the editor.
 */
const DAY = 86_400_000;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const spoken = (d) => { const x = new Date(d.getTime() + 330 * 60_000); return `${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]} ${x.getUTCFullYear()}`; };

export const SAMPLE_ALERT_FEED = 'https://www.google.com/alerts/feeds/00000000000000000000/00000000000000000000';

export async function seedP5NewsletterAi({ section, attempt, who }) {
  const ED = who.PRINCIPAL;
  if (!ED) return;
  await section('Newsletter alert feeds and extracted candidates (sample)', NewsletterFeedSource, async () => {
    const now = new Date();
    const src = await NewsletterFeedSource.create({
      kind: 'GOOGLE_ALERT', url: SAMPLE_ALERT_FEED, sample: true,
      title: 'Olympiads, quizzes and hackathons for school students (sample)', query: 'olympiad OR quiz OR hackathon "school students" registration',
      tags: { domains: ['SCIENCE', 'MATHS', 'CODING_AI'], level: 'NATIONAL', region: null, types: [] },
      addedByProfileId: ED.actor.profileId, addedByName: ED.actor.displayName ?? null,
      lastStatus: 'NEVER', lastError: 'Sample feed with a made-up address: it is never fetched.', itemsFound: 5,
    });
    const items = [
      {
        title: 'Registrations open for the National Junior Science Quiz 2026 (sample)', link: 'https://www.samplescience.gov.in/junior-quiz-2026',
        snippet: `The National Junior Science Quiz is open to Classes 6 to 10 across India. Last date to register is ${spoken(new Date(now.getTime() + 24 * DAY))}. Registration fee ₹100. The quiz will be held online.`,
      },
      {
        title: 'State level maths quiz announced for Maharashtra schools (sample)', link: 'https://www.samplemathsfoundation.example.org/state-quiz',
        snippet: `Students of Classes 8 to 12 in Maharashtra can take part in the state level maths quiz. No registration fee. Apply by ${spoken(new Date(now.getTime() + 12 * DAY))}. The quiz is offline at district centres.`,
      },
      {
        title: 'Young innovators hackathon invites school teams (sample)', link: 'https://www.sampleinnovation.gov.in/young-innovators',
        snippet: `School teams of Classes 9 to 12 can build solutions for their city. The hackathon will be held on ${spoken(new Date(now.getTime() + 40 * DAY))} in hybrid mode. Organised by the Sample Innovation Cell.`,
      },
      {
        title: 'CBSE Science Exhibition 2026: schools invited to register (sample)', link: 'https://www.samplenews.example.com/cbse-exhibition-2026',
        snippet: 'Schools can register their teams for the CBSE Science Exhibition this year.',
      },
      {
        title: 'A school celebrates its annual day with a cultural evening (sample)', link: 'https://www.samplenews.example.com/annual-day',
        snippet: 'Parents and teachers joined the students for songs and a play.',
      },
    ];
    for (const [i, it] of items.entries()) {
      // eslint-disable-next-line no-await-in-loop
      await attempt(`alert item ${i + 1}`, () => NewsletterFeedItem.create({ ...it, sourceId: src._id, sourceTitle: src.title, sourceKind: 'GOOGLE_ALERT', rawLink: `https://www.google.com/url?rct=j&sa=t&url=${encodeURIComponent(it.link)}&ct=ga`, publishedAt: new Date(now.getTime() - (i + 1) * 3_600_000), fetchedAt: new Date(now.getTime() - (5 - i) * 60_000), status: 'NEW' }));
    }
    // The real extraction, deterministic (no model) and reading no page.
    const before = process.env.NEWSLETTER_AI;
    process.env.NEWSLETTER_AI = 'off';
    let out = null;
    try {
      out = await attempt('extract sample items', () => alerts.extractPending({ now, pages: 0, pageNote: 'Sample data: pages are not read when seeding' }));
    } finally {
      if (before === undefined) delete process.env.NEWSLETTER_AI; else process.env.NEWSLETTER_AI = before;
    }
    return out ? `1 sample Google Alert feed (never fetched); ${out.CANDIDATE} candidate(s) in the review queue, ${out.DUPLICATE} duplicate, ${out.SKIPPED} skipped` : '1 sample Google Alert feed';
  });
}
