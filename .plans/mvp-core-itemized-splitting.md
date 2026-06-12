# SplitKaro — MVP Plan: Core + Itemized Bill Splitting

## Context

Building a personal expense-splitting app for a friends circle — like Splitwise
but with all premium features free and a killer itemized bill-splitting feature.
The app lets users add expenses, split them across group members, and settle
debts with minimal transactions. The itemized bill feature allows per-item
assignment so people only pay for what they ordered.

**Tech stack**: React + TypeScript + Vite + Tailwind CSS + Firebase (Firestore,
Auth, Hosting, Storage, Cloud Functions)

**Target users**: ~10-50 friends. No enterprise scale needed.

## Approach

Build a single-page web app with Firebase as the backend. Use Firestore's
real-time listeners so all group members see updates instantly. Authentication
via Google sign-in (one tap, no passwords).

**Balance architecture**: Balances are updated server-side via Cloud Functions
triggered on expense/settlement writes — not client-side. This ensures the
`balances` subcollection is only writable by the admin SDK, preventing balance
forgery. Clients read balances via real-time listeners but never write directly.

**Server-side validation**: Cloud Functions validate data integrity constraints
that Firestore rules cannot express (splits sum to amount, split UIDs are group
members). Invalid writes are rejected by deleting the offending document.

**Cloud Function idempotency**: All event-driven Cloud Functions use the
`event.id` as an idempotency key to guard against at-least-once delivery.
The function checks a `processedEvents` collection inside the same transaction
and skips if already processed.

**Monetary arithmetic**: All monetary calculations operate in integer cents
(paise for INR) internally, converting to display currency only at the UI
boundary. This avoids floating-point drift across operations.

The app has 5 core screens: Dashboard, Group Detail, Add Expense, Itemized Bill,
and Settlement.

## Implementation Overview

### 1. Project Setup & Firebase Configuration

**What**: Scaffold a React + TypeScript + Vite project. Configure Firebase
(Firestore, Auth, Hosting, Cloud Functions). Set up Tailwind CSS. Create the
Firebase project and enable required services.

**Why**: Vite for fast dev experience, Tailwind for rapid UI iteration without
CSS overhead. Firebase config is the foundation everything depends on. Cloud
Functions handle balance computation and data validation server-side.

**How**:
```
splitkaro/
├── src/
│   ├── components/       # Reusable UI components
│   ├── pages/            # Route-level page components
│   ├── hooks/            # Custom React hooks (useAuth, useGroup, etc.)
│   ├── services/         # Firebase service layer (firestore, auth)
│   ├── utils/            # Pure functions (debt simplification, calculations)
│   ├── types/            # TypeScript type definitions
│   ├── contexts/         # React contexts (AuthContext)
│   ├── App.tsx
│   └── main.tsx
├── functions/
│   ├── src/
│   │   ├── onExpenseWrite.ts    # Balance update + validation trigger
│   │   ├── onSettlementCreate.ts # Settlement balance update trigger
│   │   ├── onUserCreate.ts      # Pending invite linking
│   │   ├── utils.ts             # Shared: idempotency guard, validation helpers
│   │   └── index.ts
│   ├── package.json
│   └── tsconfig.json
├── firestore.rules
├── firebase.json
├── index.html
├── package.json
├── tsconfig.json
├── tailwind.config.js
└── vite.config.ts
```

Firebase config stored in environment variables (`.env.local`, gitignored).

---

### 2. Authentication

**What**: Google sign-in via Firebase Auth. `AuthContext` provides current user
throughout the app. Protected routes redirect unauthenticated users to a
login page.

**Why**: Google sign-in is frictionless for a friends app — no passwords to
manage, everyone has a Google account.

**How**:

```typescript
// types/index.ts
interface User {
  uid: string;
  displayName: string;
  email: string;
  photoURL: string | null;
}

// contexts/AuthContext.tsx
interface AuthContextType {
  user: User | null;
  loading: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}
```

`useAuth()` hook wraps `onAuthStateChanged` listener. Login page shows a
single "Sign in with Google" button.

Firestore `users` doc created on first sign-in:
```typescript
// users/{uid}
{
  uid: string;
  displayName: string;
  email: string;
  photoURL: string | null;
  groupIds: string[];       // denormalized for quick group listing
  createdAt: Timestamp;
}
```

**Security rules for users**:
```
match /users/{userId} {
  allow read: if request.auth != null && request.auth.uid == userId;
  allow create: if request.auth != null && request.auth.uid == userId
    && request.resource.data.uid == userId
    && request.resource.data.email == request.auth.token.email;
  // uid and email are immutable — prevent impersonation
  allow update: if request.auth != null && request.auth.uid == userId
    && request.resource.data.uid == resource.data.uid
    && request.resource.data.email == resource.data.email;
}
```

---

### 3. Groups

**What**: Create groups, add/remove members, view group list on dashboard.
Members are identified by email — if they haven't signed up yet, they appear
as pending and are linked when they join via a Cloud Function.

**Why**: Groups are the organizational unit for all expenses. Supporting
email-based invites means friends don't all need to sign up before you start
tracking.

**How**:

```typescript
// groups/{groupId}
interface Group {
  id: string;
  name: string;
  description?: string;
  emoji?: string;              // group icon
  memberIds: string[];         // uid[] of joined members
  pendingEmails: string[];     // emails invited but not yet signed up
  adminIds: string[];          // uid[] — creator + promoted members
  createdBy: string;           // uid
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

- Dashboard shows all groups the user belongs to, with each group's net
  balance (you owe / you're owed).
- "Create Group" flow: name → add members by email → done. On creation,
  `memberIds` contains only the creator; invited friends go to `pendingEmails`.
- **Pending invite linking**: A Cloud Function (`onUserCreate`) triggers on
  new user creation, queries all groups where `pendingEmails` contains the
  new user's verified email, and atomically moves them from `pendingEmails`
  to `memberIds`. This prevents client-side invite hijacking — only the
  server can verify `auth.token.email` matches the pending email.

**Security rules for groups**:
```
match /groups/{groupId} {
  allow read: if request.auth != null
    && request.auth.uid in resource.data.memberIds;

  // On create: only the creator in memberIds and adminIds
  allow create: if request.auth != null
    && request.resource.data.memberIds == [request.auth.uid]
    && request.resource.data.adminIds == [request.auth.uid]
    && request.resource.data.createdBy == request.auth.uid;

  // Only admins can modify group settings, add pendingEmails, etc.
  // createdBy is immutable; creator always stays in adminIds
  // memberIds is immutable via rules — only Cloud Functions can add members
  // (prevents admins from injecting arbitrary UIDs)
  allow update: if request.auth != null
    && request.auth.uid in resource.data.adminIds
    && request.resource.data.createdBy == resource.data.createdBy
    && resource.data.createdBy in request.resource.data.adminIds
    && request.resource.data.memberIds == resource.data.memberIds;

  // Members can leave (remove only themselves), but cannot modify other fields
  // Creator cannot leave — prevents unrecoverable group state
  allow update: if request.auth != null
    && request.auth.uid in resource.data.memberIds
    && request.auth.uid != resource.data.createdBy
    && request.resource.data.memberIds.hasAll(
         resource.data.memberIds.removeAll([request.auth.uid]))
    && request.resource.data.memberIds.size() == resource.data.memberIds.size() - 1
    && request.resource.data.adminIds == resource.data.adminIds
    && request.resource.data.name == resource.data.name
    && request.resource.data.createdBy == resource.data.createdBy
    && request.resource.data.pendingEmails == resource.data.pendingEmails;
}
```

---

### 4. Expenses & Splitting

**What**: Add expenses to a group with flexible splitting: equal, unequal
(exact amounts), or percentage-based. Each expense records who paid, who owes
what, and the category.

**Why**: This is the core value — tracking who owes whom. Supporting multiple
split types covers all real-world scenarios (rent split equally, dinner split
unevenly, etc.).

**How**:

```typescript
// expenses/{expenseId}
interface Expense {
  id: string;
  groupId: string;
  description: string;
  amount: number;              // total in cents (paise for INR)
  currency: string;            // "INR", "USD", etc.
  category: ExpenseCategory;
  paidBy: string;              // uid of person who paid
  splitType: "equal" | "unequal" | "percentage" | "itemized";
  splits: Record<string, number>;  // { uid: amountOwedInCents }
  itemizedBillId?: string;     // link to itemized bill if splitType=itemized
  date: Timestamp;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

type ExpenseCategory =
  | "food"
  | "transport"
  | "shopping"
  | "entertainment"
  | "rent"
  | "utilities"
  | "groceries"
  | "travel"
  | "other";
```

**Invariant**: `Object.values(splits).reduce((a, b) => a + b, 0)` must equal
`amount`. This is enforced client-side before submission. Firestore rules cannot
iterate map values, so the `onExpenseWrite` Cloud Function validates this
server-side and deletes invalid expenses (see Section 6).

Split calculation utilities (all operate in integer cents):
```typescript
// utils/splits.ts

// Largest-remainder rounding: guarantees splits sum exactly to amount
function splitEqual(amountCents: number, memberIds: string[]): Record<string, number> {
  const base = Math.floor(amountCents / memberIds.length);
  const remainder = amountCents - base * memberIds.length;
  const result: Record<string, number> = {};
  memberIds.forEach((id, i) => {
    result[id] = base + (i < remainder ? 1 : 0);
  });
  return result;
}

function splitUnequal(totalAmountCents: number, shares: Record<string, number>): Record<string, number> {
  const sum = Object.values(shares).reduce((a, b) => a + b, 0);
  if (sum !== totalAmountCents) {
    throw new Error(`Shares sum to ${sum}, but expense total is ${totalAmountCents}`);
  }
  return shares;
}

function splitByPercentage(amountCents: number, percentages: Record<string, number>): Record<string, number> {
  const totalPct = Object.values(percentages).reduce((a, b) => a + b, 0);
  if (Math.abs(totalPct - 100) > 1) {
    throw new Error(`Percentages sum to ${totalPct}%, expected ~100%`);
  }
  // Normalize percentages to sum to exactly 100 before computing shares
  // This handles common cases like 33.33 + 33.33 + 33.33 = 99.99
  const entries = Object.entries(percentages);
  const normalized = entries.map(([, pct]) => pct * 100 / totalPct);
  const rawShares = normalized.map(pct => amountCents * pct / 100);
  const floored = rawShares.map(s => Math.floor(s));
  let remainder = amountCents - floored.reduce((a, b) => a + b, 0);
  // Assign remainder pennies to entries with largest fractional parts
  const fractionals = rawShares.map((s, i) => ({ i, frac: s - floored[i] }));
  fractionals.sort((a, b) => b.frac - a.frac);
  for (let j = 0; j < remainder; j++) {
    floored[fractionals[j].i]++;
  }
  const result: Record<string, number> = {};
  entries.forEach(([uid], i) => { result[uid] = floored[i]; });
  return result;
}
```

**UI validation**: The "Add Expense" form shows a real-time "remaining" indicator
for unequal splits. Submission is blocked when splits don't sum to the total.

**Security rules for expenses**:
```
match /expenses/{expenseId} {
  allow read: if request.auth != null
    && request.auth.uid in get(/databases/$(database)/documents/
       groups/$(resource.data.groupId)).data.memberIds;

  allow create: if request.auth != null
    && request.resource.data.amount > 0
    && request.resource.data.createdBy == request.auth.uid
    && request.resource.data.paidBy in get(/databases/$(database)/documents/
       groups/$(request.resource.data.groupId)).data.memberIds
    && request.auth.uid in get(/databases/$(database)/documents/
       groups/$(request.resource.data.groupId)).data.memberIds;

  // Only creator or group admin can update; groupId, createdBy, paidBy are immutable
  // Must still be a group member
  allow update: if request.auth != null
    && request.resource.data.amount > 0
    && request.resource.data.groupId == resource.data.groupId
    && request.resource.data.createdBy == resource.data.createdBy
    && request.resource.data.paidBy == resource.data.paidBy
    && request.auth.uid in get(/databases/$(database)/documents/
       groups/$(resource.data.groupId)).data.memberIds
    && (resource.data.createdBy == request.auth.uid
        || request.auth.uid in get(/databases/$(database)/documents/
           groups/$(resource.data.groupId)).data.adminIds);

  // Must still be a group member to delete
  allow delete: if request.auth != null
    && request.auth.uid in get(/databases/$(database)/documents/
       groups/$(resource.data.groupId)).data.memberIds
    && (resource.data.createdBy == request.auth.uid
        || request.auth.uid in get(/databases/$(database)/documents/
           groups/$(resource.data.groupId)).data.adminIds);
}

// Items subcollection for itemized bills
match /expenses/{expenseId}/items/{itemId} {
  allow read: if request.auth != null
    && request.auth.uid in get(/databases/$(database)/documents/
       groups/$(get(/databases/$(database)/documents/
       expenses/$(expenseId)).data.groupId)).data.memberIds;
  // Only the expense creator can write items
  allow write: if request.auth != null
    && request.auth.uid == get(/databases/$(database)/documents/
       expenses/$(expenseId)).data.createdBy;
}
```

---

### 5. Itemized Bill Splitting (Killer Feature)

**What**: Enter a bill item-by-item (name, price, quantity), assign each item
to one or more people, handle shared items, and auto-distribute tax/tip
proportionally. The result becomes an expense with `splitType: "itemized"`.

**Why**: This is the differentiator. Splitwise can't do per-item splitting.
Restaurant bills, grocery runs, group orders — this handles them all fairly.

**How**:

```typescript
// Data model (subcollection: expenses/{expenseId}/items/{itemId})
interface BillItem {
  id: string;
  name: string;
  price: number;               // price per unit in cents
  quantity: number;            // must be >= 1 (integer)
  assignedTo: string[];        // unique uids sharing this item, must be non-empty
}

// UI state during bill entry (not persisted as-is)
interface ItemizedBill {
  items: BillItem[];
  subtotal: number;            // computed: sum of (price * qty) in cents
  taxAmount: number;           // entered by user, in cents
  tipAmount: number;           // entered by user, in cents
  total: number;               // subtotal + tax + tip, in cents
  paidBy: string;              // uid
  groupId: string;
}
```

**Validation constraints**:
- `quantity >= 1` (integer). To remove an item, delete it — don't set qty to 0.
- `price >= 0` (in cents). Zero-price items (freebies) are allowed. A person
  assigned only zero-price items will owe $0 (no tax/tip share) — this is
  intentional since tax and tip are distributed proportional to food cost.
- `assignedTo.length >= 1`. Unassigned items block submission.
- `assignedTo` must contain unique UIDs (no duplicates). Enforced via `Set` at
  the point of assignment in the UI, and validated in `calculateItemizedSplits`.
- Discounts/coupons are **not supported in MVP** — users should adjust item
  prices manually. Negative line items introduce proportional distribution
  problems (negative tax/tip shares). Added to Future Enhancements.

Tax & tip distribution logic (operates in integer cents):
```typescript
// utils/itemizedSplit.ts
function calculateItemizedSplits(bill: ItemizedBill): Record<string, number> {
  // 1. Validate: every item has assignedTo.length >= 1, unique UIDs,
  //    quantity >= 1, price >= 0

  // 2. For each item, compute per-person share using largest-remainder:
  //    lineTotal = item.price * item.quantity
  //    base = Math.floor(lineTotal / item.assignedTo.length)
  //    remainder = lineTotal - base * item.assignedTo.length
  //    Each assignee gets `base`; first `remainder` assignees get `base + 1`
  //    Accumulate: personSubtotal[uid] += their share

  // 3. Distribute tax using largest-remainder (single operation, no
  //    intermediate proportion):
  //    rawTax[uid] = bill.taxAmount * personSubtotal[uid] / bill.subtotal
  //    flooredTax[uid] = Math.floor(rawTax[uid])
  //    remainder = bill.taxAmount - sum(flooredTax)
  //    Assign remainder cents to entries with largest fractional part of rawTax

  // 4. Distribute tip using the same method:
  //    rawTip[uid] = bill.tipAmount * personSubtotal[uid] / bill.subtotal
  //    (same largest-remainder logic)

  // 5. personTotal[uid] = personSubtotal[uid] + personTax[uid] + personTip[uid]
  // 6. Assert: sum(personTotal) === bill.total
  // 7. Return { uid: personTotal } map
}
```

**UI flow**:
1. Enter bill items one by one (name, price per unit, qty)
2. For each item, tap on group members to assign them — **unassigned items show
   a red warning border** and block the "Review" button. Rapid double-taps are
   deduplicated (Set-based assignment).
3. "Shared" toggle splits an item among all selected people
4. Enter tax and tip amounts at the bottom
5. Review screen shows each person's total with item-level breakdown
6. Confirm → creates an expense with `splitType: "itemized"`

---

### 6. Balances & Debt Simplification

**What**: Track pairwise balances between group members. Use the minimum
cash-flow algorithm to simplify debts — minimize the number of transactions
needed to settle up.

**Why**: Without simplification, a 5-person group could have 10+ individual
debts. The algorithm reduces this to at most n-1 transactions.

**How**:

Balances stored as a subcollection under groups for clean security rules and
to avoid document ID ambiguity:
```typescript
// groups/{groupId}/balances/{sortedUid1}__{sortedUid2}
// Document ID: deterministic — sort the two UIDs lexicographically,
// join with double-underscore to avoid ambiguity with UID characters
interface Balance {
  groupId: string;
  fromUserId: string;          // person who owes
  toUserId: string;            // person who is owed
  amount: number;              // always positive, in cents
  updatedAt: Timestamp;
}
```

**Balance updates via Cloud Functions** (not client-side):
```typescript
// functions/src/onExpenseWrite.ts
// Triggered on: expenses/{expenseId} — onCreate, onUpdate, onDelete

export const onExpenseWrite = onDocumentWritten("expenses/{expenseId}", async (event) => {
  const before = event.data?.before?.data() as Expense | undefined;
  const after = event.data?.after?.data() as Expense | undefined;

  await runTransaction(db, async (txn) => {
    // Step 0: Idempotency guard — check event.id in processedEvents
    const eventRef = doc(db, 'processedEvents', event.id);
    const eventDoc = await txn.get(eventRef);
    if (eventDoc.exists()) return; // Already processed — skip

    // Step 1: Server-side validation (on create/update)
    if (after) {
      const group = await txn.get(doc(db, 'groups', after.groupId));
      const memberIds = new Set(group.data()?.memberIds || []);
      // Validate all split UIDs are group members
      for (const uid of Object.keys(after.splits)) {
        if (!memberIds.has(uid)) {
          await event.data!.after!.ref.delete();
          return; // Reject invalid expense
        }
      }
      // Validate splits sum to amount
      const splitSum = Object.values(after.splits).reduce((a, b) => a + b, 0);
      if (splitSum !== after.amount) {
        await event.data!.after!.ref.delete();
        return; // Reject invalid expense
      }
    }

    // Step 2: Read ALL balance docs first (Firestore requires all reads
    // before any writes in a transaction)
    // On delete: read balances for old splits
    // On create: read balances for new splits
    // On update: read balances for union of old + new split UIDs
    const relevantUids = getRelevantUids(before, after);
    const groupId = (after || before)!.groupId;
    const paidBy = (after || before)!.paidBy;
    const balanceRefs = relevantUids
      .filter(uid => uid !== paidBy)
      .map(uid => doc(db, `groups/${groupId}/balances`,
        `${[paidBy, uid].sort().join('__')}`));
    const balanceDocs = await Promise.all(balanceRefs.map(ref => txn.get(ref)));

    // Step 3: Compute new balance values
    // On delete: reverse old splits
    // On create: apply new splits
    // On update: reverse old splits then apply new splits
    const updates = computeBalanceUpdates(balanceDocs, before, after, paidBy);

    // Step 4: Write ALL balance docs + idempotency marker
    balanceRefs.forEach((ref, i) => txn.set(ref, updates[i]));
    txn.set(eventRef, { processedAt: serverTimestamp() });
  });
});
```

The payer's own share (`splits[paidBy]`) is explicitly skipped — it does not
generate a balance entry.

**Re-entrancy note**: When the Cloud Function deletes an invalid expense
(validation failure), this triggers another `onExpenseWrite` event (a delete).
The idempotency guard handles this — the delete event gets a different
`event.id`, but since the original create never wrote balance updates (it was
rejected before Step 2), the delete handler will find no balance docs to
reverse and exit cleanly. The `computeBalanceUpdates` function must handle
the case where balance docs don't exist (default to zero).

**Debt simplification algorithm** (computed client-side, on-the-fly, NOT
persisted):
```typescript
// utils/debtSimplification.ts
interface Settlement {
  from: string;    // uid
  to: string;      // uid
  amount: number;  // in cents
}

function simplifyDebts(balances: Balance[]): Settlement[] {
  // 1. Compute net balance for each person
  //    net[uid] = total_owed_to_them - total_they_owe
  // 2. Filter out users with |net| < 1 cent (rounding dust)
  // 3. Use two sorted arrays: creditors (net > 0), debtors (net < 0)
  //    Both sorted by absolute amount descending
  // 4. While both arrays are non-empty:
  //    a. Take largest debtor and largest creditor
  //    b. amount = min(|debtor.net|, creditor.net)
  //    c. Record settlement(debtor → creditor, amount)
  //    d. Update both nets: debtor.net += amount, creditor.net -= amount
  //    e. If debtor's remaining net is within rounding tolerance, remove them
  //    f. If creditor's remaining net is within rounding tolerance, remove them
  //    g. Re-insert any party with remaining balance back into sorted position
  // 5. Return settlements (at most n-1 for n people)
  //
  // Note: this greedy algorithm produces a valid minimal-transaction settlement
  // but may not always produce the theoretical minimum (which is NP-hard).
  // For a friends app with <50 users, this is more than sufficient.
}
```

Simplified debts are computed from the live balance snapshot via real-time
listeners. They are NOT persisted — this avoids cache invalidation complexity.
The settlement flow uses transaction-based writes to handle staleness (see
Section 7).

**Security rules for balances and internal collections**:
```
match /groups/{groupId}/balances/{balanceId} {
  // Clients can only read, never write — writes come from Cloud Functions
  allow read: if request.auth != null
    && request.auth.uid in get(/databases/$(database)/documents/
       groups/$(groupId)).data.memberIds;
  allow write: if false;  // Only admin SDK (Cloud Functions) can write
}

// Idempotency guard — explicit deny prevents accidental exposure
match /processedEvents/{eventId} {
  allow read, write: if false;  // Only admin SDK (Cloud Functions)
}
```

---

### 7. Settlement

**What**: "Settle up" flow — shows simplified debts and lets users record
payments. Optionally generate UPI payment links. Only the payer (fromUser)
can initiate a settlement.

**Why**: The point of tracking expenses is to settle them. Making settlement
one-tap reduces friction. Restricting creation to the payer prevents
"mark as paid" fraud.

**How**:

```typescript
// settlements/{settlementId}
interface SettlementRecord {
  id: string;
  groupId: string;
  fromUserId: string;          // the person paying
  toUserId: string;            // the person being paid
  amount: number;              // in cents
  method: "cash" | "upi" | "other";
  note?: string;
  createdBy: string;           // must equal fromUserId
  createdAt: Timestamp;
}
```

**Settlement is NOT a reverse expense.** It is a separate collection with its
own Cloud Function trigger:

```typescript
// functions/src/onSettlementCreate.ts
// Triggered on: settlements/{settlementId} — onCreate

export const onSettlementCreate = onDocumentCreated("settlements/{id}", async (event) => {
  const settlement = event.data?.data() as SettlementRecord;

  await runTransaction(db, async (txn) => {
    // Step 0: Idempotency guard
    const eventRef = doc(db, 'processedEvents', event.id);
    const eventDoc = await txn.get(eventRef);
    if (eventDoc.exists()) return;

    // Step 1: Validate both parties are group members
    const group = await txn.get(doc(db, 'groups', settlement.groupId));
    const memberIds = new Set(group.data()?.memberIds || []);
    if (!memberIds.has(settlement.fromUserId) || !memberIds.has(settlement.toUserId)) {
      await event.data!.ref.delete();
      return; // Reject invalid settlement
    }

    // Step 2: Read current balance
    const balanceDocId = `${[settlement.fromUserId, settlement.toUserId].sort().join('__')}`;
    const balanceRef = doc(db, `groups/${settlement.groupId}/balances`, balanceDocId);
    const balanceDoc = await txn.get(balanceRef);

    // Step 3: Compute and write new balance
    // Subtract settlement amount, flip direction if needed
    const current = balanceDoc.exists() ? balanceDoc.data() : { amount: 0 };
    // ... compute newAmount, potentially flip fromUserId/toUserId ...
    txn.set(balanceRef, { ...updatedBalance, updatedAt: serverTimestamp() });
    txn.set(eventRef, { processedAt: serverTimestamp() });
  });
});
```

For "settle in full", the UI reads the current balance and uses that as the
settlement amount. Because the Cloud Function reads the balance inside a
transaction, any concurrent changes are handled correctly.

UPI link generation (India-specific):
```typescript
// utils/upi.ts
function generateUPILink(payeeVPA: string, amountRupees: number, note: string): string {
  return `upi://pay?pa=${payeeVPA}&am=${amountRupees}&tn=${encodeURIComponent(note)}`;
}
```

**Security rules for settlements**:
```
match /settlements/{settlementId} {
  allow read: if request.auth != null
    && (request.auth.uid == resource.data.fromUserId
        || request.auth.uid == resource.data.toUserId);
  // Only the payer can create; must be a member of the group
  allow create: if request.auth != null
    && request.resource.data.createdBy == request.auth.uid
    && request.resource.data.fromUserId == request.auth.uid
    && request.resource.data.amount > 0
    && request.auth.uid in get(/databases/$(database)/documents/
       groups/$(request.resource.data.groupId)).data.memberIds;
  allow update, delete: if false;  // Settlements are immutable
}
```

---

### 8. UI & Routing

**What**: 6 core pages with React Router, responsive mobile-first design
using Tailwind.

**Why**: Mobile-first because bills are split at restaurants/shops — phone is
the primary device.

**How**:

| Route | Page | Description |
|-------|------|-------------|
| `/` | Dashboard | Group list, overall balance summary |
| `/login` | Login | Google sign-in |
| `/group/:id` | Group Detail | Expenses list, member balances, settle up |
| `/group/:id/add` | Add Expense | Quick expense with split options |
| `/group/:id/bill` | Itemized Bill | Item-by-item bill entry and assignment |
| `/group/:id/settle` | Settle Up | Simplified debts, record payments |

Shared components: `Navbar`, `BottomNav` (mobile), `Avatar`, `AmountInput`,
`MemberPicker`, `CategoryPicker`, `ExpenseCard`, `BalanceSummary`.

---

## Feature Verification

### Scenario 1: End-to-end group expense flow
**Given** users Alice, Bob, and Charlie are members of group "Roommates"
**When** Alice adds a $90.00 dinner expense split equally
**Then** the expense shows splits of $30.00 each (9000 cents / 3 = 3000 each),
Bob and Charlie each owe Alice $30.00, the dashboard shows Alice is owed $60.00,
and Bob/Charlie each owe $30.00.

### Scenario 2: Itemized bill splitting with tax & tip (clean division)
**Given** users Alice and Bob are in group "Dinner"
**When** Alice enters a bill with:
  - Burger ($15.00, qty 1) → assigned to Alice
  - Pasta ($20.00, qty 1) → assigned to Bob
  - Fries ($10.00, qty 1) → shared between both
  - Tax: $4.50, Tip: $9.00
**Then** subtotals are Alice=$20.00, Bob=$25.00 (including $5.00 each for fries)
  - Tax: rawTax[Alice]=500*2000/4500=222.2, rawTax[Bob]=500*2500/4500=277.7
    → floor: 222+277=499, remainder=1 → Bob gets it (larger frac 0.7>0.2)
    → Alice=$2.22, Bob=$2.78. Wait — let me recheck the original scenario...
    Actually 450*2000/4500=200.0 exactly, 450*2500/4500=250.0 exactly.
    Tax=$4.50=450 cents. Alice=200, Bob=250. No remainder. ✓
  - Tip=$9.00=900 cents. Alice=900*2000/4500=400.0, Bob=900*2500/4500=500.0. ✓
  - Alice total: 2000+200+400=2600=$26.00, Bob: 2500+250+500=3250=$32.50
  - Sum: $26.00 + $32.50 = $58.50 = $45.00 + $4.50 + $9.00 ✓
  - If Alice paid, Bob owes Alice $32.50

### Scenario 2b: Itemized bill splitting with rounding
**Given** users Alice, Bob, and Charlie are in group "Dinner"
**When** Alice enters a bill with:
  - Salad ($12.00, qty 1) → Alice
  - Steak ($25.00, qty 1) → Bob
  - Soup ($8.00, qty 1) → Charlie
  - Bread ($6.00, qty 1) → shared among all three
  - Tax: $5.00, Tip: $10.00
**Then** bread split: 600/3 → base=200, remainder=0 → $2.00 each
  Subtotals: Alice=1200+200=1400, Bob=2500+200=2700, Charlie=800+200=1000
  Total subtotal=5100 cents
  Tax (500 cents): rawTax = [500*1400/5100, 500*2700/5100, 500*1000/5100]
    = [137.25, 264.71, 98.04]
    Floor: [137, 264, 98] = 499, remainder = 1
    Largest frac: Bob(0.71) > Alice(0.25) > Charlie(0.04) → Bob gets +1
    Tax: Alice=137, Bob=265, Charlie=98 → sum=500 ✓
  Tip (1000 cents): rawTip = [1000*1400/5100, 1000*2700/5100, 1000*1000/5100]
    = [274.51, 529.41, 196.08]
    Floor: [274, 529, 196] = 999, remainder = 1
    Largest frac: Bob(0.41) > Alice(0.51)... wait: Alice=0.51, Bob=0.41
    → Alice gets +1
    Tip: Alice=275, Bob=529, Charlie=196 → sum=1000 ✓
  Totals: Alice=1400+137+275=1812, Bob=2700+265+529=3494, Charlie=1000+98+196=1294
  Sum: 1812+3494+1294=6600=$66.00 ✓
  If Alice paid: Bob owes $34.94, Charlie owes $12.94

### Scenario 3: Debt simplification
**Given** in group "Trip": Alice owes Bob $50, Bob owes Charlie $30, Charlie
owes Alice $10
**When** the settle-up screen is opened
**Then** nets: Alice=-40, Bob=+20, Charlie=+20. Simplified: Alice pays Bob $20,
Alice pays Charlie $20 (2 transactions instead of 3).

### Scenario 4: Settlement recording
**Given** Bob owes Alice $30.00 in group "Roommates"
**When** Bob records a $30.00 cash payment to Alice
**Then** the Cloud Function (with idempotency guard) reads the current balance
in a transaction, validates both parties are group members, subtracts $30.00,
the balance becomes $0, the group activity shows the settlement, and the
dashboard updates via real-time listener.

### Scenario 5: Concurrent expense + settlement (race condition)
**Given** Bob owes Alice $30.00 in group "Roommates"
**When** Bob initiates a $30.00 settlement AND Charlie simultaneously adds a
$15.00 expense where Bob owes Alice $5.00
**Then** the Cloud Function transactions serialize correctly via Firestore's
optimistic locking: one runs first, the other retries with the updated balance.
Idempotency guards prevent double-application if either function fires twice.
Final state is consistent regardless of execution order.

### Scenario 6: Server-side validation rejects invalid expense
**Given** Alice is a member of group "Roommates"
**When** a crafted client writes an expense with splits that don't sum to the
amount, or splits containing UIDs not in the group
**Then** the `onExpenseWrite` Cloud Function detects the invalid data and deletes
the expense. No balance documents are modified. The client sees the expense
briefly appear then disappear (real-time listener picks up the deletion).

## Tasks

| # | Task | Summary | Verify | Status |
|---|------|---------|--------|--------|
| 1 | Project scaffolding & Cloud Functions setup | Vite + React + TS + Tailwind + Firebase config (including Cloud Functions + emulator), folder structure, env setup, idempotency guard utility | `npm run dev` starts, `firebase emulators:start` runs | [ ] |
| 2 | Authentication + security rules | Google sign-in, AuthContext, protected routes, user doc creation, users security rules (uid/email immutable on update) | Sign in → see dashboard; direct Firestore write with changed email rejected | [ ] |
| 3 | Groups CRUD + invite linking + security rules | Create group (creator-only in memberIds), add members by email, group list, group detail, admin roles, Cloud Function for pending invite linking, groups security rules (admin-only edits, leave-group constrained, creator stays admin) | Create group with 3 members, all see it; non-admin can only leave; non-member read rejected | [ ] |
| 4 | Expenses & splitting + security rules | Add expense with equal/unequal/percentage splits, largest-remainder rounding with percentage normalization, validation (splits sum to total), expense list, edit/delete, expenses + items subcollection security rules (immutable groupId/createdBy, creator/admin-only updates) | Add $100 expense split 3 ways → correct rounding; non-creator update rejected | [ ] |
| 5 | Balance Cloud Function + debt simplification | Cloud Function trigger on expense writes with idempotency guard, server-side validation (split UIDs are members, splits sum to amount), two-phase read-then-write transaction, payer-share exclusion, simplification algorithm with re-insertion, balance security rules (read-only for clients via subcollection) | 3-way circular debt simplifies to 2 transactions; client balance write rejected; duplicate event skipped | [ ] |
| 6 | Itemized bill splitting | Bill entry UI, per-item largest-remainder splitting, member assignment (Set-based dedup, unassigned warning), shared items, tax/tip distribution as single-step largest-remainder (no intermediate proportion), quantity * price handling, validation (all items assigned, qty>=1, price>=0, unique assignees), zero-price freebie behavior | Scenario 2b passes: 3-person split with rounding sums exactly to $66.00 | [ ] |
| 7 | Settlement | Settle-up flow, Cloud Function trigger with idempotency guard + member validation, payer-only creation, UPI link generation, settlement security rules (payer-only, group member, immutable) | Record payment → balance updates; payee cannot create fake settlement; duplicate event skipped | [ ] |
| 8 | UI polish & responsive design | Mobile-first layout, bottom nav, loading states, empty states, toasts, real-time listeners | App is usable on mobile viewport (375px) | [ ] |

## Future Enhancements (Post-MVP)

- **Receipt OCR**: Firebase ML / Google Cloud Vision for receipt scanning
- **Charts & analytics**: Spending trends with Recharts
- **Recurring expenses**: Scheduled expense creation
- **Multi-currency**: Real-time conversion rates
- **Trip mode**: Group expenses by trip with summary
- **Export**: PDF/CSV reports
- **Offline mode**: Service worker + IndexedDB
- **Push notifications**: Firebase Cloud Messaging for reminders
- **PWA**: Install on home screen for app-like experience
- **Discounts/coupons**: Negative line items in itemized bills (requires
  handling negative proportional tax/tip distribution)
- **Settlement confirmation**: Add `pending/confirmed` status so payee
  can confirm receipt of payment
- **processedEvents cleanup**: TTL-based cleanup of the idempotency guard
  collection to prevent unbounded growth
