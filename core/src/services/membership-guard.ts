export {};
const store = require('../models/store');
const userStore = require('../models/user-store');

const ADMIN_OWNER_ID = userStore.ADMIN_OWNER_ID;

function getOwnerUserId(account: any): string {
    return String(account?.ownerUserId || ADMIN_OWNER_ID).trim() || ADMIN_OWNER_ID;
}

function isAdminOwner(ownerUserId: string): boolean {
    return String(ownerUserId || '') === ADMIN_OWNER_ID;
}

function canUserOperate(userId: string): { ok: boolean; error?: string; status?: number } {
    if (isAdminOwner(userId)) return { ok: true };
    const user = userStore.getUser(userId);
    if (!user) return { ok: false, error: '用户不存在', status: 404 };
    if (!user.enabled) return { ok: false, error: '账号已被禁用', status: 403 };
    if (!userStore.isMembershipActive(user)) return { ok: false, error: '会员已过期，请兑换时间卡密', status: 403 };
    return { ok: true };
}

function canCreateGameAccount(userId: string): { ok: boolean; error?: string; status?: number } {
    if (isAdminOwner(userId)) return { ok: true };
    const operate = canUserOperate(userId);
    if (!operate.ok) return operate;
    const user = userStore.getUser(userId);
    const used = store.countOwnedAccounts(userId);
    if (used >= Number(user.slotLimit || 0)) {
        return { ok: false, error: '账号槽位不足', status: 400 };
    }
    return { ok: true };
}

function canStartGameAccount(account: any): { ok: boolean; error?: string; status?: number } {
    const ownerUserId = getOwnerUserId(account);
    return canUserOperate(ownerUserId);
}

function listRunnableAccounts(): any[] {
    const accounts = store.getAccounts()?.accounts || [];
    return accounts.filter((account: any) => canStartGameAccount(account).ok);
}

function listBlockedOwnedAccountIds(userId: string): string[] {
    if (isAdminOwner(userId)) return [];
    return (store.getAccounts()?.accounts || [])
        .filter((account: any) => getOwnerUserId(account) === String(userId))
        .map((account: any) => String(account.id || ''))
        .filter(Boolean);
}

module.exports = {
    ADMIN_OWNER_ID,
    getOwnerUserId,
    isAdminOwner,
    canUserOperate,
    canCreateGameAccount,
    canStartGameAccount,
    listRunnableAccounts,
    listBlockedOwnedAccountIds,
};
