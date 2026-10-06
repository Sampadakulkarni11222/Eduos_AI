import type { RoleGuide } from './types';
import { askAgentTopic, notificationsTopic, accessTip, signInTopic } from './shared';

export const financeGuide: RoleGuide = {
  slug: 'finance',
  hubTitle: 'Finance Hub',
  hubDesc: 'How to run fee collection in EduOS.',
  heroText: 'Record payments, keep receipts in order, manage fee plans and track collections.',
  quickActions: ['payments', 'record-payment', 'fee-plans', 'reports'],
  help: {
    title: 'Need a correction approved?',
    text: 'Payment changes go to an administrator for approval from the Payments & Fees page.',
    label: 'Open Payments & Fees',
    href: '/finance/payments',
  },
  topics: [
    {
      id: 'dashboard', title: 'Finance overview', category: 'Home Base', icon: '◫',
      href: '/finance', openLabel: 'Open Dashboard',
      summary: 'Payments, fees and financial health at a glance: pending amount, collected amount and recent invoices.',
    },
    {
      id: 'payments', title: 'Invoices and receipts', category: 'Fees', icon: '₹',
      href: '/finance/payments', openLabel: 'Open Payments & Fees',
      summary: 'Every invoice and payment receipt in the school.',
      highlights: [
        { label: 'Invoices', text: 'Total, paid, due date and status for each invoice.' },
        { label: 'Payment Receipts', text: 'Receipt and invoice numbers, amounts, method/reference and verification status.' },
        { label: 'Totals', text: 'Total billed, collected and pending, and the number of pending invoices.' },
      ],
    },
    {
      id: 'record-payment', title: 'Record an offline payment', shortTitle: 'Record a Payment', category: 'Fees', icon: '✍',
      href: '/finance/payments', openLabel: 'Open Payments & Fees',
      summary: 'Log a payment made at the school office against an invoice.',
      steps: [
        'Find the invoice and click Record.',
        'Enter the amount, payment date and method: Cash, Cheque, DD / Demand Draft, or Online / Bank transfer.',
        'Add the receipt number and the reference (cheque/DD/transaction number, bank name), plus notes.',
        'Attach the proof that is required and save.',
      ],
      tips: [
        'Cheques and demand drafts need a photo or scan.',
        'Bank transfers need both the transaction ID and the bank\'s UTR, so they can be reconciled later.',
      ],
    },
    {
      id: 'payment-changes', title: 'Correct a payment', category: 'Fees', icon: '⇄',
      href: '/finance/payments', openLabel: 'Open Payments & Fees',
      summary: 'Recorded payments are not edited directly. You request a change and an administrator approves it.',
      steps: [
        'On the receipt, click "Request change".',
        'Choose the field to change, enter the new value and the reason, and attach a supporting document if you have one.',
        'Submit. The change waits for an administrator and appears in their Approvals tab.',
      ],
    },
    {
      id: 'fee-plans', title: 'Fee plans and installments', shortTitle: 'Fee Plans', category: 'Fees', icon: '▤',
      href: '/finance/payments', openLabel: 'Open Payments & Fees',
      summary: 'Set up how a student pays over the year.',
      workflow: ['New plan', 'Submit for review', 'Mark reviewed', 'Request admin approval', 'Live for the student'],
      steps: [
        'Click "New plan" and fill in the student, plan name, total fee, payment mode and number of installments, with each installment\'s amount and due date.',
        'Click "Submit for review".',
        'A finance reviewer clicks "Mark reviewed", then "Request admin approval". The plan shows "Waiting on an administrator".',
        'Once an administrator approves it, it shows "Live for the student" on their Payments page.',
      ],
      tips: ['A rejected plan can be corrected and submitted for review again.'],
    },
    {
      id: 'reports', title: 'Financial reports', category: 'Reports', icon: '📊',
      href: '/finance/reports', openLabel: 'Open Reports',
      summary: 'Detailed analytics of fee collections.',
      highlights: [
        { label: 'Collection by Class', text: 'Invoices, billed, collected and pending for each class.' },
        { label: 'Invoice Status Summary', text: 'Realized revenue, outstanding balances and the billed target.' },
      ],
    },
    askAgentTopic({
      askAbout: [
        'pending fees and fee statistics', 'invoices, payments and payment history', 'fee plans and fee structures',
        'payment change requests', 'students and their classes', 'announcements',
      ],
      canDo: [
        'raise or generate invoices', 'record or refund a payment', 'create, update and move fee plans through approval',
        'request a payment change', 'create fee heads and fee structures',
      ],
      examples: ['Show all overdue invoices', 'List recently paid fee invoices', 'How much fee is pending in Class 8?'],
    }),
    signInTopic(),
    { ...notificationsTopic, tips: [accessTip] },
  ],
};
