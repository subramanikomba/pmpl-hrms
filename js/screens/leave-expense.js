// PMPL HRMS — Leave, Expense & Advance Screens

// ── Employee: Apply Leave ─────────────────────────────────────
window.applyLeave = async function() {
  const fromDate = document.getElementById('leave-from').value;
  const toDate   = document.getElementById('leave-to').value || fromDate;
  const reason   = document.getElementById('leave-reason').value.trim();

  if (!fromDate) { window.showToast('Select leave date','error'); return; }

  // Validate: must be future date
  if (fromDate <= window.isoDate(new Date())) {
    window.showToast('Leave must be applied for future dates','error'); return;
  }

  const { error } = await window.sb.from('leave_requests').insert({
    employee_id: window.appState.employee.id,
    from_date: fromDate, to_date: toDate,
    leave_type: 'paid_leave', reason,
    status: 'pending'
  });

  if (error) { window.showToast('Error: '+error.message,'error'); return; }
  window.showToast('Leave application submitted!','success');
  document.getElementById('leave-from').value = '';
  document.getElementById('leave-to').value   = '';
  document.getElementById('leave-reason').value = '';
};

// ── Employee: Leave History ────────────────────────────────────
(function() {
  const screen = document.getElementById('screen-leave-history');
  if (!screen) return;
  screen.addEventListener('screen:show', loadLeaveHistory);

  async function loadLeaveHistory() {
    const { data: leaves } = await window.sb
      .from('leave_requests')
      .select('*')
      .eq('employee_id', window.appState.employee.id)
      .order('from_date', { ascending: false });

    document.getElementById('leave-history-list').innerHTML = (leaves||[]).map(l => `
      <div class="leave-card">
        <div class="leave-dates">${window.fmtDate(l.from_date)} – ${window.fmtDate(l.to_date)}</div>
        <div>${l.reason||'No reason given'}</div>
        <span class="badge badge-${l.status}">${l.status}</span>
        ${l.review_note ? `<div class="text-muted mt-1">Note: ${l.review_note}</div>` : ''}
      </div>`).join('') || '<p class="text-muted">No leave history.</p>';
  }
})();

// ── Employee: Company Expenses ─────────────────────────────────
(function() {
  const screen = document.getElementById('screen-my-expenses');
  if (!screen) return;
  screen.addEventListener('screen:show', loadMyExpenses);

  async function loadMyExpenses() {
    window.initNav();
    const { data: clients } = await window.sb.from('client_companies').select('id,name').eq('is_active',true);
    const clientOpts = (clients||[]).map(c=>`<option value="${c.id}">${c.name}</option>`).join('');
    document.getElementById('exp-client').innerHTML = `<option value="">— No Client —</option>${clientOpts}`;

    const { data: exps } = await window.sb
      .from('company_expenses')
      .select('*,client_companies(name)')
      .eq('employee_id', window.appState.employee.id)
      .order('expense_date', { ascending:false });

    document.getElementById('my-exp-list').innerHTML = (exps||[]).map(e => `
      <div class="exp-card">
        <div class="exp-header">
          <span class="exp-cat">${e.category}</span>
          <span class="exp-amt">${window.fmtCurrency(e.amount)}</span>
          <span class="badge badge-${e.status}">${e.status}</span>
        </div>
        <div class="text-muted">${window.fmtDate(e.expense_date)} | Bill: ${e.bill_number||'—'}</div>
        <div>${e.description||''}</div>
        ${e.client_companies ? `<div class="text-muted">Client: ${e.client_companies.name}</div>` : ''}
        ${e.review_note ? `<div class="text-muted">Note: ${e.review_note}</div>` : ''}
      </div>`).join('') || '<p class="text-muted">No expense records.</p>';
  }

  window.submitExpense = async function() {
    const emp = window.appState.employee;
    const payload = {
      employee_id:  emp.id,
      expense_date: document.getElementById('exp-date').value,
      category:     document.getElementById('exp-category').value,
      amount:       parseFloat(document.getElementById('exp-amount').value||0),
      bill_number:  document.getElementById('exp-bill').value.trim(),
      description:  document.getElementById('exp-desc').value.trim(),
      client_id:    document.getElementById('exp-client').value || null,
      status: 'pending'
    };
    if (!payload.expense_date || !payload.category || payload.amount <= 0) {
      window.showToast('Fill date, category and amount','error'); return;
    }
    const { error } = await window.sb.from('company_expenses').insert(payload);
    if (error) { window.showToast('Error: '+error.message,'error'); return; }
    window.showToast('Expense submitted!','success');
    document.getElementById('exp-form').reset();
    loadMyExpenses();
  };
})();

// ── Admin: Company Advance & Expense Ledger ───────────────────
(function() {
  const screen = document.getElementById('screen-admin-advance-ledger');
  if (!screen) return;
  screen.addEventListener('screen:show', loadAdvanceLedger);

  let selectedEmpId = null;

  async function loadAdvanceLedger() {
    const { data: emps } = await window.sb
      .from('employees').select('id,first_name,last_name,employee_code')
      .eq('status','active').order('employee_code');

    const opts = (emps||[]).map(e=>
      `<option value="${e.id}">${e.employee_code} — ${e.first_name} ${e.last_name}</option>`
    ).join('');
    document.getElementById('ledger-emp-select').innerHTML = `<option value="">Select Employee…</option>${opts}`;
  }

  window.loadLedgerForEmp = async function() {
    selectedEmpId = document.getElementById('ledger-emp-select').value;
    if (!selectedEmpId) return;

    const { data: ledger } = await window.sb
      .from('company_advance_ledger')
      .select('*')
      .eq('employee_id', selectedEmpId)
      .order('txn_date');

    document.getElementById('ledger-table').innerHTML = `
      <table class="data-table">
        <thead><tr>
          <th>Date</th><th>Type</th><th>Debit (Advance)</th><th>Credit (Expense)</th>
          <th>Reference</th><th>Description</th><th>Balance</th>
        </tr></thead>
        <tbody>
          ${(ledger||[]).map(r=>`<tr>
            <td>${window.fmtDate(r.txn_date)}</td>
            <td><span class="badge badge-${r.txn_type}">${r.txn_type}</span></td>
            <td>${r.debit>0?window.fmtCurrency(r.debit):'—'}</td>
            <td>${r.credit>0?window.fmtCurrency(r.credit):'—'}</td>
            <td>${r.reference||'—'}</td>
            <td>${r.description||''}</td>
            <td class="fw-bold">${window.fmtCurrency(r.running_balance)}</td>
          </tr>`).join('')}
        </tbody>
      </table>`;

    // Show give advance form
    document.getElementById('give-advance-section').classList.remove('hidden');
  };

  window.giveCompanyAdvance = async function() {
    if (!selectedEmpId) return;
    const amount = parseFloat(document.getElementById('adv-amount').value||0);
    const date   = document.getElementById('adv-date').value;
    const ref    = document.getElementById('adv-ref').value.trim();
    const note   = document.getElementById('adv-note').value.trim();
    if (amount <= 0 || !date) { window.showToast('Enter date and amount','error'); return; }

    const { error } = await window.sb.from('company_advances').insert({
      employee_id: selectedEmpId, advance_date: date,
      amount, reference: ref, note,
      given_by: window.appState.employee.id
    });
    if (error) { window.showToast('Error: '+error.message,'error'); return; }
    window.showToast('Advance recorded!','success');
    document.getElementById('adv-amount').value = '';
    document.getElementById('adv-ref').value = '';
    document.getElementById('adv-note').value = '';
    loadLedgerForEmp();
  };
})();
