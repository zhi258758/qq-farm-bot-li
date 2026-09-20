import type { Application, Request, Response } from 'express';
import type { AdminContext } from './context';
export {};

const { version } = require('../../../package.json');
const { getRuntimeConfig } = require('../../config/config');
const { getSchedulerRegistrySnapshot } = require('../../services/scheduler');
const { createModuleLogger } = require('../../services/logger');
const adminStore = require('../../models/admin-store');
const userStore = require('../../models/user-store');
const authConfigStore = require('../../models/auth-config-store');
const cardkeyStore = require('../../models/cardkey-store');
const store = require('../../models/store');
const { verifyGroupMembership } = require('../../services/group-verify');

const {
    getClientIp,
    createSession,
    revokeSession,
    revokeSessionsByUser,
    createAuthRequired,
    getAccId,
    handleApiError,
    getRequestAuth,
} = require('./middleware');

const adminLogger = createModuleLogger('admin');

function slotUsedOf(userId: string): number {
    return store.countOwnedAccounts ? store.countOwnedAccounts(userId) : 0;
}

function withSlotUsed(user: any) {
    if (!user) return user;
    return { ...user, slotUsed: slotUsedOf(user.id) };
}

function loginFailureStatus(errorType: string): number {
    if (errorType === 'rate_limit') return 429;
    if (errorType === 'locked') return 423;
    if (errorType === 'disabled') return 403;
    return 401;
}

async function checkGroupMembership(res: Response, qq: unknown, groupVerify: any): Promise<boolean> {
    const boundQq = String(qq || '').trim();
    const verification = await verifyGroupMembership(boundQq, groupVerify);
    if (verification.inGroup) return true;
    const unavailable = verification.error === 'service_unavailable';
    res.status(403).json({
        ok: false,
        error: unavailable ? 'QQ群验证服务暂不可用，请稍后再试' : '请先加入QQ群后再登录',
        code: 'NOT_IN_GROUP',
        qqGroupNumber: String(groupVerify.qqGroupNumber || ''),
        qq: boundQq,
    });
    return false;
}

function mountAuthRoutes(app: Application, ctx: AdminContext): void {
    const authRequired = createAuthRequired(ctx);

    app.get('/api/public/auth-config', (_req: Request, res: Response) => {
        const config = authConfigStore.getAuthConfig();
        res.json({
            ok: true,
            data: {
                registrationEnabled: config.registrationEnabled,
                cardClaimEnabled: config.cardClaimEnabled,
            },
        });
    });

    app.get('/api/game-version', (_req: Request, res: Response) => {
        res.json({ ok: true, clientVersion: getRuntimeConfig().clientVersion, botVersion: version });
    });

    app.get('/api/card-claim/status', (_req: Request, res: Response) => {
        const status = cardkeyStore.getCardClaimStatus();
        res.json({ ok: true, data: { enabled: status.enabled } });
    });

    app.post('/api/card-claim/claim', async (req: Request, res: Response) => {
        const userAgent = String(req.headers['user-agent'] || '').trim();
        const deviceKey = userAgent || getClientIp(req) || 'anonymous';
        const result = await cardkeyStore.claimFreeCard(deviceKey);
        if (!result.ok) {
            return res.status(result.status || 400).json({ ok: false, error: result.error });
        }
        return res.json({ ok: true, data: result.data });
    });

    app.post('/api/register', async (req: Request, res: Response) => {
        const config = authConfigStore.getAuthConfig();
        if (!config.registrationEnabled) {
            return res.status(403).json({ ok: false, error: '注册未开放' });
        }
        const { username, password, cardCode, qq } = req.body || {};
        const adminInfo = adminStore.getAdminInfo();

        const groupVerify = store.getGroupVerifyConfig ? store.getGroupVerifyConfig() : null;
        if (groupVerify && groupVerify.enabled === true) {
            const passed = await checkGroupMembership(res, qq, groupVerify);
            if (!passed) return;
        }

        const result = await cardkeyStore.registerUserWithCard({
            username: String(username || ''),
            password: String(password || ''),
            qq: String(qq == null ? '' : qq),
            code: String(cardCode || ''),
            adminUsername: adminInfo.username,
        });
        if (!result.ok) {
            return res.status(result.status || 400).json({ ok: false, error: result.error });
        }
        const session = createSession(ctx, {
            role: 'user',
            userId: result.user.id,
            username: result.user.username,
        });
        adminLogger.info('用户注册成功', { username: result.user.username, ip: getClientIp(req) });
        return res.json({
            ok: true,
            data: {
                token: session.token,
                role: 'user',
                user: withSlotUsed(result.user),
            },
        });
    });

    app.post('/api/login', async (req: Request, res: Response) => {
        const { username, password } = req.body || {};
        if (!username || !password) {
            return res.status(401).json({ ok: false, error: '请输入用户名和密码' });
        }

        const clientIp = getClientIp(req);
        const adminResult = adminStore.validateAdmin(String(username), String(password), clientIp);
        if (!adminResult?.error) {
            const session = createSession(ctx, {
                role: 'admin',
                userId: userStore.ADMIN_OWNER_ID,
                username: adminResult.username,
            });
            adminLogger.info('超级管理员登录成功', { username: adminResult.username, ip: clientIp });
            return res.json({
                ok: true,
                data: {
                    token: session.token,
                    role: 'admin',
                    user: { username: adminResult.username, role: 'admin' },
                    mustChangePassword: adminResult.mustChangePassword === true,
                },
            });
        }

        if (adminResult.error === 'rate_limit' || adminResult.error === 'locked') {
            adminLogger.warn('登录失败', { username, error: adminResult.error, ip: clientIp });
            return res.status(loginFailureStatus(adminResult.error)).json({
                ok: false,
                error: adminResult.message,
                errorType: adminResult.error,
                remainingMs: adminResult.remainingMs,
            });
        }

        const userResult = userStore.validateUser(String(username), String(password), clientIp);
        if (userResult?.error) {
            adminLogger.warn('登录失败', { username, error: userResult.error, ip: clientIp });
            return res.status(loginFailureStatus(userResult.error)).json({
                ok: false,
                error: userResult.message,
                errorType: userResult.error,
                remainingMs: userResult.remainingMs,
            });
        }

        const groupVerify = store.getGroupVerifyConfig ? store.getGroupVerifyConfig() : null;
        if (groupVerify && groupVerify.enabled === true) {
            const passed = await checkGroupMembership(res, userResult.qq, groupVerify);
            if (!passed) {
                adminLogger.warn('登录被QQ群验证拦截', { username, ip: clientIp });
                return;
            }
        }

        const session = createSession(ctx, {
            role: 'user',
            userId: userResult.id,
            username: userResult.username,
        });
        adminLogger.info('用户登录成功', { username: userResult.username, ip: clientIp });
        return res.json({
            ok: true,
            data: {
                token: session.token,
                role: 'user',
                user: withSlotUsed(userResult),
            },
        });
    });

    app.post('/api/user/change-password', authRequired, (req: Request, res: Response) => {
        const { oldPassword, newPassword } = req.body || {};
        if (!oldPassword || !newPassword) {
            return res.status(400).json({ ok: false, error: '请提供原密码和新密码' });
        }
        const auth = getRequestAuth(req);
        if (auth?.role === 'admin') {
            const result = adminStore.changePassword(String(oldPassword), String(newPassword));
            if (result.ok) revokeSessionsByUser(ctx, userStore.ADMIN_OWNER_ID, 'admin');
            return res.json(result);
        }
        const result = userStore.changeUserPassword(auth.userId, String(oldPassword), String(newPassword));
        if (result.ok) revokeSessionsByUser(ctx, auth.userId, 'user');
        return res.json(result);
    });

    app.use('/api', (req: Request, res: Response, next: any) => {
        if (req.path === '/login' || req.path === '/register' || req.path === '/game-version' || req.path === '/public/auth-config' || req.path === '/public/login-links' || req.path === '/announcement') {
            return next();
        }
        if (req.path.startsWith('/public/capture-certificate/')) {
            return next();
        }
        return authRequired(req, res, next);
    });

    const membershipAllowPaths = new Set([
        '/user/me',
        '/user/change-password',
        '/cardkeys/redeem',
        '/cardkeys/my-redeems',
        '/auth/validate',
        '/logout',
        '/ping',
    ]);
    app.use('/api', (req: Request, res: Response, next: any) => {
        const auth = getRequestAuth(req);
        if (!auth || auth.role !== 'user')
            return next();
        const user = userStore.getUser(auth.userId);
        if (userStore.isMembershipActive(user))
            return next();
        if (membershipAllowPaths.has(req.path))
            return next();
        return res.status(403).json({ ok: false, error: '会员已过期，请兑换时间卡密' });
    });

    app.get('/api/ping', (_req: Request, res: Response) => {
        res.json({ ok: true, data: { ok: true, uptime: process.uptime(), version } });
    });

    app.get('/api/auth/validate', (req: Request, res: Response) => {
        const auth = getRequestAuth(req);
        if (auth?.role === 'user') {
            const user = userStore.getUser(auth.userId);
            if (!user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
            return res.json({
                ok: true,
                data: {
                    valid: true,
                    role: 'user',
                    user: withSlotUsed(userStore.publicUser(user)),
                },
            });
        }
        return res.json({
            ok: true,
            data: {
                valid: true,
                role: 'admin',
                user: { ...adminStore.getAdminInfo(), role: 'admin', membershipActive: true },
            },
        });
    });

    app.get('/api/scheduler', async (req: Request, res: Response) => {
        try {
            const id = getAccId(ctx, req);
            if (ctx.provider && typeof ctx.provider.getSchedulerStatus === 'function') {
                const data = await ctx.provider.getSchedulerStatus(id);
                return res.json({ ok: true, data });
            }
            return res.json({
                ok: true,
                data: {
                    runtime: getSchedulerRegistrySnapshot(),
                    worker: null,
                    workerError: 'DataProvider does not support scheduler status',
                },
            });
        } catch (e: any) {
            return handleApiError(res, e);
        }
    });

    app.post('/api/logout', (req: Request, res: Response) => {
        const token = (req as any).adminToken;
        if (token) revokeSession(ctx, token);
        if (ctx.io && token) {
            for (const socket of ctx.io.sockets.sockets.values()) {
                if (String((socket.data as any).adminToken || '') === String(token)) socket.disconnect(true);
            }
        }
        res.json({ ok: true });
    });

    app.get('/api/user/me', (req: Request, res: Response) => {
        const auth = getRequestAuth(req);
        if (auth?.role === 'user') {
            const user = userStore.getUser(auth.userId);
            if (!user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
            return res.json({ ok: true, data: withSlotUsed(userStore.publicUser(user)) });
        }
        return res.json({ ok: true, data: adminStore.getAdminInfo() });
    });

    app.post('/api/cardkeys/redeem', async (req: Request, res: Response) => {
        const auth = getRequestAuth(req);
        if (auth?.role !== 'user') {
            return res.status(403).json({ ok: false, error: '仅普通用户可兑换卡密' });
        }
        const result = await cardkeyStore.redeemCardKey(auth.userId, String((req.body || {}).code || ''));
        if (!result.ok) {
            return res.status(result.status || 400).json({ ok: false, error: result.error });
        }
        return res.json({ ok: true, data: { user: withSlotUsed(result.user), key: result.key } });
    });

    app.get('/api/cardkeys/my-redeems', (req: Request, res: Response) => {
        const auth = getRequestAuth(req);
        if (auth?.role !== 'user') {
            return res.json({ ok: true, data: [] });
        }
        return res.json({ ok: true, data: cardkeyStore.listUserRedeems(auth.userId) });
    });
}

module.exports = { mountAuthRoutes };
