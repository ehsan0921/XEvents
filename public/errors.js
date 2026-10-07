// Load before the app so startup and script-loading failures remain visible.
(() => {
  let latest = '', queued = false;
  const fallback = 'An unexpected app error occurred. Reopen the app and copy this message if it continues.';
  const publicScripts = new Set(['app.js', 'errors.js', 'gallery.js', 'event-actions.js', 'telegram-web-app.js']);
  const safe = value => String(value || 'Unexpected error. Please reopen the app.')
    .replace(/\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/g, '[hidden credential]')
    .replace(/(?:https?:)?\/\/[^\s"'<>]+/gi, '[hidden address]')
    .replace(/\b(?:tma|bearer)\s+[^\s]+/gi, '[hidden credential]')
    .replace(/\b(?:hash|initData|authorization|token)["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '[hidden credential]')
    .slice(0, 1200);
  function message(error) {
    if (typeof error === 'string') return error.trim() || fallback;
    if (error && typeof error === 'object') {
      for (const key of ['message', 'error']) if (typeof error[key] === 'string' && error[key].trim()) return error[key];
      return fallback;
    }
    return fallback;
  }
  function source(value) {
    // Only public asset names are useful here; paths, query strings and launch data are private.
    const basename = String(value || '').split(/[?#]/)[0].replace(/\\/g, '/').split('/').pop();
    return publicScripts.has(basename) ? basename : value ? 'script' : '';
  }
  function position(event) {
    const name = source(event.filename);
    if (!name) return '';
    const line = Number.isSafeInteger(event.lineno) && event.lineno > 0 ? event.lineno : null;
    const column = Number.isSafeInteger(event.colno) && event.colno > 0 ? event.colno : null;
    return '\nSource: ' + name + (line ? ':' + line + (column ? ':' + column : '') : '');
  }
  function render() {
    const panel = document.getElementById('app-error');
    if (!panel) {
      if (!queued) { queued = true; document.addEventListener('DOMContentLoaded', () => { queued = false; render(); }, {once:true}); }
      return;
    }
    document.getElementById('app-error-message').textContent = latest;
    panel.hidden = false;
    document.getElementById('app-error-dismiss').onclick = () => { panel.hidden = true; };
    document.getElementById('app-error-copy').onclick = async () => {
      try { await navigator.clipboard.writeText(latest); document.getElementById('app-error-copy').textContent = 'Copied'; }
      catch { document.getElementById('app-error-copy').textContent = 'Select the message to copy'; }
    };
    document.getElementById('app-error-copy').textContent = 'Copy error';
  }
  window.reportAppError = (error, context = '') => {
    latest = safe((context ? context + ': ' : '') + message(error));
    render();
  };
  window.addEventListener('error', event => {
    if (event.target?.tagName === 'SCRIPT') {
      const name = source(event.target.src);
      window.reportAppError('A required script could not load' + (name ? ' (' + name + ')' : '') + '. Check your connection and reopen the app.', 'Startup');
    } else if (event.message || event.error) {
      const detail = event.error?.message || event.message;
      const opaque = /^script error\.?$/i.test(String(detail || '').trim());
      window.reportAppError((opaque ? 'A Telegram or browser script failed, but the browser hid the details. Close and reopen the app. If it happens again, copy this message for support.' : message(detail || event.error)) + position(event), 'App error');
    }
  }, true);
  window.addEventListener('unhandledrejection', event => window.reportAppError(event.reason, 'App error'));
})();
