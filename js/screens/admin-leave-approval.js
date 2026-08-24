// PMPL HRMS — Admin Leave Approval Screen
(function () {
  const screen = document.getElementById('screen-admin-leave-approval');
  if (!screen) return;
  screen.addEventListener('screen:show', loadLeaveApprovals);

  async function loadLeaveApprovals() {
    const filter = document.getElementById('leave-filter').value || 'pending';

    let query = window.sb
      .from('leave_requests')
      .select(
        `*, employees!employee_id(employee_code, first_name, last_name, designation),
         reviewer:employees!reviewed_by(first_name, last_name)`
      )
      .order('created_at', { ascending: false });

    if (filter !== 'all') query = query.eq('status', filter);

    const { data: leaves } = await query;

    document.getElementById('leave-approval-list').innerHTML =
      (leaves || [])
        .map(
          (l) => `
      <div class="approval-card">
        <div class="approval-header">
          <div>
            <span class="emp-code-badge">${l.employees?.employee_code}</span>
            <strong>${l.employees?.first_name} ${l.employees?.last_name}</strong>
            <span class="text-muted ml-2">${l.employees?.designation || ''}</span>
          </div>
          <span class="badge badge-${l.status}">${l.status}</span>
        </div>
        <div class="approval-dates">
          📅 ${window.fmtDate(l.from_date)} – ${window.fmtDate(l.to_date)}
          <span class="text-muted ml-2">(${dayCount(l.from_date, l.to_date)} day${dayCount(l.from_date, l.to_date) > 1 ? 's' : ''})</span>
        </div>
        ${l.reason ? `<div class="approval-reason">${l.reason}</div>` : ''}
        ${
          l.status !== 'pending'
            ? `<div class="approval-decision">
                ${l.status === 'approved' ? '✅' : '❌'} ${l.status} by ${l.reviewer ? l.reviewer.first_name + ' ' + l.reviewer.last_name : 'Admin'}
                on ${window.fmtDate(l.reviewed_at)}
                ${l.review_note ? ` — ${l.review_note}` : ''}
              </div>`
            : `<div class="btn-row mt-2">
                <button class="btn btn-sm btn-success" onclick="doApproveLeave('${l.id}', '${l.employee_id}', '${l.from_date}', '${l.to_date}')">✅ Approve</button>
                <button class="btn btn-sm btn-danger"  onclick="doRejectLeave('${l.id}')">❌ Reject</button>
              </div>`
        }
        <div class="text-muted" style="font-size:11px;margin-top:4px;">Applied: ${window.fmtDate(l.created_at)}</div>
      </div>`
        )
        .join('') || '<p class="text-muted">No leave requests found.</p>';
  }

  window.filterLeaves = loadLeaveApprovals;

  // Approve: mark leave days in attendance table
  window.doApproveLeave = async function (leaveId, empId, fromDate, toDate) {
    const admin = window.appState.employee;

    // Update leave request
    const { error: leaveErr } = await window.sb
      .from('leave_requests')
      .update({
        status: 'approved',
        reviewed_by: admin.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', leaveId);

    if (leaveErr) { window.showToast('Error: ' + leaveErr.message, 'error'); return; }

    // Create attendance records for each leave day
    const records = [];
    let cur = new Date(fromDate);
    const end = new Date(toDate);
    while (cur <= end) {
      const dayStr = window.isoDate(cur);
      if (cur.getDay() !== 0) {
        // Not Sunday — mark as paid_leave
        records.push({ employee_id: empId, date: dayStr, status: 'paid_leave', marked_by: admin.id });
      }
      cur.setDate(cur.getDate() + 1);
    }

    if (records.length) {
      const { error: attErr } = await window.sb
        .from('attendance')
        .upsert(records, { onConflict: 'employee_id,date' });
      if (attErr) window.showToast('Warning: attendance update partial — ' + attErr.message, 'error');
    }

    window.showToast('Leave approved and attendance updated', 'success');
    loadLeaveApprovals();
  };

  window.doRejectLeave = async function (leaveId) {
    const note = prompt('Reason for rejection (optional):') || '';
    const admin = window.appState.employee;
    const { error } = await window.sb
      .from('leave_requests')
      .update({
        status: 'rejected',
        reviewed_by: admin.id,
        review_note: note,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', leaveId);
    if (error) { window.showToast('Error: ' + error.message, 'error'); return; }
    window.showToast('Leave rejected', 'info');
    loadLeaveApprovals();
  };

  function dayCount(from, to) {
    const f = new Date(from), t = new Date(to);
    return Math.round((t - f) / 86400000) + 1;
  }
})();
