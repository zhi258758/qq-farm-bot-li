export {};

/**
 * 好友 GID 提取器
 *
 * 服务器→客户端 WebSocket 消息为 `gatepb.Message`（protobuf），其中
 * `meta.service_name` / `meta.method_name` 标识 RPC，`body` 为明文
 * protobuf 回复体。
 */

const protobuf = require('protobufjs');
const { getResourcePath } = require('../config/runtime-paths');

const FRIEND_SERVICE = 'gamepb.friendpb.FriendService';
const COMPLETE_METHODS = new Set(['GetAll', 'SyncAll']);
const PARTIAL_METHODS = new Set(['GetGameFriends']);

const REPLY_TYPE_MAP: any = {
  GetAll: 'GetAllReply',
  SyncAll: 'SyncAllReply',
  GetGameFriends: 'GetGameFriendsReply',
};

function getProtoPaths(): string[] {
  return [
    getResourcePath('proto', 'game.proto'),
    getResourcePath('proto', 'friendpb.proto'),
  ];
}

/** 创建好友 GID 提取器（异步加载 proto） */
async function createFriendExtractor() {
  const root = new protobuf.Root();
  await root.load(getProtoPaths(), { keepCase: true });

  const GateMessage = root.lookupType('gatepb.Message');
  const replyTypes: any = {};
  for (const [method, replyName] of Object.entries(REPLY_TYPE_MAP)) {
    try {
      replyTypes[method] = root.lookupType(`gamepb.friendpb.${replyName}`);
    } catch {
      replyTypes[method] = null;
    }
  }

  /** 解析一条服务器→客户端的二进制 WebSocket 消息 */
  function handleMessage(buffer: Buffer) {
    if (!buffer || buffer.length === 0) return null;
    let message: any;
    try {
      message = GateMessage.decode(buffer);
    } catch {
      return null;
    }
    const meta = message && message.meta;
    if (!meta) return null;

    const serviceName = String(meta.service_name || '');
    const methodName = String(meta.method_name || '');
    if (serviceName !== FRIEND_SERVICE) return null;
    if (!COMPLETE_METHODS.has(methodName) && !PARTIAL_METHODS.has(methodName)) return null;

    const body = message.body;
    if (!body || body.length === 0) return null;

    const replyType = replyTypes[methodName];
    let gids: number[] = [];
    if (replyType) {
      try {
        const reply = replyType.decode(body);
        const friends = Array.isArray(reply && reply.game_friends) ? reply.game_friends : [];
        gids = friends
          .map((friend: any) => Number(friend && friend.gid))
          .filter((gid: number) => Number.isSafeInteger(gid) && gid > 0);
      } catch {
        gids = [];
      }
    }

    return {
      gids,
      source: `${serviceName}.${methodName}`,
      complete: COMPLETE_METHODS.has(methodName),
    };
  }

  return { handleMessage };
}

module.exports = {
  COMPLETE_METHODS,
  FRIEND_SERVICE,
  PARTIAL_METHODS,
  REPLY_TYPE_MAP,
  createFriendExtractor,
  getProtoPaths,
};
