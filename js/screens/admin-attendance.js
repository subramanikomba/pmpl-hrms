// PMPL HRMS — Admin Attendance Reports Screen
(function () {
  const screen = document.getElementById('screen-admin-attendance');
  if (!screen) return;
  screen.addEventListener('screen:show', initAttReport);

  async function initAttReport() {
    // Populate employee dropdown
    const { data: emps } = await window.sb
      .from('employees')
      .select('id, employee_code, first_name, last_name')
      .eq('status', 'active')
      .order('employee_code');

    const sel = document.getElementById('att-report-emp');
    sel.innerHTML =
      '<option value="">All Employees</option>' +
      (emps || [])
        .map(
          (e) =>
            `<option value="${e.id}">${e.employee_code} — ${e.first_name} ${e.last_name}</option>`
        )
        .join('');

    // Default to current month
    const now = new Date();
    document.getElementById('att-report-month').value = `${now.getFullYear()}-${String(
      now.getMonth() + 1
    ).padStart(2, '0')}`;

    await loadAttReport();
  }

  window.loadAttReport = async function () {
    const monthVal = document.getElementById('att-report-month').value;
    const empId = document.getElementById('att-report-emp').value;
    if (!monthVal) return;

    const [y, m] = monthVal.split('-');
    const monthStart = new Date(+y, +m - 1, 1);
    const monthEnd = new Date(+y, +m, 0);
    const daysInMonth = monthEnd.getDate();
    const monthStartStr = window.isoDate(monthStart);
    const monthEndStr = window.isoDate(monthEnd);

    // Active employees (filtered or all)
    let empQuery = window.sb
      .from('employees')
      .select('id, employee_code, first_name, last_name')
      .eq('status', 'active')
      .order('employee_code');
    if (empId) empQuery = empQuery.eq('id', empId);
    const { data: emps } = await empQuery;

    // Attendance for the month
    let attQuery = window.sb
      .from('attendance')
      .select('employee_id, date, status')
      .gte('date', monthStartStr)
      .lte('date', monthEndStr);
    if (empId) attQuery = attQuery.eq('employee_id', empId);
    const { data: attRecords } = await attQuery;

    // Holidays
    const { data: holidays } = await window.sb
      .from('company_holidays')
      .select('holiday_date')
      .gte('holiday_date', monthStartStr)
      .lte('holiday_date', monthEndStr);
    const holidayDates = new Set((holidays || []).map((h) => h.holiday_date));

    // Build attendance map: empId → { dateStr → status }
    const attMap = {};
    (attRecords || []).forEach((r) => {
      if (!attMap[r.employee_id]) attMap[r.employee_id] = {};
      attMap[r.employee_id][r.date] = r.status;
    });

    // Build day headers (1..daysInMonth)
    const days = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dt = new Date(+y, +m - 1, d);
      days.push({ d, day: dt.getDay(), str: window.isoDate(dt) });
    }

    // Day header row
    const dayHeaders = days
      .map((d) => {
        const cls = d.day === 0 ? 'day-sunday' : holidayDates.has(d.str) ? 'day-holiday' : '';
        const label = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][d.day];
        return `<th class="${cls}" title="${d.str}">${d.d}<br><small>${label}</small></th>`;
      })
      .join('');

    // Build rows
    const rows = (emps || [])
      .map((emp) => {
        const empAtt = attMap[emp.id] || {};
        let present = 0, paidLeave = 0, weeklyOff = 0, holiday = 0, absent = 0;

        const cells = days
          .map((d) => {
            let status = empAtt[d.str];
            let cls = '';
            let symbol = '';

            if (d.day === 0) {
              // Sunday — always weekly off
              status = status || 'weekly_off';
              cls = 'cell-weekly-off'; symbol = 'WO'; weeklyOff++;
            } else if (holidayDates.has(d.str) && !status) {
              status = 'company_holiday';
              cls = 'cell-holiday'; symbol = 'CH'; holiday++;
            } else if (status === 'present') {
              cls = 'cell-present'; symbol = 'P'; present++;
            } else if (status === 'paid_leave') {
              cls = 'cell-leave'; symbol = 'PL'; paidLeave++;
            } else if (status === 'weekly_off') {
              cls = 'cell-weekly-off'; symbol = 'WO'; weeklyOff++;
            } else if (status === 'company_holiday') {
              cls = 'cell-holiday'; symbol = 'CH'; holiday++;
            } else if (d.str <= window.isoDate(new Date())) {
              cls = 'cell-absent'; symbol = 'A'; absent++;
            } else {
              cls = 'cell-future'; symbol = '—';
            }
            return `<td class="att-cell ${cls}">${symbol}</td>`;
          })
          .join('');

        const paidDays = present + paidLeave + weeklyOff + holiday;

        return `<tr>
          <td class="att-emp-col"><strong>${emp.employee_code}</strong><br>${emp.first_name} ${emp.last_name}</td>
          ${cells}
          <td class="att-sum">${present}</td>
          <td class="att-sum">${paidLeave}</td>
          <td class="att-sum">${weeklyOff}</td>
          <td class="att-sum">${holiday}</td>
          <td class="att-sum att-paid">${paidDays}</td>
          <td class="att-sum" style="color:var(--danger)">${absent}</td>
        </tr>`;
      })
      .join('');

    const html = `
      <div style="overflow-x:auto;">
        <table class="att-report-table">
          <thead>
            <tr>
              <th class="att-emp-col">Employee</th>
              ${dayHeaders}
              <th class="att-sum">P</th>
              <th class="att-sum">PL</th>
              <th class="att-sum">WO</th>
              <th class="att-sum">CH</th>
              <th class="att-sum att-paid">Paid</th>
              <th class="att-sum">Abs</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="att-legend">
        <span class="cell-present">P</span> Present &nbsp;
        <span class="cell-leave">PL</span> Paid Leave &nbsp;
        <span class="cell-weekly-off">WO</span> Weekly Off &nbsp;
        <span class="cell-holiday">CH</span> Company Holiday &nbsp;
        <span class="cell-absent">A</span> Absent
      </div>`;

    document.getElementById('att-report-output').innerHTML = html;
  };

  // ── Attendance Audit Viewer ───────────────────────────────────
  window.viewAttAudit = async function (empId, dateStr) {
    const { data: audit } = await window.sb
      .from('attendance_audit')
      .select('*, changed_by_emp:employees!changed_by(first_name,last_name)')
      .eq('employee_id', empId)
      .eq('date', dateStr)
      .order('changed_at');

    const rows = (audit || [])
      .map(
        (a) =>
          `<tr>
          <td>${new Date(a.changed_at).toLocaleString('en-IN')}</td>
          <td>${a.old_status || '—'}</td>
          <td>${a.new_status}</td>
          <td>${a.changed_by_emp ? a.changed_by_emp.first_name + ' ' + a.changed_by_emp.last_name : '—'}</td>
          <td>${a.reason || '—'}</td>
        </tr>`
      )
      .join('');

    document.getElementById('audit-modal-body').innerHTML = rows
      ? `<table class="data-table"><thead><tr><th>When</th><th>From</th><th>To</th><th>By</th><th>Reason</th></tr></thead><tbody>${rows}</tbody></table>`
      : '<p class="text-muted">No audit records.</p>';
    document.getElementById('audit-modal').classList.remove('hidden');
  };

  window.closeAuditModal = function () {
    document.getElementById('audit-modal').classList.add('hidden');
  };
})();
