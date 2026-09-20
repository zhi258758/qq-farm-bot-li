export {};

/**
 * 抓包服务 CLI 入口（独立模式）
 *
 * 启动后提供：
 * - REST API：默认 http://127.0.0.1:8450
 * - MITM 代理端口：默认 18000，绑定配置的网卡 IP
 *
 * 配置见 <dataDir>/capture/config.json，或使用 CAPTURE_* 环境变量。
 */

const { startCaptureServer } = require('./index');

async function main() {
  const { config, stop, log } = await startCaptureServer();

  const advertise = require('./ip-utils').resolveAdvertiseAddresses(config);
  log('info', '抓包服务启动完成');
  log('info', `API: http://${config.apiHost}:${config.apiPort}`);
  log('info', `代理端口: ${config.proxyPortFrom}`);
  log('info', `代理绑定 IP: ${(config.proxyBind || []).join(', ')}`);
  log('info', `对外代理地址（手机 Wi-Fi 代理填写）: ${advertise.addresses.length
    ? advertise.addresses.map((item: any) => `${item.address}:<代理端口> (${item.kind})`).join(', ')
    : '未检测到可用地址，请检查 CAPTURE_ADVERTISE_IPS 配置'}`);

  const shutdown = async (signal: string) => {
    log('info', `收到 ${signal}，正在关闭...`);
    await stop();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error: any) => {
  console.error('[capture] 启动失败:', error && error.message ? error.message : error);
  process.exit(1);
});

module.exports = {};
