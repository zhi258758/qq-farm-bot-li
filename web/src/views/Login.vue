<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import api, { getApiErrorMessage } from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import { useUserStore } from '@/stores/user'

declare const __APP_VERSION__: string

const userStore = useUserStore()
const appVersion = __APP_VERSION__
const gameVersion = ref('')
const username = ref('')
const password = ref('')
const cardCode = ref('')
const qq = ref('')
const error = ref('')
const success = ref('')
const loading = ref(false)
const lockoutRemaining = ref(0)
const rateLimitRemaining = ref(0)
const mode = ref<'login' | 'register'>('login')
const registrationEnabled = ref(false)
const cardClaimEnabled = ref(false)
const cardClaimLoading = ref(false)

const usernameValid = computed(() => {
  const name = username.value
  if (!name)
    return { valid: false, message: '' }
  if (name.length < 3)
    return { valid: false, message: '用户名至少3位' }
  if (name.length > 32)
    return { valid: false, message: '用户名最多32位' }
  if (!/^\w+$/.test(name))
    return { valid: false, message: '只能包含字母、数字、下划线' }
  return { valid: true, message: '' }
})

const qqValid = computed(() => {
  const value = qq.value.trim()
  if (!value)
    return { valid: false, message: '' }
  if (!/^\d{5,11}$/.test(value))
    return { valid: false, message: 'QQ号应为5-11位数字' }
  return { valid: true, message: '' }
})

function validateForm(): boolean {
  if (!username.value) {
    error.value = '请输入用户名'
    return false
  }
  if (!usernameValid.value.valid) {
    error.value = usernameValid.value.message
    return false
  }
  if (!password.value) {
    error.value = '请输入密码'
    return false
  }
  if (mode.value === 'register') {
    if (!cardCode.value.trim()) {
      error.value = '请输入卡密'
      return false
    }
    if (!qqValid.value.valid) {
      error.value = qq.value.trim() ? 'QQ号应为5-11位数字' : '请输入QQ号'
      return false
    }
  }
  return true
}

async function claimFreeCard() {
  if (cardClaimLoading.value)
    return
  cardClaimLoading.value = true
  error.value = ''
  success.value = ''
  try {
    const result = await userStore.claimFreeCard()
    if (result.ok) {
      cardCode.value = result.data?.cardCode || ''
      success.value = `领取成功，已自动填入卡密（${result.data?.days || 0} 天）`
    }
    else {
      error.value = result.error || '领取失败，请稍后重试'
    }
  }
  catch (e: any) {
    const data = e.response?.data
    error.value = data?.error || getApiErrorMessage(e, '领取失败')
  }
  finally {
    cardClaimLoading.value = false
  }
}

async function handleSubmit() {
  if (!validateForm())
    return

  loading.value = true
  error.value = ''
  success.value = ''

  try {
    const result = mode.value === 'register'
      ? await userStore.register(username.value, password.value, cardCode.value.trim(), qq.value.trim())
      : await userStore.login(username.value, password.value)
    if (result.ok) {
      if (result.data?.mustChangePassword)
        success.value = '登录成功，请修改默认密码'
      else if (mode.value === 'register')
        success.value = '注册成功'
      setTimeout(() => {
        const next = userStore.isAdmin || userStore.membershipActive
          ? '/'
          : '/settings?tab=membership'
        window.location.href = next
      }, 500)
    }
    else if (result.errorType === 'rate_limit') {
      error.value = result.error || '请求过于频繁，请稍后重试'
      if (result.remainingMs)
        rateLimitRemaining.value = Math.ceil(result.remainingMs / 1000)
    }
    else if (result.errorType === 'locked') {
      error.value = result.error || '账户已被锁定'
      if (result.remainingMs)
        lockoutRemaining.value = Math.ceil(result.remainingMs / 1000 / 60)
    }
    else {
      error.value = result.error || (mode.value === 'register' ? '注册失败' : '登录失败')
    }
  }
  catch (e: any) {
    const data = e.response?.data
    if (data?.errorType === 'rate_limit') {
      error.value = getApiErrorMessage(data, '请求过于频繁')
      if (data.remainingMs)
        rateLimitRemaining.value = Math.ceil(data.remainingMs / 1000)
    }
    else if (data?.errorType === 'locked') {
      error.value = getApiErrorMessage(data, '账户已被锁定')
      if (data.remainingMs)
        lockoutRemaining.value = Math.ceil(data.remainingMs / 1000 / 60)
    }
    else {
      error.value = getApiErrorMessage(e, '操作异常')
    }
  }
  finally {
    loading.value = false
  }
}

async function fetchGameVersion() {
  try {
    const res = await api.get('/api/game-version')
    if (res.data.ok)
      gameVersion.value = res.data.clientVersion
  }
  catch (e) {
    console.error('获取游戏版本失败:', e)
  }
}

async function fetchAuthConfig() {
  try {
    const res = await api.get('/api/public/auth-config')
    if (res.data.ok) {
      registrationEnabled.value = res.data.data?.registrationEnabled === true
      cardClaimEnabled.value = res.data.data?.cardClaimEnabled === true
    }
  }
  catch {
    registrationEnabled.value = false
    cardClaimEnabled.value = false
  }
}

onMounted(() => {
  fetchGameVersion()
  fetchAuthConfig()
})
</script>

<template>
  <main class="login-container">
    <section class="login-card">
      <header class="logo-area">
        <div class="logo-icon">
          <img src="/icon.png" alt="">
        </div>
        <div>
          <span class="logo-kicker">QQ FARM</span>
          <h1 class="logo-title">
            QQ农场智能助手
          </h1>
          <p class="logo-subtitle">
            {{ mode === 'register' ? '创建面板账号' : '登录面板' }}
          </p>
        </div>
      </header>

      <form class="form-area" @submit.prevent="handleSubmit">
        <div class="form-group">
          <label class="form-label" for="username">
            <span class="i-carbon-user" />
            用户名
          </label>
          <BaseInput
            id="username"
            v-model="username"
            type="text"
            placeholder="请输入用户名"
            autocomplete="username"
            required
          />
          <p v-if="username && !usernameValid.valid" class="form-hint error">
            {{ usernameValid.message }}
          </p>
        </div>

        <div class="form-group">
          <label class="form-label" for="password">
            <span class="i-carbon-locked" />
            密码
          </label>
          <BaseInput
            id="password"
            v-model="password"
            type="password"
            placeholder="请输入密码"
            autocomplete="current-password"
            required
          />
        </div>

        <div v-if="mode === 'register'" class="form-group">
          <label class="form-label" for="cardCode">
            <span class="i-carbon-ticket" />
            卡密
          </label>
          <BaseInput
            id="cardCode"
            v-model="cardCode"
            type="text"
            placeholder="请输入卡密"
            required
          />
          <button
            v-if="cardClaimEnabled"
            type="button"
            class="claim-btn"
            :disabled="cardClaimLoading"
            @click="claimFreeCard"
          >
            <span v-if="cardClaimLoading" class="i-carbon-in-progress" />
            <span v-else class="i-carbon-gift" />
            {{ cardClaimLoading ? '领取中...' : '领取卡密' }}
          </button>
        </div>

        <div v-if="mode === 'register'" class="form-group">
          <label class="form-label" for="qq">
            <span class="i-carbon-identification" />
            QQ号
          </label>
          <BaseInput
            id="qq"
            v-model="qq"
            type="text"
            placeholder="请输入QQ号"
            required
          />
          <p v-if="qq && !qqValid.valid" class="form-hint error">
            {{ qqValid.message }}
          </p>
        </div>

        <div v-if="error" class="message error-message" role="alert">
          <span class="i-carbon-warning-alt" />
          <div>
            {{ error }}
            <span v-if="lockoutRemaining > 0">（{{ lockoutRemaining }} 分钟后解锁）</span>
            <span v-if="rateLimitRemaining > 0">（{{ rateLimitRemaining }} 秒后可重试）</span>
          </div>
        </div>
        <div v-if="success" class="message success-message" role="status">
          <span class="i-carbon-checkmark-filled" />
          {{ success }}
        </div>

        <BaseButton type="submit" variant="primary" block :loading="loading" class="submit-btn">
          <span v-if="!loading" class="inline-flex items-center gap-2">
            <span :class="mode === 'register' ? 'i-carbon-user-follow' : 'i-carbon-login'" />
            {{ mode === 'register' ? '注册' : '登录' }}
          </span>
        </BaseButton>
        <button
          v-if="registrationEnabled"
          type="button"
          class="mode-switch"
          @click="mode = mode === 'login' ? 'register' : 'login'; error = ''; success = ''"
        >
          {{ mode === 'login' ? '没有账号？去注册' : '已有账号？去登录' }}
        </button>
      </form>

      <footer class="card-footer">
        <div class="footer-info">
          <span>Web v{{ appVersion }}</span>
          <span v-if="gameVersion">Game {{ gameVersion }}</span>
        </div>
        <a href="https://github.com/liyangpengs/qq-farm-bot" target="_blank" rel="noopener noreferrer" class="github-link" aria-label="GitHub">
          <span class="i-carbon-logo-github" />
        </a>
      </footer>
    </section>
  </main>
</template>

<style scoped>
.login-container {
  position: relative;
  display: grid;
  width: 100%;
  min-height: 100dvh;
  place-items: center;
  overflow: hidden;
  padding: 28px 18px;
  color: var(--ui-ink);
  background-color: #edf2ea;
  background-image:
    linear-gradient(rgba(67, 141, 99, 0.045) 1px, transparent 1px),
    linear-gradient(90deg, rgba(67, 141, 99, 0.045) 1px, transparent 1px);
  background-size: 42px 42px;
}

.login-container::before {
  position: absolute;
  inset: 8% 7%;
  border: 1px solid rgba(67, 141, 99, 0.08);
  border-radius: 36px;
  background: rgba(255, 255, 255, 0.22);
  content: '';
}

.login-card {
  position: relative;
  z-index: 1;
  width: min(430px, 100%);
  padding: 30px;
  border: 1px solid rgba(58, 86, 68, 0.14);
  border-radius: 18px;
  background: rgba(250, 251, 247, 0.82);
  box-shadow:
    0 28px 76px rgba(55, 75, 61, 0.16),
    inset 0 1px 0 rgba(255, 255, 255, 0.94);
  -webkit-backdrop-filter: blur(24px) saturate(135%);
  backdrop-filter: blur(24px) saturate(135%);
}

.logo-area {
  display: flex;
  align-items: center;
  gap: 14px;
  padding-bottom: 24px;
  border-bottom: 1px solid var(--ui-border);
}

.logo-icon {
  display: grid;
  width: 58px;
  height: 58px;
  flex: none;
  place-items: center;
  overflow: hidden;
  border: 1px solid rgba(67, 141, 99, 0.16);
  border-radius: 16px;
  background: var(--ui-primary-soft);
}

.logo-icon img {
  width: 42px;
  height: 42px;
  object-fit: contain;
}

.logo-kicker {
  color: var(--ui-primary);
  font-size: 10px;
  font-weight: 700;
}

.logo-title {
  margin: 2px 0 0;
  font-size: 22px;
  line-height: 1.2;
  letter-spacing: 0;
}

.logo-subtitle {
  margin: 5px 0 0;
  color: var(--ui-muted);
  font-size: 12px;
}

.form-area {
  display: flex;
  flex-direction: column;
  gap: 17px;
  padding-top: 24px;
}

.form-group {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 7px;
}

.form-label {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--ui-ink);
  font-size: 13px;
  font-weight: 600;
}

.form-label > span {
  color: var(--ui-primary);
}

.login-card :deep(.base-input) {
  height: 42px;
  border-color: var(--ui-border);
  border-radius: 10px;
  color: var(--ui-ink);
  background: rgba(255, 255, 255, 0.7);
}

.login-card :deep(.base-input:focus) {
  border-color: rgba(67, 141, 99, 0.55);
  box-shadow: 0 0 0 3px rgba(67, 141, 99, 0.1);
}

.form-hint {
  margin: 0;
  color: var(--ui-danger);
  font-size: 11px;
}

.claim-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: 2px;
  padding: 8px 12px;
  border: 1px solid rgba(67, 141, 99, 0.35);
  border-radius: 9px;
  color: var(--ui-primary);
  background: var(--ui-primary-soft);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.claim-btn:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.message {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 11px;
  border: 1px solid transparent;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.5;
}

.error-message {
  border-color: rgba(201, 95, 102, 0.18);
  color: #984049;
  background: var(--ui-danger-soft);
}

.success-message {
  border-color: rgba(67, 141, 99, 0.18);
  color: #2e714b;
  background: var(--ui-primary-soft);
}

.submit-btn {
  margin-top: 2px;
}

.mode-switch {
  margin-top: 12px;
  width: 100%;
  border: 0;
  background: transparent;
  color: var(--ui-primary);
  font-size: 13px;
  cursor: pointer;
}

.card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 22px;
  padding-top: 17px;
  border-top: 1px solid var(--ui-border);
  color: var(--ui-subtle);
  font-size: 10px;
}

.footer-info {
  display: flex;
  gap: 12px;
}

.github-link {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border-radius: 8px;
  color: var(--ui-muted);
  text-decoration: none;
}

.github-link:hover {
  color: var(--ui-primary);
  background: var(--ui-primary-soft);
}

@media (max-width: 480px) {
  .login-container {
    align-items: center;
    padding: 16px 12px;
  }

  .login-container::before {
    inset: 4%;
    border-radius: 24px;
  }

  .login-card {
    padding: 24px 20px;
    border-radius: 16px;
  }

  .logo-icon {
    width: 52px;
    height: 52px;
  }

  .logo-title {
    font-size: 19px;
  }
}
</style>
