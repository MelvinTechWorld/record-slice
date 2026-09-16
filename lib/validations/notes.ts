// lib/validations/notes.ts
//
// Declared once, imported by both the client form and every server route
// that touches a Note — per AGENTS.md: "Validation rules are declared
// once... and imported by both client and server."

import { z } from 'zod';

export const createNoteSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title is too long'),
  body: z.string().min(1, 'Body is required').max(10000, 'Body is too long'),
});

export type CreateNoteInput = z.infer<typeof createNoteSchema>;
