export {};

/**
 * 抓包会话管理
 *
 * 每个会话对应一次抓包登录流程：
 * - 独立 MITM 代理端口
 * - 抓到的 code/openid
 * - 好友 GID 集合与来源
 * - 对外公布的代理地址
 */

function createSessionStore({ config }: any = {}) {
  const sessions = new Map<string, any>();

  function createSession(id: string, platform = 'qq') {
    const session: any = {
      id,
      platform: platform === 'wx' ? 'wx' : 'qq',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      cancelled: false,
      completed: false,
      code: '',
      openId: '',
      friendGids: new Set<number>(),
      friendSource: '',
      friendListComplete: false,
      proxy: {
        running: false,
        status: 'idle',
        error: '',
        port: 0,
        startedAt: '',
      },
      publicInfo: {
        host: '',
        addresses: [],
        mitmPort: 0,
        mitmProxyAutoStopSec: config.autoStopSec || 900,
        certUrl: '/cert/mitmproxy-ca-cert.cer',
      },
      bypassHosts: [],
    };
    sessions.set(id, session);
    return session;
  }

  function getSession(id: any) {
    return sessions.get(String(id || '')) || null;
  }

  function hasSession(id: any): boolean {
    return sessions.has(String(id || ''));
  }

  function deleteSession(id: any) {
    const key = String(id || '');
    const session = sessions.get(key);
    if (session && session.proxy && typeof session.proxy.stop === 'function') {
      try {
        session.proxy.stop();
      } catch { /* 忽略 */ }
    }
    sessions.delete(key);
  }

  function markUpdated(session: any) {
    session.updatedAt = Date.now();
  }

  /** 启动代理后记录代理信息 */
  function setProxyInfo(session: any, proxyInfo: any) {
    session.proxy = {
      running: proxyInfo.running === true,
      status: proxyInfo.status || 'running',
      error: proxyInfo.error || '',
      port: Number(proxyInfo.port) || 0,
      startedAt: proxyInfo.startedAt || new Date().toISOString(),
      stop: proxyInfo.stop || null,
    };
    session.publicInfo = {
      host: proxyInfo.host || '',
      addresses: Array.isArray(proxyInfo.addresses) ? proxyInfo.addresses : [],
      mitmPort: Number(proxyInfo.port) || 0,
      mitmProxyAutoStopSec: proxyInfo.autoStopSec || config.autoStopSec || 900,
      certUrl: proxyInfo.certUrl || '/cert/mitmproxy-ca-cert.cer',
    };
    if (Array.isArray(proxyInfo.bypassHosts)) session.bypassHosts = proxyInfo.bypassHosts;
    markUpdated(session);
  }

  function setProxyError(session: any, error: any) {
    if (!session.proxy) session.proxy = {};
    session.proxy.error = String(error || '');
    session.proxy.status = 'error';
    session.proxy.running = false;
    markUpdated(session);
  }

  /** 记录抓到的登录 code / openid */
  function addCode(session: any, { code = '', openId = '' }: any = {}) {
    let changed = false;
    const cleanCode = String(code || '').trim();
    const cleanOpenId = String(openId || '').trim();
    if (cleanCode && !session.code) {
      session.code = cleanCode;
      changed = true;
    }
    if (cleanOpenId && !session.openId) {
      session.openId = cleanOpenId;
      changed = true;
    }
    if (changed) markUpdated(session);
    return changed;
  }

  /** 记录好友 GID（去重） */
  function addFriendGids(session: any, { gids = [], source = '', complete = false }: any = {}) {
    let changed = false;
    for (const gid of Array.isArray(gids) ? gids : []) {
      const num = Number(gid);
      if (Number.isSafeInteger(num) && num > 0 && !session.friendGids.has(num)) {
        session.friendGids.add(num);
        changed = true;
      }
    }
    if (source) session.friendSource = source;
    if (complete) session.friendListComplete = true;
    if (changed || source || complete) markUpdated(session);
    return changed;
  }

  function getCodesArray(session: any) {
    if (!session.code && !session.openId) return [];
    return [{ code: session.code, gid: '', openid: session.openId }];
  }

  function buildSnapshot(session: any) {
    return {
      channels: {
        [session.platform]: {
          status: session.code ? 'captured' : (session.proxy.running ? 'running' : 'idle'),
          codes: getCodesArray(session),
        },
      },
      friends: {
        source: session.friendSource,
        items: [...session.friendGids].sort((a: number, b: number) => a - b).map((gid: number) => ({ gid: String(gid) })),
        complete: session.friendListComplete === true,
      },
      publicInfo: { ...session.publicInfo },
      proxy: {
        running: session.proxy.running === true,
        status: session.proxy.status || 'idle',
        error: session.proxy.error || '',
        startedAt: session.proxy.startedAt || '',
      },
      captured: !!session.code,
    };
  }

  function listSessions() {
    return [...sessions.keys()];
  }

  /** 清理过期会话 */
  function cleanupExpired() {
    const cutoff = Date.now() - (config.sessionTtlMs || 60 * 60 * 1000);
    for (const [id, session] of sessions) {
      if (session.updatedAt < cutoff && !session.completed) {
        deleteSession(id);
      }
    }
  }

  return {
    addCode,
    addFriendGids,
    buildSnapshot,
    cleanupExpired,
    createSession,
    deleteSession,
    getCodesArray,
    getSession,
    hasSession,
    listSessions,
    markUpdated,
    setProxyError,
    setProxyInfo,
  };
}

module.exports = { createSessionStore };
