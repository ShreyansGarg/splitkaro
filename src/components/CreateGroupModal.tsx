import { useState } from 'react';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/services/firebase';
import { useAuth } from '@/contexts/AuthContext';

const EMOJIS = ['👥', '🏠', '✈️', '🍕', '🎉', '💼', '🏖️', '🎮'];

interface Props {
  onClose: () => void;
}

export default function CreateGroupModal({ onClose }: Props) {
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('👥');
  const [emailInput, setEmailInput] = useState('');
  const [emails, setEmails] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const addEmail = () => {
    const trimmed = emailInput.trim().toLowerCase();
    if (trimmed && trimmed.includes('@') && !emails.includes(trimmed)) {
      setEmails([...emails, trimmed]);
      setEmailInput('');
    }
  };

  const removeEmail = (email: string) => {
    setEmails(emails.filter((e) => e !== email));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !name) return;

    setSubmitting(true);
    try {
      await addDoc(collection(db, 'groups'), {
        name,
        emoji,
        memberIds: [user.uid],
        pendingEmails: emails,
        adminIds: [user.uid],
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      onClose();
    } catch (err) {
      console.error('Failed to create group:', err);
      alert('Failed to create group');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="w-full max-w-md rounded-t-2xl bg-white p-6 shadow-xl sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">Create Group</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">
              Group Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="e.g., Roommates, Trip to Goa"
              className="w-full rounded-lg border px-3 py-2 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Icon</label>
            <div className="flex gap-2">
              {EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => setEmoji(e)}
                  className={`rounded-lg p-2 text-xl ${
                    emoji === e ? 'bg-primary-100 ring-2 ring-primary-500' : 'hover:bg-gray-100'
                  }`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">
              Invite Friends (by email)
            </label>
            <div className="flex gap-2">
              <input
                type="email"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addEmail();
                  }
                }}
                placeholder="friend@example.com"
                className="flex-1 rounded-lg border px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={addEmail}
                className="rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium hover:bg-gray-200"
              >
                Add
              </button>
            </div>
            {emails.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {emails.map((email) => (
                  <span
                    key={email}
                    className="inline-flex items-center gap-1 rounded-full bg-primary-50 px-3 py-1 text-xs text-primary-700"
                  >
                    {email}
                    <button
                      type="button"
                      onClick={() => removeEmail(email)}
                      className="hover:text-red-500"
                    >
                      &times;
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={submitting || !name}
            className="w-full rounded-lg bg-primary-500 py-3 font-medium text-white hover:bg-primary-600 disabled:opacity-50"
          >
            {submitting ? 'Creating...' : 'Create Group'}
          </button>
        </form>
      </div>
    </div>
  );
}
