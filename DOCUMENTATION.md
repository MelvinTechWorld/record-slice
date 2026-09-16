# The Records and Access Slice — Documentation

## 1. What This Is

<!-- I write this myself. -->

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

<!-- I answer this myself. -->

## 5. The Concepts

<!-- I write this myself. -->

## 6. What Went Wrong

<!-- I write this myself. -->

## 7. What This Slice Does Not Handle

<!-- I write this myself. -->

## 8. If I Built This Again

<!-- I write this myself. -->

---

## LinkedIn Post

<!-- I write this myself. -->