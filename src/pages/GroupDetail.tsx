import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  doc,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  getDoc,
  getDocs,
  updateDoc,
  arrayUnion,
  deleteDoc,
} from 'firebase/firestore';
import { db } from '@/services/firebase';
import { useAuth } from '@/contexts/AuthContext';
import type { Group, Expense, Balance, User } from '@/types';
import { formatCurrency } from '@/utils/splits';
import { simplifyDebts } from '@/utils/debtSimplification';

type Tab = 'expenses' | 'balances';

export default function GroupDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [group, setGroup] = useState<Group | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [members, setMembers] = useState<Record<string, User>>({});
  const [loading, setLoading] = useState(true);
  const [showMembers, setShowMembers] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('expenses');
  const [simplifyEnabled, setSimplifyEnabled] = useState(true);

  useEffect(() => {
    if (!id) return;

    const unsubGroup = onSnapshot(doc(db, 'groups', id), (snap) => {
      if (snap.exists()) {
        setGroup({ id: snap.id, ...snap.data() } as Group);
      }
      setLoading(false);
    });

    const expenseQuery = query(
      collection(db, 'expenses'),
      where('groupId', '==', id),
      orderBy('date', 'desc')
    );
    const unsubExpenses = onSnapshot(expenseQuery, (snap) => {
      setExpenses(
        snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Expense)
      );
    });

    const unsubBalances = onSnapshot(
      collection(db, `groups/${id}/balances`),
      (snap) => {
        setBalances(snap.docs.map((d) => d.data() as Balance));
      }
    );

    return () => {
      unsubGroup();
      unsubExpenses();
      unsubBalances();
    };
  }, [id]);

  useEffect(() => {
    if (!group) return;
    const fetchMembers = async () => {
      const memberMap: Record<string, User> = {};
      await Promise.all(
        group.memberIds.map(async (uid) => {
          const snap = await getDoc(doc(db, 'users', uid));
          if (snap.exists()) {
            memberMap[uid] = { uid, ...snap.data() } as User;
          }
        })
      );
      setMembers(memberMap);
    };
    fetchMembers();
  }, [group?.memberIds.join(',')]);

  if (loading || !group) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-500 border-t-transparent" />
      </div>
    );
  }

  const simplified = simplifyDebts(balances);
  const rawDebts = balances.filter((b) => b.amount > 0);

  const displayDebts = simplifyEnabled
    ? simplified.map((s) => ({ from: s.from, to: s.to, amount: s.amount }))
    : rawDebts.map((b) => ({ from: b.fromUserId, to: b.toUserId, amount: b.amount }));

  const myDebts = displayDebts.filter(
    (d) => d.from === user?.uid || d.to === user?.uid
  );

  const memberName = (uid: string) => {
    if (uid === user?.uid) return 'You';
    return members[uid]?.displayName || uid.slice(0, 8) + '...';
  };

  const isAdmin = user ? group.adminIds.includes(user.uid) : false;

  const handleInvite = async () => {
    const email = inviteEmail.trim().toLowerCase();
    if (!email || !email.includes('@') || !id) return;
    if (group.pendingEmails.includes(email)) return;
    const alreadyMember = Object.values(members).some(
      (m) => m.email === email
    );
    if (alreadyMember) return;

    setInviting(true);
    try {
      const usersQuery = query(
        collection(db, 'users'),
        where('email', '==', email)
      );
      const userSnap = await getDocs(usersQuery);

      if (!userSnap.empty) {
        const existingUser = userSnap.docs[0]!;
        await updateDoc(doc(db, 'groups', id), {
          memberIds: arrayUnion(existingUser.id),
        });
        await updateDoc(doc(db, 'users', existingUser.id), {
          groupIds: arrayUnion(id),
        });
      } else {
        await updateDoc(doc(db, 'groups', id), {
          pendingEmails: arrayUnion(email),
        });
      }
      setInviteEmail('');
    } catch (err) {
      console.error('Failed to invite:', err);
    } finally {
      setInviting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white px-4 py-4">
        <div className="mx-auto max-w-lg">
          <Link to="/" className="mb-2 inline-block text-sm text-primary-600">
            &larr; Back
          </Link>
          <div className="flex items-center gap-3">
            <span className="text-3xl">{group.emoji || '👥'}</span>
            <div>
              <h1 className="text-xl font-bold">{group.name}</h1>
              <button
                onClick={() => setShowMembers(!showMembers)}
                className="text-sm text-primary-600 hover:underline"
              >
                {group.memberIds.length} member
                {group.memberIds.length !== 1 ? 's' : ''}
                {group.pendingEmails.length > 0 &&
                  ` · ${group.pendingEmails.length} pending`}
                {showMembers ? ' ▴' : ' ▾'}
              </button>
            </div>
          </div>
        </div>
      </header>

      {showMembers && (
        <div className="border-b bg-white px-4 pb-4">
          <div className="mx-auto max-w-lg">
            <div className="space-y-2">
              {group.memberIds.map((uid) => {
                const member = members[uid];
                const memberIsAdmin = group.adminIds.includes(uid);
                return (
                  <div key={uid} className="flex items-center gap-3">
                    {member?.photoURL ? (
                      <img
                        src={member.photoURL}
                        alt=""
                        className="h-8 w-8 rounded-full"
                      />
                    ) : (
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-100 text-sm font-medium text-primary-700">
                        {(member?.displayName ?? '?')[0]!.toUpperCase()}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {member?.displayName || uid.slice(0, 8) + '...'}
                        {uid === user?.uid && (
                          <span className="ml-1 text-gray-400">(you)</span>
                        )}
                      </p>
                      <p className="text-xs text-gray-400 truncate">
                        {member?.email || ''}
                      </p>
                    </div>
                    {memberIsAdmin && (
                      <span className="rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-600">
                        Admin
                      </span>
                    )}
                  </div>
                );
              })}
              {group.pendingEmails.length > 0 && (
                <>
                  <div className="mt-3 border-t pt-3">
                    <p className="mb-2 text-xs font-medium uppercase text-gray-400">
                      Pending Invites
                    </p>
                  </div>
                  {group.pendingEmails.map((email) => (
                    <div key={email} className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-sm text-gray-400">
                        ?
                      </div>
                      <p className="text-sm text-gray-500">{email}</p>
                    </div>
                  ))}
                </>
              )}
              {isAdmin && (
                <div className="mt-3 border-t pt-3">
                  <div className="flex gap-2">
                    <input
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleInvite();
                        }
                      }}
                      placeholder="Add member by email"
                      className="flex-1 rounded-lg border px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
                    />
                    <button
                      onClick={handleInvite}
                      disabled={inviting || !inviteEmail.trim()}
                      className="rounded-lg bg-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-50"
                    >
                      {inviting ? '...' : 'Invite'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b bg-white">
        <div className="mx-auto flex max-w-lg">
          <button
            onClick={() => setActiveTab('expenses')}
            className={`flex-1 py-3 text-center text-sm font-medium transition-colors ${
              activeTab === 'expenses'
                ? 'border-b-2 border-primary-500 text-primary-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Expenses
          </button>
          <button
            onClick={() => setActiveTab('balances')}
            className={`flex-1 py-3 text-center text-sm font-medium transition-colors ${
              activeTab === 'balances'
                ? 'border-b-2 border-primary-500 text-primary-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Balances
          </button>
        </div>
      </div>

      <main className="mx-auto max-w-lg px-4 py-6">
        {activeTab === 'balances' ? (
          <div>
            {/* Simplification toggle */}
            <div className="mb-4 flex items-center justify-between rounded-xl bg-white p-4 shadow-sm">
              <div>
                <p className="text-sm font-medium">Simplify debts</p>
                <p className="text-xs text-gray-400">
                  {simplifyEnabled
                    ? 'Minimized transactions'
                    : 'All pairwise debts'}
                </p>
              </div>
              <button
                onClick={() => setSimplifyEnabled(!simplifyEnabled)}
                className={`relative h-6 w-11 rounded-full transition-colors ${
                  simplifyEnabled ? 'bg-primary-500' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                    simplifyEnabled ? 'translate-x-5' : ''
                  }`}
                />
              </button>
            </div>

            {/* Your summary */}
            {myDebts.length > 0 && (
              <div className="mb-4 rounded-xl bg-white p-4 shadow-sm">
                <h2 className="mb-3 font-semibold">Your Summary</h2>
                {myDebts.map((d, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between border-t py-2 first:border-0"
                  >
                    <span className="text-sm text-gray-600">
                      {d.from === user?.uid
                        ? `You owe ${memberName(d.to)}`
                        : `${memberName(d.from)} owes you`}
                    </span>
                    <span
                      className={`font-medium ${
                        d.from === user?.uid ? 'text-red-600' : 'text-green-600'
                      }`}
                    >
                      {formatCurrency(d.amount)}
                    </span>
                  </div>
                ))}
                <Link
                  to={`/group/${id}/settle`}
                  className="mt-3 block w-full rounded-lg bg-primary-500 py-2 text-center text-sm font-medium text-white hover:bg-primary-600"
                >
                  Settle Up
                </Link>
              </div>
            )}

            {/* All debts */}
            <div className="rounded-xl bg-white p-4 shadow-sm">
              <h2 className="mb-3 font-semibold">
                {simplifyEnabled ? 'Simplified Settlements' : 'All Balances'}
              </h2>
              {displayDebts.length === 0 ? (
                <p className="py-4 text-center text-sm text-gray-400">
                  All settled up!
                </p>
              ) : (
                <div className="space-y-1">
                  {displayDebts.map((d, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between border-t py-2 first:border-0"
                    >
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-medium text-gray-800">
                          {memberName(d.from)}
                        </span>
                        <svg
                          className="h-4 w-4 text-gray-400"
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth={2}
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3"
                          />
                        </svg>
                        <span className="font-medium text-gray-800">
                          {memberName(d.to)}
                        </span>
                      </div>
                      <span className="font-semibold text-gray-900">
                        {formatCurrency(d.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {simplifyEnabled && displayDebts.length > 0 && (
                <p className="mt-3 text-xs text-gray-400">
                  {displayDebts.length} transaction
                  {displayDebts.length !== 1 ? 's' : ''} needed
                  {rawDebts.length > displayDebts.length &&
                    ` (reduced from ${rawDebts.length})`}
                </p>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold">Expenses</h2>
              <div className="flex gap-2">
                <Link
                  to={`/group/${id}/bill`}
                  className="rounded-lg border border-primary-500 px-3 py-1.5 text-sm font-medium text-primary-600 hover:bg-primary-50"
                >
                  Split Bill
                </Link>
                <Link
                  to={`/group/${id}/add`}
                  className="rounded-lg bg-primary-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-600"
                >
                  + Add
                </Link>
              </div>
            </div>

            {expenses.length === 0 ? (
              <div className="rounded-xl border-2 border-dashed border-gray-200 p-8 text-center">
                <p className="text-gray-500">No expenses yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {expenses.map((expense) => {
                  const canDelete =
                    expense.createdBy === user?.uid || isAdmin;
                  return (
                    <div
                      key={expense.id}
                      className="rounded-xl bg-white p-4 shadow-sm"
                    >
                      <div className="flex items-center justify-between">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">{expense.description}</p>
                          <p className="text-xs text-gray-500">
                            Paid by {memberName(expense.paidBy)}
                            {' · '}
                            {expense.splitType} split
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">
                            {formatCurrency(expense.amount)}
                          </span>
                          {canDelete && (
                            <button
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `Delete "${expense.description}"?`
                                  )
                                ) {
                                  deleteDoc(doc(db, 'expenses', expense.id));
                                }
                              }}
                              className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500"
                            >
                              <svg
                                className="h-4 w-4"
                                fill="none"
                                viewBox="0 0 24 24"
                                strokeWidth={2}
                                stroke="currentColor"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                                />
                              </svg>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
