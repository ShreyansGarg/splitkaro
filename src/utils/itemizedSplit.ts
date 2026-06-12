import type { ItemizedBill } from '@/types';

function largestRemainderDistribute(
  totalCents: number,
  proportions: { uid: string; share: number }[]
): Record<string, number> {
  if (proportions.length === 0) return {};

  const totalShare = proportions.reduce((sum, p) => sum + p.share, 0);
  if (totalShare === 0) {
    const result: Record<string, number> = {};
    for (const p of proportions) {
      result[p.uid] = 0;
    }
    return result;
  }

  const raw = proportions.map((p) => (totalCents * p.share) / totalShare);
  const floored = raw.map((v) => Math.floor(v));
  let remainder = totalCents - floored.reduce((a, b) => a + b, 0);

  const fractionals = raw
    .map((v, i) => ({ i, frac: v - floored[i]! }))
    .sort((a, b) => b.frac - a.frac);

  for (let j = 0; j < remainder; j++) {
    floored[fractionals[j]!.i]!++;
  }

  const result: Record<string, number> = {};
  proportions.forEach((p, i) => {
    result[p.uid] = floored[i]!;
  });
  return result;
}

export function calculateItemizedSplits(
  bill: ItemizedBill
): Record<string, number> {
  const personSubtotal: Record<string, number> = {};

  for (const item of bill.items) {
    if (item.assignedTo.length === 0) {
      throw new Error(`Item "${item.name}" has no assignees`);
    }
    if (item.quantity < 1) {
      throw new Error(`Item "${item.name}" has invalid quantity`);
    }
    if (item.price < 0) {
      throw new Error(`Item "${item.name}" has negative price`);
    }

    const uniqueAssignees = [...new Set(item.assignedTo)];
    const lineTotal = item.price * item.quantity;
    const base = Math.floor(lineTotal / uniqueAssignees.length);
    const remainder = lineTotal - base * uniqueAssignees.length;

    for (let i = 0; i < uniqueAssignees.length; i++) {
      const uid = uniqueAssignees[i]!;
      const share = base + (i < remainder ? 1 : 0);
      personSubtotal[uid] = (personSubtotal[uid] ?? 0) + share;
    }
  }

  const uids = Object.keys(personSubtotal);
  const proportions = uids.map((uid) => ({
    uid,
    share: personSubtotal[uid]!,
  }));

  const taxDistribution = largestRemainderDistribute(
    bill.taxAmount,
    proportions
  );
  const tipDistribution = largestRemainderDistribute(
    bill.tipAmount,
    proportions
  );

  const result: Record<string, number> = {};
  for (const uid of uids) {
    result[uid] =
      personSubtotal[uid]! +
      (taxDistribution[uid] ?? 0) +
      (tipDistribution[uid] ?? 0);
  }

  const total = Object.values(result).reduce((a, b) => a + b, 0);
  if (total !== bill.total) {
    throw new Error(
      `Split total ${total} does not match bill total ${bill.total}`
    );
  }

  return result;
}
