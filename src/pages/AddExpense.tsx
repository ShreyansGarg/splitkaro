import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  doc,
  collection,
  addDoc,
  getDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { db } from '@/services/firebase';
import { useAuth } from '@/contexts/AuthContext';
import type { Group, ExpenseCategory, SplitType } from '@/types';
import { splitEqual, splitByPercentage, dollarsToCents, formatCurrency } from '@/utils/splits';

const CATEGORIES: { value: ExpenseCategory; label: string }[] = [
  { value: 'food', label: 'Food' },
  { value: 'transport', label: 'Transport' },
  { value: 'shopping', label: 'Shopping' },
  { value: 'entertainment', label: 'Entertainment' },
  { value: 'rent', label: 'Rent' },
  { value: 'utilities', label: 'Utilities' },
  { value: 'groceries', label: 'Groceries' },
  { value: 'travel', label: 'Travel' },
  { value: 'other', label: 'Other' },
];

export default function AddExpense() {
  const { id: groupId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [group, setGroup] = useState<Group | null>(null);
  const [description, setDescription] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>('other');
  const [splitType, setSplitType] = useState<SplitType>('equal');
  const [customSplits, setCustomSplits] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!groupId) return;
    getDoc(doc(db, 'groups', groupId)).then((snap) => {
      if (snap.exists()) {
        setGroup({ id: snap.id, ...snap.data() } as Group);
      }
    });
  }, [groupId]);

  const amountCents = dollarsToCents(parseFloat(amountStr) || 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !groupId || !group || amountCents <= 0) return;

    setSubmitting(true);
    try {
      let splits: Record<string, number>;

      if (splitType === 'equal') {
        splits = splitEqual(amountCents, group.memberIds);
      } else if (splitType === 'percentage') {
        const percentages: Record<string, number> = {};
        for (const uid of group.memberIds) {
          percentages[uid] = parseFloat(customSplits[uid] || '0');
        }
        splits = splitByPercentage(amountCents, percentages);
      } else {
        splits = {};
        for (const uid of group.memberIds) {
          splits[uid] = dollarsToCents(parseFloat(customSplits[uid] || '0'));
        }
        const sum = Object.values(splits).reduce((a, b) => a + b, 0);
        if (sum !== amountCents) {
          alert(
            `Splits sum to ${formatCurrency(sum)} but total is ${formatCurrency(amountCents)}`
          );
          setSubmitting(false);
          return;
        }
      }

      await addDoc(collection(db, 'expenses'), {
        groupId,
        description,
        amount: amountCents,
        currency: 'USD',
        category,
        paidBy: user.uid,
        splitType,
        splits,
        date: Timestamp.now(),
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      navigate(`/group/${groupId}`);
    } catch (err) {
      console.error('Failed to add expense:', err);
      alert('Failed to add expense');
    } finally {
      setSubmitting(false);
    }
  };

  if (!group) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white px-4 py-4">
        <div className="mx-auto max-w-lg">
          <Link
            to={`/group/${groupId}`}
            className="mb-2 inline-block text-sm text-primary-600"
          >
            &larr; Back to {group.name}
          </Link>
          <h1 className="text-xl font-bold">Add Expense</h1>
        </div>
      </header>

      <main className="mx-auto max-w-lg px-4 py-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">
              Description
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              placeholder="What was it for?"
              className="w-full rounded-lg border px-3 py-2 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Amount</label>
            <div className="relative">
              <span className="absolute left-3 top-2 text-gray-500">$</span>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                required
                placeholder="0.00"
                className="w-full rounded-lg border py-2 pl-7 pr-3 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
              className="w-full rounded-lg border px-3 py-2 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">
              Split Type
            </label>
            <div className="flex gap-2">
              {(['equal', 'unequal', 'percentage'] as SplitType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setSplitType(t)}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium capitalize transition-colors ${
                    splitType === t
                      ? 'border-primary-500 bg-primary-50 text-primary-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {splitType === 'equal' && amountCents > 0 && (
            <div className="rounded-lg bg-gray-100 p-3">
              <p className="text-sm text-gray-600">
                {formatCurrency(
                  Math.floor(amountCents / group.memberIds.length)
                )}{' '}
                per person
              </p>
            </div>
          )}

          {splitType !== 'equal' && (
            <div className="space-y-2">
              {group.memberIds.map((uid) => (
                <div key={uid} className="flex items-center gap-3">
                  <span className="flex-1 text-sm">
                    {uid === user?.uid ? 'You' : uid.slice(0, 12) + '...'}
                  </span>
                  <div className="relative w-28">
                    <span className="absolute left-2 top-2 text-xs text-gray-500">
                      {splitType === 'percentage' ? '%' : '$'}
                    </span>
                    <input
                      type="number"
                      step={splitType === 'percentage' ? '0.01' : '0.01'}
                      value={customSplits[uid] || ''}
                      onChange={(e) =>
                        setCustomSplits((prev) => ({
                          ...prev,
                          [uid]: e.target.value,
                        }))
                      }
                      className="w-full rounded-lg border py-2 pl-6 pr-2 text-right text-sm focus:border-primary-500 focus:outline-none"
                    />
                  </div>
                </div>
              ))}
              {splitType === 'unequal' && (
                <p className="text-xs text-gray-500">
                  Remaining:{' '}
                  {formatCurrency(
                    amountCents -
                      Object.values(customSplits).reduce(
                        (sum, v) => sum + dollarsToCents(parseFloat(v) || 0),
                        0
                      )
                  )}
                </p>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || !description || amountCents <= 0}
            className="w-full rounded-lg bg-primary-500 py-3 font-medium text-white shadow-sm hover:bg-primary-600 disabled:opacity-50"
          >
            {submitting ? 'Adding...' : 'Add Expense'}
          </button>
        </form>
      </main>
    </div>
  );
}
