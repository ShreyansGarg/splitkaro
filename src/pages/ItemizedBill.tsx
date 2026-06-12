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
import type { Group, BillItem } from '@/types';
import { calculateItemizedSplits } from '@/utils/itemizedSplit';
import { dollarsToCents, formatCurrency } from '@/utils/splits';

export default function ItemizedBill() {
  const { id: groupId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [group, setGroup] = useState<Group | null>(null);
  const [items, setItems] = useState<BillItem[]>([]);
  const [newItemName, setNewItemName] = useState('');
  const [newItemPrice, setNewItemPrice] = useState('');
  const [newItemQty, setNewItemQty] = useState('1');
  const [taxStr, setTaxStr] = useState('');
  const [tipStr, setTipStr] = useState('');
  const [showReview, setShowReview] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!groupId) return;
    getDoc(doc(db, 'groups', groupId)).then((snap) => {
      if (snap.exists()) {
        setGroup({ id: snap.id, ...snap.data() } as Group);
      }
    });
  }, [groupId]);

  const addItem = () => {
    if (!newItemName || !newItemPrice) return;
    const item: BillItem = {
      id: crypto.randomUUID(),
      name: newItemName,
      price: dollarsToCents(parseFloat(newItemPrice)),
      quantity: parseInt(newItemQty) || 1,
      assignedTo: [],
    };
    setItems([...items, item]);
    setNewItemName('');
    setNewItemPrice('');
    setNewItemQty('1');
  };

  const removeItem = (id: string) => {
    setItems(items.filter((i) => i.id !== id));
  };

  const toggleAssignment = (itemId: string, uid: string) => {
    setItems(
      items.map((item) => {
        if (item.id !== itemId) return item;
        const assignees = new Set(item.assignedTo);
        if (assignees.has(uid)) {
          assignees.delete(uid);
        } else {
          assignees.add(uid);
        }
        return { ...item, assignedTo: [...assignees] };
      })
    );
  };

  const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const taxAmount = dollarsToCents(parseFloat(taxStr) || 0);
  const tipAmount = dollarsToCents(parseFloat(tipStr) || 0);
  const total = subtotal + taxAmount + tipAmount;
  const allAssigned = items.length > 0 && items.every((i) => i.assignedTo.length > 0);

  let splits: Record<string, number> = {};
  let splitError = '';
  if (allAssigned && items.length > 0) {
    try {
      splits = calculateItemizedSplits({
        items,
        subtotal,
        taxAmount,
        tipAmount,
        total,
        paidBy: user?.uid ?? '',
        groupId: groupId ?? '',
      });
    } catch (err) {
      splitError = (err as Error).message;
    }
  }

  const handleSubmit = async () => {
    if (!user || !groupId || !allAssigned || splitError) return;
    setSubmitting(true);
    try {
      const expenseRef = await addDoc(collection(db, 'expenses'), {
        groupId,
        description: `Itemized bill (${items.length} items)`,
        amount: total,
        currency: 'USD',
        category: 'food',
        paidBy: user.uid,
        splitType: 'itemized',
        splits,
        date: Timestamp.now(),
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      for (const item of items) {
        await addDoc(collection(db, `expenses/${expenseRef.id}/items`), {
          name: item.name,
          price: item.price,
          quantity: item.quantity,
          assignedTo: item.assignedTo,
        });
      }

      navigate(`/group/${groupId}`);
    } catch (err) {
      console.error('Failed to create itemized expense:', err);
      alert('Failed to create expense');
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

  if (showReview) {
    return (
      <div className="min-h-screen bg-gray-50">
        <header className="border-b bg-white px-4 py-4">
          <div className="mx-auto max-w-lg">
            <button
              onClick={() => setShowReview(false)}
              className="mb-2 text-sm text-primary-600"
            >
              &larr; Back to items
            </button>
            <h1 className="text-xl font-bold">Review Split</h1>
          </div>
        </header>
        <main className="mx-auto max-w-lg px-4 py-6">
          <div className="space-y-3">
            {Object.entries(splits).map(([uid, amount]) => (
              <div
                key={uid}
                className="flex items-center justify-between rounded-xl bg-white p-4 shadow-sm"
              >
                <span>
                  {uid === user?.uid ? 'You' : uid.slice(0, 12) + '...'}
                </span>
                <span className="font-semibold">{formatCurrency(amount)}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-lg bg-gray-100 p-3 text-sm">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span>{formatCurrency(subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span>Tax</span>
              <span>{formatCurrency(taxAmount)}</span>
            </div>
            <div className="flex justify-between">
              <span>Tip</span>
              <span>{formatCurrency(tipAmount)}</span>
            </div>
            <div className="mt-1 flex justify-between border-t pt-1 font-semibold">
              <span>Total</span>
              <span>{formatCurrency(total)}</span>
            </div>
          </div>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="mt-6 w-full rounded-lg bg-primary-500 py-3 font-medium text-white shadow-sm hover:bg-primary-600 disabled:opacity-50"
          >
            {submitting ? 'Creating...' : 'Confirm & Split'}
          </button>
        </main>
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
          <h1 className="text-xl font-bold">Split a Bill</h1>
        </div>
      </header>

      <main className="mx-auto max-w-lg px-4 py-6">
        <div className="mb-4 flex gap-2">
          <input
            type="text"
            placeholder="Item name"
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
            className="flex-1 rounded-lg border px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
          />
          <input
            type="number"
            step="0.01"
            min="0"
            placeholder="$"
            value={newItemPrice}
            onChange={(e) => setNewItemPrice(e.target.value)}
            className="w-20 rounded-lg border px-2 py-2 text-sm focus:border-primary-500 focus:outline-none"
          />
          <input
            type="number"
            min="1"
            placeholder="Qty"
            value={newItemQty}
            onChange={(e) => setNewItemQty(e.target.value)}
            className="w-16 rounded-lg border px-2 py-2 text-sm focus:border-primary-500 focus:outline-none"
          />
          <button
            onClick={addItem}
            disabled={!newItemName || !newItemPrice}
            className="rounded-lg bg-primary-500 px-3 py-2 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-50"
          >
            +
          </button>
        </div>

        {items.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-gray-200 p-8 text-center">
            <p className="text-gray-500">Add items from the bill</p>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((item) => (
              <div
                key={item.id}
                className={`rounded-xl bg-white p-3 shadow-sm ${
                  item.assignedTo.length === 0
                    ? 'ring-2 ring-red-300'
                    : ''
                }`}
              >
                <div className="mb-2 flex items-center justify-between">
                  <div>
                    <span className="font-medium">{item.name}</span>
                    {item.quantity > 1 && (
                      <span className="ml-1 text-xs text-gray-500">
                        x{item.quantity}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">
                      {formatCurrency(item.price * item.quantity)}
                    </span>
                    <button
                      onClick={() => removeItem(item.id)}
                      className="text-gray-400 hover:text-red-500"
                    >
                      &times;
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {group.memberIds.map((uid) => (
                    <button
                      key={uid}
                      onClick={() => toggleAssignment(item.id, uid)}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                        item.assignedTo.includes(uid)
                          ? 'bg-primary-100 text-primary-700'
                          : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {uid === user?.uid ? 'You' : uid.slice(0, 8)}
                    </button>
                  ))}
                </div>
                {item.assignedTo.length === 0 && (
                  <p className="mt-1 text-xs text-red-500">
                    Assign this item to at least one person
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {items.length > 0 && (
          <>
            <div className="mt-4 space-y-2">
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-gray-500">
                    Tax
                  </label>
                  <div className="relative">
                    <span className="absolute left-2 top-2 text-xs text-gray-500">
                      $
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={taxStr}
                      onChange={(e) => setTaxStr(e.target.value)}
                      placeholder="0.00"
                      className="w-full rounded-lg border py-2 pl-5 pr-2 text-sm focus:border-primary-500 focus:outline-none"
                    />
                  </div>
                </div>
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-gray-500">
                    Tip
                  </label>
                  <div className="relative">
                    <span className="absolute left-2 top-2 text-xs text-gray-500">
                      $
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={tipStr}
                      onChange={(e) => setTipStr(e.target.value)}
                      placeholder="0.00"
                      className="w-full rounded-lg border py-2 pl-5 pr-2 text-sm focus:border-primary-500 focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-lg bg-gray-100 p-3 text-sm">
                <div className="flex justify-between font-semibold">
                  <span>Total</span>
                  <span>{formatCurrency(total)}</span>
                </div>
              </div>
            </div>

            {splitError && (
              <p className="mt-2 text-sm text-red-500">{splitError}</p>
            )}

            <button
              onClick={() => setShowReview(true)}
              disabled={!allAssigned || !!splitError}
              className="mt-4 w-full rounded-lg bg-primary-500 py-3 font-medium text-white shadow-sm hover:bg-primary-600 disabled:opacity-50"
            >
              Review Split
            </button>
          </>
        )}
      </main>
    </div>
  );
}
