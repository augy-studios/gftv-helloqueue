// A small static server for the Playwright tests that serves the pages the
// way Vercel does with this repo's vercel.json:
//
// - cleanUrls: /login serves login.html, and /login.html redirects to /login.
// - Files first, then the rewrites from vercel.json, in order:
//   /dashboard/... -> dashboard.html, /queue/:event/:queue -> attendee.html,
//   /display/:event/:queue -> display.html, / -> index.html.
// - Anything else gets 404.html with status 404.
//
// /api/... is not served here: the Playwright tests answer those requests
// themselves (tests/e2e/support/test.js). A request that reaches this server
// gets a 404 JSON reply, so a missed route is easy to spot.
//
// Dotfiles (such as .env), node_modules and the tests folder are never
// served.
//
// Usage: node tests/serve.js [--port 4391]

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const vercelConfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));

const CONTENT_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.xml': 'application/xml; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
};

// Path prefixes that are never served.
const BLOCKED_PREFIXES = ['/node_modules/', '/tests/', '/test-results/', '/playwright-report/', '/api/'];

function portFromArguments() {
    const index = process.argv.indexOf('--port');
    if (index !== -1 && process.argv[index + 1]) {
        return Number(process.argv[index + 1]);
    }
    if (process.env.PORT) {
        return Number(process.env.PORT);
    }
    return 4391;
}

// Turns a vercel.json source such as "/queue/:eventCode/:queueCode" or
// "/dashboard/:path*" into a regular expression.
function sourceToRegExp(source) {
    const pattern = source
        .split('/')
        .map((part) => {
            if (part.endsWith('*') && part.startsWith(':')) {
                return '.*';
            }
            if (part.startsWith(':')) {
                return '[^/]+';
            }
            return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        })
        .join('/');
    // "/dashboard/:path*" also matches "/dashboard/" and deeper paths.
    return new RegExp(`^${pattern.replace(/\/\.\*$/, '(?:/.*)?')}$`);
}

const REWRITES = vercelConfig.rewrites
    .filter((rewrite) => !rewrite.source.startsWith('/api/'))
    .map((rewrite) => ({ match: sourceToRegExp(rewrite.source), destination: rewrite.destination }));

function isBlocked(urlPath) {
    const segments = urlPath.split('/');
    // Dotfiles and dot-folders, except /.well-known/.
    const hasDotSegment = segments.some((segment) => segment.startsWith('.') && segment !== '.well-known');
    if (hasDotSegment) {
        return true;
    }
    return BLOCKED_PREFIXES.some((prefix) => urlPath === prefix.slice(0, -1) || urlPath.startsWith(prefix));
}

// The file for a clean URL path, or null. Mirrors Vercel's cleanUrls.
function findFile(urlPath) {
    if (isBlocked(urlPath)) {
        return null;
    }
    const target = path.normalize(path.join(ROOT, urlPath));
    if (target !== ROOT && !target.startsWith(ROOT + path.sep)) {
        return null;
    }
    const candidates = [target + '.html', target];
    if (urlPath.endsWith('/')) {
        candidates.unshift(path.join(target, 'index.html'));
    }
    for (const candidate of candidates) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            return candidate;
        }
    }
    return null;
}

function sendFile(response, filePath, status = 200) {
    const type = CONTENT_TYPES[path.extname(filePath)] || 'application/octet-stream';
    response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    fs.createReadStream(filePath).pipe(response);
}

function handle(request, response) {
    const url = new URL(request.url, 'http://localhost');
    let urlPath = decodeURIComponent(url.pathname);

    if (urlPath.startsWith('/api/') || urlPath === '/api') {
        response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: `Not faked in the tests: ${request.method} ${urlPath}` }));
        return;
    }

    // cleanUrls: /page.html redirects to /page, /index.html to /.
    if (urlPath.endsWith('.html')) {
        let clean = urlPath.slice(0, -'.html'.length);
        if (clean.endsWith('/index')) {
            clean = clean.slice(0, -'index'.length);
        }
        response.writeHead(308, { Location: clean + url.search });
        response.end();
        return;
    }

    let file = null;
    if (urlPath !== '/') {
        file = findFile(urlPath);
    }
    if (!file) {
        const rewrite = REWRITES.find((candidate) => candidate.match.test(urlPath));
        if (rewrite) {
            file = findFile(rewrite.destination);
        }
    }
    if (file) {
        sendFile(response, file);
        return;
    }
    sendFile(response, path.join(ROOT, '404.html'), 404);
}

const port = portFromArguments();
http.createServer(handle).listen(port, '127.0.0.1', () => {
    console.log(`HelloQueue test server on http://127.0.0.1:${port}`);
});
