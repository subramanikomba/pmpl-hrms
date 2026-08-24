// PMPL HRMS — Employee Attendance Screen
(function() {
  const screen = document.getElementById('screen-attendance');
  if (!screen) return;

  screen.addEventListener('screen:show', loadAttendance);

  async function loadAttendance() {
    window.initNav();
    const emp = window.appState.employee;
    const today = new Date();
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthEnd   = new Date(today.getFullYear(), today.getMonth()+1, 0);

    document.getElementById('att-emp-name').textContent = emp.first_name + ' ' + emp.last_name;
    document.getElementById('att-month').textContent    = window.fmtMonth(today);
    document.getElementById('att-today').textContent    = window.fmtDate(today);

    // Load this month's attendance
    const { data: records } = await window.sb
      .from('attendance')
      .select('*')
      .eq('employee_id', emp.id)
      .gte('date', window.isoDate(monthStart))
      .lte('date', window.isoDate(monthEnd))
      .order('date', { ascending: false });

    // Load approved leave for this month
    const { data: leaves } = await window.sb
      .from('leave_requests')
      .select('*')
      .eq('employee_id', emp.id)
      .eq('status', 'approved')
      .gte('from_date', window.isoDate(monthStart))
      .lte('to_date', window.isoDate(monthEnd));

    // Load company holidays this month
    const { data: holidays } = await window.sb
      .from('company_holidays')
      .select('*')
      .gte('holiday_date', window.isoDate(monthStart))
      .lte('holiday_date', window.isoDate(monthEnd));

    // Calculate paid days
    let present = 0, paidLeave = 0, weeklyOffs = 0, companyHols = 0;
    const todayStr = window.isoDate(today);

    // Count Sundays in month
    let d = new Date(monthStart);
    while (d <= monthEnd && d <= today) {
      if (d.getDay() === 0) weeklyOffs++;
      d.setDate(d.getDate()+1);
    }
    companyHols = (holidays||[]).filter(h => new Date(h.holiday_date) <= today).length;
    present     = (records||[]).filter(r => r.status === 'present').length;
    paidLeave   = (records||[]).filter(r => r.status === 'paid_leave').length;

    const paidDays = present + paidLeave + weeklyOffs + companyHols;

    document.getElementById('att-summary-present').textContent   = present;
    document.getElementById('att-summary-leave').textContent     = paidLeave;
    document.getElementById('att-summary-weekly').textContent    = weeklyOffs;
    document.getElementById('att-summary-holidays').textContent  = companyHols;
    document.getElementById('att-summary-paid').textContent      = paidDays;

    // Today's status
    const todayRecord = (records||[]).find(r => r.date === todayStr);
    const todayStatus = todayRecord?.status;
    document.getElementById('att-today-status').textContent = todayStatus
      ? statusLabel(todayStatus) : 'Not Marked';

    const markBtn = document.getElementById('att-mark-btn');
    if (today.getDay() === 0) {
      markBtn.textContent = 'Weekly Off (Sunday)';
      markBtn.disabled = true;
    } else if (holidays?.some(h => h.holiday_date === todayStr)) {
      markBtn.textContent = 'Company Holiday Today';
      markBtn.disabled = true;
    } else if (todayStatus === 'present') {
      markBtn.textContent = '✓ Already Marked Present';
      markBtn.disabled = true;
    } else {
      markBtn.textContent = 'Mark Present Today';
      markBtn.disabled = false;
    }

    // Recent attendance (last 10)
    const recentHtml = (records||[]).slice(0,10).map(r => `
      <div class="att-row">
        <span class="att-date">${window.fmtDate(r.date)}</span>
        <span class="badge badge-${r.status}">${statusLabel(r.status)}</span>
      </div>`).join('') || '<p class="text-muted">No records this month.</p>';
    document.getElementById('att-recent').innerHTML = recentHtml;

    // Outstanding advance
    const { data: advances } = await window.sb
      .from('company_advance_ledger')
      .select('running_balance')
      .eq('employee_id', emp.id)
      .order('txn_date', { ascending: false })
      .limit(1);

    const balance = advances?.[0]?.running_balance || 0;
    const advEl = document.getElementById('att-advance-balance');
    if (balance > 0) {
      advEl.textContent = 'Outstanding Advance: ' + window.fmtCurrency(balance);
      advEl.classList.remove('hidden');
    } else {
      advEl.classList.add('hidden');
    }

    // Pending notifications
    const { data: pendingLeaves } = await window.sb
      .from('leave_requests')
      .select('id,from_date,to_date,status')
      .eq('employee_id', emp.id)
      .eq('status', 'pending');

    const { data: pendingExp } = await window.sb
      .from('company_expenses')
      .select('id,expense_date,amount,status')
      .eq('employee_id', emp.id)
      .eq('status', 'pending');

    const notifs = [
      ...(pendingLeaves||[]).map(l => `Leave ${window.fmtDate(l.from_date)}–${window.fmtDate(l.to_date)}: Pending approval`),
      ...(pendingExp||[]).map(e => `Expense ${window.fmtCurrency(e.amount)} on ${window.fmtDate(e.expense_date)}: Pending approval`)
    ];
    document.getElementById('att-notifications').innerHTML = notifs.length
      ? notifs.map(n => `<div class="notif-item">🔔 ${n}</div>`).join('')
      : '<p class="text-muted">No pending items.</p>';
  }

  // Mark Present
  window.markPresent = async function() {
    const emp = window.appState.employee;
    const today = window.isoDate(new Date());
    const { error } = await window.sb.from('attendance').upsert({
      employee_id: emp.id,
      date: today,
      status: 'present',
      marked_by: emp.id
    }, { onConflict: 'employee_id,date' });

    if (error) { window.showToast('Error: ' + error.message, 'error'); return; }
    window.showToast('Marked Present for today!', 'success');
    loadAttendance();
  };

  function statusLabel(s) {
    return { present:'Present', paid_leave:'Paid Leave', weekly_off:'Weekly Off',
             company_holiday:'Company Holiday', absent:'Absent' }[s] || s;
  }
})();
