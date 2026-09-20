const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qqfarm-capture-'));
const previousDataDir = process.env.QQFARM_DATA_DIR;

test.before(() => {
    process.env.QQFARM_DATA_DIR = dataDir;
});

const captureRoutes = require('../dist/controllers/admin/capture-routes');

function createFlow(overrides = {}) {
    return {
        id: 'flow-1',
        owner: 'admin',
        platform: 'qq',
        code: '',
        accountGid: '',
        openId: '',
        friendGids: new Set(),
        friendSource: '',
        friendListComplete: false,
        publicInfo: {},
        proxy: {},
        captureStatus: 'idle',
        cancelled: false,
        ...overrides,
    };
}

test('addCapturedValues extracts code, gid, friends and marks complete friend list', () => {
    const flow = createFlow();
    captureRoutes.addCapturedValues(flow, {
        data: {
            channels: {
                qq: {
                    status: 'running',
                    codes: [{ code: 'login-code' }, { gid: '12345' }, { openid: 'open-1' }],
                },
            },
            friends: {
                items: [{ gid: 111 }, { gid: 222 }, { gid: 0 }],
                source: 'gamepb.friendpb.FriendService.GetAll',
            },
            publicInfo: { host: '10.0.0.2', mitmPort: 18000 },
            proxy: { running: true, status: 'running' },
        },
    });

    assert.equal(flow.code, 'login-code');
    assert.equal(flow.accountGid, '12345');
    assert.equal(flow.openId, 'open-1');
    assert.deepEqual([...flow.friendGids].sort((a, b) => a - b), [111, 222]);
    assert.equal(flow.friendListComplete, true);
    assert.equal(flow.captureStatus, 'running');
    assert.equal(flow.publicInfo.host, '10.0.0.2');
    assert.equal(flow.proxy.running, true);
});

test('addCapturedValues does not overwrite already captured values', () => {
    const flow = createFlow({ code: 'first', accountGid: '999' });
    captureRoutes.addCapturedValues(flow, {
        data: { channels: { qq: { codes: [{ code: 'second' }, { gid: '1000' }] } } },
    });
    assert.equal(flow.code, 'first');
    assert.equal(flow.accountGid, '999');
});

test('mergeKnownFriendGids dedupes and drops own gid and invalid values', () => {
    const merged = captureRoutes.mergeKnownFriendGids([111, 0, -5], [222, 111, 3.5], 111);
    assert.deepEqual(merged.sort((a, b) => a - b), [222]);
});

test('isCompleteQqFriendSource only accepts the complete friend sources', () => {
    assert.equal(captureRoutes.isCompleteQqFriendSource('gamepb.friendpb.FriendService.GetAll'), true);
    assert.equal(captureRoutes.isCompleteQqFriendSource('gamepb.friendpb.FriendService.SyncAll'), true);
    assert.equal(captureRoutes.isCompleteQqFriendSource('gamepb.friendpb.FriendService.GetGameFriends'), false);
    assert.equal(captureRoutes.isCompleteQqFriendSource(''), false);
});

test('findDuplicateCapturedAccount matches by code or gid within the same platform', () => {
    const accounts = [
        { id: 'a1', platform: 'qq', code: 'aaa', gid: '111' },
        { id: 'a2', platform: 'wx', code: 'bbb', gid: '222' },
    ];
    assert.equal(captureRoutes.findDuplicateCapturedAccount(accounts, { platform: 'qq', code: 'aaa' })?.id, 'a1');
    assert.equal(captureRoutes.findDuplicateCapturedAccount(accounts, { platform: 'qq', accountGid: '111' })?.id, 'a1');
    assert.equal(captureRoutes.findDuplicateCapturedAccount(accounts, { platform: 'qq', code: 'bbb' }), null);
    assert.equal(captureRoutes.findDuplicateCapturedAccount(accounts, { platform: 'qq', code: 'aaa' }, 'a1'), null);
});

test('normalizeApiBase strips trailing slash and rejects credentials or invalid protocols', () => {
    assert.equal(captureRoutes.normalizeApiBase('http://127.0.0.1:8450/'), 'http://127.0.0.1:8450');
    assert.equal(captureRoutes.normalizeApiBase('https://capture.example.com/base/'), 'https://capture.example.com/base');
    assert.throws(() => captureRoutes.normalizeApiBase('http://user:pass@host:1'));
    assert.throws(() => captureRoutes.normalizeApiBase('ftp://host:1'));
    assert.throws(() => captureRoutes.normalizeApiBase(''));
});

test('isCertificateTokenValid compares the flow token safely', () => {
    const flow = { certificateToken: 'token-abc' };
    assert.equal(captureRoutes.isCertificateTokenValid(flow, 'token-abc'), true);
    assert.equal(captureRoutes.isCertificateTokenValid(flow, 'token-abd'), false);
    assert.equal(captureRoutes.isCertificateTokenValid(flow, ''), false);
    assert.equal(captureRoutes.isCertificateTokenValid({ certificateToken: '' }, ''), false);
});

test('getCaptureAdvertiseHost prefers forwarded host over loopback', () => {
    assert.equal(captureRoutes.getCaptureAdvertiseHost({
        headers: { 'x-forwarded-host': 'panel.example.com', host: 'localhost:3007' },
    }), 'panel.example.com');
    assert.equal(captureRoutes.getCaptureAdvertiseHost({ headers: { host: 'localhost:3007' } }), '');
});

test('embedded capture mode toggles with setEmbeddedCapture', () => {
    assert.equal(captureRoutes.isEmbeddedMode(), false);
    captureRoutes.setEmbeddedCapture({ handleApiRequest() {} });
    assert.equal(captureRoutes.isEmbeddedMode(), true);
    captureRoutes.setEmbeddedCapture(null);
    assert.equal(captureRoutes.isEmbeddedMode(), false);
});

test('collectQqFriendGids stops early when the account is no longer the same instance', async () => {
    const stopped = [];
    const flow = createFlow({ friendGids: new Set([111]) });
    const imported = await captureRoutes.collectQqFriendGids({
        provider: {},
        logger: { info() {}, warn() {} },
        flow,
        accountId: 'missing-account',
        accountCreatedAt: '2020-01-01T00:00:00.000Z',
        refresh: async () => {},
        stop: async (target) => { stopped.push(target.id); },
        wait: async () => {},
        now: () => 0,
    });
    assert.equal(imported, 0);
    assert.equal(flow.cancelled, true);
    assert.deepEqual(stopped, ['flow-1']);
});

test('collectQqFriendGids imports new friend gids and broadcasts config', async () => {
    const store = require('../dist/models/store');
    const created = store.addOrUpdateAccount({ ownerUserId: 'admin', name: 'capture-a', code: 'code-a', platform: 'qq' });
    const account = created.accounts.find(item => item.name === 'capture-a');
    const flow = createFlow({ friendGids: new Set([111, 222]) });
    const broadcasts = [];
    let refreshCount = 0;
    let afterStopCount = 0;

    const imported = await captureRoutes.collectQqFriendGids({
        provider: { broadcastConfig: id => broadcasts.push(id) },
        logger: { info() {}, warn() {} },
        flow,
        accountId: account.id,
        accountCreatedAt: account.createdAt,
        refresh: async (target) => {
            refreshCount += 1;
            target.friendListComplete = true;
        },
        stop: async () => {},
        wait: async () => {},
        now: () => 0,
        afterStop: async () => { afterStopCount += 1; },
    });

    assert.equal(imported, 2);
    assert.equal(refreshCount, 1);
    assert.equal(afterStopCount, 1);
    assert.deepEqual(broadcasts, [account.id]);
    assert.deepEqual(store.getKnownFriendGids(account.id).map(Number).sort((a, b) => a - b), [111, 222]);
});

test('collectQqFriendGids skips import when the flow was cancelled', async () => {
    const stopped = [];
    const flow = createFlow({ cancelled: true, friendGids: new Set([111]) });
    let afterStopCount = 0;

    const imported = await captureRoutes.collectQqFriendGids({
        provider: {},
        logger: { info() {}, warn() {} },
        flow,
        accountId: 'any-account',
        accountCreatedAt: '2020-01-01T00:00:00.000Z',
        refresh: async () => { throw new Error('should not refresh'); },
        stop: async (target) => { stopped.push(target.id); },
        wait: async () => {},
        now: () => 0,
        afterStop: async () => { afterStopCount += 1; },
    });

    assert.equal(imported, 0);
    assert.deepEqual(stopped, ['flow-1']);
    assert.equal(afterStopCount, 0);
});

test('scheduleCapturedAccountStart starts new accounts and restarts running updates', () => {
    const calls = [];
    const provider = {
        startAccount: id => calls.push(['start', id]),
        restartAccount: id => calls.push(['restart', id]),
    };
    const runScheduled = (options) => {
        let callback;
        captureRoutes.scheduleCapturedAccountStart({
            ...options,
            logger: { warn() {} },
            schedule: (fn) => { callback = fn; return {}; },
        });
        callback();
    };

    runScheduled({ provider, flow: {}, account: { id: 'a1' }, isUpdate: false, wasRunning: false });
    runScheduled({ provider, flow: {}, account: { id: 'a2' }, isUpdate: true, wasRunning: true });
    runScheduled({ provider, flow: {}, account: { id: 'a3' }, isUpdate: true, wasRunning: false });

    assert.deepEqual(calls, [['start', 'a1'], ['restart', 'a2']]);
});

test('scheduleCapturedAccountStart records start errors on the flow result', () => {
    const flow = { result: {} };
    let callback;
    captureRoutes.scheduleCapturedAccountStart({
        provider: { startAccount() { throw new Error('boom'); } },
        logger: { warn() {} },
        flow,
        account: { id: 'a1' },
        isUpdate: false,
        wasRunning: false,
        schedule: (fn) => { callback = fn; return {}; },
    });
    callback();
    assert.equal(flow.result.startError, 'boom');
});

test.after(() => {
    if (previousDataDir === undefined) delete process.env.QQFARM_DATA_DIR;
    else process.env.QQFARM_DATA_DIR = previousDataDir;
});
