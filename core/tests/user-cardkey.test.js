const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qqfarm-user-cardkey-'));
const previousDataDir = process.env.QQFARM_DATA_DIR;

test.before(() => {
    process.env.QQFARM_DATA_DIR = dataDir;
});

const userStore = require('../dist/models/user-store');
const cardkeyStore = require('../dist/models/cardkey-store');
const authConfigStore = require('../dist/models/auth-config-store');
const accounts = require('../dist/models/store/accounts');
const membershipGuard = require('../dist/services/membership-guard');

function uniqueName(prefix) {
    return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

function registerUser(prefix = 'user') {
    const result = userStore.registerUser(uniqueName(prefix), 'pw', { qq: '10001' });
    assert.equal(result.ok, true);
    return result.user;
}

test('registration and card claim switches default to off', () => {
    const runtimePaths = require('../dist/config/runtime-paths');
    fs.rmSync(runtimePaths.getDataFile('auth-config.json'), { force: true });
    const config = authConfigStore.getAuthConfig();
    assert.equal(config.registrationEnabled, false);
    assert.equal(config.cardClaimEnabled, false);
});

test('new users get two slots and no membership', () => {
    const user = registerUser('defaults');
    assert.equal(user.slotLimit, 2);
    assert.equal(user.membershipExpiresAt, null);
    assert.equal(user.membershipActive, false);
    assert.equal(user.enabled, true);
    assert.equal(user.qq, '10001');
});

test('registration requires a valid qq number', () => {
    const bad = userStore.registerUser(uniqueName('qq'), 'pw', { qq: 'abc' });
    assert.equal(bad.ok, false);
    assert.equal(bad.error, 'QQ号格式不正确，应为5-11位数字');
    const missing = userStore.registerUser(uniqueName('qq'), 'pw', { qq: '' });
    assert.equal(missing.ok, false);
    assert.equal(missing.error, '请输入QQ号');
});

test('registration consumes a time card and activates membership', async () => {
    authConfigStore.setAuthConfig({ registrationEnabled: true });
    const created = cardkeyStore.createCardKeys({ type: 'time', value: 30, count: 1 });
    const code = created.keys[0].rawCode || created.keys[0].code;
    const username = uniqueName('reg');
    const result = await cardkeyStore.registerUserWithCard({ username, password: 'pw', qq: '10086', code });
    assert.equal(result.ok, true);
    assert.equal(result.user.qq, '10086');
    assert.equal(result.user.membershipActive, true);
    assert.equal(result.user.slotLimit, 2);
    assert.equal(result.user.membershipExpiresAt > Date.now(), true);

    const listed = cardkeyStore.listCardKeys({ keyword: code });
    assert.equal(listed[0].status, 'used');
    assert.equal(listed[0].usedByUsername, username);

    const reuse = await cardkeyStore.registerUserWithCard({ username: uniqueName('reg2'), password: 'pw', qq: '10087', code });
    assert.equal(reuse.ok, false);
    assert.equal(reuse.error, '卡密无效或已被使用');
});

test('registration rejects quota cards and invalid card codes', async () => {
    authConfigStore.setAuthConfig({ registrationEnabled: true });
    const quota = cardkeyStore.createCardKeys({ type: 'quota', value: 3, count: 1 });
    const quotaCode = quota.keys[0].rawCode || quota.keys[0].code;
    const quotaResult = await cardkeyStore.registerUserWithCard({ username: uniqueName('regq'), password: 'pw', qq: '10088', code: quotaCode });
    assert.equal(quotaResult.ok, false);
    assert.equal(quotaResult.error, '注册只能使用时间卡密，额度卡密请登录后兑换');

    const missing = await cardkeyStore.registerUserWithCard({ username: uniqueName('regx'), password: 'pw', qq: '10089', code: 'QFNOTEXIST' });
    assert.equal(missing.ok, false);
    assert.equal(missing.error, '卡密无效或已被使用');
});

test('free card claim is limited per device and hands out distinct time cards', async () => {
    authConfigStore.setAuthConfig({ cardClaimEnabled: false, claimCardCode: '' });
    const closed = await cardkeyStore.claimFreeCard('device-closed');
    assert.equal(closed.ok, false);
    assert.equal(closed.error, '当前未开启免费卡密领取');

    authConfigStore.setAuthConfig({ cardClaimEnabled: true });
    cardkeyStore.createCardKeys({ type: 'time', value: 3, count: 2 });

    const first = await cardkeyStore.claimFreeCard('device-a');
    assert.equal(first.ok, true);
    assert.ok(first.data.cardCode);
    assert.equal(first.data.days, 3);

    const repeat = await cardkeyStore.claimFreeCard('device-a');
    assert.equal(repeat.ok, false);
    assert.equal(repeat.error, '每个设备只能领取一次卡密');

    const second = await cardkeyStore.claimFreeCard('device-b');
    assert.equal(second.ok, true);
    assert.notEqual(second.data.cardCode, first.data.cardCode);
});

test('time card extends from now when expired and stacks when active', () => {
    const now = 1_700_000_000_000;
    const expired = userStore.computeNewExpiry(now - 10_000, 2, now);
    assert.equal(expired, now + 2 * userStore.DAY_MS);
    const stacked = userStore.computeNewExpiry(now + 5_000, 3, now);
    assert.equal(stacked, now + 5_000 + 3 * userStore.DAY_MS);
});

test('quota card is rejected without membership and increases slots after time card', async () => {
    const user = registerUser('quota');
    authConfigStore.setAuthConfig({ cardClaimEnabled: true, registrationEnabled: true });
    const quota = cardkeyStore.createCardKeys({ type: 'quota', value: 3, count: 1 });
    assert.equal(quota.ok, true);
    const quotaCode = quota.keys[0].rawCode || quota.keys[0].code;
    const rejected = await cardkeyStore.redeemCardKey(user.id, quotaCode);
    assert.equal(rejected.ok, false);
    assert.equal(rejected.error, '请先兑换时间卡密开通会员');

    const time = cardkeyStore.createCardKeys({ type: 'time', value: 1, count: 1 });
    const timeCode = time.keys[0].rawCode || time.keys[0].code;
    const timeResult = await cardkeyStore.redeemCardKey(user.id, timeCode);
    assert.equal(timeResult.ok, true);
    assert.equal(timeResult.user.membershipActive, true);

    const accepted = await cardkeyStore.redeemCardKey(user.id, quotaCode);
    assert.equal(accepted.ok, true);
    assert.equal(accepted.user.slotLimit, 5);
});

test('the same card key can only be redeemed once under concurrent requests', async () => {
    const user = registerUser('race');
    authConfigStore.setAuthConfig({ cardClaimEnabled: true });
    const created = cardkeyStore.createCardKeys({ type: 'time', value: 1, count: 1 });
    const code = created.keys[0].rawCode || created.keys[0].code;
    const results = await Promise.all([
        cardkeyStore.redeemCardKey(user.id, code),
        cardkeyStore.redeemCardKey(user.id, code),
        cardkeyStore.redeemCardKey(user.id, code),
    ]);
    assert.equal(results.filter(item => item.ok).length, 1);
    assert.equal(results.filter(item => !item.ok).length, 2);
});

test('unused keys can be voided and used keys cannot', async () => {
    authConfigStore.setAuthConfig({ cardClaimEnabled: true });
    const unused = cardkeyStore.createCardKeys({ type: 'time', value: 1, count: 1 });
    const unusedCode = unused.keys[0].rawCode || unused.keys[0].code;
    const voided = cardkeyStore.voidCardKey(unusedCode);
    assert.equal(voided.ok, true);

    const user = registerUser('void');
    const used = cardkeyStore.createCardKeys({ type: 'time', value: 1, count: 1 });
    const usedCode = used.keys[0].rawCode || used.keys[0].code;
    const redeemed = await cardkeyStore.redeemCardKey(user.id, usedCode);
    assert.equal(redeemed.ok, true);
    const voidUsed = cardkeyStore.voidCardKey(usedCode);
    assert.equal(voidUsed.ok, false);
});

test('account list filters by owner and migrates missing owner to admin', () => {
    const user = registerUser('owner');
    accounts.addOrUpdateAccount({ name: 'mine', ownerUserId: user.id });
    accounts.addOrUpdateAccount({ name: 'admin-acc', ownerUserId: 'admin' });
    const all = accounts.getAccounts().accounts;
    const mine = accounts.filterAccountsByOwner(all, user.id);
    assert.equal(mine.length, 1);
    assert.equal(mine[0].name, 'mine');

    const migrated = accounts.normalizeAccountsData({
        accounts: [{ id: '9', name: 'legacy' }],
        nextId: 10,
    });
    assert.equal(migrated.accounts[0].ownerUserId, 'admin');
});

test('expired users cannot start accounts and keep existing ones when slots are full', () => {
    const user = registerUser('expired');
    userStore.updateUserEntitlement(user.id, { membershipExpiresAt: Date.now() + userStore.DAY_MS, slotLimit: 2 });
    accounts.addOrUpdateAccount({ name: 'slot-1', ownerUserId: user.id });
    accounts.addOrUpdateAccount({ name: 'slot-2', ownerUserId: user.id });
    assert.equal(accounts.countOwnedAccounts(user.id), 2);
    assert.equal(membershipGuard.canCreateGameAccount(user.id).ok, false);
    assert.equal(membershipGuard.canCreateGameAccount(user.id).error, '账号槽位不足');

    userStore.updateUserEntitlement(user.id, { membershipExpiresAt: Date.now() - 1000 });
    const owned = accounts.filterAccountsByOwner(accounts.getAccounts().accounts, user.id);
    assert.equal(owned.length, 2);
    const startCheck = membershipGuard.canStartGameAccount(owned[0]);
    assert.equal(startCheck.ok, false);
    assert.equal(startCheck.error, '会员已过期，请兑换时间卡密');
});

test('admin owner is not limited by membership or slots', () => {
    assert.equal(membershipGuard.canCreateGameAccount('admin').ok, true);
    assert.equal(membershipGuard.canStartGameAccount({ ownerUserId: 'admin' }).ok, true);
});

test('redeem is rejected when card claim is disabled and the key stays unused', async () => {
    const user = registerUser('closed');
    authConfigStore.setAuthConfig({ cardClaimEnabled: false });
    const created = cardkeyStore.createCardKeys({ type: 'time', value: 7, count: 1 });
    const code = created.keys[0].rawCode || created.keys[0].code;
    const result = await cardkeyStore.redeemCardKey(user.id, code);
    assert.equal(result.ok, false);
    assert.equal(result.error, '卡密领取未开放');
    const listed = cardkeyStore.listCardKeys({ keyword: code });
    assert.equal(listed[0].status, 'unused');
});

test.after(() => {
    if (previousDataDir === undefined)
        delete process.env.QQFARM_DATA_DIR;
    else
        process.env.QQFARM_DATA_DIR = previousDataDir;
});
