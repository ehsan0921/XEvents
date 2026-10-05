// Load before the app so startup and script-loading failures remain visible.
(() => {
  let latest = '', queued = false;
  const safe = value => String(value || 'Unexpected error. Please reopen the app.')
    .replace(/\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/g, '[hidden credential]')
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[hidden address]')
    .replace(/(?:tma\s+|(?:hash|initData|authorization|token)=)[^\s]+/gi, '[hidden credential]')
    .slice(0, 1200);
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
    latest = safe((context ? context + ': ' : '') + (error?.message || error));
    render();
  };
  window.addEventListener('error', event => {
    if (event.target?.tagName === 'SCRIPT') window.reportAppError('A required script could not load. Check your connection and reopen the app.', 'Startup');
    else if (event.message) window.reportAppError(event.message, 'App error');
  }, true);
  window.addEventListener('unhandledrejection', event => window.reportAppError(event.reason, 'App error'));
})();
