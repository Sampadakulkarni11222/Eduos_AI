/**
 * Matching and eligibility for opportunities: pure functions, no database.
 *
 * A reader's context is built by the service (opportunities.service.js) from
 * what the school already knows: a student's class, age, stream, chosen
 * interests, clubs, competency-portfolio strengths and past participation; a
 * teacher's subjects and CPD interests. These functions only read it, so the
 * rules can be tested on their own and read in one place.
 */

export const TYPE_LABELS = {
  COMPETITION: 'Competition', OLYMPIAD: 'Olympiad', SCHOLARSHIP: 'Scholarship', ENTRANCE_EXAM: 'Entrance exam', HACKATHON: 'Hackathon',
  SCIENCE_FAIR: 'Science fair', RESEARCH_PROGRAMME: 'Research programme', INNOVATION_CHALLENGE: 'Innovation challenge', SPORTS_TRIAL: 'Sports trial',
  ARTS_CONTEST: 'Arts or literary contest', MUN_DEBATE: 'MUN or debate', GOVT_SCHEME: 'Government scheme', TEACHER_PROGRAMME: 'For teachers',
};
export const LEVEL_LABELS = { SCHOOL: 'School', DISTRICT: 'District', STATE: 'State', NATIONAL: 'National', INTERNATIONAL: 'International' };
export const DOMAIN_LABELS = {
  SCIENCE: 'Science', MATHS: 'Maths', CODING_AI: 'Coding and AI', ROBOTICS: 'Robotics', ENVIRONMENT: 'Environment', ARTS: 'Arts',
  SPORTS: 'Sports', COMMERCE: 'Commerce', HUMANITIES: 'Humanities', ENTREPRENEURSHIP: 'Entrepreneurship',
};
export const STREAM_LABELS = { SCIENCE: 'Science', COMMERCE: 'Commerce', HUMANITIES: 'Humanities' };

/** Club activities and categories → the domains they point to. */
export const CLUB_DOMAINS = {
  ROBOTICS: ['ROBOTICS', 'CODING_AI'], SCIENCE: ['SCIENCE'], ECO: ['ENVIRONMENT'], DEBATE: ['HUMANITIES'], QUIZ: ['HUMANITIES', 'SCIENCE'],
  CHESS: ['MATHS'], DANCE: ['ARTS'], MUSIC: ['ARTS'], SINGING: ['ARTS'], DRAMA: ['ARTS'], VISUAL_ARTS: ['ARTS'],
  SPORTS: ['SPORTS'], ARTS: ['ARTS'], ACADEMIC: ['SCIENCE', 'MATHS'], SERVICE: ['ENVIRONMENT', 'HUMANITIES'],
};
/** Competency-portfolio keys → domains (a strength is PROFICIENT or ADVANCED). */
export const COMPETENCY_DOMAINS = {
  SCIENTIFIC: ['SCIENCE'], MATHEMATICAL: ['MATHS'], DIGITAL: ['CODING_AI', 'ROBOTICS'], CREATIVITY: ['ARTS', 'ENTREPRENEURSHIP'],
  CRITICAL_THINKING: ['MATHS', 'SCIENCE'], COMMUNICATION: ['HUMANITIES'], LANGUAGE: ['HUMANITIES'], SOCIAL_SCIENCE: ['HUMANITIES', 'COMMERCE'],
  LIFE_SKILLS: ['ENVIRONMENT', 'SPORTS'], COLLABORATION: ['ENTREPRENEURSHIP'],
};
export const COMPETENCY_LABELS = {
  SCIENTIFIC: 'Scientific inquiry', MATHEMATICAL: 'Mathematical reasoning', DIGITAL: 'Digital literacy', CREATIVITY: 'Creativity and innovation',
  CRITICAL_THINKING: 'Critical thinking', COMMUNICATION: 'Communication', LANGUAGE: 'Language', SOCIAL_SCIENCE: 'Social understanding',
  LIFE_SKILLS: 'Life skills', COLLABORATION: 'Collaboration',
};
/** The digest's interest keys → domains, so a reader's digest choices count here too. */
export const DIGEST_INTEREST_DOMAINS = {
  SCIENCE: ['SCIENCE'], TECHNOLOGY: ['CODING_AI', 'ROBOTICS'], SPORTS: ['SPORTS'], CAREERS: ['COMMERCE', 'ENTREPRENEURSHIP'],
  EDUCATION_POLICY: ['HUMANITIES'], ARTS: ['ARTS'], ENVIRONMENT: ['ENVIRONMENT'], MATHEMATICS: ['MATHS'],
};
/** Subject names (as a timetable names them) → domains, for teachers. */
export function subjectDomains(name) {
  const s = String(name ?? '').toLowerCase();
  const out = new Set();
  if (/math/.test(s)) out.add('MATHS');
  if (/science|physics|chemistry|biology|evs/.test(s)) out.add('SCIENCE');
  if (/computer|informatics|coding|\bit\b|artificial|ai\b/.test(s)) { out.add('CODING_AI'); out.add('ROBOTICS'); }
  if (/environment|evs|geography/.test(s)) out.add('ENVIRONMENT');
  if (/art|music|dance|drawing|painting/.test(s)) out.add('ARTS');
  if (/physical|sport|games|\bpe\b/.test(s)) out.add('SPORTS');
  if (/commerce|account|business|economics/.test(s)) out.add('COMMERCE');
  if (/english|hindi|history|civics|political|social|sanskrit|language|literature|sst/.test(s)) out.add('HUMANITIES');
  if (/entrepreneur/.test(s)) out.add('ENTREPRENEURSHIP');
  return [...out];
}

/** The class number in a grade's name ("Class 9" → 9, "Grade 11" → 11, "UKG" → null). */
export function gradeNumber(name) {
  const m = /(\d{1,2})/.exec(String(name ?? ''));
  return m ? Number(m[1]) : null;
}

/** A stream read from a section or grade name ("11 Science A" → SCIENCE). */
export function streamFromName(name) {
  const s = String(name ?? '').toLowerCase();
  if (/science|pcm|pcb|medical|non-medical/.test(s)) return 'SCIENCE';
  if (/commerce/.test(s)) return 'COMMERCE';
  if (/humanities|arts/.test(s)) return 'HUMANITIES';
  return null;
}

export function ageOn(dob, at = new Date()) {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  let age = at.getUTCFullYear() - d.getUTCFullYear();
  const before = at.getUTCMonth() < d.getUTCMonth() || (at.getUTCMonth() === d.getUTCMonth() && at.getUTCDate() < d.getUTCDate());
  if (before) age -= 1;
  return age;
}

const classWord = (n) => (n > 12 ? `year ${n - 12} of college` : `Class ${n}`);

/**
 * "Can I enter?" — YES, NO or CHECK (we do not know enough, or the rules have
 * a condition the school cannot see, such as an income limit), with reasons.
 * `who` is `{ grade, age, stream }`; any of them may be null.
 */
export function checkEligibility(opp, who = {}) {
  const e = opp?.eligibility ?? {};
  const reasons = [];
  let verdict = 'YES';
  const fail = (r) => { verdict = 'NO'; reasons.push(r); };
  const unsure = (r) => { if (verdict !== 'NO') verdict = 'CHECK'; reasons.push(r); };

  if (opp?.audience === 'TEACHERS') {
    return { verdict: who.isTeacher ? 'YES' : 'NO', reasons: [who.isTeacher ? 'This is a programme for teachers.' : 'This programme is for teachers.'] };
  }
  const range = e.gradeMin || e.gradeMax ? `${e.gradeMin ? classWord(e.gradeMin) : 'any class'}${e.gradeMax && e.gradeMax !== e.gradeMin ? ` to ${classWord(e.gradeMax)}` : ''}` : null;
  if (range) {
    if (who.grade === null || who.grade === undefined) unsure(`Open to ${range}; we do not know the class.`);
    else if ((e.gradeMin && who.grade < e.gradeMin) || (e.gradeMax && who.grade > e.gradeMax)) fail(`Open to ${range}; you are in ${classWord(who.grade)}.`);
    else reasons.push(`${classWord(who.grade)} is within ${range}.`);
  }
  if (e.ageMin || e.ageMax) {
    const ages = `${e.ageMin ?? 'any age'}${e.ageMax ? ` to ${e.ageMax}` : '+'}`;
    if (who.age === null || who.age === undefined) unsure(`Ages ${ages}; we do not know the age.`);
    else if ((e.ageMin && who.age < e.ageMin) || (e.ageMax && who.age > e.ageMax)) fail(`Ages ${ages}; the age is ${who.age} (the cut-off date is set by the organiser).`);
    else reasons.push(`Age ${who.age} is within ${ages} (check the organiser's cut-off date).`);
  }
  if (e.streams?.length) {
    const list = e.streams.map((s) => STREAM_LABELS[s]).join(' or ');
    if (!who.stream) unsure(`For the ${list} stream; we do not know the stream.`);
    else if (!e.streams.includes(who.stream)) fail(`For the ${list} stream; the stream is ${STREAM_LABELS[who.stream]}.`);
    else reasons.push(`${STREAM_LABELS[who.stream]} stream qualifies.`);
  }
  if (e.note) unsure(e.note);
  if (!opp?.datesConfirmed) reasons.push('Dates are not confirmed: check them on the official site.');
  else if (opp.registrationCloses && new Date(opp.registrationCloses).getTime() < (who.now ?? Date.now())) fail('Registration has closed.');
  if (!reasons.length) reasons.push('No class, age or stream limits are recorded.');
  return { verdict, reasons };
}

/**
 * How well an opportunity suits one reader, with the reasons in plain words
 * ("Because you are in Class 9 and in the Robotics club"). Ineligible items
 * score 0 so they never appear in "For you".
 *
 * ctx: { kind: 'STUDENT'|'TEACHER', name?, grade, age, stream, domains:Set,
 *        clubs:[{name, domains}], strengths:[{key, domains}], pastTypes:Set,
 *        subjects:[{name, domains}], cpdInterests:[string], gradesTaught:Set }
 */
export function scoreFor(opp, ctx, { now = Date.now() } = {}) {
  const reasons = [];
  let score = 0;
  const domains = new Set(opp.domains ?? []);
  if (ctx.kind === 'TEACHER') {
    if (opp.audience === 'STUDENTS') {
      // For a teacher, a student item counts when it is in their subject and fits a class they teach.
      const subj = (ctx.subjects ?? []).find((s) => s.domains.some((d) => domains.has(d)));
      if (!subj) return { score: 0, reasons: [] };
      const e = opp.eligibility ?? {};
      const fits = [...(ctx.gradesTaught ?? [])].some((g) => (!e.gradeMin || g >= e.gradeMin) && (!e.gradeMax || g <= e.gradeMax));
      if (!fits) return { score: 0, reasons: [] };
      score += 3; reasons.push(`for your ${subj.name} classes`);
      return { score, reasons, forStudents: true };
    }
    score += 4; reasons.push('a programme for teachers');
    const subj = (ctx.subjects ?? []).find((s) => s.domains.some((d) => domains.has(d)) || (opp.teacherSubjects ?? []).some((t) => s.name.toLowerCase().includes(String(t).toLowerCase())));
    if (subj) { score += 2; reasons.push(`you teach ${subj.name}`); }
    const cpd = (ctx.cpdInterests ?? []).find((c) => `${opp.title} ${opp.summary}`.toLowerCase().includes(String(c).toLowerCase()));
    if (cpd) { score += 2; reasons.push(`you are interested in ${cpd}`); }
    return { score, reasons };
  }

  if (opp.audience === 'TEACHERS') return { score: 0, reasons: [] };
  const elig = checkEligibility(opp, { grade: ctx.grade, age: ctx.age, stream: ctx.stream, now });
  if (elig.verdict === 'NO') return { score: 0, reasons: [], eligibility: elig };
  const you = ctx.name ? ctx.name : 'you';
  const are = ctx.name ? 'is' : 'are';
  if (ctx.grade && (opp.eligibility?.gradeMin || opp.eligibility?.gradeMax)) { score += 2; reasons.push(`${you} ${are} in Class ${ctx.grade}`); }
  const club = (ctx.clubs ?? []).find((c) => c.domains.some((d) => domains.has(d)));
  if (club) { score += 3; reasons.push(`in the ${club.name}`); }
  const strength = (ctx.strengths ?? []).find((s) => s.domains.some((d) => domains.has(d)));
  if (strength) { score += 2; reasons.push(`${ctx.name ? 'their' : 'your'} portfolio shows strength in ${COMPETENCY_LABELS[strength.key] ?? strength.key}`); }
  const interest = [...(ctx.domains ?? [])].find((d) => domains.has(d));
  if (interest) { score += 2; reasons.push(`${ctx.name ? 'they chose' : 'you chose'} ${DOMAIN_LABELS[interest]}`); }
  if (ctx.pastTypes?.has(opp.type)) { score += 1; reasons.push(`${ctx.name ? 'they have' : 'you have'} taken part in ${TYPE_LABELS[opp.type].toLowerCase()}s before`); }
  if (ctx.stream && opp.eligibility?.streams?.includes(ctx.stream)) { score += 1; reasons.push(`the ${STREAM_LABELS[ctx.stream]} stream`); }
  // Something closing soon matters more than something months away.
  const closes = opp.datesConfirmed && opp.registrationCloses ? new Date(opp.registrationCloses).getTime() : null;
  if (closes && closes > now && closes - now < 21 * 86_400_000) score += 1;
  // A match needs at least one personal reason beyond the class.
  if (!club && !strength && !interest && !ctx.pastTypes?.has(opp.type)) score = Math.min(score, 1);
  return { score, reasons, eligibility: elig };
}

/** "Because you are in Class 9 and in the Robotics club". */
export function reasonText(reasons) {
  if (!reasons?.length) return null;
  const parts = [...reasons];
  const last = parts.pop();
  return `Because ${parts.length ? `${parts.join(', ')} and ${last}` : last}`;
}

/** Days until a confirmed closing date (null when not confirmed or past). */
export function daysLeft(opp, now = Date.now()) {
  if (!opp?.datesConfirmed || !opp.registrationCloses) return null;
  const ms = new Date(opp.registrationCloses).getTime() - now;
  if (ms < 0) return null;
  return Math.ceil(ms / 86_400_000);
}
