# Evidence Log

Every piece of captured proof required by the brief, logged when captured.

**Why this file exists:** the briefs require database screenshots, curl output,
and measurement tables that cannot be reconstructed after the fact. Assessment 2
states outright that *claims without screenshots do not count*. Assessment 4's
baseline query counts are gone forever once the code is optimised.

**Where files go:** `/evidence/` in the repository root. Reference them from
`DOCUMENTATION.md` with relative paths so they render on GitHub.

**Naming:** `NN-short-description.png` — e.g. `01-users-table-hash.png`. Number
them in the order the brief lists them so a reviewer can follow along.

---

## Captured

| # | File | What it shows | Which requirement it satisfies | Date |
|---|---|---|---|---|
| 01 | `01-audit-attacks-view-and-delete.png` | curl output: User B attempting to GET and DELETE User A's note directly by publicId, both returning 404 | Access control audit — attempted breach of view and delete routes | 16 Sep 2026 |
| 02 | `02-audit-attacks-list-leak-check.png` | curl output: User B listing their own notes (`GET /api/notes`), confirming User A's note does not appear | Access control audit — attempted breach of the list route | 16 Sep 2026 |
| 03 | `03-audit-attacks-owner-and-unauthenticated.png` | curl output: User A (the real owner) successfully fetching their own note (200), and an unauthenticated request to the same route (401) | Access control audit — sanity check that ownership enforcement doesn't over-block the real owner, and confirms 401 vs 404 are used for their distinct meanings | 16 Sep 2026 |
| 04 | `04-note-survives-delete-attempt.png` | Note table row still present after User B's delete attempt, with matching id/publicId/userId | Access control audit — confirms the blocked delete attempt (file 01) had no actual side effect, not just a blocked response | 16 Sep 2026 |

---

## Access control audit table

Two test users created. User A owns a note (`cmu4msyyo0003tzvcyo6ck037`).
User B attempted to reach it by every route, by identifier, and by direct
curl call.

| # | Method | Path | What was attempted | What happened | Pass/Fail |
|---|---|---|---|---|---|
| 1 | GET | `/api/notes/{publicId}` | User B fetched User A's note directly by its public identifier | `404 Not Found` | PASS |
| 2 | DELETE | `/api/notes/{publicId}` | User B attempted to delete User A's note directly | `404 Not Found`; note confirmed still present in the database afterward (see file 04) | PASS |
| 3 | GET | `/api/notes` | User B listed their own notes, checking whether User A's note appeared | `200 OK`, empty array — User A's note did not leak | PASS |
| 4 | GET | `/api/notes/{publicId}` | User A (the real owner) fetched their