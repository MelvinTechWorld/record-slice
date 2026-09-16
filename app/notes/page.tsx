// app/notes/page.tsx
//
// The list screen. Fetches the authenticated user's own notes (scoped
// server-side in the API route, not filtered here) and renders a create
// form plus the list. Each note links to /notes/[publicId] — a real,
// separate, bookmarkable route that Next.js's App Router transitions to
// without a full page reload, which is what gives "conditional views
// with URL state" without any manual URL-syncing code.

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface NoteSummary {
  publicId: string;
  title: string;
  createdAt: string;
}

export default function NotesListPage() {
  const [notes, setNotes] = useState<NoteSummary[] | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadNotes = async () => {
    const res = await fetch('/api/notes');
    if (res.ok) {
      const data = await res.json();
      setNotes(data.notes);
    } else {
      setError('Failed to load notes');
    }
  };

  useEffect(() => {
    loadNotes();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, body }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to create note');
        return;
      }

      setTitle('');
      setBody('');
      await loadNotes();
    } catch {
      setError('An unexpected error occurred.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto mt-12 p-6">
      <h1 className="text-2xl font-bold mb-6">Notes</h1>

      {error && (
        <div className="mb-4 p-3 bg-red-100 text-red-700 rounded text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleCreate} className="mb-8 space-y-3 border rounded p-4">
        <div>
          <label htmlFor="title" className="block text-sm font-medium mb-1">
            Title
          </label>
          <input
            id="title"
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full p-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-transparent"
          />
        </div>
        <div>
          <label htmlFor="body" className="block text-sm font-medium mb-1">
            Body
          </label>
          <textarea
            id="body"
            required
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="w-full p-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-transparent"
          />
        </div>
        <button
          type="submit"
          disabled={isSubmitting}
          className="py-2 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium rounded"
        >
          {isSubmitting ? 'Creating...' : 'Create note'}
        </button>
      </form>

      {notes === null && <p className="text-gray-500">Loading...</p>}

      {notes !== null && notes.length === 0 && (
        <p className="text-gray-500">No notes yet.</p>
      )}

      {notes !== null && notes.length > 0 && (
        <ul className="space-y-2">
          {notes.map((note) => (
            <li key={note.publicId} className="border rounded p-3">
              <Link
                href={`/notes/${note.publicId}`}
                className="text-blue-600 hover:underline font-medium"
              >
                {note.title}
              </Link>
              <p className="text-xs text-gray-500 mt-1">
                {new Date(note.createdAt).toLocaleString()}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
