// Calling the real API handlers in tests: fake Vercel `req` and `res`
// objects, and a router that maps a URL path to a file in api/ the way
// Vercel does (api/queues/[queueId]/operate.js serves /api/queues/123/operate).

const fs = require('node:fs');
const path = require('node:path');
const { REPO_ROOT } = require('./hooks.cjs');

const API_ROOT = path.join(REPO_ROOT, 'api');

// A fake Vercel request. Header names are lower case, as in Node.
function createRequest({ method = 'GET', query = {}, body = undefined, headers = {}, token = null } = {}) {
    const lowerCaseHeaders = {};
    for (const [name, value] of Object.entries(headers)) {
        lowerCaseHeaders[name.toLowerCase()] = value;
    }
    if (token) {
        lowerCaseHeaders.authorization = `Bearer ${token}`;
    }
    return {
        method,
        query: { ...query },
        body,
        headers: lowerCaseHeaders,
    };
}

// A fake Vercel response that remembers what the handler sent.
function createResponse() {
    return {
        statusCode: 200,
        headers: {},
        body: undefined,
        ended: false,
        status(code) {
            this.statusCode = code;
            return this;
        },
        setHeader(name, value) {
            this.headers[name.toLowerCase()] = value;
            return this;
        },
        getHeader(name) {
            return this.headers[name.toLowerCase()];
        },
        json(body) {
            this.setHeader('content-type', 'application/json; charset=utf-8');
            this.body = structuredClone(body);
            this.ended = true;
            return this;
        },
        send(body) {
            this.body = body;
            this.ended = true;
            return this;
        },
        end(body) {
            if (body !== undefined) {
                this.body = body;
            }
            this.ended = true;
            return this;
        },
    };
}

// Loads a handler by its path from the repo root, such as
// "api/queues/[queueId].js", and returns its default export. require() works
// in both runners: Node loads the ES module through require(esm), and
// Playwright compiles it to CommonJS first.
async function loadHandler(relativeFile) {
    const loaded = require(path.join(REPO_ROOT, relativeFile));
    return loaded.default;
}

// Calls a handler and returns { status, headers, body, ended }.
async function callHandler(relativeFile, requestOptions = {}) {
    const handler = await loadHandler(relativeFile);
    const request = createRequest(requestOptions);
    const response = createResponse();
    await handler(request, response);
    return {
        status: response.statusCode,
        headers: response.headers,
        body: response.body,
        ended: response.ended,
    };
}

// Every route file in api/, relative to the repo root. Files starting with
// "_" are shared helpers, which Vercel doesn't serve.
function listApiRouteFiles() {
    const files = [];
    function walk(directory) {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            if (entry.name.startsWith('_')) {
                continue;
            }
            const full = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                walk(full);
            } else if (entry.name.endsWith('.js')) {
                files.push(path.relative(REPO_ROOT, full).split(path.sep).join('/'));
            }
        }
    }
    walk(API_ROOT);
    return files.sort();
}

// Maps a URL path such as "/api/queues/abc/operate" to
// { file: "api/queues/[queueId]/operate.js", params: { queueId: "abc" } },
// or null when no file serves it. Literal names win over [param] names.
function resolveApiRoute(pathname) {
    const segments = pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    const params = {};
    let directory = API_ROOT;

    if (segments.length === 0) {
        return null;
    }

    for (const [index, segment] of segments.entries()) {
        const names = fs.readdirSync(directory);
        const isLast = index === segments.length - 1;
        if (segment.startsWith('_')) {
            return null;
        }

        if (isLast) {
            if (names.includes(`${segment}.js`)) {
                return routeResult(path.join(directory, `${segment}.js`), params);
            }
            if (names.includes(segment) && fs.existsSync(path.join(directory, segment, 'index.js'))) {
                return routeResult(path.join(directory, segment, 'index.js'), params);
            }
            const dynamicFile = names.find((name) => /^\[[^\]]+\]\.js$/.test(name));
            if (dynamicFile) {
                params[dynamicFile.slice(1, -4)] = segment;
                return routeResult(path.join(directory, dynamicFile), params);
            }
            const dynamicDirectory = names.find((name) => /^\[[^\]]+\]$/.test(name));
            if (dynamicDirectory && fs.existsSync(path.join(directory, dynamicDirectory, 'index.js'))) {
                params[dynamicDirectory.slice(1, -1)] = segment;
                return routeResult(path.join(directory, dynamicDirectory, 'index.js'), params);
            }
            return null;
        }

        if (names.includes(segment) && fs.statSync(path.join(directory, segment)).isDirectory()) {
            directory = path.join(directory, segment);
            continue;
        }
        const dynamicDirectory = names.find((name) => /^\[[^\]]+\]$/.test(name));
        if (!dynamicDirectory) {
            return null;
        }
        params[dynamicDirectory.slice(1, -1)] = segment;
        directory = path.join(directory, dynamicDirectory);
    }
    return null;
}

function routeResult(fullPath, params) {
    return {
        file: path.relative(REPO_ROOT, fullPath).split(path.sep).join('/'),
        params,
    };
}

module.exports = {
    createRequest,
    createResponse,
    loadHandler,
    callHandler,
    listApiRouteFiles,
    resolveApiRoute,
};
