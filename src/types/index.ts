import { Timestamp } from 'firebase/firestore';

export interface User {
  uid: string;
  displayName: string;
  email: string;
  photoURL: string | null;
  groupIds: string[];
  createdAt: Timestamp;
}

export interface Group {
  id: string;
  name: string;
  description?: string;
  emoji?: string;
  memberIds: string[];
  pendingEmails: string[];
  adminIds: string[];
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type ExpenseCategory =
  | 'food'
  | 'transport'
  | 'shopping'
  | 'entertainment'
  | 'rent'
  | 'utilities'
  | 'groceries'
  | 'travel'
  | 'other';

export type SplitType = 'equal' | 'unequal' | 'percentage' | 'itemized';

export interface Expense {
  id: string;
  groupId: string;
  description: string;
  amount: number;
  currency: string;
  category: ExpenseCategory;
  paidBy: string;
  splitType: SplitType;
  splits: Record<string, number>;
  itemizedBillId?: string;
  date: Timestamp;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface BillItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  assignedTo: string[];
}

export interface ItemizedBill {
  items: BillItem[];
  subtotal: number;
  taxAmount: number;
  tipAmount: number;
  total: number;
  paidBy: string;
  groupId: string;
}

export interface Balance {
  groupId: string;
  fromUserId: string;
  toUserId: string;
  amount: number;
  updatedAt: Timestamp;
}

export interface Settlement {
  from: string;
  to: string;
  amount: number;
}

export interface SettlementRecord {
  id: string;
  groupId: string;
  fromUserId: string;
  toUserId: string;
  amount: number;
  method: 'cash' | 'upi' | 'other';
  note?: string;
  createdBy: string;
  createdAt: Timestamp;
}
