import type { Application, Request, Response } from 'express';
import type { AdminContext } from './context';
export {};

const napcatLogin = require('../../services/napcat-login');
const { createAuthRequired, getRequestAuth } = require('./middleware');

function owner(req: Request): string {
    const auth = getRequestAuth(req);
    return String(auth?.username || auth?.userId || '').trim();
}

function sendError(res: Response, error: any): void {
    res.status(400).json({ ok: false, error: error?.message || 'NapCat 登录失败' });
}

function mountNapcatLoginRoutes(app: Application, ctx: AdminContext): void {
    app.use('/api/napcat-login', createAuthRequired(ctx));

    app.get('/api/napcat-login/capability', (_req: Request, res: Response) => {
        res.json({ ok: true, data: { enabled: napcatLogin.isConfigured() } });
    });

    app.post('/api/napcat-login/tasks', async (req: Request, res: Response) => {
        try {
            res.json({ ok: true, data: await napcatLogin.create(owner(req), { refresh: req.body?.refresh === true }) });
        } catch (error: any) {
            sendError(res, error);
        }
    });

    app.post('/api/napcat-login/tasks/:id/status', async (req: Request, res: Response) => {
        try {
            res.json({ ok: true, data: await napcatLogin.status(String(req.params.id || ''), owner(req)) });
        } catch (error: any) {
            sendError(res, error);
        }
    });

    app.post('/api/napcat-login/tasks/:id/code', async (req: Request, res: Response) => {
        try {
            const result = await napcatLogin.code(String(req.params.id || ''), owner(req));
            res.json({ ok: true, data: { ...result, appId: napcatLogin.APP_ID } });
        } catch (error: any) {
            sendError(res, error);
        }
    });

    app.post('/api/napcat-login/tasks/:id/cancel', async (req: Request, res: Response) => {
        try {
            await napcatLogin.cancel(String(req.params.id || ''), owner(req));
            res.json({ ok: true });
        } catch (error: any) {
            sendError(res, error);
        }
    });
}

module.exports = { mountNapcatLoginRoutes };
