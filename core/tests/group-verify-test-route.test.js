const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'group-verify-test-'));
const previousDataDir = process.env.QQFARM_DATA_DIR;
process.env.QQFARM_DATA_DIR = dataDir;

const store = require('../dist/models/store');
const routes = require('../dist/controllers/admin/system-routes');

const mockState = { status: 200, body: JSON.stringify({ ok: true, data: { inGroup: true } }), lastQuery: '' };
const mockServer = http.createServer((req, res) => {
    mockState.lastQuery = req.url || '';
    res.writeHead(mockState.status, { 'Content-Type': 'application/json' });
    res.end(mockState.body);
});

function createMockApp() {
    const handlers = { get: [], post: [], put: [], delete: [] };
    const app = {
        get: (route, ...args) => handlers.get.push({ route, handlers: args }),
        post: (route, ...args) => handlers.post.push({ route, handlers: args }),
        put: (route, ...args) => handlers.put.push({ route, handlers: args }),
        delete: (route, ...args) => handlers.delete.push({ route, handlers: args }),
    };
    return { app, handlers };
}

async function invoke(handlersList, route, req, res) {
    const entry = handlersList.find((item) => item.route === route);
    assert.ok(entry, `未找到路由 ${route}`);
    for (const handler of entry.handlers) {
        await handler(req, res, () => {});
    }
}

function createRes() {
    return {
        statusCode: 200,
        payload: null,
        json(payload) {
            this.payload = payload;
            return this;
        },
        status(code) {
            this.statusCode = code;
            return this;
        },
    };
}

function registerRoutes() {
    const { app, handlers } = createMockApp();
    const ctx = {
        tokens: new Set(['admin-token']),
        sessions: new Map([['admin-token', {
            token: 'admin-token',
            role: 'admin',
            userId: 'admin',
            username: 'admin',
            createdAt: Date.now(),
        }]]),
        app: null,
        server: null,
        io: null,
        provider: null,
    };
    routes.mountSystemRoutes(app, ctx);
    return handlers;
}

function adminReq(body = {}) {
    return {
        body,
        headers: { 'x-admin-token': 'admin-token' },
        auth: { username: 'admin', role: 'admin', userId: 'admin', token: 'admin-token' },
    };
}

test.before(async () => {
    await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
});

test.after(() => {
    mockServer.close();
    if (previousDataDir === undefined) delete process.env.QQFARM_DATA_DIR;
    else process.env.QQFARM_DATA_DIR = previousDataDir;
});

test('POST /api/admin/group-verify/test 缺少QQ号返回400', async () => {
    const handlers = registerRoutes();
    const res = createRes();
    await invoke(handlers.post, '/api/admin/group-verify/test', adminReq({}), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.ok, false);
    assert.match(res.payload.error, /QQ号/);
});

test('POST /api/admin/group-verify/test 非法QQ号返回400', async () => {
    const handlers = registerRoutes();
    const res = createRes();
    await invoke(handlers.post, '/api/admin/group-verify/test', adminReq({ qq: 'abc12' }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.ok, false);
});

test('POST /api/admin/group-verify/test 未配置验证接口返回400', async () => {
    store.setGroupVerifyConfig({ enabled: false, verifyUrl: '' });
    const handlers = registerRoutes();
    const res = createRes();
    await invoke(handlers.post, '/api/admin/group-verify/test', adminReq({ qq: '10000001' }), res);
    assert.equal(res.statusCode, 400);
    assert.match(res.payload.error, /验证接口地址/);
});

test('POST /api/admin/group-verify/test 在群时返回成功诊断', async () => {
    const port = mockServer.address().port;
    store.setGroupVerifyConfig({
        enabled: true,
        qqGroupNumber: '123456789',
        verifyUrl: `http://127.0.0.1:${port}/check`,
        verifyToken: '',
        timeoutMs: 3000,
    });
    mockState.status = 200;
    mockState.body = JSON.stringify({ ok: true, data: { inGroup: true } });
    const handlers = registerRoutes();
    const res = createRes();
    await invoke(handlers.post, '/api/admin/group-verify/test', adminReq({ qq: '10000001' }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.ok, true);
    assert.equal(res.payload.data.inGroup, true);
    assert.equal(res.payload.data.error, '');
    assert.equal(res.payload.data.httpStatus, 200);
    assert.equal(typeof res.payload.data.durationMs, 'number');
    assert.ok(res.payload.data.requestUrl.includes('qq=10000001'));
    assert.ok(res.payload.data.requestUrl.includes('group=123456789'));
    assert.equal(mockState.lastQuery.includes('qq=10000001'), true);
});

test('POST /api/admin/group-verify/test 兼容data.inGroup响应', async () => {
    const port = mockServer.address().port;
    store.setGroupVerifyConfig({ enabled: true, verifyUrl: `http://127.0.0.1:${port}/check`, timeoutMs: 3000 });
    mockState.status = 200;
    mockState.body = JSON.stringify({ data: { inGroup: true } });
    const handlers = registerRoutes();
    const res = createRes();
    await invoke(handlers.post, '/api/admin/group-verify/test', adminReq({ qq: '10000002' }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.data.inGroup, true);
});

test('POST /api/admin/group-verify/test 不在群时返回not_in_group与响应体', async () => {
    const port = mockServer.address().port;
    store.setGroupVerifyConfig({ enabled: true, verifyUrl: `http://127.0.0.1:${port}/check`, timeoutMs: 3000 });
    mockState.status = 200;
    mockState.body = JSON.stringify({ inGroup: false });
    const handlers = registerRoutes();
    const res = createRes();
    await invoke(handlers.post, '/api/admin/group-verify/test', adminReq({ qq: '10000003' }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.data.inGroup, false);
    assert.equal(res.payload.data.error, 'not_in_group');
    assert.deepEqual(res.payload.data.responseBody, { inGroup: false });
});

test('POST /api/admin/group-verify/test 接口HTTP错误返回service_unavailable', async () => {
    const port = mockServer.address().port;
    store.setGroupVerifyConfig({ enabled: true, verifyUrl: `http://127.0.0.1:${port}/check`, timeoutMs: 3000 });
    mockState.status = 502;
    mockState.body = 'bad gateway';
    const handlers = registerRoutes();
    const res = createRes();
    await invoke(handlers.post, '/api/admin/group-verify/test', adminReq({ qq: '10000004' }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.data.inGroup, false);
    assert.equal(res.payload.data.error, 'service_unavailable');
    assert.equal(res.payload.data.httpStatus, 502);
});

test('POST /api/admin/group-verify/test 非JSON响应返回invalid_response', async () => {
    const port = mockServer.address().port;
    store.setGroupVerifyConfig({ enabled: true, verifyUrl: `http://127.0.0.1:${port}/check`, timeoutMs: 3000 });
    mockState.status = 200;
    mockState.body = '<html>not json</html>';
    const handlers = registerRoutes();
    const res = createRes();
    await invoke(handlers.post, '/api/admin/group-verify/test', adminReq({ qq: '10000005' }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.data.error, 'invalid_response');
    assert.match(res.payload.data.responseBody, /not json/);
});

test('POST /api/admin/group-verify/test 服务不可达返回service_unavailable', async () => {
    store.setGroupVerifyConfig({ enabled: true, verifyUrl: 'http://127.0.0.1:1/check', timeoutMs: 1500 });
    const handlers = registerRoutes();
    const res = createRes();
    await invoke(handlers.post, '/api/admin/group-verify/test', adminReq({ qq: '10000006' }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.data.inGroup, false);
    assert.equal(res.payload.data.error, 'service_unavailable');
    assert.ok(res.payload.data.errorMessage);
});
