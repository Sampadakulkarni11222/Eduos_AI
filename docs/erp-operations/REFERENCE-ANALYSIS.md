# Reference analysis — videos and World Prompt Pack

Inspected 2026-10-13. Frames were extracted locally with FFmpeg 7.1 (the static
binary bundled by the PyPI package `imageio-ffmpeg==0.6.0`, installed into an
isolated scratch virtualenv, not the project). One frame every 2 s plus
scene-change frames for each video, and full-resolution enlarged crops of the
interface areas at the timestamps listed below. Audio was not transcribed; the
burned-in captions were read from the frames instead.

"Observed" means visible in a frame. "Interpretation" is our reading of it.

## 1. `Dashboard vid.mp4` (67.9 s, 720×1280, talking-head reel with a screen recording in the top half)

| Time | Observed | Interpretation → ERP decision |
|---|---|---|
| 0:00–0:28 | An isometric 2.5D office ("War Room") seen from above. Desks are grouped into floor zones labelled *Sales and revival*, *Franchise ops*, *Finance*, *Marketing*. Each agent has a floating name chip with its current activity ("Dialer · Calling lead 7731 in Raleigh"). A wall board shows the day's headline numbers. | The overview is a **place**, and departments are **zones** of it. → The campus world groups facilities by building/department, and each object carries a small status chip (room "In use · Physics 9B", work order "Plumbing · assigned"). |
| 0:04–0:10 (crop `d_6`, `d_9`) | Right rail: decision cards (*"Pause 5 ad sets over $95 a lead"* with **Approve / Hold**), then **"What your agents just did" — Live** feed. Bottom-left legend: zone list with counts and the note **"Teal means an agent did it. Demo, sample data."** Bottom-right: "Handoffs today 674 · Pause the room". Clicking an agent opens a panel with Overview / Today / Queue / Instructions tabs, three stat tiles, "Gets work from / Passes work to", latest actions, **Run now / Pause**, "Every run is logged". | The principal's home is an **approval rail + activity feed** beside the visual overview, and decisions are one click from the summary. The reel labels its data as demo — we do the same: sample layouts are labelled sample, scheduled activity is labelled scheduled, never "live". |
| 0:00 | "Good morning, Jordan … the Chief of Staff has **four decisions** for you." + **Brief me** button. | → **Principal daily briefing**: greeting, count of pending decisions, deadlines and exceptions, each linking to its record. |
| 0:30–0:35 (crop `d_33`) | "The Brain": a bipartite graph — agents on the left, knowledge shelves (Leads, Branches, Your voice, Pricing, Decisions, Playbooks) on the right; selecting one highlights who reads what; middle column lists the memories read. | Not adopted directly (no autonomous agents). Inspiration for the **organization map**: select a person/position, highlight reporting and dotted lines. |
| 0:36–0:47 (crops `d_39`, `d_47`) | "Departments": each department page opens with a **mini isometric thumbnail of its zone**, then cards per member with a current task and "Run now", then department KPIs (call block funnel, open invoices by age bar, royalty by branch bars, 30-day cash forecast columns), and a list with **Send reminder** actions. | → Department workspaces (Administration, Finance, Marketing) open with a compact header of their queues and KPIs, and every list row has its next action inline (e.g. *Remind* on an overdue letter, *Escalate* on an overdue approval). Ageing bars are used for overdue correspondence and receivables. |
| 0:50–0:52 (crop `d_51`) | "Chief of Staff" chat drawer with suggested prompts ("What needs me today?"). | The platform already has the *Ask EduOS* assistant. The briefing reuses it as a read-only helper; decisions remain explicit button presses by a human. |
| 0:54 caption | "Also, none of the data … This is demo data". | Reinforces the honesty rule. |

## 2. `Vid 3.mp4` (30.0 s) — "WareTrack" warehouse as a strategy game

| Time | Observed | Interpretation → ERP decision |
|---|---|---|
| 0:00–0:06 (crop `w_3`) | Full-bleed 3D scene (low-poly, soft shadows, one blue accent on white). Top bar: logo, search ("sites, trucks, forklifts, pallets, shipments… /"), **site switcher** ("WH-01 Riverside Hub · 78% full · 1/2 docked"), **Live 09:41**, bell, user. Three **KPI cards** top-left (Stock on hand 1,412 ↑15; Trucks on site 1; On-time 96.6%). Vertical **camera controls** (+, −, rotate left/right, home). Selected pallet has a floating label and a **detail card** (Staged · quantity, weight, location, lot, received). | → Campus view layout: search, **campus/building switcher**, KPI cards, camera controls with **Home/reset**, selection label + detail card. |
| 0:00–0:06 | Bottom-left **Shipment Tracking** stepper (Order confirmed → Picked → Loading 2/6 → In transit → Delivered, with times). Bottom-right tabbed table (**Docks / Forklifts / Trucks**) with status pills and progress. | → A **process stepper** for the selected item (e.g. a work order: Reported → Assigned → In progress → Resolved) and a **tabbed table** (Rooms / Work orders / Events) under the map. |
| 0:16–0:20 (crop `w_17`) | Selecting a moving truck: camera follows it; detail card shows ETA, speed, bay, cargo; route drawn as a dashed line to a dock pin. | Following moving objects is only honest when the movement is real. We animate **scheduled** activity (class change, bus bay arrivals per timetable) and label it as such; no named-student tracking. |
| 0:08–0:14 | Captions contrast "Boring tables / Endless rows / Nobody enjoys this" (a legacy SAP-like grid) with the 3D view. | The 3D view must still lead to the real records: **Open full details** goes to the ERP page, and a **2D list alternative** is always available. |
| 0:22–0:36 | The same visual language applied to Hospitals (beds free/in use chips), Farming (field status chips, "drone scanning"), **Schools** (classroom with desks, a yellow school bus, a playground track), Delivery (coloured routes). | Confirms a school can be expressed in this idiom: rooms with desks, bus bays, ground. |

## 3. `vid game 1.mp4` (47.2 s)

The frames show the same WareTrack demo as Vid 3, framed as a social post
("Claude Opus 5.5 Just Turned Warehouse Management Into a Strategy Game"). No
additional interface elements beyond those listed above: KPI cards, site
switcher, object detail card, shipment stepper, tabbed table, trucks moving
along roads and docking. Decision supported: the same layout pattern, plus
motion along defined routes with yielding (vehicles queue rather than overlap).

## 4. `World_Prompt_Pack.pdf` (21 pages, read in full)

Every world follows **WORLD → LIFE → INTERACTION → DASHBOARD → EXTRAS**:
built-in-code low-poly scene with one accent colour; a looping simulation where
"everything gives way, nothing overlaps"; pan / right-drag rotate / zoom, click
to glide-and-follow with a ring and label; frosted-glass top bar, 3 KPI cards,
right detail panel, bottom-left process tracker, tabbed table; seasons /
weather / day–night; mobile bottom sheet. The follow-up page recommends a
cinematic mode, give-way fixes at junctions, and instancing for phones.

Adopted: the five-block structure, the panel layout, ring + label selection,
camera glide, area switcher, day/night as a decorative toggle, reduced-motion
and low-power controls, instancing for repeated objects (desks, trees, people).

Not adopted: the "single HTML file" delivery (the ERP integrates a lazy-loaded
component into the existing Next.js app), and invented "realistic data" — the
campus view shows records from the database or explicitly labelled sample
layout.

## 5. Resulting design decisions (cross-referenced in the requirements ledger)

1. **D-1** Principal home = briefing + approval rail + live activity, beside the campus overview (Dashboard vid 0:00–0:10).
2. **D-2** Department workspaces open with queues and KPIs; list rows carry their next action inline (Dashboard vid 0:36–0:47).
3. **D-3** Campus world: search, campus switcher, KPI cards, camera controls with Home, selection label and detail card, process stepper, tabbed table (Vid 3 0:00–0:20).
4. **D-4** Honest data labels: sample layout / scheduled / recorded / stale (Dashboard vid caption at 0:54, legend at 0:04).
5. **D-5** Nested navigation campus → building → floor → room → "Open full details" (World pack interaction block; Vid 3 site switcher).
6. **D-6** Decorative extras (day/night, weather) are optional, pausable and never alter data (World pack extras block).
