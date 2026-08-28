/**
 * Salary slip generation. jsPDF and docx are imported dynamically so they are
 * code-split out of the main bundle and only downloaded when a slip is made.
 */
import { amountInWords, formatDate, formatMonth, maskPan } from '@/lib/format';
import logoUrl from '@/assets/logo.jpg';
import type { CompanySettings, Employee, PayrollRecord } from '@/types/db';

export interface SlipData {
  employee: Employee;
  payroll: PayrollRecord;
  settings: CompanySettings;
  month: Date;
}

interface Line { label: string; amount: number }

/**
 * jsPDF's built-in fonts are WinAnsi-encoded and have no glyph for the rupee
 * sign — it renders as a stray superscript. PDFs therefore use "Rs.".
 */
const RS = 'Rs.';

/** Round to 2dp; used for image dimensions in mm. */
function round2Px(v: number): number { return Math.round(v * 100) / 100; }

/** Load the company logo as a data URL (jsPDF needs bytes, not a URL). */
/** Logo as raw bytes, for embedding in a Word document. */
async function loadLogoBytes(): Promise<Uint8Array | null> {
  try {
    const res = await fetch(logoUrl);
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

async function loadLogo(): Promise<{ data: string; w: number; h: number } | null> {
  try {
    const res = await fetch(logoUrl);
    const blob = await res.blob();
    const data = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error('logo read failed'));
      r.readAsDataURL(blob);
    });
    const dims = await new Promise<{ w: number; h: number }>((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve({ w: 1, h: 1 });
      img.src = data;
    });
    return { data, ...dims };
  } catch {
    // A missing logo must never block a salary slip.
    return null;
  }
}

function earningLines(p: PayrollRecord): Line[] {
  return ([
    { label: 'Basic', amount: p.basic },
    { label: 'HRA', amount: p.hra },
    { label: 'Special allowance', amount: p.special_allowance },
    { label: 'Transport allowance', amount: p.transport_allowance },
    { label: 'Medical allowance', amount: p.medical_allowance },
    { label: 'Conveyance / other', amount: p.conveyance_other },
    { label: 'Performance bonus', amount: p.performance_bonus },
    { label: 'Annual bonus', amount: p.annual_bonus },
  ] satisfies Line[]).filter((l) => Number(l.amount) > 0);
}

function deductionLines(p: PayrollRecord): Line[] {
  return ([
    { label: 'Professional tax', amount: p.professional_tax },
    { label: 'Salary advance recovered', amount: p.salary_advance_recovered },
    { label: 'Other deductions', amount: p.other_deductions },
  ] satisfies Line[]).filter((l) => Number(l.amount) > 0);
}

export function slipFilename(d: SlipData, ext: string): string {
  const name = `${d.employee.first_name}_${d.employee.last_name}`.replace(/\s+/g, '_');
  const month = formatMonth(d.month).replace(/\s+/g, '_');
  return `Salary_Slip_${name}_${month}.${ext}`;
}

async function buildPdf(d: SlipData) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const { employee: e, payroll: p, settings: c } = d;

  // ── Geometry ────────────────────────────────────────────────
  const LM = 15;                 // left margin
  const W = 180;                 // content width
  const R = LM + W;              // right edge
  const MID = LM + W / 2;        // vertical divider between the two columns
  const HAIR = 0.2;              // hairline rule
  const RULE = 0.4;              // structural rule

  // Monochrome only — no fills, no colour.
  const INK = 0, MUTED = 105;
  doc.setDrawColor(60);
  doc.setLineWidth(HAIR);

  /** Right-align a money value inside a column, never colliding with labels. */
  const money = (v: number) => Number(v).toLocaleString('en-IN', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });

  /** Truncate a label so it can never run into the amount column. */
  const fit = (text: string, maxW: number) => {
    let t = text;
    while (t.length > 4 && doc.getTextWidth(t) > maxW) t = t.slice(0, -1);
    return t === text ? t : t.replace(/.$/, '…');
  };

  // ── Header: logo, then company name ─────────────────────────
  const logo = await loadLogo();
  doc.setTextColor(INK).setFont('helvetica', 'bold').setFontSize(14);
  const nameW = doc.getTextWidth(c.company_name);
  const LOGO_H = 8;
  const logoW = logo ? round2Px(LOGO_H * (logo.w / logo.h)) : 0;
  const GAP = logo ? 4 : 0;
  // Centre the logo + name as one lockup so neither can overlap the other.
  const blockW = logoW + GAP + nameW;
  const startX = 105 - blockW / 2;
  // Baseline of the name is y=18; sit the logo so its vertical centre matches
  // the text's optical centre, leaving the address line clear below.
  const NAME_BASELINE = 18;
  if (logo) {
    doc.addImage(
      logo.data, 'JPEG', startX, NAME_BASELINE - LOGO_H + 1.4, logoW, LOGO_H,
    );
  }
  doc.text(c.company_name, startX + logoW + GAP, NAME_BASELINE);

  doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(MUTED);
  let hy = 23.5;
  if (c.address) { doc.text(c.address, 105, hy, { align: 'center' }); hy += 4.2; }
  doc.text(
    `CIN: ${c.cin ?? '—'}    GST: ${c.gst_number ?? '—'}`,
    105, hy, { align: 'center' },
  );
  hy += 4;

  doc.setLineWidth(RULE).line(LM, hy, R, hy);
  hy += 6.5;
  doc.setTextColor(INK).setFont('helvetica', 'bold').setFontSize(10.5);
  doc.text(`SALARY SLIP — ${formatMonth(d.month).toUpperCase()}`, 105, hy,
    { align: 'center' });
  hy += 3.5;
  doc.setLineWidth(RULE).line(LM, hy, R, hy);

  // ── Employee particulars: two label/value pairs per line ────
  let y = hy + 8;
  doc.setFontSize(9);
  const LBL_W = 34;               // fixed label column, so values always align
  const info: [string, string][] = [
    ['Employee', `${e.first_name} ${e.last_name}`],
    ['Employee code', e.employee_code],
    ['Designation', e.designation ?? '—'],
    ['PAN', maskPan(e.pan)],
    ['Days in month', String(p.days_in_month)],
    ['Days paid', String(p.paid_days)],
  ];
  for (let i = 0; i < info.length; i += 2) {
    const pair = [info[i], info[i + 1]] as const;
    pair.forEach((entry, col) => {
      if (!entry) return;
      const [k, v] = entry;
      const x = col === 0 ? LM : MID + 4;
      const valueMax = (col === 0 ? MID - 4 : R) - (x + LBL_W);
      doc.setFont('helvetica', 'normal').setTextColor(MUTED);
      doc.text(k, x, y);
      doc.setFont('helvetica', 'bold').setTextColor(INK);
      doc.text(fit(v, valueMax), x + LBL_W, y);
    });
    y += 5.6;
  }

  // ── Earnings / Deductions: bounded columns with a divider ───
  y += 2;
  const tableTop = y;
  const HEAD_H = 7.5;
  const ROW_H = 6.2;

  doc.setLineWidth(HAIR);
  doc.setFont('helvetica', 'bold').setFontSize(8.5).setTextColor(INK);
  doc.text('EARNINGS', LM + 3, y + 5.2);
  doc.text(`AMOUNT (${RS})`, MID - 3, y + 5.2, { align: 'right' });
  doc.text('DEDUCTIONS', MID + 3, y + 5.2);
  doc.text(`AMOUNT (${RS})`, R - 3, y + 5.2, { align: 'right' });
  y += HEAD_H;
  doc.line(LM, y, R, y);

  const earn = earningLines(p);
  const ded = deductionLines(p);
  const rows = Math.max(earn.length, ded.length);

  doc.setFont('helvetica', 'normal').setFontSize(9);
  const AMOUNT_W = 26;
  for (let i = 0; i < rows; i++) {
    const rowY = y + ROW_H * i + 4.3;
    const a = earn[i], b = ded[i];
    if (a) {
      doc.setTextColor(INK);
      doc.text(fit(a.label, W / 2 - AMOUNT_W - 8), LM + 3, rowY);
      doc.text(money(a.amount), MID - 3, rowY, { align: 'right' });
    }
    if (b) {
      doc.setTextColor(INK);
      doc.text(fit(b.label, W / 2 - AMOUNT_W - 8), MID + 3, rowY);
      doc.text(money(b.amount), R - 3, rowY, { align: 'right' });
    }
  }
  y += ROW_H * rows;

  // Totals row
  doc.line(LM, y, R, y);
  doc.setFont('helvetica', 'bold').setFontSize(9);
  doc.text('Gross salary', LM + 3, y + 4.6);
  doc.text(money(p.gross_salary), MID - 3, y + 4.6, { align: 'right' });
  doc.text('Total deductions', MID + 3, y + 4.6);
  doc.text(money(p.total_deductions), R - 3, y + 4.6, { align: 'right' });
  y += ROW_H + 1.4;

  // Outer box + the vertical divider between the two columns
  doc.setLineWidth(HAIR);
  doc.rect(LM, tableTop, W, y - tableTop);
  doc.line(MID, tableTop, MID, y);

  // ── Net salary: bordered row, no fill ───────────────────────
  y += 6;
  const NET_H = 11;
  doc.setLineWidth(RULE).rect(LM, y, W, NET_H);
  doc.setFont('helvetica', 'bold').setFontSize(10.5).setTextColor(INK);
  doc.text('NET SALARY PAYABLE', LM + 4, y + 7.2);
  doc.text(`${RS} ${money(p.net_salary)}`, R - 4, y + 7.2, { align: 'right' });
  y += NET_H + 6;

  // ── Amount in words ─────────────────────────────────────────
  doc.setFont('helvetica', 'italic').setFontSize(8.5).setTextColor(MUTED);
  const words = doc.splitTextToSize(
    `Amount in words: ${amountInWords(Number(p.net_salary))}`, W,
  ) as string[];
  doc.text(words, LM, y);
  y += words.length * 4.2 + 4;

  // ── Payment details, only once actually paid ────────────────
  if (p.status === 'paid' && p.payment_date) {
    doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(INK);
    doc.text('Payment details', LM, y);
    y += 5.4;
    doc.setFontSize(9);
    const pay: [string, string][] = [
      ['Paid on', formatDate(p.payment_date)],
      ['Mode', p.payment_mode ?? '—'],
    ];
    if (p.cheque_utr) pay.push(['Cheque / UTR', p.cheque_utr]);
    for (let i = 0; i < pay.length; i += 2) {
      const pair = [pay[i], pay[i + 1]] as const;
      pair.forEach((entry, col) => {
        if (!entry) return;
        const [k, v] = entry;
        const x = col === 0 ? LM : MID + 4;
        const valueMax = (col === 0 ? MID - 4 : R) - (x + LBL_W);
        doc.setFont('helvetica', 'normal').setTextColor(MUTED);
        doc.text(k, x, y);
        doc.setFont('helvetica', 'bold').setTextColor(INK);
        doc.text(fit(v, valueMax), x + LBL_W, y);
      });
      y += 5.4;
    }
  }

  // ── Signature block, right-aligned ──────────────────────────
  // Placed relative to the flowing content, with a floor so it can never
  // collide with the footer note on a short slip.
  const SIG_W = 62;
  const sigY = Math.max(y + 12, 232);
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(INK);
  doc.text(`For ${c.company_name}`, R, sigY, { align: 'right' });
  doc.setLineWidth(HAIR).line(R - SIG_W, sigY + 20, R, sigY + 20);
  doc.setFontSize(8).setTextColor(MUTED);
  doc.text('Authorised Signatory', R, sigY + 24.5, { align: 'right' });

  // ── Footer ──────────────────────────────────────────────────
  doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(MUTED);
  doc.text(
    'This is a computer-generated salary slip.',
    105, 285, { align: 'center' },
  );

  return doc;
}

/** Build the PDF and trigger a download. */
export async function generatePdf(d: SlipData): Promise<void> {
  const doc = await buildPdf(d);
  doc.save(slipFilename(d, 'pdf'));
}

/** Build the PDF and return a blob URL, for the in-app viewer. */
export async function generatePdfPreview(d: SlipData): Promise<string> {
  const doc = await buildPdf(d);
  return URL.createObjectURL(doc.output('blob'));
}

export async function generateDocx(d: SlipData): Promise<void> {
  const {
    Document, Packer, Paragraph, Table, TableRow, TableCell,
    TextRun, AlignmentType, WidthType, ImageRun,
  } = await import('docx');
  const logoBytes = await loadLogoBytes();
  const { employee: e, payroll: p, settings: c } = d;

  // Monochrome, hairline-bordered cells — no shading or colour fills.
  const cell = (
    text: string, bold = false, _shade = false, align: 'left' | 'right' = 'left',
  ) => new TableCell({
    children: [new Paragraph({
      alignment: align === 'right' ? AlignmentType.RIGHT : AlignmentType.LEFT,
      children: [new TextRun({ text, bold, size: 18 })],
    })],
    margins: { top: 70, bottom: 70, left: 110, right: 110 },
  });
  /** Money cells are always right-aligned with two decimals. */
  const moneyCell = (v: number, bold = false) => cell(
    Number(v).toLocaleString('en-IN',
      { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    bold, false, 'right',
  );

  const infoRows = [
    ['Employee', `${e.first_name} ${e.last_name}`, 'Designation', e.designation ?? '—'],
    ['Employee code', e.employee_code, 'PAN', maskPan(e.pan)],
    ['Month', formatMonth(d.month), 'Days paid', `${p.paid_days} / ${p.days_in_month}`],
  ].map((r) => new TableRow({ children: r.map((v, i) => cell(v, i % 2 === 0, i % 2 === 0)) }));

  const earn = earningLines(p), ded = deductionLines(p);
  const payRows = Array.from({ length: Math.max(earn.length, ded.length) }, (_, i) => {
    const a = earn[i], b = ded[i];
    return new TableRow({
      children: [
        cell(a?.label ?? ''), a ? moneyCell(a.amount) : cell(''),
        cell(b?.label ?? ''), b ? moneyCell(b.amount) : cell(''),
      ],
    });
  });

  const doc = new Document({
    sections: [{
      children: [
        // Logo above the company name, mirroring the PDF header lockup.
        ...(logoBytes
          ? [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new ImageRun({
              type: 'jpg',
              data: logoBytes,
              transformation: { width: 46, height: 46 },
            })],
          })]
          : []),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: c.company_name, bold: true, size: 28 })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: c.address ?? '', size: 18, color: '555555' })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({
            text: `CIN: ${c.cin ?? '—'}  |  GST: ${c.gst_number ?? '—'}`, size: 16, color: '555555',
          })],
        }),
        new Paragraph({ text: '' }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({
            text: `SALARY SLIP — ${formatMonth(d.month).toUpperCase()}`, bold: true, size: 24,
          })],
        }),
        new Paragraph({ text: '' }),
        new Table({ rows: infoRows, width: { size: 100, type: WidthType.PERCENTAGE } }),
        new Paragraph({ text: '' }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              children: [
                cell('EARNINGS', true, true), cell('Amount (₹)', true, true),
                cell('DEDUCTIONS', true, true), cell('Amount (₹)', true, true),
              ],
            }),
            ...payRows,
            new TableRow({
              children: [
                cell('Gross salary', true), moneyCell(p.gross_salary, true),
                cell('Total deductions', true), moneyCell(p.total_deductions, true),
              ],
            }),
            new TableRow({
              children: [
                cell('NET SALARY PAYABLE', true), moneyCell(p.net_salary, true),
                cell(''), cell(''),
              ],
            }),
          ],
        }),
        new Paragraph({ text: '' }),
        new Paragraph({
          children: [new TextRun({
            text: `Amount in words: ${amountInWords(Number(p.net_salary))}`,
            italics: true, size: 18,
          })],
        }),
        new Paragraph({ text: '' }),
        ...(p.status === 'paid' && p.payment_date
          ? [
            new Paragraph({
              children: [new TextRun({ text: 'Payment details', bold: true, size: 18 })],
            }),
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: [
                new TableRow({
                  children: [
                    cell('Paid on', true, true), cell(formatDate(p.payment_date)),
                    cell('Mode', true, true), cell(p.payment_mode ?? '—'),
                  ],
                }),
                ...(p.cheque_utr
                  ? [new TableRow({
                    children: [
                      cell('Cheque / UTR', true, true), cell(p.cheque_utr),
                      cell(''), cell(''),
                    ],
                  })]
                  : []),
              ],
            }),
            new Paragraph({ text: '' }),
          ]
          : []),
        new Paragraph({ text: '' }),
        new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [new TextRun({ text: `For ${c.company_name}`, size: 18 })],
        }),
        new Paragraph({ text: '' }),
        new Paragraph({ text: '' }),
        new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [new TextRun({
            text: 'Authorised Signatory', size: 16, color: '666666',
          })],
        }),
        new Paragraph({ text: '' }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({
            text: 'This is a computer-generated salary slip.',
            size: 16, color: '888888',
          })],
        }),
      ],
    }],
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = slipFilename(d, 'docx');
  a.click();
  URL.revokeObjectURL(url);
}
