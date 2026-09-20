export interface LoginLinks {
  logoUrl: string
  title: string
  loginSubtitle: string
  registerSubtitle: string
  purchaseUrl: string
  qqGroupUrl: string
}

export interface GroupVerifyConfig {
  enabled: boolean
  qqGroupNumber: string
  verifyUrl: string
  verifyToken: string
  verifyMode: string
  timeoutMs: number
}

export interface GroupVerifyTestResult {
  qq: string
  qqGroupNumber?: string
  inGroup: boolean
  error: string
  errorMessage?: string
  httpStatus?: number
  responseBody?: unknown
  requestUrl?: string
  durationMs?: number
  memberCount?: number
}

export const DEFAULT_LOGIN_LINKS: LoginLinks = {
  logoUrl: '',
  title: 'QQ农场智能助手',
  loginSubtitle: '欢迎回来，开启智慧农耕之旅',
  registerSubtitle: '创建账号，开启智慧农耕之旅',
  purchaseUrl: '',
  qqGroupUrl: '',
}

export const DEFAULT_GROUP_VERIFY_CONFIG: GroupVerifyConfig = {
  enabled: false,
  qqGroupNumber: '',
  verifyUrl: '',
  verifyToken: '',
  verifyMode: '',
  timeoutMs: 5000,
}
