(() => {
  'use strict';

  const model = window.GS_MODEL_DATA;
  const dayMs = 86400000;
  const state = {
    results: [],
    inputReport: null,
    manual: new Map(),
    parsed: {stock: null, plans: null},
    warnings: [],
  };

  const $ = (id) => document.getElementById(id);
  const nf0 = new Intl.NumberFormat('ru-RU', {maximumFractionDigits: 0});
  const nf1 = new Intl.NumberFormat('ru-RU', {minimumFractionDigits: 1, maximumFractionDigits: 1});
  const nf2 = new Intl.NumberFormat('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  const normalize = (v) => String(v ?? '').toUpperCase().replace(/Ё/g, 'Е').replace(/[^A-ZА-Я0-9]/g, '');
  const normalizeHeader = normalize;
  const excludedBranchNorms = new Set(['УЗЛОВАЯ']);
  const isExcludedBranch = (b) => excludedBranchNorms.has(normalize(b));
  const normId = (v) => {
    const n = String(v ?? '').trim();
    if (!n) return '';
    const m = n.match(/\d+/);
    return m ? String(Number(m[0])) : n;
  };
  const number = (v) => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    const n = parseFloat(String(v ?? '').replace(/\s/g,'').replace(',','.'));
    return Number.isFinite(n) ? n : 0;
  };
  const clampNumber = (id, min, max, fallback) => {
    const n = number($(id).value);
    return Math.min(max, Math.max(min, n || fallback));
  };
  const iso = (date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };
  const localDate = (text) => {
    if (!text) return null;
    const m = String(text).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const diffDays = (start, end) => Math.round((new Date(end.getFullYear(),end.getMonth(),end.getDate()) - new Date(start.getFullYear(),start.getMonth(),start.getDate())) / dayMs);
  const fmtDate = (d) => d ? new Intl.DateTimeFormat('ru-RU').format(d) : '—';
  const roundUp = (v, multiple) => v <= 0 ? 0 : Math.ceil(v / Math.max(1, multiple)) * Math.max(1, multiple);
  const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));

  if (!model || !Array.isArray(model.products) || !Array.isArray(model.demand)) {
    showMessage('Не удалось загрузить встроенный справочник ГС. Проверьте наличие файла model-data.js.', 'error');
    return;
  }

  const productById = new Map(model.products.map(x => [normId(x.id), x]));
  const productByArticle = new Map(model.products.map(x => [normalize(x.article), x]));
  const demandByBranchArticle = new Map(model.demand.map(x => [`${normalize(x.branch)}|${normalize(x.article)}`, x]));
  const branchList = model.branches.filter(b => b !== 'Компания' && !isExcludedBranch(b));
  const allowedBranches = new Set(branchList.map(normalize));
  const branchNormToName = new Map(branchList.map(b => [normalize(b), b]));
  const branchNormList = branchList.map(b => ({name:b, norm:normalize(b)})).filter(x => x.norm && x.name !== 'Компания');

  const monthKey = (date) => String(date.getMonth() + 1).padStart(2, '0');
  const daysInMonth = (date) => new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const seasonality = model.seasonality || {};
  const companySeasonality = seasonality.company || {};
  const branchSeasonality = seasonality.byBranch || {};
  const branchSeasonStats = seasonality.branchStats || {};
  const hasSeasonality = !!(seasonality.company && seasonality.byBranch);

  function getSeasonalityInfo(branch, date, demandMode) {
    if (demandMode !== 'seasonal' || !hasSeasonality) return {coef:1, source:'Средний спрос', mode:'average', credibility:0};
    const m = monthKey(date);
    const byBranch = branchSeasonality[branch] || null;
    const stat = branchSeasonStats[branch] || {};
    const coef = number(byBranch?.[m] ?? companySeasonality[m] ?? 1) || 1;
    let source = 'сезонность компании';
    if (byBranch) {
      if (stat.mode === 'branch') source = 'сезонность филиала';
      else if (stat.mode === 'blended') source = `смешанная сезонность, вес филиала ${Math.round(number(stat.credibility) * 100)}%`;
    }
    return {coef, source, mode:stat.mode || 'company', credibility:number(stat.credibility)};
  }

  function demandBetween(avgMonthly, branch, startDate, endDate, demandMode) {
    if (!startDate || !endDate || endDate <= startDate || avgMonthly <= 0) return 0;
    let total = 0;
    const d = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
    while (d < end) {
      const coef = getSeasonalityInfo(branch, d, demandMode).coef;
      total += (avgMonthly * coef) / daysInMonth(d);
      d.setDate(d.getDate() + 1);
    }
    return total;
  }

  function init() {
    branchList.forEach(b => $('branch').add(new Option(b, b)));
    const defaultBranch = branchList.includes('МОСКВА-СОСЕНКИ') ? 'МОСКВА-СОСЕНКИ' : branchList[0];
    $('branch').value = defaultBranch;
    $('shipDate').value = iso(new Date());
    $('stockFile').addEventListener('change', () => setFileLabel('stock'));
    $('plansFile').addEventListener('change', () => setFileLabel('plans'));
    $('calculate').addEventListener('click', calculate);
    $('search').addEventListener('input', render);
    $('onlyOrder').addEventListener('change', render);
    $('resetManual').addEventListener('click', () => {
      state.manual.clear();
      $('resetManual').disabled = true;
      render();
    });
    $('exportXlsx').addEventListener('click', exportXlsx);
    $('exportCsv').addEventListener('click', exportCsv);
  }

  function setFileLabel(type) {
    const file = $(type + 'File').files[0];
    const status = $(type + 'Status');
    const card = $(type + 'Card');
    if (!file) {
      status.textContent = '';
      card.classList.remove('loaded');
      return;
    }
    const label = type === 'stock' ? 'Отчёт МЗ' : 'План отгрузок';
    status.textContent = `${label}: ${file.name}`;
    card.classList.add('loaded');
  }

  function showMessage(text, type='info') {
    const el = $('message');
    el.textContent = text;
    el.className = `message visible ${type}`;
  }
  function clearMessage() {
    $('message').textContent = '';
    $('message').className = 'message';
  }

  function showWarnings(items) {
    const el = $('warnings');
    if (!el) return;
    const list = (items || []).filter(Boolean);
    state.warnings = list;
    if (!list.length) {
      el.innerHTML = '';
      el.className = 'warnings';
      return;
    }
    el.innerHTML = `<strong>Проверьте входные данные</strong><ul>${list.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul>`;
    el.className = 'warnings visible';
  }
  function clearWarnings() { showWarnings([]); }

  async function readWorkbook(file) {
    if (!window.XLSX) throw new Error('Библиотека обработки Excel не загрузилась. Проверьте доступ браузера к cdnjs.cloudflare.com или подключите библиотеку XLSX локально.');
    const buffer = await file.arrayBuffer();
    return XLSX.read(buffer, {type:'array', cellDates:true});
  }

  function rowsFromWorkbook(wb) {
    return wb.SheetNames.map(sheetName => ({
      name: sheetName,
      rows: XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {header:1, defval:'', raw:true, blankrows:false})
    }));
  }

  function detectBranches(sheets, fileName='') {
    const found = new Set();
    const chunks = [fileName];
    for (const sheet of sheets) {
      chunks.push(sheet.name);
      const limitRows = Math.min(30, sheet.rows.length);
      for (let r = 0; r < limitRows; r++) {
        const row = sheet.rows[r] || [];
        const limitCols = Math.min(20, row.length);
        for (let c = 0; c < limitCols; c++) {
          const value = row[c];
          if (value !== null && value !== undefined && String(value).trim()) chunks.push(String(value));
        }
      }
    }
    const normalizedText = normalize(chunks.join(' '));
    branchNormList.forEach(b => {
      if (b.norm && normalizedText.includes(b.norm)) found.add(b.name);
    });
    return Array.from(found);
  }

  function countMapToText(map, limit=5) {
    return Array.from(map.entries())
      .sort((a,b) => b[1] - a[1])
      .slice(0, limit)
      .map(([branch,count]) => `${branch} — ${nf0.format(count)} строк`)
      .join('; ');
  }

  function findColumn(headers, aliases) {
    const normalized = headers.map(normalizeHeader);
    for (const alias of aliases) {
      const ix = normalized.findIndex(h => h && (h === alias || h.includes(alias) || alias.includes(h)));
      if (ix >= 0) return ix;
    }
    return -1;
  }

  function findStrictColumn(headers, aliases) {
    const normalized = headers.map(normalizeHeader);
    const aliasSet = new Set(aliases.map(normalizeHeader));
    return normalized.findIndex(h => h && aliasSet.has(h));
  }

  function findSheet(sheets, type) {
    const required = type === 'stock'
      ? {id:['IDТОВАРА','ID'], free:['СВОБПОДТ','СВОБОДНОСПОДТВ','СВОБОДНОСПОДТВЕРЖДЕНИЕМ'], transit:['SUMВПУТИ','ВПУТИ']}
      : {branch:['ФИЛ','ФИЛИАЛ'], date:['ДАТАПЛАНОВАЯ','ДАТА'], qty:['КОЛ','КОЛВО','КОЛИЧЕСТВО'], id:['IDТОВАРА','ID'], article:['АРТИКУЛ']};

    let best = null;
    for (const sheet of sheets) {
      for (let r = 0; r < Math.min(15, sheet.rows.length); r++) {
        const headers = sheet.rows[r];
        const map = {};
        for (const [key, aliases] of Object.entries(required)) map[key] = findColumn(headers, aliases);
        const requiredOk = type === 'stock'
          ? map.id >= 0 && map.free >= 0 && map.transit >= 0
          : map.branch >= 0 && map.date >= 0 && map.qty >= 0 && (map.id >= 0 || map.article >= 0);
        const score = Object.values(map).filter(x => x >= 0).length;
        if (requiredOk && (!best || score > best.score)) best = {sheet, headerRow:r, map, score};
      }
    }
    return best;
  }

  function parseExcelDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return new Date(value.getFullYear(), value.getMonth(), value.getDate());
    if (typeof value === 'number' && window.XLSX && XLSX.SSF) {
      const p = XLSX.SSF.parse_date_code(value);
      return p ? new Date(p.y, p.m - 1, p.d) : null;
    }
    const v = String(value ?? '').trim();
    if (!v) return null;
    const ru = v.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
    if (ru) {
      const y = Number(ru[3].length === 2 ? '20'+ru[3] : ru[3]);
      return new Date(y, Number(ru[2]) - 1, Number(ru[1]));
    }
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  async function parseStock(file, selectedBranch) {
    const sheets = rowsFromWorkbook(await readWorkbook(file));
    const found = findSheet(sheets, 'stock');
    if (!found) throw new Error('В отчёте МЗ не найдены обязательные поля: ID товара, свободно с подтверждением и в пути.');

    const headers = found.sheet.rows[found.headerRow] || [];
    // В отчёте МЗ часто есть техническое поле «Sum-Остаток на фил».
    // Его нельзя считать колонкой филиала, поэтому для филиала используем только точные заголовки.
    const branchColumn = findStrictColumn(headers, ['ФИЛ','ФИЛИАЛ','ФИЛИАЛСКЛАД','СКЛАДФИЛИАЛ','ФИЛИАЛПОЛУЧАТЕЛЬ','СКЛАДПОЛУЧАТЕЛЬ']);
    const branchNorm = normalize(selectedBranch);
    const branchCounts = new Map();
    const detectedBranches = detectBranches(sheets, file.name);
    const sums = new Map();
    let matched = 0, unmatched = 0, allRows = 0, selectedRows = 0, foreign = 0;

    for (const row of found.sheet.rows.slice(found.headerRow + 1)) {
      const id = normId(row[found.map.id]);
      if (!id) continue;
      allRows++;

      if (branchColumn >= 0) {
        const rawBranch = String(row[branchColumn] ?? '').trim();
        const declaredBranch = normalize(rawBranch);
        const branchName = branchNormToName.get(declaredBranch) || rawBranch || 'не указан';
        branchCounts.set(branchName, (branchCounts.get(branchName) || 0) + 1);
        if (declaredBranch !== branchNorm) { foreign++; continue; }
        selectedRows++;
      }

      const product = productById.get(id);
      if (!product) { unmatched++; continue; }
      matched++;
      const current = sums.get(product.article) || {free:0, transit:0};
      current.free += number(row[found.map.free]);
      current.transit += number(row[found.map.transit]);
      sums.set(product.article, current);
    }
    return {sums, matched, unmatched, allRows, selectedRows, foreign, branchColumnFound:branchColumn >= 0, branchCounts, detectedBranches, sheet:found.sheet.name};
  }

  async function parsePlans(file, selectedBranch) {
    const sheets = rowsFromWorkbook(await readWorkbook(file));
    const found = findSheet(sheets, 'plans');
    if (!found) throw new Error('В плане отгрузок не найдены обязательные поля: Фил, Дата плановая, Кол и ID товара/Артикул.');
    const branchNorm = normalize(selectedBranch);
    const all = new Map();
    const branchCounts = new Map();
    let matched = 0, unmatched = 0, foreign = 0, invalidDate = 0, allRows = 0, selectedRows = 0;

    for (const row of found.sheet.rows.slice(found.headerRow + 1)) {
      const rawBranch = String(row[found.map.branch] ?? '').trim();
      const declaredBranch = normalize(rawBranch);
      if (!declaredBranch) continue;
      const branchName = branchNormToName.get(declaredBranch) || rawBranch;
      branchCounts.set(branchName, (branchCounts.get(branchName) || 0) + 1);
      allRows++;
      if (declaredBranch !== branchNorm) { foreign++; continue; }
      selectedRows++;
      let product = null;
      if (found.map.id >= 0) product = productById.get(normId(row[found.map.id]));
      if (!product && found.map.article >= 0) product = productByArticle.get(normalize(row[found.map.article]));
      if (!product) { unmatched++; continue; }
      const planDate = parseExcelDate(row[found.map.date]);
      if (!planDate) { invalidDate++; continue; }
      matched++;
      const key = product.article;
      const previous = all.get(key) || [];
      previous.push({date:planDate, qty:Math.max(0, number(row[found.map.qty]))});
      all.set(key, previous);
    }
    return {all, matched, unmatched, foreign, invalidDate, allRows, selectedRows, branchCounts, sheet:found.sheet.name};
  }

  function buildWarnings({stock, plans, branch, shipDate, arrival, transitDays, targetDays, daysUntilArrival}) {
    const warnings = [];
    const today = new Date();
    const today0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const branchNorm = normalize(branch);

    if (stock.branchColumnFound) {
      if (stock.selectedRows === 0 && stock.foreign > 0) {
        warnings.push(`В отчёте МЗ нет строк по выбранному филиалу «${branch}». В файле найдены другие филиалы: ${countMapToText(stock.branchCounts)}. Проверьте, что загружен правильный «Анализ МЗ».`);
      }
    } else if (stock.detectedBranches.length) {
      const detectedNorms = stock.detectedBranches.map(normalize);
      if (!detectedNorms.includes(branchNorm)) {
        warnings.push(`В отчёте МЗ по названию файла/листа обнаружен другой филиал: ${stock.detectedBranches.join(', ')}. Выбран филиал «${branch}». Проверьте соответствие файла.`);
      }
    }

    if (stock.matched === 0) {
      warnings.push('В отчёте МЗ не найдено ни одной строки гардеробной системы по встроенному справочнику SKU. Расчёт остатков будет некорректным.');
    } else if (stock.matched < Math.min(30, Math.floor(model.products.length * 0.25))) {
      warnings.push(`В отчёте МЗ найдено мало SKU гардеробной системы: ${nf0.format(stock.matched)} из ${nf0.format(model.products.length)}. Проверьте, что отчёт выгружен полностью.`);
    }

    if (plans.selectedRows === 0 && plans.foreign > 0) {
      warnings.push(`В плане отгрузок нет строк для выбранного филиала «${branch}». В файле указаны: ${countMapToText(plans.branchCounts)}. Возможно, выбран не тот филиал или загружен не тот план.`);
    } else if (plans.selectedRows > 0 && plans.matched === 0) {
      warnings.push(`В плане отгрузок по филиалу «${branch}» найдено ${nf0.format(plans.selectedRows)} строк, но среди них нет SKU гардеробной системы. Если поставки ГС уже запланированы, проверьте ID товара/артикулы.`);
    }

    if (plans.invalidDate > 0) {
      warnings.push(`В плане отгрузок есть строки выбранного филиала с некорректной датой: ${nf0.format(plans.invalidDate)}. Эти строки не учтены в ранних/поздних планах.`);
    }

    if (shipDate < today0) {
      warnings.push('Плановая дата отгрузки с завода раньше сегодняшней даты. Проверьте дату: прогноз до прихода может быть занижен.');
    }
    if (arrival < today0) {
      warnings.push('Расчётная дата прихода уже прошла. Проверьте дату отгрузки и количество дней в пути.');
    }
    if (transitDays === 0) {
      warnings.push('Количество дней в пути равно 0. Это допустимо только если приход на филиал происходит в день отгрузки.');
    }
    if (daysUntilArrival > 120) {
      warnings.push(`До расчётной даты прихода ${nf0.format(daysUntilArrival)} дней. Для такого длинного горизонта прогноз спроса может быть грубым.`);
    }
    if (targetDays < 14) {
      warnings.push('Целевой срок хранения МЗ меньше 14 дней. Есть риск, что запас получится слишком низким для регулярных продаж.');
    }
    if (targetDays > 180) {
      warnings.push('Целевой срок хранения МЗ больше 180 дней. Есть риск завышения складского запаса.');
    }
    return warnings;
  }

  async function calculate() {
    clearMessage();
    clearWarnings();
    const stockFile = $('stockFile').files[0];
    const plansFile = $('plansFile').files[0];
    const shipDate = localDate($('shipDate').value);
    const branch = $('branch').value;
    const transitDays = Math.round(clampNumber('transitDays', 0, 180, 14));
    const targetDays = Math.round(clampNumber('targetDays', 1, 365, 45));
    const demandMode = $('demandMode')?.value || 'seasonal';

    if (!stockFile || !plansFile) return showMessage('Загрузите оба файла: «Анализ МЗ» и «Планы на отгрузку».', 'error');
    if (!shipDate) return showMessage('Укажите корректную плановую дату отгрузки.', 'error');
    if (!allowedBranches.has(normalize(branch))) return showMessage('Выберите филиал из встроенного справочника исторического спроса.', 'error');

    const button = $('calculate');
    button.disabled = true;
    button.textContent = 'Проверяем файлы…';
    try {
      const [stock, plans] = await Promise.all([parseStock(stockFile, branch), parsePlans(plansFile, branch)]);
      const arrival = addDays(shipDate, transitDays);
      const today = new Date();
      const today0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const daysUntilArrival = Math.max(0, diffDays(today0, arrival));
      const targetEnd = addDays(arrival, targetDays);
      const warnings = buildWarnings({stock, plans, branch, shipDate, arrival, transitDays, targetDays, daysUntilArrival});
      if (demandMode === 'seasonal' && !hasSeasonality) warnings.push('Встроенные сезонные коэффициенты не найдены. Расчёт выполнен по среднему спросу.');
      if (stock.matched === 0) {
        showWarnings(warnings);
        throw new Error('Расчёт остановлен: в отчёте МЗ не найдено SKU гардеробной системы. Проверьте файл «Анализ МЗ».');
      }
      const results = [];

      for (const product of model.products) {
        const hist = demandByBranchArticle.get(`${normalize(branch)}|${normalize(product.article)}`);
        const avgMonthly = hist ? number(hist.avgMonthly) : 0;
        const seasonInfo = getSeasonalityInfo(branch, arrival, demandMode);
        const targetStock = Math.ceil(demandMode === 'seasonal'
          ? demandBetween(avgMonthly, branch, arrival, targetEnd, demandMode)
          : (avgMonthly / 30.44) * targetDays);
        const forecast = demandMode === 'seasonal'
          ? demandBetween(avgMonthly, branch, today0, arrival, demandMode)
          : (avgMonthly / 30.44) * daysUntilArrival;
        const inventory = stock.sums.get(product.article) || {free:0, transit:0};
        const productPlans = plans.all.get(product.article) || [];
        let earlyPlans = 0, latePlans = 0;
        productPlans.forEach(p => {
          if (p.date < shipDate) earlyPlans += p.qty;
          else latePlans += p.qty;
        });
        const rawNeed = targetStock + forecast - inventory.free - inventory.transit - earlyPlans;
        const autoOrder = roundUp(rawNeed, product.pack);
        let status = 'Запас';
        if (avgMonthly <= 0) status = 'Нет спроса';
        else if (autoOrder > 0) status = 'Заказать';
        results.push({
          ...product, flag:hist?.flag || 'Нет истории',
          avgMonthly, seasonCoef:seasonInfo.coef, seasonSource:seasonInfo.source,
          targetStock, free:inventory.free, transit:inventory.transit,
          earlyPlans, latePlans, forecast, rawNeed, autoOrder, effectiveOrder:autoOrder, status
        });
      }

      state.results = results.sort((a,b) => b.autoOrder - a.autoOrder || b.rawNeed - a.rawNeed || a.name.localeCompare(b.name,'ru'));
      state.inputReport = {branch, shipDate, arrival, targetEnd, transitDays, targetDays, daysUntilArrival, demandMode, stock, plans};
      state.manual.clear();
      showWarnings(warnings);
      $('resetManual').disabled = true;
      render();
      renderSummary();
      $('summary').hidden = false;
      $('results').hidden = false;

      const note = [
        `Расчёт выполнен. Метод: ${demandMode === 'seasonal' ? 'сезонный спрос' : 'средний спрос'}. SKU ГС в отчёте МЗ — ${stock.matched}, в плане отгрузок выбранного филиала — ${plans.matched}.`,
        warnings.length ? `Есть предупреждения: ${warnings.length}.` : 'Критичных предупреждений нет.'
      ].filter(Boolean).join(' ');
      showMessage(note, warnings.length ? 'warning' : 'info');
    } catch (err) {
      console.error(err);
      showMessage(err?.message || 'Не удалось прочитать файл. Проверьте формат и структуру отчёта.', 'error');
    } finally {
      button.disabled = false;
      button.textContent = 'Рассчитать потребность';
    }
  }

  function renderSummary() {
    const r = state.results;
    const orderRows = r.filter(x => getEffectiveOrder(x) > 0);
    const total = orderRows.reduce((s,x) => s + getEffectiveOrder(x),0);
    const input = state.inputReport;
    $('kpiLines').textContent = nf0.format(orderRows.length);
    $('kpiUnits').textContent = nf0.format(total);
    $('kpiArrival').textContent = fmtDate(input.arrival);
    const season = getSeasonalityInfo(input.branch, input.arrival, input.demandMode);
    $('kpiSeason').textContent = input.demandMode === 'seasonal' ? nf2.format(season.coef) : '1,00';
  }

  function getEffectiveOrder(row) {
    return state.manual.has(row.article) ? state.manual.get(row.article) : row.autoOrder;
  }

  function render() {
    const body = $('tableBody');
    const term = normalize($('search').value);
    const onlyOrder = $('onlyOrder').checked;
    const rows = state.results
      .map(r => ({...r, effectiveOrder:getEffectiveOrder(r)}))
      .filter(r => (!onlyOrder || r.effectiveOrder > 0) && (!term || normalize(r.article).includes(term) || normalize(r.name).includes(term)));

    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="14" class="empty">По выбранным условиям позиции не найдены.</td></tr>';
      return;
    }
    body.innerHTML = rows.map(r => {
      const tagClass = r.effectiveOrder > 0 ? 'order' : (r.avgMonthly <= 0 ? 'no-demand' : 'stock');
      const label = r.effectiveOrder > 0 ? 'Заказать' : r.status;
      const manualClass = state.manual.has(r.article) ? 'edited' : '';
      return `<tr class="${tagClass === 'order' ? 'order' : (tagClass === 'no-demand' ? 'no-demand':'')}">
        <td><span class="tag ${tagClass}">${escapeHtml(label)}</span></td>
        <td class="sku">${escapeHtml(r.article)}</td>
        <td class="name">${escapeHtml(r.name)}</td>
        <td class="order-cell"><input class="manual ${manualClass}" type="number" min="0" step="${r.pack}" value="${getEffectiveOrder(r)}" data-article="${escapeHtml(r.article)}" aria-label="Количество к заказу для ${escapeHtml(r.article)}"></td>
        <td>${nf0.format(r.free)}</td><td>${nf0.format(Math.ceil(r.rawNeed))}</td><td>${nf0.format(r.transit)}</td>
        <td>${nf0.format(r.earlyPlans)}</td><td>${nf0.format(r.latePlans)}</td><td>${nf1.format(r.forecast)}</td>
        <td>${nf1.format(r.avgMonthly)}</td><td>${nf2.format(r.seasonCoef)}</td><td>${nf0.format(r.targetStock)}</td><td>${nf0.format(r.pack)}</td>
      </tr>`;
    }).join('');

    body.querySelectorAll('.manual').forEach(input => input.addEventListener('change', event => {
      const article = event.target.dataset.article;
      const row = state.results.find(x => x.article === article);
      const raw = Math.max(0, Math.round(number(event.target.value)));
      const corrected = raw === row.autoOrder ? null : roundUp(raw, row.pack);
      if (corrected === null) state.manual.delete(article); else state.manual.set(article, corrected);
      $('resetManual').disabled = state.manual.size === 0;
      event.target.value = getEffectiveOrder(row);
      renderSummary();
      render();
    }));
  }

  function preparedRows() {
    const i = state.inputReport;
    return state.results.map(r => ({
      'Статус': getEffectiveOrder(r) > 0 ? 'ЗАКАЗАТЬ' : r.status.toUpperCase(),
      'Артикул': r.article,
      'Наименование': r.name,
      'К заказу, шт.': getEffectiveOrder(r),
      'Свободно с подтверждением, шт.': round(r.free,2),
      'Расчётная потребность, шт.': Math.ceil(r.rawNeed),
      'В пути, шт.': round(r.transit,2),
      'Планы до выбранной даты, шт.': round(r.earlyPlans,2),
      'Планы с выбранной даты и позже, шт.': round(r.latePlans,2),
      'Прогноз до прихода, шт.': round(r.forecast,2),
      'Среднемесячный спрос, шт.': round(r.avgMonthly,2),
      'Коэффициент сезонности': round(r.seasonCoef,4),
      'Источник сезонности': r.seasonSource,
      'Целевой МЗ, шт.': r.targetStock,
      'Кратность упаковки': r.pack,
      'Статус SKU': r.status,
      'Флаг статистики': r.flag
    }));
  }
  function round(v,n=2) { const m=10**n; return Math.round((v+Number.EPSILON)*m)/m; }

  function exportXlsx() {
    if (!state.inputReport) return;
    if (!window.XLSX) return showMessage('Не удалось загрузить модуль выгрузки XLSX.', 'error');
    const i = state.inputReport;
    const orderRows = preparedRows().filter(r => r['К заказу, шт.'] > 0);
    const params = [
      {Параметр:'Филиал', Значение:i.branch},
      {Параметр:'Плановая дата отгрузки с завода', Значение:fmtDate(i.shipDate)},
      {Параметр:'Дата прихода в филиал', Значение:fmtDate(i.arrival)},
      {Параметр:'Дней в пути', Значение:i.transitDays},
      {Параметр:'Целевой срок хранения МЗ, дней', Значение:i.targetDays},
      {Параметр:'Метод расчёта спроса', Значение:i.demandMode === 'seasonal' ? 'Сезонный спрос' : 'Средний спрос'},
      {Параметр:'Сезонность месяца прихода', Значение:nf2.format(getSeasonalityInfo(i.branch, i.arrival, i.demandMode).coef)},
      {Параметр:'Дней до прихода от даты расчёта', Значение:i.daysUntilArrival},
      {Параметр:'Строк ГС в отчёте МЗ', Значение:i.stock.matched},
      {Параметр:'Строк ГС в плане отгрузок', Значение:i.plans.matched},
      {Параметр:'Нераспознанные строки МЗ', Значение:i.stock.unmatched},
      {Параметр:'Нераспознанные строки плана', Значение:i.plans.unmatched}
    ];
    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.json_to_sheet(orderRows);
    const ws2 = XLSX.utils.json_to_sheet(params);
    const ws3 = XLSX.utils.json_to_sheet(preparedRows());
    ws1['!cols'] = [12,17,48,14,24,22,14,26,34,18,24,16,16,18,14,22].map(wch => ({wch}));
    ws2['!cols'] = [{wch:42},{wch:30}];
    ws3['!cols'] = ws1['!cols'];
    XLSX.utils.book_append_sheet(wb, ws1, 'Заявка');
    XLSX.utils.book_append_sheet(wb, ws2, 'Параметры');
    XLSX.utils.book_append_sheet(wb, ws3, 'Полный расчет');
    const name = `Заявка_ГС_${i.branch.replace(/[^\wа-яё-]/gi,'_')}_${$('shipDate').value}.xlsx`;
    XLSX.writeFile(wb, name);
  }

  function exportCsv() {
    if (!state.inputReport) return;
    const data = preparedRows().filter(r => r['К заказу, шт.'] > 0);
    const columns = ['Статус','Артикул','Наименование','К заказу, шт.','Свободно с подтверждением, шт.','Расчётная потребность, шт.','В пути, шт.','Планы до выбранной даты, шт.','Планы с выбранной даты и позже, шт.','Прогноз до прихода, шт.','Среднемесячный спрос, шт.','Коэффициент сезонности','Целевой МЗ, шт.','Кратность упаковки'];
    const esc = (v) => `"${String(v ?? '').replace(/"/g,'""')}"`;
    const csv = '\ufeff' + [columns, ...data.map(r => columns.map(c => r[c]))].map(row => row.map(esc).join(';')).join('\n');
    const blob = new Blob([csv], {type:'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), {href:url, download:`Заявка_ГС_${state.inputReport.branch}_${$('shipDate').value}.csv`});
    document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  init();
})();