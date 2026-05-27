'use strict';

// ── Constants ─────────────────────────────────────────────────────────────────
const ARC_CIRCUMFERENCE = Math.PI * 125; // semicircle r=125 ≈ 392.70
const ARC_CX = 150, ARC_CY = 185, ARC_R = 125;
const COLOR_RED   = '#E05C5C';
const COLOR_GREEN = '#4CAF50';

const SETTING_KEYS = ['totalCountParam', 'nullCountParam', 'nullPctParam', 'thresholdParam'];
const SEL_IDS      = ['sel-total', 'sel-null-count', 'sel-null-pct', 'sel-threshold'];

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

function hasValidSettings(s) {
  return SETTING_KEYS.every(k => s[k] && s[k].trim() !== '');
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

  // θ: 180° at left endpoint → 360° at right endpoint (sweep-flag=1, CW in SVG)
  const clamped = Math.max(0, Math.min(t, 100));
  const theta   = (180 + (clamped / 100) * 180) * (Math.PI / 180);
  const cosT    = Math.cos(theta);
  const sinT    = Math.sin(theta);

  // Midpoint on the arc surface
  const mx = ARC_CX + ARC_R * cosT;
  const my = ARC_CY + ARC_R * sinT;

  // Needle: 15px inside arc → 15px outside arc (crosses the stroke)
  const innerLen = 15, outerLen = 15;
  needle.setAttribute('x1', (mx - cosT * innerLen).toFixed(2));
  needle.setAttribute('y1', (my - sinT * innerLen).toFixed(2));
  needle.setAttribute('x2', (mx + cosT * outerLen).toFixed(2));
  needle.setAttribute('y2', (my + sinT * outerLen).toFixed(2));
  needle.setAttribute('visibility', 'visible');

  // Dot at arc midpoint
  dot.setAttribute('cx', mx.toFixed(2));
  dot.setAttribute('cy', my.toFixed(2));
  dot.setAttribute('visibility', 'visible');

  // Label: 22px outside the arc midline
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

// ── Tableau parameter loading ─────────────────────────────────────────────────

let _unlisteners = [];

async function loadData(settings) {
  _unlisteners.forEach(fn => fn());
  _unlisteners = [];

  const dash = tableau.extensions.dashboardContent.dashboard;

  const [pTotal, pNullCount, pNullPct, pThreshold] = await Promise.all([
    dash.findParameterAsync(settings.totalCountParam),
    dash.findParameterAsync(settings.nullCountParam),
    dash.findParameterAsync(settings.nullPctParam),
    dash.findParameterAsync(settings.thresholdParam),
  ]);

  function currentValues() {
    return {
      total:     pTotal?.currentValue.value,
      nullCount: pNullCount?.currentValue.value,
      nullPct:   pNullPct?.currentValue.value,
      threshold: pThreshold?.currentValue.value,
    };
  }

  const v = currentValues();
  renderGauge(v.total, v.nullCount, v.nullPct, v.threshold);

  [pTotal, pNullCount, pNullPct, pThreshold].forEach(param => {
    if (!param) return;
    const token = param.addEventListener(
      tableau.TableauEventType.ParameterChanged,
      () => {
        const vals = currentValues();
        renderGauge(vals.total, vals.nullCount, vals.nullPct, vals.threshold);
      }
    );
    _unlisteners.push(() => param.removeEventListener(token));
  });
}

// ── Config modal ──────────────────────────────────────────────────────────────

async function showConfig() {
  document.getElementById('config-modal').classList.remove('hidden');
  const noParamsMsg = document.getElementById('no-params-msg');

  try {
    const dash   = tableau.extensions.dashboardContent.dashboard;
    const params = await dash.getParametersAsync();
    const saved  = tableau.extensions.settings.getAll();

    noParamsMsg.style.display = params.length === 0 ? 'block' : 'none';

    SEL_IDS.forEach((selId, i) => {
      const sel = document.getElementById(selId);
      sel.innerHTML = '<option value="">— select parameter —</option>';
      params.forEach(p => {
        const opt       = document.createElement('option');
        opt.value       = p.name;
        opt.textContent = p.name;
        if (saved[SETTING_KEYS[i]] === p.name) opt.selected = true;
        sel.appendChild(opt);
      });
    });
  } catch (err) {
    console.warn('Could not load parameters:', err);
    noParamsMsg.style.display = 'block';
  }
}

function hideConfig() {
  document.getElementById('config-modal').classList.add('hidden');
}

async function saveConfig() {
  const settings = tableau.extensions.settings;
  SEL_IDS.forEach((selId, i) => {
    settings.set(SETTING_KEYS[i], document.getElementById(selId).value);
  });
  await settings.saveAsync();
  hideConfig();

  const saved = settings.getAll();
  if (hasValidSettings(saved)) {
    await loadData(saved);
  }
}

// ── Event wiring ──────────────────────────────────────────────────────────────

document.getElementById('gear-btn').addEventListener('click', showConfig);
document.getElementById('cancel-btn').addEventListener('click', hideConfig);
document.getElementById('save-btn').addEventListener('click', saveConfig);

document.getElementById('config-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) hideConfig();
});

// ── Initialization ────────────────────────────────────────────────────────────

(async () => {
  try {
    await tableau.extensions.initializeAsync({ configure: showConfig });

    const saved = tableau.extensions.settings.getAll();
    if (hasValidSettings(saved)) {
      await loadData(saved);
    } else {
      showConfig();
    }
  } catch (err) {
    // Demo mode — not running inside Tableau
    console.info('[Gauge] Running in demo mode (not connected to Tableau).');
    document.getElementById('gear-btn').style.display = 'none';
    renderGauge(4700, 1410, 30.0, 25);
  }
})();
