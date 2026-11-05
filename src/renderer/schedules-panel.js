// Scheduled tasks: prompts the app runs by itself on a schedule, in a project folder.
// Lists them with their next and last run; add, edit, pause, run now or delete.
import { openModal } from './modal.js';
import { base, h } from './tools.js';
import { trustDetails } from './trust-dialog.js';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const clean = (message) => String(message || '').replace(/^Error invoking remote method '[^']+': Error: /, '');

const timeText = (hhmm) => new Date(2000, 0, 1, ...hhmm.split(':').map(Number)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function scheduleText({ every, time, weekday }) {
  if (every === 'hour') return `Every hour at :${time.split(':')[1]}`;
  if (every === 'day') return `Every day at ${timeText(time)}`;
  if (every === 'weekdays') return `Weekdays at ${timeText(time)}`;
  return `${WEEKDAYS[weekday ?? 1]}s at ${timeText(time)}`;
}

const when = (ts) => {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toDateString() === d.toDateString();
  const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return `today ${t}`;
  if (tomorrow) return `tomorrow ${t}`;
  return `${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} ${t}`;
};

// cwd: folder for new tasks. onOpenSession(sessionId, cwd): open a run's session.
// subscribe(fn): listen to scheduler events; returns a function that stops listening.
export function openSchedulesPanel({ api, cwd, models = [], onOpenSession, subscribe }) {
  const listEl = h('div', { class: 'prompt-list' });
  const formEl = h('div', { class: 'prompt-form', hidden: true });

  async function renderList() {
    const tasks = await api.schedules.list();
    listEl.replaceChildren(
      ...(tasks.length
        ? tasks.map((t) => {
            const status = t.running
              ? 'Running now…'
              : !t.enabled
                ? 'Paused'
                : `Next: ${when(t.nextAt)}`;
            const last = t.last ? `Last: ${t.last.ok ? '✓' : '✗'} ${when(t.last.at)}` : 'Not run yet';
            return h(
              'div',
              { class: 'prompt-row schedule-row' },
              h(
                'div',
                { class: 'prompt-text' },
                h('span', { class: 'prompt-name' }, t.name),
                h('span', { class: 'settings-hint' }, `${scheduleText(t.schedule)} · ${base(t.cwd)} · ${status}`),
                h('span', { class: `settings-hint${t.last && !t.last.ok ? ' schedule-failed' : ''}`, title: t.last?.summary || '' }, `${last}${t.last?.summary ? ` — ${t.last.summary.replace(/\s+/g, ' ').slice(0, 90)}` : ''}`),
              ),
              t.last?.sessionId ? h('button', { class: 'btn link', onclick: () => onOpenSession?.(t.last.sessionId, t.cwd) }, 'Open') : null,
              t.running
                ? h('button', { class: 'btn link', onclick: () => api.schedules.stop(t.id) }, 'Stop')
                : h('button', { class: 'btn link', onclick: () => api.schedules.run(t.id) }, 'Run now'),
              h('button', { class: 'btn link', onclick: () => api.schedules.setEnabled(t.id, !t.enabled) }, t.enabled ? 'Pause' : 'Resume'),
              h('button', { class: 'btn link', onclick: () => showForm(t) }, 'Edit'),
              h(
                'button',
                {
                  class: 'btn link danger-link',
                  onclick: () => confirm(`Delete the scheduled task "${t.name}"? Sessions from earlier runs are kept.`) && api.schedules.remove(t.id),
                },
                'Delete',
              ),
            );
          })
        : [h('div', { class: 'settings-hint' }, 'No scheduled tasks yet.')]),
      h('button', { class: 'btn', onclick: () => showForm(null) }, '+ New scheduled task'),
    );
  }

  function showForm(task) {
    let folder = task?.cwd || cwd || '';
    const error = h('div', { class: 'note error', hidden: true });
    const trustBox = h('div', { class: 'note', hidden: true });
    const name = h('input', { type: 'text', value: task?.name || '', placeholder: 'Weekly literature check' });
    const prompt = h('textarea', { class: 'memory-text', rows: 7, placeholder: 'Search PubMed for papers from the past week on … and summarize the three most relevant, with links.' });
    prompt.value = task?.prompt || '';
    const folderLabel = h('span', { class: 'schedule-folder' }, folder ? base(folder) : 'No folder chosen');
    folderLabel.title = folder;
    const folderButton = h(
      'button',
      {
        class: 'btn',
        onclick: async () => {
          const picked = await api.folders.pick();
          if (!picked) return;
          folder = picked;
          trustBox.hidden = true;
          folderLabel.textContent = base(folder);
          folderLabel.title = folder;
        },
      },
      'Choose…',
    );
    const every = h(
      'select',
      {},
      h('option', { value: 'day' }, 'Every day'),
      h('option', { value: 'weekdays' }, 'Weekdays (Monday–Friday)'),
      h('option', { value: 'week' }, 'Once a week'),
      h('option', { value: 'hour' }, 'Every hour'),
    );
    every.value = task?.schedule.every || 'day';
    const time = h('input', { type: 'time', value: task?.schedule.time || '09:00' });
    const weekday = h('select', {}, WEEKDAYS.map((d, i) => h('option', { value: String(i) }, d)));
    weekday.value = String(task?.schedule.weekday ?? 1);
    const timeField = h('label', { class: 'field' }, h('span', {}, 'At'), time);
    const dayField = h('label', { class: 'field' }, h('span', {}, 'On'), weekday);
    const syncFields = () => {
      dayField.hidden = every.value !== 'week';
      timeField.firstChild.textContent = every.value === 'hour' ? 'At this many minutes past each hour (the hour is ignored)' : 'At';
    };
    every.addEventListener('change', syncFields);
    syncFields();
    const model = h('select', {}, h('option', { value: '' }, 'Default model'), models.map((m) => h('option', { value: m.value }, m.displayName || m.value)));
    model.value = task?.model || '';
    const edits = h('select', {}, h('option', { value: '' }, "Only what your permission rules allow (it can read, but won't edit or run commands that ask)"), h('option', { value: 'edits' }, 'Also edit files in the folder'));
    edits.value = task?.edits ? 'edits' : '';

    async function save() {
      try {
        // A task runs unattended, so its folder must be trusted; ask here, inside this dialog.
        const check = folder ? await api.trust.check(folder) : { trusted: true };
        if (!check.trusted) {
          error.hidden = true;
          trustBox.replaceChildren(
            h('div', { class: 'modal-title' }, 'Do you trust this folder?'),
            trustDetails(folder, check.details),
            h('button', { class: 'btn primary', onclick: async () => (await api.trust.grant(folder), (trustBox.hidden = true), save()) }, 'Trust folder and save'),
          );
          trustBox.hidden = false;
          return;
        }
        await api.schedules.save({
          id: task?.id,
          enabled: task?.enabled ?? true,
          name: name.value,
          prompt: prompt.value,
          cwd: folder,
          model: model.value,
          edits: edits.value === 'edits',
          schedule: { every: every.value, time: time.value, weekday: Number(weekday.value) },
        });
        formEl.hidden = true;
        listEl.hidden = false;
      } catch (e) {
        error.textContent = clean(e.message);
        error.hidden = false;
      }
    }

    formEl.replaceChildren(
      h('label', { class: 'field' }, h('span', {}, 'Name'), name),
      h('label', { class: 'field' }, h('span', {}, 'Prompt'), prompt),
      h('div', { class: 'field' }, h('span', {}, 'Project folder'), h('div', { class: 'schedule-folder-row' }, folderLabel, folderButton)),
      h('div', { class: 'schedule-when' }, h('label', { class: 'field' }, h('span', {}, 'Repeat'), every), dayField, timeField),
      h('label', { class: 'field' }, h('span', {}, 'Model'), model),
      h('label', { class: 'field' }, h('span', {}, 'Permissions'), edits),
      h(
        'div',
        { class: 'settings-hint' },
        "Runs while Council Desk is open (turn on Keep running in Settings to leave it in the menu bar) and the Mac is awake. A run missed while it was closed happens once when it opens. Nobody can approve anything during a run, so commands that would ask are skipped; add rules in Permission rules to allow specific ones. Each run is billed like any other session.",
      ),
      error,
      trustBox,
      h(
        'div',
        { class: 'settings-actions' },
        h('button', { class: 'btn primary', onclick: () => save() }, task ? 'Save' : 'Add task'),
        h('button', { class: 'btn', onclick: () => ((formEl.hidden = true), (listEl.hidden = false)) }, 'Back'),
      ),
    );
    listEl.hidden = true;
    formEl.hidden = false;
    name.focus();
  }

  const refresh = () => renderList();
  const off = subscribe?.((event) => (event.type === 'changed' || event.type === 'finished') && refresh());
  openModal({
    title: 'Scheduled tasks',
    wide: true,
    body: h('div', {}, h('div', { class: 'settings-hint' }, 'Prompts Claude runs by itself on a schedule. Each run shows up as a session, and you get a notification when it finishes.'), listEl, formEl),
    actions: [{ label: 'Done' }],
    onClose: () => off?.(),
  });
  renderList();
}
