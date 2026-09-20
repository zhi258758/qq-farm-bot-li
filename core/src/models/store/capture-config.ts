export {};

/**
 * 抓包（Code/GID 抓取）服务配置存储。
 *
 * 保存于 store.json 的 captureConfig 字段，默认走进程内嵌入模式。
 */

const sharedState = require('./shared-state');
const globalConfig = sharedState.globalConfig;

const DEFAULT_CAPTURE_CONFIG = {
    enabled: false,
    embedded: true,
    apiBase: 'http://127.0.0.1:8450',
    apiToken: '',
    autoImportQqGids: true,
};

function normalizeCaptureConfig(input: any) {
    const src = (input && typeof input === 'object') ? input : {};
    const rawApiBase = String(src.apiBase || DEFAULT_CAPTURE_CONFIG.apiBase).trim();
    return {
        enabled: src.enabled === true,
        embedded: src.embedded !== false,
        apiBase: rawApiBase || DEFAULT_CAPTURE_CONFIG.apiBase,
        apiToken: String(src.apiToken || '').trim(),
        autoImportQqGids: src.autoImportQqGids !== false,
    };
}

function getCaptureConfig() {
    const normalized = normalizeCaptureConfig((globalConfig as any).captureConfig);
    (globalConfig as any).captureConfig = normalized;
    return { ...normalized };
}

function setCaptureConfig(cfg: any) {
    const current = getCaptureConfig();
    const next = normalizeCaptureConfig({ ...current, ...(cfg || {}) });
    (globalConfig as any).captureConfig = next;
    const { saveGlobalConfig } = require('./global-config');
    saveGlobalConfig();
    return { ...next };
}

module.exports = {
    DEFAULT_CAPTURE_CONFIG,
    getCaptureConfig,
    normalizeCaptureConfig,
    setCaptureConfig,
};
