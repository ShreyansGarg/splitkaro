import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  collection,
  query,
  where,
  onSnapshot,
  getDoc,
  doc,
} from 'firebase/firestore';
import { db } from '@/services/firebase';
import { useAuth } from '@/contexts/AuthContext';
import type { Group, Balance, User } from '@/types';
import { formatCurrency } from '@/utils/splits';
import { simplifyDebts } from '@/utils/debtSimplification';

interface DebtSummary {
  uid: string;
  amount: number;
  groups: { groupId: string; groupName: string; amount: number }[];
}

export default function Summary() {
  const { user, signOut } = useAuth();
  const [groups, setGroups] = useState<Group[]>([]);
  const [balancesByGroup, setBalancesByGroup] = useState<
    Record<string, Balance[]>
  >({});
  const [users, setUsers] = useState<Record<string, User>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'groups'),
      where('memberIds', 'array-contains', user.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const groupList = snapshot.docs.map(
        (d) => ({ id: d.id, ...d.data() }) as Group
      );
      setGroups(groupList);
      setLoading(false);
    });

    return unsubscribe;
  }, [user]);

  useEffect(() => {
    if (groups.length === 0) return;

    const unsubs: (() => void)[] = [];
    const allMemberIds = new Set<string>();

    for (const group of groups) {
      group.memberIds.forEach((uid) => allMemberIds.add(uid));

      const unsub = onSnapshot(
        collection(db, `groups/${group.id}/balances`),
        (snap) => {
          setBalancesByGroup((prev) => ({
            ...prev,
            [group.id]: snap.docs.map((d) => d.data() as Balance),
          }));
        }
      );
      unsubs.push(unsub);
    }

    const fetchUsers = async () => {
      const userMap: Record<string, User> = {};
      await Promise.all(
        [...allMemberIds].map(async (uid) => {
          const snap = await getDoc(doc(db, 'users', uid));
          if (snap.exists()) {
            userMap[uid] = { uid, ...snap.data() } as User;
          }
        })
      );
      setUsers(userMap);
    };
    fetchUsers();

    return () => unsubs.forEach((u) => u());
  }, [groups.map((g) => g.id).join(',')]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-500 border-t-transparent" />
      </div>
    );
  }

  const youOwe: Record<string, DebtSummary> = {};
  const owedToYou: Record<string, DebtSummary> = {};

  for (const group of groups) {
    const groupBalances = balancesByGroup[group.id] || [];
    const settlements = simplifyDebts(groupBalances);

    for (const s of settlements) {
      if (s.from === user?.uid) {
        if (!youOwe[s.to]) {
          youOwe[s.to] = { uid: s.to, amount: 0, groups: [] };
        }
        const entry = youOwe[s.to]!;
        entry.amount += s.amount;
        entry.groups.push({
          groupId: group.id,
          groupName: group.name,
          amount: s.amount,
        });
      } else if (s.to === user?.uid) {
        if (!owedToYou[s.from]) {
          owedToYou[s.from] = { uid: s.from, amount: 0, groups: [] };
        }
        const entry = owedToYou[s.from]!;
        entry.amount += s.amount;
        entry.groups.push({
          groupId: group.id,
          groupName: group.name,
          amount: s.amount,
        });
      }
    }
  }

  const totalOwed = Object.values(youOwe).reduce((s, d) => s + d.amount, 0);
  const totalOwedToYou = Object.values(owedToYou).reduce(
    (s, d) => s + d.amount,
    0
  );
  const netBalance = totalOwedToYou - totalOwed;

  const memberName = (uid: string) => {
    return users[uid]?.displayName || uid.slice(0, 8) + '...';
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white px-4 py-4">
        <div className="mx-auto flex max-w-lg items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-sm text-primary-600">
              &larr;
            </Link>
            <h1 className="text-xl font-bold text-primary-600">Summary</h1>
          </div>
          <div className="flex items-center gap-3">
            {user?.photoURL && (
              <img src={user.photoURL} alt="" className="h-8 w-8 rounded-full" />
            )}
            <button
              onClick={signOut}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-lg px-4 py-6">
        {/* Net balance card */}
        <div className="mb-6 rounded-xl bg-white p-6 text-center shadow-sm">
          <p className="text-sm text-gray-500">Net Balance</p>
          <p
            className={`mt-1 text-3xl font-bold ${
              netBalance > 0
                ? 'text-green-600'
                : netBalance < 0
                  ? 'text-red-600'
                  : 'text-gray-600'
            }`}
          >
            {netBalance >= 0 ? '+' : ''}
            {formatCurrency(Math.abs(netBalance))}
          </p>
          <p className="mt-1 text-xs text-gray-400">
            {netBalance > 0
              ? 'You are owed overall'
              : netBalance < 0
                ? 'You owe overall'
                : 'All settled up!'}
          </p>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-red-50 p-4 text-center">
            <p className="text-xs text-red-500">You owe</p>
            <p className="text-lg font-bold text-red-600">
              {formatCurrency(totalOwed)}
            </p>
          </div>
          <div className="rounded-xl bg-green-50 p-4 text-center">
            <p className="text-xs text-green-500">You are owed</p>
            <p className="text-lg font-bold text-green-600">
              {formatCurrency(totalOwedToYou)}
            </p>
          </div>
        </div>

        {/* People you owe */}
        {Object.values(youOwe).length > 0 && (
          <div className="mb-4 rounded-xl bg-white p-4 shadow-sm">
            <h2 className="mb-3 font-semibold text-red-600">You Owe</h2>
            {Object.values(youOwe)
              .sort((a, b) => b.amount - a.amount)
              .map((debt) => (
                <div key={debt.uid} className="border-t py-3 first:border-0">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {users[debt.uid]?.photoURL ? (
                        <img
                          src={users[debt.uid]!.photoURL!}
                          alt=""
                          className="h-7 w-7 rounded-full"
                        />
                      ) : (
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-100 text-xs font-medium">
                          {memberName(debt.uid)[0]!.toUpperCase()}
                        </div>
                      )}
                      <span className="text-sm font-medium">
                        {memberName(debt.uid)}
                      </span>
                    </div>
                    <span className="font-semibold text-red-600">
                      {formatCurrency(debt.amount)}
                    </span>
                  </div>
                  <div className="mt-1 ml-9 space-y-0.5">
                    {debt.groups.map((g) => (
                      <Link
                        key={g.groupId}
                        to={`/group/${g.groupId}`}
                        className="flex justify-between text-xs text-gray-400 hover:text-primary-500"
                      >
                        <span>{g.groupName}</span>
                        <span>{formatCurrency(g.amount)}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        )}

        {/* People who owe you */}
        {Object.values(owedToYou).length > 0 && (
          <div className="rounded-xl bg-white p-4 shadow-sm">
            <h2 className="mb-3 font-semibold text-green-600">Owed to You</h2>
            {Object.values(owedToYou)
              .sort((a, b) => b.amount - a.amount)
              .map((debt) => (
                <div key={debt.uid} className="border-t py-3 first:border-0">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {users[debt.uid]?.photoURL ? (
                        <img
                          src={users[debt.uid]!.photoURL!}
                          alt=""
                          className="h-7 w-7 rounded-full"
                        />
                      ) : (
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-100 text-xs font-medium">
                          {memberName(debt.uid)[0]!.toUpperCase()}
                        </div>
                      )}
                      <span className="text-sm font-medium">
                        {memberName(debt.uid)}
                      </span>
                    </div>
                    <span className="font-semibold text-green-600">
                      {formatCurrency(debt.amount)}
                    </span>
                  </div>
                  <div className="mt-1 ml-9 space-y-0.5">
                    {debt.groups.map((g) => (
                      <Link
                        key={g.groupId}
                        to={`/group/${g.groupId}`}
                        className="flex justify-between text-xs text-gray-400 hover:text-primary-500"
                      >
                        <span>{g.groupName}</span>
                        <span>{formatCurrency(g.amount)}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        )}

        {Object.values(youOwe).length === 0 &&
          Object.values(owedToYou).length === 0 && (
            <div className="rounded-xl border-2 border-dashed border-gray-200 p-8 text-center">
              <p className="text-gray-500">No outstanding balances</p>
            </div>
          )}
      </main>
    </div>
  );
}
