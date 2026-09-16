# record-slice — Records and Access Slice

A single working flow: create, list, view, and delete personal notes — built
so that no user can ever reach another user's data, by any route, however
the request is made.

Built as Assessment 4 of a Product Engineering Bootcamp. Authentication is
reused from Assessment 1 (see `DOCUMENTATION.md`, Section 1).

**Full documentation, including setup, the data model, the access control
audit table, and the concepts behind every engineering decision, is in
[`DOCUMENTATION.md`](./DOCUMENTATION.md).**

## Quick start

```bash
npm install
copy .env.example .env   # Windows — use `cp` on macOS/Linux; fill in real values by hand
npx prisma generate
npx prisma migrate dev
npm run dev
```

Open [http://localhost:3000/notes](http://localhost:3000/notes) to start
the flow. Sign up first at `/signup`.

## Stack

Next.js · TypeScript · Prisma · PostgreSQL