// Pasteable spreadsheet-style import table for BM Prospect.
(() => {
  const q = (s) => document.querySelector(s);
  const columns = [
    ['companyName','Company'],['contactName','Contact'],['email','Email'],['phone','Phone'],['address','Address'],
    ['stage','Stage'],['estimatedValue','Est. Value'],['owner','Owner'],['productInterests','Product Interest']
  ];
  let rows = [];

  function blankRow(){ return Object.fromEntries(columns.map(([key])=>[key,''])); }
  function activeOwners(){
    const members=(typeof teamSnapshot!=='undefined'?teamSnapshot:[]).filter(m=>m.active!==false&&m.name).map(m=>m.name);
    return [...new Set([currentUserName(),...members,...state.prospects.map(p=>p.owner).filter(Boolean)])];
  }
  function esc(v=''){ return escapeHtml(String(v)); }
  function ensureRows(count=8){ while(rows.length<count) rows.push(blankRow()); }
  function render(){
    ensureRows();
    const body=q('#liveImportBody'); if(!body)return;
    body.innerHTML=rows.map((row,i)=>`<tr data-row="${i}">${columns.map(([key,label])=>`<td><input data-cell="${key}" value="${esc(row[key])}" aria-label="${label} row ${i+1}" /></td>`).join('')}<td><button type="button" class="icon-btn live-import-delete" data-delete-row="${i}" aria-label="Delete row">×</button></td></tr>`).join('');
    body.querySelectorAll('[data-cell]').forEach(input=>input.addEventListener('input',()=>{ rows[Number(input.closest('tr').dataset.row)][input.dataset.cell]=input.value; updateCount(); }));
    body.querySelectorAll('[data-delete-row]').forEach(btn=>btn.addEventListener('click',()=>{ rows.splice(Number(btn.dataset.deleteRow),1); render(); }));
    updateCount();
  }
  function updateCount(){
    const valid=rows.filter(r=>Object.values(r).some(v=>String(v).trim()));
    q('#liveImportCount').textContent=`${valid.length} row${valid.length===1?'':'s'} ready`;
  }
  function parsePaste(text){
    const lines=text.replace(/\r/g,'').split('\n').filter(line=>line.trim());
    return lines.map(line=>line.split('\t'));
  }
  function handlePaste(event){
    const matrix=parsePaste(event.clipboardData.getData('text/plain'));
    if(!matrix.length||matrix[0].length<2)return;
    event.preventDefault();
    const startRow=Number(event.target.closest('tr')?.dataset.row||0);
    const startCol=columns.findIndex(([key])=>key===event.target.dataset.cell);
    matrix.forEach((values,r)=>{
      while(rows.length<=startRow+r) rows.push(blankRow());
      values.forEach((value,c)=>{ const col=columns[startCol+c]; if(col) rows[startRow+r][col[0]]=value.trim(); });
    });
    render();
  }
  async function importRows(){
    const data=rows.filter(r=>Object.values(r).some(v=>String(v).trim()));
    if(!data.length)return alert('Paste or enter at least one contact first.');
    const button=q('#runLiveImportBtn'); button.disabled=true; button.textContent='Importing…';
    try{
      let imported=0, skippedDuplicates=0, skippedBlank=0;
      for(const row of data){
        if(!row.companyName && !row.contactName && !row.email && !row.phone){ skippedBlank++; continue; }
        const existing=state.prospects.some(p=>(row.email&&p.email?.toLowerCase()===row.email.toLowerCase())||(row.phone&&p.phone===row.phone&&p.companyName?.toLowerCase()===row.companyName.toLowerCase()));
        if(existing){ skippedDuplicates++; continue; }
        const interests=String(row.productInterests||'').split(/[,;/]/).map(x=>x.trim()).filter(Boolean);
        await crmAction('createProspect',{
          id:uid('prospect'), companyName:row.companyName||row.contactName||row.email||row.phone, contactName:row.contactName,
          email:row.email, phone:row.phone, address:row.address, stage:row.stage||q('#liveImportRecordType').value==='customer'?'Won':'New Lead',
          estimatedValue:Number(String(row.estimatedValue||'').replace(/[$,]/g,''))||0, owner:row.owner||q('#liveImportOwner').value||currentUserName(),
          productInterests:interests, createdAt:nowIso(), createdBy:currentUserName(), notes:'Imported from live table.'
        }); imported++;
      }
      await refreshCrm();
      q('#importStatus').className='import-status visible'; q('#importStatus').textContent=`Imported ${imported} records. Skipped ${skippedDuplicates} duplicates and ${skippedBlank} blank rows.`;
      rows=[]; render();
    }catch(error){ q('#importStatus').className='import-status visible error'; q('#importStatus').textContent=error.message; }
    finally{ button.disabled=false; button.textContent='Import Table'; }
  }
  function install(){
    const form=q('#importForm'); if(!form||q('#liveImportTable'))return;
    form.querySelector('p.status-text').textContent='Paste directly from Excel or Google Sheets, or type into the table. Each column maps directly to the contact record.';
    const fileLabel=form.querySelector('label:has(input[name="file"])'); if(fileLabel) fileLabel.hidden=true;
    const originalGrid=fileLabel?.nextElementSibling; if(originalGrid) originalGrid.hidden=true;
    const oldHelp=[...form.querySelectorAll('p.status-text')].find(p=>p.textContent.includes('Duplicates are skipped')); if(oldHelp) oldHelp.hidden=true;
    q('#runImportBtn').hidden=true;
    form.insertAdjacentHTML('beforeend',`<div class="live-import-toolbar"><label>Import As<select id="liveImportRecordType"><option value="prospect">Prospects</option><option value="customer">Customers</option></select></label><label>Default Owner<select id="liveImportOwner"></select></label><span id="liveImportCount" class="badge">0 rows ready</span></div><div class="live-import-wrap"><table id="liveImportTable"><thead><tr>${columns.map(([,label])=>`<th>${label}</th>`).join('')}<th></th></tr></thead><tbody id="liveImportBody"></tbody></table></div><div class="button-row live-import-actions"><button id="addLiveImportRow" class="btn btn-secondary" type="button">+ Add Row</button><button id="runLiveImportBtn" class="btn btn-primary" type="button">Import Table</button></div>`);
    q('#liveImportOwner').innerHTML=activeOwners().map(name=>`<option>${esc(name)}</option>`).join('');
    q('#liveImportBody').addEventListener('paste',handlePaste);
    q('#addLiveImportRow').addEventListener('click',()=>{rows.push(blankRow());render();});
    q('#runLiveImportBtn').addEventListener('click',importRows);
    if(!q('#liveImportStyles')) document.head.insertAdjacentHTML('beforeend',`<style id="liveImportStyles">#importDialog{width:min(96vw,1500px);max-width:1500px}.live-import-toolbar{display:grid;grid-template-columns:220px 260px 1fr;gap:12px;align-items:end;margin:14px 0}.live-import-toolbar .badge{justify-self:end}.live-import-wrap{overflow:auto;border:1px solid #d9e3ee;border-radius:10px;max-height:55vh}.live-import-wrap table{border-collapse:collapse;width:100%;min-width:1250px}.live-import-wrap th{position:sticky;top:0;background:#f4f7fa;z-index:2;text-align:left;padding:9px;border-bottom:1px solid #d9e3ee;font-size:12px}.live-import-wrap td{padding:0;border-right:1px solid #edf1f5;border-bottom:1px solid #edf1f5}.live-import-wrap td input{border:0!important;border-radius:0!important;padding:9px!important;min-width:120px;background:transparent!important}.live-import-wrap td input:focus{outline:2px solid #2f80ed;outline-offset:-2px}.live-import-delete{margin:3px}.live-import-actions{margin-top:12px}@media(max-width:700px){.live-import-toolbar{grid-template-columns:1fr}.live-import-toolbar .badge{justify-self:start}}</style>`);
    rows=[]; render();
    // Prevent the old file-upload submit path when using the table.
    form.addEventListener('submit',e=>{ if(!form.elements.file.files.length){e.preventDefault();e.stopImmediatePropagation();} },true);
  }
  const originalClick=q('#importProspectsBtn')?.onclick;
  q('#importProspectsBtn')?.addEventListener('click',()=>setTimeout(install,0));
  install();
})();
