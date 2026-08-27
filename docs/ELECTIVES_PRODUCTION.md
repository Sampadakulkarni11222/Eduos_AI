# Adding electives to the real database

The demo seed (`seed:electives`) **invents students, teachers and accounts**.
Never run it against real data.

Use `scripts/add-electives.js` instead. It only ever writes `Subject` and
`SubjectOffering` rows — it never creates, edits or deletes an account, profile,
student, enrolment, grade, section or term. If the school structure it needs is
not already there, it says so and stops rather than inventing it.

---

## Configure what to offer

Edit the `ELECTIVES` block at the top of `backend/scripts/add-electives.js`.
`grades` matches `Grade.level`; `capacity: null` means unlimited.

```js
const ELECTIVES = [
  { name: 'Art & Craft', code: 'ART', grades: [5, 6, 7],  capacity: 30 },
  { name: 'Music',       code: 'MUS', grades: [5, 6, 7],  capacity: 25 },
  { name: 'Dance',       code: 'DAN', grades: [5, 6, 7],  capacity: null },
  { name: 'French',      code: 'FRE', grades: [8, 9, 10], capacity: 25 },
  { name: 'Robotics',    code: 'ROB', grades: [8, 9, 10], capacity: 20 },
  { name: 'Debate',      code: 'DEB', grades: [8, 9, 10], capacity: null },
];
```

## Run it

**1. Plan first — this writes nothing.**

```bash
cd backend
npm run electives:plan
```

It prints the year and term it picked, the divisions it found, and every change
it would make. Read this before going further.

**2. Apply.**

```bash
npm run electives:apply
```

Against a remote database it prints the target, says *APPLY — changes will be
written*, and **asks you to type `yes`** before writing anything. `--yes` skips
that prompt for scripted runs.

Useful flags:

| Flag | Effect |
|---|---|
| `--term "Midterm"` | Choose the term explicitly |
| `--grades 8,9,10` | Limit to some grades |
| `--yes` | Skip the confirmation prompt |

---

## What it guarantees

- **Dry run by default.** Nothing is written without `--apply`.
- **Idempotent.** Re-running converges; a second run reports *"already correct"*
  and makes zero changes.
- **Additive only.** It never un-marks or deletes an offering. Removing an
  elective students are registered for would strand them, so that stays a
  deliberate human action in Classroom Mgmt.
- **Never lowers a capacity below seats already taken.** Such a change is
  reported as *blocked*, with the number in use, and skipped.
- **Picks a live term.** It prefers the term running now, then the next one that
  has not ended. Registering against a finished term is refused by the API, so
  offerings on a dead term would be useless.
- **Leaves `teacherId` null on offerings it creates.** Assigning a teacher is a
  staffing decision, not something a bulk script should guess.

### It reports what it deliberately leaves alone

If electives already exist that are not in your config — or are offered to a
grade band the config does not list — it says so:

```
  Already elective, left alone (this script only adds):
    French             6 division(s)  — offered outside its configured grades
    Robotics           6 division(s)  — offered outside its configured grades
```

**This matters if you have already run the updated `seed_school_data.js`**,
which creates French / Music / Robotics electives for *every* section. Those
stay, so juniors would see them alongside Art & Craft and Dance. Remove the
unwanted ones in Classroom Mgmt → Subject Offerings, or widen the config to
match reality.

---

## After applying

1. **Assign a teacher** to each new offering — Classroom Mgmt → Subject
   Offerings. Registration works without one, but the student sees no teacher
   name.
2. **Schedule timetable slots** for any elective that should appear on a
   timetable. Registration decides *who attends*; a `TimetableSlot` decides
   *when it meets*. Approved students then see it; others do not.
3. Students can register immediately — no restart needed.

---

## How this was validated

The script was never run against production. It was exercised against a full
copy of the real data shape: `seed_school_data.js` run into an ephemeral
in-memory MongoDB (720 students, 12 divisions, Classes 5–10, Midterm/Finals),
then the script applied to it.

- Dry run correctly identified 3 subjects to create, 18 offerings to create and
  18 capacities to change, while recognising the electives that already existed.
- Apply committed 36 changes; **a second run reported 0 changes**, confirming
  idempotency.
- **40/40 end-to-end checks passed** against the running API afterwards: real
  seeded students across six divisions could sign in and see their electives, no
  core subject leaked into the list, every row carried seat information, a real
  student registered successfully and it landed as `PENDING`, the seat count
  incremented, the request appeared in the admin review queue naming the student
  and subject, and the 18 newly created offerings correctly had no teacher yet.

---

## Rolling back

There is no undo flag, on purpose — an automated rollback that deleted offerings
students had registered for would be worse than the problem. To reverse:

- **An offering nobody registered for:** delete it, or clear its elective flag,
  in Classroom Mgmt → Subject Offerings.
- **One with registrations:** decide what happens to those students first. Set
  `isElective: false` and it disappears from the registration page while the
  existing rows survive; delete the offering and you orphan them.

Take a database snapshot before applying if you want a clean way back.
