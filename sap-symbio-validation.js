  // ---------- SAP vs Symbio validation runner ----------

  const vEls = {
    status: document.getElementById('status-validate'),
    meta: document.getElementById('validate-meta'),
    badges: document.getElementById('badges-validate'),
    tableWrap: document.getElementById('table-wrap-validate'),
    table: document.getElementById('table-validate'),
    placeholder: document.getElementById('placeholder-validate'),
    tolerance: document.getElementById('price-tolerance'),
    runBtn: document.getElementById('run-validate'),
    resetBtn: document.getElementById('reset-validate'),
    xlsxBtn: document.getElementById('download-validate-xlsx'),
    badgesCharges: document.getElementById('badges-validate-charges'),
    tableWrapCharges: document.getElementById('table-wrap-validate-charges'),
    tableCharges: document.getElementById('table-validate-charges'),
    placeholderCharges: document.getElementById('placeholder-validate-charges'),
    search: document.getElementById('search-validate'),
    searchCharges: document.getElementById('search-validate-charges'),
  };
  let lastValidation = null; // { rows, chargeRows }
  let statusFilter = null; // null = show all; else 'Match' | 'Mismatch' | 'Missing'
  let chargeStatusFilter = null; // null = show all; else 'Match' | 'Mismatch'
  let searchQuery = '';
  let searchQueryCharges = '';

  function vSetStatus(kind, msg){
    vEls.status.className = 'status show ' + kind;
    vEls.status.querySelector('.msg').textContent = msg;
  }

  function statusClass(status){
    if (status === 'Match') return 'stat-match';
    if (status === 'Mismatch') return 'stat-mismatch';
    return 'stat-missing';
  }

  function matchesStatusFilter(row){
    if (!statusFilter) return true;
    if (statusFilter === 'Missing') return row.status === 'Missing in SAP' || row.status === 'Missing in Symbio';
    return row.status === statusFilter;
  }

  function matchesChargeStatusFilter(row){
    if (!chargeStatusFilter) return true;
    return row.status === chargeStatusFilter;
  }

  function rowMatchesSearch(row, query){
    if (!query) return true;
    const haystack = Object.values(row).join(' ').toLowerCase();
    return haystack.indexOf(query.toLowerCase()) !== -1;
  }

  function renderValidationMeta(sapSpec, symbioSpec){
    if (!vEls.meta) return;
    const sapStyle = sapSpec.product.code || 'n/a';
    const symStyle = symbioSpec.product.code || 'n/a';
    const sapPriceList = sapSpec.header.priceList || 'n/a';
    const symPriceList = symbioSpec.header.priceList || 'n/a';

    let text = 'Style: ' + sapStyle;
    if (normText(sapStyle) !== normText(symStyle)) text += ' (Symbio: ' + symStyle + ')';
    text += '  |  Price List: ' + sapPriceList;
    if (normText(sapPriceList) !== normText(symPriceList)) text += ' (Symbio: ' + symPriceList + ')';
    vEls.meta.textContent = text;
  }

  function renderValidationTable(allRows){
    const thead = vEls.table.querySelector('thead');
    const tbody = vEls.table.querySelector('tbody');
    thead.innerHTML = '<tr><th>Category</th><th>Code</th><th>Name</th><th>Status</th><th>Details</th></tr>';
    tbody.innerHTML = '';
    const rows = allRows.filter(matchesStatusFilter).filter(row => rowMatchesSearch(row, searchQuery));
    rows.forEach(row => {
      const tr = document.createElement('tr');
      const tdCategory = document.createElement('td'); tdCategory.textContent = row.category || '';
      const tdCode = document.createElement('td'); tdCode.textContent = row.code;
      const tdName = document.createElement('td'); tdName.textContent = row.name;
      const tdStatus = document.createElement('td');
      tdStatus.textContent = row.status;
      tdStatus.className = statusClass(row.status);
      const tdDetails = document.createElement('td');
      tdDetails.textContent = row.details;
      tdDetails.className = 'details-cell';
      tr.appendChild(tdCategory); tr.appendChild(tdCode); tr.appendChild(tdName); tr.appendChild(tdStatus); tr.appendChild(tdDetails);
      tbody.appendChild(tr);
    });
    vEls.tableWrap.classList.add('show');
  }

  function renderValidationBadges(allRows){
    const counts = { Match: 0, Mismatch: 0, 'Missing in SAP': 0, 'Missing in Symbio': 0 };
    allRows.forEach(r => { if (counts[r.status] !== undefined) counts[r.status]++; });
    vEls.badges.innerHTML = '';
    const make = (text, cls, filterValue) => {
      const b = document.createElement('span');
      b.className = 'badge ' + cls + ' clickable' + (statusFilter === filterValue ? ' active' : '');
      b.textContent = text;
      b.addEventListener('click', () => {
        statusFilter = (statusFilter === filterValue) ? null : filterValue;
        renderValidationBadges(allRows);
        renderValidationTable(allRows);
      });
      vEls.badges.appendChild(b);
    };
    make(allRows.length + ' compared', 'strong', null);
    make(counts.Match + ' match', 'good', 'Match');
    make(counts.Mismatch + ' mismatch', 'warn', 'Mismatch');
    make((counts['Missing in SAP'] + counts['Missing in Symbio']) + ' missing', 'bad', 'Missing');
  }

  function renderChargeTable(chargeRows){
    const thead = vEls.tableCharges.querySelector('thead');
    const tbody = vEls.tableCharges.querySelector('tbody');
    thead.innerHTML = '<tr><th>Charge Code</th><th>Description</th><th>SAP</th><th>Symbio</th><th>Status</th><th>Details</th></tr>';
    tbody.innerHTML = '';
    const rows = chargeRows.filter(matchesChargeStatusFilter).filter(row => rowMatchesSearch(row, searchQueryCharges));
    rows.forEach(row => {
      const tr = document.createElement('tr');
      const tdCode = document.createElement('td'); tdCode.textContent = row.chargeCode;
      const tdDesc = document.createElement('td'); tdDesc.textContent = row.description;
      const tdSap = document.createElement('td'); tdSap.textContent = row.sapValue;
      const tdSym = document.createElement('td'); tdSym.textContent = row.symbioValue;
      const tdStatus = document.createElement('td');
      tdStatus.textContent = row.status;
      tdStatus.className = statusClass(row.status);
      const tdDetails = document.createElement('td');
      tdDetails.textContent = row.details;
      tdDetails.className = 'details-cell';
      tr.appendChild(tdCode); tr.appendChild(tdDesc); tr.appendChild(tdSap); tr.appendChild(tdSym); tr.appendChild(tdStatus); tr.appendChild(tdDetails);
      tbody.appendChild(tr);
    });
    vEls.tableWrapCharges.classList.add('show');
    if (chargeRows.length) vEls.placeholderCharges.style.display = 'none';
  }

  function renderChargeBadges(chargeRows){
    const counts = { Match: 0, Mismatch: 0 };
    chargeRows.forEach(r => { if (counts[r.status] !== undefined) counts[r.status]++; });
    vEls.badgesCharges.innerHTML = '';
    const make = (text, cls, filterValue) => {
      const b = document.createElement('span');
      b.className = 'badge ' + cls + ' clickable' + (chargeStatusFilter === filterValue ? ' active' : '');
      b.textContent = text;
      b.addEventListener('click', () => {
        chargeStatusFilter = (chargeStatusFilter === filterValue) ? null : filterValue;
        renderChargeBadges(chargeRows);
        renderChargeTable(chargeRows);
      });
      vEls.badgesCharges.appendChild(b);
    };
    make(chargeRows.length + ' compared', 'strong', null);
    make(counts.Match + ' match', 'good', 'Match');
    make(counts.Mismatch + ' mismatch', 'warn', 'Mismatch');
  }

  function runValidation(){
    const sapState = controllers.sap.state;
    const symbioState = controllers.symbio.state;

    if (!sapState.spec || !symbioState.spec) {
      vSetStatus('error', 'Convert both SAP and Symbio XML first (structural parse not available yet).');
      return;
    }
    const sapStyleCode = normCode(sapState.spec.product.code);
    const symbioStyleCode = normCode(symbioState.spec.product.code);
    if (sapStyleCode && symbioStyleCode && sapStyleCode !== symbioStyleCode) {
      vSetStatus('error', 'Please ensure both XML are from the same style.');
      return;
    }
    const sapHasData = sapState.spec.plainFeatures.length || sapState.spec.finishGroups.length || sapState.spec.colorEntries.length;
    const symbioHasData = symbioState.spec.plainFeatures.length || symbioState.spec.finishGroups.length || symbioState.spec.colorEntries.length;
    if (!sapHasData && !symbioHasData) {
      vSetStatus('error', 'No <Feature> elements found in either XML — nothing to validate.');
      return;
    }

    const tolerance = parseFloat(vEls.tolerance.value);
    const priceTolerance = isNaN(tolerance) ? 0 : tolerance;

    const { rows, chargeRows } = diffSpecifications(sapState.spec, symbioState.spec, priceTolerance);

    lastValidation = { rows, chargeRows };
    statusFilter = null;
    chargeStatusFilter = null;
    searchQuery = '';
    searchQueryCharges = '';
    vEls.search.value = '';
    vEls.searchCharges.value = '';
    renderValidationMeta(sapState.spec, symbioState.spec);
    renderValidationBadges(rows);
    renderValidationTable(rows);
    vEls.placeholder.style.display = 'none';
    renderChargeBadges(chargeRows);
    renderChargeTable(chargeRows);
    if (!chargeRows.length) vEls.placeholderCharges.style.display = 'block';
    vSetStatus('ok', 'Validation complete — ' + rows.length + ' feature(s) and ' + chargeRows.length + ' charge/price item(s) compared.');
  }

  function downloadValidationXlsx(){
    if (!lastValidation || (!lastValidation.rows.length && !lastValidation.chargeRows.length)) {
      vSetStatus('error', 'Run validation first.');
      return;
    }
    if (typeof XLSX === 'undefined') {
      vSetStatus('error', 'XLSX library failed to load — check your internet connection.');
      return;
    }
    const wb = XLSX.utils.book_new();

    const mainHeader = ['Category', 'Code', 'Name', 'Status', 'Details'];
    const mainRows = lastValidation.rows.filter(matchesStatusFilter);
    const mainAoa = [mainHeader, ...mainRows.map(r => [r.category || '', r.code, r.name, r.status, r.details])];
    const wsMain = XLSX.utils.aoa_to_sheet(mainAoa);
    wsMain['!cols'] = [{ wch: 14 }, { wch: 22 }, { wch: 28 }, { wch: 18 }, { wch: 70 }];
    XLSX.utils.book_append_sheet(wb, wsMain, 'SAP vs Symbio');

    const chargeHeader = ['Charge Code', 'Description', 'SAP', 'Symbio', 'Status', 'Details'];
    const chargeRowsOut = lastValidation.chargeRows.filter(matchesChargeStatusFilter);
    const chargeAoa = [chargeHeader, ...chargeRowsOut.map(r => [r.chargeCode, r.description, r.sapValue, r.symbioValue, r.status, r.details])];
    const wsCharges = XLSX.utils.aoa_to_sheet(chargeAoa);
    wsCharges['!cols'] = [{ wch: 18 }, { wch: 24 }, { wch: 18 }, { wch: 18 }, { wch: 12 }, { wch: 70 }];
    XLSX.utils.book_append_sheet(wb, wsCharges, 'Upcharges');

    const stamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, 'sap_vs_symbio_validation_' + stamp + '.xlsx');
    vSetStatus('ok', 'Validation report downloaded.');
  }

  function resetValidation(){
    controllers.sap.doClear();
    controllers.symbio.doClear();

    lastValidation = null;
    statusFilter = null;
    chargeStatusFilter = null;
    searchQuery = '';
    searchQueryCharges = '';
    vEls.search.value = '';
    vEls.searchCharges.value = '';

    vEls.meta.textContent = '';
    vEls.badges.innerHTML = '';
    vEls.table.querySelector('thead').innerHTML = '';
    vEls.table.querySelector('tbody').innerHTML = '';
    vEls.tableWrap.classList.remove('show');
    vEls.placeholder.style.display = 'block';

    vEls.badgesCharges.innerHTML = '';
    vEls.tableCharges.querySelector('thead').innerHTML = '';
    vEls.tableCharges.querySelector('tbody').innerHTML = '';
    vEls.tableWrapCharges.classList.remove('show');
    vEls.placeholderCharges.style.display = 'block';

    vEls.status.className = 'status';
  }

  vEls.runBtn.addEventListener('click', runValidation);
  vEls.resetBtn.addEventListener('click', resetValidation);

  vEls.search.addEventListener('input', () => {
    searchQuery = vEls.search.value.trim();
    if (lastValidation) renderValidationTable(lastValidation.rows);
  });
  vEls.searchCharges.addEventListener('input', () => {
    searchQueryCharges = vEls.searchCharges.value.trim();
    if (lastValidation) renderChargeTable(lastValidation.chargeRows);
  });
  vEls.xlsxBtn.addEventListener('click', downloadValidationXlsx);

  // ---------- Validation tab switching ----------

  document.querySelectorAll('[data-tab-btn]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-tab-btn');
      document.querySelectorAll('[data-tab-btn]').forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll('[data-tab-panel]').forEach(p => p.classList.toggle('active', p.getAttribute('data-tab-panel') === tab));
    });
  });

  // ---------- Table zoom controls ----------

  const zoomLevels = { sap: 1, symbio: 1, validate: 1, 'validate-charges': 1 };
  const ZOOM_MIN = 0.6;
  const ZOOM_MAX = 2.0;
  const ZOOM_STEP = 0.1;

  function applyZoom(target){
    const table = document.getElementById('table-' + target);
    const levelEl = document.getElementById('zoom-level-' + target);
    if (!table) return;
    table.style.zoom = zoomLevels[target];
    if (levelEl) levelEl.textContent = Math.round(zoomLevels[target] * 100) + '%';
  }

  document.querySelectorAll('[data-zoom-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.getAttribute('data-zoom-action');
      const target = btn.getAttribute('data-zoom-target');
      if (!target || zoomLevels[target] === undefined) return;
      let level = zoomLevels[target] + (action === 'in' ? ZOOM_STEP : -ZOOM_STEP);
      level = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, level));
      zoomLevels[target] = Math.round(level * 100) / 100;
      applyZoom(target);
    });
  });

  // ---------- Display Columns collapse toggle ----------

  document.querySelectorAll('[data-cols-collapse]').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-cols-collapse');
      const box = document.getElementById('cols-' + target);
      if (!box) return;
      const collapsed = box.classList.toggle('collapsed');
      btn.textContent = collapsed ? '+' : '−';
    });
  });

  // ---------- Table collapse (hide/show) ----------

  document.querySelectorAll('[data-table-collapse]').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-table-collapse');
      const wrap = document.getElementById('table-wrap-' + target);
      if (!wrap) return;
      const nowHidden = wrap.style.display === 'none';
      wrap.style.display = nowHidden ? '' : 'none';
      btn.textContent = nowHidden ? 'Hide table' : 'Show table';
    });
  });
