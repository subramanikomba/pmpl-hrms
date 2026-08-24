// PMPL HRMS — Salary Advance Management Screen
(function () {
  const screen = document.getElementById('screen-admin-salary-advance');
  if (!screen) return;
  screen.addEventListener('screen:show', initSalaryAdvance);

  async function initSalaryAdvance() {
    const { data: emps } = await window.sb
      .from('employees')
      .select('id, employee_code, first_name, last_name')
      .eq('status', 'active')
      .order('employee_code');

    const opts =
      '<option value="">Select Employee…</option>' +
      (emps || [])
        .map(
          (e) =>
            `<option value="${e.id}">${e.employee_code} — ${e.first_name} ${e.last_name}</option>`
        )
        .join('');
    document.getElementById('sa-emp-select').innerHTML = opts;
    document.getElementById('sa-give-emp').innerHTML    = opts;

    // Summary: all employees with outstanding salary advance
    await loadSaSummary();
  }

  async function loadSaSummary() {
    const { data: advances } = await window.sb
      .from('salary_advances')
      .select('*, employees!employee_id(employee_code, first_name, last_name)')
      .order('advance_date', { ascending: false });

    const { data: recoveries } = await window.sb
      .from('salary_advance_recoveries')
      .select('salary_advance_id, recovered_amount');

    // Group recoveries by advance id
    const recMap = {};
    (recoveries || []).forEach((r) => {
      recMap[r.salary_advance_id] = (recMap[r.salary_advance_id] || 0) + Number(r.recovered_amount);
    });

    // Group advances by employee
    const empMap = {};
    (advances || []).forEach((a) => {
      const empId = a.employee_id;
      if (!empMap[empId]) {
        empMap[empId] = {
          emp: a.employees,
          totalGiven: 0,
          totalRecovered: 0,
          advances: [],
        };
      }
      const recovered = recMap[a.id] || 0;
      empMap[empId].totalGiven += Number(a.amount);
      empMap[empId].totalRecovered += recovered;
      empMap[empId].advances.push({ ...a, recovered, outstanding: Number(a.amount) - recovered });
    });

    const cards = Object.values(empMap)
      .filter((e) => e.totalGiven > 0)
      .map(
        (e) => `
      <div class="sa-card ${e.totalGiven - e.totalRecovered <= 0 ? 'sa-cleared' : ''}">
        <div class="sa-header">
          <span><strong>${e.emp?.employee_code}</strong> — ${e.emp?.first_name} ${e.emp?.last_name}</span>
          <span class="sa-outstanding ${e.totalGiven - e.totalRecovered > 0 ? 'outstanding-positive' : ''}">
            Outstanding: ${window.fmtCurrency(e.totalGiven - e.totalRecovered)}
          </span>
        </div>
        <div class="sa-stats">
          <span>Given: ${window.fmtCurrency(e.totalGiven)}</span>
          <span>Recovered: ${window.fmtCurrency(e.totalRecovered)}</span>
        </div>
      </div>`
      )
      .join('') || '<p class="text-muted">No salary advances on record.</p>';

    document.getElementById('sa-summary').innerHTML = cards;
  }

  window.loadSaLedger = async function () {
    const empId = document.getElementById('sa-emp-select').value;
    if (!empId) return;

    const { data: advances } = await window.sb
      .from('salary_advances')
      .select('*')
      .eq('employee_id', empId)
      .order('advance_date');

    const { data: recoveries } = await window.sb
      .from('salary_advance_recoveries')
      .select('*')
      .eq('employee_id', empId)
      .order('payroll_month');

    // Build ledger: union advances and recoveries, sorted by date
    const ledger = [];
    (advances || []).forEach((a) => {
      ledger.push({
        date: a.advance_date,
        type: 'Advance Given',
        debit: Number(a.amount),
        credit: 0,
        note: a.note || '',
      });
    });
    (recoveries || []).forEach((r) => {
      ledger.push({
        date: r.payroll_month,
        type: 'Recovered via Payroll',
        debit: 0,
        credit: Number(r.recovered_amount),
        note: 'Payroll ' + window.fmtMonth(r.payroll_month),
      });
    });
    ledger.sort((a, b) => a.date.localeCompare(b.date));

    let running = 0;
    const rows = ledger
      .map((row) => {
        running += row.debit - row.credit;
        return `<tr>
          <td>${window.fmtDate(row.date)}</td>
          <td>${row.type}</td>
          <td>${row.debit > 0 ? window.fmtCurrency(row.debit) : '—'}</td>
          <td>${row.credit > 0 ? window.fmtCurrency(row.credit) : '—'}</td>
          <td>${row.note}</td>
          <td class="fw-bold ${running > 0 ? 'text-warning' : ''}">${window.fmtCurrency(running)}</td>
        </tr>`;
      })
      .join('');

    document.getElementById('sa-ledger').innerHTML = `
      <table class="data-table">
        <thead><tr>
          <th>Date</th><th>Type</th><th>Advance Given</th><th>Recovered</th><th>Note</th><th>Balance</th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="6" class="text-muted">No records.</td></tr>'}</tbody>
      </table>`;

    document.getElementById('sa-ledger-section').classList.remove('hidden');
  };

  // Give Salary Advance
  window.giveSalaryAdvance = async function () {
    const empId  = document.getElementById('sa-give-emp').value;
    const amount = parseFloat(document.getElementById('sa-give-amount').value || 0);
    const date   = document.getElementById('sa-give-date').value;
    const note   = document.getElementById('sa-give-note').value.trim();

    if (!empId || amount <= 0 || !date) {
      window.showToast('Select employee, date and amount', 'error');
      return;
    }

    const { error } = await window.sb.from('salary_advances').insert({
      employee_id: empId,
      advance_date: date,
      amount,
      note,
      given_by: window.appState.employee.id,
    });

    if (error) { window.showToast('Error: ' + error.message, 'error'); return; }
    window.showToast('Salary advance recorded!', 'success');
    document.getElementById('sa-give-amount').value = '';
    document.getElementById('sa-give-note').value   = '';
    initSalaryAdvance();
  };
})();
