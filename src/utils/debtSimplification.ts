import type { Balance, Settlement } from '@/types';

export function simplifyDebts(balances: Balance[]): Settlement[] {
  const net: Record<string, number> = {};

  for (const b of balances) {
    net[b.toUserId] = (net[b.toUserId] ?? 0) + b.amount;
    net[b.fromUserId] = (net[b.fromUserId] ?? 0) - b.amount;
  }

  const creditors: { uid: string; amount: number }[] = [];
  const debtors: { uid: string; amount: number }[] = [];

  for (const [uid, amount] of Object.entries(net)) {
    if (amount > 0) {
      creditors.push({ uid, amount });
    } else if (amount < -0) {
      debtors.push({ uid, amount: -amount });
    }
  }

  creditors.sort((a, b) => b.amount - a.amount);
  debtors.sort((a, b) => b.amount - a.amount);

  const settlements: Settlement[] = [];
  let ci = 0;
  let di = 0;

  while (ci < creditors.length && di < debtors.length) {
    const creditor = creditors[ci]!;
    const debtor = debtors[di]!;
    const amount = Math.min(debtor.amount, creditor.amount);

    if (amount < 1) {
      ci++;
      di++;
      continue;
    }

    settlements.push({
      from: debtor.uid,
      to: creditor.uid,
      amount,
    });

    creditor.amount -= amount;
    debtor.amount -= amount;

    if (creditor.amount < 1) ci++;
    if (debtor.amount < 1) di++;
  }

  return settlements;
}
