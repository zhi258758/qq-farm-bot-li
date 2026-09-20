export {};

/**
 * QQ 群验证配置存储。
 *
 * 保存于 store.json 的 groupVerify 字段，默认关闭。
 * verifyMode 为空时走通用 GET 接口，为 napcat 时走 NapCat 成员精确查询。
 */

const sharedState = require('./shared-state');
const globalConfig = sharedState.globalConfig;

const DEFAULT_GROUP_VERIFY_CONFIG = {
    enabled: false,
    qqGroupNumber: '',
    verifyUrl: '',
    verifyToken: '',
    verifyMode: '',
    timeoutMs: 5000,
};

function normalizeGroupVerifyMode(mode: unknown): string {
    return String(mode || '').trim().toLowerCase() === 'napcat' ? 'napcat' : '';
}

function normalizeGroupVerifyConfig(input: any) {
    const src = (input && typeof input === 'object') ? input : {};
    const timeout = Number(src.timeoutMs);
    return {
        enabled: src.enabled === true,
        qqGroupNumber: String(src.qqGroupNumber || '').trim(),
        verifyUrl: String(src.verifyUrl || '').trim(),
        verifyToken: String(src.verifyToken || '').trim(),
        verifyMode: normalizeGroupVerifyMode(src.verifyMode),
        timeoutMs: Math.max(1000, Math.min(15000, Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_GROUP_VERIFY_CONFIG.timeoutMs)),
    };
}

function getGroupVerifyConfig() {
    const normalized = normalizeGroupVerifyConfig((globalConfig as any).groupVerify);
    (globalConfig as any).groupVerify = normalized;
    return { ...normalized };
}

function setGroupVerifyConfig(cfg: any) {
    const current = getGroupVerifyConfig();
    const src = (cfg && typeof cfg === 'object') ? cfg : {};
    const timeout = Number(src.timeoutMs);
    const incomingToken = String(src.verifyToken ?? '').trim();
    const next = {
        enabled: src.enabled === true,
        qqGroupNumber: String(src.qqGroupNumber ?? current.qqGroupNumber).trim(),
        verifyUrl: String(src.verifyUrl ?? current.verifyUrl).trim(),
        verifyToken: incomingToken || current.verifyToken,
        verifyMode: normalizeGroupVerifyMode(src.verifyMode),
        timeoutMs: Math.max(1000, Math.min(15000, (Number.isFinite(timeout) && timeout > 0) ? timeout : (current.timeoutMs || DEFAULT_GROUP_VERIFY_CONFIG.timeoutMs))),
    };
    (globalConfig as any).groupVerify = next;
    const { saveGlobalConfig } = require('./global-config');
    saveGlobalConfig();
    return { ...next };
}

module.exports = {
    DEFAULT_GROUP_VERIFY_CONFIG,
    normalizeGroupVerifyMode,
    normalizeGroupVerifyConfig,
    getGroupVerifyConfig,
    setGroupVerifyConfig,
};
