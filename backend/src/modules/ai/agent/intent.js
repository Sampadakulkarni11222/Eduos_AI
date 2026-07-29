/**
 * Intent parsing: natural language → { tool, args }.
 *
 * This is the *only* part of the agent an LLM will replace (see the provider
 * seam at the bottom). It is deliberately powerless: it proposes a tool and
 * arguments, and the orchestrator then authorizes that proposal against the
 * caller's live permissions before anything runs. So a model that is confused,
 * jailbroken, or simply wrong can cause a refusal or a bad suggestion — never
 * an unauthorized read or write.
 *
 * The rules below are intentionally simple and multilingual-friendly: they
 * match on stems that survive transliteration, because parents in this market
 * routinely type Hinglish ("fees kitna pending hai").
 */

const RULES = [
  {
    tool: 'get_attendance',
    patterns: [
      /\battendance\b/i, /\bpresent\b/i, /\babsent\b/i, /\bhaazri\b/i, /\bhajri\b/i,
      /\bupasthiti\b/i, /\bकितने दिन\b/, /\bउपस्थिति\b/,
    ],
    // "who is absent today" is a different, school-wide question, and
    // "mark ... attendance" is a write — neither should land on this read.
    // Without the third pattern, "mark my attendance present" scored higher
    // as a read than as a write and quietly answered instead of refusing.
    exclude: [
      /\bwho\b.*\babsent\b/i,
      /\babsent\b.*\btoday\b.*\blist\b/i,
      /\b(mark|record|update|set)\b[^?]*\battendance\b/i,
    ],
    args: (msg) => {
      const m = msg.match(/\b(20\d{2})[-/](\d{1,2})\b/);
      return m ? { month: `${m[1]}-${String(m[2]).padStart(2, '0')}` } : {};
    },
  },
  {
    tool: 'who_is_absent_today',
    patterns: [/\bwho\b[^?]*\babsent\b/i, /\babsentee/i, /\battendance\b.*\btoday\b.*\bschool\b/i],
    args: () => ({}),
  },
  {
    tool: 'get_fees',
    patterns: [
      /\bfee(s)?\b/i, /\bdue\b/i, /\binvoice\b/i, /\bpayment\b/i, /\bpending amount\b/i,
      /\bshulk\b/i, /\bफीस\b/, /\bबकाया\b/,
    ],
    exclude: [/\brecord\b.*\bpayment\b/i, /\bmark\b.*\bpaid\b/i, /\bpaid\b.*\btoday\b/i],
    args: () => ({}),
  },
  {
    tool: 'get_results',
    patterns: [
      /\bresult(s)?\b/i, /\bmarks\b/i, /\bgrade(s)?\b/i, /\breport card\b/i, /\bgpa\b/i,
      /\bexam\b.*\bscore\b/i, /\bपरिणाम\b/, /\bअंक\b/,
    ],
    args: (msg) => {
      const m = msg.match(/\b(unit test \d|midterm|final|term \d)\b/i);
      return m ? { exam: m[1] } : {};
    },
  },
  {
    tool: 'apply_leave',
    patterns: [/\bapply\b.*\bleave\b/i, /\bleave\b.*\bapplication\b/i, /\btake leave\b/i, /\bchutti\b/i, /\bछुट्टी\b/],
    args: (msg) => {
      const dates = [...msg.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)].map((m) => m[1]);
      const reason = msg.match(/\b(?:because|reason|for|due to)\s+(.{3,80})/i)?.[1]?.trim();
      return {
        ...(dates[0] && { fromDate: dates[0] }),
        ...(dates[1] ? { toDate: dates[1] } : dates[0] && { toDate: dates[0] }),
        ...(reason && { reason }),
      };
    },
  },
  {
    tool: 'record_fee_payment',
    patterns: [/\brecord\b.*\bpayment\b/i, /\bmark\b.*\bpaid\b/i, /\bhas paid\b/i, /\bpaid (the )?fees?\b/i],
    args: (msg) => {
      const amount = msg.match(/₹?\s?(\d[\d,]*)(?:\s?(?:rs|rupees|₹))?/i)?.[1]?.replace(/,/g, '');
      const invoiceId = msg.match(/\b([a-f0-9]{24})\b/i)?.[1];
      return {
        ...(invoiceId && { invoiceId }),
        ...(amount && { amountPaise: Number(amount) * 100 }),
        mode: 'CASH',
      };
    },
  },
  {
    tool: 'create_announcement',
    patterns: [/\b(post|create|send|make)\b.*\bannouncement\b/i, /\bnotice\b.*\b(post|send)\b/i],
    args: (msg) => {
      const quoted = msg.match(/["“](.+?)["”]/)?.[1];
      const after = msg.match(/announcement\s+(?:that\s+|saying\s+|:\s*)?(.{3,140})/i)?.[1];
      const title = (quoted ?? after ?? '').trim();
      return title ? { title, content: title } : {};
    },
  },
  {
    tool: 'mark_attendance',
    patterns: [/\bmark\b.*\battendance\b/i, /\battendance\b.*\bregister\b/i, /\ball present\b/i],
    args: () => ({}), // section/entries come from the UI or an OCR step, never guessed
  },
];

/** Rule-based parse. Returns { tool, args } or null. */
export function parseIntent(message, _actor) {
  const msg = String(message ?? '');
  if (!msg.trim()) return null;

  let best = null;
  let bestScore = 0;

  for (const rule of RULES) {
    if (rule.exclude?.some((re) => re.test(msg))) continue;
    const score = rule.patterns.reduce((n, re) => n + (re.test(msg) ? 1 : 0), 0);
    if (score > bestScore) {
      best = rule;
      bestScore = score;
    }
  }

  if (!best) return null;
  return { tool: best.tool, args: best.args ? best.args(msg) : {} };
}

/**
 * Provider seam for a real LLM.
 *
 * When AI_PROVIDER names a model, this is where the call goes — passing the
 * message plus `toolsAvailableTo(actor)` as the tool schema, and taking back a
 * proposed tool call. What must NOT change: the returned proposal still goes
 * through checkAuthorization() and, for writes, still requires an explicit
 * human confirmation. The model picks; it never permits.
 */
export async function parseIntentWithLlm(message, actor, { callModel } = {}) {
  if (!callModel) return parseIntent(message, actor);
  try {
    const proposal = await callModel(message, actor);
    if (proposal?.tool) return { tool: proposal.tool, args: proposal.args ?? {} };
  } catch {
    // A model failure degrades to the deterministic parser rather than
    // taking the assistant offline.
  }
  return parseIntent(message, actor);
}
