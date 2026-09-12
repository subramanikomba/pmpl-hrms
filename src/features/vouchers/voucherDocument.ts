import { amountInWords, formatDate, formatMonth } from '@/lib/format';
import { loadLogo } from '@/features/payroll/slipDocument';
import type { CompanySettings, Employee } from '@/types/db';

/**
 * Payment vouchers, PDF only.
 *
 * One data model and one generator serve both reimbursement and company
 * advance vouchers, so the two cannot drift in layout or field order. The
 * only difference is the body: a reimbursement lists the claims it settled,
 * an advance does not.
 *
 * A voucher is always rebuilt from the stored transaction, so it stays
 * available indefinitely and never expires with the month.
 */

/** One claim settled by a reimbursement payment. */
export interface VoucherClaimLine {
  date: string;
  category: string;
  description: string | null;
  /** The claim's approved value. */
  approved: number;
  /** Reimbursed before this payment. */
  previouslyPaid: number;
  /** Reimbursed by THIS payment — what the voucher total is made of. */
  paidNow: number;
  /** Still outstanding after this payment. */
  outstanding: number;
}

export interface VoucherData {
  kind: 'reimbursement' | 'advance';
  voucherNo: string;
  paymentDate: string;
  /** The amount actually paid in this transaction. */
  amount: number;
  paymentMode: string;
  reference: string | null;
  notes: string | null;
  employee: Employee;
  settings: CompanySettings;
  /** Reimbursement only: the claims this payment settled. */
  claims?: VoucherClaimLine[];
}

export function voucherFilename(v: VoucherData): string {
  const name = `${v.employee.first_name}_${v.employee.last_name}`
    .replace(/\s+/g, '_');
  return `${v.voucherNo}_${v.employee.employee_code}_${name}.pdf`;
}

/** The period the settled claims fall in, e.g. "August 2026". */
function expensePeriod(claims: VoucherClaimLine[]): string {
  if (claims.length === 0) return '—';
  const months = [...new Set(claims.map((c) => c.date.slice(0, 7)))].sort();
  const label = (m: string) =>
    formatMonth(new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1));
  const first = months[0] as string;
  const last = months[months.length - 1] as string;
  return months.length === 1 ? label(first) : `${label(first)} – ${label(last)}`;
}

async function buildVoucher(v: VoucherData) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const c = v.settings;

  // Geometry and tone deliberately match the salary slip.
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

  // ── Company header ──────────────────────────────────────────
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
  doc.text('PAYMENT VOUCHER', 105, y, { align: 'center' });
  y += 3.5;
  doc.setLineWidth(RULE).line(LM, y, R, y);

  // ── Voucher and employee particulars ────────────────────────
  y += 8;
  doc.setFontSize(9);
  const LBL_W = 38;
  const pairs: [string, string][] = [
    ['Voucher No.', v.voucherNo],
    ['Payment Date', formatDate(v.paymentDate)],
    ['Employee Name', `${v.employee.first_name} ${v.employee.last_name}`],
    ['Employee Code', v.employee.employee_code],
    ['Designation', v.employee.designation ?? '—'],
    ['Payment Type', v.kind === 'reimbursement'
      ? 'Expense Reimbursement' : 'Company Advance'],
  ];
  for (const [label, value] of pairs) {
    doc.setFont('helvetica', 'normal').setTextColor(MUTED);
    doc.text(label, LM, y);
    doc.setFont('helvetica', 'bold').setTextColor(INK);
    doc.text(fit(value, W - LBL_W), LM + LBL_W, y);
    y += 5.4;
  }

  // ── Claims settled (reimbursement only) ─────────────────────
  if (v.kind === 'reimbursement' && v.claims && v.claims.length > 0) {
    y += 2;
    doc.setLineWidth(HAIR).line(LM, y, R, y);
    y += 5;
    doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(INK);
    doc.text('EXPENSES REIMBURSED', LM, y);
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(MUTED);
    doc.text(`Expense Period: ${expensePeriod(v.claims)}`, R, y,
      { align: 'right' });
    y += 4.5;

    // Columns: date, category, approved, previously paid, paid now, outstanding.
    const C0 = LM, C1 = LM + 26, C2 = LM + 74, C3 = LM + 104, C4 = LM + 133, C5 = R;
    doc.setFontSize(7.5).setTextColor(MUTED);
    doc.text('Date', C0, y);
    doc.text('Category', C1, y);
    doc.text('Approved', C2, y, { align: 'right' });
    doc.text('Prev. paid', C3, y, { align: 'right' });
    doc.text('Paid now', C4, y, { align: 'right' });
    doc.text('Outstanding', C5, y, { align: 'right' });
    y += 1.8;
    doc.setLineWidth(HAIR).line(LM, y, R, y);
    y += 4.4;

    doc.setFontSize(8.5).setTextColor(INK);
    for (const cl of v.claims) {
      doc.setFont('helvetica', 'normal');
      doc.text(formatDate(cl.date), C0, y);
      doc.text(fit(cl.category, 44), C1, y);
      doc.text(money(cl.approved), C2, y, { align: 'right' });
      doc.text(money(cl.previouslyPaid), C3, y, { align: 'right' });
      doc.setFont('helvetica', 'bold');
      doc.text(money(cl.paidNow), C4, y, { align: 'right' });
      doc.setFont('helvetica', 'normal');
      doc.text(money(cl.outstanding), C5, y, { align: 'right' });
      y += 5;
    }
    doc.setLineWidth(HAIR).line(LM, y - 2.6, R, y - 2.6);
    doc.setFont('helvetica', 'bold').setFontSize(9);
    doc.text('Total Reimbursement', C1, y + 1.6);
    doc.text(money(v.amount), C4, y + 1.6, { align: 'right' });
    y += 7;
  }

  // ── Payment details ─────────────────────────────────────────
  y += 2;
  doc.setLineWidth(HAIR).line(LM, y, R, y);
  y += 5.5;
  doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(INK);
  doc.text('PAYMENT DETAILS', LM, y);
  y += 5.5;

  const payPairs: [string, string][] = [
    [v.kind === 'advance' ? 'Advance Amount' : 'Amount Paid', money(v.amount)],
    ['Payment Mode', v.paymentMode],
    ['UTR / Reference No.', v.reference ?? '—'],
  ];
  if (v.notes) payPairs.push(['Purpose / Notes', v.notes]);

  doc.setFontSize(9);
  for (const [label, value] of payPairs) {
    doc.setFont('helvetica', 'normal').setTextColor(MUTED);
    doc.text(label, LM, y);
    doc.setFont('helvetica', 'bold').setTextColor(INK);
    doc.text(fit(value, W - LBL_W), LM + LBL_W, y);
    y += 5.4;
  }

  y += 1;
  doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(MUTED);
  doc.text('Amount in words:', LM, y);
  doc.setFont('helvetica', 'bold').setTextColor(INK).setFontSize(9);
  doc.text(fit(amountInWords(v.amount), W - 32), LM + 32, y);
  y += 6;

  if (v.kind === 'reimbursement') {
    doc.setFont('helvetica', 'italic').setFontSize(8).setTextColor(MUTED);
    doc.text(
      'These expenses were paid by the employee and have been reimbursed by the company.',
      LM, y,
    );
    y += 6;
  }

  // ── Signatures ──────────────────────────────────────────────
  const sy = Math.max(y + 18, 250);
  doc.setLineWidth(HAIR);
  doc.line(LM, sy, LM + 60, sy);
  doc.line(R - 60, sy, R, sy);
  doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(MUTED);
  doc.text('Employee Acknowledgement', LM, sy + 4.5);
  doc.text('Authorised Signatory', R, sy + 4.5, { align: 'right' });
  doc.setTextColor(INK).setFontSize(8.5);
  doc.text(`${v.employee.first_name} ${v.employee.last_name}`, LM, sy + 9);
  doc.text(`For ${c.company_name}`, R, sy + 9, { align: 'right' });

  return doc;
}

/** Build the voucher and trigger a download. */
export async function generateVoucherPdf(v: VoucherData): Promise<void> {
  const doc = await buildVoucher(v);
  doc.save(voucherFilename(v));
}

/** Build the voucher and return a blob URL, for the in-app viewer. */
export async function generateVoucherPreview(v: VoucherData): Promise<string> {
  const doc = await buildVoucher(v);
  return URL.createObjectURL(doc.output('blob'));
}

/* ── Advance utilisation report ─────────────────────────────────── */

/** One expense accounted against an advance. */
export interface UtilisationLine {
  date: string;
  category: string;
  description: string | null;
  /** The amount accounted against the advance, not the claim's full value. */
  accounted: number;
}

export interface UtilisationData {
  voucherNo: string;
  advanceDate: string;
  advanceAmount: number;
  reference?: string | null;
  notes?: string | null;
  employee: Employee;
  settings: CompanySettings;
  lines: UtilisationLine[];
}

/**
 * How a company advance has been used.
 *
 * A companion to the advance voucher, which shows only the amount given. The
 * figures come from the existing accounting records — the accounted amounts
 * already stored on each expense — so this introduces no second balance.
 */
async function buildUtilisation(u: UtilisationData) {
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
  doc.text('ADVANCE UTILISATION REPORT', 105, y, { align: 'center' });
  y += 3.5;
  doc.setLineWidth(RULE).line(LM, y, R, y);

  y += 8;
  doc.setFontSize(9);
  const LBL_W = 38;
  const pairs: [string, string][] = [
    ['Advance Voucher No.', u.voucherNo],
    ['Employee Name', `${u.employee.first_name} ${u.employee.last_name}`],
    ['Employee Code', u.employee.employee_code],
    ['Advance Date', formatDate(u.advanceDate)],
    ['Advance Amount', money(u.advanceAmount)],
    ...(u.reference ? [['UTR / Reference No.', u.reference] as [string, string]] : []),
    ...(u.notes ? [['Purpose / Notes', u.notes] as [string, string]] : []),
  ];
  for (const [label, value] of pairs) {
    doc.setFont('helvetica', 'normal').setTextColor(MUTED);
    doc.text(label, LM, y);
    doc.setFont('helvetica', 'bold').setTextColor(INK);
    doc.text(fit(value, W - LBL_W), LM + LBL_W, y);
    y += 5.4;
  }

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
  doc.text('Accounted', C3, y, { align: 'right' });
  y += 1.8;
  doc.setLineWidth(HAIR).line(LM, y, R, y);
  y += 4.4;

  doc.setFontSize(8.5).setTextColor(INK);
  if (u.lines.length === 0) {
    doc.setTextColor(MUTED);
    doc.text('No expenses have been accounted against this advance yet.', LM, y);
    y += 5;
    doc.setTextColor(INK);
  }
  for (const l of u.lines) {
    doc.text(formatDate(l.date), C0, y);
    doc.text(fit(l.category, 38), C1, y);
    doc.text(fit(l.description ?? '—', 70), C2, y);
    doc.text(money(l.accounted), C3, y, { align: 'right' });
    y += 5;
  }

  const utilised = u.lines.reduce((t, l) => t + Number(l.accounted), 0);
  const remaining = Number(u.advanceAmount) - utilised;

  doc.setLineWidth(HAIR).line(LM, y - 2.6, R, y - 2.6);
  y += 2;
  doc.setFont('helvetica', 'bold').setFontSize(9);
  doc.text('Total Utilised', C2, y);
  doc.text(money(utilised), C3, y, { align: 'right' });
  y += 5.4;
  doc.text(remaining >= 0 ? 'Remaining / Unutilised' : 'Over-utilised', C2, y);
  doc.text(money(Math.abs(remaining)), C3, y, { align: 'right' });
  y += 7;

  doc.setFont('helvetica', 'italic').setFontSize(8).setTextColor(MUTED);
  doc.text(
    'Figures are taken from the company advance ledger. This report is not a payment document.',
    LM, y,
  );

  const sy = Math.max(y + 20, 250);
  doc.setLineWidth(HAIR).line(R - 60, sy, R, sy);
  doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(MUTED);
  doc.text('Authorised Signatory', R, sy + 4.5, { align: 'right' });
  doc.setTextColor(INK).setFontSize(8.5);
  doc.text(`For ${c.company_name}`, R, sy + 9, { align: 'right' });

  return doc;
}

export function utilisationFilename(u: UtilisationData): string {
  const name = `${u.employee.first_name}_${u.employee.last_name}`
    .replace(/\s+/g, '_');
  return `${u.voucherNo}_Utilisation_${name}.pdf`;
}

export async function generateUtilisationPdf(u: UtilisationData): Promise<void> {
  const doc = await buildUtilisation(u);
  doc.save(utilisationFilename(u));
}

export async function generateUtilisationPreview(u: UtilisationData): Promise<string> {
  const doc = await buildUtilisation(u);
  return URL.createObjectURL(doc.output('blob'));
}
