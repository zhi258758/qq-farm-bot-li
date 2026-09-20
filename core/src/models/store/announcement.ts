export {};

/**
 * 公告存储与已读记录。
 *
 * 保存于 store.json 的 announcement / announcementReadRecords 字段。
 * 公告更新后 updatedAt 单调递增，用于判断用户是否已读。
 */

const sharedState = require('./shared-state');
const globalConfig = sharedState.globalConfig;

function getAnnouncement() {
    const src = (globalConfig as any).announcement || {};
    return {
        content: String(src.content || ''),
        showOnce: src.showOnce !== false,
        enabled: src.enabled !== false,
        updatedAt: Number(src.updatedAt) || 0,
    };
}

function setAnnouncement(content: unknown, showOnce = true, enabled = true) {
    const previous = getAnnouncement();
    (globalConfig as any).announcement = {
        content: String(content || '').trim(),
        showOnce: showOnce !== false,
        enabled: enabled !== false,
        updatedAt: Math.max(Date.now(), previous.updatedAt + 1),
    };
    const { saveGlobalConfig } = require('./global-config');
    saveGlobalConfig();
    return getAnnouncement();
}

function getAnnouncementReadRecord(username: unknown): number {
    const records = (globalConfig as any).announcementReadRecords || {};
    return Number(records[String(username || '')]) || 0;
}

function markAnnouncementRead(username: unknown) {
    const key = String(username || '').trim();
    if (!key) return;
    if (!(globalConfig as any).announcementReadRecords) {
        (globalConfig as any).announcementReadRecords = {};
    }
    const records = (globalConfig as any).announcementReadRecords;
    const announcement = getAnnouncement();
    const previous = Number(records[key]) || 0;
    records[key] = Math.max(previous, announcement.updatedAt);
    const { saveGlobalConfig } = require('./global-config');
    saveGlobalConfig();
}

function shouldShowAnnouncement(username: unknown): boolean {
    const announcement = getAnnouncement();
    if (!announcement.content) return false;
    if (announcement.enabled === false) return false;
    if (!announcement.showOnce) return true;
    return getAnnouncementReadRecord(username) < announcement.updatedAt;
}

module.exports = {
    getAnnouncement,
    setAnnouncement,
    getAnnouncementReadRecord,
    markAnnouncementRead,
    shouldShowAnnouncement,
};
