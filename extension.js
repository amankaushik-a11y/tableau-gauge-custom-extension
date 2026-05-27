'use strict';

// ── Constants ─────────────────────────────────────────────────────────────────
const ARC_CIRCUMFERENCE = Math.PI * 125; // semicircle r=125 ≈ 392.70
const ARC_CX = 150, ARC_CY = 185, ARC_R = 125;
const COLOR_RED   = '#E05C5C';
const COLOR_GREEN = '#4CAF50';
const PAGE_ROW_COUNT = 100;

const ENCODING_TOTAL      = 'total-count';
const ENCODING_NULL_COUNT = 'null-count';
const ENCODING_NULL_PCT   = 'null-pct';
const ENCODING_THRESHOLD  = 'threshold';

let activeWorksheet = null;
let renderRequestId = 0;
let hasRenderedOnce = false;

// ── Bootstrap ─────────────────────────────────────────────────────────────────
bootstrap();

function bootstrap() {
  if (!window.tableau?.extensions?.initializeAsync) {
    showEmptyState('Tableau Extensions API is unavailable.');
    return;
  }

  tableau.extensions.initializeAsync().then(() => {
    activeWorksheet = tableau.extensions.worksheetContent?.worksheet;
    if (!activeWorksheet) {
      throw new Error('This Viz Extension must be loaded inside a Tableau worksheet.');
    }

    activeWorksheet.addEventListener(
      tableau.TableauEventType.SummaryDataChanged,
      () => render(activeWorksheet)
    );

    // Re-render when the user changes field formatting on the Marks card
    if (tableau.TableauEventType.WorksheetFormattingChanged) {
      activeWorksheet.addEventListener(
        tableau.TableauEventType.WorksheetFormattingChanged,
        () => render(activeWorksheet)
      );
    }

    render(activeWorksheet);
  }).catch(err => {
    // Demo mode — not running inside Tableau
    console.info('[Gauge] Running in demo mode:', err.message);
    renderGauge(4700, 1410, 30.0, 25);
  });
}

// ── Render ────────────────────────────────────────────────────────────────────
async function render(worksheet) {
  const requestId = ++renderRequestId;

  try {
    const [vizSpec, dataTable] = await Promise.all([
      worksheet.getVisualSpecificationAsync(),
      fetchSummaryData(worksheet),
    ]);

    if (requestId !== renderRequestId) return;

    const marksSpec = getActiveMarksSpec(vizSpec);
    if (!marksSpec) {
      if (!hasRenderedOnce) showEmptyState('Drag fields to the Marks card encodings.');
      return;
    }

    const total     = getFirstValue(dataTable, marksSpec, ENCODING_TOTAL);
    const nullCount = getFirstValue(dataTable, marksSpec, ENCODING_NULL_COUNT);
    const nullPct   = getFirstValue(dataTable, marksSpec, ENCODING_NULL_PCT);
    const threshold = getFirstValue(dataTable, marksSpec, ENCODING_THRESHOLD);

    if (nullPct === null && total === null && nullCount === null) {
      if (!hasRenderedOnce) {
        showEmptyState('Map fields to the Total Count, Null Count, Null %, and Threshold encodings on the Marks card.');
      }
      return;
    }

    hideEmptyState();
    hasRenderedOnce = true;
    renderGauge(total, nullCount, nullPct, threshold);
  } catch (err) {
    // Keep previous gauge values visible; only show error on first load
    if (requestId === renderRequestId && !hasRenderedOnce) {
      showEmptyState('Map fields to the gauge encodings on the Marks card.');
    }
    console.warn('[Gauge] render error:', err.message || err);
  }
}

// ── Data fetching ─────────────────────────────────────────────────────────────
async function fetchSummaryData(worksheet) {
  const options = { ignoreSelection: true, applyWorksheetFormatting: true };
  const reader = await worksheet.getSummaryDataReaderAsync(PAGE_ROW_COUNT, options);
  try {
    if (typeof reader.getAllPagesAsync === 'function') {
      return await reader.getAllPagesAsync();
    }
    const pages = [];
    for (let i = 0; i < (reader.pageCount ?? 0); i++) {
      pages.push(await reader.getPageAsync(i));
    }
    return pages.length
      ? { columns: pages[0].columns ?? [], data: pages.flatMap(p => p.data ?? []) }
      : { columns: [], data: [] };
  } finally {
    await reader.releaseAsync();
  }
}

// ── Encoding helpers ──────────────────────────────────────────────────────────
function getActiveMarksSpec(vizSpec) {
  const specs = vizSpec?.marksSpecifications;
  if (Array.isArray(specs) && specs.length) {
    return specs[vizSpec.activeMarksSpecificationIndex ?? 0] ?? specs[0];
  }
  const legacy = vizSpec?.marksSpecificationCollection;
  return (Array.isArray(legacy) && legacy.length) ? legacy[0] : null;
}

function getEncodingFields(marksSpec, encodingId) {
  const id = encodingId.toLowerCase();
  const encodings = marksSpec.encodings ?? marksSpec.encodingCollection ?? [];
  const matched = encodings.filter(e => (e?.id ?? '').toLowerCase() === id);
  if (!matched.length) return [];
  return matched.flatMap(e => {
    const fields = [];
    if (Array.isArray(e.fields)) fields.push(...e.fields);
    else if (e.field) fields.push(...(Array.isArray(e.field) ? e.field : [e.field]));
    if (Array.isArray(e.fieldCollection)) fields.push(...e.fieldCollection);
    return fields.map(f =>
      typeof f === 'string'
        ? { id: f, name: f, fieldName: f }
        : { ...f, id: f.id ?? f.fieldId, name: f.name ?? f.fieldName ?? f.fieldCaption, fieldName: f.fieldName ?? f.name ?? f.fieldCaption }
    );
  });
}

function findColumnIndex(columns, fields) {
  if (!fields.length) return -1;
  const tokens = new Set(
    fields.flatMap(f => [f.id, f.fieldId, f.name, f.fieldName, f.fieldCaption])
      .filter(Boolean).map(s => s.trim().toLowerCase())
  );
  return columns.findIndex(c => {
    const colTokens = [c?.fieldId, c?.fieldName, c?.fieldCaption, c?.name, c?.caption]
      .filter(Boolean).map(s => s.trim().toLowerCase());
    return colTokens.some(t => tokens.has(t));
  });
}

function getFirstValue(dataTable, marksSpec, encodingId) {
  const fields = getEncodingFields(marksSpec, encodingId);
  if (!fields.length) return null;
  const columns = dataTable.columns ?? [];
  const colIdx = findColumnIndex(columns, fields);
  if (colIdx < 0) return null;
  const rows = dataTable.data ?? [];
  if (!rows.length) return null;
  const cell = rows[0][colIdx];
  // Prefer formattedValue so Tableau's number/percentage formatting is respected
  return cell?.formattedValue ?? cell?.value ?? cell?.nativeValue ?? null;
}

// ── Empty state ───────────────────────────────────────────────────────────────
function showEmptyState(msg) {
  const el = document.getElementById('empty-state');
  if (el) { el.textContent = msg; el.hidden = false; }
  const wrapper = document.getElementById('gauge-wrapper');
  if (wrapper) wrapper.hidden = true;
}

function hideEmptyState() {
  const el = document.getElementById('empty-state');
  if (el) el.hidden = true;
  const wrapper = document.getElementById('gauge-wrapper');
  if (wrapper) wrapper.hidden = false;
}

// ── Utility ───────────────────────────────────────────────────────────────────
function parseNum(raw) {
  if (raw == null || raw === '') return NaN;
  return parseFloat(String(raw).replace(/[^0-9.\-]/g, ''));
}

function fmtNum(n) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('en-US');
}

function fmtPct(n) {
  if (n == null || isNaN(n)) return '—';
  return parseFloat(n).toFixed(1) + '%';
}

// ── Threshold needle ──────────────────────────────────────────────────────────
function updateThresholdNeedle(threshold) {
  const needle = document.getElementById('threshold-needle');
  const dot    = document.getElementById('threshold-dot');
  const label  = document.getElementById('threshold-label');

  const t = parseNum(threshold);
  if (isNaN(t)) {
    needle.setAttribute('visibility', 'hidden');
    dot.setAttribute('visibility', 'hidden');
    label.setAttribute('visibility', 'hidden');
    return;
  }

  // θ: 180° at left endpoint → 360° at right endpoint
  const clamped = Math.max(0, Math.min(t, 100));
  const theta   = (180 + (clamped / 100) * 180) * (Math.PI / 180);
  const cosT    = Math.cos(theta);
  const sinT    = Math.sin(theta);

  const mx = ARC_CX + ARC_R * cosT;
  const my = ARC_CY + ARC_R * sinT;

  const innerLen = 15, outerLen = 15;
  needle.setAttribute('x1', (mx - cosT * innerLen).toFixed(2));
  needle.setAttribute('y1', (my - sinT * innerLen).toFixed(2));
  needle.setAttribute('x2', (mx + cosT * outerLen).toFixed(2));
  needle.setAttribute('y2', (my + sinT * outerLen).toFixed(2));
  needle.setAttribute('visibility', 'visible');

  dot.setAttribute('cx', mx.toFixed(2));
  dot.setAttribute('cy', my.toFixed(2));
  dot.setAttribute('visibility', 'visible');

  const labelR = ARC_R + 22;
  const lx = ARC_CX + labelR * cosT;
  const ly = ARC_CY + labelR * sinT;
  label.setAttribute('x', lx.toFixed(2));
  label.setAttribute('y', (ly + 4).toFixed(2));
  label.setAttribute('text-anchor', lx < ARC_CX - 8 ? 'end' : lx > ARC_CX + 8 ? 'start' : 'middle');
  label.textContent = `${parseFloat(t).toFixed(1)}%`;
  label.setAttribute('visibility', 'visible');
}

// ── Gauge rendering ───────────────────────────────────────────────────────────
function renderGauge(total, nullCount, nullPct, threshold) {
  const pct    = parseNum(nullPct);
  const thresh = parseNum(threshold);
  const isOver = !isNaN(pct) && !isNaN(thresh) && pct > thresh;
  const color  = isOver ? COLOR_RED : COLOR_GREEN;

  const clamped = isNaN(pct) ? 0 : Math.max(0, Math.min(pct, 100));
  const fillLen = (clamped / 100) * ARC_CIRCUMFERENCE;

  document.getElementById('fill-arc').setAttribute(
    'stroke-dasharray',
    `${fillLen.toFixed(2)} ${ARC_CIRCUMFERENCE.toFixed(2)}`
  );
  document.getElementById('fill-arc').setAttribute('stroke', color);

  const pctEl = document.getElementById('pct-text');
  pctEl.textContent = fmtPct(pct);
  pctEl.setAttribute('fill', color);

  document.getElementById('total-val').textContent   = fmtNum(parseNum(total));
  document.getElementById('invalid-val').textContent = fmtNum(parseNum(nullCount));
  document.getElementById('invalid-val').style.color = color;

  updateThresholdNeedle(threshold);
}
