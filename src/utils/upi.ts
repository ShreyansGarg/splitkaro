export function generateUPILink(
  payeeVPA: string,
  amountRupees: number,
  note: string
): string {
  return `upi://pay?pa=${encodeURIComponent(payeeVPA)}&am=${amountRupees}&tn=${encodeURIComponent(note)}`;
}
