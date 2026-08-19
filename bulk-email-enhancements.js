// BM Prospect bulk email enhancements.
// Loaded after app.js. Keeps the core CRM lean while adding practical campaign targeting.
(() => {
  const $ = (selector) => document.querySelector(selector);

  function daysSince(value) {
    if (!value) return Infinity;
    return Math.floor((Date.now() - new Date(value).getTime()) / 86400000);
  }

  function latestActivity(prospect) {
    const dates = [prospect.createdAt, ...(prospect.timeline || []).map((item) => item.at)].filter(Boolean);
    return dates.sort((a, b) => new Date(b) - new Date(a))[0] || null;
  }

  function activeUsers() {
    const members = (window.teamSnapshot || teamSnapshot || []).filter((member) => member.active !== false);
    const legacyOwners = (window.state || state || { prospects: [] }).prospects.map((p) => p.owner).filter(Boolean);
    return [...new Set([...members.map((member) => member.name), ...legacyOwners])].sort();
  }

  function installAudienceFilters() {
    const stage = $('#bulkEmailStage');
    const owner = $('#bulkEmailOwner');
    if (!stage || !owner || $('#bulkEmailProduct')) return;

    owner.innerHTML = '<option value="">All owners</option>' + activeUsers().map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');

    const grid = stage.closest('.bulk-email-filters');
    grid.classList.add('bulk-email-filter-grid');
    grid.insertAdjacentHTML('beforeend', `
      <label>Product Interest
        <select id="bulkEmailProduct">
          <option value="">All products</option>
          <option>Doors</option><option>Entry Doors</option><option>Moulding</option><option>PVC</option><option>Kitchen</option>
        </select>
      </label>
      <label>Location
        <input id="bulkEmailLocation" type="search" placeholder="State, city, ZIP, address…" />
      </label>
      <label>Last Contact
        <select id="bulkEmailLastContact">
          <option value="">Any time</option>
          <option value="never">Never contacted</option>
          <option value="30">30+ days ago</option>
          <option value="60">60+ days ago</option>
          <option value="90">90+ days ago</option>
        </select>
      </label>
      <label>Email Engagement
        <select id="bulkEmailEngagement">
          <option value="">Any engagement</option>
          <option value="never">Never emailed</option>
          <option value="opened">Opened an email</option>
          <option value="clicked">Clicked an email</option>
          <option value="not-opened">Emailed but never opened</option>
        </select>
      </label>
    `);

    const summary = $('#bulkRecipientSummary');
    summary.insertAdjacentHTML('afterend', '<button id="bulkEmailClearAudience" class="btn btn-secondary btn-small" type="button">Clear audience filters</button>');

    ['#bulkEmailProduct', '#bulkEmailLocation', '#bulkEmailLastContact', '#bulkEmailEngagement'].forEach((selector) => {
      const el = $(selector);
      el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', () => updateBulkEmailAudience());
    });
    $('#bulkEmailClearAudience').addEventListener('click', () => {
      ['#bulkEmailStage','#bulkEmailOwner','#bulkEmailProduct','#bulkEmailLocation','#bulkEmailLastContact','#bulkEmailEngagement'].forEach((selector) => { if ($(selector)) $(selector).value = ''; });
      if (typeof bulkEmailSelectedIds !== 'undefined') bulkEmailSelectedIds = [];
      updateBulkEmailAudience();
    });
  }

  const originalBulkEmailAudience = window.bulkEmailAudience || bulkEmailAudience;
  window.bulkEmailAudience = bulkEmailAudience = function enhancedBulkEmailAudience() {
    const base = originalBulkEmailAudience();
    const product = $('#bulkEmailProduct')?.value || '';
    const location = ($('#bulkEmailLocation')?.value || '').trim().toLowerCase();
    const lastContact = $('#bulkEmailLastContact')?.value || '';
    const engagement = $('#bulkEmailEngagement')?.value || '';
    const messages = typeof homeEmailMessages !== 'undefined' ? homeEmailMessages : [];

    return base.filter((prospect) => {
      if (product && !(prospect.productInterests || []).includes(product)) return false;
      if (location && !String(prospect.address || '').toLowerCase().includes(location)) return false;
      const timeline = prospect.timeline || [];
      const meaningfulActivity = timeline.filter((item) => !/^created prospect\.?$/i.test(item.text || ''));
      if (lastContact === 'never' && meaningfulActivity.length) return false;
      if (/^\d+$/.test(lastContact) && daysSince(latestActivity(prospect)) < Number(lastContact)) return false;

      if (engagement) {
        const email = String(prospect.email || '').toLowerCase();
        const sent = messages.filter((m) => String(m.recipient_email || '').toLowerCase() === email);
        const opened = sent.some((m) => m.first_opened_at);
        const clicked = sent.some((m) => m.first_clicked_at);
        if (engagement === 'never' && sent.length) return false;
        if (engagement === 'opened' && !opened) return false;
        if (engagement === 'clicked' && !clicked) return false;
        if (engagement === 'not-opened' && (!sent.length || opened)) return false;
      }
      return true;
    });
  };

  const originalUpdateAudience = window.updateBulkEmailAudience || updateBulkEmailAudience;
  window.updateBulkEmailAudience = updateBulkEmailAudience = function enhancedUpdateBulkEmailAudience() {
    const audience = bulkEmailAudience();
    const summary = $('#bulkRecipientSummary');
    const preview = $('#bulkRecipientPreview');
    if (!summary || !preview) return originalUpdateAudience();
    const filters = [
      $('#bulkEmailStage')?.value,
      $('#bulkEmailOwner')?.value,
      $('#bulkEmailProduct')?.value,
      $('#bulkEmailLocation')?.value,
      $('#bulkEmailLastContact')?.selectedOptions?.[0]?.textContent !== 'Any time' ? $('#bulkEmailLastContact')?.selectedOptions?.[0]?.textContent : '',
      $('#bulkEmailEngagement')?.selectedOptions?.[0]?.textContent !== 'Any engagement' ? $('#bulkEmailEngagement')?.selectedOptions?.[0]?.textContent : ''
    ].filter(Boolean);
    summary.innerHTML = `<strong>${audience.length} matching recipient${audience.length === 1 ? '' : 's'}</strong>${filters.length ? `<small>${filters.map(escapeHtml).join(' · ')}</small>` : '<small>All contacts with valid email addresses</small>'}${audience.length > 25 ? '<small class="audience-warning">25 can be sent per tracked campaign during beta.</small>' : ''}`;
    preview.innerHTML = audience.length ? `<button id="toggleRecipientPreview" class="recipient-preview-toggle" type="button">View recipients (${audience.length})</button><div id="recipientPreviewRows" hidden>${audience.map((p) => `<div class="recipient-preview-row"><strong>${escapeHtml(p.companyName)}</strong><span>${escapeHtml(p.contactName || '')}</span><span>${escapeHtml(p.owner || '')}</span><span>${escapeHtml(p.email)}</span></div>`).join('')}</div>` : 'No matching contacts have a valid email address.';
    $('#toggleRecipientPreview')?.addEventListener('click', () => {
      const rows = $('#recipientPreviewRows');
      rows.hidden = !rows.hidden;
    });
  };

  function refreshAssignmentDropdowns() {
    const options = activeUsers().map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
    const selectors = [
      '#prospectForm select[name="owner"]', '#editForm select[name="owner"]', '#taskForm select[name="assignedTo"]',
      '#importForm select[name="owner"]', '#bulkTaskForm select[name="assignedTo"]', '#bulkReassignForm select[name="owner"]'
    ];
    selectors.forEach((selector) => {
      const select = $(selector);
      if (!select) return;
      const selected = select.value || (typeof currentUserName === 'function' ? currentUserName() : '');
      select.innerHTML = options;
      if ([...select.options].some((option) => option.value === selected)) select.value = selected;
    });
    const owner = $('#bulkEmailOwner');
    if (owner) {
      const selected = owner.value;
      owner.innerHTML = '<option value="">All owners</option>' + options;
      if ([...owner.options].some((option) => option.value === selected)) owner.value = selected;
    }
  }

  const originalRenderTeam = window.renderTeamSnapshot || renderTeamSnapshot;
  window.renderTeamSnapshot = renderTeamSnapshot = function enhancedRenderTeamSnapshot() {
    originalRenderTeam();
    refreshAssignmentDropdowns();
  };

  document.addEventListener('DOMContentLoaded', () => {
    installAudienceFilters();
    refreshAssignmentDropdowns();
  });
})();
