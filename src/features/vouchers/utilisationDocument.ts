import { formatDate } from '@/lib/format';
import { loadLogo } from '@/features/payroll/slipDocument';
import type { CompanySettings, Employee } from '@/types/db';

/**
 * Advance Utilisation report.
 *
 * The advance voucher records the payment; this shows what became of it —
 * which approved expenses were accounted against the advance, and how much
 * remains unutilised.
 *
 * Figures come from the existing Company Advance accounting: the advance
 * amount and each expense's accounted_amount. Nothing is recalculated here,
 * so this can never disagree with the ledger balance.
 */

export interface UtilisationLine {
  date: string;
  category: string;
  description: string | null;
  /** The amount of this claim accounted against the advance. */
  accounted: number;
}

export interface UtilisationData {
  voucherNo: string;
  employee: Employee;
  settings: CompanySettings;
  advanceDate: string;
  advanceAmount: number;
  reference: string | null;
  notes: string | null;
  lines: UtilisationLine[];
}

export function utilisationFilename(u: UtilisationData): string {
  const name = `${u.employee.first_name}_${u.employee.last_name}`
    .replace(/\s+/g, '_');
  return `${u.voucherNo}_Utilisation_${name}.pdf`;
}

async function build(u: UtilisationData) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const c = u.settings;

  const LM = 15, W = 180, R = LM + W;
  const HAIR = 0.2, RULE = 0.4;
  const INK = 0, MUTED = 105;
  doc.setDrawColor(60).setLineWidth(HAIR);

  const money = (n: number) => Number(n).toLocaleString('en-IN', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  const fit = (text: string, maxW: number) => {
    let t = text;
    while (t.length > 4 && doc.getTextWidth(t) > maxW) t = t.slice(0, -1);
    return t === text ? t : t.replace(/.$/, '…');
  };

  // ── Company header, matching the voucher and slip ───────────
  const logo = await loadLogo();
  doc.setTextColor(INK).setFont('helvetica', 'bold').setFontSize(14);
  const nameW = doc.getTextWidth(c.company_name);
  const LOGO_H = 8;
  const logoW = logo ? Math.round(LOGO_H * (logo.w / logo.h) * 100) / 100 : 0;
  const GAP = logo ? 4 : 0;
  const startX = 105 - (logoW + GAP + nameW) / 2;
  if (logo) {
    doc.addImage(logo.data, 'JPEG', startX, 18 - LOGO_H + 1.4, logoW, LOGO_H);
  }
  doc.text(c.company_name, startX + logoW + GAP, 18);

  doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(MUTED);
  let y = 23.5;
  if (c.address) { doc.text(c.address, 105, y, { align: 'center' }); y += 4.2; }
  doc.text(`CIN: ${c.cin ?? '—'}    GST: ${c.gst_number ?? '—'}`, 105, y,
    { align: 'center' });
  y += 4;

  doc.setLineWidth(RULE).line(LM, y, R, y);
  y += 6.5;
  doc.setTextColor(INK).setFont('helvetica', 'bold').setFontSize(10.5);
  doc.text('ADVANCE UTILISATION', 105, y, { align: 'center' });
  y += 3.5;
  doc.setLineWidth(RULE).line(LM, y, R, y);

  // ── Particulars ─────────────────────────────────────────────
  y += 8;
  doc.setFontSize(9);
  const LBL_W = 38;
  const pairs: [string, string][] = [
    ['Voucher No.', u.voucherNo],
    ['Employee Name', `${u.employee.first_name} ${u.employee.last_name}`],
    ['Employee Code', u.employee.employee_code],
    ['Advance Date', formatDate(u.advanceDate)],
    ['Advance Amount', money(u.advanceAmount)],
  ];
  if (u.reference) pairs.push(['Reference', u.reference]);
  if (u.notes) pairs.push(['Purpose / Notes', u.notes]);

  for (const [label, value] of pairs) {
    doc.setFont('helvetica', 'normal').setTextColor(MUTED);
    doc.text(label, LM, y);
    doc.setFont('helvetica', 'bold').setTextColor(INK);
    doc.text(fit(value, W - LBL_W), LM + LBL_W, y);
    y += 5.4;
  }

  // ── Expenses accounted against the advance ──────────────────
  y += 2;
  doc.setLineWidth(HAIR).line(LM, y, R, y);
  y += 5;
  doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(INK);
  doc.text('EXPENSES ACCOUNTED AGAINST THIS ADVANCE', LM, y);
  y += 5;

  const C0 = LM, C1 = LM + 28, C2 = LM + 70, C3 = R;
  doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(MUTED);
  doc.text('Date', C0, y);
  doc.text('Category', C1, y);
  doc.text('Description', C2, y);
  doc.text('Amount accounted', C3, y, { align: 'right' });
  y += 1.8;
  doc.setLineWidth(HAIR).line(LM, y, R, y);
  y += 4.4;

  doc.setFontSize(8.5).setTextColor(INK);
  if (u.lines.length === 0) {
    doc.setTextColor(MUTED);
    doc.text('No expenses have been accounted against this advance yet.', C0, y);
    y += 5;
    doc.setTextColor(INK);
  } else {
    for (const l of u.lines) {
      doc.text(formatDate(l.date), C0, y);
      doc.text(fit(l.category, 38), C1, y);
      doc.text(fit(l.description ?? '—', 70), C2, y);
      doc.text(money(l.accounted), C3, y, { align: 'right' });
      y += 5;
    }
  }

  const utilised = u.lines.reduce((t, l) => t + Number(l.accounted), 0);
  const remaining = Math.round((Number(u.advanceAmount) - utilised) * 100) / 100;

  doc.setLineWidth(HAIR).line(LM, y - 2.6, R, y - 2.6);
  y += 2;
  doc.setFont('helvetica', 'bold').setFontSize(9);
  doc.text('Total utilised', C1, y);
  doc.text(money(utilised), C3, y, { align: 'right' });
  y += 5.4;
  doc.setFont('helvetica', 'normal').setTextColor(MUTED);
  doc.text('Advance amount', C1, y);
  doc.setTextColor(INK);
  doc.text(money(u.advanceAmount), C3, y, { align: 'right' });
  y += 5.4;
  doc.setFont('helvetica', 'bold').setTextColor(INK);
  doc.text('Remaining / unutilised', C1, y);
  doc.text(money(remaining), C3, y, { align: 'right' });
  y += 8;

  doc.setFont('helvetica', 'italic').setFontSize(8).setTextColor(MUTED);
  doc.text(
    'Figures are taken from the Company Advance ledger. This report records '
    + 'utilisation only; it is not a payment document.',
    LM, y,
  );

  // ── Signature ───────────────────────────────────────────────
  const sy = Math.max(y + 18, 250);
  doc.setLineWidth(HAIR).line(R - 60, sy, R, sy);
  doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(MUTED);
  doc.text('Authorised Signatory', R, sy + 4.5, { align: 'right' });
  doc.setTextColor(INK).setFontSize(8.5);
  doc.text(`For ${c.company_name}`, R, sy + 9, { align: 'right' });

  return doc;
}

export async function generateUtilisationPdf(u: UtilisationData): Promise<void> {
  const doc = await build(u);
  doc.save(utilisationFilename(u));
}

export async function generateUtilisationPreview(
  u: UtilisationData,
): Promise<string> {
  const doc = await build(u);
  return URL.createObjectURL(doc.output('blob'));
}
