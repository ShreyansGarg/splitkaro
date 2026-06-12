import * as admin from 'firebase-admin';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

export const onUserCreate = onDocumentCreated(
  'users/{userId}',
  async (event) => {
    const userData = event.data?.data();
    if (!userData?.email) return;

    const email = userData.email as string;
    const uid = event.params.userId;

    // Find all groups where this email is pending
    const groupsSnapshot = await db
      .collection('groups')
      .where('pendingEmails', 'array-contains', email)
      .get();

    for (const groupDoc of groupsSnapshot.docs) {
      await db.runTransaction(async (txn) => {
        const freshDoc = await txn.get(groupDoc.ref);
        const data = freshDoc.data();
        if (!data) return;

        const pendingEmails: string[] = data.pendingEmails || [];
        const memberIds: string[] = data.memberIds || [];

        if (!pendingEmails.includes(email)) return;
        if (memberIds.includes(uid)) return;

        txn.update(groupDoc.ref, {
          pendingEmails: admin.firestore.FieldValue.arrayRemove(email),
          memberIds: admin.firestore.FieldValue.arrayUnion(uid),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // Update user's groupIds
        const userRef = db.collection('users').doc(uid);
        txn.update(userRef, {
          groupIds: admin.firestore.FieldValue.arrayUnion(groupDoc.id),
        });
      });
    }
  }
);
