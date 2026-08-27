# Subject Registration — how to verify it, and what data it needs

Elective registration depends on a chain of records. If any link is missing the
student simply sees an empty list, with nothing to explain why — so this
document covers the chain first, then how to run it.

---

## 1. The data chain

```
Account ──> Profile (STUDENT role, grants registrations.apply)
               │
               └─> Student.profileId          ← links the login to the child record
                       │
                       └─> Enrollment (status: 'ACTIVE') ──> Section
                                                               ▲
                     SubjectOffering (isElective: true) ────────┘
                       • same section as the student's enrolment
                       • termId points at a term whose endsOn is in the future
```

**Every one of these is required.** The two most commonly missed:

| Missing link | What the student sees |
|---|---|
| `Student.profileId` not set | `STUDENT_NOT_LINKED` — "No student record is linked to this account" |
| No `ACTIVE` enrolment | `NO_ACTIVE_ENROLLMENT` — "You are not enrolled in a class yet" |
| Offering not `isElective` | Nothing. Core subjects are deliberately excluded — they are already on the timetable and are not opt-in |
| Offering in a different section | Nothing. Students only see electives offered to *their own* class |
| Term already ended | Listed, but registering returns `TERM_CLOSED` |

`capacity: null` means unlimited. A number caps the seats, and **both `PENDING`
and `APPROVED` registrations hold a seat** — otherwise approving a backlog of
pending requests would silently overfill the room.

---

## 2. Running it locally (safe)

`.env` points `MONGO_URI` at the live Atlas cluster, so **do not** run the
ordinary seed to try this out. Use the local harness instead: it starts an
ephemeral in-memory MongoDB and overrides `MONGO_URI`, so production is
unreachable from the run.

**Terminal 1 — backend**

```bash
cd backend
npm run dev:local            # prints the in-memory MongoDB URI it created
```

**Terminal 2 — seed the scenario**

```bash
cd backend
MONGO_URI="<the URI printed above>" npm run seed:electives
```

**Terminal 3 — frontend**

```bash
cd frontend
npm run build && npm start   # or `npm run dev`
```

Everything is discarded when the backend process exits. Nothing touches Atlas.

### What the seed creates

**All 12 divisions** — Classes 5–10, sections A and B — matching the shape
`seed_school_data.js` builds. Offerings are per-section, so each division has
its own elective records and its own students.

Junior and senior years offer different electives, which also proves a student
only ever sees their own division's:

| Band | Divisions | Electives | Capacities |
|---|---|---|---|
| Junior | Classes 5–7 (6 divisions) | Art & Craft, Music, Dance | 6 / 4 / unlimited |
| Senior | Classes 8–10 (6 divisions) | French, Robotics, Debate | 4 / 6 / unlimited |

**Mathematics** is offered to every division but is **not** elective — it exists
so you can confirm core subjects never appear on the registration page.

Totals: **36 elective offerings, 60 students, 36 registrations**.

The starting state rotates across divisions so every UI case exists somewhere
without you having to create it:

| State | Divisions | What you see |
|---|---|---|
| One seat left | 5A, 6B, 8A, 9B | Register still available; taking it makes the elective full |
| Full | 5B, 7A, 8B, 10A | *Full* chip, no Register button |
| Already registered | 6A, 7B, 9A, 10B | The printed student has one approved and one pending |

### Logins

Password for every account: `localdev123`

| Login | Role | Notes |
|---|---|---|
| `s5a@local.test` … `s10b@local.test` | STUDENT | One per division. Pattern is `s<class><section>@local.test` |
| `teacher5@local.test` … `teacher10@local.test` | TEACHER | Class teacher of both sections of that grade; their review queue shows **only** their own grade |
| `admin@local.test` | ADMIN | Sees every division |

Each division has 5 students; only the first has a printed login. The other four
exist to occupy seats.

## 3. Verifying by hand

**As the student** (`s9a@local.test`, or any division) → **Subject Registration**:

- Exactly three electives are listed — the ones for that division's band.
  **Mathematics is not**, which is the point of the `isElective` flag.
- Seat counts differ by division: try `s8a@local.test` (French has 1 seat left)
  against `s8b@local.test` (French is already **Full**, no Register button).
- Press **Register** → the chip becomes *Awaiting approval* and the button
  becomes **Withdraw**.
- Sign in as a Class 5 student and you get Art & Craft / Music / Dance instead —
  a division never shows another division's electives.

**As the teacher** (`teacher9@local.test`) → **Subject Registrations**:

- The Pending tab lists each request with the student's name, admission number
  and subject.
- The queue is **narrowed to that teacher's own grade** — `teacher5` sees only
  junior electives, `teacher10` only senior ones. `admin@local.test` sees all
  36 registrations across every division.
- **Approve** one, or **Reject** and type a reason.

**Back as the student:**

- The chip reads *Registered* (or *Not approved*, with your reason shown).
- The notification bell has a message: *"You are registered for Music"*.
- An approved elective now also appears on **Timetable** — but only once a slot
  has been scheduled for it (see the caveat below).

**As the admin** (`admin@local.test`) → **Classroom Mgmt → Subject Offerings**:

- The **Student registration** column shows *Make elective* for core subjects,
  and an *Elective* chip plus seat count for the rest.
- Click the seat count to change it; clear it for unlimited.
- Lowering it below the seats already taken is refused, and the message says how
  many are in use.

---

## 4. Verifying automatically

The behaviour is covered by tests that need no running server:

```bash
cd backend && npm test
```

| File | Covers |
|---|---|
| `tests/registrations.notify.test.js` | The student is notified of a decision |
| `tests/academics.updateOffering.test.js` | Elective flag, capacity, the below-taken guard |
| `tests/timetable.electives.test.js` | Only *approved* electives reach the student's timetable |
| `tests/paginate.test.js` | The staff review queue pages correctly |

Beyond those, the seeded data was validated against a live server:

- **22 checks** on the single-division flow — only electives listed, seat
  counting including pending, duplicate registration refused, the full state,
  the review queue, approval, and the resulting notification.
- **85 checks across all 12 divisions** — every division shows exactly its own
  band's three electives and never Mathematics; no capped elective is ever
  oversubscribed; a junior student sees no senior electives and vice versa;
  registering for another division's offering is refused with 403; the full,
  one-seat-left and uncapped states all exist in the data; each teacher's queue
  is narrowed to their own grade while the admin sees all 36 registrations.

---

## 5. Adding real (non-demo) data

There is no bulk importer for electives. Two supported routes:

**From the UI** — Classroom Mgmt → Subject Offerings → *Make elective*, then set
the seat count. This is the normal path and needs no database access.

**From the API:**

```http
POST  /api/v1/academics/offerings          # create, with isElective + capacity
PATCH /api/v1/academics/offerings/:id      # flip an existing offering
      { "isElective": true, "capacity": 20 }   # capacity null = unlimited
```

Both need `academics.structure.manage` (ADMIN, OWNER, PRINCIPAL).

Existing databases seeded before electives existed have no elective offerings —
the fields default to `isElective: false`, so nothing breaks, but nothing shows
up for students until an offering is marked elective.

---

## Caveats

- **Approved electives only appear on the timetable once a slot is scheduled for
  them.** The registration and the timetable are separate records: registration
  decides *who attends*, a `TimetableSlot` decides *when it meets*. The seed
  deliberately creates no slots for electives, because the timetable generator's
  no-double-booking stagger assumes exactly five subjects per section. Add slots
  through Timetable Builder to see them appear.
- **Registration has no open/close window.** A student can register at any point
  until the term ends. Scheduled windows are tracked as ENH-012.
- **No waitlist.** A full elective simply shows *Full*. Tracked as ENH-013.
- **The staff queue has no bulk approve.** One decision at a time. ENH-014.
