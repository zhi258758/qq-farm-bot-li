export {};

/**
 * QQ 群成员校验服务。
 *
 * 支持两种模式：
 * - 通用 GET 接口（verifyUrl + ?qq=&group=），响应约定 inGroup/ok+data 语义
 * - NapCat / OneBot11 正向 HTTP（POST /get_group_member_info 精确查询单成员）
 */

const fetch = require('node-fetch');

const DEFAULT_TIMEOUT_MS = 5000;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 15000;
const NAPCAT_MEMBER_INFO_PATH = '/get_group_member_info';
const NAPCAT_NON_MEMBER_RE = /不存在|未找到|not.*(?:found|member)|不在群/i;

function normalizeVerifyMode(mode: unknown): string {
    return String(mode || '').trim().toLowerCase() === 'napcat' ? 'napcat' : '';
}

function verifyClampTimeout(value: unknown): number {
    return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, Number(value) || DEFAULT_TIMEOUT_MS));
}

async function requestWithTimeout(url: string, options: any, timeoutMs: number): Promise<any> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

/* 通用 GET 群成员校验接口（verifyUrl + ?qq=&group=） */
async function verifyGenericMembership(qq: unknown, config: any): Promise<any> {
    const verifyUrl = String((config && config.verifyUrl) || '').trim();
    const qqNumber = String(qq || '').trim();
    if (!verifyUrl) return { inGroup: false, error: 'not_configured' };
    if (!qqNumber) return { inGroup: false, error: 'no_qq' };

    const timeoutMs = verifyClampTimeout(config.timeoutMs);
    const startedAt = Date.now();
    let requestUrl = '';
    try {
        const url = new URL(verifyUrl);
        url.searchParams.set('qq', qqNumber);
        const group = String((config && config.qqGroupNumber) || '').trim();
        if (group) url.searchParams.set('group', group);
        requestUrl = url.toString();
        const headers: Record<string, string> = {};
        const token = String((config && config.verifyToken) || '').trim();
        if (token) headers.Authorization = `Bearer ${token}`;
        const response = await requestWithTimeout(requestUrl, { method: 'GET', headers, redirect: 'follow' }, timeoutMs);
        const durationMs = Date.now() - startedAt;
        if (!response.ok) {
            return { inGroup: false, error: 'service_unavailable', httpStatus: response.status, requestUrl, durationMs };
        }
        const text = await response.text();
        let data: any;
        try {
            data = JSON.parse(text);
        } catch {
            data = undefined;
        }
        if (typeof data === 'undefined') {
            return {
                inGroup: false,
                error: 'invalid_response',
                httpStatus: response.status,
                responseBody: String(text).slice(0, 500),
                requestUrl,
                durationMs,
            };
        }
        const inGroup = !!(
            data &&
            (data.inGroup === true
                || (data.ok === true && data.data === true)
                || (data.data && data.data.inGroup === true))
        );
        return {
            inGroup,
            error: inGroup ? '' : 'not_in_group',
            httpStatus: response.status,
            responseBody: data,
            requestUrl,
            durationMs,
        };
    } catch (err: any) {
        return {
            inGroup: false,
            error: 'service_unavailable',
            errorMessage: err && err.name === 'AbortError'
                ? `请求超时（${timeoutMs}ms）`
                : String((err && err.message) || err),
            requestUrl,
            durationMs: Date.now() - startedAt,
        };
    }
}

function napcatErrorKind(message: unknown): string {
    return NAPCAT_NON_MEMBER_RE.test(String(message || '')) ? 'not_in_group' : 'service_unavailable';
}

async function verifyNapcatMembership(qq: unknown, config: any): Promise<any> {
    const baseUrl = String((config && config.verifyUrl) || '').trim().replace(/\/+$/, '');
    const qqNumber = String(qq || '').trim();
    if (!baseUrl) return { inGroup: false, error: 'not_configured' };
    if (!qqNumber) return { inGroup: false, error: 'no_qq' };
    const group = String((config && config.qqGroupNumber) || '').trim();
    if (!group) return { inGroup: false, error: 'no_group' };

    const timeoutMs = verifyClampTimeout(config.timeoutMs);
    const startedAt = Date.now();
    const requestUrl = baseUrl + NAPCAT_MEMBER_INFO_PATH;
    try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        const token = String((config && config.verifyToken) || '').trim();
        if (token) headers.Authorization = `Bearer ${token}`;
        const body = { group_id: Number(group), user_id: Number(qqNumber) };
        const response = await requestWithTimeout(
            requestUrl,
            { method: 'POST', headers, body: JSON.stringify(body), redirect: 'follow' },
            timeoutMs,
        );
        const durationMs = Date.now() - startedAt;
        if (!response.ok) {
            return { inGroup: false, error: 'service_unavailable', httpStatus: response.status, requestUrl, durationMs };
        }
        const text = await response.text();
        let payload: any;
        try {
            payload = JSON.parse(text);
        } catch {
            payload = undefined;
        }
        if (typeof payload === 'undefined') {
            return {
                inGroup: false,
                error: 'invalid_response',
                httpStatus: response.status,
                responseBody: String(text).slice(0, 500),
                requestUrl,
                durationMs,
            };
        }
        const member = payload.status === 'ok'
            && Number(payload.retcode) === 0
            && payload.data
            && typeof payload.data === 'object';
        if (member) {
            return {
                inGroup: true,
                error: '',
                httpStatus: response.status,
                responseBody: payload.data,
                requestUrl,
                durationMs,
            };
        }
        const message = String((payload && payload.message) || '');
        return {
            inGroup: false,
            error: napcatErrorKind(message),
            errorMessage: message ? `NapCat 返回错误：${message}` : '无法从 NapCat 获取群成员信息',
            httpStatus: response.status,
            responseBody: payload,
            requestUrl,
            durationMs,
        };
    } catch (err: any) {
        return {
            inGroup: false,
            error: 'service_unavailable',
            errorMessage: err && err.name === 'AbortError'
                ? `请求超时（${timeoutMs}ms）`
                : String((err && err.message) || err),
            requestUrl,
            durationMs: Date.now() - startedAt,
        };
    }
}

async function verifyGroupMembership(qq: unknown, config: any): Promise<any> {
    if (config && normalizeVerifyMode(config.verifyMode) === 'napcat') {
        return verifyNapcatMembership(qq, config);
    }
    return verifyGenericMembership(qq, config);
}

module.exports = {
    normalizeVerifyMode,
    verifyClampTimeout,
    verifyGenericMembership,
    verifyNapcatMembership,
    verifyGroupMembership,
};
