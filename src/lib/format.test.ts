import { describe, expect, it } from 'vitest';
import { amountInWords, monthInputValue, ordinalDay, parseMonthInput } from './format';

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

describe('ordinalDay', () => {
  it('uses st, nd, rd for 1, 2, 3', () => {
    expect(ordinalDay(1)).toBe('1st');
    expect(ordinalDay(2)).toBe('2nd');
    expect(ordinalDay(3)).toBe('3rd');
  });
  it('uses th for the teens, which are the trap', () => {
    expect(ordinalDay(11)).toBe('11th');
    expect(ordinalDay(12)).toBe('12th');
    expect(ordinalDay(13)).toBe('13th');
  });
  it('uses th for everything else, and st/nd/rd again from 21', () => {
    expect(ordinalDay(10)).toBe('10th');
    expect(ordinalDay(21)).toBe('21st');
    expect(ordinalDay(22)).toBe('22nd');
    expect(ordinalDay(23)).toBe('23rd');
    expect(ordinalDay(28)).toBe('28th');
    expect(ordinalDay(31)).toBe('31st');
  });
});
