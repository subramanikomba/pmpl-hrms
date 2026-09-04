import { describe, expect, it } from 'vitest';
import { paymentStateFor } from './payment';

const due = new Date(2026, 8, 10); // 10 Sep 2026

describe('paymentStateFor', () => {
  it('is Paid only when a payment was actually recorded', () => {
    expect(paymentStateFor({
      status: 'paid', paymentDate: '2026-09-09', dueDate: due,
      today: new Date(2026, 8, 12),
    })).toBe('paid');
  });

  it('does not treat finalised payroll as paid', () => {
    // status processed, before the due date -> payable, never paid
    expect(paymentStateFor({
      status: 'processed', paymentDate: null, dueDate: due,
      today: new Date(2026, 8, 4),
    })).toBe('payable');
  });

  it('is Overdue once the due date has passed unpaid', () => {
    expect(paymentStateFor({
      status: 'processed', paymentDate: null, dueDate: due,
      today: new Date(2026, 8, 11),
    })).toBe('overdue');
  });

  it('is still Payable on the due date itself', () => {
    expect(paymentStateFor({
      status: 'processed', paymentDate: null, dueDate: due,
      today: new Date(2026, 8, 10, 18, 0),
    })).toBe('payable');
  });

  it('reports draft or missing payroll as not processed', () => {
    expect(paymentStateFor({
      status: 'draft', paymentDate: null, dueDate: due, today: new Date(2026, 8, 20),
    })).toBe('not_processed');
    expect(paymentStateFor({
      status: null, paymentDate: null, dueDate: due, today: new Date(2026, 8, 20),
    })).toBe('not_processed');
  });

  it('falls back to payable when paid is claimed without a payment date', () => {
    expect(paymentStateFor({
      status: 'paid', paymentDate: null, dueDate: due, today: new Date(2026, 8, 4),
    })).toBe('payable');
  });
});
