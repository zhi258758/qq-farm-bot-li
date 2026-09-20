export {};

/**
 * 选择性 MITM 代理
 *
 * 每次抓包会话只使用配置的单个代理端口（默认 18000），按配置的 IP 监听：
 * - CONNECT 到抓取域名（captureHosts）→ TLS 中间人，提取登录 code，
 *   升级为 WebSocket 后解析二进制帧提取好友 GID；
 * - CONNECT 到其他域名（含 bypassHosts）→ 原始 TCP 隧道（不解密）；
 * - 明文 HTTP（绝对 URL 形式）→ 直接转发。
 */

const net = require('node:net');
const tls = require('node:tls');
const { extractLoginInfo, isCaptureHost, parseHttpHead } = require('./code-extractor');
const { WsFrameParser } = require('./ws-parser');

const MAX_CONNECT_HEAD_BYTES = 64 * 1024;

const CONNECT_RE = /^CONNECT$/i;
const BRACKETED_IP_RE = /^\[|\]$/g;
const ABSOLUTE_URL_RE = /^https?:\/\//i;
const WHITESPACE_RE = /\s+/;
const HTTP_101_RE = /^HTTP\/1\.[01]\s+101/i;
const HANDSHAKE_TIMEOUT_MS = 15_000;

function parseConnectLine(firstLine: any) {
  const parts = String(firstLine || '').split(WHITESPACE_RE);
  if (parts.length < 2 || !CONNECT_RE.test(parts[0])) return null;
  const target = parts[1];
  const lastColon = target.lastIndexOf(':');
  if (lastColon <= 0 || lastColon === target.length - 1) return null;
  let host = target.slice(0, lastColon).replace(BRACKETED_IP_RE, '');
  const port = Number.parseInt(target.slice(lastColon + 1), 10);
  if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) return null;
  host = host.split('@').pop();
  return { host, port };
}

/** 解析绝对 URL（明文 HTTP 代理形式） */
function parseAbsoluteUrl(target: any) {
  if (!target || !ABSOLUTE_URL_RE.test(target)) return null;
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return null;
  }
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : (url.protocol === 'https:' ? 443 : 80),
    path: `${url.pathname}${url.search}`,
    isHttps: url.protocol === 'https:',
  };
}

/** 查找请求头结束位置（body 起始偏移），支持 \r\n\r\n 与 \n\n，未找到返回 -1 */
function findHeadEnd(buffer: Buffer): number {
  const crlf = buffer.indexOf('\r\n\r\n');
  if (crlf >= 0) return crlf + 4;
  const lf = buffer.indexOf('\n\n');
  if (lf >= 0) return lf + 2;
  return -1;
}

/** 将明文代理的绝对 URL 请求行重写为 origin-form（供上游直接访问） */
function rewriteAbsoluteRequest(head: string, path: string): string {
  const lines = String(head || '').replace(/[\r\n]+$/, '').split(/\r?\n/);
  const parts = (lines[0] || '').split(WHITESPACE_RE);
  const requestLine = [parts[0], path || '/', parts[2] || 'HTTP/1.1'].join(' ');
  return [requestLine, ...lines.slice(1)].join('\r\n');
}

function createMitmProxyManager(deps: any = {}) {
  const { config, ca, friendExtractor, sessionStore, log = () => {} } = deps;
  const activeServers = new Map<string, any>();

  async function listenOnConfiguredPort(bindTargets: string[], handler: any) {
    const port = Number(config.proxyPortFrom) || 18000;
    const servers: any[] = [];

    for (const bindIp of bindTargets) {
      const server = net.createServer(handler);
      server.on('error', () => {});
      try {
        await new Promise<void>((resolve, reject) => {
          const onError = (error: any) => {
            server.removeListener('listening', onListening);
            reject(error);
          };
          const onListening = () => {
            server.removeListener('error', onError);
            resolve();
          };
          server.once('error', onError);
          server.once('listening', onListening);
          server.listen(port, bindIp);
        });
        servers.push(server);
      } catch (error: any) {
        for (const s of servers) s.close();
        throw new Error(`代理端口 ${port} 不可用: ${error.message}`);
      }
    }

    return { port, servers };
  }

  /** 为一个会话启动 MITM 代理 */
  async function startForSession(session: any, { bypassHosts = [] }: any = {}) {
    await stopForSession(session);

    const bypass: string[] = Array.isArray(bypassHosts)
      ? bypassHosts.map(h => String(h || '').toLowerCase().replace(BRACKETED_IP_RE, '')).filter(Boolean)
      : [];

    const bindTargets = Array.isArray(config.proxyBind) && config.proxyBind.length > 0
      ? config.proxyBind
      : ['0.0.0.0'];

    const handler = (rawSocket: any) => handleClient(rawSocket, session, bypass);

    const { port, servers } = await listenOnConfiguredPort(bindTargets, handler);
    const startedAt = new Date().toISOString();

    const entry: any = { port, servers, startedAt, autoStopTimer: null };
    const stop = () => {
      if (entry.autoStopTimer) clearTimeout(entry.autoStopTimer);
      for (const server of servers) server.close();
      if (activeServers.get(session.id) === entry) activeServers.delete(session.id);
    };
    entry.stop = stop;
    activeServers.set(session.id, entry);

    const autoStopMs = (config.autoStopSec || 900) * 1000;
    entry.autoStopTimer = setTimeout(() => {
      log('info', `抓包代理自动停止: 会话 ${session.id}`, { sessionId: session.id });
      stop();
    }, autoStopMs);
    if (entry.autoStopTimer.unref) entry.autoStopTimer.unref();

    log('info', `抓包代理已启动: 端口 ${port}，会话 ${session.id}`, {
      sessionId: session.id,
      port,
      bindTargets,
    });

    return { port, startedAt, bypassHosts: bypass };
  }

  function stopForSession(session: any) {
    return new Promise<void>((resolve) => {
      const entry = activeServers.get(session.id);
      if (!entry) {
        resolve();
        return;
      }
      if (entry.autoStopTimer) clearTimeout(entry.autoStopTimer);
      for (const server of entry.servers) server.close();
      activeServers.delete(session.id);
      log('info', `抓包代理已停止: 会话 ${session.id}`, { sessionId: session.id });
      resolve();
    });
  }

  function handleClient(rawSocket: any, session: any, bypassHosts: string[]) {
    rawSocket.setNoDelay(true);
    let buffer = Buffer.alloc(0);
    let settled = false;

    const onData = (chunk: Buffer) => {
      if (settled) return;
      buffer = Buffer.concat([buffer, chunk]);

      if (buffer.length > MAX_CONNECT_HEAD_BYTES) {
        rawSocket.destroy();
        return;
      }

      const headEnd = findHeadEnd(buffer);
      if (headEnd < 0) return;

      settled = true;
      rawSocket.removeListener('data', onData);

      const head = buffer.toString('latin1', 0, headEnd);
      const rest = buffer.subarray(headEnd);
      const firstLine = head.split('\r\n')[0] || '';

      const connect = parseConnectLine(firstLine);
      if (connect) {
        handleConnect(rawSocket, connect, rest, session, bypassHosts);
        return;
      }

      const target = (firstLine.split(WHITESPACE_RE)[1] || '').trim();
      const absolute = parseAbsoluteUrl(target);
      if (absolute) {
        handlePlainHttp(rawSocket, absolute, head, rest, session, bypassHosts);
        return;
      }

      rawSocket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      rawSocket.destroy();
    };

    rawSocket.on('data', onData);
    rawSocket.on('error', () => {});
  }

  function handleConnect(rawSocket: any, { host, port }: any, rest: Buffer, session: any, bypassHosts: string[]) {
    const isBypass = bypassHosts.includes(host);
    const shouldMitm = !isBypass && isCaptureHost(host, config);

    if (!shouldMitm) {
      startTunnel(rawSocket, { host, port }, rest);
      return;
    }

    if (rest.length > 0) {
      sessionStore.setProxyError(session, `中间人无法处理管道化数据: ${host}`);
      rawSocket.destroy();
      return;
    }

    startMitm(rawSocket, { host, port }, session);
  }

  function startTunnel(rawSocket: any, { host, port }: any, rest: Buffer) {
    const upstream = net.connect({ host, port });
    upstream.once('connect', () => {
      rawSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (rest.length > 0) upstream.write(rest);
      rawSocket.on('data', (chunk: Buffer) => upstream.write(chunk));
      upstream.on('data', (chunk: Buffer) => rawSocket.write(chunk));
      upstream.on('error', () => rawSocket.destroy());
      rawSocket.on('error', () => upstream.destroy());
      upstream.on('close', () => rawSocket.destroy());
      rawSocket.on('close', () => upstream.destroy());
    });
    upstream.on('error', () => rawSocket.destroy());
  }

  function startMitm(rawSocket: any, { host, port }: any, session: any) {
    let secureContext: any;
    try {
      secureContext = ca.getSecureContextForHost(host);
    } catch (error: any) {
      sessionStore.setProxyError(session, `证书签发失败: ${error.message}`);
      rawSocket.destroy();
      return;
    }

    rawSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');

    const clientTls = new tls.TLSSocket(rawSocket, {
      isServer: true,
      secureContext,
      ALPNProtocols: ['http/1.1'],
    });

    const upstream = tls.connect({
      host,
      port,
      servername: host,
      ALPNProtocols: ['http/1.1'],
      rejectUnauthorized: false,
    });

    let clientReady = false;
    let upstreamReady = false;
    let headParsed = false;
    let clientBuffer = Buffer.alloc(0);
    let upstreamBuffer = Buffer.alloc(0);
    let wsParser: any = null;
    let wsUpstreamPending = false;
    let wsUpstreamBuffer = Buffer.alloc(0);
    let destroyed = false;

    const destroyAll = () => {
      if (destroyed) return;
      destroyed = true;
      clientTls.destroy();
      upstream.destroy();
      rawSocket.destroy();
    };

    const feedUpstream = (chunk: Buffer) => {
      if (destroyed) return;
      if (clientReady) clientTls.write(chunk);

      if (!wsParser) return;
      if (!wsUpstreamPending) {
        wsParser.push(chunk);
        return;
      }
      wsUpstreamBuffer = Buffer.concat([wsUpstreamBuffer, chunk]);
      const headEnd = findHeadEnd(wsUpstreamBuffer);
      if (headEnd < 0) return;
      wsUpstreamPending = false;
      const headLine = wsUpstreamBuffer.toString('latin1', 0, headEnd).split('\r\n')[0] || '';
      const rest = wsUpstreamBuffer.subarray(headEnd);
      wsUpstreamBuffer = Buffer.alloc(0);
      if (HTTP_101_RE.test(headLine)) {
        if (rest.length > 0) wsParser.push(rest);
      }
    };

    const onUpstreamData = (chunk: Buffer) => {
      if (destroyed) return;
      if (!clientReady) {
        upstreamBuffer = Buffer.concat([upstreamBuffer, chunk]);
        return;
      }
      feedUpstream(chunk);
    };

    upstream.once('secureConnect', () => {
      upstreamReady = true;
      flushBuffers();
    });
    upstream.on('data', onUpstreamData);
    upstream.on('error', () => destroyAll());

    clientTls.once('secure', () => {
      clientReady = true;
      clientTls.setTimeout(0);
      flushBuffers();
    });
    clientTls.on('error', () => destroyAll());
    clientTls.setTimeout(HANDSHAKE_TIMEOUT_MS, () => destroyAll());

    clientTls.on('data', (chunk: Buffer) => {
      if (destroyed) return;

      if (headParsed) {
        if (upstreamReady) upstream.write(chunk);
        else clientBuffer = Buffer.concat([clientBuffer, chunk]);
        return;
      }

      clientBuffer = Buffer.concat([clientBuffer, chunk]);
      const headEnd = findHeadEnd(clientBuffer);
      if (headEnd < 0) {
        if (clientBuffer.length > MAX_CONNECT_HEAD_BYTES) destroyAll();
        return;
      }

      const headBytes = clientBuffer.subarray(0, headEnd);
      const rest = clientBuffer.subarray(headEnd);
      headParsed = true;

      const parsed = parseHttpHead(headBytes);
      const info = extractLoginInfo({ host, parsedHead: parsed, config });
      if (info.code || info.openId) {
        sessionStore.addCode(session, { code: info.code, openId: info.openId });
        log('info', `已抓到登录 Code: 会话 ${session.id}`, {
          sessionId: session.id,
          host,
          codeLength: info.code.length,
          hasOpenId: !!info.openId,
        });
      }

      if (parsed && parsed.isUpgrade && friendExtractor) {
        wsParser = new WsFrameParser({
          onMessage: (message: Buffer) => {
            try {
              const result = friendExtractor.handleMessage(message);
              if (result && result.gids.length > 0) {
                sessionStore.addFriendGids(session, {
                  gids: result.gids,
                  source: result.source,
                  complete: result.complete,
                });
              } else if (result && result.complete) {
                sessionStore.addFriendGids(session, {
                  gids: [],
                  source: result.source,
                  complete: true,
                });
              }
            } catch {
              // 忽略单条消息解析错误
            }
          },
        });
        wsUpstreamPending = true;
      }

      if (upstreamReady) {
        upstream.write(Buffer.concat([headBytes, rest]));
      } else {
        clientBuffer = Buffer.concat([headBytes, rest]);
      }
    });

    function flushBuffers() {
      if (!clientReady || !upstreamReady) return;
      if (clientBuffer.length > 0) {
        upstream.write(clientBuffer);
        clientBuffer = Buffer.alloc(0);
      }
      if (upstreamBuffer.length > 0) {
        feedUpstream(upstreamBuffer);
        upstreamBuffer = Buffer.alloc(0);
      }
    }

    rawSocket.on('error', () => destroyAll());
  }

  function handlePlainHttp(rawSocket: any, { host, port, path }: any, head: string, rest: Buffer, session: any, bypassHosts: string[]) {
    const isBypass = bypassHosts.includes(host);
    const info = extractLoginInfo({ host, head, config });
    if (!isBypass && (info.code || info.openId)) {
      sessionStore.addCode(session, { code: info.code, openId: info.openId });
    }

    const upstream = net.connect({ host, port });
    upstream.once('connect', () => {
      upstream.write(`${rewriteAbsoluteRequest(head, path || '/')}\r\n\r\n`);
      if (rest.length > 0) upstream.write(rest);
      rawSocket.on('data', (chunk: Buffer) => upstream.write(chunk));
      upstream.on('data', (chunk: Buffer) => rawSocket.write(chunk));
      upstream.on('error', () => rawSocket.destroy());
      rawSocket.on('error', () => upstream.destroy());
      upstream.on('close', () => rawSocket.destroy());
      rawSocket.on('close', () => upstream.destroy());
    });
    upstream.on('error', () => rawSocket.destroy());
  }

  return {
    startForSession,
    stopForSession,
  };
}

module.exports = {
  createMitmProxyManager,
  findHeadEnd,
  parseAbsoluteUrl,
  parseConnectLine,
  rewriteAbsoluteRequest,
};
