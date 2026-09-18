// ---------- SAP vs Symbio validation runner ----------

  const vEls = {
    status: document.getElementById('status-validate'),
    meta: document.getElementById('validate-meta'),
    badges: document.getElementById('badges-validate'),
    tableWrap: document.getElementById('table-wrap-validate'),
    table: document.getElementById('table-validate'),
    placeholder: document.getElementById('placeholder-validate'),
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
  const validateColumnFilter = createColumnFilter();
  const chargesColumnFilter = createColumnFilter();

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
    const sapCatalog = sapSpec.product.catalog.code || 'n/a';
    const symCatalog = symbioSpec.product.catalog.code || 'n/a';

    let text = 'Style: ' + sapStyle;
    if (normText(sapStyle) !== normText(symStyle)) text += ' (Symbio: ' + symStyle + ')';
    text += '  |  Price List: ' + sapPriceList;
    if (normText(sapPriceList) !== normText(symPriceList)) text += ' (Symbio: ' + symPriceList + ')';
    text += '  |  Catalog: ' + sapCatalog;
    if (normText(sapCatalog) !== normText(symCatalog)) text += ' (Symbio: ' + symCatalog + ')';
    vEls.meta.textContent = text;
    vEls.meta.classList.add('show');
  }

  function renderValidationTable(allRows){
    const thead = vEls.table.querySelector('thead');
    const tbody = vEls.table.querySelector('tbody');
    thead.innerHTML = '';
    tbody.innerHTML = '';
    const trh = document.createElement('tr');
    trh.appendChild(buildFilterableHeaderCell('Category', 'category', () => allRows.map(r => r.category), validateColumnFilter, () => renderValidationTable(lastValidation.rows)));
    trh.appendChild(buildFilterableHeaderCell('Code', 'code', () => allRows.map(r => r.code), validateColumnFilter, () => renderValidationTable(lastValidation.rows)));
    const thName = document.createElement('th'); thName.textContent = 'Name'; trh.appendChild(thName);
    const thStatus = document.createElement('th'); thStatus.textContent = 'Status'; trh.appendChild(thStatus);
    trh.appendChild(buildFilterableHeaderCell('Details', 'details', () => allRows.map(r => r.details), validateColumnFilter, () => renderValidationTable(lastValidation.rows)));
    thead.appendChild(trh);

    const rows = allRows
      .filter(matchesStatusFilter)
      .filter(row => rowMatchesSearch(row, searchQuery))
      .filter(row => validateColumnFilter.matches(row, (r, c) => filterCellValue(r[c]), ['category', 'code', 'details']));
    rows.forEach(row => {
      const tr = document.createElement('tr');
      const tdCategory = document.createElement('td'); renderHighlighted(tdCategory, row.category || '', searchQuery);
      const tdCode = document.createElement('td'); renderHighlighted(tdCode, row.code, searchQuery);
      const tdName = document.createElement('td'); renderHighlighted(tdName, row.name, searchQuery);
      const tdStatus = document.createElement('td');
      tdStatus.textContent = row.status;
      tdStatus.className = statusClass(row.status);
      const tdDetails = document.createElement('td');
      renderHighlighted(tdDetails, row.details, searchQuery);
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
    thead.innerHTML = '';
    tbody.innerHTML = '';
    const trh = document.createElement('tr');
    trh.appendChild(buildFilterableHeaderCell('Category', 'category', () => chargeRows.map(r => r.category), chargesColumnFilter, () => renderChargeTable(lastValidation.chargeRows)));
    trh.appendChild(buildFilterableHeaderCell('Charge Code', 'chargeCode', () => chargeRows.map(r => r.chargeCode), chargesColumnFilter, () => renderChargeTable(lastValidation.chargeRows)));
    trh.appendChild(buildFilterableHeaderCell('Description', 'description', () => chargeRows.map(r => r.description), chargesColumnFilter, () => renderChargeTable(lastValidation.chargeRows)));
    const thSap = document.createElement('th'); thSap.textContent = 'SAP'; trh.appendChild(thSap);
    const thSym = document.createElement('th'); thSym.textContent = 'Symbio'; trh.appendChild(thSym);
    const thStatus = document.createElement('th'); thStatus.textContent = 'Status'; trh.appendChild(thStatus);
    trh.appendChild(buildFilterableHeaderCell('Details', 'details', () => chargeRows.map(r => r.details), chargesColumnFilter, () => renderChargeTable(lastValidation.chargeRows)));
    thead.appendChild(trh);

    const rows = chargeRows
      .filter(matchesChargeStatusFilter)
      .filter(row => rowMatchesSearch(row, searchQueryCharges))
      .filter(row => chargesColumnFilter.matches(row, (r, c) => filterCellValue(r[c]), ['category', 'chargeCode', 'description', 'details']));
    rows.forEach(row => {
      const tr = document.createElement('tr');
      const tdCategory = document.createElement('td'); renderHighlighted(tdCategory, row.category || '', searchQueryCharges);
      const tdCode = document.createElement('td'); renderHighlighted(tdCode, row.chargeCode, searchQueryCharges);
      const tdDesc = document.createElement('td'); renderHighlighted(tdDesc, row.description, searchQueryCharges);
      const tdSap = document.createElement('td'); renderHighlighted(tdSap, row.sapValue, searchQueryCharges);
      const tdSym = document.createElement('td'); renderHighlighted(tdSym, row.symbioValue, searchQueryCharges);
      const tdStatus = document.createElement('td');
      tdStatus.textContent = row.status;
      tdStatus.className = statusClass(row.status);
      const tdDetails = document.createElement('td');
      renderHighlighted(tdDetails, row.details, searchQueryCharges);
      tdDetails.className = 'details-cell';
      tr.appendChild(tdCategory); tr.appendChild(tdCode); tr.appendChild(tdDesc); tr.appendChild(tdSap); tr.appendChild(tdSym); tr.appendChild(tdStatus); tr.appendChild(tdDetails);
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

    const { rows, chargeRows } = diffSpecifications(sapState.spec, symbioState.spec);

    lastValidation = { rows, chargeRows };
    statusFilter = null;
    chargeStatusFilter = null;
    searchQuery = '';
    searchQueryCharges = '';
    validateColumnFilter.clearAll();
    chargesColumnFilter.clearAll();
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
    const mainRows = lastValidation.rows
      .filter(matchesStatusFilter)
      .filter(row => rowMatchesSearch(row, searchQuery))
      .filter(row => validateColumnFilter.matches(row, (r, c) => filterCellValue(r[c]), ['category', 'code', 'details']));
    const mainAoa = [mainHeader, ...mainRows.map(r => [r.category || '', r.code, r.name, r.status, r.details])];
    const wsMain = XLSX.utils.aoa_to_sheet(mainAoa);
    wsMain['!cols'] = [{ wch: 14 }, { wch: 22 }, { wch: 28 }, { wch: 18 }, { wch: 70 }];
    XLSX.utils.book_append_sheet(wb, wsMain, 'SAP vs Symbio');

    const chargeHeader = ['Category', 'Charge Code', 'Description', 'SAP', 'Symbio', 'Status', 'Details'];
    const chargeRowsOut = lastValidation.chargeRows
      .filter(matchesChargeStatusFilter)
      .filter(row => rowMatchesSearch(row, searchQueryCharges))
      .filter(row => chargesColumnFilter.matches(row, (r, c) => filterCellValue(r[c]), ['category', 'chargeCode', 'description', 'details']));
    const chargeAoa = [chargeHeader, ...chargeRowsOut.map(r => [r.category || '', r.chargeCode, r.description, r.sapValue, r.symbioValue, r.status, r.details])];
    const wsCharges = XLSX.utils.aoa_to_sheet(chargeAoa);
    wsCharges['!cols'] = [{ wch: 18 }, { wch: 18 }, { wch: 24 }, { wch: 18 }, { wch: 18 }, { wch: 12 }, { wch: 70 }];
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
    validateColumnFilter.clearAll();
    chargesColumnFilter.clearAll();
    vEls.search.value = '';
    vEls.searchCharges.value = '';

    vEls.meta.textContent = '';
    vEls.meta.classList.remove('show');
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
      document.querySelectorAll('[data-badge-panel]').forEach(b => { b.style.display = (b.getAttribute('data-badge-panel') === tab) ? '' : 'none'; });
      document.querySelectorAll('[data-controls-panel]').forEach(c => { c.style.display = (c.getAttribute('data-controls-panel') === tab) ? '' : 'none'; });
    });
  });
