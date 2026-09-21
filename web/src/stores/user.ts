import { useStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed } from 'vue'
import api, { getApiErrorMessage } from '@/api'

export type UserRole = 'admin' | 'user'

export interface AdminInfo {
  id?: string
  username: string
  qq?: string
  role: UserRole
  avatar?: string
  mustChangePassword?: boolean
  enabled?: boolean
  membershipExpiresAt?: number | null
  membershipActive?: boolean
  slotLimit?: number
  slotUsed?: number
}

export interface LoginResult {
  ok: boolean
  error?: string
  errorType?: 'rate_limit' | 'locked' | 'invalid_credentials' | 'disabled'
  remainingMs?: number
  code?: string
  qqGroupNumber?: string
  qq?: string
  data?: {
    token: string
    role: UserRole
    user: AdminInfo
    mustChangePassword?: boolean
  }
}

export const useUserStore = defineStore('user', () => {
  const token = useStorage('admin_token', '')
  const userInfo = useStorage<AdminInfo | null>('user_info', null)
  const isLoggedIn = computed(() => !!token.value)
  const username = computed(() => userInfo.value?.username || '')
  const avatar = computed(() => userInfo.value?.avatar || '')
  const role = computed<UserRole>(() => userInfo.value?.role || 'user')
  const isAdmin = computed(() => role.value === 'admin')
  const membershipActive = computed(() => isAdmin.value || userInfo.value?.membershipActive === true)
  const membershipExpiresAt = computed(() => userInfo.value?.membershipExpiresAt ?? null)
  const slotLimit = computed(() => Number(userInfo.value?.slotLimit || 0))
  const slotUsed = computed(() => Number(userInfo.value?.slotUsed || 0))

  function applySession(payload: any) {
    const nextRole: UserRole = payload?.role === 'admin' ? 'admin' : 'user'
    const user = payload?.user || {}
    if (payload?.token)
      token.value = payload.token
    userInfo.value = {
      ...userInfo.value,
      id: user.id ?? userInfo.value?.id,
      username: user.username || userInfo.value?.username || '',
      qq: user.qq ?? userInfo.value?.qq,
      role: nextRole,
      mustChangePassword: payload.mustChangePassword,
      enabled: user.enabled,
      membershipExpiresAt: Object.prototype.hasOwnProperty.call(user, 'membershipExpiresAt')
        ? (user.membershipExpiresAt ?? null)
        : (nextRole === 'admin' ? userInfo.value?.membershipExpiresAt ?? null : null),
      membershipActive: nextRole === 'admin' ? true : user.membershipActive === true,
      slotLimit: user.slotLimit ?? userInfo.value?.slotLimit,
      slotUsed: user.slotUsed ?? userInfo.value?.slotUsed,
    }
  }

  function applyAuthPayload(payload: any) {
    applySession(payload)
  }

  async function login(username: string, password: string): Promise<LoginResult> {
    try {
      const res = await api.post('/api/login', { username, password })
      if (res.data.ok)
        applyAuthPayload(res.data.data)
      return res.data
    }
    catch (error: any) {
      const data = error.response?.data
      return data
        ? {
            ok: false,
            error: getApiErrorMessage(data, '网络错误'),
            errorType: data.errorType,
            remainingMs: data.remainingMs,
            code: data.code,
            qqGroupNumber: data.qqGroupNumber,
            qq: data.qq,
          }
        : { ok: false, error: getApiErrorMessage(error, '网络错误') }
    }
  }

  async function register(username: string, password: string, cardCode: string, qq: string): Promise<LoginResult> {
    try {
      const res = await api.post('/api/register', { username, password, cardCode, qq })
      return res.data
    }
    catch (error: any) {
      const data = error.response?.data
      return data
        ? {
            ok: false,
            error: getApiErrorMessage(data, '注册失败'),
            code: data.code,
            qqGroupNumber: data.qqGroupNumber,
            qq: data.qq,
          }
        : { ok: false, error: getApiErrorMessage(error, '注册失败') }
    }
  }

  async function fetchCardClaimStatus() {
    try {
      const res = await api.get('/api/card-claim/status')
      return res.data?.data?.enabled === true
    }
    catch {
      return false
    }
  }

  async function claimFreeCard() {
    const res = await api.post('/api/card-claim/claim')
    return res.data
  }

  async function logout() {
    try {
      await api.post('/api/logout')
    }
    finally {
      token.value = ''
      userInfo.value = null
    }
  }

  async function fetchUserInfo() {
    try {
      const res = await api.get('/api/user/me')
      if (res.data.ok) {
        const data = res.data.data || {}
        userInfo.value = {
          ...userInfo.value,
          ...data,
          role: data.role === 'admin' ? 'admin' : 'user',
          membershipActive: data.role === 'admin' ? true : data.membershipActive === true,
        }
      }
      return res.data
    }
    catch {
      return { ok: false }
    }
  }

  async function changePassword(oldPassword: string, newPassword: string) {
    const res = await api.post('/api/user/change-password', { oldPassword, newPassword })
    return res.data
  }

  async function redeemCardKey(code: string) {
    const res = await api.post('/api/cardkeys/redeem', { code })
    if (res.data.ok && res.data.data?.user) {
      userInfo.value = {
        ...userInfo.value,
        ...res.data.data.user,
        role: 'user',
        membershipActive: res.data.data.user.membershipActive === true,
      }
    }
    return res.data
  }

  async function fetchMyRedeems() {
    const res = await api.get('/api/cardkeys/my-redeems')
    return res.data
  }

  return {
    token,
    userInfo,
    isLoggedIn,
    username,
    avatar,
    role,
    isAdmin,
    membershipActive,
    membershipExpiresAt,
    slotLimit,
    slotUsed,
    applySession,
    login,
    register,
    fetchCardClaimStatus,
    claimFreeCard,
    logout,
    fetchUserInfo,
    changePassword,
    redeemCardKey,
    fetchMyRedeems,
  }
})
