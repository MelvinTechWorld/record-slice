// app/api/notes/route.ts
//
// POST creates a note. GET lists the authenticated user's own notes.
// Both queries are scoped to the session user inside the query itself —
// never a fetch followed by an application-code ownership check.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth/session';
import { createNoteSchema } from '@/lib/validations/notes';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const parsed = createNoteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const note = await prisma.note.create({
    data: {
      userId: user.id,
      title: parsed.data.title,
      body: parsed.data.body,
    },
  });

  // publicId, never the internal id, is what the client ever sees.
  return NextResponse.json(
    { publicId: note.publicId, title: note.title, createdAt: note.createdAt },
    { status: 201 }
  );
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Scoped to the authenticated user inside the query itself — this is
  // what makes a cross-user leak structurally impossible rather than
  // merely unintended. Never fetch all notes and filter afterward.
  const notes = await prisma.note.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    select: {
      publicId: true,
      title: true,
      createdAt: true,
      // id (the internal PK) is deliberately not selected here — it
      // never needs to leave the server for this route.
    },
  });

  return NextResponse.json({ notes });
}
