const test = require('node:test');
const assert = require('node:assert/strict');

const { rewriteAbsoluteRequest } = require('../dist/capture/mitm-proxy');

test('rewriteAbsoluteRequest builds a valid origin-form request line', () => {
    const head = [
        'GET http://example.com/hello?a=1 HTTP/1.1',
        'Host: example.com',
        'User-Agent: test',
        '',
    ].join('\r\n');

    const rewritten = rewriteAbsoluteRequest(head, '/hello?a=1');

    assert.equal(
        rewritten,
        ['GET /hello?a=1 HTTP/1.1', 'Host: example.com', 'User-Agent: test'].join('\r\n'),
    );
    assert.match(rewritten.split('\r\n')[0], /^GET \/hello\?a=1 HTTP\/1\.1$/);
});

test('rewriteAbsoluteRequest strips trailing blank lines and supports LF-only heads', () => {
    const head = 'POST http://example.com/api HTTP/1.1\nHost: example.com\nContent-Length: 0\n\n\n';
    const rewritten = rewriteAbsoluteRequest(head, '/api');

    assert.equal(rewritten, ['POST /api HTTP/1.1', 'Host: example.com', 'Content-Length: 0'].join('\r\n'));
});

test('rewriteAbsoluteRequest falls back to / and HTTP/1.1', () => {
    assert.equal(rewriteAbsoluteRequest('GET http://example.com HTTP/1.0', ''), 'GET / HTTP/1.0');
    assert.equal(rewriteAbsoluteRequest('GET http://example.com', '/'), 'GET / HTTP/1.1');
});
