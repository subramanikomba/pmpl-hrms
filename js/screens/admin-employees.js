// PMPL HRMS — Admin Employee Management
(function() {
  const screen = document.getElementById('screen-admin-employees');
  if (!screen) return;
  screen.addEventListener('screen:show', loadEmployees);

  async function loadEmployees() {
    const { data: emps, error } = await window.sb
      .from('employees')
      .select('*')
      .order('employee_code');

    document.getElementById('emp-list').innerHTML = (emps||[]).map(e => `
      <div class="emp-card ${e.status==='inactive'?'emp-inactive':''}">
        <div class="emp-card-header">
          <span class="emp-code">${e.employee_code}</span>
          <span class="badge badge-${e.status}">${e.status}</span>
          ${e.is_admin ? '<span class="badge badge-admin">Admin</span>' : ''}
        </div>
        <div class="emp-name">${e.first_name} ${e.last_name}</div>
        <div class="emp-details">
          <span>${e.designation||'—'}</span>
          <span>${e.contact_email||'—'}</span>
          <span>PAN: ${e.pan||'—'}</span>
        </div>
        <div class="btn-row mt-2">
          <button class="btn btn-sm btn-outline" onclick="editEmployee('${e.id}')">Edit</button>
          <button class="btn btn-sm btn-outline" onclick="editSalaryStructure('${e.id}','${e.first_name} ${e.last_name}')">Salary</button>
          <button class="btn btn-sm btn-outline" onclick="toggleEmpStatus('${e.id}','${e.status}')">
            ${e.status==='active'?'Deactivate':'Activate'}
          </button>
        </div>
      </div>`).join('');
  }

  // ── Add Employee ──────────────────────────────────────────────
  window.showAddEmployee = function() {
    document.getElementById('emp-modal-title').textContent = 'Add Employee';
    document.getElementById('emp-form').reset();
    document.getElementById('emp-form-id').value = '';
    document.getElementById('emp-modal-pw-section').classList.remove('hidden');
    document.getElementById('emp-modal').classList.remove('hidden');
  };

  window.closeEmpModal = function() {
    document.getElementById('emp-modal').classList.add('hidden');
  };

  window.editEmployee = async function(id) {
    const { data: emp } = await window.sb.from('employees').select('*').eq('id',id).single();
    if (!emp) return;
    document.getElementById('emp-modal-title').textContent = 'Edit Employee';
    document.getElementById('emp-form-id').value      = emp.id;
    document.getElementById('emp-first-name').value   = emp.first_name;
    document.getElementById('emp-last-name').value    = emp.last_name;
    document.getElementById('emp-username').value     = emp.username;
    document.getElementById('emp-email').value        = emp.contact_email||'';
    document.getElementById('emp-designation').value  = emp.designation||'';
    document.getElementById('emp-pan').value          = emp.pan||'';
    document.getElementById('emp-is-admin').checked   = emp.is_admin;
    document.getElementById('emp-modal-pw-section').classList.add('hidden');
    document.getElementById('emp-modal').classList.remove('hidden');
  };

  window.saveEmployee = async function() {
    const id        = document.getElementById('emp-form-id').value;
    const firstName = document.getElementById('emp-first-name').value.trim();
    const lastName  = document.getElementById('emp-last-name').value.trim();
    const username  = document.getElementById('emp-username').value.trim();
    const email     = document.getElementById('emp-email').value.trim();
    const designation = document.getElementById('emp-designation').value.trim();
    const pan       = document.getElementById('emp-pan').value.trim();
    const isAdmin   = document.getElementById('emp-is-admin').checked;
    const password  = document.getElementById('emp-password')?.value;

    if (!firstName || !lastName || !username || !email) {
      window.showToast('Please fill required fields','error'); return;
    }

    if (!id) {
      // New employee: create auth user first
      if (!password || password.length < 6) {
        window.showToast('Password must be at least 6 characters','error'); return;
      }
      const { data: authData, error: authErr } = await window.sb.auth.admin
        ? await createAuthUser(email, password)
        : { data: null, error: { message: 'Use Supabase dashboard to create first admin' } };

      if (authErr) { window.showToast('Auth error: ' + authErr.message,'error'); return; }

      const { error } = await window.sb.from('employees').insert({
        auth_user_id: authData?.user?.id,
        first_name: firstName, last_name: lastName,
        username, contact_email: email,
        designation, pan, is_admin: isAdmin
      });
      if (error) { window.showToast('Error: ' + error.message,'error'); return; }
    } else {
      // Update existing
      const { error } = await window.sb.from('employees').update({
        first_name: firstName, last_name: lastName,
        username, contact_email: email,
        designation, pan, is_admin: isAdmin,
        updated_at: new Date().toISOString()
      }).eq('id', id);
      if (error) { window.showToast('Error: ' + error.message,'error'); return; }
    }

    window.showToast('Employee saved!','success');
    closeEmpModal();
    loadEmployees();
  };

  async function createAuthUser(email, password) {
    // Uses Supabase Admin API via service role — for browser-side, we use signUp
    // and then immediately confirm. In production, this should be done via Edge Function.
    return await window.sb.auth.signUp({ email, password, options: { emailRedirectTo: null } });
  }

  window.toggleEmpStatus = async function(id, currentStatus) {
    const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
    const { error } = await window.sb.from('employees').update({ status: newStatus }).eq('id',id);
    if (error) { window.showToast('Error: '+error.message,'error'); return; }
    window.showToast('Status updated','success');
    loadEmployees();
  };

  // ── Salary Structure ──────────────────────────────────────────
  window.editSalaryStructure = async function(empId, empName) {
    document.getElementById('sal-modal-title').textContent = 'Salary — ' + empName;
    document.getElementById('sal-form-empid').value = empId;

    const { data: structs } = await window.sb
      .from('salary_structures')
      .select('*')
      .eq('employee_id', empId)
      .order('effective_from', { ascending:false });

    document.getElementById('sal-history').innerHTML = (structs||[]).map(s => `
      <div class="sal-row">
        <strong>From ${window.fmtDate(s.effective_from)}</strong>
        <span>Basic: ${window.fmtCurrency(s.basic)}</span>
        <span>HRA: ${window.fmtCurrency(s.hra)}</span>
        <span>Special: ${window.fmtCurrency(s.special_allowance)}</span>
        <span>Transport: ${window.fmtCurrency(s.transport_allowance)}</span>
        <span>Medical: ${window.fmtCurrency(s.medical_allowance)}</span>
        <span>Conv/Other: ${window.fmtCurrency(s.conveyance_other)}</span>
      </div>`).join('') || '<p class="text-muted">No salary structure defined.</p>';

    // Pre-fill with latest
    const latest = structs?.[0];
    if (latest) {
      document.getElementById('sal-basic').value      = latest.basic;
      document.getElementById('sal-hra').value        = latest.hra;
      document.getElementById('sal-special').value    = latest.special_allowance;
      document.getElementById('sal-transport').value  = latest.transport_allowance;
      document.getElementById('sal-medical').value    = latest.medical_allowance;
      document.getElementById('sal-conv').value       = latest.conveyance_other;
    }
    document.getElementById('sal-effective').value = window.isoDate(new Date());
    document.getElementById('sal-modal').classList.remove('hidden');
  };

  window.closeSalModal = function() {
    document.getElementById('sal-modal').classList.add('hidden');
  };

  window.saveSalaryStructure = async function() {
    const empId = document.getElementById('sal-form-empid').value;
    const effective = document.getElementById('sal-effective').value;
    const payload = {
      employee_id: empId, effective_from: effective,
      basic:               parseFloat(document.getElementById('sal-basic').value||0),
      hra:                 parseFloat(document.getElementById('sal-hra').value||0),
      special_allowance:   parseFloat(document.getElementById('sal-special').value||0),
      transport_allowance: parseFloat(document.getElementById('sal-transport').value||0),
      medical_allowance:   parseFloat(document.getElementById('sal-medical').value||0),
      conveyance_other:    parseFloat(document.getElementById('sal-conv').value||0),
    };
    const { error } = await window.sb.from('salary_structures').upsert(payload, {onConflict:'employee_id,effective_from'});
    if (error) { window.showToast('Error: '+error.message,'error'); return; }
    window.showToast('Salary structure saved!','success');
    editSalaryStructure(empId, document.getElementById('sal-modal-title').textContent.replace('Salary — ',''));
  };
})();
