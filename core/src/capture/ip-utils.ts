export {};

/**
 * 抓包服务 IP 工具
 *
 * 负责检测本机网卡地址并分类：
 * - tailscale：Tailscale 组网（CGNAT 100.64.0.0/10）
 * - lan：局域网（10/8、172.16/12、192.168/16）
 * - other：其他 IPv4（桥接、虚拟网卡等）
 */

const os = require('node:os');

/** Tailscale 使用 RFC 6598 CGNAT 段 100.64.0.0/10 */
const TAILSCALE_RANGE = { start: 0x64400000, end: 0x647FFFFF };

const IPV4_PART_RE = /^\d{1,3}$/;

const LAN_RANGES = [
  { start: 0x0A000000, end: 0x0AFFFFFF },
  { start: 0xAC100000, end: 0xAC1FFFFF },
  { start: 0xC0A80000, end: 0xC0A8FFFF },
];

/** 将点分 IPv4 字符串转为 32 位整数，失败返回 null */
function ipv4ToInt(ip: any): number | null {
  if (typeof ip !== 'string') return null;
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    if (!IPV4_PART_RE.test(part)) return null;
    const num = Number.parseInt(part, 10);
    if (num < 0 || num > 255) return null;
    result = (result << 8) | num;
  }
  return result >>> 0;
}

/** 将 IPv4 分类为 'tailscale' | 'lan' | 'other' | 'unknown' */
function classifyIpv4(ip: string): string {
  const int = ipv4ToInt(ip);
  if (int === null) return 'unknown';
  if (int >= TAILSCALE_RANGE.start && int <= TAILSCALE_RANGE.end) return 'tailscale';
  if (LAN_RANGES.some(range => int >= range.start && int <= range.end)) return 'lan';
  return 'other';
}

/** 获取全部非回环 IPv4 地址（含网卡名） */
function getAllIpv4(): Array<{ name: string; address: string; mac: string }> {
  const interfaces = os.networkInterfaces();
  const result: any[] = [];
  for (const [name, addrs] of Object.entries(interfaces || {})) {
    for (const addr of (addrs as any[]) || []) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      result.push({ name, address: addr.address, mac: addr.mac || '' });
    }
  }
  return result;
}

/** 获取去重后的全部非回环 IPv4 地址列表 */
function getIpv4Addresses(): string[] {
  return [...new Set(getAllIpv4().map(item => item.address))];
}

/** 判断一个 IP 是否属于 Tailscale 段 */
function isTailscaleIp(ip: string): boolean {
  return classifyIpv4(ip) === 'tailscale';
}

/** 按配置解析需要对外公布的 IP 列表 */
function resolveAdvertiseAddresses(config: any = {}) {
  const configured = Array.isArray(config.advertiseIps)
    ? config.advertiseIps
    : String(config.advertiseIps ?? 'auto').split(',').map((s: string) => s.trim()).filter(Boolean);

  const detected = getIpv4Addresses();
  const useAuto = configured.length === 0 || configured.includes('auto');

  const picked = new Set<string>();
  for (const item of configured) {
    if (item === 'auto') continue;
    const ip = item.trim();
    if (ipv4ToInt(ip) !== null) picked.add(ip);
  }
  if (useAuto) {
    for (const ip of detected) picked.add(ip);
  }

  const preferOrder = Array.isArray(config.preferOrder)
    ? config.preferOrder.map((s: any) => String(s).trim()).filter(Boolean)
    : ['tailscale', 'lan', 'other'];

  const addresses = Array.from(picked, address => ({
    address,
    kind: classifyIpv4(address),
  }));

  const rank = (kind: string) => {
    const index = preferOrder.indexOf(kind);
    return index === -1 ? preferOrder.length : index;
  };
  addresses.sort((a, b) => rank(a.kind) - rank(b.kind) || a.address.localeCompare(b.address));

  const host = addresses.length > 0 ? addresses[0].address : '';
  return { addresses, host };
}

module.exports = {
  classifyIpv4,
  getAllIpv4,
  getIpv4Addresses,
  ipv4ToInt,
  isTailscaleIp,
  resolveAdvertiseAddresses,
};
