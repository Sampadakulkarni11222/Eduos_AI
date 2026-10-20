# EduOS: combined product prompt (all owner requests, 13–18 Oct 2026)

## Ground rules
- Never commit or push directly to `main`; create a branch and push there (push to `main` only when explicitly asked).
- The platform must serve both schools and colleges, and be the single source for every school/college need: everything managed, maintained, tracked and reminded to the right department.
- Think 360°: put yourself in the shoes of an experienced principal, admin, teacher, student, parent and every other role; research deeply, compare with competitors and standard formats, and close the gaps.
- Every new feature needs access management (role-based, limited to each profile's access) and sample data in every section so everything is easy to test.
- Add new features alongside what already works; don't break or replace working features.
- Use or install relevant skills where useful (research: market-research and market-researcher skills; UI/animation/3D: motion and UI/UX skills, GSAP, three.js, anime.js, React Bits, etc.; testing: webapp-testing, frontend-visual-qa, qa-test, gstack or the best available).
- Reference material: the three attached videos (3D game-like map, dashboard), `OPUS_5_5_SCHOOL_PLATFORM_PROMPT.txt`, `ADVANCED-FEATURE-RESEARCH-2026-10-14.md` and the "EduOS Advanced Features and Competitor Research" document.

## 1. Attendance
- Flashcards for attendance with Present/Absent buttons plus Back and Pass, to mark attendance faster (as an additional mode).

## 2. Administration (principal, owner, admin)
- Research the principal's and administrator's tasks and build them. The principal is mainly the approver of most things.
- File reports/attendance to agencies and boards (CBSE, ICSE, state boards, government). Check whether boards offer an API to submit automatically; if not, provide properly formatted document exports the principal can print, sign and submit manually.
- Manage, reply to and get reminded about letters and documents received from departments (government, CBSE, ICSE, state board and others).
- Board and trustee meetings with WhatsApp updates; agreements, rules, regulations and policies from CBSE and other bodies.
- Cost analysis; teacher and student performance.
- An Administration department that manages all school operations: roles, responsibilities, agreements, policies, cost analysis, performance.
- Background verification of teachers and drivers, with final approval by the principal.
- Event/fest coordination and meeting arrangement.
- Transparency and notifications about licensing and other compliance items.
- POCSO and other mandatory sessions per court, central and state government requirements, kept updated with the district collector.
- Organisation structure map and school profile that update from the data filled in.

## 3. Finance
- Payroll, PF, salary, procurement, financing for needs, and more (research and add).
- Bills and invoice generation and tracking; bill and service reminders; a cost dashboard to track numbers and spot leakage.
- Fee concessions, Tally export and GST.

## 4. Marketing, sales and admissions
- A Marketing and Sales department: lead management, posters, banners, social media, counsellors, and more.
- Offline marketing: banners, pamphlets, posters, radio shows and other channels, tracked.
- Connectors to collect and track data: social media, Meta Ads, Google Ads and others.
- Online admission form.

## 5. Newsroom, social and alumni
- A newsroom like a social network for the school, open to everyone: event photos, special moments, ceremonies, celebrations, achievements; engaging and interactive, with circles, and connecting students with seniors and alumni for guidance.
- Newsroom posts can auto-post to social media; the person posting chooses the networks; parents and students cannot.
- Alumni community (students and teachers), segregated by batch, kept engaged and tracked long term; a social media field on the student profile; students keep community access after leaving; new students can connect with alumni for guidance; alumni directory.
- Showcase previous class top rankers.

## 6. Dashboards and analytics
- Smart, interactive, engaging dashboards for all profiles, easy to navigate, with graphs and detailed analysis (inspired by the dashboard video; the admin dashboard is the reference).
- A detailed analytics page with custom dates and year-on-year comparison covering every segment: students, revenue, pricing, quotations, bills, procurement, admissions, licensing dates, service lifecycle dates, and more; organised per department, and detailed for principal and admin.
- Auto-generated quarterly analysis reports for all segments, sent to admin and principal.
- Universal search on every profile, showing results within each person's access.
- Generative UI for dashboards (evaluate and use thesysdev/openui).

## 7. 3D campus map ("game view")
- A realistic, animated 3D game-like map for every profile (limited to each role's access), with an overview and a view-within-a-view for detail, plus buttons that redirect to the specific page; show rooms, grounds, availability and who is doing what.
- Full page; cover everything in the school.
- Department details on click, with links to their pages.
- Each classroom shows the daily student count from real-time attendance, which teacher is teaching, the subject and module, and whether an exam or a normal class is running; in-depth details on click.
- When a class or room is clicked, add real-time details on top of what's already shown: who is teaching, which class, subject, time remaining, students present, with live updates. "See details" opens one dynamic page for any section, routing to existing pages where they exist instead of creating many pages.
- Collapse options for the detail panels so the view isn't cluttered.
- Parent view: their child's class, the real-time scene, who is teaching, teacher details, class strength and present count; only what their access allows (same principle for every profile).
- Students visible in Campus World; the scene changes with the selected time; students shown only during their timetabled hours; live timing (no student movement on holidays or outside school hours); shift management with the correct students per shift; teacher qualifications shown (create the field).
- Update the map with every new feature where relevant.

## 8. Teaching and learning
- Digital lectures, with meeting creation and management, and email, notification and WhatsApp messages.
- Module tracker for teachers with a timeline per module, so the principal can see who is teaching what in real time.
- Substitute-teacher cover, staff leave balances, CBSE term report cards.
- Reliable analytics, student support plans, competency portfolios, offline workflows, scenario planning, evidence-based AI assistance.

## 9. Communication and parents
- Review calls and review scheduling with parents; PTM meetings and PTM booking; PTM follow-ups.
- Parent–teacher messaging.

## 10. Operations, safety and compliance
- Camera-based tracking (per school requirement): whether the teacher is present and taking the class; alerts to teacher and principal for possible bullying; and more.
- Bus tracking and student ID tracking for transparency with parents, teachers and students; safe transport handover.
- Track, manage, maintain and notify: vehicle capacity; service notifications (fire safety, buses and others); school and product licences and their expiry; science and computer lab inventory and equipment with expiry and renewals; sanitation notifications; and more.
- Build the computer and science labs module (complete lab operations).
- Service and renewal tracking.
- Library barcodes; hostel out-pass.
- Health visits and medication.

## 11. Sports, arts and sustainability
- Sports and extracurriculars (dance, singing and other arts), compared with competitors and standard formats.
- Greenery and waste management: research recognitions and government schemes schools must follow; if none, help schools do it and get recognition and publicity (social awareness posts, a points system, and more).

## 12. Forum / trends newsletter
- A Google-Alerts-style daily feed of technology, education and domain trends, per profile.
- Include India-wide, state-wide and international worthwhile competitions, innovations, exams, research and more, based on the school or college and its domain and industry.
- Weekly and monthly interactive newsletters with all the details, emailed to parents and teachers.
- Make it unique and interactive so people want to read and engage: flashcards, hooks, and more.
- Use Google Alerts plus AI to collect and polish the data, and auto-generate the newsletters with AI.

## 13. Ask AI and WhatsApp agent (MCP)
- Audit the MCP layer thoroughly and fix issues.
- Every action or task must be possible through Ask AI and the WhatsApp agent, literally all (read, write, create, update, review, analyse, and more), based on each user's role and limited access: a smart application, not a traditional click-through one.
- Ask AI must keep context (remember the conversation) and must not hallucinate; it should answer every question and perform every action within the user's access.
- Specific fixes: a teacher's "apply for leave"; "students with low attendance in my classes"; a student asking their class rank (say ranks aren't shown); pronouns after two people are named; "who scored the highest?" naming the student; an admin's "her class?"; "show its students" after a class ranking; HR's staff count (staff only).
- Multiple operations in one prompt (e.g. a parent asking the student's score, performance, assignment updates and class teacher together).
- When a parent or teacher asks about a student's performance, score it from multiple measures with correct data and no hallucination, and explain how it's calculated and which parameters are used.
- Handle spelling mistakes, multiple languages and audio (voice) input.
- Bulk import through Ask AI: the user uploads a sheet and says where it goes or what's in it; the AI checks the format for that location, uploads it or explains what to fix and shares a sample sheet; minimal manual effort.
- Follow the target architecture: app → AI agent (intent detection, planning, tool selection, response) → MCP server with controlled tools (schema discovery, approved queries, metric definitions, calculation tools) → database plus verification engine (exact calculations and validation) → answer validation (verify results and provenance; reject unsupported answers).
- Find everything else that can be automated, automate it, and improve wherever needed. (Evaluate google/artemis as an alternative for in-app task automation.)

## 14. Quality, testing and performance
- For every profile: research roles and responsibilities; audit each feature and sub-feature; compare with competitors and standard formats; find what's missing, lagging or broken; add advanced and AI features; test everything down to the smallest detail.
- Fix UI alignment issues across the app (e.g. dashboard charts).
- Mobile responsiveness on all pages and screen sizes.
- Faster tab switching (page loading, API calls, rendering).
- Reverse-engineering style testing, load/stress testing, and database testing; install the best testing skills.
- A local build/demo to test with, with sample data in every section.
- Cross-check all prompts for anything still pending, and keep a pending list.

## 15. Deliverables requested along the way
- Push work to new branches; finally push to `main` (done, with the CI lint failure fixed afterwards).
- A detailed list of all changes and enhancements for manual testing, shareable with a developer.
