import path from 'node:path';

// vi.mock()/vi.spyOn() do NOT reliably intercept nested CJS require() calls
// in this project's vitest+rolldown setup (verified directly: a mocked
// dependency's spy showed zero calls even though the real function's
// side effect visibly ran). The reliable alternative is Node's own
// createRequire + monkeypatching the real, shared exports object that
// every require('same/path') call resolves to — then busting the cache
// between tests so each test starts from a clean, unpatched module graph.
export function bustSrcRequireCache(require) {
  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${path.sep}src${path.sep}`)) {
      delete require.cache[key];
    }
  }
}

// Installs a fake exports object directly into Node's require.cache under a
// dependency's resolved path, so any require() of it — including nested
// require() calls made by the module under test — returns the fake without
// ever executing the real file. This is preferred over "require the real
// module, then overwrite its exported functions with vi.fn()": overwriting
// still fully executes and V8-instruments the real file for coverage
// purposes, and when that file *also* has its own dedicated test elsewhere
// (loaded there via vite-node's normal ESM import), the coverage-v8 provider
// does not correctly merge coverage across those two different loading
// mechanisms — it was observed to silently undercount the dedicated test's
// coverage for that file once any other test file also required it this way.
// Injecting a fake module sidesteps the problem entirely: the real file is
// never loaded by the consumer test, so there is nothing to merge.
export function injectFakeModule(require, specifier, fakeExports) {
  const resolved = require.resolve(specifier);
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports: fakeExports,
    children: [],
    paths: [],
  };
  return fakeExports;
}
