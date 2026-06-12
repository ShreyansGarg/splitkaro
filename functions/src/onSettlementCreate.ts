import * as admin from 'firebase-admin';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

interface SettlementData {
  groupId: string;
  fromUserId: string;
  toUserId: string;
  amount: number;
}

export const onSettlementCreate = onDocumentCreated(
  'settlements/{settlementId}',
  async (event) => {
    const settlement = event.data?.data() as SettlementData | undefined;
    if (!settlement) return;

    await db.runTransaction(async (txn) => {
      // Idempotency guard
      const eventRef = db.collection('processedEvents').doc(event.id);
      const eventDoc = await txn.get(eventRef);
      if (eventDoc.exists) return;

      // Validate both parties are group members
      const groupDoc = await txn.get(
        db.collection('groups').doc(settlement.groupId)
      );
      const memberIds = new Set<string>(groupDoc.data()?.memberIds || []);
      if (
        !memberIds.has(settlement.fromUserId) ||
        !memberIds.has(settlement.toUserId)
      ) {
        await event.data!.ref.delete();
        return;
      }

      // Read current balance
      const sortedPair = [settlement.fromUserId, settlement.toUserId]
        .sort()
        .join('__');
      const balanceRef = db
        .collection(`groups/${settlement.groupId}/balances`)
        .doc(sortedPair);
      const balanceDoc = await txn.get(balanceRef);

      let currentAmount = 0;
      if (balanceDoc.exists) {
        const data = balanceDoc.data()!;
        if (data.toUserId === settlement.toUserId) {
          // fromUser owes toUser
          currentAmount = data.amount;
        } else {
          // Direction is flipped
          currentAmount = -data.amount;
        }
      }

      // Subtract settlement amount
      const newAmount = currentAmount - settlement.amount;

      if (newAmount >= 0) {
        txn.set(balanceRef, {
          fromUserId: settlement.fromUserId,
          toUserId: settlement.toUserId,
          amount: newAmount,
          groupId: settlement.groupId,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } else {
        // Direction flipped — toUser now owes fromUser
        txn.set(balanceRef, {
          fromUserId: settlement.toUserId,
          toUserId: settlement.fromUserId,
          amount: -newAmount,
          groupId: settlement.groupId,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      txn.set(eventRef, {
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
  }
);
