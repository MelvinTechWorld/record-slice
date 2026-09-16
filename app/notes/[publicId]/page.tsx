// app/notes/[publicId]/page.tsx
//
// The detail screen. Fetches one note by its public identifier — a real,
// separate, bookmarkable URL, never the note's raw database id. Deletion
// requires a confirmation step before the request fires.

'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface Note {
  publicId: string;
  title: string;
  body: string;
  createdAt: string;
}

export default function NoteDetailPage({
  params,
}: {
  params: Promise<{ publicId: string }>;
}) {
  const { publicId } = use(params);
  const router = useRouter();
  const [note, setNote] = useState<Note | null>(null);
  const [error, setError] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    async function load() {
      const res = await fetch(`/api/notes/${publicId}`);
      if (!res.ok) {
        const body = await res.json();
        setError(body.error || 'Failed to load note');
        return;
      }
      const data = await res.json();
      setNote(data.note);
    }
    load();
  }, [publicId]);

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/notes/${publicId}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json();
        setError(body.error || 'Failed to delete note');
        setIsDeleting(false);
        return;
      }
      router.push('/notes');
    } catch {
      setError('An unexpected error occurred.');
      setIsDeleting(false);
    }
  };

  if (error) {
    return (
      <div className="max-w-2xl mx-auto mt-12 p-6">
        <p className="text-red-600 mb-4">{error}</p>
        <Link href="/notes" className="text-blue-600 hover:underline">
          Back to notes
        </Link>
      </div>
    );
  }

  if (!note) {
    return (
      <div className="max-w-2xl mx-auto mt-12 p-6 text-gray-500">
        Loading...
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto mt-12 p-6">
      <Link href="/notes" className="text-blue-600 hover:underline text-sm">
        ← Back to notes
      </Link>

      <h1 className="text-2xl font-bold mt-4 mb-2">{note.title}</h1>
      <p className="text-xs text-gray-500 mb-4">
        {new Date(note.createdAt).toLocaleString()}
      </p>
      <p className="whitespace-pre-wrap mb-6">{note.body}</p>

      {!confirmingDelete ? (
        <button
          onClick={() => setConfirmingDelete(true)}
          className="py-2 px-4 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded"
        >
          Delete note
        </button>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-red-700">
            Delete this note? This cannot be undone.
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleDelete}
              disabled={isDeleting}
              className="py-2 px-4 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white text-sm font-medium rounded"
            >
              {isDeleting ? 'Deleting...' : 'Confirm delete'}
            </button>
            <button
              onClick={() => setConfirmingDelete(false)}
              disabled={isDeleting}
              className="py-2 px-4 border text-sm font-medium rounded"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
