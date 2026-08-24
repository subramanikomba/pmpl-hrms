// PMPL HRMS — Admin Dashboard
(function() {
  const screen = document.getElementById('screen-admin-dashboard');
  if (!screen) return;
  screen.addEventListener('screen:show', loadDashboard);

  async function loadDashboard() {
    window.initNav();
    const today = window.isoDate(new Date());
    const monthStart = window.isoDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1));

    // Active employees
    const { data: emps } = await window.sb.from('employees').select('id,status,first_name,last_name').eq('status','active');
    const activeCount = (emps||[]).length;
    document.getElementById('dash-active-emp').textContent = activeCount;

    // Attendance today
    const { data: todayAtt } = await window.sb.from('attendance').select('status').eq('date', today);
    const presentToday = (todayAtt||[]).filter(r=>r.status==='present').length;
    const onLeaveToday = (todayAtt||[]).filter(r=>r.status==='paid_leave').length;
    document.getElementById('dash-present-today').textContent = presentToday;
    document.getElementById('dash-leave-today').textContent   = onLeaveToday;

    // Pending approvals
    const { data: pendLeave } = await window.sb.from('leave_requests').select('id').eq('status','pending');
    const { data: pendExp   } = await window.sb.from('company_expenses').select('id').eq('status','pending');
    const totalPending = (pendLeave?.length||0) + (pendExp?.length||0);
    document.getElementById('dash-pending').textContent = totalPending;

    // Pending leave list
    const { data: leaveList } = await window.sb
      .from('leave_requests')
      .select('id,from_date,to_date,reason,employees(first_name,last_name)')
      .eq('status','pending')
      .order('created_at');

    document.getElementById('dash-leave-list').innerHTML = (leaveList||[]).map(l => `
      <div class="approval-item">
        <div>
          <strong>${l.employees?.first_name} ${l.employees?.last_name}</strong>
          <span class="text-muted ml-2">${window.fmtDate(l.from_date)} – ${window.fmtDate(l.to_date)}</span>
        </div>
        <div class="mt-1 text-muted">${l.reason||'No reason given'}</div>
        <div class="btn-row mt-1">
          <button class="btn btn-sm btn-success" onclick="approveLeave('${l.id}')">Approve</button>
          <button class="btn btn-sm btn-danger"  onclick="rejectLeave('${l.id}')">Reject</button>
        </div>
      </div>`).join('') || '<p class="text-muted">No pending leave requests.</p>';

    // Pending expense list
    const { data: expList } = await window.sb
      .from('company_expenses')
      .select('id,expense_date,amount,category,description,employees(first_name,last_name)')
      .eq('status','pending')
      .order('created_at');

    document.getElementById('dash-expense-list').innerHTML = (expList||[]).map(e => `
      <div class="approval-item">
        <div>
          <strong>${e.employees?.first_name} ${e.employees?.last_name}</strong>
          <span class="text-muted ml-2">${e.category} — ${window.fmtCurrency(e.amount)}</span>
        </div>
        <div class="text-muted">${window.fmtDate(e.expense_date)} | ${e.description||''}</div>
        <div class="btn-row mt-1">
          <button class="btn btn-sm btn-success" onclick="approveExpense('${e.id}')">Approve</button>
          <button class="btn btn-sm btn-danger"  onclick="rejectExpense('${e.id}')">Reject</button>
        </div>
      </div>`).join('') || '<p class="text-muted">No pending expenses.</p>';

    // Payroll snapshot — current month
    const { data: payrollRows } = await window.sb
      .from('payroll')
      .select('status,net_salary')
      .eq('payroll_month', monthStart);

    const processed = (payrollRows||[]).filter(p=>p.status!=='draft').length;
    const netPayable = (payrollRows||[]).reduce((s,p)=>s + Number(p.net_salary||0), 0);
    document.getElementById('dash-payroll-month').textContent    = window.fmtMonth(new Date());
    document.getElementById('dash-payroll-processed').textContent = processed + ' / ' + activeCount;
    document.getElementById('dash-net-payable').textContent      = window.fmtCurrency(netPayable);

    // Outstanding advances
    const { data: advSummary } = await window.sb.rpc('company_advance_summary_all');
    // Fallback: query directly
    const { data: advRaw } = await window.sb
      .from('company_advances')
      .select('employee_id, amount');
    const { data: accExp } = await window.sb
      .from('company_expenses')
      .select('accounted_amount')
      .eq('status','approved')
      .not('accounted_advance_id', 'is', null);
    const totalAdv = (advRaw||[]).reduce((s,r)=>s+Number(r.amount),0);
    const totalAcc = (accExp||[]).reduce((s,r)=>s+Number(r.accounted_amount||0),0);
    document.getElementById('dash-outstanding-advance').textContent = window.fmtCurrency(totalAdv - totalAcc);
  }

  // Quick approve/reject leave from dashboard
  window.approveLeave = async function(id) {
    await window.sb.from('leave_requests').update({
      status:'approved', reviewed_by: window.appState.employee.id,
      reviewed_at: new Date().toISOString()
    }).eq('id',id);
    window.showToast('Leave approved','success');
    loadDashboard();
  };
  window.rejectLeave = async function(id) {
    const note = prompt('Reason for rejection (optional):');
    await window.sb.from('leave_requests').update({
      status:'rejected', reviewed_by: window.appState.employee.id,
      review_note: note, reviewed_at: new Date().toISOString()
    }).eq('id',id);
    window.showToast('Leave rejected','info');
    loadDashboard();
  };
  window.approveExpense = async function(id) {
    await window.sb.from('company_expenses').update({
      status:'approved', reviewed_by: window.appState.employee.id,
      reviewed_at: new Date().toISOString()
    }).eq('id',id);
    window.showToast('Expense approved','success');
    loadDashboard();
  };
  window.rejectExpense = async function(id) {
    const note = prompt('Reason for rejection (optional):');
    await window.sb.from('company_expenses').update({
      status:'rejected', reviewed_by: window.appState.employee.id,
      review_note: note, reviewed_at: new Date().toISOString()
    }).eq('id',id);
    window.showToast('Expense rejected','info');
    loadDashboard();
  };
})();
