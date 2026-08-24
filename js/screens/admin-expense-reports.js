// PMPL HRMS — Admin Expense Reports Screen
(function () {
  const screen = document.getElementById('screen-admin-expense-reports');
  if (!screen) return;
  screen.addEventListener('screen:show', initExpenseReports);

  async function initExpenseReports() {
    const { data: emps } = await window.sb
      .from('employees')
      .select('id, employee_code, first_name, last_name')
      .eq('status', 'active')
      .order('employee_code');

    document.getElementById('exp-rpt-emp').innerHTML =
      '<option value="">All Employees</option>' +
      (emps || [])
        .map((e) => `<option value="${e.id}">${e.employee_code} — ${e.first_name} ${e.last_name}</option>`)
        .join('');

    const { data: clients } = await window.sb
      .from('client_companies').select('id, name').eq('is_active', true).order('name');
    document.getElementById('exp-rpt-client').innerHTML =
      '<option value="">All Clients</option>' +
      (clients || []).map((c) => `<option value="${c.id}">${c.name}</option>`).join('');

    // Default: current month
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth();
    document.getElementById('exp-rpt-from').value = window.isoDate(new Date(y, m, 1));
    document.getElementById('exp-rpt-to').value   = window.isoDate(new Date(y, m + 1, 0));

    await loadExpenseReport();
  }

  window.loadExpenseReport = async function () {
    const empId    = document.getElementById('exp-rpt-emp').value;
    const cat      = document.getElementById('exp-rpt-cat').value;
    const clientId = document.getElementById('exp-rpt-client').value;
    const fromDate = document.getElementById('exp-rpt-from').value;
    const toDate   = document.getElementById('exp-rpt-to').value;
    const status   = document.getElementById('exp-rpt-status').value;

    let query = window.sb
      .from('company_expenses')
      .select(
        `*, employees!employee_id(employee_code, first_name, last_name),
         client_companies(name)`
      )
      .order('expense_date', { ascending: false });

    if (empId)    query = query.eq('employee_id', empId);
    if (cat)      query = query.eq('category', cat);
    if (clientId) query = query.eq('client_id', clientId);
    if (fromDate) query = query.gte('expense_date', fromDate);
    if (toDate)   query = query.lte('expense_date', toDate);
    if (status)   query = query.eq('status', status);

    const { data: exps, error } = await query;
    if (error) { window.showToast('Error: ' + error.message, 'error'); return; }

    const total = (exps || []).reduce((s, e) => s + Number(e.amount), 0);
    const approved = (exps || []).filter((e) => e.status === 'approved').reduce((s, e) => s + Number(e.amount), 0);

    // Summary bar
    const summary = `
      <div class="exp-rpt-summary">
        <div class="stat-card"><div class="stat-val">${(exps || []).length}</div><div class="stat-lbl">Total Claims</div></div>
        <div class="stat-card"><div class="stat-val">${window.fmtCurrency(total)}</div><div class="stat-lbl">Total Amount</div></div>
        <div class="stat-card"><div class="stat-val">${window.fmtCurrency(approved)}</div><div class="stat-lbl">Approved Amount</div></div>
      </div>`;

    // Category-wise totals
    const catTotals = {};
    (exps || []).forEach((e) => {
      if (e.status === 'approved') catTotals[e.category] = (catTotals[e.category] || 0) + Number(e.amount);
    });
    const catBreakdown = Object.entries(catTotals)
      .sort((a, b) => b[1] - a[1])
      .map(([cat, amt]) => `<span class="cat-chip">${cat}: ${window.fmtCurrency(amt)}</span>`)
      .join('');

    // Detail table
    const rows = (exps || [])
      .map(
        (e) => `<tr>
          <td>${window.fmtDate(e.expense_date)}</td>
          <td>${e.employees?.employee_code} ${e.employees?.first_name} ${e.employees?.last_name}</td>
          <td>${e.category}</td>
          <td>${window.fmtCurrency(e.amount)}</td>
          <td>${e.bill_number || '—'}</td>
          <td>${e.client_companies?.name || '—'}</td>
          <td>${e.description || ''}</td>
          <td><span class="badge badge-${e.status}">${e.status}</span></td>
          <td>${e.accounted_advance_id ? window.fmtCurrency(e.accounted_amount) + ' vs Adv' : '—'}</td>
        </tr>`
      )
      .join('');

    document.getElementById('exp-report-output').innerHTML = `
      ${summary}
      ${catBreakdown ? `<div class="card" style="margin-bottom:12px;"><div class="card-title">Category Breakdown (Approved)</div><div class="cat-chips">${catBreakdown}</div></div>` : ''}
      <div style="overflow-x:auto;">
        <table class="data-table">
          <thead><tr>
            <th>Date</th><th>Employee</th><th>Category</th><th>Amount</th>
            <th>Bill No.</th><th>Client</th><th>Description</th><th>Status</th><th>Advance Acc.</th>
          </tr></thead>
          <tbody>${rows || '<tr><td colspan="9" class="text-muted text-center">No records.</td></tr>'}</tbody>
          <tfoot><tr>
            <td colspan="3" style="font-weight:700;padding:8px 10px;">TOTAL</td>
            <td style="font-weight:700;padding:8px 10px;">${window.fmtCurrency(total)}</td>
            <td colspan="5"></td>
          </tr></tfoot>
        </table>
      </div>`;
  };
})();
