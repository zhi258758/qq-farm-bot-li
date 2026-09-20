import type { Application, Request, Response } from 'express';
import type { AdminContext } from './context';
export {};

const userStore = require('../../models/user-store');
const authConfigStore = require('../../models/auth-config-store');
const cardkeyStore = require('../../models/cardkey-store');
const store = require('../../models/store');
const membershipGuard = require('../../services/membership-guard');

const {
    createAdminOnly,
    handleApiError,
    revokeSessionsByUser,
} = require('./middleware');

function withSlotUsed(user: any) {
    if (!user) return user;
    return {
        ...user,
        slotUsed: store.countOwnedAccounts ? store.countOwnedAccounts(user.id) : 0,
    };
}

function mountUserCardkeyRoutes(app: Application, ctx: AdminContext): void {
    const adminOnly = createAdminOnly();

    app.get('/api/admin/auth-config', adminOnly, (_req: Request, res: Response) => {
        res.json({ ok: true, data: authConfigStore.getAuthConfig() });
    });

    app.put('/api/admin/auth-config', adminOnly, (req: Request, res: Response) => {
        try {
            const body = (req.body && typeof req.body === 'object') ? req.body : {};
            const data = authConfigStore.setAuthConfig({
                registrationEnabled: body.registrationEnabled === true,
                cardClaimEnabled: body.cardClaimEnabled === true,
                claimCardCode: body.claimCardCode == null ? '' : String(body.claimCardCode),
            });
            res.json({ ok: true, data });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    app.get('/api/admin/card-claim/records', adminOnly, (_req: Request, res: Response) => {
        res.json({ ok: true, data: cardkeyStore.listCardClaims() });
    });

    app.get('/api/admin/users', adminOnly, (_req: Request, res: Response) => {
        const users = userStore.listUsers().map((user: any) => withSlotUsed(userStore.publicUser(user)));
        res.json({ ok: true, data: users });
    });

    app.patch('/api/admin/users/:id', adminOnly, (req: Request, res: Response) => {
        try {
            const body = (req.body && typeof req.body === 'object') ? req.body : {};
            const result = userStore.updateUserEntitlement(req.params.id, {
                membershipExpiresAt: body.membershipExpiresAt,
                slotLimit: body.slotLimit,
                enabled: body.enabled,
                qq: body.qq,
            });
            if (!result.ok) {
                return res.status(400).json({ ok: false, error: result.error });
            }
            if (body.enabled === false) {
                revokeSessionsByUser(ctx, String(req.params.id), 'user');
                if (ctx.provider && typeof ctx.provider.stopAccount === 'function') {
                    for (const accountId of membershipGuard.listBlockedOwnedAccountIds(req.params.id)) {
                        ctx.provider.stopAccount(accountId);
                    }
                }
            }
            res.json({ ok: true, data: withSlotUsed(result.user) });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    app.post('/api/admin/cardkeys', adminOnly, (req: Request, res: Response) => {
        const body = (req.body && typeof req.body === 'object') ? req.body : {};
        const result = cardkeyStore.createCardKeys({
            type: body.type,
            value: body.value,
            count: body.count,
        });
        if (!result.ok) {
            return res.status(400).json({ ok: false, error: result.error });
        }
        res.json({ ok: true, data: result.keys });
    });

    app.get('/api/admin/cardkeys', adminOnly, (req: Request, res: Response) => {
        const query = req.query || {};
        res.json({
            ok: true,
            data: cardkeyStore.listCardKeys({
                type: query.type,
                status: query.status,
                keyword: query.keyword,
            }),
        });
    });

    app.post('/api/admin/cardkeys/:code/void', adminOnly, (req: Request, res: Response) => {
        const result = cardkeyStore.voidCardKey(req.params.code);
        if (!result.ok) {
            return res.status(400).json({ ok: false, error: result.error });
        }
        res.json({ ok: true, data: result.key });
    });
}

module.exports = { mountUserCardkeyRoutes };
