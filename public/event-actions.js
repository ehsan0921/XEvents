export function setupEventActions({ $, api, refresh, onEnded = () => {}, notice }) {
  const dialog = $('event-end-dialog');
  const proceed = $('event-end-confirm');
  const back = $('event-end-back');
  const remove = $('event-end-delete');
  const status = $('event-end-status');
  let active = null;

  function setBusy(busy) {
    proceed.disabled = busy;
    back.disabled = busy;
    remove.disabled = busy;
    dialog.setAttribute('aria-busy', String(busy));
  }

  function open(event, deleting) {
    if (!event?.isOwner || (!deleting && event.cancelled) || active || dialog.open) return Promise.resolve(false);
    $('event-end-title').textContent = deleting ? 'Delete event?' : 'Cancel event?';
    $('event-end-name').textContent = event.title;
    $('event-end-message').textContent = deleting
      ? 'Permanently remove this event, responses and media references? Accepted and tentative guests will be notified. Previously sent Telegram copies remain.'
      : 'Accepted and tentative guests will be notified. Keep its stored record or delete it. The event will disappear from active lists.';
    $('event-end-delete-option').hidden = deleting;
    remove.checked = false;
    status.textContent = '';
    status.hidden = true;
    proceed.textContent = deleting ? '🗑 Delete event' : '🚫 Cancel event';
    remove.onchange = () => { proceed.textContent = deleting ? '🗑 Delete event' : remove.checked ? '🗑 Cancel & delete' : '🚫 Cancel event'; };
    setBusy(false);

    return new Promise(resolve => {
      const session = { busy: false, settled: false, completed: false, closed: false };
      active = session;
      const finish = result => {
        if (session.settled) return;
        session.settled = true;
        if (dialog.open) dialog.close();
        else if (session.closed && active === session) active = null;
        resolve(result);
      };
      back.onclick = () => { if (!session.busy) finish(false); };
      dialog.oncancel = event => {
        event.preventDefault();
        if (!session.busy) finish(false);
      };
      dialog.onclose = () => {
        if (active !== session) return;
        session.closed = true;
        if (session.busy) return;
        active = null;
        if (!session.settled) finish(session.completed);
      };
      proceed.onclick = async () => {
        if (session.busy || session.settled || active !== session) return;
        session.busy = true;
        setBusy(true);
        status.textContent = '';
        status.hidden = true;
        const operation = deleting || remove.checked ? 'delete' : 'cancel';
        try {
          await api(`events/${event.id}/${operation}`, { confirm: true });
        } catch (error) {
          session.busy = false;
          setBusy(false);
          if (!dialog.open) {
            notice(error.message);
            finish(false);
          } else {
            status.textContent = error.message;
            status.hidden = false;
          }
          return;
        }
        session.completed = true;
        const message = operation === 'delete'
          ? 'Event deleted. Accepted and tentative guests notified.'
          : 'Event cancelled. Accepted and tentative guests notified.';
        let refreshError;
        try { await refresh(); } catch (error) { refreshError = error; }
        try { await onEnded(event, operation); } catch (error) { refreshError ||= error; }
        notice(message + (refreshError ? ' Could not refresh: ' + refreshError.message : ''));
        session.busy = false;
        setBusy(false);
        finish(true);
      };
      try {
        dialog.showModal();
        back.focus();
      } catch (error) {
        active = null;
        notice(error.message);
        finish(false);
      }
    });
  }

  return {
    cancelEvent: event => open(event, false),
    deleteEvent: event => open(event, true)
  };
}
