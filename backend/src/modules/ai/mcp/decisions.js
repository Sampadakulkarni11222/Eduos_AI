/**
 * Decisions the assistant never takes.
 *
 * Product rule: the AI may tell a person what is waiting on them and where to
 * act on it, and it may never approve, reject, publish, refund, record money
 * or otherwise DECIDE. Those acts stay on their own screens, where a named
 * person presses the button with the whole record in front of them.
 *
 * Two things live here so the rule is stated once:
 *
 *   HUMAN_DECISIONS      what each kind of decision is, which permissions make
 *                        a person the one who takes it, and the screen (as a
 *                        portal-relative path, the shape notification links
 *                        use) where they do.
 *   isDecidingToolName   the naming rule the registry refuses at boot and the
 *                        registry test pins: no tool called approve_*, reject_*,
 *                        decide_*, review_*, publish_*, refund_* or
 *                        record_payment may be executable.
 *
 * humanDecisionIn() reads a request for one of these acts, so the assistant can
 * say "that is yours to decide on the X screen" instead of the nearest thing
 * it CAN do -- or a shrug.
 */

/** Tool-name prefixes (and whole names) that mean deciding. */
const DECIDING_PREFIXES = ['approve_', 'reject_', 'decide_', 'review_', 'publish_', 'refund_'];
const DECIDING_NAMES = new Set(['record_payment']);

/** The verbs those names begin with, which remain ACTS in the language even with no tool behind them. */
export const DECIDING_VERBS = Object.freeze(['approve', 'reject', 'decide', 'review', 'publish', 'refund', 'record']);

export function isDecidingToolName(name) {
  const n = String(name ?? '');
  return DECIDING_NAMES.has(n) || DECIDING_PREFIXES.some((p) => n.startsWith(p));
}

/**
 * Each kind of decision. `links` is per role portal, because the same queue is
 * a different page in each (Finance's payments are /finance/payments, the
 * principal's are /principal/fees); a role with no page for it gets no link and
 * the screen is named instead.
 */
export const HUMAN_DECISIONS = {
  payment: {
    cannot: 'approve, record or refund payments',
    act: 'Approving, rejecting, recording or refunding a payment',
    screen: 'Payments',
    permissions: ['fees.payments.approve', 'fees.payments.refund', 'fees.manage'],
    links: { ADMIN: '/payments', FINANCE: '/payments', PRINCIPAL: '/fees' },
  },
  feePlan: {
    cannot: 'approve, reject or publish fee plans',
    act: 'Reviewing, approving, rejecting or publishing a fee plan',
    screen: 'Payments (fee plans)',
    permissions: ['fees.plan.review', 'fees.plan.approve'],
    links: { ADMIN: '/payments', FINANCE: '/payments', PRINCIPAL: '/fees' },
  },
  marks: {
    cannot: 'publish marks',
    act: 'Publishing marks',
    screen: 'Exams',
    permissions: ['marks.publish'],
    links: { TEACHER: '/exams' },
  },
  leave: {
    cannot: 'approve or reject leave applications',
    act: 'Approving or rejecting a leave application',
    screen: 'Leave',
    permissions: ['leave.review'],
    links: { TEACHER: '/leave' },
  },
  registration: {
    cannot: 'approve or reject elective registrations',
    act: 'Approving or rejecting an elective registration',
    screen: 'Registrations',
    permissions: ['registrations.review'],
    links: { TEACHER: '/registrations', ADMIN: '/registrations' },
  },
  studentRequest: {
    cannot: 'approve or reject student requests',
    act: 'Approving or rejecting a co-curricular or profile-correction request',
    screen: 'Student requests',
    permissions: ['cocurricular.review', 'profile.edit.review'],
    links: { TEACHER: '/student-requests' },
  },
  bookRequest: {
    cannot: 'approve or reject book requests',
    act: 'Approving or rejecting a book request',
    screen: 'Library requests',
    permissions: ['library.manage'],
    links: { LIBRARIAN: '/requests', ADMIN: '/library' },
  },
  transportRequest: {
    cannot: 'approve or reject transport requests',
    act: 'Approving or rejecting a transport request',
    screen: 'Transport requests',
    permissions: ['transport.manage'],
    links: { ADMIN: '/transport-requests' },
  },
  admission: {
    cannot: 'admit or turn down applicants',
    act: 'Admitting or turning down an applicant',
    screen: 'Admissions',
    permissions: ['admissions.manage'],
    links: { ADMIN: '/admissions', MARKETING: '/admissions' },
  },
  approval: {
    cannot: 'approve or reject requests',
    act: 'Approving or rejecting a request in the approvals inbox',
    screen: 'Approvals',
    permissions: ['approvals.decide'],
    links: { '*': '/approvals' },
  },
};

/** Whether this person is one who takes this kind of decision. */
export function takesDecision(actor, kind) {
  const d = HUMAN_DECISIONS[kind];
  return Boolean(d) && d.permissions.some((p) => actor?.permissions?.[p]);
}

/** The portal-relative page where this person decides, or null when their portal has none. */
export function decisionLink(actor, kind) {
  const links = HUMAN_DECISIONS[kind]?.links ?? {};
  return links[actor?.roleKey] ?? links['*'] ?? null;
}

/* ── Reading a request for a decision ──────────────────────
   Grammar, not a classifier: an imperative deciding verb at the start of the
   request (after "please", "can you", "go ahead and" ...), and the thing it is
   done to. A question ("which payments are pending approval?") is never a
   decision, and neither is an act the assistant does perform ("publish an
   announcement", "record attendance"). */

const LEAD = String.raw`^\s*(?:(?:please|pls|kindly|now|ok(?:ay)?|yes|hey|so|just|also)\s*,?\s+)*(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?|i\s+(?:want|need|would\s+like)\s+(?:you\s+)?to\s+|go\s+ahead\s+and\s+|help\s+me\s+)?`;
const DECIDE = String.raw`(?:approve|reject|decline|deny|refuse|accept|grant|sanction|decide(?:\s+on)?)`;

/** [kind, verb pattern, object pattern] — first match wins, most specific first. */
const DECISION_PATTERNS = [
  ['feePlan', String.raw`(?:${DECIDE}|publish|release)`, String.raw`\b(?:fee|installment|instalment|payment)\s+plans?\b`],
  ['payment', String.raw`(?:${DECIDE}|refund|record|log|enter|reverse)`, String.raw`\b(?:payments?|receipts?|refunds?|(?:payment\s+)?change\s+requests?)\b`],
  ['payment', String.raw`(?:mark)`, String.raw`\binvoices?\b[^.?!]*\bpaid\b`],
  ['marks', String.raw`(?:publish|release|declare)`, String.raw`\b(?:marks?|results?|report\s*cards?|grades?|scores?)\b`],
  ['leave', DECIDE, String.raw`\bleaves?\b|\bday\s*off\b`],
  ['registration', DECIDE, String.raw`\b(?:electives?|registrations?)\b`],
  ['studentRequest', DECIDE, String.raw`\b(?:co.?curricular|achievements?|activit(?:y|ies)|profile[\s-]*(?:edit|correction|change)s?)\b`],
  ['bookRequest', DECIDE, String.raw`\bbook\s+requests?\b|\brequests?\s+for\s+(?:a\s+|the\s+)?book\b`],
  ['transportRequest', DECIDE, String.raw`\b(?:transport|bus|route)\s+requests?\b`],
  ['admission', String.raw`(?:${DECIDE}|admit|enrol|enroll)`, String.raw`\b(?:admissions?|applicants?|applications?\s+for\s+admission|enquir(?:y|ies)|admission\s+leads?)\b`],
  ['admission', String.raw`(?:admit)`, String.raw`.`],
  ['approval', DECIDE, String.raw`\b(?:approvals?|requests?|purchase\s+(?:requests?|orders?)|procurement|budgets?)\b`],
];

const COMPILED = DECISION_PATTERNS.map(([kind, verb, object]) => ({
  kind,
  verb: new RegExp(`${LEAD}${verb}\\b`, 'i'),
  object: new RegExp(object, 'i'),
}));

/**
 * The decision a message asks the assistant to take, or null.
 *
 * Only an imperative counts: the verb must open the request. Quoted text is
 * the person's own content and is ignored.
 */
export function decisionAskedFor(message) {
  const str = String(message ?? '').replace(/["“”]([^"“”]{2,500})["“”]/g, ' ').trim();
  if (!str) return null;
  for (const { kind, verb, object } of COMPILED) {
    const m = verb.exec(str);
    if (!m) continue;
    if (object.test(str.slice(m[0].length))) return kind;
  }
  return null;
}

/**
 * What to say to a request for a decision: whose it is and where it is made.
 * `channel` WHATSAPP points at the website, since no screen opens in a chat.
 */
export function humanDecisionReply(actor, kind, { channel = 'WEB' } = {}) {
  const d = HUMAN_DECISIONS[kind];
  if (!d) return null;
  if (!takesDecision(actor, kind)) {
    return {
      reply: `You can't ${d.cannot} with your account, and I don't take decisions for anyone. `
        + 'The person responsible decides it on their own screen.',
      refused: 'NOT_PERMITTED',
      link: null,
    };
  }
  const link = decisionLink(actor, kind);
  const where = channel === 'WHATSAPP'
    ? `on the EduOS website, on the ${d.screen} screen`
    : `on the ${d.screen} screen${link ? ` (${link})` : ''}`;
  return {
    reply: `${d.act} is a decision you make yourself ${where} — I don't approve, reject, publish, record or refund anything. `
      + 'Ask me "what is pending for me?" to see what is waiting on you.',
    refused: 'HUMAN_DECISION',
    link,
  };
}

/* ── Decisions an approver may record through the assistant ──
   The batch-3 product rule refines the one above: the assistant still never
   decides on its own initiative, but it may RECORD a decision that the person
   holding the approval authority states in their own words and then confirms,
   on the website (tools/platformOps.js, `approverDecision: true`; the registry
   refuses one that is not confirmed, HIGH risk and web-only). These are the
   requests that are therefore not handed back to the screen. Each needs the
   approver's permission AND words that name that kind of record, so "approve
   Rahul's leave" (a student's leave) is still handed back as before. */
export const APPROVER_CONFIRMED = [
  // A colleague's staff leave, decided by HR or the principal.
  { kind: 'leave', tool: 'record_staff_leave_decision', permission: 'staffleave.manage', scope: 'ALL',
    words: /\b(?:staff|teacher|colleague|casual|earned|duty|maternity|paternity)\b|\b(?:mr|mrs|ms|miss|dr|sir|madam)\.?\s+[a-z]/i },
  // A fee concession, credit note or void at the approver's stage.
  { kind: 'approval', tool: 'record_concession_decision', permission: 'approvals.decide',
    words: /\bconcessions?\b|\bcredit\s+notes?\b|\bvoid\b|\bfee\s+adjustments?\b/i },
  // A hostel out-pass, decided by the warden (or consented to by a guardian).
  { kind: 'approval', tool: 'record_outpass_decision', permission: 'hostel.outpass.manage', words: /\bout[\s-]?pass(?:es)?\b/i },
  { kind: 'approval', tool: 'record_outpass_consent', permission: 'hostel.outpass.request', words: /\bout[\s-]?pass(?:es)?\b/i },
  // Recording a payment made against a recurring BILL is a ledger entry a
  // second person confirms, not the fee-payment decision on the Payments screen.
  { kind: 'payment', tool: 'record_bill_payment', permission: 'bills.manage', scope: 'ALL',
    words: /\bbills?\b|\belectricity\b|\bwater\s+bill\b|\binternet\b|\bamc\b|\butility\b|\bvendor\b/i, unless: /\binvoices?\b|\bfees?\b|\breceipts?\b|\bINV-/i },
];

/** Whether this request is one the actor may have recorded through an approver-confirmed tool. */
export function approverMayRecord(actor, kind, message) {
  const str = String(message ?? '');
  return APPROVER_CONFIRMED.some((d) => d.kind === kind
    && actor?.permissions?.[d.permission] && (!d.scope || actor.permissions[d.permission] === d.scope)
    && d.words.test(str) && !(d.unless && d.unless.test(str)));
}
