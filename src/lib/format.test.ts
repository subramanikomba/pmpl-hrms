import { describe, expect, it } from 'vitest';
import { amountInWords, maskPan, monthInputValue, parseMonthInput } from './format';

describe('amountInWords', () => {
  it('handles zero', () => {
    expect(amountInWords(0)).toBe('Rupees Zero Only');
  });
  it('leads with "Rupees" and ends with "Only"', () => {
    expect(amountInWords(5484.68)).toBe(
      'Rupees Five Thousand Four Hundred Eighty Four and Sixty Eight Paise Only',
    );
  });
  it('uses the Indian numbering system', () => {
    expect(amountInWords(100)).toBe('Rupees One Hundred Only');
    expect(amountInWords(1500)).toBe('Rupees One Thousand Five Hundred Only');
    expect(amountInWords(125000)).toContain('Lakh');
    expect(amountInWords(12500000)).toContain('Crore');
  });
  it('includes paise when present', () => {
    expect(amountInWords(1.5)).toContain('Fifty Paise');
  });
});

describe('maskPan', () => {
  it('masks the middle of a PAN', () => {
    expect(maskPan('ABCDE1234F')).toBe('ABCXXXXX4F');
  });
  it('returns a dash when absent', () => {
    expect(maskPan(null)).toBe('—');
    expect(maskPan('')).toBe('—');
  });
});

describe('month input helpers', () => {
  it('round-trips a month value', () => {
    const d = new Date(2026, 7, 1);
    const v = monthInputValue(d);
    expect(v).toBe('2026-08');
    const parsed = parseMonthInput(v);
    expect(parsed?.getFullYear()).toBe(2026);
    expect(parsed?.getMonth()).toBe(7);
  });
  it('rejects malformed input', () => {
    expect(parseMonthInput('nonsense')).toBeNull();
  });
});
