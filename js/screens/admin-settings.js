// PMPL HRMS — Admin Settings Screen
(function() {
  const screen = document.getElementById('screen-admin-settings');
  if (!screen) return;
  screen.addEventListener('screen:show', loadSettings);

  async function loadSettings() {
    // Company Settings
    const { data: cs } = await window.sb.from('company_settings').select('*').limit(1);
    const s = cs?.[0] || {};
    document.getElementById('set-company-name').value    = s.company_name||'';
    document.getElementById('set-address').value          = s.address||'';
    document.getElementById('set-cin').value              = s.cin||'';
    document.getElementById('set-gst').value              = s.gst_number||'';
    document.getElementById('set-pt-monthly').value       = s.pt_monthly||200;
    document.getElementById('set-pt-february').value      = s.pt_february||300;
    document.getElementById('set-payment-day').value      = s.salary_payment_day||10;
    window._settingsId = s.id;

    // Allowance Rules
    const { data: rules } = await window.sb.from('allowance_rules').select('*').order('rule_key');
    document.getElementById('allowance-rules-list').innerHTML = (rules||[]).map(r => `
      <div class="rule-row">
        <span class="rule-desc">${r.description}</span>
        <input type="number" class="rule-rate" step="0.5" value="${r.rate_percent}"
          onchange="updateRule('${r.id}', this.value)">
        <span>%</span>
        <label class="toggle">
          <input type="checkbox" ${r.is_active?'checked':''} onchange="toggleRule('${r.id}', this.checked)">
          <span>Active</span>
        </label>
      </div>`).join('');

    // Company Holidays
    loadHolidays();

    // Client Companies
    loadClients();
  }

  window.saveCompanySettings = async function() {
    const payload = {
      company_name:       document.getElementById('set-company-name').value.trim(),
      address:            document.getElementById('set-address').value.trim(),
      cin:                document.getElementById('set-cin').value.trim(),
      gst_number:         document.getElementById('set-gst').value.trim(),
      pt_monthly:         parseFloat(document.getElementById('set-pt-monthly').value||200),
      pt_february:        parseFloat(document.getElementById('set-pt-february').value||300),
      salary_payment_day: parseInt(document.getElementById('set-payment-day').value||10),
      updated_at:         new Date().toISOString()
    };
    const { error } = await window.sb.from('company_settings').update(payload).eq('id', window._settingsId);
    if (error) { window.showToast('Error: '+error.message,'error'); return; }
    window.showToast('Settings saved!','success');
  };

  window.updateRule = async function(id, rate) {
    await window.sb.from('allowance_rules').update({ rate_percent: parseFloat(rate) }).eq('id',id);
    window.showToast('Rule updated','success');
  };

  window.toggleRule = async function(id, active) {
    await window.sb.from('allowance_rules').update({ is_active: active }).eq('id',id);
  };

  async function loadHolidays() {
    const { data: hols } = await window.sb
      .from('company_holidays').select('*').order('holiday_date');
    document.getElementById('holidays-list').innerHTML = (hols||[]).map(h => `
      <div class="holiday-row">
        <span>${window.fmtDate(h.holiday_date)}</span>
        <span>${h.name}</span>
        <button class="btn btn-sm btn-danger" onclick="deleteHoliday('${h.id}')">×</button>
      </div>`).join('') || '<p class="text-muted">No holidays added.</p>';
  }

  window.addHoliday = async function() {
    const date = document.getElementById('new-holiday-date').value;
    const name = document.getElementById('new-holiday-name').value.trim();
    if (!date || !name) { window.showToast('Enter date and name','error'); return; }
    const { error } = await window.sb.from('company_holidays').insert({ holiday_date:date, name });
    if (error) { window.showToast('Error: '+error.message,'error'); return; }
    window.showToast('Holiday added!','success');
    document.getElementById('new-holiday-date').value = '';
    document.getElementById('new-holiday-name').value = '';
    loadHolidays();
  };

  window.deleteHoliday = async function(id) {
    if (!confirm('Remove this holiday?')) return;
    await window.sb.from('company_holidays').delete().eq('id',id);
    window.showToast('Holiday removed','info');
    loadHolidays();
  };

  async function loadClients() {
    const { data: clients } = await window.sb.from('client_companies').select('*').order('name');
    document.getElementById('clients-list').innerHTML = (clients||[]).map(c => `
      <div class="client-row">
        <span>${c.name}</span>
        <span class="badge badge-${c.is_active?'active':'inactive'}">${c.is_active?'Active':'Inactive'}</span>
        <button class="btn btn-sm btn-outline" onclick="toggleClient('${c.id}',${c.is_active})">
          ${c.is_active?'Deactivate':'Activate'}
        </button>
      </div>`).join('') || '<p class="text-muted">No clients added.</p>';
  }

  window.addClient = async function() {
    const name = document.getElementById('new-client-name').value.trim();
    if (!name) { window.showToast('Enter client name','error'); return; }
    const { error } = await window.sb.from('client_companies').insert({ name });
    if (error) { window.showToast('Error: '+error.message,'error'); return; }
    window.showToast('Client added!','success');
    document.getElementById('new-client-name').value = '';
    loadClients();
  };

  window.toggleClient = async function(id, current) {
    await window.sb.from('client_companies').update({ is_active: !current }).eq('id',id);
    loadClients();
  };
})();
