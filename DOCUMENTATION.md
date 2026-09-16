# The Records and Access Slice — Documentation

## 1. What This Is

This slice lets a signed-in user create short notes, see a list of their own, open one to read the full content, and delete it — with the deletion permanently recorded in an audit trail. The core of what's actually being tested isn't the notes themselves; it's that no user can ever reach another user's notes, by any route, however the request is made — every query is scoped to the logged-in user at the database level, and the URL never contains the note's real internal identifier, only a separately generated public one.

Deliberately not included: no editing a note once created, no search, no tags, no sharing between users, and no account system beyond signing in — authentication is reused as-is from Assessment 1 rather than rebuilt. These are left out because the brief's own scope is create, list, view, delete, and nothing more — the domain (notes, here) doesn't matter to the grade; the ownership and access control around it does.

## 2. How To Run It

**Prerequisites**

- Node.js 20 or later (this repo uses Next.js 16, React 19, and TypeScript 5)
- A PostgreSQL database (local or hosted — the repo was developed against Neon)
- `npm` as the package manager

**Steps**

1. Clone the repository and `cd` into it.
2. Copy `.env.example` to `.env`:

   **Windows:**
   ```bash
   copy .env.example .env
   ```

   **macOS/Linux:**
   ```bash
   cp .env.example .env
   ```
3. Open `.env` and fill in the real values **by hand** — never let a tool write secrets into this file. The variables are listed below.
4. Install dependencies:
   ```bash
   npm install
   ```
5. Generate the Prisma client and run migrations:
   ```bash
   npx prisma generate
   npx prisma migrate dev
   ```
6. Start the development server:
   ```bash
   npm run dev
   ```
   There is no separate worker process in this assessment — `npm run dev` is the only command needed.

**Environment variables**

`.env.example` exists in the repository with commented placeholders. Real keys must be typed in by hand.

| Name | Where it comes from | Referenced by |
|---|---|---|
| `DATABASE_URL` | Your PostgreSQL connection string — local or hosted provider's pooled URL | `prisma/schema.prisma` via `env("DATABASE_URL")` |
| `NODE_ENV` | Set to `"development"` locally; `"production"` in deployment | `lib/db.ts` (Prisma singleton caching), `app/api/auth/signin/route.ts` and `app/api/auth/verify/route.ts` (secure cookie flag) |

> `SESSION_SECRET` and `APP_URL` are declared in `.env.example` for future use (session signing, password-reset email links) but are **not currently referenced** anywhere in the codebase's `process.env` calls.

**Database setup**

```bash
npx prisma migrate dev
```

This creates the `User`, `Session`, `VerificationCode`, `PasswordResetToken`, `RateLimit`, `Note`, and `AuditLog` tables.

**Start it**

```bash
npm run dev
```

**It appears at:** `http://localhost:3000/notes` — this is the entry point for the slice's flow, after signing up and signing in at `/signup` and `/signin`.

## 3. The Flow, Step By Step

### Step 1 — Sign up and sign in

**User:** Navigates to `/signup` and submits an email, name, and password. After verifying their email at `/verify`, they sign in at `/signin`.

**Frontend sends:** `POST /api/auth/signup` with `{ email, name, password }`, then `POST /api/auth/verify` with the verification code, then `POST /api/auth/signin` with `{ email, password }`.

**Server does:** The signup route hashes the password with bcrypt, creates a `User` row and a `VerificationCode` row. The verify route checks the code, marks the user as verified, creates a `Session` row, and sets a `sessionId` cookie. The signin route verifies the password hash, creates a `Session` row, and sets the same cookie.

**Lives in:** `app/signup/page.tsx`, `app/verify/page.tsx`, `app/signin/page.tsx` (frontend); `app/api/auth/signup/route.ts`, `app/api/auth/verify/route.ts`, `app/api/auth/signin/route.ts` (server).

> The entire auth system — signup, signin, signout, verification, password reset, rate limiting, password hashing, session management — is **reused from Assessment 1**. The code was originally written against Prisma 8's release-candidate contract API (`db.orm.public.X.where().first()`); it was converted to Prisma 6's stable classic API (`prisma.user.findUnique(...)`) for this repo so it does not depend on pre-release behaviour. The conversion is a mechanical rewrite, not new logic.

### Step 2 — Create a note

**User:** On the `/notes` page, fills in a title and body in the form and clicks "Create note."

**Frontend sends:** `POST /api/notes` with `{ title, body }` as JSON.

**Server does:** `getCurrentUser()` in `lib/auth/session.ts` reads the `sessionId` cookie, looks up the session with an `include: { user: true }` relation — a single Prisma Client call, though as documented in Section 6, this did not reduce the underlying SQL to a single query — and returns the user, or `null`, which produces a `401`. The request body is validated against `createNoteSchema` from `lib/validations/notes.ts` (the same schema the client could use for instant feedback — declared once, per AGENTS.md). The server then calls `prisma.note.create()` with `userId: user.id` — the ownership is set at creation time. The response returns `{ publicId, title, createdAt }` — the internal database `id` is never included. The frontend clears the form and re-fetches the list.

**Lives in:** `app/notes/page.tsx` (frontend); `app/api/notes/route.ts` POST handler (server); `lib/validations/notes.ts` (shared schema).

### Step 3 — List notes

**User:** Visits `/notes` (or the page loads after creating/deleting a note).

**Frontend sends:** `GET /api/notes`.

**Server does:** After the same `getCurrentUser()` auth check, the server runs `prisma.note.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, select: { publicId, title, createdAt } })`. The query is scoped to the authenticated user **inside the query itself** — there is no code path where all notes are fetched and then filtered in application code. The internal `id` is not selected. The `@@index([userId, createdAt])` composite index on the `Note` table carries this exact query.

**Lives in:** `app/notes/page.tsx` (frontend); `app/api/notes/route.ts` GET handler (server).

### Step 4 — View one note

**User:** Clicks a note title in the list. The browser navigates to `/notes/{publicId}` — a real, separate, bookmarkable URL. Next.js's App Router transitions without a full page reload, which is what satisfies "conditional views with URL state" without any manual URL-syncing code.

**Frontend sends:** `GET /api/notes/{publicId}`.

**Server does:** After auth, the server runs `prisma.note.findFirst({ where: { publicId, userId: user.id } })` — both the `publicId` from the URL **and** the `userId` from the session are part of the query's `WHERE` clause. A note that exists but belongs to someone else is indistinguishable from a note that doesn't exist at all: both return `404 Not Found`. This is not 404-as-obscurity — the scoped query is what prevents the data leak, and 404 is the honest response for "no such note in your account."

**Lives in:** `app/notes/[publicId]/page.tsx` (frontend); `app/api/notes/[publicId]/route.ts` GET handler (server).

### Step 5 — Delete a note

**User:** On the detail page, clicks "Delete note." A confirmation prompt appears ("Delete this note? This cannot be undone."). The user clicks "Confirm delete."

**Frontend sends:** `DELETE /api/notes/{publicId}`.

**Server does:** After auth, the server looks up the note with `{ publicId, userId: user.id }` — same ownership-scoped query as view. If found, it runs a Prisma `$transaction` that does two things atomically: (1) creates an `AuditLog` row recording who deleted what (`userId`, `noteId`, `notePublicId`, `noteTitle`) and when (`deletedAt`), and (2) deletes the `Note` row. The transaction guarantees the audit log and the deletion either both happen or neither does — a crash between two separate calls would leave either a false audit record (claiming a deletion that didn't happen) or a silent deletion (with no trail), both of which are worse than a failed transaction that can be retried. After success, the frontend redirects to `/notes`.

**Lives in:** `app/notes/[publicId]/page.tsx` (frontend); `app/api/notes/[publicId]/route.ts` DELETE handler (server).

---

**Access control, summarised:** Every query that touches a Note is scoped to the authenticated user inside the query itself — `{ userId: user.id }` for list, `{ publicId, userId: user.id }` for view and delete. The client never sees or sends the Note's internal database `id`; it only ever works with the separately-generated `publicId`. A request without a valid session gets `401 Unauthorized`. A request with a valid session but targeting another user's note gets `404 Not Found` — not because the system is hiding the note's existence, but because the scoped query genuinely returns no row.

## 4. The Data Model

The auth tables — `User`, `Session`, `VerificationCode`, `PasswordResetToken`, `RateLimit` — are reused from Assessment 1 (same schema as Assessment 3, minus the Assessment 3-specific `Receipt` relation on `User`). They are not documented again here; see Assessment 1's documentation for their column-level decisions.

### `Note`

Holds a single user-created note with a title and body.

| Column | Type | Constraint | Decision |
|---|---|---|---|
| `id` | `String` (UUID v4) | `@id @default(uuid())` | The internal primary key. It exists for foreign-key integrity and for the server to identify the row in the `DELETE` query — but it **never leaves the server**. Not in URLs, not in API responses, not in hidden form fields. This is the assessment's core requirement: the raw database identifier is not the public-facing identifier. UUID v4 was chosen because the auth tables already use it (consistency within the schema) and Prisma generates it server-side. |
| `publicId` | `String` (CUID) | `@unique @default(cuid())` | The identifier exposed in URLs and the interface. A separate column rather than reusing `id` so the value the user sees is decoupled from the value the database uses internally — if the public identifier scheme ever needed to change (e.g. to a shorter slug), the primary key and all foreign-key references would be unaffected. CUID was chosen over UUID v4 for this column because CUIDs are shorter (25 chars vs 36), URL-friendlier (no hyphens), and monotonically-sortable, while still being collision-resistant enough for a single-database application. The `@unique` constraint ensures no two notes can share a public identifier, which would otherwise silently break the detail-page route. |
| `userId` | `String` | FK to `User.id`, `onDelete: Cascade` | The owner. Every query that reads or deletes a note includes `userId = session.user.id` in the `WHERE` clause — this is what makes cross-user access structurally impossible rather than merely unintended. `onDelete: Cascade` means deleting a user account removes all their notes, which is the expected behaviour (no orphaned notes belonging to a deleted account). |
| `title` | `String` | `NOT NULL` (Prisma default for non-optional fields) | Required, validated to 1–200 characters by the shared Zod schema in `lib/validations/notes.ts`. Not nullable because a note without a title has no meaningful display in the list view. |
| `body` | `String` | `NOT NULL` | Required, validated to 1–10,000 characters. Not nullable for the same reason — a note with no body is an empty record, not a valid note. |
| `createdAt` | `DateTime` | `@default(now())` | Set by the database at insertion time, not by application code — prevents a client from backdating a note. Used for `ORDER BY createdAt DESC` in the list query. |
| — | — | `@@index([userId, createdAt])` | Composite index. The list query is `WHERE userId = ? ORDER BY createdAt DESC` on every page load — this index carries that exact query without a sequential scan. `userId` is the leading column because equality filtering is more selective than range/sort. |

### `AuditLog`

Holds one row per deleted note — who deleted it, which note it was, and when. A permanent record that outlives the note itself.

| Column | Type | Constraint | Decision |
|---|---|---|---|
| `id` | `String` (UUID v4) | `@id @default(uuid())` | Standard surrogate primary key. |
| `userId` | `String` | **No foreign key** | Deliberately not a FK to `User.id`. An audit trail must survive even if the acting user's account is later deleted — a cascading delete on the FK would destroy the audit evidence of what that user did. The value is stored as plain data: a historical record, not a live relationship. |
| `noteId` | `String` | **No foreign key** | Deliberately not a FK to `Note.id`. The note row is deleted in the same transaction that creates this audit row — by the time anyone reads the audit log, the referenced note is gone. A live foreign key here is impossible (it would block the delete or cascade-delete the audit row, defeating the purpose). Stored as plain data so the internal identifier is preserved for any future forensic query. |
| `notePublicId` | `String` | `NOT NULL` | Snapshot of the note's public identifier at deletion time. Included so the audit trail is human-readable without needing to cross-reference internal IDs. |
| `noteTitle` | `String` | `NOT NULL` | Snapshot of the note's title at deletion time. Without this, the audit row would say "user X deleted note Y" with no indication of what note Y actually was — useless for a human reading the log after the fact. |
| `deletedAt` | `DateTime` | `@default(now())` | Set by the database, not application code. Records when the deletion happened, not when the audit row was inserted (though in practice they are the same, since both happen in a single transaction). |

### Which constraints make an invalid state impossible?

Note.publicId's @unique constraint makes it impossible for two notes to ever resolve to the same URL — without it, a collision (even a rare one) would mean the detail route could return the wrong note, or silently pick one of two matching rows. Note.userId's foreign key with onDelete: Cascade makes it impossible for a note to exist pointing at a user that no longer exists — an orphaned note with no real owner simply cannot happen at the database level, regardless of what application code does or forgets to do. Neither of AuditLog's two "identifier" columns (userId, noteId) has a foreign key at all, and that absence is itself the constraint doing real work: it makes it impossible for a cascading user or note deletion to also silently delete the audit trail of that same deletion — the audit row is guaranteed to survive exactly the event it's designed to outlive.

## 5. The Concepts

### Authentication vs Authorization

**What it is.** Authentication answers "who are you" — checking a session cookie proves the request comes from a real, logged-in user. Authorization answers a different question: "are you allowed to do this specific thing" — in this app, whether the note being requested actually belongs to the person asking.

**Why it is needed.** Without authorization checked separately from authentication, any logged-in user could reach any note just by knowing (or guessing) its identifier — being logged in would be treated as being allowed to see everything, which is wrong the moment more than one user exists.

**How I implemented it.** Authentication happens once, in `getCurrentUser()` (`lib/auth/session.ts`), called at the top of every route. Authorization happens separately and specifically, inside each Note query's `WHERE` clause (`{ publicId, userId: user.id }`) — the database itself is what enforces "this note belongs to this user," not a check written after the fact in application code.

**What I chose against, and why.** I could have authenticated the user, then fetched the note by `publicId` alone, then written an `if (note.userId !== user.id)` check afterward. I chose against that because it's a real, common bug pattern — it's easy to write the fetch, forget the check, or have someone else add a new route later and genuinely forget it exists. Scoping ownership into the query itself removes the possibility entirely rather than relying on every future route author remembering to add a check.

### Scoping the Query vs Checking After the Fetch

**What it is.** Scoping the query means the ownership condition (`userId = session.user.id`) is part of the SQL query that fetches the row. Checking after the fetch means fetching the row by its own identifier first, then comparing `note.userId` to the session user in a separate `if` statement.

**Why it is needed.** Without scoping, the database will happily hand back any row that matches the identifier, regardless of who owns it — the only thing standing between a user and someone else's data is a line of application code that has to be present, correct, and never accidentally deleted or refactored away.

**How I implemented it.** Every Note query in this repo — list, view, delete — includes `userId: user.id` directly in the Prisma `where` clause, alongside whatever other condition (`publicId`, etc.) applies. I verified this actually works by running real cross-user attacks (User B against User A's note) and confirming they failed — logged in `docs/evidence.md`.

**What I chose against, and why.** The alternative — fetch by `publicId` alone, then check `note.userId === user.id` afterward — is what the brief itself calls out as a trap for exactly this reason: it "works today and will be forgotten by whoever writes the next route." A query-scoped check can't be forgotten because it's not a separate step; it's part of the query that has to exist for the route to work at all.

### Insecure Direct Object References (IDOR)

**What it is.** An IDOR is what happens when an application exposes a raw internal identifier (like a database row's primary key) to the user, and doesn't properly check ownership when that identifier is used — so a user can simply edit the identifier in a URL to try reaching someone else's data.

**Why it is needed** [to defend against]. Without protection against this, an attacker doesn't need to break any encryption or guess a password — they just change one character in a URL and see what comes back. It's one of the most common real-world web vulnerabilities specifically because it's this easy to attempt.

**How I implemented it.** Two layers: first, the identifier in the URL (`publicId`) is never the database's real primary key (`id`) — so even a successful guess only reveals another random-looking string, not a sequential or predictable one. Second, and more importantly, even if an attacker somehow obtained a real `publicId` belonging to someone else, the query-scoping described above means it still returns `404`, because the query requires both the identifier and the correct `userId`.

**What I chose against, and why.** I could have relied on the `publicId` being hard to guess as the only protection (this is sometimes called "security through obscurity"). I chose against that on its own, because the brief is explicit that obscurity is not access control — a hard-to-guess identifier that leaked once (through a log file, a referrer header, a screenshot) would offer zero protection without the ownership check underneath it.

### Why Raw Database Identifiers Are Not Exposed

**What it is.** The `Note` table has two different identifier columns: `id`, the real primary key Prisma and Postgres use internally, and `publicId`, a separately generated value that's the only one ever sent to the browser.

**Why it is needed.** If the real primary key were used in URLs, two problems follow: it can leak information about scale or ordering if it's sequential, and — more importantly here — it becomes indistinguishable from "the value that protects this record," when the actual protection is the ownership check, not the identifier's secrecy.

**How I implemented it.** `Note.id` uses Prisma's default UUID generation and is never selected in any API response (`select: { publicId, title, createdAt }` explicitly excludes it). `Note.publicId` is a separately generated `cuid()`, unique-indexed, and it's the only identifier that ever appears in a URL or a JSON response.

**What I chose against, and why.** I considered just using a UUID as the primary key directly and treating that as "unguessable enough" to expose. I chose against it because that still means the URL literally contains the value Prisma uses to select the row — the brief's own hard rule is "no raw database identifiers in URLs," and a UUID primary key is still a raw database identifier, regardless of how hard it is to guess.

### Audit Logging and Why Deletions Are Recorded

**What it is.** Audit logging means keeping a permanent record of a significant action — here, specifically, every note deletion — separate from the data the action affected.

**Why it is needed.** Without it, once a note is deleted, there is no way to answer "did this happen, who did it, and when" — the evidence disappears along with the data itself, which matters if a user disputes a deletion, or if something needs investigating later.

**How I implemented it.** Every `DELETE` request creates an `AuditLog` row (`userId`, `noteId`, `notePublicId`, `noteTitle`, `deletedAt`) inside the same Prisma `$transaction` as the actual Note deletion — both happen together or neither does. `AuditLog` deliberately has no foreign keys to `User` or `Note`, because both of those rows might be gone by the time the log is read.

**What I chose against, and why.** I could have written the audit row and the delete as two separate sequential database calls. I chose the transaction instead because a crash between two separate calls could leave a log entry claiming a deletion happened when it didn't — a false audit record, which is worse than no record at all for something whose entire purpose is being trustworthy.

### Page Architecture: Conditional Rendering with URL State

**What it is.** This app shows the note list and note detail as what feels like a single smooth app — clicking a note doesn't trigger an obvious full-page reload — while every view still has its own real, distinct, bookmarkable URL (`/notes` and `/notes/{publicId}`).

**Why it is needed.** Without both properties together, you get one of two bad outcomes: a classic full-reload website (slow, clunky transitions) or a single-page app that "feels" fast but breaks the back button, breaks bookmarking, and can't be shared as a link to one specific note.

**How I implemented it.** I used Next.js's App Router as-is — `app/notes/page.tsx` and `app/notes/[publicId]/page.tsx` are two genuinely separate route files, linked with `<Link>`. Next.js handles the client-side transition and the URL update together, natively.

**What I chose against, and why.** I considered building this as one page component that manually toggled between list and detail state, syncing the URL by hand with `useRouter`. I chose against it because it recreates, by hand, something the framework already does correctly — and because I'd already hit a real bug in Assessment 3 from exactly this kind of manual state-and-URL synchronization going subtly wrong. Using the framework's native routing was both less code and a better answer to "why is this correct."

### Status Codes: 401 vs 403 (and Why This App Uses 404 Instead of 403)

**What it is.** `401 Unauthorized` means "I don't know who you are" — no valid session at all. `403 Forbidden` traditionally means "I know who you are, and you're not allowed to do this." `404 Not Found` means "there is nothing here."

**Why it is needed.** Using the wrong one blurs two very different situations into one response, which either confuses a legitimate client trying to handle errors correctly, or — worse — leaks information to an attacker about which situation they've hit.

**How I implemented it.** A request with no valid session gets `401`. A request with a valid session, but targeting a note that either doesn't exist or belongs to someone else, gets `404` — deliberately not `403`.

**What I chose against, and why.** I chose against `403` for the ownership-mismatch case specifically because returning `403` for "exists but isn't yours" and `404` for "doesn't exist at all" would let an attacker enumerate real note identifiers just by watching which status code comes back, even with the ownership check working perfectly underneath. Making both cases return identical `404`s means the response itself gives away nothing — this is the brief's own point about obscurity not being access control, applied to the status code rather than the identifier.

### Database Indexing

**What it is.** An index is a separate, ordered structure the database maintains alongside a table, letting it find matching rows without scanning every row in the table.

**Why it is needed.** Without an index on the columns a query filters or sorts by, every list request would force Postgres to read the entire `Note` table and check each row — fine at ten notes, a real cost once a table has thousands of rows across many users.

**How I implemented it.** `@@index([userId, createdAt])` on `Note`, matching the list query's actual shape (`WHERE userId = ? ORDER BY createdAt DESC`) exactly. `userId` is the leading column because it's the equality filter — the more selective condition — with `createdAt` after it to serve the sort without a separate step.

**What I chose against, and why.** I considered adding a similar index to `AuditLog` on `userId` or `noteId`, since that's the general instinct once you've added one index. I chose against it because nothing in this app currently queries `AuditLog` by those columns — there's no "view my deletion history" screen in scope. An index with no query to serve costs write overhead for zero read benefit; adding it defensively would have been decoration, not defense.

### Query Count as a Cost

**What it is.** Every database query costs real time — even a fast one adds a network round-trip — so the number of separate queries a single user action triggers is a real performance cost, not just an implementation detail.

**Why it is needed.** Without measuring it, a route can silently accumulate unnecessary queries as it grows, and the cost compounds — a route quietly doing five queries where two would do adds real, measurable latency at scale, invisible until you actually count.

**How I implemented it.** I temporarily enabled Prisma's query logging (`log: ['query']` in `lib/db.ts`) and counted queries per action directly from the terminal output: create and list each run 3 queries (2 for auth resolution via `getCurrentUser()`, 1 for the action itself); delete runs 7 (2 for auth, then 5 for the ownership check, the transaction's `BEGIN`, the two writes, and its `COMMIT`).

**What I chose against, and why.** I attempted an optimization: collapsing the two sequential auth queries (Session, then User) into one Prisma call using `include: { user: true }`. I measured the result rather than assuming it worked, and found the query count didn't actually change — Prisma's query engine still issued two separate SQL statements under the hood for this relation shape. I chose not to force a true single query via raw SQL, because the gain (one fewer query, a few milliseconds) didn't justify losing Prisma's type safety on a function every route depends on, given the time remaining in the assessment. I kept the `include` version anyway since it's still cleaner code, and documented the real, unchanged number rather than the one I expected.

## 6. What Went Wrong

### Problem 1: Migration failing with `P1001`: Can't reach database server

**The symptom.** Running `npx prisma migrate dev --name init` against a brand-new Neon project returned `Error: P1001: Can't reach database server at ep-rough-block-b4xb68cz.c-6.us-east-2.aws.neon.tech:5432`, even though the Neon dashboard showed the project as active.

**The investigation.** I checked the connection string's structure against a working one from a previous assessment — format matched, `sslmode=require` was present. I checked the Neon dashboard directly to rule out a suspended compute, which is the most common cause of this error on the free tier — the project showed active.

**The cause.** The connection string I'd originally copied and pasted into `.env` was stale, even though it looked structurally correct.

**The fix.** Went back into Neon's Connect dialog and copied a completely fresh connection string, replacing the one in `.env`. The retry succeeded immediately.

### Problem 2: An attempted query-count optimization silently didn't work

**The symptom.** After adding `include: { user: true }` to the session lookup in `getCurrentUser()`, expecting it to collapse two separate queries into one, the query log still showed two distinct `SELECT` statements.

**The investigation.** I re-enabled Prisma's query logging and re-ran the list action specifically to check whether the change had actually taken effect, rather than assuming a code change that looked correct had produced the expected result.

**The cause.** Prisma's query engine doesn't always compile a relation include into a single SQL `JOIN` — for this relation shape, it still issued two separate queries to Postgres and merged the results in application memory. One Prisma Client call is not the same guarantee as one database round-trip.

**The fix.** I chose not to chase a forced single query via raw SQL, given the small gain against the cost of losing type safety on a function every route depends on. I kept the cleaner include code, but corrected the documentation to report the real, unchanged query count instead of the number I'd expected before measuring.

### Problem 3: [fill in a real one from your own experience — the folder/OneDrive mixup while setting up the repo is a strong candidate, since it's genuinely something that happened and cost real time]

Draft, if you want to use that one:

**The symptom.** Antigravity's Explorer showed the records-slice project folder as completely empty immediately after `create-next-app` reported success, and a `dir` command in the terminal returned "File Not Found" for the same folder.

**The investigation.** I checked whether the scaffold had genuinely failed despite the success message, by running `dir` on the parent Desktop folder directly.

**The cause.** Windows had two separate "Desktop" locations — a local one and a OneDrive-synced one — and the terminal I was typing into was pointed at the empty OneDrive one, while the scaffold had actually succeeded on the plain local Desktop moments earlier in a different terminal window.

**The fix.** Confirmed the real location with `dir`, then reopened Antigravity pointed explicitly at the correct path (`C:\Users\HP\Desktop\record-slice`, not the OneDrive one), and continued from there.

## 7. What This Slice Does Not Handle

**What breaks at scale.** The Note list query is efficient for one user's notes, but there's no pagination — a user with thousands of notes would load them all in a single response. The composite index keeps the query itself fast, but the response payload would grow unbounded.

**What would need adding before real users touched it.** Rate limiting exists on the reused auth routes (from Assessment 1) but not on the Note routes themselves — this brief's engineering requirements don't list it as required, but a real deployment would want it on create at minimum, to prevent one account from flooding the database with notes. There's also no soft-delete or recovery window — the confirmation dialog is the only protection against an accidental deletion; once confirmed, it's genuinely gone (the `AuditLog` records that it happened, but doesn't let it be undone).

**What was left out because it was outside the brief.** No editing, search, tags, or sharing — the brief explicitly asks for create/list/view/delete only, nothing more.

**What was left out because of time, not scope.** [Be honest — if there's something you wanted but didn't get to, say it here; otherwise: "Nothing — everything attempted was completed."]

## 8. If I Built This Again

If I built this again, the biggest thing I'd change is measuring before optimizing, across the board, not just for the one query-count case I happened to catch. I went into the getCurrentUser() change assuming include would obviously collapse two queries into one, and only found out it hadn't because I'd already set up query logging for a different reason. If I'd made that a habit from the start — measure first, then change, then measure again — I'd trust every performance claim in this documentation the same way, rather than having one section that's rigorously verified and the rest resting on reasonable-sounding assumptions I didn't actually check.
