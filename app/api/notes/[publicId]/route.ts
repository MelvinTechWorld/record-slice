// app/api/notes/[publicId]/route.ts
//
// GET fetches one note by its public identifier. DELETE removes it and
// writes an AuditLog row in the same database transaction, so the log
// entry and the deletion either both happen or neither does.
//
// Every query here is scoped to { publicId, userId: user.id } together —
// a note that exists but belongs to someone else is indistinguishable
// from a note that doesn't exist at all. This returns 404, not 403,
// deliberately: per the brief, "obscurity is not access control" — the
// scoped query is what prevents the leak, and 404 here is the honest
// response for "no such note in your account," not an attempt to hide
// anything through the status code itself.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth/session';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ publicId: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { publicId } = await params;

  const note = await prisma.note.findFirst({
    where: { publicId, userId: user.id },
    select: {
      publicId: true,
      title: true,
      body: true,
      createdAt: true,
    },
  });

  if (!note) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ note });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ publicId: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { publicId } = await params;

  const note = await prisma.note.findFirst({
    where: { publicId, userId: user.id },
  });

  if (!note) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Transaction: the audit row is written and the note is deleted
  // together, or neither happens. Prevents a log entry that claims a
  // deletion occurred when a crash between two separate calls left the
  // note untouched — a false audit record is worse than none.
  await prisma.$transaction([
    prisma.auditLog.create({
      data: {
        userId: user.id,
        noteId: note.id,
        notePublicId: note.publicId,
        noteTitle: note.title,
      },
    }),
    prisma.note.delete({
      where: { id: note.id },
    }),
  ]);

  return NextResponse.json({ message: 'Note deleted' }, { status: 200 });
}
