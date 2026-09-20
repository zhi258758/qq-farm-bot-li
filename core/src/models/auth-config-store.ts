export {};
const { getDataFile, ensureDataDir } = require('../config/runtime-paths');
const { readJsonFile, writeJsonFileAtomic } = require('../services/json-db');

function authConfigFile(): string {
    return getDataFile('auth-config.json');
}

interface AuthConfig {
    registrationEnabled: boolean;
    cardClaimEnabled: boolean;
    updatedAt: number;
}

function defaultConfig(): AuthConfig {
    return {
        registrationEnabled: false,
        cardClaimEnabled: false,
        updatedAt: Date.now(),
    };
}

function normalizeConfig(raw: any): AuthConfig {
    const source = raw && typeof raw === 'object' ? raw : {};
    return {
        registrationEnabled: source.registrationEnabled === true,
        cardClaimEnabled: source.cardClaimEnabled === true,
        updatedAt: Number(source.updatedAt) || Date.now(),
    };
}

function loadConfig(): AuthConfig {
    ensureDataDir();
    return normalizeConfig(readJsonFile(authConfigFile(), defaultConfig));
}

function saveConfig(config: AuthConfig): AuthConfig {
    ensureDataDir();
    const next = normalizeConfig({ ...config, updatedAt: Date.now() });
    writeJsonFileAtomic(authConfigFile(), next);
    return next;
}

function getAuthConfig(): AuthConfig {
    return loadConfig();
}

function setAuthConfig(patch: Partial<AuthConfig>): AuthConfig {
    const current = loadConfig();
    return saveConfig({
        ...current,
        ...patch,
    });
}

module.exports = {
    getAuthConfig,
    setAuthConfig,
};
