export {};
const { getDataFile, ensureDataDir } = require('../config/runtime-paths');
const { readJsonFile, writeJsonFileAtomic } = require('../services/json-db');
const security = require('./auth-security');

const DEFAULT_SLOT_LIMIT = 2;
const DAY_MS = 24 * 60 * 60 * 1000;
const ADMIN_OWNER_ID = 'admin';
const QQ_RE = /^\d{5,11}$/;

interface UserRecord {
    id: string;
    username: string;
    password: string;
    qq: string;
    role: 'user';
    enabled: boolean;
    membershipExpiresAt: number | null;
    slotLimit: number;
    createdAt: number;
    updatedAt: number;
}

interface UsersData {
    users: UserRecord[];
    nextId: number;
}

function nowMs(): number {
    return Date.now();
}

function normalizeUser(raw: any): UserRecord | null {
    if (!raw || typeof raw !== 'object') return null;
    const username = String(raw.username || '').trim();
    const password = String(raw.password || '');
    if (!username || !password) return null;
    const slotLimit = Number.parseInt(raw.slotLimit, 10);
    const membershipExpiresAt = raw.membershipExpiresAt == null || raw.membershipExpiresAt === ''
        ? null
        : Number(raw.membershipExpiresAt);
    return {
        id: String(raw.id || ''),
        username,
        password,
        qq: String(raw.qq || '').trim(),
        role: 'user',
        enabled: raw.enabled !== false,
        membershipExpiresAt: Number.isFinite(membershipExpiresAt as number) ? membershipExpiresAt : null,
        slotLimit: Number.isFinite(slotLimit) && slotLimit >= 0 ? slotLimit : DEFAULT_SLOT_LIMIT,
        createdAt: Number(raw.createdAt) || nowMs(),
        updatedAt: Number(raw.updatedAt) || nowMs(),
    };
}

function normalizeUsersData(raw: unknown): UsersData {
    const data: any = raw && typeof raw === 'object' ? raw : {};
    const users = (Array.isArray(data.users) ? data.users : []).map(normalizeUser).filter(Boolean) as UserRecord[];
    const maxId = users.reduce((m, user) => Math.max(m, Number.parseInt(user.id, 10) || 0), 0);
    let nextId = Number.parseInt(data.nextId, 10);
    if (!Number.isFinite(nextId) || nextId <= 0) nextId = maxId + 1;
    if (nextId <= maxId) nextId = maxId + 1;
    return { users, nextId };
}

function usersFile(): string {
    return getDataFile('users.json');
}

function loadUsers(): UsersData {
    ensureDataDir();
    return normalizeUsersData(readJsonFile(usersFile(), () => ({ users: [], nextId: 1 })));
}

function saveUsers(data: UsersData): UsersData {
    ensureDataDir();
    const normalized = normalizeUsersData(data);
    writeJsonFileAtomic(usersFile(), normalized);
    return normalized;
}

function getUser(userId: string): UserRecord | null {
    const id = String(userId || '');
    if (!id) return null;
    return loadUsers().users.find(user => user.id === id) || null;
}

function getUserByUsername(username: string): UserRecord | null {
    const name = String(username || '').trim();
    if (!name) return null;
    return loadUsers().users.find(user => user.username === name) || null;
}

function isMembershipActive(user: UserRecord | null, at: number = nowMs()): boolean {
    if (!user || user.enabled === false) return false;
    return typeof user.membershipExpiresAt === 'number' && user.membershipExpiresAt > at;
}

function computeNewExpiry(currentExpiry: number | null, days: number, at: number = nowMs()): number {
    const amount = Math.max(0, Number(days) || 0) * DAY_MS;
    const base = currentExpiry && currentExpiry > at ? currentExpiry : at;
    return base + amount;
}

function publicUser(user: UserRecord, extra: Record<string, unknown> = {}) {
    return {
        id: user.id,
        username: user.username,
        qq: user.qq || '',
        role: user.role,
        enabled: user.enabled,
        membershipExpiresAt: user.membershipExpiresAt,
        membershipActive: isMembershipActive(user),
        slotLimit: user.slotLimit,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        ...extra,
    };
}

function validateUsername(username: string): { ok: boolean; error?: string } {
    const name = String(username || '').trim();
    if (!name) return { ok: false, error: '请输入用户名' };
    if (name.length < 3) return { ok: false, error: '用户名至少3位' };
    if (name.length > 32) return { ok: false, error: '用户名最多32位' };
    if (!/^\w+$/.test(name)) return { ok: false, error: '只能包含字母、数字、下划线' };
    return { ok: true };
}

function normalizeQq(rawQq: unknown): { ok: boolean; data?: string; error?: string } {
    const qq = String(rawQq == null ? '' : rawQq).trim();
    if (!qq) return { ok: false, error: '请输入QQ号' };
    if (!QQ_RE.test(qq)) return { ok: false, error: 'QQ号格式不正确，应为5-11位数字' };
    return { ok: true, data: qq };
}

function registerUser(
    username: string,
    password: string,
    options: { adminUsername?: string; qq?: string } | string = {},
): { ok: boolean; user?: any; error?: string; status?: number } {
    const opts = typeof options === 'string' ? { adminUsername: options } : (options || {});
    const nameCheck = validateUsername(username);
    if (!nameCheck.ok) return { ok: false, error: nameCheck.error, status: 400 };
    const pwd = String(password || '');
    if (!pwd) return { ok: false, error: '请输入密码', status: 400 };

    const qqCheck = normalizeQq(opts.qq == null ? '' : opts.qq);
    if (!qqCheck.ok) return { ok: false, error: qqCheck.error, status: 400 };

    const name = String(username).trim();
    if (name === String(opts.adminUsername || 'admin')) {
        return { ok: false, error: '用户名已被占用', status: 409 };
    }

    const data = loadUsers();
    if (data.users.some(user => user.username === name)) {
        return { ok: false, error: '用户名已被占用', status: 409 };
    }

    const user: UserRecord = {
        id: String(data.nextId++),
        username: name,
        password: security.hashPassword(pwd),
        qq: qqCheck.data as string,
        role: 'user',
        enabled: true,
        membershipExpiresAt: null,
        slotLimit: DEFAULT_SLOT_LIMIT,
        createdAt: nowMs(),
        updatedAt: nowMs(),
    };
    data.users.push(user);
    saveUsers(data);
    return { ok: true, user: publicUser(user, { slotUsed: 0 }) };
}

function removeUser(userId: string): boolean {
    const id = String(userId || '');
    if (!id) return false;
    const data = loadUsers();
    const index = data.users.findIndex(user => user.id === id);
    if (index < 0) return false;
    data.users.splice(index, 1);
    saveUsers(data);
    return true;
}

function validateUser(username: string, password: string, ip = 'unknown'): any {
    security.loadLoginAttempts();
    const rateLimit = security.checkRateLimit(ip);
    if (!rateLimit.allowed) return { error: 'rate_limit', ...rateLimit };

    const name = String(username || '').trim();
    const attemptKey = `user:${name || 'unknown'}`;
    const lockout = security.checkLockout(attemptKey);
    if (lockout.locked) return { error: 'locked', ...lockout };

    const user = getUserByUsername(name);
    if (!user || !security.verifyPassword(String(password || ''), user.password)) {
        const attempt = security.recordFailedAttempt(attemptKey);
        return attempt.locked
            ? { error: 'locked', message: attempt.message }
            : { error: 'invalid_credentials', message: `用户名或密码错误，剩余尝试次数: ${attempt.remainingAttempts}` };
    }
    if (!user.enabled) {
        return { error: 'disabled', message: '账号已被禁用' };
    }

    security.clearFailedAttempts(attemptKey);
    if (security.needsRehash(user.password)) {
        const data = loadUsers();
        const current = data.users.find(item => item.id === user.id);
        if (current) {
            current.password = security.hashPassword(String(password || ''));
            current.updatedAt = nowMs();
            saveUsers(data);
            user.password = current.password;
        }
    }
    return publicUser(user);
}

function changeUserPassword(userId: string, oldPassword: string, newPassword: string): { ok: boolean; error?: string; message?: string } {
    const data = loadUsers();
    const user = data.users.find(item => item.id === String(userId || ''));
    if (!user) return { ok: false, error: '用户不存在' };
    if (!security.verifyPassword(String(oldPassword || ''), user.password)) return { ok: false, error: '当前密码错误' };
    if (!String(newPassword || '')) return { ok: false, error: '请输入新密码' };
    user.password = security.hashPassword(String(newPassword));
    user.updatedAt = nowMs();
    saveUsers(data);
    return { ok: true, message: '密码修改成功' };
}

function extendMembership(userId: string, days: number): UserRecord | null {
    const data = loadUsers();
    const user = data.users.find(item => item.id === String(userId || ''));
    if (!user) return null;
    user.membershipExpiresAt = computeNewExpiry(user.membershipExpiresAt, days);
    user.updatedAt = nowMs();
    saveUsers(data);
    return user;
}

function addQuota(userId: string, slots: number): UserRecord | null {
    const data = loadUsers();
    const user = data.users.find(item => item.id === String(userId || ''));
    if (!user) return null;
    const amount = Number.parseInt(String(slots), 10);
    if (!Number.isFinite(amount) || amount <= 0) return user;
    user.slotLimit += amount;
    user.updatedAt = nowMs();
    saveUsers(data);
    return user;
}

function updateUserEntitlement(userId: string, patch: { membershipExpiresAt?: number | null; slotLimit?: number; enabled?: boolean; qq?: string }): { ok: boolean; user?: any; error?: string } {
    const data = loadUsers();
    const user = data.users.find(item => item.id === String(userId || ''));
    if (!user) return { ok: false, error: '用户不存在' };
    if (patch.qq !== undefined) {
        const qqCheck = normalizeQq(patch.qq);
        if (!qqCheck.ok) return { ok: false, error: qqCheck.error };
        user.qq = qqCheck.data as string;
    }
    if (patch.membershipExpiresAt !== undefined) {
        if (patch.membershipExpiresAt == null || patch.membershipExpiresAt === ('' as any)) {
            user.membershipExpiresAt = null;
        } else {
            const value = Number(patch.membershipExpiresAt);
            if (!Number.isFinite(value)) return { ok: false, error: '会员到期时间无效' };
            user.membershipExpiresAt = value;
        }
    }
    if (patch.slotLimit !== undefined) {
        const value = Number.parseInt(String(patch.slotLimit), 10);
        if (!Number.isFinite(value) || value < 0) return { ok: false, error: '槽位上限无效' };
        user.slotLimit = value;
    }
    if (patch.enabled !== undefined) {
        user.enabled = patch.enabled === true;
    }
    user.updatedAt = nowMs();
    saveUsers(data);
    return { ok: true, user: publicUser(user) };
}

function listUsers(): UserRecord[] {
    return loadUsers().users;
}

module.exports = {
    ADMIN_OWNER_ID,
    DEFAULT_SLOT_LIMIT,
    DAY_MS,
    QQ_RE,
    loadUsers,
    getUser,
    getUserByUsername,
    isMembershipActive,
    computeNewExpiry,
    publicUser,
    validateUsername,
    normalizeQq,
    registerUser,
    removeUser,
    validateUser,
    changeUserPassword,
    extendMembership,
    addQuota,
    updateUserEntitlement,
    listUsers,
};
