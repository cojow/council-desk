import test from 'node:test';
import { moduleURL, sandbox, succeeds } from './helpers/index.mjs';

// The page-reading script from the Browser pane, run against a small stand-in for a page.
test('reading a page never gives Claude a password or other sensitive value', (t) => {
  const s = sandbox(t);
  succeeds(s.evaluate(`
    const vm = await import('node:vm');
    const { READ_PAGE } = await import(${JSON.stringify(moduleURL('src/main/browser.js'))});
    const field = (attrs, value) => ({
      tagName: 'INPUT', type: attrs.type || 'text', value, labels: [], innerText: '', checked: false,
      getAttribute: (name) => attrs[name] ?? null, setAttribute() {},
      getBoundingClientRect: () => ({ width: 10, height: 10, top: 0, bottom: 10 }),
    });
    const fields = [
      field({ type: 'password' }, 'FAKE_SECRET_1'),
      field({ autocomplete: 'current-password' }, 'FAKE_SECRET_2'),
      field({ autocomplete: 'cc-number' }, 'FAKE_SECRET_3'),
      field({ autocomplete: 'one-time-code' }, 'FAKE_SECRET_4'),
      field({ placeholder: 'Search' }, 'ordinary text'),
    ];
    const result = vm.runInNewContext(READ_PAGE, {
      document: { querySelectorAll: (selector) => (selector === '[data-claude-ref]' ? [] : fields), title: 'Page', body: { innerText: 'Hello' }, documentElement: { scrollHeight: 100 } },
      getComputedStyle: () => ({ visibility: 'visible', display: 'block', opacity: '1' }),
      location: { href: 'https://example.com/' }, innerHeight: 100, scrollY: 0,
    });
    const shown = JSON.stringify(result);
    assert.doesNotMatch(shown, /FAKE_SECRET/);
    assert.match(shown, /filled in/);
    assert.match(shown, /ordinary text/);
  `, { stubModules: true }));
});

test('clicking a filled password field does not report its value', (t) => {
  const s = sandbox(t);
  succeeds(s.evaluate(`
    const vm = await import('node:vm');
    const { LOCATE } = await import(${JSON.stringify(moduleURL('src/main/browser.js'))});
    const el = {
      tagName: 'INPUT', type: 'password', value: 'FAKE_SECRET', innerText: '',
      getAttribute: () => null, scrollIntoView() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 10, height: 10 }),
    };
    const result = vm.runInNewContext(LOCATE(1), { document: { querySelector: () => el } });
    assert.doesNotMatch(JSON.stringify(result), /FAKE_SECRET/);
  `, { stubModules: true }));
});
