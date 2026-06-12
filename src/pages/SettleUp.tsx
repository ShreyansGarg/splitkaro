import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  doc,
  collection,
  addDoc,
  onSnapshot,
  getDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/services/firebase';
import { useAuth } from '@/contexts/AuthContext';
import type { Group, Balance } from '@/types';
import { simplifyDebts } from '@/utils/debtSimplification';
import { formatCurrency } from '@/utils/splits';

export default function SettleUp() {
  const { id: groupId } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [group, setGroup] = useState<Group | null>(null);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [settling, setSettling] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!groupId) return;

    getDoc(doc(db, 'groups', groupId)).then((snap) => {
      if (snap.exists()) {
        setGroup({ id: snap.id, ...snap.data() } as Group);
      }
    });

    const unsubscribe = onSnapshot(
      collection(db, `groups/${groupId}/balances`),
      (snap) => {
        setBalances(snap.docs.map((d) => d.data() as Balance));
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [groupId]);

  const settlements = simplifyDebts(balances);
  const mySettlements = settlements.filter(
    (s) => s.from === user?.uid || s.to === user?.uid
  );

  const handleSettle = async (toUserId: string, amount: number) => {
    if (!user || !groupId) return;
    setSettling(toUserId);
    try {
      await addDoc(collection(db, 'settlements'), {
        groupId,
        fromUserId: user.uid,
        toUserId,
        amount,
        method: 'cash',
        createdBy: user.uid,
        createdAt: serverTimestamp(),
      });
      alert('Settlement recorded!');
    } catch (err) {
      console.error('Failed to settle:', err);
      alert('Failed to record settlement');
    } finally {
      setSettling(null);
    }
  };

  if (loading) {
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
            &larr; Back to {group?.name}
          </Link>
          <h1 className="text-xl font-bold">Settle Up</h1>
        </div>
      </header>

      <main className="mx-auto max-w-lg px-4 py-6">
        {mySettlements.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-gray-200 p-8 text-center">
            <p className="text-lg font-medium text-green-600">
              All settled up!
            </p>
            <p className="mt-1 text-sm text-gray-500">
              No outstanding balances
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {mySettlements.map((s, i) => {
              const iOwe = s.from === user?.uid;
              return (
                <div
                  key={i}
                  className="rounded-xl bg-white p-4 shadow-sm"
                >
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-600">
                        {iOwe
                          ? `You owe ${s.to.slice(0, 12)}...`
                          : `${s.from.slice(0, 12)}... owes you`}
                      </p>
                      <p
                        className={`text-lg font-bold ${
                          iOwe ? 'text-red-600' : 'text-green-600'
                        }`}
                      >
                        {formatCurrency(s.amount)}
                      </p>
                    </div>
                  </div>
                  {iOwe && (
                    <button
                      onClick={() => handleSettle(s.to, s.amount)}
                      disabled={settling === s.to}
                      className="w-full rounded-lg bg-primary-500 py-2 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-50"
                    >
                      {settling === s.to
                        ? 'Recording...'
                        : `Record ${formatCurrency(s.amount)} Payment`}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
