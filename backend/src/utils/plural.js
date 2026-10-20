/**
 * "1 open letter", "2 open letters": counts in sentences and tiles read as
 * English, not as "1 posts" or "item(s)".
 */
export function plural(n, singular, pluralForm = `${singular}s`) {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

/** Singular forms of the tile labels that follow a count. */
const SINGULAR = {
  'open letters': 'open letter',
  'open repairs': 'open repair',
  'events in 2 weeks': 'event in the next 2 weeks',
  'events in the next 2 weeks': 'event in the next 2 weeks',
  'events in the next two weeks': 'event in the next two weeks',
  'overdue invoices': 'overdue invoice',
  'money decisions waiting': 'money decision waiting',
  'enquiries this week': 'enquiry this week',
  'posts to review': 'post to review',
  'approvals in progress': 'approval in progress',
  'verifications under way': 'verification under way',
  'compliance items overdue': 'compliance item overdue',
  'classes right now': 'class right now',
  'bus routes': 'bus route',
  'students on buses': 'student on a bus',
  'titles': 'title',
  'books out': 'book out',
  'overdue returns': 'overdue return',
  'classes with an exam today': 'class with an exam today',
};

/** A [count, label] pair with the label in the right number. */
export function countLabel(n, label) {
  if (n !== 1) return label === 'events in 2 weeks' ? 'events in the next 2 weeks' : label;
  return SINGULAR[label] ?? label;
}
