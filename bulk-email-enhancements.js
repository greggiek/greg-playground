// BM Prospect bulk email enhancements.
(() => {
  const q = (selector) => document.querySelector(selector);

  function daysSince(value) {
    if (!value) return Infinity;
    return Math.floor((Date.now() - new Date(value).getTime()) / 86400000);
  }

  function latestActivity(prospect) {
    const dates = [prospect.createdAt, ...(prospect.timeline || []).map((item) => item.at)].filter(Boolean);
    return dates.sort((a, b) => new Date(b) - new Date(a))[0] || null;
  }

  function activeUsers() {
    const members = (typeof teamSnapshot !== 'undefined' ? teamSnapshot : []).filter((member) => member.active !== false && member.name);
    const owners = (typeof state !== 'undefined' ? state.prospects : []).map((p) => p.owner).filter(Boolean);
    const me = typeof currentUserName === 'function' ? currentUserName() : '';
    return [...new Set([me, ...members.map((m) => m.name), ...owners].filter(Boolean))].sort();
  }

  function populateOwners() {
    const owner = q('#bulkEmailOwner');
    if (!owner) return;
    const selected = owner.value;
    owner.innerHTML = '<option value="">All owners</option>' + activeUsers().map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
    if ([...owner.options].some((option) => option.value === selected)) owner.value = selected;
  }

  function installStyles() {
    if (q('#bulkEmailEnhancementStyles')) return;
    document.head.insertAdjacentHTML('beforeend', `<style id="bulkEmailEnhancementStyles">
      .bulk-email-filter-grid{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px!important}
      #bulkRecipientSummary{display:flex!important;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 14px!important}
      #bulkRecipientSummary strong{font-size:15px}
      #bulkRecipientSummary small{display:inline-block;color:#60758c;font-size:12px;font-weight:500}
      #bulkRecipientSummary .audience-warning{color:#9a5a00;font-weight:700}
      #bulkEmailClearAudience{margin:8px 0 4px}
      #bulkRecipientPreview{margin:4px 0 14px!important;max-height:none!important;overflow:visible!important;white-space:normal!important}
      .recipient-preview-toggle{appearance:none;border:0;background:transparent;color:#1769d2;font-weight:700;padding:6px 0;cursor:pointer}
      #recipientPreviewRows{margin-top:6px;border:1px solid #d9e3ee;border-radius:10px;overflow:hidden;background:#fff;max-height:280px;overflow-y:auto}
      #recipientPreviewRows[hidden]{display:none!important}
      .recipient-preview-row{display:grid;grid-template-columns:1.25fr 1fr .75fr 1.5fr;gap:12px;padding:9px 12px;border-bottom:1px solid #edf1f5;font-size:12px;align-items:center}
      .recipient-preview-row:last-child{border-bottom:0}
      .recipient-preview-row span{color:#60758c;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      @media(max-width:800px){.bulk-email-filter-grid{grid-template-columns:1fr}.recipient-preview-row{grid-template-columns:1fr}.recipient-preview-row span{white-space:normal}}
    </style>`);
  }

  function installAudienceFilters() {
    const stage = q('#bulkEmailStage');
    const owner = q('#bulkEmailOwner');
    if (!stage || !owner) return;
    populateOwners();
    if (q('#bulkEmailProduct')) return;
    const grid = stage.closest('.bulk-email-filters');
    if (!grid) return;
    grid.classList.add('bulk-email-filter-grid');
    grid.insertAdjacentHTML('beforeend', `
      <label>Product Interest<select id="bulkEmailProduct"><option value="">All products</option><option>Doors</option><option>Entry Doors</option><option>Moulding</option><option>PVC</option><option>Kitchen</option></select></label>
      <label>Location<input id="bulkEmailLocation" type="search" placeholder="State, city, ZIP, address…" /></label>
      <label>Last Contact<select id="bulkEmailLastContact"><option value="">Any time</option><option value="never">Never contacted</option><option value="30">30+ days ago</option><option value="60">60+ days ago</option><option value="90">90+ days ago</option></select></label>
      <label>Email Engagement<select id="bulkEmailEngagement"><option value="">Any engagement</option><option value="never">Never emailed</option><option value="opened">Opened an email</option><option value="clicked">Clicked an email</option><option value="not-opened">Emailed but never opened</option></select></label>`);
    const summary = q('#bulkRecipientSummary');
    if (summary && !q('#bulkEmailClearAudience')) summary.insertAdjacentHTML('afterend', '<button id="bulkEmailClearAudience" class="btn btn-secondary btn-small" type="button">Clear audience filters</button>');
    ['#bulkEmailProduct','#bulkEmailLocation','#bulkEmailLastContact','#bulkEmailEngagement'].forEach((selector) => {
      const el = q(selector); if (el) el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', updateBulkEmailAudience);
    });
    q('#bulkEmailClearAudience')?.addEventListener('click', () => {
      ['#bulkEmailStage','#bulkEmailOwner','#bulkEmailProduct','#bulkEmailLocation','#bulkEmailLastContact','#bulkEmailEngagement'].forEach((selector) => { if (q(selector)) q(selector).value=''; });
      bulkEmailSelectedIds = [];
      updateBulkEmailAudience();
    });
  }

  const baseAudience = bulkEmailAudience;
  bulkEmailAudience = function () {
    const base = baseAudience();
    const product = q('#bulkEmailProduct')?.value || '';
    const location = (q('#bulkEmailLocation')?.value || '').trim().toLowerCase();
    const lastContact = q('#bulkEmailLastContact')?.value || '';
    const engagement = q('#bulkEmailEngagement')?.value || '';
    const messages = typeof homeEmailMessages !== 'undefined' ? homeEmailMessages : [];
    return base.filter((prospect) => {
      if (product && !(prospect.productInterests || []).includes(product)) return false;
      if (location && !String(prospect.address || '').toLowerCase().includes(location)) return false;
      const meaningful = (prospect.timeline || []).filter((item) => !/^created prospect\.?$/i.test(item.text || ''));
      if (lastContact === 'never' && meaningful.length) return false;
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

  updateBulkEmailAudience = function () {
    const audience = bulkEmailAudience();
    const summary = q('#bulkRecipientSummary');
    const preview = q('#bulkRecipientPreview');
    if (!summary || !preview) return;
    const filters = [q('#bulkEmailStage')?.value,q('#bulkEmailOwner')?.value,q('#bulkEmailProduct')?.value,q('#bulkEmailLocation')?.value].filter(Boolean);
    summary.innerHTML = `<strong>${audience.length} matching recipient${audience.length===1?'':'s'}</strong><small>${filters.length ? filters.map(escapeHtml).join(' · ') : 'All contacts with valid email addresses'}</small>${audience.length>25?'<small class="audience-warning">25 can be sent per tracked campaign during beta.</small>':''}`;
    preview.innerHTML = audience.length ? `<button id="toggleRecipientPreview" class="recipient-preview-toggle" type="button">View recipients (${audience.length}) ▾</button><div id="recipientPreviewRows" hidden>${audience.map((p)=>`<div class="recipient-preview-row"><strong>${escapeHtml(p.companyName)}</strong><span>${escapeHtml(p.contactName||'—')}</span><span>${escapeHtml(p.owner||'—')}</span><span>${escapeHtml(p.email)}</span></div>`).join('')}</div>` : '<span class="status-text">No matching contacts have a valid email address.</span>';
    q('#toggleRecipientPreview')?.addEventListener('click', (event) => { const rows=q('#recipientPreviewRows'); rows.hidden=!rows.hidden; event.currentTarget.textContent=`${rows.hidden?'View':'Hide'} recipients (${audience.length}) ${rows.hidden?'▾':'▴'}`; });
  };

  const baseOpenBulkEmail = openBulkEmail;
  openBulkEmail = async function () {
    installStyles(); installAudienceFilters(); populateOwners(); updateBulkEmailAudience();
    return baseOpenBulkEmail();
  };

  const baseRefresh = refreshCrm;
  refreshCrm = async function (...args) {
    const result = await baseRefresh(...args);
    populateOwners();
    return result;
  };

  installStyles();
  installAudienceFilters();
})();
