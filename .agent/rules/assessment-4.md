---
trigger: always_on
---

# Assessment 4 — The Records and Access Slice

Rules for this repository. Follow them literally. If a request conflicts with a
rule here, stop and say so rather than working around it.

## The slice

A flow where users create, view, and delete records that belong to them, built
so that no user can ever reach another user's data.

Domain: Notes. Fields: title, body, timestamps. Nothing else — this is
deliberate, per HARD SCOPE LIMITS below.

The domain does not matter to the grade. What is graded is ownership,
correct access control, and efficient data access.

## Hard prohibitions

1. **Never write `.env`.** Same rule as every assessment — placeholders only
   into `.env.example`, real values typed in by hand. Stop and name the
   variable if you need one.
2. **Every query touching a Note is scoped to the authenticated user inside
   the query itself** — `WHERE userId = session.user.id` as part of the
   query, never a fetch followed by an ownership check in application code.
   A route that fetches by ID alone and checks ownership afterward is a bug,
   not a stylistic choice — flag it immediately if you catch yourself
   writing one.
3. **No raw database identifiers in URLs or in the interface.** Do not expose
   the Note's own `id` column anywhere the user or the browser can see it —
   not the URL, not a data attribute, not a hidden form field.
4. **No feature outside: create, list, view, delete.** No editing, no search,
   no tags, no sharing, no collaboration, no dashboard widgets. If asked to
   add any of these, say so in one sentence and wait — do not add it.

## Do not build

No landing page. No marketing page. Genuinely empty empty-states — no
placeholder or fake data anywhere, ever, including during development
screenshots.

## Engineering requirements

- Every Note query scoped to the authenticated user in the query itself.
- A public-facing identifier for each Note that is NOT the database `id` —
  e.g. a separate random slug/token column exposed in the URL, with the real
  `id` never leaving the server.
- An audit record written for every deletion — who deleted what and when —
  persisted before or as part of the delete, so the deleted record can still
  be referenced in the audit row.
- Conditional views with URL state: navigation between list/detail feels
  instant (no full page reload) but the URL still updates so any view is
  shareable and bookmarkable.
- Correct status codes throughout: 401 for "not authenticated," 403 for
  "authenticated but not allowed," used for their distinct meanings — never
  one standing in for the other, and never a 404 used to hide a 403 (per the
  brief, obscurity is not access control — the ownership check is what
  matters, not whether the identifier is guessable).
- A measured query count for each of the three main actions (create, list,
  delete), documented, with a stated reduction from the first working
  version. Take the "before" measurement honestly, before optimizing.
- Indexes on columns actually filtered or sorted on.

## The access control audit table — this is the centerpiece

The brief requires creating two test users and attempting, for every route,
to reach user one's data as user two — editing identifiers, replaying
requests, calling endpoints directly with curl. One row per route: method,
path, what was attempted, what happened, pass or fail.

- When a route or feature is finished, remind me to run its attack test
  before moving to the next task — same pattern as evidence duty in other
  assessments, but this table is graded more heavily than any single
  screenshot in the other three assessments.
- Log every attempt to `docs/evidence.md`'s audit table, including ones that
  fail on first try — a failure caught and fixed is exactly what the brief
  wants to see, not something to hide.
- Never claim a row passes without me having actually run the attack and
  seen the real response.

## Decision protocol

Same as the other three assessments: stop before choosing a library,
designing a table, adding a column or constraint, picking a status code
where more than one is defensible, or setting a tunable value. Present
options, tradeoffs, a recommendation, and what breaks with the alternative.
Wait for my answer. Log it to `docs/decisions.md`.

One this assessment adds specifically: **how the public-facing identifier is
generated** (UUID v4, nanoid, a custom slug, etc.) is a real decision under
this protocol — do not default to any particular scheme without presenting
the choice.

## Documentation duty

Same split as every assessment: you may draft Section 2 (How To Run It) and
Section 3 (The Flow, Step By Step). Section 4's schema/column notes are
yours to draft, but "which constraints make an invalid state impossible" is
mine. Sections 1, 5, 6, 7, 8, and the LinkedIn post are mine — remind me once
if asked to write them, then respect my decision.

## Code standards

Same as every assessment: one-line header comment per new file, shared
validation declared once, no magic numbers outside a config module, name
things so the brief's vocabulary is visible in the code.

## Testing and honesty

Do not test access control with one user account — that tests nothing, per
the brief's own trap list. Every claim of "this route is secure" needs the
second-user attack actually run against it, not just a code read-through.