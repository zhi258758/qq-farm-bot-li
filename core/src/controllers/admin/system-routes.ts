import type { Application, Request, Response } from 'express';
import type { AdminContext } from './context';
export {};

/**
 * 登录页设置、QQ 群验证等系统级管理路由。
 *
 * - GET    /api/public/login-links      公开读取登录页链接与图标
 * - GET    /api/admin/login-links       管理员读取登录页设置
 * - POST   /api/admin/login-links       管理员保存登录页设置
 * - POST   /api/admin/login-links/reset 管理员恢复默认登录页设置
 * - POST   /api/admin/login-logo        管理员上传登录图标
 * - GET    /api/admin/group-verify      管理员读取QQ群验证配置
 * - POST   /api/admin/group-verify      管理员保存QQ群验证配置
 * - POST   /api/admin/group-verify/test 管理员测试QQ群验证接口
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const store = require('../../models/store');
const userStore = require('../../models/user-store');
const { getDataFile } = require('../../config/runtime-paths');
const { createModuleLogger } = require('../../services/logger');
const { verifyGroupMembership } = require('../../services/group-verify');
const { createAuthRequired, createAdminOnly } = require('./middleware');

const adminLogger = createModuleLogger('admin');

const LOGIN_ASSETS_DIR = getDataFile('login-assets');
const LOGIN_LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGIN_LOGO_EXTENSIONS: Map<string, string> = new Map([
    ['image/png', '.png'],
    ['image/jpeg', '.jpg'],
    ['image/webp', '.webp'],
    ['image/gif', '.gif'],
    ['image/svg+xml', '.svg'],
    ['image/x-icon', '.ico'],
    ['image/vnd.microsoft.icon', '.ico'],
]);
const ALLOWED_LOGO_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.ico']);

function ensureLoginAssetsDir(): void {
    fs.mkdirSync(LOGIN_ASSETS_DIR, { recursive: true });
}

function deleteManagedLoginLogo(logoUrl: unknown): void {
    const prefix = '/login-assets/';
    const value = String(logoUrl || '');
    if (!value.startsWith(prefix)) return;
    const filename = path.basename(value.slice(prefix.length));
    if (!filename) return;
    try {
        fs.unlinkSync(path.join(LOGIN_ASSETS_DIR, filename));
    } catch {
        // ignore missing file
    }
}

function mountSystemRoutes(app: Application, ctx: AdminContext): void {
    const authRequired = createAuthRequired(ctx);
    const adminOnly = createAdminOnly();

    const isAllowedPublicLink = (value: unknown): boolean => {
        const link = String(value || '').trim();
        return !link
            || link.startsWith('/')
            || /^https?:\/\//i.test(link)
            || /^mqqapi:\/\//i.test(link);
    };

    const isAllowedImageLink = (value: unknown): boolean => {
        const link = String(value || '').trim();
        return !link || link.startsWith('/') || /^https?:\/\//i.test(link);
    };

    app.get('/api/public/login-links', (_req: Request, res: Response) => {
        try {
            res.json({ ok: true, data: store.getLoginLinks() });
        } catch (error: any) {
            res.status(500).json({ ok: false, error: error.message });
        }
    });

    app.get('/api/admin/login-links', authRequired, adminOnly, (_req: Request, res: Response) => {
        try {
            res.json({ ok: true, data: store.getLoginLinks() });
        } catch (error: any) {
            res.status(500).json({ ok: false, error: error.message });
        }
    });

    app.post('/api/admin/login-links', authRequired, adminOnly, (req: Request, res: Response) => {
        try {
            const { logoUrl, title, loginSubtitle, registerSubtitle, purchaseUrl, qqGroupUrl } = req.body || {};
            if (!isAllowedImageLink(logoUrl)) {
                return res.status(400).json({ ok: false, error: '登录图标地址仅支持 http(s) 或站内路径' });
            }
            if (!isAllowedPublicLink(purchaseUrl)) {
                return res.status(400).json({ ok: false, error: '购买/开通地址仅支持 http(s)、mqqapi 或站内路径' });
            }
            if (!isAllowedPublicLink(qqGroupUrl)) {
                return res.status(400).json({ ok: false, error: '加QQ群链接仅支持 http(s)、mqqapi 或站内路径' });
            }
            const clean = (value: unknown) => String(value ?? '').trim().slice(0, 200);
            const saved = store.setLoginLinks({
                logoUrl,
                title: clean(title),
                loginSubtitle: clean(loginSubtitle),
                registerSubtitle: clean(registerSubtitle),
                purchaseUrl,
                qqGroupUrl,
            });
            adminLogger.warn('更新登录页设置', {
                admin: (req as any).auth?.username || '',
                title: saved?.title || '',
                hasLogo: !!saved?.logoUrl,
                hasQqGroupUrl: !!saved?.qqGroupUrl,
            });
            return res.json({ ok: true, data: saved });
        } catch (error: any) {
            return res.status(500).json({ ok: false, error: error.message });
        }
    });

    app.post('/api/admin/login-links/reset', authRequired, adminOnly, (req: Request, res: Response) => {
        try {
            const current = store.getLoginLinks();
            deleteManagedLoginLogo(current.logoUrl);
            const saved = store.setLoginLinks({
                logoUrl: '',
                title: '',
                loginSubtitle: '',
                registerSubtitle: '',
                purchaseUrl: '',
                qqGroupUrl: '',
            });
            adminLogger.warn('重置登录页设置为默认值', { admin: (req as any).auth?.username || '' });
            res.json({ ok: true, data: saved });
        } catch (error: any) {
            res.status(500).json({ ok: false, error: error.message });
        }
    });

    app.post(
        '/api/admin/login-logo',
        authRequired,
        adminOnly,
        express.raw({ type: () => true, limit: LOGIN_LOGO_MAX_BYTES }),
        (req: Request, res: Response) => {
            try {
                const body = (req as any).body;
                const buffer: Buffer | undefined = Buffer.isBuffer(body) ? body : undefined;
                if (!buffer || buffer.length === 0) {
                    return res.status(400).json({ ok: false, error: '未收到图片文件' });
                }
                if (buffer.length > LOGIN_LOGO_MAX_BYTES) {
                    return res.status(400).json({ ok: false, error: '图片大小不能超过 2MB' });
                }
                const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
                const queryName = String((req.query as any).filename || '').trim();
                const extFromName = path.extname(queryName).toLowerCase();
                const ext = ALLOWED_LOGO_EXTENSIONS.has(extFromName)
                    ? (extFromName === '.jpeg' ? '.jpg' : extFromName)
                    : LOGIN_LOGO_EXTENSIONS.get(mime);
                if (!ext) {
                    return res.status(400).json({ ok: false, error: '仅支持 PNG、JPG、WebP、GIF、SVG 或 ICO 图片' });
                }
                ensureLoginAssetsDir();
                const filename = `${crypto.randomUUID()}${ext}`;
                fs.writeFileSync(path.join(LOGIN_ASSETS_DIR, filename), buffer);
                const current = store.getLoginLinks();
                const newLogoUrl = `/login-assets/${filename}`;
                const saved = store.setLoginLinks({ ...current, logoUrl: newLogoUrl });
                deleteManagedLoginLogo(current.logoUrl);
                adminLogger.warn('上传登录图标', { admin: (req as any).auth?.username || '', logoUrl: newLogoUrl });
                return res.json({ ok: true, data: saved });
            } catch (error: any) {
                return res.status(500).json({ ok: false, error: error.message });
            }
        },
    );

    app.get('/api/admin/group-verify', authRequired, adminOnly, (_req: Request, res: Response) => {
        try {
            res.json({ ok: true, data: store.getGroupVerifyConfig() });
        } catch (error: any) {
            res.status(500).json({ ok: false, error: error.message });
        }
    });

    app.post('/api/admin/group-verify', authRequired, adminOnly, (req: Request, res: Response) => {
        try {
            const { enabled, qqGroupNumber, verifyUrl, verifyToken, verifyMode, timeoutMs } = req.body || {};
            if (enabled === true) {
                const url = String(verifyUrl || '').trim();
                if (!url) {
                    return res.status(400).json({ ok: false, error: '启用群验证时必须填写验证接口地址' });
                }
                if (!/^https?:\/\//i.test(url)) {
                    return res.status(400).json({ ok: false, error: '验证接口地址必须以 http:// 或 https:// 开头' });
                }
                if (!String(qqGroupNumber || '').trim()) {
                    return res.status(400).json({ ok: false, error: '启用群验证时必须填写QQ群号' });
                }
            }
            const saved = store.setGroupVerifyConfig({
                enabled,
                qqGroupNumber,
                verifyUrl,
                verifyToken,
                verifyMode,
                timeoutMs,
            });
            adminLogger.warn('更新QQ群验证配置', {
                admin: (req as any).auth?.username || '',
                enabled: saved?.enabled === true,
                qqGroupNumber: saved?.qqGroupNumber || '',
                verifyUrl: saved?.verifyUrl || '',
                verifyMode: saved?.verifyMode || '',
            });
            return res.json({ ok: true, data: saved });
        } catch (error: any) {
            return res.status(500).json({ ok: false, error: error.message });
        }
    });

    app.post('/api/admin/group-verify/test', authRequired, adminOnly, async (req: Request, res: Response) => {
        try {
            const { qq } = req.body || {};
            const qqCheck = userStore.normalizeQq(qq);
            if (!qqCheck.ok) {
                return res.status(400).json({ ok: false, error: qqCheck.error });
            }
            const config = store.getGroupVerifyConfig();
            if (!String(config.verifyUrl || '').trim()) {
                return res.status(400).json({ ok: false, error: '请先填写并保存群机器人验证接口地址' });
            }
            const result = await verifyGroupMembership(qqCheck.data, config);
            adminLogger.warn('测试QQ群验证接口', {
                admin: (req as any).auth?.username || '',
                qq: qqCheck.data,
                qqGroupNumber: config.qqGroupNumber || '',
                inGroup: result.inGroup === true,
                error: result.error || '',
                durationMs: result.durationMs || 0,
            });
            return res.json({
                ok: true,
                data: {
                    qq: qqCheck.data,
                    qqGroupNumber: config.qqGroupNumber || '',
                    ...result,
                },
            });
        } catch (error: any) {
            return res.status(500).json({ ok: false, error: error.message });
        }
    });
}

module.exports = { mountSystemRoutes, LOGIN_ASSETS_DIR, ensureLoginAssetsDir };
