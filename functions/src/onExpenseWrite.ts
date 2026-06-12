import * as admin from 'firebase-admin';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

interface ExpenseData {
  groupId: string;
  amount: number;
  paidBy: string;
  splits: Record<string, number>;
}

export const onExpenseWrite = onDocumentWritten(
  'expenses/{expenseId}',
  async (event) => {
    const before = event.data?.before?.data() as ExpenseData | undefined;
    const after = event.data?.after?.data() as ExpenseData | undefined;

    if (!before && !after) return;

    const groupId = (after || before)!.groupId;

    await db.runTransaction(async (txn) => {
      // Idempotency guard
      const eventRef = db.collection('processedEvents').doc(event.id);
      const eventDoc = await txn.get(eventRef);
      if (eventDoc.exists) return;

      // Server-side validation on create/update
      if (after) {
        const groupDoc = await txn.get(db.collection('groups').doc(groupId));
        const memberIds = new Set<string>(groupDoc.data()?.memberIds || []);

        for (const uid of Object.keys(after.splits)) {
          if (!memberIds.has(uid)) {
            // Invalid: split UID is not a group member — delete expense
            await event.data!.after!.ref.delete();
            return;
          }
        }

        const splitSum = Object.values(after.splits).reduce((a, b) => a + b, 0);
        if (splitSum !== after.amount) {
          await event.data!.after!.ref.delete();
          return;
        }
      }

      // Collect all UIDs that need balance updates
      const allUids = new Set<string>();
      const paidByBefore = before?.paidBy;
      const paidByAfter = after?.paidBy;

      if (before) {
        for (const uid of Object.keys(before.splits)) {
          if (uid !== paidByBefore) allUids.add(uid);
        }
      }
      if (after) {
        for (const uid of Object.keys(after.splits)) {
          if (uid !== paidByAfter) allUids.add(uid);
        }
      }

      // Phase 1: Read all balance docs
      const balanceRefs: Record<string, FirebaseFirestore.DocumentReference> = {};
      const balanceData: Record<string, { fromUserId: string; toUserId: string; amount: number } | null> = {};

      for (const uid of allUids) {
        const paidBy = (after || before)!.paidBy;
        const sortedPair = [paidBy, uid].sort().join('__');
        const ref = db.collection(`groups/${groupId}/balances`).doc(sortedPair);
        balanceRefs[uid] = ref;
        const snap = await txn.get(ref);
        balanceData[uid] = snap.exists
          ? (snap.data() as { fromUserId: string; toUserId: string; amount: number })
          : null;
      }

      // Phase 2: Compute updates
      const updates: Record<string, { fromUserId: string; toUserId: string; amount: number; groupId: string; updatedAt: FirebaseFirestore.FieldValue }> = {};

      for (const uid of allUids) {
        let currentAmount = 0;
        const current = balanceData[uid];
        if (current) {
          const paidBy = (after || before)!.paidBy;
          if (current.toUserId === paidBy) {
            currentAmount = current.amount;
          } else {
            currentAmount = -current.amount;
          }
        }

        // Reverse old splits
        if (before && paidByBefore && before.splits[uid] !== undefined && uid !== paidByBefore) {
          currentAmount -= before.splits[uid]!;
        }

        // Apply new splits
        if (after && paidByAfter && after.splits[uid] !== undefined && uid !== paidByAfter) {
          currentAmount += after.splits[uid]!;
        }

        const paidBy = (after || before)!.paidBy;
        const sortedPair = [paidBy, uid].sort();
        if (currentAmount >= 0) {
          updates[uid] = {
            fromUserId: uid,
            toUserId: paidBy,
            amount: currentAmount,
            groupId,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          };
        } else {
          updates[uid] = {
            fromUserId: paidBy,
            toUserId: uid,
            amount: -currentAmount,
            groupId,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          };
        }

        // Suppress unused variable warning
        void sortedPair;
      }

      // Phase 3: Write all balance docs + idempotency marker
      for (const uid of allUids) {
        txn.set(balanceRefs[uid]!, updates[uid]!);
      }
      txn.set(eventRef, { processedAt: admin.firestore.FieldValue.serverTimestamp() });
    });
  }
);
