// PMPL HRMS — Payroll Summary & Annual Report Screen
(function () {
  const screen = document.getElementById('screen-admin-payroll-summary');
  if (!screen) return;
  screen.addEventListener('screen:show', initPayrollSummary);

  async function initPayrollSummary() {
    // Populate year selector
    const now = new Date();
    const sel = document.getElementById('pay-summary-year');
    sel.innerHTML = '';
    for (let y = now.getFullYear(); y >= now.getFullYear() - 4; y--) {
      sel.innerHTML += `<option value="${y}" ${y === now.getFullYear() ? 'selected' : ''}>${y}–${y + 1}</option>`;
    }
    await loadPayrollSummary();
  }

  window.loadPayrollSummary = async function () {
    const year = parseInt(document.getElementById('pay-summary-year').value);
    // FY: April year to March year+1
    const fyStart = `${year}-04-01`;
    const fyEnd   = `${year + 1}-03-31`;

    const { data: payRows } = await window.sb
      .from('payroll')
      .select('*, employees!employee_id(employee_code, first_name, last_name, designation)')
      .gte('payroll_month', fyStart)
      .lte('payroll_month', fyEnd)
      .order('payroll_month')
      .order('employee_id');

    if (!payRows?.length) {
      document.getElementById('pay-summary-output').innerHTML =
        '<p class="text-muted">No payroll records for this year.</p>';
      return;
    }

    // ── Monthly Summary ────────────────────────────────────────
    const monthMap = {};
    payRows.forEach((r) => {
      const mo = r.payroll_month;
      if (!monthMap[mo]) monthMap[mo] = { gross: 0, pt: 0, saRec: 0, otherDed: 0, net: 0, count: 0 };
      monthMap[mo].gross   += Number(r.gross_salary || 0);
      monthMap[mo].pt      += Number(r.professional_tax || 0);
      monthMap[mo].saRec   += Number(r.salary_advance_recovered || 0);
      monthMap[mo].otherDed+= Number(r.other_deductions || 0);
      monthMap[mo].net     += Number(r.net_salary || 0);
      monthMap[mo].count++;
    });

    const MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
    const fyMonths = [];
    for (let m = 3; m <= 14; m++) {
      const mo = m <= 11 ? `${year}-${String(m + 1).padStart(2, '0')}-01` : `${year + 1}-${String(m - 11).padStart(2, '0')}-01`;
      fyMonths.push(mo);
    }

    let totalGross = 0, totalPT = 0, totalSA = 0, totalOD = 0, totalNet = 0;
    const monthRows = fyMonths
      .filter((mo) => monthMap[mo])
      .map((mo) => {
        const d = monthMap[mo];
        totalGross += d.gross; totalPT += d.pt; totalSA += d.saRec;
        totalOD += d.otherDed; totalNet += d.net;
        const dt = new Date(mo);
        return `<tr>
          <td>${dt.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}</td>
          <td>${d.count}</td>
          <td>${window.fmtCurrency(d.gross)}</td>
          <td>${window.fmtCurrency(d.pt)}</td>
          <td>${window.fmtCurrency(d.saRec)}</td>
          <td>${window.fmtCurrency(d.otherDed)}</td>
          <td class="fw-bold">${window.fmtCurrency(d.net)}</td>
        </tr>`;
      })
      .join('');

    // ── Employee-wise Annual Summary ───────────────────────────
    const empAnnual = {};
    payRows.forEach((r) => {
      const eid = r.employee_id;
      if (!empAnnual[eid]) {
        empAnnual[eid] = { emp: r.employees, gross: 0, pt: 0, saRec: 0, otherDed: 0, net: 0, months: 0 };
      }
      empAnnual[eid].gross    += Number(r.gross_salary || 0);
      empAnnual[eid].pt       += Number(r.professional_tax || 0);
      empAnnual[eid].saRec    += Number(r.salary_advance_recovered || 0);
      empAnnual[eid].otherDed += Number(r.other_deductions || 0);
      empAnnual[eid].net      += Number(r.net_salary || 0);
      empAnnual[eid].months++;
    });

    const empRows = Object.values(empAnnual)
      .sort((a, b) => (a.emp?.employee_code || '').localeCompare(b.emp?.employee_code || ''))
      .map(
        (e) => `<tr>
          <td>${e.emp?.employee_code}</td>
          <td>${e.emp?.first_name} ${e.emp?.last_name}</td>
          <td>${e.emp?.designation || '—'}</td>
          <td>${e.months}</td>
          <td>${window.fmtCurrency(e.gross)}</td>
          <td>${window.fmtCurrency(e.pt)}</td>
          <td>${window.fmtCurrency(e.saRec)}</td>
          <td class="fw-bold">${window.fmtCurrency(e.net)}</td>
        </tr>`
      )
      .join('');

    document.getElementById('pay-summary-output').innerHTML = `
      <div class="card">
        <div class="card-title">Monthly Summary — FY ${year}–${year + 1}</div>
        <div style="overflow-x:auto">
          <table class="data-table">
            <thead><tr>
              <th>Month</th><th>Employees</th><th>Gross Salary</th>
              <th>Prof. Tax</th><th>SA Recovered</th><th>Other Ded.</th><th>Net Payable</th>
            </tr></thead>
            <tbody>${monthRows}</tbody>
            <tfoot><tr style="font-weight:700;background:#f0f0f0;">
              <td>ANNUAL TOTAL</td><td>—</td>
              <td>${window.fmtCurrency(totalGross)}</td>
              <td>${window.fmtCurrency(totalPT)}</td>
              <td>${window.fmtCurrency(totalSA)}</td>
              <td>${window.fmtCurrency(totalOD)}</td>
              <td>${window.fmtCurrency(totalNet)}</td>
            </tr></tfoot>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Employee-wise Annual Summary — FY ${year}–${year + 1}</div>
        <div style="overflow-x:auto">
          <table class="data-table">
            <thead><tr>
              <th>Code</th><th>Name</th><th>Designation</th><th>Months</th>
              <th>Gross</th><th>Prof. Tax</th><th>SA Recovered</th><th>Net Paid</th>
            </tr></thead>
            <tbody>${empRows}</tbody>
            <tfoot><tr style="font-weight:700;background:#f0f0f0;">
              <td colspan="4">TOTAL</td>
              <td>${window.fmtCurrency(totalGross)}</td>
              <td>${window.fmtCurrency(totalPT)}</td>
              <td>${window.fmtCurrency(totalSA)}</td>
              <td>${window.fmtCurrency(totalNet)}</td>
            </tr></tfoot>
          </table>
        </div>
      </div>`;
  };
})();
