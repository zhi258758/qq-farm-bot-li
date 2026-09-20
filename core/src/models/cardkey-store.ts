export {};
const crypto = require('node:crypto');
const { getDataFile, ensureDataDir } = require('../config/runtime-paths');
const { readJsonFile, writeJsonFileAtomic } = require('../services/json-db');
const userStore = require('./user-store');
const authConfigStore = require('./auth-config-store');

function cardkeysFile(): string {
    return getDataFile('cardkeys.json');
}
function cardClaimsFile(): string {
    return getDataFile('card-claims.json');
}
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 20;
const CLAIM_TTL_MS = 24 * 60 * 60 * 1000;

type CardKeyType = 'time' | 'quota';
type CardKeyStatus = 'unused' | 'used' | 'voided';

interface CardKeyRecord {
    code: string;
    type: CardKeyType;
    value: number;
    status: CardKeyStatus;
    createdAt: number;
    usedAt?: number;
    usedByUserId?: string;
    usedByUsername?: string;
    voidedAt?: number;
    claimedByDevice?: string;
    claimedAt?: number;
}

interface CardKeysData {
    keys: CardKeyRecord[];
}

interface CardClaimRecord {
    id: string;
    deviceKey: string;
    cardCode: string;
    days: number;
    createdAt: number;
}

interface CardClaimsData {
    records: CardClaimRecord[];
}

let redeemLock: Promise<void> = Promise.resolve();

function withLock<T>(fn: () => T): Promise<T> {
    const run = redeemLock.then(fn, fn);
    redeemLock = run.then(() => undefined, () => undefined);
    return run;
}

function generateCode(): string {
    let out = 'QF';
    for (let i = 0; i < CODE_LENGTH; i++) {
        out += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    }
    return out;
}

function maskCode(code: string): string {
    const value = String(code || '');
    if (value.length <= 8) return `${value.slice(0, 2)}****`;
    return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

function normalizeCardKey(raw: any): CardKeyRecord | null {
    if (!raw || typeof raw !== 'object') return null;
    const code = String(raw.code || '').trim().toUpperCase();
    const type = raw.type === 'quota' ? 'quota' : raw.type === 'time' ? 'time' : '';
    const value = Number.parseInt(raw.value, 10);
    const status: CardKeyStatus = raw.status === 'used' || raw.status === 'voided' ? raw.status : 'unused';
    if (!code || !type || !Number.isFinite(value) || value <= 0) return null;
    const record: CardKeyRecord = {
        code,
        type,
        value,
        status,
        createdAt: Number(raw.createdAt) || Date.now(),
    };
    if (raw.usedAt) record.usedAt = Number(raw.usedAt);
    if (raw.usedByUserId) record.usedByUserId = String(raw.usedByUserId);
    if (raw.usedByUsername) record.usedByUsername = String(raw.usedByUsername);
    if (raw.voidedAt) record.voidedAt = Number(raw.voidedAt);
    if (raw.claimedByDevice) record.claimedByDevice = String(raw.claimedByDevice);
    if (raw.claimedAt) record.claimedAt = Number(raw.claimedAt);
    return record;
}

function loadCardKeys(): CardKeysData {
    ensureDataDir();
    const raw = readJsonFile(cardkeysFile(), () => ({ keys: [] }));
    const keys = (Array.isArray(raw.keys) ? raw.keys : []).map(normalizeCardKey).filter(Boolean) as CardKeyRecord[];
    return { keys };
}

function saveCardKeys(data: CardKeysData): void {
    ensureDataDir();
    writeJsonFileAtomic(cardkeysFile(), { keys: data.keys });
}

function loadClaims(): CardClaimsData {
    ensureDataDir();
    const raw = readJsonFile(cardClaimsFile(), () => ({ records: [] }));
    const records = (Array.isArray(raw.records) ? raw.records : [])
        .map((item: any): CardClaimRecord | null => {
            if (!item || typeof item !== 'object') return null;
            const deviceKey = String(item.deviceKey || '').trim();
            const cardCode = String(item.cardCode || '').trim().toUpperCase();
            if (!deviceKey || !cardCode) return null;
            return {
                id: String(item.id || crypto.randomBytes(8).toString('hex')),
                deviceKey,
                cardCode,
                days: Number(item.days) || 0,
                createdAt: Number(item.createdAt) || Date.now(),
            };
        })
        .filter(Boolean) as CardClaimRecord[];
    return { records };
}

function saveClaims(data: CardClaimsData): void {
    ensureDataDir();
    writeJsonFileAtomic(cardClaimsFile(), { records: data.records });
}

function activeClaims(at: number = Date.now()): CardClaimRecord[] {
    return loadClaims().records.filter(record => at - record.createdAt < CLAIM_TTL_MS);
}

function publicCardKey(record: CardKeyRecord, options: { maskUsed?: boolean } = {}) {
    const shouldMask = options.maskUsed !== false && record.status !== 'unused';
    return {
        code: shouldMask ? maskCode(record.code) : record.code,
        rawCode: record.status === 'unused' ? record.code : undefined,
        type: record.type,
        value: record.value,
        status: record.status,
        createdAt: record.createdAt,
        usedAt: record.usedAt || null,
        usedByUserId: record.usedByUserId || null,
        usedByUsername: record.usedByUsername || null,
        voidedAt: record.voidedAt || null,
    };
}

function createCardKeys(input: { type: string; value: unknown; count: unknown }): { ok: boolean; keys?: any[]; error?: string } {
    const type: CardKeyType | '' = input.type === 'quota' ? 'quota' : input.type === 'time' ? 'time' : '';
    const value = Number.parseInt(String(input.value), 10);
    const count = Number.parseInt(String(input.count), 10);
    if (!type) return { ok: false, error: '卡密类型无效' };
    if (!Number.isFinite(value) || value <= 0) return { ok: false, error: '面值必须为正整数' };
    if (!Number.isFinite(count) || count <= 0) return { ok: false, error: '生成数量必须为正整数' };

    const data = loadCardKeys();
    const existing = new Set(data.keys.map(item => item.code));
    const created: CardKeyRecord[] = [];
    for (let i = 0; i < count; i++) {
        let code = generateCode();
        let retries = 0;
        while (existing.has(code) && retries < 20) {
            code = generateCode();
            retries++;
        }
        if (existing.has(code)) return { ok: false, error: '卡密生成冲突，请重试' };
        existing.add(code);
        const record: CardKeyRecord = {
            code,
            type,
            value,
            status: 'unused',
            createdAt: Date.now(),
        };
        created.push(record);
        data.keys.unshift(record);
    }
    saveCardKeys(data);
    return {
        ok: true,
        keys: created.map(item => publicCardKey(item, { maskUsed: false })),
    };
}

function listCardKeys(filter: { type?: string; status?: string; keyword?: string } = {}) {
    const type = String(filter.type || '').trim();
    const status = String(filter.status || '').trim();
    const keyword = String(filter.keyword || '').trim().toUpperCase();
    return loadCardKeys().keys
        .filter((item) => {
            if (type && item.type !== type) return false;
            if (status && item.status !== status) return false;
            if (keyword && !item.code.includes(keyword) && !String(item.usedByUsername || '').toUpperCase().includes(keyword)) return false;
            return true;
        })
        .map(item => publicCardKey(item));
}

function voidCardKey(code: string): { ok: boolean; error?: string; key?: any } {
    const data = loadCardKeys();
    const record = data.keys.find(item => item.code === String(code || '').trim().toUpperCase());
    if (!record) return { ok: false, error: '卡密不存在' };
    if (record.status === 'used') return { ok: false, error: '该卡密已被兑换' };
    if (record.status === 'voided') return { ok: false, error: '该卡密已作废' };
    record.status = 'voided';
    record.voidedAt = Date.now();
    saveCardKeys(data);
    return { ok: true, key: publicCardKey(record) };
}

function redeemCardKeySync(userId: string, rawCode: string): { ok: boolean; error?: string; status?: number; user?: any; key?: any } {
    const config = authConfigStore.getAuthConfig();
    if (!config.cardClaimEnabled) {
        return { ok: false, error: '卡密领取未开放', status: 403 };
    }

    const user = userStore.getUser(userId);
    if (!user) return { ok: false, error: '用户不存在', status: 404 };
    if (!user.enabled) return { ok: false, error: '账号已被禁用', status: 403 };

    const code = String(rawCode || '').trim().toUpperCase();
    if (!code) return { ok: false, error: '请输入卡密', status: 400 };

    const data = loadCardKeys();
    const record = data.keys.find(item => item.code === code);
    if (!record || record.status !== 'unused') {
        return { ok: false, error: '卡密无效或已被使用', status: 400 };
    }

    if (record.type === 'quota' && !userStore.isMembershipActive(user)) {
        return { ok: false, error: '请先兑换时间卡密开通会员', status: 400 };
    }

    record.status = 'used';
    record.usedAt = Date.now();
    record.usedByUserId = user.id;
    record.usedByUsername = user.username;
    saveCardKeys(data);

    let updated = user;
    if (record.type === 'time') {
        updated = userStore.extendMembership(user.id, record.value) || user;
    } else {
        updated = userStore.addQuota(user.id, record.value) || user;
    }

    return {
        ok: true,
        user: userStore.publicUser(updated),
        key: {
            type: record.type,
            value: record.value,
            redeemedAt: record.usedAt,
            code: maskCode(record.code),
        },
    };
}

function redeemCardKey(userId: string, rawCode: string) {
    return withLock(() => redeemCardKeySync(userId, rawCode));
}

function registerUserWithCardSync(input: { username?: string; password?: string; qq?: string; code?: string; adminUsername?: string }) {
    const username = String(input.username || '').trim();
    const password = String(input.password || '');
    const code = String(input.code || '').trim().toUpperCase();
    if (!code) return { ok: false, error: '请输入卡密', status: 400 };

    const data = loadCardKeys();
    const record = data.keys.find(item => item.code === code);
    if (!record || record.status !== 'unused') {
        return { ok: false, error: '卡密无效或已被使用', status: 400 };
    }
    if (record.type !== 'time') {
        return { ok: false, error: '注册只能使用时间卡密，额度卡密请登录后兑换', status: 400 };
    }

    const created = userStore.registerUser(username, password, {
        adminUsername: input.adminUsername,
        qq: String(input.qq == null ? '' : input.qq),
    });
    if (!created.ok) return created;

    record.status = 'used';
    record.usedAt = Date.now();
    record.usedByUserId = created.user.id;
    record.usedByUsername = created.user.username;
    saveCardKeys(data);

    const updated = userStore.extendMembership(created.user.id, record.value) || created.user;
    return {
        ok: true,
        user: userStore.publicUser(updated),
        key: {
            type: record.type,
            value: record.value,
            redeemedAt: record.usedAt,
            code: maskCode(record.code),
        },
    };
}

function registerUserWithCard(input: { username?: string; password?: string; qq?: string; code?: string; adminUsername?: string }) {
    return withLock(() => registerUserWithCardSync(input));
}

function getCardClaimStatus() {
    const config = authConfigStore.getAuthConfig();
    return { enabled: config.cardClaimEnabled, cardCode: config.claimCardCode || '' };
}

function claimFreeCardSync(deviceKey: string) {
    const config = authConfigStore.getAuthConfig();
    if (!config.cardClaimEnabled) {
        return { ok: false, error: '当前未开启免费卡密领取', status: 403 };
    }
    const key = String(deviceKey || '').trim() || 'anonymous';
    const claims = activeClaims();
    if (claims.some(item => item.deviceKey === key)) {
        return { ok: false, error: '每个设备只能领取一次卡密', status: 400 };
    }

    const cards = loadCardKeys();
    let record: CardKeyRecord | null = null;
    if (config.claimCardCode) {
        record = cards.keys.find(item => item.code === config.claimCardCode && item.status === 'unused') || null;
    } else {
        const reserved = new Set(claims.map(item => item.cardCode));
        record = cards.keys.find(item => item.type === 'time' && item.status === 'unused' && !reserved.has(item.code)) || null;
    }
    if (!record) return { ok: false, error: '暂无可领取的卡密', status: 400 };

    const now = Date.now();
    record.claimedByDevice = key;
    record.claimedAt = now;
    saveCardKeys(cards);

    saveClaims({
        records: claims.concat({
            id: crypto.randomBytes(8).toString('hex'),
            deviceKey: key,
            cardCode: record.code,
            days: record.value,
            createdAt: now,
        }),
    });
    return { ok: true, data: { cardCode: record.code, type: record.type, days: record.value } };
}

function claimFreeCard(deviceKey: string) {
    return withLock(() => claimFreeCardSync(deviceKey));
}

function listCardClaims() {
    return activeClaims().map(item => ({
        id: item.id,
        cardCode: maskCode(item.cardCode),
        days: item.days,
        deviceKey: item.deviceKey,
        createdAt: item.createdAt,
    }));
}

function clearExpiredCardClaims() {
    return withLock(() => {
        const active = activeClaims();
        saveClaims({ records: active });
        return active.length;
    });
}

function listUserRedeems(userId: string) {
    const id = String(userId || '');
    return loadCardKeys().keys
        .filter(item => item.status === 'used' && item.usedByUserId === id)
        .map(item => ({
            type: item.type,
            value: item.value,
            usedAt: item.usedAt || null,
            code: maskCode(item.code),
        }));
}

module.exports = {
    maskCode,
    createCardKeys,
    listCardKeys,
    voidCardKey,
    redeemCardKey,
    registerUserWithCard,
    getCardClaimStatus,
    claimFreeCard,
    listCardClaims,
    clearExpiredCardClaims,
    listUserRedeems,
    publicCardKey,
};
