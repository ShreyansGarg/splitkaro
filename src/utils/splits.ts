export function splitEqual(
  amountCents: number,
  memberIds: string[]
): Record<string, number> {
  const base = Math.floor(amountCents / memberIds.length);
  const remainder = amountCents - base * memberIds.length;
  const result: Record<string, number> = {};
  memberIds.forEach((id, i) => {
    result[id] = base + (i < remainder ? 1 : 0);
  });
  return result;
}

export function splitUnequal(
  totalAmountCents: number,
  shares: Record<string, number>
): Record<string, number> {
  const sum = Object.values(shares).reduce((a, b) => a + b, 0);
  if (sum !== totalAmountCents) {
    throw new Error(
      `Shares sum to ${sum}, but expense total is ${totalAmountCents}`
    );
  }
  return shares;
}

export function splitByPercentage(
  amountCents: number,
  percentages: Record<string, number>
): Record<string, number> {
  const totalPct = Object.values(percentages).reduce((a, b) => a + b, 0);
  if (Math.abs(totalPct - 100) > 1) {
    throw new Error(`Percentages sum to ${totalPct}%, expected ~100%`);
  }

  const entries = Object.entries(percentages);
  const normalized = entries.map(([, pct]) => (pct * 100) / totalPct);
  const rawShares = normalized.map((pct) => (amountCents * pct) / 100);
  const floored = rawShares.map((s) => Math.floor(s));
  let remainder = amountCents - floored.reduce((a, b) => a + b, 0);

  const fractionals = rawShares
    .map((s, i) => ({ i, frac: s - floored[i]! }))
    .sort((a, b) => b.frac - a.frac);

  for (let j = 0; j < remainder; j++) {
    floored[fractionals[j]!.i]!++;
  }

  const result: Record<string, number> = {};
  entries.forEach(([uid], i) => {
    result[uid] = floored[i]!;
  });
  return result;
}

export function centsToDollars(cents: number): number {
  return cents / 100;
}

export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

export function formatCurrency(cents: number, currency = 'USD'): string {
  const dollars = centsToDollars(cents);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(dollars);
}
