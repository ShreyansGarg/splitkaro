import { useEffect, useState } from 'react';
import {
  collection,
  addDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/services/firebase';
import { useAuth } from '@/contexts/AuthContext';
import type { Comment, User } from '@/types';

interface Props {
  expenseId: string;
  members: Record<string, User>;
}

export default function Comments({ expenseId, members }: Props) {
  const { user } = useAuth();
  const [comments, setComments] = useState<Comment[]>([]);
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const q = query(
      collection(db, `expenses/${expenseId}/comments`),
      orderBy('createdAt', 'asc')
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setComments(
          snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Comment)
        );
      },
      (err) => console.error('Comments error:', err)
    );
    return unsub;
  }, [expenseId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || !user) return;

    setSubmitting(true);
    try {
      await addDoc(collection(db, `expenses/${expenseId}/comments`), {
        text: trimmed,
        userId: user.uid,
        createdAt: serverTimestamp(),
      });
      setText('');
    } catch (err) {
      console.error('Failed to add comment:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const memberName = (uid: string) => {
    if (uid === user?.uid) return 'You';
    return members[uid]?.displayName || uid.slice(0, 8) + '...';
  };

  const timeAgo = (timestamp: { seconds: number } | null) => {
    if (!timestamp) return 'just now';
    const seconds = Math.floor(Date.now() / 1000 - timestamp.seconds);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  };

  return (
    <div className="mt-3 border-t pt-3">
      {comments.length > 0 && (
        <div className="mb-3 space-y-2">
          {comments.map((c) => (
            <div key={c.id} className="flex gap-2">
              {members[c.userId]?.photoURL ? (
                <img
                  src={members[c.userId]!.photoURL!}
                  alt=""
                  className="h-6 w-6 flex-shrink-0 rounded-full mt-0.5"
                />
              ) : (
                <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs mt-0.5">
                  {memberName(c.userId)[0]!.toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-medium">
                    {memberName(c.userId)}
                  </span>
                  <span className="text-xs text-gray-400">
                    {timeAgo(c.createdAt as unknown as { seconds: number })}
                  </span>
                </div>
                <p className="text-sm text-gray-700 break-words">{c.text}</p>
              </div>
            </div>
          ))}
        </div>
      )}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a comment..."
          className="flex-1 rounded-lg border px-3 py-1.5 text-sm focus:border-primary-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={submitting || !text.trim()}
          className="rounded-lg bg-primary-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-50"
        >
          Post
        </button>
      </form>
    </div>
  );
}
