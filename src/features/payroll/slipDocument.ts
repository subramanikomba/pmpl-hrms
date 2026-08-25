/**
 * Salary slip generation. jsPDF and docx are imported dynamically so they are
 * code-split out of the main bundle and only downloaded when a slip is made.
 */
import { amountInWords, formatCurrency, formatMonth, maskPan } from '@/lib/format';
import type { CompanySettings, Employee, PayrollRecord } from '@/types/db';

export interface SlipData {
  employee: Employee;
  payroll: PayrollRecord;
  settings: CompanySettings;
  month: Date;
}

interface Line { label: string; amount: number }

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

export async function generatePdf(d: SlipData): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const { employee: e, payroll: p, settings: c } = d;
  const LM = 15, W = 180;

  doc.setFontSize(14).setFont('helvetica', 'bold');
  doc.text(c.company_name, 105, 18, { align: 'center' });
  doc.setFontSize(9).setFont('helvetica', 'normal').setTextColor(90, 90, 90);
  if (c.address) doc.text(c.address, 105, 24, { align: 'center' });
  doc.text(`CIN: ${c.cin ?? '—'}   GST: ${c.gst_number ?? '—'}`, 105, 29, { align: 'center' });

  doc.setFillColor(196, 64, 47).rect(LM, 33, W, 8, 'F');
  doc.setTextColor(255, 255, 255).setFontSize(11).setFont('helvetica', 'bold');
  doc.text(`SALARY SLIP — ${formatMonth(d.month).toUpperCase()}`, 105, 38.5, { align: 'center' });

  doc.setTextColor(0, 0, 0).setFontSize(9);
  const info: [string, string][] = [
    ['Employee', `${e.first_name} ${e.last_name}`],
    ['Employee code', e.employee_code],
    ['Designation', e.designation ?? '—'],
    ['PAN', maskPan(e.pan)],
    ['Days in month', String(p.days_in_month)],
    ['Days paid', String(p.paid_days)],
  ];
  let y = 47;
  info.forEach(([k, v], i) => {
    const x = i % 2 === 0 ? LM : LM + 95;
    doc.setFont('helvetica', 'bold').text(`${k}:`, x, y);
    doc.setFont('helvetica', 'normal').text(v, x + 32, y);
    if (i % 2 === 1) y += 6;
  });
  y += 4;

  doc.setFillColor(240, 240, 240).rect(LM, y, W / 2, 6, 'F').rect(LM + W / 2, y, W / 2, 6, 'F');
  doc.setFont('helvetica', 'bold');
  doc.text('EARNINGS', LM + 2, y + 4);
  doc.text('DEDUCTIONS', LM + W / 2 + 2, y + 4);
  y += 6;

  const earn = earningLines(p), ded = deductionLines(p);
  doc.setFont('helvetica', 'normal');
  for (let i = 0; i < Math.max(earn.length, ded.length); i++) {
    const a = earn[i], b = ded[i];
    if (a) {
      doc.text(a.label, LM + 2, y + 4);
      doc.text(formatCurrency(a.amount), LM + W / 2 - 3, y + 4, { align: 'right' });
    }
    if (b) {
      doc.text(b.label, LM + W / 2 + 2, y + 4);
      doc.text(formatCurrency(b.amount), LM + W - 2, y + 4, { align: 'right' });
    }
    y += 5.5;
  }

  doc.setFillColor(225, 225, 225).rect(LM, y, W, 6, 'F');
  doc.setFont('helvetica', 'bold');
  doc.text('Gross salary', LM + 2, y + 4);
  doc.text(formatCurrency(p.gross_salary), LM + W / 2 - 3, y + 4, { align: 'right' });
  doc.text('Total deductions', LM + W / 2 + 2, y + 4);
  doc.text(formatCurrency(p.total_deductions), LM + W - 2, y + 4, { align: 'right' });
  y += 6;

  doc.setFillColor(196, 64, 47).rect(LM, y, W, 10, 'F');
  doc.setTextColor(255, 255, 255).setFontSize(11);
  doc.text('NET SALARY PAYABLE', LM + 2, y + 7);
  doc.text(formatCurrency(p.net_salary), LM + W - 2, y + 7, { align: 'right' });
  y += 14;

  doc.setTextColor(0, 0, 0).setFontSize(8).setFont('helvetica', 'italic');
  doc.text(`Amount in words: ${amountInWords(Number(p.net_salary))}`, LM, y, { maxWidth: W });

  doc.setFontSize(7).setTextColor(130, 130, 130).setFont('helvetica', 'normal');
  doc.text('This is a computer-generated salary slip and does not require a signature.',
    105, 285, { align: 'center' });

  doc.save(slipFilename(d, 'pdf'));
}

export async function generateDocx(d: SlipData): Promise<void> {
  const {
    Document, Packer, Paragraph, Table, TableRow, TableCell,
    TextRun, AlignmentType, WidthType, ShadingType,
  } = await import('docx');
  const { employee: e, payroll: p, settings: c } = d;

  const cell = (text: string, bold = false, shade = false) => new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text, bold, size: 18 })] })],
    shading: shade ? { type: ShadingType.SOLID, color: 'F0F0F0', fill: 'F0F0F0' } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
  });

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
        cell(a?.label ?? ''), cell(a ? formatCurrency(a.amount) : ''),
        cell(b?.label ?? ''), cell(b ? formatCurrency(b.amount) : ''),
      ],
    });
  });

  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: c.company_name, bold: true, size: 28, color: 'C4402F' })],
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
                cell('EARNINGS', true, true), cell('', false, true),
                cell('DEDUCTIONS', true, true), cell('', false, true),
              ],
            }),
            ...payRows,
            new TableRow({
              children: [
                cell('Gross salary', true, true), cell(formatCurrency(p.gross_salary), true, true),
                cell('Total deductions', true, true), cell(formatCurrency(p.total_deductions), true, true),
              ],
            }),
            new TableRow({
              children: [
                cell('NET SALARY PAYABLE', true), cell(formatCurrency(p.net_salary), true),
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
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({
            text: 'This is a computer-generated salary slip and does not require a signature.',
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
