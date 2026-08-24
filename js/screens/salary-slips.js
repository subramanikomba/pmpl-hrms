// PMPL HRMS — Salary Slip Generation (PDF + Word, browser-side)
(function() {
  const screen = document.getElementById('screen-admin-salary-slips');
  if (!screen) return;
  screen.addEventListener('screen:show', initSlips);

  async function initSlips() {
    const { data: emps } = await window.sb
      .from('employees').select('id,employee_code,first_name,last_name')
      .eq('status','active').order('employee_code');

    const opts = (emps||[]).map(e=>
      `<option value="${e.id}">${e.employee_code} — ${e.first_name} ${e.last_name}</option>`
    ).join('');
    document.getElementById('slip-emp').innerHTML = `<option value="">Select Employee…</option>${opts}`;
  }

  window.generateSlip = async function(format) {
    const empId = document.getElementById('slip-emp').value;
    const monthVal = document.getElementById('slip-month').value;
    if (!empId || !monthVal) { window.showToast('Select employee and month','error'); return; }

    const [y,m] = monthVal.split('-');
    const monthDate = `${y}-${m}-01`;

    // Load payroll record
    const { data: payroll, error: pErr } = await window.sb
      .from('payroll')
      .select('*,employees(*)')
      .eq('employee_id', empId)
      .eq('payroll_month', monthDate)
      .single();

    if (pErr || !payroll) { window.showToast('No payroll record for this month','error'); return; }

    // Load company settings
    const { data: settings } = await window.sb.from('company_settings').select('*').limit(1);
    const cs = settings?.[0] || {};

    const slipData = {
      company: cs,
      employee: payroll.employees,
      payroll,
      monthLabel: window.fmtMonth(new Date(monthDate))
    };

    if (format === 'pdf') generatePDF(slipData);
    else generateWord(slipData);
  };

  // ── Number to Words (Indian) ──────────────────────────────────
  function numToWords(n) {
    const ones = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine',
                  'Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen',
                  'Seventeen','Eighteen','Nineteen'];
    const tens = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
    if (n === 0) return 'Zero';
    const convert = (num) => {
      if (num < 20) return ones[num];
      if (num < 100) return tens[Math.floor(num/10)] + (num%10?' '+ones[num%10]:'');
      if (num < 1000) return ones[Math.floor(num/100)] + ' Hundred' + (num%100?' '+convert(num%100):'');
      if (num < 100000) return convert(Math.floor(num/1000)) + ' Thousand' + (num%1000?' '+convert(num%1000):'');
      if (num < 10000000) return convert(Math.floor(num/100000)) + ' Lakh' + (num%100000?' '+convert(num%100000):'');
      return convert(Math.floor(num/10000000)) + ' Crore' + (num%10000000?' '+convert(num%10000000):'');
    };
    const int = Math.floor(n);
    const dec = Math.round((n - int)*100);
    return convert(int) + ' Rupees' + (dec > 0 ? ' and ' + convert(dec) + ' Paise' : '') + ' Only';
  }

  // ── PDF Generation (using jsPDF) ──────────────────────────────
  function generatePDF(d) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit:'mm', format:'a4' });
    const p = d.payroll, e = d.employee, c = d.company;
    const maskedPAN = e.pan ? e.pan.slice(0,3) + 'XXXXX' + e.pan.slice(-2) : '—';
    const lm = 15, pw = 180;

    // Header
    doc.setFillColor(255,255,255);
    doc.setFontSize(14).setFont(undefined,'bold');
    doc.text(c.company_name || 'Polyfill Microns Pvt. Ltd.', 105, 18, {align:'center'});
    doc.setFontSize(9).setFont(undefined,'normal').setTextColor(80);
    doc.text(c.address||'', 105, 24, {align:'center'});
    doc.text(`CIN: ${c.cin||'—'}   GST: ${c.gst_number||'—'}`, 105, 29, {align:'center'});

    // Title bar
    doc.setFillColor(230,75,60);
    doc.rect(lm, 33, pw, 8, 'F');
    doc.setTextColor(255).setFontSize(11).setFont(undefined,'bold');
    doc.text(`SALARY SLIP — ${d.monthLabel.toUpperCase()}`, 105, 38.5, {align:'center'});

    // Employee info table
    doc.setTextColor(0).setFontSize(9).setFont(undefined,'normal');
    const info = [
      ['Employee Name', `${e.first_name} ${e.last_name}`, 'Designation', e.designation||'—'],
      ['Employee Code', e.employee_code, 'PAN', maskedPAN],
      ['Month', d.monthLabel, 'Days in Month / Days Worked', `${p.days_in_month} / ${p.paid_days}`],
    ];
    let y = 46;
    info.forEach(row => {
      doc.setFont(undefined,'bold').text(row[0]+':',lm,y);
      doc.setFont(undefined,'normal').text(row[1],55,y);
      doc.setFont(undefined,'bold').text(row[2]+':',110,y);
      doc.setFont(undefined,'normal').text(String(row[3]),150,y);
      y += 6;
    });

    // Earnings & Deductions table
    y += 2;
    doc.setFillColor(245,245,245);
    doc.rect(lm,y,pw/2,6,'F'); doc.rect(lm+pw/2,y,pw/2,6,'F');
    doc.setFont(undefined,'bold').setFontSize(9);
    doc.text('EARNINGS',lm+2,y+4); doc.text('DEDUCTIONS',lm+pw/2+2,y+4);
    y += 6;

    const earnings = [
      ['Basic', p.basic], ['HRA', p.hra],
      ['Special Allowance', p.special_allowance],
      ['Transport Allowance', p.transport_allowance],
      ['Medical Allowance', p.medical_allowance],
      ['Conveyance / Other', p.conveyance_other],
      ['Performance Bonus', p.performance_bonus],
      ['Annual Bonus', p.annual_bonus],
    ].filter(r => r[1] > 0);

    const deductions = [
      ['Professional Tax', p.professional_tax],
      ['Salary Advance Recovered', p.salary_advance_recovered],
      ['Other Deductions', p.other_deductions],
    ].filter(r => r[1] > 0);

    const maxRows = Math.max(earnings.length, deductions.length);
    doc.setFont(undefined,'normal').setFontSize(9);
    for (let i = 0; i < maxRows; i++) {
      if (i%2===0) { doc.setFillColor(250,250,250); doc.rect(lm,y,pw,5.5,'F'); }
      if (earnings[i])   { doc.text(earnings[i][0],lm+2,y+4); doc.text(window.fmtCurrency(earnings[i][1]),lm+pw/2-5,y+4,{align:'right'}); }
      if (deductions[i]) { doc.text(deductions[i][0],lm+pw/2+2,y+4); doc.text(window.fmtCurrency(deductions[i][1]),lm+pw-2,y+4,{align:'right'}); }
      y += 5.5;
    }

    // Totals row
    doc.setFillColor(220,220,220);
    doc.rect(lm,y,pw,6,'F');
    doc.setFont(undefined,'bold');
    doc.text('Gross Salary',lm+2,y+4);
    doc.text(window.fmtCurrency(p.gross_salary),lm+pw/2-5,y+4,{align:'right'});
    doc.text('Total Deductions',lm+pw/2+2,y+4);
    doc.text(window.fmtCurrency(p.total_deductions),lm+pw-2,y+4,{align:'right'});
    y += 6;

    // Net salary
    doc.setFillColor(230,75,60);
    doc.rect(lm,y,pw,10,'F');
    doc.setTextColor(255).setFontSize(11);
    doc.text('NET SALARY PAYABLE',lm+2,y+7);
    doc.text(window.fmtCurrency(p.net_salary),lm+pw-2,y+7,{align:'right'});
    y += 10;

    // Amount in words
    doc.setTextColor(0).setFontSize(8).setFont(undefined,'italic');
    doc.text('Amount in Words: ' + numToWords(p.net_salary), lm, y+5);

    // Footer
    doc.setFontSize(7).setTextColor(130).setFont(undefined,'normal');
    doc.text('This is a computer-generated salary slip. No signature required.', 105, 285, {align:'center'});

    const filename = `Salary_Slip_${e.first_name}_${e.last_name}_${d.monthLabel.replace(' ','_')}.pdf`;
    doc.save(filename);
    window.showToast('PDF salary slip downloaded!','success');
  }

  // ── Word Generation (using docx.js) ──────────────────────────
  async function generateWord(d) {
    const { Document, Packer, Paragraph, Table, TableRow, TableCell,
            TextRun, HeadingLevel, AlignmentType, WidthType, BorderStyle,
            ShadingType } = window.docx;

    const p = d.payroll, e = d.employee, c = d.company;
    const maskedPAN = e.pan ? e.pan.slice(0,3) + 'XXXXX' + e.pan.slice(-2) : '—';

    const noBorder = { top:{style:BorderStyle.NONE}, bottom:{style:BorderStyle.NONE},
                       left:{style:BorderStyle.NONE}, right:{style:BorderStyle.NONE} };

    const cell = (text, bold=false, shade=false) => new TableCell({
      children:[new Paragraph({
        children:[new TextRun({ text:String(text||''), bold, size:18 })],
        alignment: AlignmentType.LEFT
      })],
      shading: shade ? { type:ShadingType.SOLID, color:'F0F0F0' } : undefined,
      margins:{ top:60, bottom:60, left:100, right:100 }
    });

    const rows = [
      ['Employee Name', `${e.first_name} ${e.last_name}`, 'Designation', e.designation||'—'],
      ['Employee Code', e.employee_code, 'PAN', maskedPAN],
      ['Month', d.monthLabel, 'Days in Month / Worked', `${p.days_in_month} / ${p.paid_days}`],
    ].map(r => new TableRow({ children: r.map((v,i)=>cell(v,i%2===0,i%2===0)) }));

    const earningRows = [
      ['Basic', p.basic],['HRA', p.hra],['Special Allowance', p.special_allowance],
      ['Transport Allowance', p.transport_allowance],['Medical Allowance', p.medical_allowance],
      ['Conveyance / Other', p.conveyance_other],
      ['Performance Bonus', p.performance_bonus],['Annual Bonus', p.annual_bonus],
    ].filter(r=>r[1]>0);

    const deductionRows = [
      ['Professional Tax', p.professional_tax],
      ['Salary Advance Recovered', p.salary_advance_recovered],
      ['Other Deductions', p.other_deductions],
    ].filter(r=>r[1]>0);

    const maxR = Math.max(earningRows.length, deductionRows.length);
    const payRows = [];
    for(let i=0;i<maxR;i++){
      const e0=earningRows[i]||['',''];
      const d0=deductionRows[i]||['',''];
      payRows.push(new TableRow({ children:[
        cell(e0[0]), cell(e0[1]>0?window.fmtCurrency(e0[1]):''),
        cell(d0[0]), cell(d0[1]>0?window.fmtCurrency(d0[1]):'')
      ]}));
    }

    const doc = new Document({ sections:[{ children:[
      new Paragraph({ children:[new TextRun({ text: c.company_name||'Polyfill Microns Pvt. Ltd.', bold:true, size:28, color:'E64B3C' })], alignment:AlignmentType.CENTER }),
      new Paragraph({ children:[new TextRun({ text: c.address||'', size:18, color:'555555' })], alignment:AlignmentType.CENTER }),
      new Paragraph({ children:[new TextRun({ text: `CIN: ${c.cin||'—'}  |  GST: ${c.gst_number||'—'}`, size:16, color:'555555' })], alignment:AlignmentType.CENTER }),
      new Paragraph({ text:'' }),
      new Paragraph({ children:[new TextRun({ text:`SALARY SLIP — ${d.monthLabel.toUpperCase()}`, bold:true, size:24 })], alignment:AlignmentType.CENTER }),
      new Paragraph({ text:'' }),
      new Table({ rows, width:{ size:100, type:WidthType.PERCENTAGE } }),
      new Paragraph({ text:'' }),
      new Table({ rows:[
        new TableRow({ children:[cell('EARNINGS',true,true),cell('',false,true),cell('DEDUCTIONS',true,true),cell('',false,true)] }),
        ...payRows,
        new TableRow({ children:[cell('Gross Salary',true,true),cell(window.fmtCurrency(p.gross_salary),true,true),cell('Total Deductions',true,true),cell(window.fmtCurrency(p.total_deductions),true,true)] }),
        new TableRow({ children:[cell('NET SALARY PAYABLE',true),cell(window.fmtCurrency(p.net_salary),true),cell(''),cell('')] }),
      ], width:{ size:100, type:WidthType.PERCENTAGE } }),
      new Paragraph({ text:'' }),
      new Paragraph({ children:[new TextRun({ text:`Amount in Words: ${numToWords(p.net_salary)}`, italics:true, size:18 })] }),
      new Paragraph({ text:'' }),
      new Paragraph({ children:[new TextRun({ text:'This is a computer-generated salary slip. No signature required.', size:16, color:'888888' })], alignment:AlignmentType.CENTER }),
    ]}]});

    const blob = await Packer.toBlob(doc);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Salary_Slip_${e.first_name}_${e.last_name}_${d.monthLabel.replace(' ','_')}.docx`;
    a.click();
    URL.revokeObjectURL(url);
    window.showToast('Word salary slip downloaded!','success');
  }
})();
