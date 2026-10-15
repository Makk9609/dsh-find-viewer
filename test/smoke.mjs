/**
 * Smoke test: loads the client half with stubs and checks the registration path plus the
 * pure logic (matching, address decoding, emitted highlight colours).
 *
 *   node test/smoke.mjs
 *
 * Not covered here: React rendering and interaction with the live document preview; those
 * need a running harness and are described in the README's verification section.
 */
const registrations = [];
globalThis.window = {
  __ModuleLoader__: {
    load(registration) {
      registrations.push(registration);
    },
  },
  clearTimeout,
  setTimeout,
};

const React = {
  createElement: () => null,
  Fragment: Symbol('Fragment'),
  useState: () => [undefined, () => {}],
  useRef: () => ({ current: null }),
  useEffect: () => {},
  useCallback: (fn) => fn,
};

await import('../client.js');

let failures = 0;
function check(what, condition, detail) {
  if (condition) {
    console.log(`ok    ${what}`);
    return;
  }
  failures += 1;
  console.log(`FAIL  ${what}${detail === undefined ? '' : ` — ${detail}`}`);
}

check('registers exactly one client module', registrations.length === 1, `got ${registrations.length}`);
const registration = registrations[0];
check('module id equals the package name', registration.id === 'dsh-find-viewer', String(registration.id));

const plugin = registration.factory((name) => {
  if (name === 'react') return React;
  throw new Error(`unexpected require("${name}")`);
});

check('exports the inject list', Array.isArray(plugin.inject) && plugin.inject.includes('slots') && plugin.inject.includes('locale'), JSON.stringify(plugin.inject));
check('exports apply()', typeof plugin.apply === 'function');

const locales = [];
const injections = [];
const registered = [];
let effectCount = 0;
const ctx = {
  effect(fn) {
    effectCount += 1;
    return fn();
  },
  locale: {
    register(ns, locale, dict) {
      locales.push({ ns, locale, keys: Object.keys(dict).sort() });
      return () => {};
    },
    bind: (ns) => (key, params) => (params === undefined ? `${ns}:${key}` : `${ns}:${key}:${JSON.stringify(params)}`),
  },
  slots: {
    inject(key, callback) {
      injections.push(key);
      return callback();
    },
    register(options, component) {
      registered.push({ options, component });
      return () => {};
    },
  },
  sidebarRight: { openResource() {} },
  remote: { workspaceFiles: { read: async () => ({}) } },
};

plugin.apply(ctx);

check('registers both dictionaries', locales.length === 2 && locales.some((l) => l.locale === 'zh') && locales.some((l) => l.locale === 'en'), JSON.stringify(locales.map((l) => l.locale)));
const zhKeys = locales.find((l) => l.locale === 'zh')?.keys ?? [];
const enKeys = locales.find((l) => l.locale === 'en')?.keys ?? [];
check('dictionaries share one key set', zhKeys.length > 0 && zhKeys.join('|') === enKeys.join('|'), `zh=${zhKeys.length} en=${enKeys.length}`);
check('injects the additive toolbar list slot', injections.length === 1 && injections[0] === 'sidebar.right.tab.document.actions', JSON.stringify(injections));
check('registers an appended list entry', registered.length === 1 && registered[0].options.id === 'find-viewer' && registered[0].options.order === 10 && registered[0].options.name === 'sidebar.right.tab.document.actions', JSON.stringify(registered[0]?.options ?? null));
check('registers a component function', typeof registered[0]?.component === 'function');
check('apply installs three effects', effectCount === 3, `got ${effectCount}`);

const { buildMatcher, matchLines, decodeAddress, styleText } = plugin.__test;
const hits = (query, text, caseSensitive = false, wholeWord = false) => buildMatcher(query, caseSensitive, wholeWord)(text);

check('matches case-insensitively by default', JSON.stringify(hits('foo', 'Foo foo')) === JSON.stringify([{ col: 0, len: 3 }, { col: 4, len: 3 }]), JSON.stringify(hits('foo', 'Foo foo')));
check('honours match case', JSON.stringify(hits('foo', 'Foo foo', true)) === JSON.stringify([{ col: 4, len: 3 }]), JSON.stringify(hits('foo', 'Foo foo', true)));
check('whole word skips longer words', JSON.stringify(hits('foo', 'foo foobar foo', false, true)) === JSON.stringify([{ col: 0, len: 3 }, { col: 11, len: 3 }]), JSON.stringify(hits('foo', 'foo foobar foo', false, true)));
check('whole word uses letter-class boundaries for CJK', JSON.stringify(hits('中文', '中文测试 中文', false, true)) === JSON.stringify([{ col: 5, len: 2 }]), JSON.stringify(hits('中文', '中文测试 中文', false, true)));
check('treats regex metacharacters literally', JSON.stringify(hits('a.c', 'a.c abc')) === JSON.stringify([{ col: 0, len: 3 }]), JSON.stringify(hits('a.c', 'a.c abc')));
check('empty query has no matcher', buildMatcher('', false, false) === null);
check('counts across lines with source line numbers', JSON.stringify(matchLines(['a foo', 'foo'], buildMatcher('foo', false, false), 10)) === JSON.stringify([{ line: 1, col: 2, len: 3 }, { line: 2, col: 0, len: 3 }]), JSON.stringify(matchLines(['a foo', 'foo'], buildMatcher('foo', false, false), 10)));
check('caps the match list', matchLines(['foo', 'foo', 'foo'], buildMatcher('foo', false, false), 2).length === 2);

check('decodes a workspace-relative address', JSON.stringify(decodeAddress('dsh-resource://file/session/s%201/src/a%20b.ts')) === JSON.stringify({ sessionId: 's 1', path: 'src/a b.ts' }), JSON.stringify(decodeAddress('dsh-resource://file/session/s%201/src/a%20b.ts')));
check('decodes an absolute path address', JSON.stringify(decodeAddress('dsh-resource://file/session/s1//Users/mai/x.txt')) === JSON.stringify({ sessionId: 's1', path: '/Users/mai/x.txt' }), JSON.stringify(decodeAddress('dsh-resource://file/session/s1//Users/mai/x.txt')));
check('strips a line-number suffix', JSON.stringify(decodeAddress('dsh-resource://file/session/s1/a.ts#L42')) === JSON.stringify({ sessionId: 's1', path: 'a.ts' }), JSON.stringify(decodeAddress('dsh-resource://file/session/s1/a.ts#L42')));
check('rejects a non-session address', decodeAddress('dsh-resource://file/absolute/tmp/x') === null);
check('rejects a non-file address', decodeAddress('dsh-resource://session/s1') === null);

const css = styleText({ match: 'm', current: 'c' });
check('paints hits yellow', css.includes('::highlight(m){background-color:#ffff00;color:#000000}'), css);
check('paints the current hit orange', css.includes('::highlight(c){background-color:#ff9632;color:#000000}'), css);

console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} check(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
