export {};

/**
 * 登录页链接与图标配置存储。
 *
 * 保存于 store.json 的 loginLinks 字段，未配置时回落到默认值。
 */

const sharedState = require('./shared-state');
const globalConfig = sharedState.globalConfig;

const DEFAULT_LOGIN_LINKS = {
    logoUrl: '',
    title: 'QQ农场智能助手',
    loginSubtitle: '欢迎回来，开启智慧农耕之旅',
    registerSubtitle: '创建账号，开启智慧农耕之旅',
    purchaseUrl: '',
    qqGroupUrl: '',
};

function normalizeLoginLinks(input: any) {
    const src = (input && typeof input === 'object') ? input : {};
    return {
        logoUrl: String(src.logoUrl ?? '').trim(),
        title: String(src.title || DEFAULT_LOGIN_LINKS.title).trim() || DEFAULT_LOGIN_LINKS.title,
        loginSubtitle: String(src.loginSubtitle || DEFAULT_LOGIN_LINKS.loginSubtitle).trim(),
        registerSubtitle: String(src.registerSubtitle || DEFAULT_LOGIN_LINKS.registerSubtitle).trim(),
        purchaseUrl: String(src.purchaseUrl ?? '').trim(),
        qqGroupUrl: String(src.qqGroupUrl ?? '').trim(),
    };
}

function getLoginLinks() {
    const normalized = normalizeLoginLinks((globalConfig as any).loginLinks);
    (globalConfig as any).loginLinks = normalized;
    return { ...normalized };
}

function setLoginLinks(cfg: any) {
    const current = getLoginLinks();
    const next = normalizeLoginLinks({ ...current, ...(cfg || {}) });
    (globalConfig as any).loginLinks = next;
    const { saveGlobalConfig } = require('./global-config');
    saveGlobalConfig();
    return { ...next };
}

module.exports = {
    DEFAULT_LOGIN_LINKS,
    normalizeLoginLinks,
    getLoginLinks,
    setLoginLinks,
};
