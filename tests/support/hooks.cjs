// Module hooks that let the tests load the real API handlers with a fake
// Supabase, without changing any app code.
//
// - `@supabase/supabase-js` resolves to tests/support/fake-supabase.cjs.
// - Optionally, files under api/ load as ES modules. The repo's package.json
//   has no "type" field (Vercel compiles the functions itself), so plain Node
//   would detect the import syntax and print a warning for every file.
//
// The hooks are synchronous and in-thread (module.registerHooks, Node 22.15+
// and 23.5+), so they apply to both import and require(). The Playwright
// worker loads the handlers through require().
//
// The support files are CommonJS (.cjs) because Playwright compiles test
// helpers to CommonJS, and Node's ES module tests can import them as well.

const { registerHooks } = require('node:module');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const FAKE_SUPABASE_URL = pathToFileURL(path.join(__dirname, 'fake-supabase.cjs')).href;
const API_DIRECTORY_URL = pathToFileURL(path.join(REPO_ROOT, 'api')).href + '/';

const HOOKS_KEY = Symbol.for('helloqueue.tests.hooksInstalled');

function installHooks({ loadApiAsModules = false } = {}) {
    if (globalThis[HOOKS_KEY]) {
        return;
    }
    globalThis[HOOKS_KEY] = true;

    registerHooks({
        resolve(specifier, context, nextResolve) {
            if (specifier === '@supabase/supabase-js') {
                return { url: FAKE_SUPABASE_URL, format: 'commonjs', shortCircuit: true };
            }
            return nextResolve(specifier, context);
        },
        load(url, context, nextLoad) {
            if (loadApiAsModules && url.startsWith(API_DIRECTORY_URL) && url.endsWith('.js')) {
                const result = nextLoad(url, { ...context, format: 'module' });
                return { ...result, format: 'module' };
            }
            return nextLoad(url, context);
        },
    });
}

module.exports = { REPO_ROOT, installHooks };
