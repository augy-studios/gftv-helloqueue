// Loaded with `node --require` before the Node handler tests (see the "test"
// script in package.json): stub environment first, then the module hooks, so
// api/_supabase.js gets the fake client when a test loads a handler.

const { applyStubEnvironment } = require('./environment.cjs');
const { installHooks } = require('./hooks.cjs');
const { installTelegramRecorder } = require('./telegram.cjs');

applyStubEnvironment();
installHooks({ loadApiAsModules: true });
installTelegramRecorder();
