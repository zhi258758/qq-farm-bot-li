import type { Application, Request, Response } from 'express';
import type { AdminContext } from './context';
export {};

/**
 * 公告管理路由。
 *
 * - GET  /api/announcement       公开读取公告（登录页无需登录）
 * - POST /api/announcement/read  标记已读（需登录）
 * - GET  /api/admin/announcement 管理员读取公告设置
 * - PUT  /api/admin/announcement 管理员保存公告
 */

const store = require('../../models/store');
const { createModuleLogger } = require('../../services/logger');
const { createAuthRequired, createAdminOnly } = require('./middleware');

const adminLogger = createModuleLogger('admin');

function mountAnnouncementRoutes(app: Application, ctx: AdminContext): void {
    const authRequired = createAuthRequired(ctx);
    const adminOnly = createAdminOnly();

    app.get('/api/announcement', (_req: Request, res: Response) => {
        try {
            res.json({ ok: true, data: store.getAnnouncement() });
        } catch (error: any) {
            res.status(500).json({ ok: false, error: error.message });
        }
    });

    app.post('/api/announcement/read', authRequired, (req: Request, res: Response) => {
        try {
            const username = (req as any).auth?.username;
            if (!username) {
                return res.status(401).json({ ok: false, error: '未登录' });
            }
            store.markAnnouncementRead(username);
            return res.json({ ok: true });
        } catch (error: any) {
            return res.status(500).json({ ok: false, error: error.message });
        }
    });

    app.get('/api/admin/announcement', authRequired, adminOnly, (_req: Request, res: Response) => {
        try {
            res.json({ ok: true, data: store.getAnnouncement() });
        } catch (error: any) {
            res.status(500).json({ ok: false, error: error.message });
        }
    });

    app.put('/api/admin/announcement', authRequired, adminOnly, (req: Request, res: Response) => {
        try {
            const body = (req.body && typeof req.body === 'object') ? req.body : {};
            const content = String(body.content || '');
            const showOnce = body.showOnce !== false;
            const enabled = body.enabled !== false;
            const saved = store.setAnnouncement(content, showOnce, enabled);
            adminLogger.warn('更新公告', {
                admin: (req as any).auth?.username || '',
                enabled: saved.enabled,
                showOnce: saved.showOnce,
                contentLength: saved.content.length,
            });
            res.json({ ok: true, data: saved });
        } catch (error: any) {
            res.status(500).json({ ok: false, error: error.message });
        }
    });
}

module.exports = { mountAnnouncementRoutes };
