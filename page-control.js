// ---------- Page controls ------------

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

  // ---------- Light / dark theme toggle ----------

  const themeBtn = document.getElementById('theme-toggle');
  const themeIcon = document.getElementById('theme-toggle-icon');
  const themeLabel = document.getElementById('theme-toggle-label');

  function applyThemeUI(theme){
    if (themeIcon) themeIcon.innerHTML = theme === 'light' ? '&#9788;' : '&#9789;';
    if (themeLabel) themeLabel.textContent = theme === 'light' ? 'Light' : 'Dark';
  }

  // Sync button label with whatever the pre-body script already applied (avoids flash).
  applyThemeUI(document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');

  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const isLight = document.documentElement.getAttribute('data-theme') === 'light';
      const next = isLight ? 'dark' : 'light';
      if (next === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
      } else {
        document.documentElement.removeAttribute('data-theme');
      }
      applyThemeUI(next);
      try { localStorage.setItem('pce-theme', next); } catch (e) { /* storage unavailable — theme just won't persist */ }
    });
  }
