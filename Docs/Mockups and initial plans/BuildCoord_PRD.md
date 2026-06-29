# BuildCoord — Product Requirements Document
**Version:** 1.0 Draft  
**Author:** Emelie  
**Date:** June 2026  
**Status:** Ready for Design

---

## 1. Product Overview

**BuildCoord** is a mobile-friendly web app for coordinating community build and renovation projects — from large-scale home extensions with 50+ volunteers to small weekend chicken coop builds with 5 friends. It handles rooms/areas, task assignment, material planning, shopping lists, food management, and volunteer coordination in one place.

The app is **project-based**: each project is a self-contained workspace. Scale adapts automatically — a small project simply has fewer rooms, fewer people, and a simpler view.

---

## 2. Problem Statement

Coordinating a community build project across many people with different skill levels is genuinely hard. Information lives in group chats, spreadsheets, and people's heads simultaneously. Materials get forgotten, tasks get duplicated, allergies get overlooked at lunch, and novices end up attempting work that requires expertise. There is no dedicated tool for this kind of community-organized, volunteer-driven construction work that covers the full coordination surface — rooms, tasks, people, materials, and food — in one place.

---

## 3. Goals

1. A project organizer can set up a complete build project — rooms, tasks, people, materials, food — in under 30 minutes.
2. Volunteers can check in to the app on their phone and immediately know where they're needed that day and what their tasks are.
3. The shopping list for both materials and food is always accurate, consolidated, and sortable by category.
4. No task requiring skilled labor is accidentally assigned to a novice.
5. The app works as well for a 3-person chicken coop weekend as for a 50-person house extension.

---

## 4. Non-Goals

- **This is not a professional construction management tool.** No Gantt charts, no earned value management, no contract tracking. Those tools exist; this isn't competing with them.
- **No payment or financial tracking in v1.** Cost estimation on materials is fine, but invoicing, budgeting dashboards, or splitting costs between participants is out of scope.
- **No real-time messaging/chat.** The app has an announcement board and per-room logs, but is not a chat app. People can use Signal/WhatsApp for that.
- **No calendar sync in v1.** Availability is set within the app; syncing to Google Calendar / iCal is a future consideration.
- **No public marketplace.** Projects are private by default; sharing across organizations or publishing templates is out of scope for v1.

---

## 5. User Personas

### The Organizer
Creates and manages the project. Sets up rooms, tasks, materials, assigns people, plans food. Likely one person, possibly two sharing the role. Needs a desktop-capable overview but will also use mobile on-site.

### The Skilled Volunteer
A tradesperson or experienced builder. Wants to know exactly what's expected, what tools/materials are ready, and who else is on their crew. Doesn't want to babysit the app — quick check-in, clear task list, done.

### The General Volunteer
Willing hands, limited expertise. Needs clear, safe task assignments. Benefits from seeing what's happening in the whole project so they can find somewhere useful.

### The Food Manager
Responsible for feeding everyone. Needs a consolidated headcount, the allergy matrix, a meal plan, and a food shopping list. May not care about the build side at all.

### The Drop-in Volunteer
Shows up for one day. Needs to quickly understand the project, sign up for something appropriate, and get going without a long onboarding.

---

## 6. Core Concepts

| Concept | Description |
|---|---|
| **Project** | Top-level container. Has a name, description, start date, location. |
| **Area** | A physical space or work zone (e.g. "Kitchen", "Roof", "Garden"). Replaces "room" to work for outdoor builds. |
| **Task** | A unit of work inside an Area. Has skill requirements, estimated duration, status, and assignees. |
| **Material** | A physical item needed for a Task or Area. Has quantity, unit, status, and optional supplier/cost. |
| **Person** | A project participant. Has skills, dietary needs, and availability. |
| **Build Event** | A specific date when work happens. People sign up for events. |
| **Shopping List** | Auto-generated from Materials (build) and Meal Plan (food). |

---

## 7. User Stories

### Organizer
- As an organizer, I want to create a project with a name, description, and location so that everyone knows what we're building and where.
- As an organizer, I want to add areas and define tasks within them so that the work is structured and trackable.
- As an organizer, I want to set a skill requirement on each task (novice / intermediate / expert) so that the right people are matched to the right work.
- As an organizer, I want to attach materials to tasks or areas, with quantities and units, so that the shopping list is always accurate.
- As an organizer, I want to assign people to tasks or to areas for a specific build event so that everyone knows their role on the day.
- As an organizer, I want to see a build readiness view per area (what's unassigned, what's missing materials, what's blocked) so that I can identify gaps before the event.
- As an organizer, I want to upload reference images to areas (wallpaper samples, flooring choices, panel finishes) so that volunteers executing the work can see the intended result.
- As an organizer, I want to post announcements visible to all participants so that I can share day-of information or changes.
- As an organizer, I want to invite people to the project via link or email so that I don't have to manually create accounts for 50 people.

### Skilled Volunteer
- As a skilled volunteer, I want to see my assigned tasks for today in one tap so that I don't need to navigate the whole project.
- As a skilled volunteer, I want to see what materials are ready vs. still needed for my task so that I know if I can start or need to wait.
- As a skilled volunteer, I want to log progress notes on a task so that the organizer knows the status without asking me.

### General Volunteer
- As a general volunteer, I want to browse open tasks filtered by skill level so that I can find something I'm capable of doing.
- As a general volunteer, I want to sign up for a build event and pick my tasks in advance so that the organizer knows to expect me.

### Food Manager
- As a food manager, I want to create a meal plan for each build event (breakfast / lunch / dinner) so that I know what to cook.
- As a food manager, I want to see the allergy and dietary requirement matrix for all confirmed attendees so that I can plan safe meals.
- As a food manager, I want the food shopping list to auto-scale to confirmed headcount so that I don't under- or over-buy.
- As a food manager, I want to add recipes or dish notes to each meal so that someone else can cover if I'm unavailable.

### Drop-in Volunteer
- As a drop-in volunteer, I want to join a project from a shared link without creating an account (or with a very fast sign-up) so that the barrier to participation is low.
- As a drop-in volunteer, I want to see a simple "what needs doing today" list so that I can contribute immediately.

---

## 8. Requirements

### P0 — Must Have (MVP)

#### Project Management
- [ ] Create / edit / archive a project (name, description, location, start date)
- [ ] Invite participants via shareable link or email
- [ ] Participant roles: Organizer, Volunteer, Food Manager (combinable)
- [ ] Project dashboard showing overall progress at a glance

#### Areas & Tasks
- [ ] Create areas within a project (name, description, optional photo)
- [ ] Create tasks within an area (name, description, skill level: novice / intermediate / expert, estimated hours, status: not started / in progress / done)
- [ ] Assign one or more people to a task
- [ ] Mark tasks complete
- [ ] Build readiness indicator per area: % tasks assigned, % materials available, % tasks complete
- [ ] Upload reference images to an area (flooring, wallpaper, panels, finish samples)

#### People & Skills
- [ ] Add people to a project (name, contact info)
- [ ] Skill tags per person (e.g. electrician, plumber, carpenter, tiler, general labor, driver)
- [ ] Skill level per tag: novice / intermediate / expert
- [ ] Dietary requirements per person (free text + common presets: vegetarian, vegan, gluten-free, nut allergy, dairy-free, halal, kosher)

#### Materials
- [ ] Add materials to a task or area (name, quantity, unit, status: needed / ordered / delivered / used)
- [ ] Optional fields: estimated cost, supplier name/link, notes
- [ ] Auto-generated material shopping list across the whole project, grouped by category and filterable by area or task
- [ ] Mark materials as ordered / delivered

#### Food
- [ ] Create a meal plan per build event (breakfast / lunch / dinner, dish name, notes)
- [ ] Confirmed headcount auto-pulled from event sign-ups
- [ ] Allergy/dietary matrix view: rows = people confirmed for that event, columns = dietary flags
- [ ] Food shopping list per meal plan, with manual ingredient entry and optional scaling by headcount

#### Build Events
- [ ] Create a build event (date, start/end time, description)
- [ ] Volunteers sign up to attend an event
- [ ] Organizer can see who's coming
- [ ] Day-of view: "My tasks today" per volunteer

#### Communication
- [ ] Project-level announcement board (organizer posts, all participants see)
- [ ] Per-task comment/update log (any assignee can post progress notes)

#### Shopping Lists
- [ ] Combined material shopping list (whole project or per event)
- [ ] Food shopping list (per build event)
- [ ] Both lists are printable and shareable as a plain text copy

---

### P1 — Nice to Have

- [ ] Photo progress log per area: before / during / after photos with timestamps
- [ ] Punch list per area: small outstanding items before area is marked "done"
- [ ] Skill-based task suggestions: "You have 3 people available with plumbing skills; these tasks are unassigned"
- [ ] Volunteer availability calendar within the app (set which build events you can attend)
- [ ] Per-area crew lead designation (one person owns the area)
- [ ] QR code for project join link (print and post on-site)
- [ ] Task dependencies: mark that Task B cannot start until Task A is done
- [ ] Material cost totals and budget tracker (read-only, no invoicing)
- [ ] PDF export of the full project plan (for offline reference on-site)
- [ ] Push/email notifications for assignment changes or new announcements

---

### P2 — Future Considerations

- [ ] Project templates (save a chicken coop project as a reusable template)
- [ ] Multi-day event support with daily sub-plans
- [ ] Mobile app (native iOS/Android) rather than web only
- [ ] Integration with hardware stores for direct ordering from shopping list
- [ ] Calendar sync (Google Calendar, iCal)
- [ ] Multi-organizer project with delegated area ownership
- [ ] Time tracking (log actual hours vs. estimated)
- [ ] Offline mode (service worker / PWA for on-site use without signal)

---

## 9. Information Architecture

```
Project
├── Dashboard (overview, progress, upcoming events)
├── Areas
│   ├── Area detail
│   │   ├── Tasks
│   │   │   └── Task detail (assignees, materials, comments)
│   │   ├── Materials
│   │   ├── Reference images
│   │   └── Build readiness
│   └── [+ Add Area]
├── People
│   ├── People list (name, skills, dietary info)
│   └── [+ Add / Invite]
├── Events
│   ├── Event list
│   └── Event detail (sign-ups, day-of view, food plan)
├── Food
│   ├── Meal planner (per event)
│   ├── Allergy matrix
│   └── Food shopping list
├── Shopping
│   ├── Materials list (whole project)
│   └── Filter by area / task / status
└── Announcements
```

---

## 10. Key Screens

| Screen | Primary Action | Notes |
|---|---|---|
| Project dashboard | See overall status at a glance | Card per area with readiness %, next event countdown |
| Area detail | Manage tasks and materials | Tab layout: Tasks / Materials / Images |
| Task detail | Update status, log notes, see assignees | Mobile-optimized |
| Day-of view | See "my tasks today" | Volunteer-facing, minimal UI |
| People list | Browse and filter by skill | Useful for organizer during assignment |
| Event sign-up | Confirm attendance | One-tap for volunteers |
| Allergy matrix | See all dietary flags for an event | Table view, food manager |
| Shopping list | Consolidated view, mark as purchased | Checkbox per item, groupable by category |
| Announcement board | Read/post updates | Reverse chronological, organizer can pin |

---

## 11. Design Direction (for Designer)

**Character:** This tool is for people doing real physical work together — it should feel honest, practical, and warm. Think of a well-organized site office: clear, legible, no clutter. Not corporate, not cutesy.

**Scale:** Must work on a phone held in one hand with dusty fingers. Touch targets generous, key actions reachable in one tap, text large enough for outdoor sunlight reading.

**Color:** One strong accent color for actions and status indicators. Neutral base. Status colors should be semantically clear: green = done / ready, amber = in progress / pending, red = blocked / missing.

**Key UX principles:**
- The volunteer's first-tap destination is "what am I doing today" — make that instant.
- The organizer's home is the project dashboard — status at a glance, drill down on demand.
- Shopping lists must be printable on a plain sheet of A4 — no background colors, clean layout.
- Allergy information should be visually prominent, never buried.
- Empty states should suggest the first action, not just say "nothing here yet."

---

## 12. Technical Considerations

- **Web app, mobile-responsive.** No native app in v1.
- **Real-time collaboration** required: if two organizers edit simultaneously, changes should reflect without page refresh. (Consider WebSockets or a real-time backend like Supabase.)
- **Authentication:** Email/password minimum; magic link preferred for low-friction volunteer join flow.
- **Image storage:** Reference images and progress photos need cloud storage (not just DB). Compress on upload.
- **Offline / low-signal consideration:** Site workers may have poor connectivity. At minimum, cached read access to the day-of view is desirable (PWA / service worker — P2 but worth designing for).
- **Multi-tenancy:** Each project is isolated. Users can belong to multiple projects.

---

## 13. Open Questions

| # | Question | Owner | Blocking? |
|---|---|---|---|
| 1 | Should volunteers be able to self-assign to tasks, or must the organizer assign them? | Emelie (product) | Yes |
| 2 | Is there a concept of "project owner" separate from "organizer", e.g. for multi-project organizations? | Emelie | No |
| 3 | Food shopping list: does the food manager enter recipes with auto-scaling, or just a flat ingredient list? | Emelie | No |
| 4 | Should material categories be predefined (fasteners, timber, electrical, plumbing…) or free-form? | Emelie | No |
| 5 | Drop-in volunteers: full account required, or can they participate as a named guest without login? | Emelie | Yes |
| 6 | Are build events single-day only, or can they span multiple days (e.g. a 3-day renovation weekend)? | Emelie | No |

---

## 14. Success Metrics

**Leading (short term):**
- Organizer completes project setup (≥1 area, ≥1 task, ≥1 person) within first session
- Volunteers who open the app on an event day reach their task list in ≤2 taps
- Shopping list is viewed and marked-up on at least 80% of projects with materials added

**Lagging (after multiple projects):**
- App used for at least 3 distinct projects (chicken coop, house, other)
- No reported cases of skilled-task/novice mismatch due to app error
- Food manager considers allergy matrix reliable enough to plan without a separate spreadsheet

---

## 15. Phasing Suggestion

**Phase 1 (MVP):** All P0 requirements. Single organizer per project. Focus on getting one full project — areas, tasks, people, materials, food — end-to-end.

**Phase 2:** P1 additions: photo log, crew leads, skill-based suggestions, PDF export, notifications.

**Phase 3:** Templates, multi-organizer, offline/PWA support, optional calendar sync.
