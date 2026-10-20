/**
 * The curated starting list of real, recurring programmes (Indian and
 * international), written from public knowledge.
 *
 * Every entry is a STARTING POINT for the school's editor, not a schedule:
 *   - no dates are given; `typicalWindow` says when the cycle USUALLY runs and
 *     every entry is saved with datesConfirmed: false, so readers see "check
 *     dates on the official site" until someone checks and confirms them;
 *   - the official link is the organiser's own site (https);
 *   - entries are added to the review queue (SUBMITTED), never straight to
 *     readers; the editor publishes them, edits them or rejects them;
 *   - rules change (a programme pauses, an age band moves): the official site
 *     is always the authority, and the item says so.
 *
 * Facts are short, well-established statements used for flashcards.
 */
export const CHECK_NOTE = 'Check dates and rules on the official site.';

/** Official link domains accepted on save. A host matches a domain or any sub-domain of it. */
export const DEFAULT_ALLOWED_DOMAINS = [
  'gov.in', 'nic.in', 'ac.in', 'res.in', 'edu', 'mygov.in',
  'irisnationalfair.org', 'societyforscience.org', 'breakthroughjuniorchallenge.org', 'theearthprize.org',
  'spaceappschallenge.org', 'wro-association.org', 'firstinspires.org', 'iarcs.org.in', 'bebras.org',
  'royalcwsociety.org', 'ecolymp.org', 'vvm.org.in', 'imo-official.org', 'ioinformatics.org',
];

const e = (gradeMin, gradeMax, extra = {}) => ({ gradeMin, gradeMax, ageMin: null, ageMax: null, streams: [], note: null, ...extra });

export const CATALOGUE = [
  {
    key: 'hbcse-maths-olympiad', title: 'Mathematical Olympiad (IOQM, RMO, INMO)', type: 'OLYMPIAD', level: 'NATIONAL', domains: ['MATHS'],
    summary: 'The Indian pathway to the International Mathematical Olympiad: a first qualifier (IOQM), then the regional and national olympiads, then training camps.',
    eligibility: e(8, 12), typicalWindow: 'Registration usually opens mid-year; the first stage is usually around September.', typicalMonths: [7, 8, 9],
    fee: 'A small registration fee (see the official site)', mode: 'OFFLINE', officialUrl: 'https://olympiads.hbcse.tifr.res.in/',
    organiser: 'HBCSE (TIFR) with the Mathematics Teachers\' Association (India)',
    howToApply: ['Read this year\'s brochure on the official site.', 'Register (often through the school or a nearby centre) before the closing date.', 'Practise with past papers, which the site publishes.'],
    pastWinnerNotes: 'Students who do well at the national olympiad are invited to training camps from which India\'s IMO team is chosen.',
    facts: [{ front: 'Where and when was the first International Mathematical Olympiad?', back: 'Romania, in 1959.' }],
  },
  {
    key: 'hbcse-science-olympiads', title: 'Science Olympiads (NSEP, NSEC, NSEB, NSEA, NSEJS)', type: 'OLYMPIAD', level: 'NATIONAL', domains: ['SCIENCE'],
    summary: 'National Standard Examinations in physics, chemistry, biology, astronomy and junior science: the first stage of the olympiad programme that leads to the international science olympiads.',
    eligibility: e(9, 12), typicalWindow: 'Registration is usually in August and September; the exams are usually in November.', typicalMonths: [8, 9, 11],
    fee: 'A small fee per paper (see the official site)', mode: 'OFFLINE', officialUrl: 'https://olympiads.hbcse.tifr.res.in/',
    organiser: 'Indian Association of Physics Teachers (IAPT) with HBCSE',
    howToApply: ['Check which papers fit your class (the junior paper is for younger students).', 'Register through an enrolment centre before it closes.', 'Use the past papers on the official site.'],
    pastWinnerNotes: 'Top scorers move to the Indian National Olympiads and orientation camps at HBCSE, Mumbai.',
    facts: [{ front: 'What does HBCSE stand for?', back: 'Homi Bhabha Centre for Science Education, part of TIFR, Mumbai.' }],
  },
  {
    key: 'inspire-manak', title: 'INSPIRE-MANAK awards', type: 'INNOVATION_CHALLENGE', level: 'NATIONAL', domains: ['SCIENCE', 'ENVIRONMENT', 'ENTREPRENEURSHIP'],
    summary: 'Students send an original idea or innovation that solves an everyday problem; selected ideas get support to build a model and go to district, state and national exhibitions.',
    eligibility: e(6, 10, { ageMin: 10, ageMax: 15 }), typicalWindow: 'Schools usually nominate ideas between June and October.', typicalMonths: [6, 7, 8, 9, 10],
    fee: 'Free', mode: 'ONLINE', officialUrl: 'https://www.inspireawards-dst.gov.in/',
    organiser: 'Department of Science and Technology, with the National Innovation Foundation',
    howToApply: ['Write your idea in a few lines: the problem, who has it and your solution.', 'Give it to your teacher; the school nominates its best ideas on the portal (limits per school apply).'],
    pastWinnerNotes: 'Shortlisted students receive a grant to build a prototype and display it.',
    facts: [{ front: 'What does MANAK stand for in INSPIRE-MANAK?', back: 'Million Minds Augmenting National Aspirations and Knowledge.' }],
  },
  {
    key: 'atl-marathon', title: 'ATL Marathon (Atal Tinkering Labs)', type: 'INNOVATION_CHALLENGE', level: 'NATIONAL', domains: ['ROBOTICS', 'CODING_AI', 'ENTREPRENEURSHIP'],
    summary: 'A national innovation challenge for school teams: pick a community problem, build a working prototype and present it.',
    eligibility: e(6, 12), typicalWindow: 'Usually announced in the second half of the year.', typicalMonths: [8, 9, 10, 11],
    fee: 'Free', mode: 'ONLINE', officialUrl: 'https://aim.gov.in/', organiser: 'Atal Innovation Mission, NITI Aayog',
    howToApply: ['Form a small team with a teacher mentor.', 'Choose a problem from this year\'s themes.', 'Submit your prototype video and write-up on the portal.'],
    pastWinnerNotes: 'Top teams have been offered internships and mentoring by industry partners.',
    facts: [{ front: 'What is an Atal Tinkering Lab?', back: 'A school workspace with tools such as 3D printers, electronics and robotics kits for students to build their ideas.' }],
  },
  {
    key: 'iris-national-fair', title: 'IRIS National Fair', type: 'SCIENCE_FAIR', level: 'NATIONAL', domains: ['SCIENCE', 'MATHS', 'ENVIRONMENT'],
    summary: 'A national science and engineering fair for school students\' research projects; top projects may represent India at the Regeneron International Science and Engineering Fair.',
    eligibility: e(5, 12), typicalWindow: 'Project submissions usually open in the second half of the year.', typicalMonths: [8, 9, 10],
    fee: 'See the official site', mode: 'HYBRID', officialUrl: 'https://www.irisnationalfair.org/', organiser: 'Initiative for Research and Innovation in Science (IRIS)',
    howToApply: ['Start a research question with a teacher or mentor.', 'Keep a project logbook from day one.', 'Submit the abstract and project on the IRIS site.'],
    pastWinnerNotes: 'Indian students selected through IRIS have won awards at ISEF.',
    facts: [{ front: 'What makes a good science-fair question?', back: 'One you can test: it changes one thing (the variable) and measures what happens.' }],
  },
  {
    key: 'regeneron-isef', title: 'Regeneron International Science and Engineering Fair (ISEF)', type: 'SCIENCE_FAIR', level: 'INTERNATIONAL', domains: ['SCIENCE', 'MATHS', 'CODING_AI'],
    summary: 'The largest international pre-college science fair. Students reach it through an affiliated fair (in India, for example, IRIS).',
    eligibility: e(9, 12), typicalWindow: 'Held every year in May in the USA; the route is through an affiliated fair months earlier.', typicalMonths: [5],
    fee: 'Through the affiliated fair', mode: 'OFFLINE', officialUrl: 'https://www.societyforscience.org/isef/', organiser: 'Society for Science',
    howToApply: ['Enter an affiliated fair (such as IRIS) with your research project.', 'Fair winners are nominated to ISEF.'],
    pastWinnerNotes: null,
    facts: [{ front: 'Who runs ISEF?', back: 'Society for Science, a non-profit based in Washington, DC.' }],
  },
  {
    key: 'breakthrough-junior', title: 'Breakthrough Junior Challenge', type: 'COMPETITION', level: 'INTERNATIONAL', domains: ['SCIENCE', 'MATHS'],
    summary: 'Make a short video that explains a big idea in physics, the life sciences or mathematics in a creative way.',
    eligibility: e(null, null, { ageMin: 13, ageMax: 18 }), typicalWindow: 'Usually opens in spring and closes mid-year.', typicalMonths: [4, 5, 6],
    fee: 'Free', mode: 'ONLINE', officialUrl: 'https://breakthroughjuniorchallenge.org/', organiser: 'Breakthrough Prize Foundation',
    howToApply: ['Pick one concept and explain it simply (the video length limit is on the official site).', 'Upload your video before the deadline.'],
    pastWinnerNotes: 'Winners receive a scholarship, and their teacher and school receive awards too.',
    facts: [{ front: 'In the Breakthrough Junior Challenge, who else wins when a student wins?', back: 'Their teacher and their school (a science lab) also receive prizes.' }],
  },
  {
    key: 'earth-prize', title: 'The Earth Prize', type: 'INNOVATION_CHALLENGE', level: 'INTERNATIONAL', domains: ['ENVIRONMENT', 'ENTREPRENEURSHIP'],
    summary: 'An environmental sustainability competition for teenagers: teams propose a solution to an environmental problem.',
    eligibility: e(null, null, { ageMin: 13, ageMax: 19 }), typicalWindow: 'Registration usually runs in the second half of the year.', typicalMonths: [9, 10, 11, 12],
    fee: 'Free', mode: 'ONLINE', officialUrl: 'https://theearthprize.org/', organiser: 'The Earth Foundation',
    howToApply: ['Register a team with a mentor.', 'Develop your solution and submit it by the deadline.'],
    pastWinnerNotes: null,
    facts: [{ front: 'What share of the Earth\'s water is fresh water?', back: 'About 3 per cent, and most of that is frozen in ice and glaciers.' }],
  },
  {
    key: 'nasa-space-apps', title: 'NASA International Space Apps Challenge', type: 'HACKATHON', level: 'INTERNATIONAL', domains: ['CODING_AI', 'SCIENCE'],
    summary: 'A global hackathon, usually over a weekend in early October, where teams solve challenges using open data from NASA and partner space agencies.',
    eligibility: e(null, null, { note: 'Participants under 18 need a parent or guardian\'s permission and may need an adult at local events.' }),
    typicalWindow: 'Usually in early October; registration opens a few weeks before.', typicalMonths: [9, 10],
    fee: 'Free', mode: 'HYBRID', officialUrl: 'https://www.spaceappschallenge.org/', organiser: 'NASA, with partner space agencies',
    howToApply: ['Register on the site and join or form a team.', 'Pick a challenge and build over the event weekend.'],
    pastWinnerNotes: null,
    facts: [{ front: 'How long does sunlight take to reach the Earth?', back: 'About 8 minutes and 20 seconds.' }],
  },
  {
    key: 'wro', title: 'World Robot Olympiad (WRO)', type: 'COMPETITION', level: 'INTERNATIONAL', domains: ['ROBOTICS', 'CODING_AI'],
    summary: 'A robotics competition in age categories: national rounds lead to the international final.',
    eligibility: e(null, null, { ageMin: 8, ageMax: 19 }), typicalWindow: 'National rounds usually run in the second half of the year.', typicalMonths: [7, 8, 9, 10],
    fee: 'Team fee (see the national organiser)', mode: 'OFFLINE', officialUrl: 'https://wro-association.org/', organiser: 'World Robot Olympiad Association',
    howToApply: ['Read this season\'s rules and theme.', 'Form a team of two or three with a coach.', 'Register for your country\'s national round.'],
    pastWinnerNotes: null,
    facts: [{ front: 'What does a robot\'s sensor do?', back: 'It measures something in the world (light, distance, touch) so the program can decide what to do.' }],
  },
  {
    key: 'first-lego-league', title: 'FIRST LEGO League Challenge', type: 'COMPETITION', level: 'INTERNATIONAL', domains: ['ROBOTICS', 'SCIENCE'],
    summary: 'Teams build and program a LEGO robot for a themed game and present an innovation project; a new theme each season.',
    eligibility: e(null, null, { ageMin: 9, ageMax: 16 }), typicalWindow: 'A new season usually starts in August.', typicalMonths: [8, 9],
    fee: 'Team registration and kit (see the official site)', mode: 'OFFLINE', officialUrl: 'https://www.firstinspires.org/', organiser: 'FIRST',
    howToApply: ['Register a team with an adult coach.', 'Get the season kit and start on the robot game and the project.'],
    pastWinnerNotes: null,
    facts: [{ front: 'What are FIRST LEGO League\'s "core values" about?', back: 'Teamwork, discovery, inclusion and having fun, judged alongside the robot.' }],
  },
  {
    key: 'iarcs-computing-olympiad', title: 'Indian Computing Olympiad', type: 'OLYMPIAD', level: 'NATIONAL', domains: ['CODING_AI', 'MATHS'],
    summary: 'The selection process for India\'s team at the International Olympiad in Informatics: algorithmic programming problems in stages.',
    eligibility: e(8, 12), typicalWindow: 'The selection stages usually run around the turn of the year.', typicalMonths: [11, 12, 1],
    fee: 'See the official site', mode: 'ONLINE', officialUrl: 'https://www.iarcs.org.in/inoi/', organiser: 'Indian Association for Research in Computing Science (IARCS)',
    howToApply: ['Check this year\'s stages and dates on the IARCS site.', 'Practise on the past problems it publishes.'],
    pastWinnerNotes: 'Top students attend a training camp from which the IOI team is chosen.',
    facts: [{ front: 'Since when has the International Olympiad in Informatics been held?', back: 'Since 1989; the first was in Bulgaria.' }],
  },
  {
    key: 'bebras', title: 'Bebras Computational Thinking Challenge', type: 'COMPETITION', level: 'INTERNATIONAL', domains: ['CODING_AI', 'MATHS'],
    summary: 'A short, fun challenge of puzzles about computational thinking. No programming needed; schools register their students.',
    eligibility: e(3, 12), typicalWindow: 'Usually around November (Bebras week).', typicalMonths: [11],
    fee: 'See the national organiser', mode: 'ONLINE', officialUrl: 'https://www.bebras.org/', organiser: 'Bebras community, through each country\'s organiser',
    howToApply: ['Ask your teacher whether the school is registered with the national organiser.', 'Take the challenge in school during the challenge window.'],
    pastWinnerNotes: null,
    facts: [{ front: 'What does "bebras" mean?', back: 'Beaver, in Lithuanian; the challenge began in Lithuania.' }],
  },
  {
    key: 'nmms', title: 'National Means-cum-Merit Scholarship (NMMS)', type: 'SCHOLARSHIP', level: 'NATIONAL', domains: ['MATHS', 'SCIENCE', 'HUMANITIES'],
    summary: 'A scholarship for Class 8 students that continues through Class 12, chosen by a state-level test.',
    eligibility: e(8, 8, { note: 'Only for students of government, local-body and government-aided schools, with a family income limit.' }),
    typicalWindow: 'States usually announce the test in the second half of the year.', typicalMonths: [8, 9, 10, 11],
    fee: 'Free', mode: 'OFFLINE', officialUrl: 'https://scholarships.gov.in/', organiser: 'Ministry of Education, with the state education departments',
    howToApply: ['Check your state\'s notification.', 'Apply through the school for the state test.', 'Selected students apply on the National Scholarship Portal.'],
    pastWinnerNotes: null, facts: [],
  },
  {
    key: 'inspire-she', title: 'INSPIRE Scholarship for Higher Education (SHE)', type: 'SCHOLARSHIP', level: 'NATIONAL', domains: ['SCIENCE', 'MATHS'],
    summary: 'A scholarship for high-scoring students who study the natural and basic sciences at college.',
    eligibility: e(12, 16, { streams: ['SCIENCE'], note: 'For students in the top band of their Class 12 board (or with ranks in listed exams) studying basic or natural sciences.' }),
    typicalWindow: 'Applications usually open after the Class 12 results.', typicalMonths: [8, 9, 10],
    fee: 'Free', mode: 'ONLINE', officialUrl: 'https://online-inspire.gov.in/', organiser: 'Department of Science and Technology',
    howToApply: ['Check the eligibility rules for your board\'s results.', 'Apply online with the documents the portal asks for.'],
    pastWinnerNotes: null, facts: [],
  },
  {
    key: 'jee-main', title: 'JEE Main', type: 'ENTRANCE_EXAM', level: 'NATIONAL', domains: ['SCIENCE', 'MATHS'],
    summary: 'The national entrance exam for engineering programmes, and the first step to JEE Advanced.',
    eligibility: e(12, 12, { streams: ['SCIENCE'] }), typicalWindow: 'Usually two sessions, in January and April; registration usually opens in October or November.', typicalMonths: [10, 11, 1, 4],
    fee: 'An exam fee (see the official site)', mode: 'OFFLINE', officialUrl: 'https://jeemain.nta.nic.in/', organiser: 'National Testing Agency',
    howToApply: ['Read the information bulletin.', 'Register on the official site and upload the documents.', 'Download the admit card when it is released.'],
    pastWinnerNotes: null, facts: [],
  },
  {
    key: 'neet-ug', title: 'NEET (UG)', type: 'ENTRANCE_EXAM', level: 'NATIONAL', domains: ['SCIENCE'],
    summary: 'The national entrance exam for undergraduate medical courses.',
    eligibility: e(12, 12, { streams: ['SCIENCE'] }), typicalWindow: 'Usually held in May; registration usually in February and March.', typicalMonths: [2, 3, 5],
    fee: 'An exam fee (see the official site)', mode: 'OFFLINE', officialUrl: 'https://neet.nta.nic.in/', organiser: 'National Testing Agency',
    howToApply: ['Read the information bulletin.', 'Register on the official site before the closing date.'],
    pastWinnerNotes: null, facts: [],
  },
  {
    key: 'cuet-ug', title: 'CUET (UG)', type: 'ENTRANCE_EXAM', level: 'NATIONAL', domains: ['SCIENCE', 'COMMERCE', 'HUMANITIES'],
    summary: 'The common entrance test for undergraduate admission to central and many other universities.',
    eligibility: e(12, 12), typicalWindow: 'Usually held in May and June; registration usually in February and March.', typicalMonths: [2, 3, 5, 6],
    fee: 'An exam fee (see the official site)', mode: 'OFFLINE', officialUrl: 'https://cuet.nta.nic.in/', organiser: 'National Testing Agency',
    howToApply: ['Choose the universities and the subjects they require.', 'Register on the official site.'],
    pastWinnerNotes: null, facts: [],
  },
  {
    key: 'cbse-science-exhibition', title: 'CBSE Science Exhibition', type: 'SCIENCE_FAIR', level: 'NATIONAL', domains: ['SCIENCE', 'ENVIRONMENT', 'ROBOTICS'],
    summary: 'Regional, then national exhibitions of students\' science models on a theme announced each year.',
    eligibility: e(6, 12, { note: 'For schools affiliated to CBSE.' }), typicalWindow: 'The circular is usually issued mid-year.', typicalMonths: [7, 8, 9],
    fee: 'Free', mode: 'OFFLINE', officialUrl: 'https://www.cbse.gov.in/', organiser: 'Central Board of Secondary Education',
    howToApply: ['Watch for the CBSE circular.', 'Your school registers its exhibits for the regional round.'],
    pastWinnerNotes: null, facts: [],
  },
  {
    key: 'vvm', title: 'Vidyarthi Vigyan Manthan (VVM)', type: 'OLYMPIAD', level: 'NATIONAL', domains: ['SCIENCE'],
    summary: 'A national science talent search with school, state and national camps, including India\'s contributions to science.',
    eligibility: e(6, 11), typicalWindow: 'Registration usually runs mid-year, with the first test later in the year.', typicalMonths: [7, 8, 9, 10],
    fee: 'A small fee (see the official site)', mode: 'ONLINE', officialUrl: 'https://vvm.org.in/', organiser: 'Vijnana Bharati',
    howToApply: ['Register on the official site (individually or through the school).', 'Take the online test in the window given.'],
    pastWinnerNotes: null, facts: [],
  },
  {
    key: 'khelo-india', title: 'Khelo India Youth Games and talent search', type: 'SPORTS_TRIAL', level: 'NATIONAL', domains: ['SPORTS'],
    summary: 'National youth games and talent identification; athletes reach them through school, district and state selection.',
    eligibility: e(null, null, { note: 'Age bands depend on the sport; selection is through the state and national federations.' }),
    typicalWindow: 'Selections run through the year, sport by sport.', typicalMonths: [],
    fee: 'Free', mode: 'OFFLINE', officialUrl: 'https://kheloindia.gov.in/', organiser: 'Ministry of Youth Affairs and Sports',
    howToApply: ['Talk to your sports teacher about the district and state trials for your sport.'],
    pastWinnerNotes: null, facts: [{ front: 'How long is an Olympic swimming pool?', back: '50 metres.' }],
  },
  {
    key: 'fit-india-quiz', title: 'Fit India Quiz', type: 'COMPETITION', level: 'NATIONAL', domains: ['SPORTS', 'HUMANITIES'],
    summary: 'A national quiz on fitness and sports for school students, with school, state and national rounds.',
    eligibility: e(8, 12), typicalWindow: 'See the official site for the current edition.', typicalMonths: [],
    fee: 'Free', mode: 'ONLINE', officialUrl: 'https://fitindia.gov.in/', organiser: 'Fit India Mission',
    howToApply: ['Ask your sports teacher whether the school has registered a team.'],
    pastWinnerNotes: null, facts: [],
  },
  {
    key: 'youth-parliament', title: 'National Youth Parliament Scheme', type: 'MUN_DEBATE', level: 'NATIONAL', domains: ['HUMANITIES'],
    summary: 'Schools and colleges hold youth parliament sittings that follow how Parliament works: questions, debates and bills.',
    eligibility: e(9, 16), typicalWindow: 'Schools can usually take part through the year.', typicalMonths: [],
    fee: 'Free', mode: 'HYBRID', officialUrl: 'https://nyps.mpa.gov.in/', organiser: 'Ministry of Parliamentary Affairs',
    howToApply: ['Your school registers on the portal.', 'Students take roles (Speaker, ministers, members) and hold a sitting.'],
    pastWinnerNotes: null, facts: [{ front: 'What is "Question Hour" in Parliament?', back: 'The first hour of a sitting, when members ask ministers questions.' }],
  },
  {
    key: 'queens-commonwealth-essay', title: 'The Queen\'s Commonwealth Essay Competition', type: 'ARTS_CONTEST', level: 'INTERNATIONAL', domains: ['HUMANITIES', 'ARTS'],
    summary: 'The world\'s oldest international schools\' writing competition, with junior and senior categories and a new theme each year.',
    eligibility: e(null, null, { ageMax: 18 }), typicalWindow: 'Usually opens early in the year and closes mid-year.', typicalMonths: [2, 3, 4, 5, 6],
    fee: 'Free', mode: 'ONLINE', officialUrl: 'https://www.royalcwsociety.org/', organiser: 'The Royal Commonwealth Society',
    howToApply: ['Read this year\'s topics.', 'Write and submit your entry online by the deadline.'],
    pastWinnerNotes: null, facts: [{ front: 'Since when has the Queen\'s Commonwealth Essay Competition run?', back: 'Since 1883.' }],
  },
  {
    key: 'economics-olympiad', title: 'International Economics Olympiad', type: 'OLYMPIAD', level: 'INTERNATIONAL', domains: ['COMMERCE', 'ENTREPRENEURSHIP'],
    summary: 'An international olympiad in economics and finance for high-school students, reached through national selection.',
    eligibility: e(9, 12), typicalWindow: 'National selection usually runs before the summer final.', typicalMonths: [],
    fee: 'See the official site', mode: 'OFFLINE', officialUrl: 'https://ecolymp.org/', organiser: 'International Economics Olympiad',
    howToApply: ['Check the national selection route for India on the official site.'],
    pastWinnerNotes: null, facts: [{ front: 'What is inflation?', back: 'A general rise in prices over time, so the same money buys less.' }],
  },
  {
    key: 'smart-india-hackathon', title: 'Smart India Hackathon', type: 'HACKATHON', level: 'NATIONAL', domains: ['CODING_AI', 'ENTREPRENEURSHIP'],
    summary: 'A national hackathon for college students solving problem statements from ministries, departments and industry.',
    eligibility: e(13, 16), typicalWindow: 'Problem statements are usually released in the second half of the year.', typicalMonths: [8, 9, 12],
    fee: 'Free', mode: 'HYBRID', officialUrl: 'https://www.sih.gov.in/', organiser: 'Ministry of Education\'s Innovation Cell',
    howToApply: ['Form a team through your college\'s internal hackathon.', 'Your college nominates teams on the portal.'],
    pastWinnerNotes: null, facts: [],
  },
  // For teachers.
  {
    key: 'national-awards-teachers', title: 'National Awards to Teachers', type: 'TEACHER_PROGRAMME', level: 'NATIONAL', audience: 'TEACHERS', domains: ['SCIENCE', 'MATHS', 'HUMANITIES', 'ARTS'],
    summary: 'The Ministry of Education\'s awards for outstanding teachers, presented on Teachers\' Day (5 September). Teachers nominate themselves online.',
    eligibility: e(null, null), typicalWindow: 'Self-nomination usually opens around June and July.', typicalMonths: [6, 7],
    fee: 'Free', mode: 'ONLINE', officialUrl: 'https://nationalawardstoteachers.education.gov.in/', organiser: 'Ministry of Education',
    howToApply: ['Prepare evidence of your innovations and results.', 'Nominate yourself on the portal; district and state committees shortlist.'],
    pastWinnerNotes: null, facts: [{ front: 'Why is Teachers\' Day in India on 5 September?', back: 'It is the birthday of Dr Sarvepalli Radhakrishnan, India\'s second President and a teacher.' }],
  },
  {
    key: 'diksha-teacher-courses', title: 'Teacher courses on DIKSHA (including NISHTHA)', type: 'TEACHER_PROGRAMME', level: 'NATIONAL', audience: 'TEACHERS', domains: ['SCIENCE', 'MATHS', 'HUMANITIES', 'CODING_AI'],
    summary: 'Free online professional development courses for teachers, with certificates that can count towards CPD hours.',
    eligibility: e(null, null), typicalWindow: 'Courses are open through the year.', typicalMonths: [],
    fee: 'Free', mode: 'ONLINE', officialUrl: 'https://diksha.gov.in/', organiser: 'Ministry of Education (NCERT and state agencies)',
    howToApply: ['Sign in to DIKSHA and search for courses in your subject.', 'Log the certificate in EduOS under CPD hours.'],
    pastWinnerNotes: null, facts: [],
  },
];

/**
 * Opening hooks: a striking, checkable fact and a question, by domain. The
 * edition uses the one for the domain most of its items share, rotating by
 * period, so readers do not see the same line twice in a row.
 */
export const HOOKS = {
  MATHS: [
    { text: 'The first International Mathematical Olympiad, in 1959, had seven countries. Today more than a hundred send teams.', question: 'Could one of this week\'s challenges be your first step?', textHi: '1959 में पहले अंतरराष्ट्रीय गणित ओलंपियाड में सात देश थे। आज सौ से अधिक देश भाग लेते हैं।' },
    { text: 'Zero as a number in its own right was described by the Indian mathematician Brahmagupta in the 7th century.', question: 'Which puzzle will you crack this week?', textHi: 'शून्य को एक संख्या के रूप में सातवीं शताब्दी में भारतीय गणितज्ञ ब्रह्मगुप्त ने समझाया।' },
  ],
  SCIENCE: [
    { text: 'Chandrayaan-3 made India the first country to land near the Moon\'s south pole, in August 2023.', question: 'What would you send into space?', textHi: 'अगस्त 2023 में चंद्रयान-3 ने भारत को चंद्रमा के दक्षिणी ध्रुव के पास उतरने वाला पहला देश बनाया।' },
    { text: 'C. V. Raman won the 1930 Nobel Prize in Physics for discovering how light scatters, now called the Raman effect. India celebrates it on National Science Day, 28 February.', question: 'What question would you investigate?', textHi: 'सी. वी. रमन को 1930 में प्रकाश के प्रकीर्णन की खोज के लिए भौतिकी का नोबेल पुरस्कार मिला।' },
  ],
  CODING_AI: [
    { text: 'The International Olympiad in Informatics has been held every year since 1989.', question: 'Which problem would you write code to solve?', textHi: 'अंतरराष्ट्रीय सूचना विज्ञान ओलंपियाड 1989 से हर साल होता है।' },
  ],
  ROBOTICS: [
    { text: 'The word "robot" comes from a 1920 Czech play; "robota" means forced labour.', question: 'What job would your robot do for your school?', textHi: '"रोबोट" शब्द 1920 के एक चेक नाटक से आया है।' },
  ],
  ENVIRONMENT: [
    { text: 'Only about 3 per cent of the Earth\'s water is fresh, and most of it is frozen.', question: 'What would you change in your neighbourhood?', textHi: 'पृथ्वी के पानी का केवल लगभग 3 प्रतिशत ही मीठा है, और उसका अधिकांश हिस्सा जमा हुआ है।' },
  ],
  ARTS: [
    { text: 'The Queen\'s Commonwealth Essay Competition has run since 1883: the oldest schools\' writing competition in the world.', question: 'What story only you can tell?', textHi: 'महारानी राष्ट्रमंडल निबंध प्रतियोगिता 1883 से चल रही है।' },
  ],
  SPORTS: [
    { text: 'An Olympic swimming pool is 50 metres long and holds about 2.5 million litres of water.', question: 'Which trial will you train for?', textHi: 'ओलंपिक स्विमिंग पूल 50 मीटर लंबा होता है।' },
  ],
  HUMANITIES: [
    { text: 'Parliament\'s day usually begins with Question Hour, when members put questions to ministers.', question: 'What would you ask if you had the floor?', textHi: 'संसद का दिन आमतौर पर प्रश्नकाल से शुरू होता है।' },
  ],
  COMMERCE: [
    { text: 'Inflation means the same money buys less over time: that is why savings earn interest.', question: 'What business would you start at school?', textHi: 'मुद्रास्फीति का अर्थ है कि समय के साथ उतने ही पैसे में कम चीज़ें आती हैं।' },
  ],
  ENTREPRENEURSHIP: [
    { text: 'Many winning school innovations start with one everyday problem someone was tired of.', question: 'What annoys you that you could fix?', textHi: 'कई विजेता स्कूली आविष्कार किसी रोज़मर्रा की समस्या से शुरू होते हैं।' },
  ],
};
