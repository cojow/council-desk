// Connectors (MCP servers): see which extra tools Claude can use, sign in to the ones
// that need it, and add or remove them. Changes apply to sessions started afterwards.
import { openModal } from './modal.js';
import { h } from './tools.js';

const STATE_TEXT = { connected: 'Connected', 'needs-auth': 'Needs sign-in', failed: "Can't connect", pending: 'Waiting for your approval (off until then)', approved: 'Approved', disabled: 'Off', unknown: '' };
const SCOPE_TEXT = { user: 'All projects', local: 'This project, just you', project: 'This project, shared' };
const clean = (message) => String(message || '').replace(/^Error invoking remote method '[^']+': Error: /, '');

export function openConnectorsPanel({ api, cwd }) {
  const listEl = h('div', { class: 'connector-list' }, h('div', { class: 'muted viewer-note' }, 'Checking connectors… (Claude Code tests each one; a few seconds)'));
  const formEl = h('div', { class: 'prompt-form', hidden: true });
  const status = h('div', { class: 'settings-hint connector-status' });

  // Listing takes seconds and refreshes can overlap (remove one, then another); only the
  // newest may fill the list, or an older one could show a connector you just removed.
  let latest = 0;
  async function refresh() {
    const ticket = ++latest;
    let connectors;
    try {
      connectors = await api.mcp.list(cwd);
    } catch (error) {
      if (ticket === latest) listEl.replaceChildren(h('div', { class: 'note error viewer-note' }, `Couldn't list connectors: ${clean(error.message)}`));
      return;
    }
    if (ticket !== latest) return;
    const row = (c) => {
      const actions = [];
      if (c.state === 'needs-auth') actions.push(h('button', { class: 'btn', onclick: () => signIn(c) }, 'Sign in'));
      if (c.state === 'pending') actions.push(h('button', { class: 'btn', title: 'Shared connectors from the project only run once you approve them', onclick: () => approve(c) }, 'Approve'));
      if (c.state === 'connected' && c.remote) actions.push(h('button', { class: 'btn link', onclick: () => signOut(c) }, 'Sign out'));
      actions.push(h('button', { class: 'btn link danger-link', onclick: () => remove(c) }, 'Remove'));
      return h(
        'div',
        { class: 'connector-row' },
        h('span', { class: `state-dot ${c.state}`, title: c.statusText }),
        h(
          'div',
          { class: 'prompt-text' },
          h('span', { class: 'connector-name' }, c.label, h('span', { class: 'scope-tag' }, SCOPE_TEXT[c.scope])),
          h('span', { class: 'settings-hint', title: c.target }, `${STATE_TEXT[c.state] || c.statusText} · ${c.target}`),
        ),
        ...actions,
      );
    };
    listEl.replaceChildren(
      h('div', { class: 'usage-section' }, `Your connectors (${connectors.length})`),
      ...(connectors.length ? connectors.map(row) : [h('div', { class: 'settings-hint' }, 'None yet.')]),
      h('button', { class: 'btn add-connector', onclick: showForm }, '+ Add a connector'),
    );
  }

  async function signIn(c) {
    status.textContent = `Finish signing in to ${c.label} in your browser…`;
    const result = await api.mcp.login(c.name, cwd);
    status.textContent = result.ok ? `Signed in to ${c.label}.` : `Sign-in didn't finish${result.message ? `: ${result.message}` : '.'}`;
    refresh();
  }

  async function approve(c) {
    try {
      await api.mcp.approve(c.name, cwd);
      status.textContent = `Approved ${c.label} for this project.`;
    } catch (error) {
      status.textContent = clean(error.message);
    }
    refresh();
  }

  async function signOut(c) {
    await api.mcp.logout(c.name, cwd).catch((e) => (status.textContent = clean(e.message)));
    refresh();
  }

  async function remove(c) {
    try {
      await api.mcp.remove(c.name, c.scope, cwd);
      status.textContent = `Removed ${c.label}.`;
    } catch (error) {
      status.textContent = clean(error.message);
    }
    refresh();
  }

  function showForm() {
    const name = h('input', { type: 'text', placeholder: 'sentry' });
    const kind = h('select', {}, h('option', { value: 'http' }, 'Web address (URL)'), h('option', { value: 'stdio' }, 'Program on this Mac (command)'));
    const target = h('input', { type: 'text', placeholder: 'https://mcp.example.com/mcp' });
    const args = h('input', { type: 'text', placeholder: 'Arguments, separated by spaces (optional)', hidden: true });
    const extra = h('textarea', { class: 'memory-text', rows: 3, placeholder: 'Headers, one per line (optional), e.g. Authorization: Bearer …' });
    const scope = h(
      'select',
      {},
      h('option', { value: 'user' }, 'All projects'),
      cwd ? h('option', { value: 'local' }, 'This project, just you') : null,
      cwd ? h('option', { value: 'project' }, 'This project, shared (.mcp.json)') : null,
    );
    const error = h('div', { class: 'note error', hidden: true });
    kind.addEventListener('change', () => {
      const local = kind.value === 'stdio';
      target.placeholder = local ? 'npx -y @modelcontextprotocol/server-filesystem' : 'https://mcp.example.com/mcp';
      args.hidden = !local;
      extra.placeholder = local ? 'Environment variables, one per line (optional), e.g. API_KEY=…' : 'Headers, one per line (optional), e.g. Authorization: Bearer …';
    });
    formEl.replaceChildren(
      h('label', { class: 'field' }, h('span', {}, 'Name'), name),
      h('label', { class: 'field' }, h('span', {}, 'Type'), kind),
      h('label', { class: 'field' }, h('span', {}, 'URL or command'), target, args),
      h('label', { class: 'field' }, h('span', {}, 'Headers or environment variables'), extra),
      h('label', { class: 'field' }, h('span', {}, 'Use it in'), scope),
      h('div', { class: 'settings-hint' }, 'Only add connectors you trust: they can see what Claude sends them, and local ones run programs on your Mac. Web connectors that need an account show "Sign in" after adding.'),
      error,
      h(
        'div',
        { class: 'settings-actions' },
        h(
          'button',
          {
            class: 'btn primary',
            onclick: async () => {
              const lines = extra.value.split('\n').map((l) => l.trim()).filter(Boolean);
              const local = kind.value === 'stdio';
              const [command, ...commandArgs] = target.value.trim().split(/\s+/);
              try {
                await api.mcp.add(
                  {
                    name: name.value,
                    transport: kind.value,
                    target: local ? command : target.value.trim(),
                    args: local ? [...commandArgs, ...args.value.trim().split(/\s+/).filter(Boolean)] : [],
                    env: local ? lines : [],
                    headers: local ? [] : lines,
                    scope: scope.value,
                  },
                  cwd,
                );
                formEl.hidden = true;
                listEl.hidden = false;
                status.textContent = `Added ${name.value}. New sessions can use it.`;
                listEl.replaceChildren(h('div', { class: 'muted viewer-note' }, 'Checking connectors…'));
                refresh();
              } catch (e) {
                error.textContent = clean(e.message);
                error.hidden = false;
              }
            },
          },
          'Add connector',
        ),
        h('button', { class: 'btn', onclick: () => ((formEl.hidden = true), (listEl.hidden = false)) }, 'Back'),
      ),
    );
    listEl.hidden = true;
    formEl.hidden = false;
    name.focus();
  }

  openModal({
    title: 'Connectors',
    wide: true,
    body: h(
      'div',
      {},
      h('div', { class: 'settings-hint' }, 'Extra tools Claude can use, like PubMed or Notion. Changes apply to sessions you start afterwards.'),
      status,
      listEl,
      formEl,
    ),
    actions: [{ label: 'Done' }],
  });
  refresh();
}
