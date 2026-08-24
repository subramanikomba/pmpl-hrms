// PMPL HRMS — Admin Payroll Screen
(function() {
  const screen = document.getElementById('screen-admin-payroll');
  if (!screen) return;
  screen.addEventListener('screen:show', initPayroll);

  let selectedMonth = null;

  async function initPayroll() {
    // Default to current month
    const now = new Date();
    selectedMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    document.getElementById('payroll-month-picker').value =
      `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    await loadPayrollGrid();
  }

  window.onPayrollMonthChange = async function() {
    const val = document.getElementById('payroll-month-picker').value;
    if (!val) return;
    const [y,m] = val.split('-');
    selectedMonth = new Date(+y, +m-1, 1);
    await loadPayrollGrid();
  };

  async function loadPayrollGrid() {
    const monthStr = window.isoDate(selectedMonth);
    const isLocked = window.isPayrollMonthLocked(selectedMonth);
    document.getElementById('payroll-lock-notice').classList.toggle('hidden', !isLocked);

    // Load active employees
    const { data: emps } = await window.sb
      .from('employees')
      .select('id,employee_code,first_name,last_name,designation')
      .eq('status','active')
      .order('employee_code');

    // Load existing payroll rows for this month
    const { data: payRows } = await window.sb
      .from('payroll')
      .select('*')
      .eq('payroll_month', monthStr);

    const payMap = {};
    (payRows||[]).forEach(p => payMap[p.employee_id] = p);

    // Load company settings for PT
    const { data: settings } = await window.sb.from('company_settings').select('*').limit(1);
    const cs = settings?.[0];
    const ptAmount = selectedMonth.getMonth() === 1 ? cs?.pt_february||300 : cs?.pt_monthly||200;

    // Load holidays for this month
    const monthEnd = new Date(selectedMonth.getFullYear(), selectedMonth.getMonth()+1, 0);
    const { data: holidays } = await window.sb
      .from('company_holidays')
      .select('holiday_date')
      .gte('holiday_date', monthStr)
      .lte('holiday_date', window.isoDate(monthEnd));

    const daysInMonth = monthEnd.getDate();

    let html = `
      <table class="payroll-table">
        <thead>
          <tr>
            <th>Emp</th><th>Name</th><th>Paid Days</th>
            <th>Basic</th><th>HRA</th><th>Special</th><th>Transport</th>
            <th>Medical</th><th>Conv/Other</th>
            <th>Perf Bonus</th><th>Ann Bonus</th>
            <th>Gross</th><th>PT</th><th>SA Rec.</th><th>Other Ded.</th>
            <th>Net Pay</th><th>Status</th><th>Action</th>
          </tr>
        </thead><tbody>`;

    for (const emp of (emps||[])) {
      const row = payMap[emp.id];
      const status = row?.status || 'draft';
      const locked = isLocked && !row?.is_reopened;

      if (row) {
        html += buildPayrollRow(emp, row, locked);
      } else {
        html += buildEmptyRow(emp, daysInMonth, ptAmount, locked);
      }
    }
    html += '</tbody></table>';

    document.getElementById('payroll-grid').innerHTML = html;
  }

  function buildPayrollRow(emp, row, locked) {
    const dis = locked ? 'disabled' : '';
    return `<tr data-empid="${emp.id}" data-payid="${row.id}">
      <td>${emp.employee_code}</td>
      <td>${emp.first_name} ${emp.last_name}</td>
      <td><input type="number" class="pay-input" name="paid_days" value="${row.paid_days}" ${dis} step="0.5" min="0"></td>
      <td>${window.fmtCurrency(row.basic)}</td>
      <td>${window.fmtCurrency(row.hra)}</td>
      <td>${window.fmtCurrency(row.special_allowance)}</td>
      <td>${window.fmtCurrency(row.transport_allowance)}</td>
      <td>${window.fmtCurrency(row.medical_allowance)}</td>
      <td>${window.fmtCurrency(row.conveyance_other)}</td>
      <td><input type="number" class="pay-input" name="perf_bonus" value="${row.performance_bonus}" ${dis} min="0"></td>
      <td><input type="number" class="pay-input" name="ann_bonus"  value="${row.annual_bonus}" ${dis} min="0"></td>
      <td class="pay-gross">${window.fmtCurrency(row.gross_salary)}</td>
      <td>${window.fmtCurrency(row.professional_tax)}</td>
      <td>${window.fmtCurrency(row.salary_advance_recovered)}</td>
      <td><input type="number" class="pay-input" name="other_ded" value="${row.other_deductions}" ${dis} min="0"></td>
      <td class="pay-net fw-bold">${window.fmtCurrency(row.net_salary)}</td>
      <td><span class="badge badge-${row.status}">${row.status}</span></td>
      <td>
        ${!locked ? `<button class="btn btn-sm btn-primary" onclick="calcPayroll('${emp.id}')">Calc</button>
        <button class="btn btn-sm btn-success mt-1" onclick="savePayroll('${emp.id}')">Save</button>` : ''}
        ${locked && !row.is_reopened ? `<button class="btn btn-sm btn-warning" onclick="reopenPayroll('${row.id}')">Reopen</button>` : ''}
      </td>
    </tr>`;
  }

  function buildEmptyRow(emp, daysInMonth, ptAmount, locked) {
    return `<tr data-empid="${emp.id}" data-payid="">
      <td>${emp.employee_code}</td>
      <td>${emp.first_name} ${emp.last_name}</td>
      <td><input type="number" class="pay-input" name="paid_days" value="${daysInMonth}" min="0" step="0.5"></td>
      <td colspan="8" class="text-muted">—</td>
      <td><input type="number" class="pay-input" name="perf_bonus" value="0" min="0"></td>
      <td><input type="number" class="pay-input" name="ann_bonus" value="0" min="0"></td>
      <td class="pay-gross">—</td>
      <td>${window.fmtCurrency(ptAmount)}</td>
      <td>—</td>
      <td><input type="number" class="pay-input" name="other_ded" value="0" min="0"></td>
      <td class="pay-net">—</td>
      <td><span class="badge badge-draft">draft</span></td>
      <td><button class="btn btn-sm btn-primary" onclick="calcPayroll('${emp.id}')">Calculate</button></td>
    </tr>`;
  }

  // Calculate payroll for one employee
  window.calcPayroll = async function(empId) {
    const monthStr = window.isoDate(selectedMonth);
    const monthEnd = new Date(selectedMonth.getFullYear(), selectedMonth.getMonth()+1, 0);
    const daysInMonth = monthEnd.getDate();

    // Get salary structure (most recent effective_from <= month)
    const { data: structs } = await window.sb
      .from('salary_structures')
      .select('*')
      .eq('employee_id', empId)
      .lte('effective_from', monthStr)
      .order('effective_from', { ascending:false })
      .limit(1);
    const struct = structs?.[0];
    if (!struct) { window.showToast('No salary structure found for this employee','error'); return; }

    // Get paid days from the row input
    const row = document.querySelector(`tr[data-empid="${empId}"]`);
    const paidDays = parseFloat(row?.querySelector('[name=paid_days]')?.value || daysInMonth);
    const perfBonus = parseFloat(row?.querySelector('[name=perf_bonus]')?.value || 0);
    const annBonus  = parseFloat(row?.querySelector('[name=ann_bonus]')?.value  || 0);
    const otherDed  = parseFloat(row?.querySelector('[name=other_ded]')?.value  || 0);

    const ratio = paidDays / daysInMonth;
    const basic    = round2(struct.basic * ratio);
    const hra      = round2(struct.hra * ratio);
    const special  = round2(struct.special_allowance * ratio);
    const transport= round2(struct.transport_allowance * ratio);
    const medical  = round2(struct.medical_allowance * ratio);
    const conv     = round2(struct.conveyance_other * ratio);
    const gross    = round2(basic + hra + special + transport + medical + conv + perfBonus + annBonus);

    // PT
    const { data: settings } = await window.sb.from('company_settings').select('*').limit(1);
    const cs = settings?.[0];
    const pt = selectedMonth.getMonth() === 1 ? (cs?.pt_february||300) : (cs?.pt_monthly||200);

    // Salary advance recovery outstanding
    const { data: saRows } = await window.sb
      .from('salary_advances')
      .select('id, amount')
      .eq('employee_id', empId);
    const { data: sarRows } = await window.sb
      .from('salary_advance_recoveries')
      .select('salary_advance_id, recovered_amount');
    const totalSA  = (saRows||[]).reduce((s,r)=>s+Number(r.amount),0);
    const totalRec = (sarRows||[]).reduce((s,r)=>s+Number(r.recovered_amount),0);
    const saOutstanding = Math.max(0, totalSA - totalRec);
    // Default: recover all outstanding in this payroll (Admin can override)
    const saRecovery = saOutstanding;

    const totalDed = round2(pt + saRecovery + otherDed);
    const net      = round2(gross - totalDed);

    // Update UI
    const cells = row?.querySelectorAll('td');
    row.querySelector('.pay-gross').textContent = window.fmtCurrency(gross);
    row.querySelector('.pay-net').textContent   = window.fmtCurrency(net);

    // Store calc in data attrs for save
    row.dataset.calc = JSON.stringify({
      days_in_month: daysInMonth, paid_days: paidDays,
      basic, hra, special_allowance: special, transport_allowance: transport,
      medical_allowance: medical, conveyance_other: conv,
      performance_bonus: perfBonus, annual_bonus: annBonus,
      gross_salary: gross, professional_tax: pt,
      salary_advance_recovered: saRecovery, other_deductions: otherDed,
      total_deductions: totalDed, net_salary: net
    });
    window.showToast('Calculated. Press Save to confirm.','info');
  };

  window.savePayroll = async function(empId) {
    const row  = document.querySelector(`tr[data-empid="${empId}"]`);
    const calc = row?.dataset.calc ? JSON.parse(row.dataset.calc) : null;
    if (!calc) { window.showToast('Run Calculate first','error'); return; }

    const monthStr = window.isoDate(selectedMonth);
    const existingId = row.dataset.payid;
    const payload = { employee_id: empId, payroll_month: monthStr, status:'processed', ...calc };

    let error;
    if (existingId) {
      ({ error } = await window.sb.from('payroll').update(payload).eq('id', existingId));
    } else {
      ({ error } = await window.sb.from('payroll').insert(payload));
    }
    if (error) { window.showToast('Error: ' + error.message,'error'); return; }

    // Record salary advance recovery if any
    if (calc.salary_advance_recovered > 0) {
      const { data: saRows } = await window.sb.from('salary_advances').select('id').eq('employee_id', empId);
      if (saRows?.[0]) {
        await window.sb.from('salary_advance_recoveries').insert({
          salary_advance_id: saRows[0].id,
          employee_id: empId,
          payroll_month: monthStr,
          recovered_amount: calc.salary_advance_recovered
        });
      }
    }
    window.showToast('Payroll saved!','success');
    loadPayrollGrid();
  };

  window.reopenPayroll = async function(payId) {
    const reason = prompt('Reason for reopening this payroll month:');
    if (!reason) return;
    const admin = window.appState.employee;
    const { error } = await window.sb.from('payroll').update({
      is_locked: false, is_reopened: true,
      reopened_by: admin.id, reopened_at: new Date().toISOString(),
      reopened_reason: reason
    }).eq('id', payId);
    if (error) { window.showToast('Error: ' + error.message,'error'); return; }

    // Audit
    await window.sb.from('payroll_audit').insert({
      payroll_id: payId, action:'reopened',
      performed_by: admin.id, note: reason
    });
    window.showToast('Payroll month reopened','success');
    loadPayrollGrid();
  };

  function round2(n) { return Math.round(n * 100) / 100; }
})();
