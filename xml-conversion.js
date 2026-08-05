  // ---------- Generic XML -> rows/columns engine ----------

  function flattenElement(el, prefix){
    prefix = prefix || '';
    const obj = {};
    for (const attr of Array.from(el.attributes || [])) {
      obj[prefix + '@' + attr.name] = attr.value;
    }
    const childGroups = new Map();
    for (const child of Array.from(el.children)) {
      if (!childGroups.has(child.tagName)) childGroups.set(child.tagName, []);
      childGroups.get(child.tagName).push(child);
    }
    for (const [tag, els] of childGroups) {
      if (els.length === 1) {
        const c = els[0];
        if (c.children.length === 0) {
          obj[prefix + tag] = c.textContent.trim();
          for (const attr of Array.from(c.attributes || [])) {
            obj[prefix + tag + '@' + attr.name] = attr.value;
          }
        } else {
          Object.assign(obj, flattenElement(c, prefix + tag + '.'));
        }
      } else {
        obj[prefix + tag] = els.map(c => c.textContent.trim()).filter(Boolean).join(' | ');
      }
    }
    if (el.children.length === 0 && Object.keys(obj).length === 0) {
      obj[prefix.replace(/\.$/, '') || el.tagName] = el.textContent.trim();
    }
    return obj;
  }

  function isRichElement(el){
    // "rich" = has attributes or child elements, i.e. more than a single scalar text value.
    return el.attributes.length > 0 || el.children.length > 0;
  }

  function findRepeatingElements(root){
    // Group by tag name across the WHOLE document, regardless of which parent
    // they sit under — real-world exports often repeat the same record tag
    // (e.g. <FeatureValue>) under many different sibling branches, not just
    // one shared parent.
    const byTag = new Map();
    const stack = [root];
    while (stack.length) {
      const el = stack.pop();
      for (const child of Array.from(el.children)) {
        if (!byTag.has(child.tagName)) byTag.set(child.tagName, []);
        byTag.get(child.tagName).push(child);
        stack.push(child);
      }
    }

    let best = null;
    for (const [, arr] of byTag) {
      if (arr.length <= 1) continue;
      if (!arr.some(isRichElement)) continue; // skip plain repeated scalar tags
      if (!best || arr.length > best.length) best = arr;
    }
    if (best) return best;

    // fallback: immediate children of root
    if (root.children.length > 0) return Array.from(root.children);
    return [root];
  }

  function getAncestorContext(rowEl, root){
    // Walk up from the row element and pull in any Code/Name identifiers from
    // enclosing sections (skipping plain "*List" wrapper tags) so each row can
    // be traced back to the Feature/section it came from.
    const ctx = {};
    let node = rowEl.parentElement;
    while (node && node !== root.parentElement) {
      if (node.tagName && !/List$/i.test(node.tagName)) {
        for (const key of ['Code', 'Name']) {
          const child = Array.from(node.children).find(c => c.tagName === key && c.children.length === 0);
          if (child) {
            const colName = node.tagName + '.' + key;
            if (!(colName in ctx)) ctx[colName] = child.textContent.trim();
          }
        }
      }
      node = node.parentElement;
    }
    return ctx;
  }

  function sanitizeXml(xmlString){
    // Fix stray "&" not already part of a valid entity (&amp; &lt; &gt; &quot; &apos; &#123; &#x1F;)
    // This is a common issue in raw exports (e.g. "PARTS & EQUIPMENT") that would
    // otherwise make an otherwise-fine document fail strict XML parsing.
    let fixed = xmlString.replace(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/g, '&amp;');
    return fixed;
  }

  function parseXmlDocument(xmlString){
    const parser = new DOMParser();
    let doc = parser.parseFromString(xmlString, 'application/xml');
    let errNode = doc.querySelector('parsererror');
    let wasSanitized = false;

    if (errNode) {
      // Retry once against a sanitized version before giving up.
      const sanitized = sanitizeXml(xmlString);
      if (sanitized !== xmlString) {
        doc = parser.parseFromString(sanitized, 'application/xml');
        errNode = doc.querySelector('parsererror');
        wasSanitized = true;
      }
    }
    if (errNode) {
      throw new Error('Could not parse XML. Check the syntax and try again.');
    }
    const root = doc.documentElement;
    if (!root) throw new Error('No XML content found.');
    return { doc, root, wasSanitized };
  }

  function xmlToRows(xmlString){
    const { root, wasSanitized } = parseXmlDocument(xmlString);

    const recordEls = findRepeatingElements(root);
    const rows = recordEls.map(el => Object.assign(getAncestorContext(el, root), flattenElement(el)));

    const columns = [];
    const seen = new Set();
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        if (!seen.has(key)) { seen.add(key); columns.push(key); }
      }
    }
    return { rows, columns, wasSanitized };
  }

  // ---------- PCE Specification structural parser (for SAP vs Symbio validation) ----------

  function childText(el, tag){
    if (!el) return undefined;
    const c = Array.from(el.children).find(c => c.tagName === tag);
    if (!c) return undefined;
    const t = c.textContent.trim();
    return t === '' ? undefined : t;
  }

  function parseOptions(featureEl){
    // direct FeatureValueList child (not nested ones belonging to sub-features)
    const fvl = Array.from(featureEl.children).find(c => c.tagName === 'FeatureValueList');
    if (!fvl) return [];
    return Array.from(fvl.children)
      .filter(c => c.tagName === 'FeatureValue')
      .map(fv => ({
        value: childText(fv, 'Value') || '',
        name: childText(fv, 'Name') || '',
        charge: parseCharge(fv),
      }));
  }

  function normCode(s){
    // Normalizes finish/group codes so "TEXT PNT" (SAP) === "TEXT_PNT" (Symbio) === "text-pnt".
    return (s || '').trim().toUpperCase().replace(/[\s_\-]+/g, '');
  }

  function normText(s){
    return (s === undefined || s === null) ? '' : String(s).trim().toUpperCase();
  }

  function fuzzyNameMatch(a, b){
    // Symbio names are often simplified versions of SAP names — e.g.
    // "BALTIC 4773" -> "Baltic", "NICKEL METALLIC (TRANS)" -> "Nickel Metallic",
    // "MILK SMOOTH" -> "Milk". Strip parenthetical notes and trailing numeric
    // codes, then treat one being a leading substring of the other as a match.
    const clean = s => normText(s)
      .replace(/\([^)]*\)/g, '')
      .replace(/\b\d{2,}\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const ca = clean(a);
    const cb = clean(b);
    if (ca === cb) return true;
    if (ca && cb && (ca.indexOf(cb) === 0 || cb.indexOf(ca) === 0)) return true;
    return false;
  }

  function collectAllFeatures(root){
    // Every <Feature> anywhere in the document, regardless of nesting depth —
    // handles both SAP's nested-per-group style and Symbio's flat style.
    const out = [];
    const stack = [root];
    while (stack.length) {
      const el = stack.pop();
      for (const child of Array.from(el.children)) {
        if (child.tagName === 'Feature') out.push(child);
        stack.push(child);
      }
    }
    return out;
  }

  function parseCharge(fv){
    // Optional per-finish upcharge block: <Charge><Code/><Description/><Base/><Total/></Charge>.
    // Not every export has this — only extract it when present.
    const chargeEl = Array.from(fv.children).find(c => c.tagName === 'Charge');
    if (!chargeEl) return null;
    const parseNum = t => (t === undefined ? undefined : parseFloat(t));
    return {
      code: childText(chargeEl, 'Code'),
      description: childText(chargeEl, 'Description'),
      base: parseNum(childText(chargeEl, 'Base')),
      total: parseNum(childText(chargeEl, 'Total')),
    };
  }

  function chargeGroupId(charge){
    // The human-readable pricing-group name (e.g. "FABRICPG3") can live in
    // either Code or Description depending on the source system — SAP tends
    // to put it in Code, Symbio tends to put an opaque generated ID in Code
    // and the readable name in Description. Prefer whichever looks readable.
    if (!charge) return undefined;
    return charge.description || charge.code;
  }

  function parseSpecification(xmlString){
    const { root } = parseXmlDocument(xmlString);

    const headerEl = Array.from(root.children).find(c => c.tagName === 'Header');
    const header = headerEl ? {
      priceList: childText(headerEl, 'PriceList'),
      currency: childText(headerEl, 'Currency'),
      language: childText(headerEl, 'Language'),
    } : {};

    const productEl = Array.from(root.children).find(c => c.tagName === 'Product');
    const product = productEl ? {
      code: childText(productEl, 'Code'),
      name: childText(productEl, 'Name'),
    } : {};

    if (productEl) {
      const catalogEl = Array.from(productEl.children).find(c => c.tagName === 'Catalog');
      product.catalog = catalogEl ? {
        code: childText(catalogEl, 'Code'),
        name: childText(catalogEl, 'Name'),
        version: childText(catalogEl, 'Version'),
      } : {};

      const priceInfo = Array.from(productEl.children).find(c => c.tagName === 'PriceInfo');
      if (priceInfo) {
        const priceText = childText(priceInfo, 'Price');
        product.listPrice = priceText !== undefined ? parseFloat(priceText) : undefined;
        product.currency = priceInfo.getAttribute('Currency') || undefined;
      }
    } else {
      product.catalog = {};
    }

    // Top-level <ChargeList> (direct child of <Specification>, NOT the per-finish
    // <Charge> blocks inside FeatureValue) — some styles encode their real base
    // price here instead of in Product.PriceInfo.Price (which shows 0 in that case).
    const chargeListEl = Array.from(root.children).find(c => c.tagName === 'ChargeList');
    const baseCharges = chargeListEl
      ? Array.from(chargeListEl.children).filter(c => c.tagName === 'Charge').map(c => {
          const parseNum = t => (t === undefined ? undefined : parseFloat(t));
          return {
            code: childText(c, 'Code'),
            description: childText(c, 'Description'),
            base: parseNum(childText(c, 'Base')),
            total: parseNum(childText(c, 'Total')),
          };
        })
      : [];

    let effectiveListPrice = product.listPrice;
    let priceSource = 'Product.PriceInfo.Price';
    if ((effectiveListPrice === undefined || effectiveListPrice === 0) && baseCharges.length) {
      effectiveListPrice = baseCharges.reduce((sum, c) => sum + (c.total !== undefined ? c.total : (c.base || 0)), 0);
      priceSource = 'ChargeList (' + baseCharges.map(c => c.code || c.description || '?').join(' + ') + ')';
    }
    product.effectiveListPrice = effectiveListPrice;
    product.priceSource = priceSource;
    product.baseCharges = baseCharges;

    const plainFeatures = [];   // ordinary features (Selection etc.) — matched by Feature.Code
    const finishGroups = [];    // Mode=FinishGroup containers — matched by normalized group code
    const colorEntries = [];    // Mode=Finish leaf colors — matched by normalized color Value

    for (const f of collectAllFeatures(root)) {
      const code = childText(f, 'Code');
      const name = childText(f, 'Name') || '';
      const mode = childText(f, 'Mode') || '';
      const modeNorm = mode.trim().toLowerCase();

      if (modeNorm === 'finishgroup') {
        const groupOptions = parseOptions(f).map(o => Object.assign(o, { containerCode: code || '', containerName: name }));
        finishGroups.push({ code: code || '', name, options: groupOptions });
      } else if (modeNorm === 'finish') {
        const fvl = Array.from(f.children).find(c => c.tagName === 'FeatureValueList');
        const rawOptions = fvl ? Array.from(fvl.children).filter(c => c.tagName === 'FeatureValue') : [];
        rawOptions.forEach(fv => {
          const value = childText(fv, 'Value') || '';
          const cname = childText(fv, 'Name') || '';
          // Symbio tags each color with its group explicitly; SAP nests colors
          // directly under a Feature whose own Code IS the group.
          const explicitGroup = childText(fv, 'FinishGroupFeatureValueCode');
          const groupCode = explicitGroup || code || '';
          const charge = parseCharge(fv);
          colorEntries.push({ groupCode, value, name: cname, sourceFeatureCode: code || '', sourceFeatureName: name || '', charge, hasExplicitGroup: !!explicitGroup });
        });
      } else if (code) {
        plainFeatures.push({ code, name, mode, required: f.getAttribute('Required') || '', options: parseOptions(f) });
      }
    }

    // Some exports (e.g. Symbio) only declare <Charge> at the finish-group
    // (family) level, not per individual color — the color is expected to
    // inherit its family's price. Build that fallback so comparisons don't
    // falsely flag "no upcharge" when the family-level charge is actually
    // present and matches.
    const familyChargeMap = new Map();
    finishGroups.forEach(g => g.options.forEach(o => {
      if (o.charge) familyChargeMap.set(normCode(o.value), o.charge);
    }));
    colorEntries.forEach(entry => {
      entry.effectiveCharge = entry.charge || familyChargeMap.get(normCode(entry.groupCode)) || null;
    });

    return { product, header, plainFeatures, finishGroups, colorEntries };
  }

  function diffPlainFeatures(sapFeatures, symbioFeatures){
    const sapMap = new Map(sapFeatures.map(f => [f.code, f]));
    const symbioMap = new Map(symbioFeatures.map(f => [f.code, f]));
    const allCodes = [];
    const seen = new Set();
    for (const f of sapFeatures) { if (!seen.has(f.code)) { seen.add(f.code); allCodes.push(f.code); } }
    for (const f of symbioFeatures) { if (!seen.has(f.code)) { seen.add(f.code); allCodes.push(f.code); } }

    const rows = [];
    for (const code of allCodes) {
      const sap = sapMap.get(code);
      const sym = symbioMap.get(code);

      if (sap && !sym) {
        rows.push({ category: 'Feature', code, name: sap.name, status: 'Missing in Symbio', details: 'Feature exists in SAP but not found in Symbio.' });
        continue;
      }
      if (!sap && sym) {
        rows.push({ category: 'Feature', code, name: sym.name, status: 'Missing in SAP', details: 'Feature exists in Symbio but not in SAP (not in source of truth).' });
        continue;
      }

      const issues = [];
      if (!fuzzyNameMatch(sap.name, sym.name)) {
        issues.push('Name differs: SAP "' + sap.name + '" vs Symbio "' + sym.name + '"');
      }
      if (normText(sap.mode) !== normText(sym.mode)) {
        issues.push('Mode differs: SAP "' + sap.mode + '" vs Symbio "' + sym.mode + '"');
      }

      const sapOptByValue = new Map(sap.options.map(o => [normText(o.value), o]));
      const symOptByValue = new Map(sym.options.map(o => [normText(o.value), o]));
      const missingInSymbio = sap.options.filter(o => !symOptByValue.has(normText(o.value)));
      const extraInSymbio = sym.options.filter(o => !sapOptByValue.has(normText(o.value)));
      const nameMismatches = [];
      for (const [val, sapOpt] of sapOptByValue) {
        const symOpt = symOptByValue.get(val);
        if (symOpt && normText(symOpt.name) !== normText(sapOpt.name)) {
          nameMismatches.push(sapOpt.value + ': "' + sapOpt.name + '" vs "' + symOpt.name + '"');
        }
      }
      if (missingInSymbio.length) issues.push('Missing option(s) in Symbio: ' + missingInSymbio.map(o => o.value + ' (' + o.name + ')').join(', '));
      if (extraInSymbio.length) issues.push('Extra option(s) in Symbio: ' + extraInSymbio.map(o => o.value + ' (' + o.name + ')').join(', '));
      if (nameMismatches.length) issues.push('Option name mismatch: ' + nameMismatches.join('; '));

      rows.push({
        category: 'Feature',
        code,
        name: sap.name,
        status: issues.length ? 'Mismatch' : 'Match',
        details: issues.length ? issues.join(' | ') : 'All fields and options match.',
      });
    }
    return rows;
  }

  function containerLabel(entry){
    if (!entry) return '';
    return entry.containerCode + (entry.containerName ? ' ' + entry.containerName : '');
  }

  function diffFinishGroups(sapGroups, symbioGroups){
    // The FinishGroup *container* Feature's own code (e.g. SAP "BASIC" vs
    // Symbio "SG0113") is just an internal record ID per system and will
    // never match across SAP/Symbio. What actually matters — and what DOES
    // line up once normalized — is the list of finish groups declared
    // inside each container's FeatureValueList (e.g. ACNTPNT, TEXT_PNT).
    const sapFinGrp = [];
    sapGroups.forEach(g => g.options.forEach(o => sapFinGrp.push(o)));
    const symbioFinGrp = [];
    symbioGroups.forEach(g => g.options.forEach(o => symbioFinGrp.push(o)));

    const sapMap = new Map(sapFinGrp.map(f => [normCode(f.value), f]));
    const symbioMap = new Map(symbioFinGrp.map(f => [normCode(f.value), f]));
    const allKeys = [];
    const seen = new Set();
    for (const f of sapFinGrp) { const k = normCode(f.value); if (!seen.has(k)) { seen.add(k); allKeys.push(k); } }
    for (const f of symbioFinGrp) { const k = normCode(f.value); if (!seen.has(k)) { seen.add(k); allKeys.push(k); } }

    const rows = [];
    for (const key of allKeys) {
      const sap = sapMap.get(key);
      const sym = symbioMap.get(key);
      if (sap && !sym) {
        rows.push({ category: 'Finish Group', code: sap.value, name: sap.name, status: 'Missing in Symbio', details: 'Finish group exists in SAP (in ' + containerLabel(sap) + ') but not found in Symbio.' });
        continue;
      }
      if (!sap && sym) {
        rows.push({ category: 'Finish Group', code: sym.value, name: sym.name, status: 'Missing in SAP', details: 'Finish group exists in Symbio (in ' + containerLabel(sym) + ') but not in SAP.' });
        continue;
      }
      const nameDiffers = !fuzzyNameMatch(sap.name, sym.name);
      const containerNote = 'Container: SAP ' + containerLabel(sap) + ' | Symbio ' + containerLabel(sym) + '.';
      rows.push({
        category: 'Finish Group',
        code: sap.value,
        name: sap.name,
        status: nameDiffers ? 'Mismatch' : 'Match',
        details: (nameDiffers ? ('Name differs: SAP "' + sap.name + '" vs Symbio "' + sym.name + '"') : 'Finish group code and name match.') + ' ' + containerNote,
      });
    }
    return rows;
  }

  function featureLabel(entry){
    if (!entry) return '';
    return entry.sourceFeatureCode + (entry.sourceFeatureName ? ' ' + entry.sourceFeatureName : '');
  }

  function fmtAmt(v){
    return v === undefined ? 'n/a' : v.toFixed(2);
  }

  function amountsDiffer(a, b){
    if (a === undefined && b === undefined) return false;
    if (a === undefined || b === undefined) return true;
    return Math.abs(a - b) > 0.001; // float-precision safety only, not a business tolerance
  }

  function diffColorEntries(sapColors, symbioColors){
    const sapMap = new Map(sapColors.map(c => [normCode(c.value), c]));
    const symbioMap = new Map(symbioColors.map(c => [normCode(c.value), c]));
    const allKeys = [];
    const seen = new Set();
    for (const c of sapColors) { const k = normCode(c.value); if (!seen.has(k)) { seen.add(k); allKeys.push(k); } }
    for (const c of symbioColors) { const k = normCode(c.value); if (!seen.has(k)) { seen.add(k); allKeys.push(k); } }

    const rows = [];
    for (const key of allKeys) {
      const sap = sapMap.get(key);
      const sym = symbioMap.get(key);
      if (sap && !sym) {
        rows.push({ category: 'Finish', code: sap.value, name: sap.name, status: 'Missing in Symbio', details: 'Finish/color exists in SAP (feature ' + featureLabel(sap) + ', group ' + sap.groupCode + ') but not found in Symbio.' });
        continue;
      }
      if (!sap && sym) {
        rows.push({ category: 'Finish', code: sym.value, name: sym.name, status: 'Missing in SAP', details: 'Finish/color exists in Symbio (feature ' + featureLabel(sym) + ', group ' + sym.groupCode + ') but not in SAP.' });
        continue;
      }
      const issues = [];
      if (!fuzzyNameMatch(sap.name, sym.name)) {
        issues.push('Name differs: SAP "' + sap.name + '" vs Symbio "' + sym.name + '"');
      }
      if (sym.hasExplicitGroup && normCode(sap.groupCode) !== normCode(sym.groupCode)) {
        issues.push('Assigned to different finish group: SAP "' + sap.groupCode + '" vs Symbio "' + sym.groupCode + '"');
      }
      const featureNote = 'Feature: SAP ' + featureLabel(sap) + ' | Symbio ' + featureLabel(sym) + '.';
      rows.push({
        category: 'Finish',
        code: sap.value,
        name: sap.name,
        status: issues.length ? 'Mismatch' : 'Match',
        details: (issues.length ? issues.join(' | ') + ' | ' : 'Finish code, name, and finish group all match. ') + featureNote,
      });
    }
    return rows;
  }

  function formatCharge(charge){
    if (!charge) return 'n/a';
    const parts = [];
    if (charge.base !== undefined) parts.push('Base ' + charge.base.toFixed(2));
    if (charge.total !== undefined && charge.total !== charge.base) parts.push('Total ' + charge.total.toFixed(2));
    return parts.length ? parts.join(' / ') : 'n/a';
  }

  function diffCharges(sapColors, symbioColors){
    // Separate table for the Upcharges tab: Charge Code | Description | SAP | Symbio | Status | Details.
    // Only produced for finishes that exist on both sides AND have a <Charge> block on at least one side.
    const sapMap = new Map(sapColors.map(c => [normCode(c.value), c]));
    const symbioMap = new Map(symbioColors.map(c => [normCode(c.value), c]));
    const allKeys = [];
    const seen = new Set();
    for (const c of sapColors) { const k = normCode(c.value); if (!seen.has(k)) { seen.add(k); allKeys.push(k); } }
    for (const c of symbioColors) { const k = normCode(c.value); if (!seen.has(k)) { seen.add(k); allKeys.push(k); } }

    const rows = [];
    for (const key of allKeys) {
      const sap = sapMap.get(key);
      const sym = symbioMap.get(key);
      if (!sap || !sym) continue;
      const sapCharge = sap.effectiveCharge || null;
      const symCharge = sym.effectiveCharge || null;
      if (!sapCharge && !symCharge) continue;

      const chargeCode = chargeGroupId(sapCharge) || chargeGroupId(symCharge) || sap.value;
      const description = sap.name || sym.name || '';

      const issues = [];   // drives Match/Mismatch status — amounts only
      const notes = [];    // informational only — never affects status
      if (!sapCharge) issues.push('No upcharge on SAP side');
      if (!symCharge) issues.push('No upcharge on Symbio side');
      if (sapCharge && symCharge) {
        // Charge group/code labels are represented inconsistently across
        // systems (readable code vs opaque generated ID vs full descriptive
        // text) — not a meaningful basis for mismatch, so this is a note only.
        if (normText(chargeGroupId(sapCharge)) !== normText(chargeGroupId(symCharge))) notes.push('Charge group label differs: SAP "' + (chargeGroupId(sapCharge) || 'n/a') + '" vs Symbio "' + (chargeGroupId(symCharge) || 'n/a') + '"');
        if (amountsDiffer(sapCharge.base, symCharge.base)) issues.push('Base differs: SAP ' + fmtAmt(sapCharge.base) + ' vs Symbio ' + fmtAmt(symCharge.base));
        if (amountsDiffer(sapCharge.total, symCharge.total)) issues.push('Total differs: SAP ' + fmtAmt(sapCharge.total) + ' vs Symbio ' + fmtAmt(symCharge.total));
      }

      const allNotes = [...issues, ...notes];
      rows.push({
        chargeCode: chargeCode,
        description: description,
        sapValue: formatCharge(sapCharge),
        symbioValue: formatCharge(symCharge),
        status: issues.length ? 'Mismatch' : 'Match',
        details: 'Finish ' + sap.value + ' (' + description + ') — Feature: SAP ' + featureLabel(sap) + ' | Symbio ' + featureLabel(sym) + '.' + (allNotes.length ? ' ' + allNotes.join('; ') + '.' : ''),
      });
    }
    return rows;
  }

  function diffSpecifications(sapSpec, symbioSpec){
    const rows = [
      ...diffPlainFeatures(sapSpec.plainFeatures, symbioSpec.plainFeatures),
      ...diffFinishGroups(sapSpec.finishGroups, symbioSpec.finishGroups),
      ...diffColorEntries(sapSpec.colorEntries, symbioSpec.colorEntries),
    ];

    const chargeRows = diffCharges(sapSpec.colorEntries, symbioSpec.colorEntries);

    // List Price comparison now lives in the Upcharges tab too — same shape as chargeRows.
    if (sapSpec.product.effectiveListPrice !== undefined || symbioSpec.product.effectiveListPrice !== undefined) {
      const sapPrice = sapSpec.product.effectiveListPrice;
      const symPrice = symbioSpec.product.effectiveListPrice;
      const sourceNote = ' (SAP source: ' + sapSpec.product.priceSource + ' | Symbio source: ' + symbioSpec.product.priceSource + ')';
      let status, details;
      if (sapPrice === undefined || symPrice === undefined) {
        status = 'Mismatch';
        details = 'Price missing on one side — SAP: ' + (sapPrice === undefined ? 'n/a' : sapPrice) + ', Symbio: ' + (symPrice === undefined ? 'n/a' : symPrice) + sourceNote;
      } else if (!amountsDiffer(sapPrice, symPrice)) {
        status = 'Match';
        details = 'Base/list price.' + sourceNote;
      } else {
        status = 'Mismatch';
        details = 'Base/list price differs by ' + Math.abs(sapPrice - symPrice).toFixed(2) + '.' + sourceNote;
      }
      chargeRows.unshift({
        chargeCode: 'LIST_PRICE',
        description: 'Base/List Price',
        sapValue: sapPrice !== undefined ? sapPrice.toFixed(2) : 'n/a',
        symbioValue: symPrice !== undefined ? symPrice.toFixed(2) : 'n/a',
        status,
        details,
      });
    }

    return { rows, chargeRows };
  }

  // ---------- Panel controller ----------

  // ---------- Generic Excel-style column filter (reused across all tables) ----------

  function filterCellValue(v){
    return (v === undefined || v === null || v === '') ? '(blank)' : String(v);
  }

  function createColumnFilter(){
    const excluded = {}; // colKey -> Set of excluded normalized string values
    return {
      isExcluded(col, val){ const s = excluded[col]; return s ? s.has(val) : false; },
      toggle(col, val){
        if (!excluded[col]) excluded[col] = new Set();
        if (excluded[col].has(val)) excluded[col].delete(val); else excluded[col].add(val);
        if (excluded[col].size === 0) delete excluded[col];
      },
      include(col, val){ if (excluded[col]) { excluded[col].delete(val); if (excluded[col].size === 0) delete excluded[col]; } },
      exclude(col, val){ if (!excluded[col]) excluded[col] = new Set(); excluded[col].add(val); },
      clear(col){ delete excluded[col]; },
      clearAll(){ Object.keys(excluded).forEach(k => delete excluded[k]); },
      isColumnFiltered(col){ return !!excluded[col]; },
      matches(row, getVal, cols){
        for (const col of cols) {
          if (!excluded[col]) continue;
          if (excluded[col].has(getVal(row, col))) return false;
        }
        return true;
      },
    };
  }

  let activeFilterPanel = null;
  function closeColumnFilterPanel(){
    if (activeFilterPanel) {
      if (activeFilterPanel._cleanup) activeFilterPanel._cleanup();
      activeFilterPanel.remove();
      activeFilterPanel = null;
    }
  }
  document.addEventListener('click', (e) => {
    if (activeFilterPanel && !activeFilterPanel.contains(e.target) && !e.target.closest('.col-filter-btn')) {
      closeColumnFilterPanel();
    }
  });

  function openColumnFilterPanel(anchorBtn, col, rawValues, filterObj, onChange){
    const alreadyOpenForThis = activeFilterPanel && activeFilterPanel._forCol === col && activeFilterPanel._forFilterObj === filterObj;
    closeColumnFilterPanel();
    if (alreadyOpenForThis) return;

    const uniqueVals = Array.from(new Set(rawValues.map(filterCellValue))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    const panel = document.createElement('div');
    panel.className = 'col-filter-panel';
    panel._forCol = col;
    panel._forFilterObj = filterObj;

    const panelWidth = 220;
    const anchorThead = anchorBtn.closest('thead') || anchorBtn.closest('table') || document;
    function currentAnchor(){
      return anchorThead.querySelector('[data-filter-col="' + col.replace(/"/g, '\\"') + '"]') || anchorBtn;
    }
    function reposition(){
      const live = currentAnchor();
      if (!live.isConnected) return; // header not currently rendered (e.g. table hidden) — keep last position
      const rect = live.getBoundingClientRect();
      let left = rect.left;
      if (left + panelWidth > window.innerWidth - 8) left = window.innerWidth - panelWidth - 8;
      panel.style.top = (rect.bottom + 4) + 'px';
      panel.style.left = Math.max(8, left) + 'px';
    }

    const searchWrap = document.createElement('div');
    searchWrap.className = 'col-filter-search';
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Search values...';
    searchWrap.appendChild(searchInput);
    panel.appendChild(searchWrap);

    const actions = document.createElement('div');
    actions.className = 'col-filter-actions';
    const selectAllBtn = document.createElement('button');
    selectAllBtn.type = 'button';
    selectAllBtn.textContent = 'Select Shown';
    const deselectAllBtn = document.createElement('button');
    deselectAllBtn.type = 'button';
    deselectAllBtn.textContent = 'Deselect Shown';
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.textContent = 'Clear Filter';
    clearBtn.addEventListener('click', () => {
      filterObj.clear(col);
      onChange();
      closeColumnFilterPanel();
    });
    actions.appendChild(selectAllBtn);
    actions.appendChild(deselectAllBtn);
    actions.appendChild(clearBtn);
    panel.appendChild(actions);

    const list = document.createElement('div');
    list.className = 'col-filter-list';
    panel.appendChild(list);

    function renderList(filterText){
      list.innerHTML = '';
      const ft = (filterText || '').toLowerCase();
      const shown = uniqueVals.filter(v => v.toLowerCase().indexOf(ft) !== -1);
      selectAllBtn.onclick = () => {
        shown.forEach(v => filterObj.include(col, v));
        onChange();
        renderList(searchInput.value);
        updateIconState();
      };
      deselectAllBtn.onclick = () => {
        shown.forEach(v => filterObj.exclude(col, v));
        onChange();
        renderList(searchInput.value);
        updateIconState();
      };
      if (!shown.length) {
        const empty = document.createElement('div');
        empty.className = 'col-filter-empty';
        empty.textContent = 'No matching values.';
        list.appendChild(empty);
        return;
      }
      shown.forEach(v => {
        const item = document.createElement('label');
        item.className = 'col-filter-item';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !filterObj.isExcluded(col, v);
        cb.addEventListener('change', () => {
          filterObj.toggle(col, v);
          onChange();
          updateIconState();
        });
        const span = document.createElement('span');
        span.textContent = v;
        span.title = v;
        item.appendChild(cb);
        item.appendChild(span);
        list.appendChild(item);
      });
    }

    function updateIconState(){
      currentAnchor().classList.toggle('active', filterObj.isColumnFiltered(col));
    }

    searchInput.addEventListener('input', () => renderList(searchInput.value));
    renderList('');

    document.body.appendChild(panel);
    activeFilterPanel = panel;
    reposition();
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    panel._cleanup = () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
    searchInput.focus();
  }

  function buildFilterableHeaderCell(label, col, getValues, filterObj, onChange){
    const th = document.createElement('th');
    const inner = document.createElement('div');
    inner.className = 'th-inner';
    const labelSpan = document.createElement('span');
    labelSpan.className = 'th-label';
    labelSpan.textContent = label;
    inner.appendChild(labelSpan);
    const filterBtn = document.createElement('button');
    filterBtn.type = 'button';
    filterBtn.className = 'col-filter-btn' + (filterObj.isColumnFiltered(col) ? ' active' : '');
    filterBtn.textContent = '\u25BE';
    filterBtn.title = 'Filter ' + label;
    filterBtn.dataset.filterCol = col;
    filterBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openColumnFilterPanel(filterBtn, col, getValues(), filterObj, onChange);
    });
    inner.appendChild(filterBtn);
    th.appendChild(inner);
    return th;
  }

  function initPanel(target){
    const state = { columns: [], rows: [], visible: new Set(), spec: null };
    let searchQuery = '';
    const columnFilter = createColumnFilter();

    const els = {
      textarea: document.getElementById('xml-' + target),
      status: document.getElementById('status-' + target),
      colsBox: document.getElementById('cols-' + target),
      chips: document.getElementById('chips-' + target),
      tableWrap: document.getElementById('table-wrap-' + target),
      table: document.getElementById('table-' + target),
      placeholder: document.getElementById('placeholder-' + target),
      badges: document.getElementById('badges-' + target),
      search: document.getElementById('search-' + target),
    };

    function setStatus(kind, msg){
      els.status.className = 'status show ' + kind;
      els.status.querySelector('.msg').textContent = msg;
    }
    function clearStatus(){
      els.status.className = 'status';
    }

    function renderChips(){
      els.chips.innerHTML = '';
      state.columns.forEach(col => {
        const label = document.createElement('label');
        label.className = 'chip' + (state.visible.has(col) ? ' active' : '');
        label.innerHTML = '<input type="checkbox" ' + (state.visible.has(col) ? 'checked' : '') + '><span class="box"></span><span></span>';
        label.querySelector('span:last-child').textContent = col;
        const input = label.querySelector('input');
        input.addEventListener('change', () => {
          if (input.checked) state.visible.add(col); else state.visible.delete(col);
          label.classList.toggle('active', input.checked);
          renderTable();
        });
        els.chips.appendChild(label);
      });
    }

    function renderTable(){
      const activeCols = state.columns.filter(c => state.visible.has(c));
      const thead = els.table.querySelector('thead');
      const tbody = els.table.querySelector('tbody');
      thead.innerHTML = '';
      tbody.innerHTML = '';

      if (activeCols.length === 0) {
        els.tableWrap.classList.remove('show');
        return;
      }
      els.tableWrap.classList.add('show');

      const trh = document.createElement('tr');
      activeCols.forEach(c => {
        const th = buildFilterableHeaderCell(c, c, () => state.rows.map(r => r[c]), columnFilter, renderTable);
        trh.appendChild(th);
      });
      thead.appendChild(trh);

      state.rows
        .filter(row => {
          if (!searchQuery) return true;
          const haystack = Object.values(row).join(' ').toLowerCase();
          return haystack.indexOf(searchQuery.toLowerCase()) !== -1;
        })
        .filter(row => columnFilter.matches(row, (r, c) => filterCellValue(r[c]), activeCols))
        .forEach(row => {
        const tr = document.createElement('tr');
        activeCols.forEach(c => {
          const td = document.createElement('td');
          const val = row[c];
          if (val === undefined || val === '') {
            td.textContent = '—';
            td.classList.add('empty-cell');
          } else {
            td.textContent = val;
            td.title = val;
          }
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
    }

    function renderBadges(){
      els.badges.innerHTML = '';
      const b1 = document.createElement('span');
      b1.className = 'badge';
      b1.textContent = state.rows.length + ' row' + (state.rows.length === 1 ? '' : 's');
      const b2 = document.createElement('span');
      b2.className = 'badge';
      b2.textContent = state.columns.length + ' column' + (state.columns.length === 1 ? '' : 's') + ' detected';
      els.badges.appendChild(b1);
      els.badges.appendChild(b2);
    }

    function doConvert(){
      const xmlString = els.textarea.value.trim();
      if (!xmlString) {
        setStatus('error', 'Paste some XML first.');
        return;
      }
      try {
        const { rows, columns, wasSanitized } = xmlToRows(xmlString);
        state.rows = rows;
        state.columns = columns;
        state.visible = new Set(columns);
        const note = wasSanitized ? '' : '';
        setStatus('ok', 'Converted — ' + rows.length + ' row(s), ' + columns.length + ' column(s) detected.' + note);
        els.colsBox.classList.add('show');
        els.placeholder.style.display = 'none';
        renderChips();
        renderTable();
        renderBadges();
        try {
          state.spec = parseSpecification(xmlString);
        } catch (specErr) {
          state.spec = null; // structural parse is best-effort; generic table still works
        }
      } catch (e) {
        state.rows = [];
        state.columns = [];
        state.spec = null;
        els.colsBox.classList.remove('show');
        els.tableWrap.classList.remove('show');
        els.badges.innerHTML = '';
        els.placeholder.style.display = 'block';
        setStatus('error', e.message || 'Failed to convert XML.');
      }
    }

    function doClear(){
      els.textarea.value = '';
      state.rows = [];
      state.columns = [];
      state.visible = new Set();
      state.spec = null;
      searchQuery = '';
      columnFilter.clearAll();
      if (els.search) els.search.value = '';
      clearStatus();
      els.colsBox.classList.remove('show');
      els.tableWrap.classList.remove('show');
      els.badges.innerHTML = '';
      els.placeholder.style.display = 'block';
    }

    function doAll(){
      state.visible = new Set(state.columns);
      renderChips();
      renderTable();
    }
    function doNone(){
      state.visible = new Set();
      renderChips();
      renderTable();
    }

    function getVisibleRows(){
      return state.rows
        .filter(row => {
          if (!searchQuery) return true;
          const haystack = Object.values(row).join(' ').toLowerCase();
          return haystack.indexOf(searchQuery.toLowerCase()) !== -1;
        })
        .filter(row => columnFilter.matches(row, (r, c) => filterCellValue(r[c]), state.columns));
    }

    function doCsv(){
      const activeCols = state.columns.filter(c => state.visible.has(c));
      const rows = getVisibleRows();
      if (activeCols.length === 0 || rows.length === 0) {
        setStatus('error', 'Nothing to copy yet — convert first, or clear filters.');
        return;
      }
      const esc = v => {
        const s = (v === undefined ? '' : String(v));
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      };
      const lines = [activeCols.map(esc).join(',')];
      rows.forEach(row => {
        lines.push(activeCols.map(c => esc(row[c])).join(','));
      });
      const csv = lines.join('\n');
      navigator.clipboard.writeText(csv).then(() => {
        setStatus('ok', 'CSV copied to clipboard (' + activeCols.length + ' columns, ' + rows.length + ' rows).');
      }).catch(() => {
        setStatus('error', 'Clipboard unavailable in this browser context.');
      });
    }

    function doXlsx(){
      const activeCols = state.columns.filter(c => state.visible.has(c));
      const rows = getVisibleRows();
      if (activeCols.length === 0 || rows.length === 0) {
        setStatus('error', 'Nothing to export yet — convert first, or clear filters.');
        return;
      }
      if (typeof XLSX === 'undefined') {
        setStatus('error', 'XLSX library failed to load — check your internet connection.');
        return;
      }
      const aoa = [activeCols];
      rows.forEach(row => {
        aoa.push(activeCols.map(c => (row[c] === undefined ? '' : row[c])));
      });
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = activeCols.map(c => ({ wch: Math.min(Math.max(c.length, 12), 40) }));
      const wb = XLSX.utils.book_new();
      const sheetName = target === 'sap' ? 'SAP Styles' : 'Symbio Styles';
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
      const stamp = new Date().toISOString().slice(0, 10);
      const filename = (target === 'sap' ? 'sap_styles' : 'symbio_styles') + '_' + stamp + '.xlsx';
      XLSX.writeFile(wb, filename);
      setStatus('ok', 'Downloaded ' + filename + ' (' + activeCols.length + ' columns, ' + rows.length + ' rows).');
    }

    if (els.search) {
      els.search.addEventListener('input', () => {
        searchQuery = els.search.value.trim();
        renderTable();
      });
    }

    return { doConvert, doClear, doAll, doNone, doCsv, doXlsx, state };
  }

  const controllers = {
    sap: initPanel('sap'),
    symbio: initPanel('symbio'),
  };

  document.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.getAttribute('data-action');
      const target = btn.getAttribute('data-target');
      if (!target || !controllers[target]) return;
      if (action === 'convert') controllers[target].doConvert();
      if (action === 'clear') controllers[target].doClear();
      if (action === 'all') controllers[target].doAll();
      if (action === 'none') controllers[target].doNone();
      if (action === 'csv') controllers[target].doCsv();
      if (action === 'xlsx') controllers[target].doXlsx();
    });
  });
