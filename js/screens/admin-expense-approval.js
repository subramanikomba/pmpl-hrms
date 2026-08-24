// PMPL HRMS — Admin Expense Approval Screen
(function () {
  const screen = document.getElementById('screen-admin-expense-approval');
  if (!screen) return;
  screen.addEventListener('screen:show', loadExpenseApprovals);

  async function loadExpenseApprovals() {
    const filter = document.getElementById('exp-approval-filter').value || 'pending';

    let query = window.sb
      .from('company_expenses')
      .select(
        `*, 
         employees!employee_id(employee_code, first_name, last_name),
         client_companies(name),
         reviewer:employees!reviewed_by(first_name, last_name)`
      )
      .order('created_at', { ascending: false });

    if (filter !== 'all') query = query.eq('status', filter);

    const { data: exps } = await query;

    document.getElementById('expense-approval-list').innerHTML =
      (exps || [])
        .map(
          (e) => `
      <div class="approval-card">
        <div class="approval-header">
          <div>
            <span class="emp-code-badge">${e.employees?.employee_code}</span>
            <strong>${e.employees?.first_name} ${e.employees?.last_name}</strong>
          </div>
          <span class="badge badge-${e.status}">${e.status}</span>
        </div>
        <div class="exp-detail-row">
          <span class="exp-cat-tag">${e.category}</span>
          <span class="exp-amt-big">${window.fmtCurrency(e.amount)}</span>
          <span class="text-muted">${window.fmtDate(e.expense_date)}</span>
        </div>
        ${e.bill_number ? `<div class="text-muted">Bill: ${e.bill_number}</div>` : ''}
        ${e.description ? `<div>${e.description}</div>` : ''}
        ${e.client_companies ? `<div class="text-muted">Client: ${e.client_companies.name}</div>` : ''}
        ${
          e.status === 'pending'
            ? `<div class="btn-row mt-2">
                <button class="btn btn-sm btn-success" onclick="openApproveExpenseModal('${e.id}', '${e.employee_id}', ${e.amount})">✅ Approve</button>
                <button class="btn btn-sm btn-danger"  onclick="rejectExpenseById('${e.id}')">❌ Reject</button>
              </div>`
            : `<div class="approval-decision">
                ${e.status === 'approved' ? '✅' : '❌'} ${e.status} by 
                ${e.reviewer ? e.reviewer.first_name + ' ' + e.reviewer.last_name : 'Admin'}
                on ${window.fmtDate(e.reviewed_at)}
                ${e.review_note ? ` — ${e.review_note}` : ''}
                ${e.accounted_advance_id ? `<br>💵 Accounted against advance: ${window.fmtCurrency(e.accounted_amount)}` : ''}
              </div>`
        }
        <div class="text-muted" style="font-size:11px;margin-top:4px;">Submitted: ${window.fmtDate(e.created_at)}</div>
      </div>`
        )
        .join('') || '<p class="text-muted">No expense claims found.</p>';
  }

  window.filterExpenses = loadExpenseApprovals;

  // ── Approve Expense Modal (with optional advance accounting) ──
  let _pendingExpId = null;
  let _pendingEmpId = null;
  let _pendingAmt   = 0;

  window.openApproveExpenseModal = async function (expId, empId, amount) {
    _pendingExpId = expId;
    _pendingEmpId = empId;
    _pendingAmt   = amount;

    // Check outstanding advances for this employee
    const { data: advances } = await window.sb
      .from('company_advances')
      .select('id, advance_date, amount, reference')
      .eq('employee_id', empId)
      .order('advance_date');

    // Get already-accounted amounts per advance
    const { data: accountedExp } = await window.sb
      .from('company_expenses')
      .select('accounted_advance_id, accounted_amount')
      .eq('employee_id', empId)
      .eq('status', 'approved')
      .not('accounted_advance_id', 'is', null);

    const usedMap = {};
    (accountedExp || []).forEach((e) => {
      usedMap[e.accounted_advance_id] =
        (usedMap[e.accounted_advance_id] || 0) + Number(e.accounted_amount || 0);
    });

    const advanceOpts = (advances || [])
      .map((a) => {
        const outstanding = Number(a.amount) - (usedMap[a.id] || 0);
        if (outstanding <= 0) return '';
        return `<option value="${a.id}" data-outstanding="${outstanding}">
          ${window.fmtDate(a.advance_date)} — ${window.fmtCurrency(a.amount)} 
          (Available: ${window.fmtCurrency(outstanding)})
          ${a.reference ? ' | ' + a.reference : ''}
        </option>`;
      })
      .filter(Boolean)
      .join('');

    document.getElementById('exp-approve-amount').textContent = window.fmtCurrency(amount);
    const sel = document.getElementById('exp-advance-select');
    sel.innerHTML = `<option value="">— Do not account against advance —</option>${advanceOpts}`;
    document.getElementById('exp-accounted-amount').value = amount.toFixed(2);

    if (!advanceOpts) {
      document.getElementById('exp-advance-section').innerHTML =
        '<p class="text-muted">No outstanding company advances for this employee.</p>';
    } else {
      document.getElementById('exp-advance-section').innerHTML = `
        <div class="form-group">
          <label>Account Against Advance (optional)</label>
          <select id="exp-advance-select" class="form-control" onchange="onAdvanceSelected()">
            <option value="">— Do not account against advance —</option>${advanceOpts}
          </select>
        </div>
        <div class="form-group" id="exp-accounted-wrap" style="display:none">
          <label>Amount to Account (₹)</label>
          <input id="exp-accounted-amount" type="number" class="form-control" 
            value="${amount.toFixed(2)}" min="0.01" step="0.01" max="${amount.toFixed(2)}">
          <small class="text-muted">Cannot exceed expense amount or advance outstanding balance.</small>
        </div>`;
    }

    document.getElementById('exp-approve-modal').classList.remove('hidden');
  };

  window.onAdvanceSelected = function () {
    const sel = document.getElementById('exp-advance-select');
    const wrap = document.getElementById('exp-accounted-wrap');
    if (!sel || !wrap) return;
    if (sel.value) {
      const outstanding = parseFloat(sel.selectedOptions[0]?.dataset.outstanding || 0);
      const maxAmt = Math.min(_pendingAmt, outstanding);
      wrap.style.display = 'block';
      const inp = document.getElementById('exp-accounted-amount');
      if (inp) { inp.value = maxAmt.toFixed(2); inp.max = maxAmt.toFixed(2); }
    } else {
      wrap.style.display = 'none';
    }
  };

  window.confirmApproveExpense = async function () {
    if (!_pendingExpId) return;
    const admin = window.appState.employee;
    const sel = document.getElementById('exp-advance-select');
    const advId = sel?.value || null;
    const accountedAmt = advId
      ? parseFloat(document.getElementById('exp-accounted-amount')?.value || 0)
      : null;

    const payload = {
      status: 'approved',
      reviewed_by: admin.id,
      reviewed_at: new Date().toISOString(),
      accounted_advance_id: advId || null,
      accounted_amount: accountedAmt,
    };

    const { error } = await window.sb.from('company_expenses').update(payload).eq('id', _pendingExpId);
    if (error) { window.showToast('Error: ' + error.message, 'error'); return; }

    window.showToast(
      advId
        ? `Expense approved and ₹${accountedAmt?.toFixed(2)} accounted against advance`
        : 'Expense approved',
      'success'
    );
    closeExpApproveModal();
    loadExpenseApprovals();
  };

  window.closeExpApproveModal = function () {
    document.getElementById('exp-approve-modal').classList.add('hidden');
    _pendingExpId = null; _pendingEmpId = null; _pendingAmt = 0;
  };

  window.rejectExpenseById = async function (id) {
    const note = prompt('Reason for rejection (optional):') || '';
    const admin = window.appState.employee;
    const { error } = await window.sb.from('company_expenses').update({
      status: 'rejected',
      reviewed_by: admin.id,
      review_note: note,
      reviewed_at: new Date().toISOString(),
    }).eq('id', id);
    if (error) { window.showToast('Error: ' + error.message, 'error'); return; }
    window.showToast('Expense rejected', 'info');
    loadExpenseApprovals();
  };
})();
