export {};

/**
 * 抓包服务入口
 *
 * 提供两种运行方式：
 * - 嵌入模式（默认）：createCaptureCore() 在 bot 进程内运行；
 * - 独立模式：startCaptureServer() 额外启动 Express 监听独立端口。
 */

const { loadConfig } = require('./config');
const { createLogger } = require('./logger');
const {
  getCaCertDer,
  getSecureContextForHost,
  loadOrCreateRootCa,
} = require('./ca');
const { createSessionStore } = require('./session-store');
const { createMitmProxyManager } = require('./mitm-proxy');
const { createCaptureApi } = require('./api-server');
const { createFriendExtractor } = require('./friend-extractor');

/** 组合并导出 CA 模块接口（供代理管理器使用） */
function buildCaModule(ca: any) {
  return {
    getSecureContextForHost: (host: string) => getSecureContextForHost(ca, host),
    getCaCertDer: () => getCaCertDer(ca),
  };
}

/** 创建抓包服务核心（不监听任何端口，可嵌入 bot 进程） */
function createCaptureCore(options: any = {}) {
  const { config, dataDir } = loadConfig(options);
  const log = options.log || createLogger(config.logLevel);

  const rootCa = loadOrCreateRootCa(dataDir);
  const ca = buildCaModule(rootCa);
  const sessionStore = createSessionStore({ config });

  let proxyManager: any = null;
  let cleanupTimer: any = null;
  let stopRequested = false;

  const ready = (async () => {
    const friendExtractor = await createFriendExtractor();
    proxyManager = createMitmProxyManager({ config, ca, friendExtractor, sessionStore, log });
    log('info', '好友 GID 提取器就绪（proto 加载完成）');
  })();
  ready.catch((error: any) => {
    log('error', `抓包服务初始化失败: ${error.message}`);
  });

  const api = createCaptureApi({
    config,
    ca,
    sessionStore,
    proxyManager: {
      startForSession: (...args: any[]) => ready.then(() => proxyManager.startForSession(...args)),
      stopForSession: (...args: any[]) => ready.then(() => proxyManager.stopForSession(...args)),
    },
    log,
  });

  cleanupTimer = setInterval(() => {
    sessionStore.cleanupExpired();
  }, 60_000);
  if (cleanupTimer.unref) cleanupTimer.unref();

  async function stop() {
    if (stopRequested) return;
    stopRequested = true;
    if (cleanupTimer) clearInterval(cleanupTimer);
    await ready;
    for (const id of sessionStore.listSessions()) {
      const session = sessionStore.getSession(id);
      if (session) await proxyManager.stopForSession(session);
    }
    log('info', '抓包服务核心已停止');
  }

  return {
    config,
    dataDir,
    log,
    ready,
    ca,
    sessionStore,
    get proxyManager() { return proxyManager; },
    api,
    handleApiRequest: async (method: string, path: string, body?: any, context?: any) => {
      await ready;
      return api.handleApiRequest(method, path, body, context);
    },
    getCaCertDer: () => api.getCaCertDer(),
    stop,
  };
}

/** 启动独立抓包服务（监听 API 端口） */
async function startCaptureServer(options: any = {}) {
  const core = createCaptureCore(options);
  await core.ready;
  await core.api.start();

  return {
    config: core.config,
    dataDir: core.dataDir,
    stop: core.stop,
    apiServer: core.api,
    sessionStore: core.sessionStore,
    proxyManager: core.proxyManager,
    ca: core.ca,
    log: core.log,
  };
}

module.exports = {
  buildCaModule,
  createCaptureCore,
  startCaptureServer,
};
