<script setup lang="ts">
import { NCard } from 'naive-ui/es/card'
import { NModal } from 'naive-ui/es/modal'
import { NRadio, NRadioGroup } from 'naive-ui/es/radio'
import { NTab, NTabs } from 'naive-ui/es/tabs'
import { useIntervalFn } from '@vueuse/core'
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import api, { getApiErrorMessage } from '@/api'
import CaptureLoginPanel from '@/components/CaptureLoginPanel.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseTextarea from '@/components/ui/BaseTextarea.vue'
import { runWxLoginStatusPoll } from '@/utils/wx-login-poll'

const props = defineProps<{
  show: boolean
  editData?: any
}>()

const emit = defineEmits(['close', 'saved'])

const QQ_QR_AUTO_REFRESH_MS = 100_000

const loading = ref(false)
const errorMessage = ref('')
const activeLoginTab = ref<'code' | 'wx_qr' | 'qq_qr' | 'capture'>('code')
const loginSettingsLoaded = ref(false)
const captureEnabled = ref(false)
const qqEnabled = ref(false)
const loginSettings = ref({
  wechatQrLogin: true,
})
let loginSettingsRequestVersion = 0
const wxTaskId = ref('')
const wxStatus = ref('')
const wxError = ref('')
const wxLoading = ref(false)
const wxQrUrl = ref('')
let wxPollTimer: ReturnType<typeof setTimeout> | undefined
let wxQrObjectUrl = ''
let wxFlowVersion = 0
let wxPollController: AbortController | undefined
let wxPollInFlight: Promise<void> | undefined
let wxPollKey = ''
let wxPendingCode = ''
const qqTaskId = ref('')
const qqStatus = ref('')
const qqError = ref('')
const qqLoading = ref(false)
const qqQrUrl = ref('')
const qqQrCreatedAt = ref(0)
let qrNameSubmitTimer: ReturnType<typeof setTimeout> | undefined

const wechatQrLoginEnabled = computed(() => loginSettingsLoaded.value && loginSettings.value.wechatQrLogin)

// 表单数据
const form = reactive({
  name: '',
  code: '',
  platform: 'qq' as 'qq' | 'wx',
})

// 添加账号
async function addAccount(data: any) {
  const name = String(data?.name || '').trim()
  if (!name) {
    errorMessage.value = '请输入账号备注'
    return false
  }

  loading.value = true
  errorMessage.value = ''
  try {
    const res = await api.post('/api/accounts', { ...data, name })
    if (res.data.ok) {
      emit('saved')
      close()
      return true
    }
    else {
      errorMessage.value = `保存失败: ${getApiErrorMessage(res.data, '请求失败')}`
    }
  }
  catch (e: any) {
    errorMessage.value = `保存失败: ${getApiErrorMessage(e, '请求失败')}`
  }
  finally {
    loading.value = false
  }

  return false
}

function clearQrNameSubmitTimer() {
  if (qrNameSubmitTimer) {
    clearTimeout(qrNameSubmitTimer)
    qrNameSubmitTimer = undefined
  }
}

async function addQrAccount(code: string, nickname: string) {
  wxPendingCode = code
  const name = form.name.trim() || nickname
  if (!name) {
    wxStatus.value = '登录授权已完成，等待填写账号备注'
    wxError.value = '未获取到微信昵称，请填写账号备注'
    return
  }

  form.name = name
  await submitPendingWxAccount()
}

async function submitPendingWxAccount() {
  const name = form.name.trim()
  const code = wxPendingCode
  if (!name || !code || !props.show || activeLoginTab.value !== 'wx_qr')
    return

  wxPendingCode = ''
  wxError.value = ''
  wxStatus.value = '正在添加账号...'

  const saved = await addAccount({ name, code, platform: 'wx', loginType: 'manual' })
  if (!saved && props.show && activeLoginTab.value === 'wx_qr')
    wxPendingCode = code
}

async function loadLoginSettings() {
  const requestVersion = ++loginSettingsRequestVersion
  loginSettingsLoaded.value = false
  try {
    const response = await api.get('/api/settings/login-config', { skipErrorToast: true } as any)
    if (requestVersion !== loginSettingsRequestVersion)
      return
    const data = response.data?.data
    loginSettings.value = {
      wechatQrLogin: typeof data?.wechatQrLogin === 'boolean' ? data.wechatQrLogin : true,
    }
  }
  catch {
    if (requestVersion !== loginSettingsRequestVersion)
      return
    // Keep the existing login entries available when an older server has no endpoint yet.
    loginSettings.value = {
      wechatQrLogin: true,
    }
  }
  finally {
    if (requestVersion === loginSettingsRequestVersion) {
      loginSettingsLoaded.value = true
      if (activeLoginTab.value === 'wx_qr' && !loginSettings.value.wechatQrLogin)
        activeLoginTab.value = 'code'
    }
  }
}

async function loadQqCapability() {
  try {
    const { data } = await api.get('/api/napcat-login/capability', { skipErrorToast: true } as any)
    qqEnabled.value = data?.ok === true && data?.data?.enabled === true
  }
  catch {
    qqEnabled.value = false
  }
}

async function loadCaptureConfig() {
  try {
    const response = await api.get('/api/capture/config', { skipErrorToast: true } as any)
    captureEnabled.value = response.data?.ok === true && response.data?.data?.enabled === true
  }
  catch {
    captureEnabled.value = false
  }
  if (!captureEnabled.value && activeLoginTab.value === 'capture')
    activeLoginTab.value = 'code'
}

// 手动提交
async function submitManual() {
  errorMessage.value = ''
  if (!form.name.trim()) {
    errorMessage.value = '请输入账号备注'
    return
  }
  if (!form.code) {
    errorMessage.value = '请输入Code'
    return
  }
  form.name = form.name.trim()

  let code = form.code.trim()
  const match = code.match(/[?&]code=([^&]+)/i)
  if (match && match[1]) {
    code = decodeURIComponent(match[1])
    form.code = code
  }

  let payload: any = {}
  if (props.editData) {
    const onlyNameChanged = form.name !== props.editData.name
      && form.code === (props.editData.code || '')
      && form.platform === (props.editData.platform || 'qq')

    if (onlyNameChanged) {
      payload = { id: props.editData.id, name: form.name }
    }
    else {
      payload = {
        id: props.editData.id,
        name: form.name,
        code,
        platform: form.platform,
        loginType: 'manual',
      }
    }
  }
  else {
    payload = {
      name: form.name,
      code,
      platform: form.platform,
      loginType: 'manual',
    }
  }

  await addAccount(payload)
}

function stopWxPolling() {
  if (wxPollTimer) {
    clearTimeout(wxPollTimer)
    wxPollTimer = undefined
  }
  wxPollController?.abort()
  wxPollController = undefined
}

function resetWxLogin() {
  const oldTaskId = wxTaskId.value
  wxFlowVersion += 1
  stopWxPolling()
  if (oldTaskId) {
    void api.delete(`/api/wx-login/tasks/${oldTaskId}`, { skipErrorToast: true } as any).catch(() => undefined)
  }
  if (wxQrObjectUrl) {
    URL.revokeObjectURL(wxQrObjectUrl)
    wxQrObjectUrl = ''
  }
  wxTaskId.value = ''
  wxStatus.value = ''
  wxError.value = ''
  wxQrUrl.value = ''
  wxLoading.value = false
  wxPendingCode = ''
  clearQrNameSubmitTimer()
}

function isWxFlowActive(taskId: string, flowVersion: number) {
  return flowVersion === wxFlowVersion && taskId === wxTaskId.value
}

async function getWxCodeAndAdd(taskId: string, flowVersion: number) {
  if (!isWxFlowActive(taskId, flowVersion))
    return
  const codeResult = await api.post(`/api/wx-login/tasks/${taskId}/code`)
  if (!isWxFlowActive(taskId, flowVersion))
    return
  const code = String(codeResult.data?.data?.code || '').trim()
  const nickname = String(codeResult.data?.data?.nickname || '').trim()
  if (!code)
    throw new Error('未获取到登录 Code')

  await addQrAccount(code, nickname)
}

async function confirmWxLogin(taskId: string, flowVersion: number) {
  if (!isWxFlowActive(taskId, flowVersion))
    return
  wxStatus.value = '正在建立登录会话...'
  await api.post(`/api/wx-login/tasks/${taskId}/confirm`)
  if (!isWxFlowActive(taskId, flowVersion))
    return
  await getWxCodeAndAdd(taskId, flowVersion)
}

async function pollWxLoginRequest(taskId: string, flowVersion: number) {
  if (!isWxFlowActive(taskId, flowVersion))
    return

  const controller = new AbortController()
  wxPollController = controller
  try {
    const response = await runWxLoginStatusPoll(() => api.get(`/api/wx-login/tasks/${taskId}/status`, {
      timeout: 40000,
      signal: controller.signal,
      skipErrorToast: true,
    } as any))
    if (!isWxFlowActive(taskId, flowVersion))
      return
    const status = response.data?.data?.status
    if (status === 'waiting') {
      wxStatus.value = '等待微信扫码'
    }
    else if (status === 'scanned') {
      wxStatus.value = '已扫码，请在手机上确认'
    }
    else if (status === 'authorized') {
      stopWxPolling()
      await confirmWxLogin(taskId, flowVersion)
      return
    }
    else if (['cancelled', 'expired', 'failed'].includes(status)) {
      wxError.value = '二维码已失效，请重新获取'
      return
    }
    wxPollTimer = setTimeout(() => void pollWxLogin(taskId, flowVersion), 1200)
  }
  catch (error: any) {
    if (!isWxFlowActive(taskId, flowVersion) || error?.name === 'CanceledError' || error?.code === 'ERR_CANCELED')
      return
    wxError.value = getApiErrorMessage(error, '登录状态检查失败')
  }
  finally {
    if (wxPollController === controller)
      wxPollController = undefined
  }
}

async function pollWxLogin(taskId: string, flowVersion: number) {
  if (!isWxFlowActive(taskId, flowVersion))
    return

  const previous = wxPollInFlight
  const previousKey = wxPollKey
  if (previous) {
    await previous.catch(() => undefined)
    if (!isWxFlowActive(taskId, flowVersion))
      return
    if (previousKey === `${taskId}:${flowVersion}`)
      return
  }

  const current = pollWxLoginRequest(taskId, flowVersion)
  wxPollInFlight = current
  wxPollKey = `${taskId}:${flowVersion}`
  try {
    await current
  }
  finally {
    if (wxPollInFlight === current) {
      wxPollInFlight = undefined
      wxPollKey = ''
    }
  }
}

async function startWxLogin() {
  if (!wechatQrLoginEnabled.value) {
    activeLoginTab.value = 'code'
    return
  }
  resetWxLogin()
  const flowVersion = wxFlowVersion
  wxLoading.value = true
  try {
    const response = await api.post('/api/wx-login/tasks', { app_id: 'wx5306c5978fdb76e4' })
    const task = response.data?.data
    const taskId = String(task?.task_id || '')
    if (!taskId)
      throw new Error('未创建登录任务')
    if (flowVersion !== wxFlowVersion) {
      void api.delete(`/api/wx-login/tasks/${taskId}`, { skipErrorToast: true } as any).catch(() => undefined)
      return
    }
    wxTaskId.value = taskId
    const qrResponse = await api.get(task.qr_url, { responseType: 'blob' })
    if (!isWxFlowActive(taskId, flowVersion))
      return
    wxQrObjectUrl = URL.createObjectURL(qrResponse.data)
    wxQrUrl.value = wxQrObjectUrl
    wxStatus.value = '等待微信扫码'
    void pollWxLogin(taskId, flowVersion)
  }
  catch (error: any) {
    if (flowVersion !== wxFlowVersion)
      return
    wxError.value = getApiErrorMessage(error, '二维码获取失败')
  }
  finally {
    if (flowVersion === wxFlowVersion)
      wxLoading.value = false
  }
}

const { pause: stopQqCheck, resume: startQqCheck } = useIntervalFn(async () => {
  if (activeLoginTab.value !== 'qq_qr' || !qqTaskId.value || qqLoading.value)
    return
  if (qqQrCreatedAt.value && Date.now() - qqQrCreatedAt.value >= QQ_QR_AUTO_REFRESH_MS) {
    await startQqLogin()
    return
  }
  try {
    const { data } = await api.post(`/api/napcat-login/tasks/${qqTaskId.value}/status`, undefined, { timeout: 20000, skipErrorToast: true } as any)
    if (!data?.ok)
      throw new Error(data?.error || '查询扫码状态失败')
    const status = String(data.data.status || '')
    qqStatus.value = status === 'scanned' ? '已扫码，请在 QQ 中确认' : '请使用 QQ 扫码登录'
    if (status === 'confirmed') {
      stopQqCheck()
      qqLoading.value = true
      qqStatus.value = '正在获取农场 Code 并清理 QQ 会话…'
      const result = await api.post(`/api/napcat-login/tasks/${qqTaskId.value}/code`, undefined, { timeout: 120000, skipErrorToast: true } as any)
      if (!result.data?.ok || !result.data.data?.code)
        throw new Error(result.data?.error || '获取农场 Code 失败')
      const info = result.data.data
      qqTaskId.value = ''
      qqQrUrl.value = ''
      qqQrCreatedAt.value = 0
      await addAccount({
        id: props.editData?.id,
        name: props.editData?.name || form.name.trim() || info.nickname || `QQ账号${info.uin || Date.now()}`,
        code: info.code,
        platform: 'qq',
        loginType: 'qq_napcat',
        qq: info.uin || '',
        uin: info.uin || '',
        startAfterSave: true,
      })
    }
  }
  catch (e: any) {
    stopQqCheck()
    qqError.value = getApiErrorMessage(e, 'QQ 扫码登录失败')
  }
  finally {
    qqLoading.value = false
  }
}, 1500, { immediate: false })

async function cancelQqTask() {
  stopQqCheck()
  const id = qqTaskId.value
  qqTaskId.value = ''
  qqQrUrl.value = ''
  qqQrCreatedAt.value = 0
  if (id) {
    try {
      await api.post(`/api/napcat-login/tasks/${id}/cancel`, undefined, { timeout: 30000, skipErrorToast: true } as any)
    }
    catch {}
  }
}

async function startQqLogin(forceRefresh = Boolean(qqQrUrl.value)) {
  if (qqLoading.value)
    return
  qqLoading.value = true
  qqError.value = ''
  await cancelQqTask()
  try {
    const { data } = await api.post('/api/napcat-login/tasks', { refresh: forceRefresh }, { timeout: 30000, skipErrorToast: true } as any)
    if (!data?.ok || !data.data?.taskId)
      throw new Error(data?.error || '获取 QQ 二维码失败')
    qqTaskId.value = data.data.taskId
    qqQrUrl.value = data.data.qrImage
    qqQrCreatedAt.value = Date.now()
    qqStatus.value = '请使用 QQ 扫码并确认登录'
    startQqCheck()
  }
  catch (e: any) {
    qqError.value = getApiErrorMessage(e, '获取 QQ 二维码失败')
  }
  finally {
    qqLoading.value = false
  }
}

function handleCaptureSaved() {
  emit('saved')
  close()
}

function close() {
  resetWxLogin()
  void cancelQqTask()
  emit('close')
}

watch(() => props.show, (newVal) => {
  if (newVal) {
    errorMessage.value = ''
    activeLoginTab.value = 'code'
    resetWxLogin()
    if (!props.editData) {
      void loadLoginSettings()
      void loadQqCapability()
      void loadCaptureConfig()
    }
    if (props.editData) {
      form.name = props.editData.name || ''
      form.code = props.editData.code || ''
      form.platform = props.editData.platform || 'qq'
    }
    else {
      form.name = ''
      form.code = ''
      form.platform = 'qq'
    }
  }
})

watch(activeLoginTab, (tab) => {
  if (tab === 'wx_qr' && wechatQrLoginEnabled.value && !wxTaskId.value)
    void startWxLogin()
  else if (tab === 'wx_qr' && !wechatQrLoginEnabled.value)
    activeLoginTab.value = 'code'
  else if (tab === 'qq_qr' && qqEnabled.value && !qqTaskId.value)
    void startQqLogin()
  else if (tab === 'qq_qr' && !qqEnabled.value)
    activeLoginTab.value = 'code'
  else if (tab === 'capture' && !captureEnabled.value)
    activeLoginTab.value = 'code'
  if (tab !== 'wx_qr')
    resetWxLogin()
  if (tab !== 'qq_qr')
    void cancelQqTask()
})

watch(() => form.name, (name) => {
  clearQrNameSubmitTimer()
  if (!name.trim())
    return
  if (activeLoginTab.value !== 'wx_qr' || !wxPendingCode)
    return
  qrNameSubmitTimer = setTimeout(() => void submitPendingWxAccount(), 800)
})

onBeforeUnmount(() => {
  resetWxLogin()
  void cancelQqTask()
})
</script>

<template>
  <NModal
    :show="show"
    :mask-closable="!loading && !wxLoading && !qqLoading"
    :close-on-esc="!loading && !wxLoading && !qqLoading"
    @update:show="value => !value && close()"
  >
    <NCard
      class="account-modal-card"
      :title="editData ? '编辑账号' : '添加账号'"
      :bordered="false"
      :closable="!loading && !wxLoading && !qqLoading"
      @close="close"
    >
      <div class="account-modal-content overflow-y-auto">
        <!-- 错误信息 -->
        <div v-if="errorMessage" class="mb-4 rounded-xl p-3 text-sm" style="background: rgba(239, 68, 68, 0.1); color: #ef4444">
          {{ errorMessage }}
        </div>

        <NTabs v-if="!editData && loginSettingsLoaded" v-model:value="activeLoginTab" class="mb-4" type="line">
          <NTab name="code">
            输入 Code 登录
          </NTab>
          <NTab v-if="wechatQrLoginEnabled" name="wx_qr">
            微信扫码登录
          </NTab>
          <NTab v-if="qqEnabled" name="qq_qr">
            QQ扫码登录
          </NTab>
          <NTab v-if="captureEnabled" name="capture">
            抓包登录
          </NTab>
        </NTabs>

        <div v-if="editData || activeLoginTab === 'code'" class="space-y-4">
          <BaseInput
            v-model="form.name"
            label="账号备注（必填）"
            placeholder="请输入账号备注"
            class="farm-input"
          />

          <BaseTextarea
            v-model="form.code"
            label="Code"
            placeholder="请输入登录 Code"
            :rows="3"
            class="farm-input"
          />

          <NRadioGroup v-if="!editData" v-model:value="form.platform" name="account-platform">
            <div class="flex gap-5">
              <NRadio value="qq">
                QQ 小程序
              </NRadio>
              <NRadio value="wx">
                微信小程序
              </NRadio>
            </div>
          </NRadioGroup>

          <div class="flex justify-end gap-2 pt-4">
            <BaseButton variant="outline" @click="close">
              取消
            </BaseButton>
            <BaseButton variant="primary" :loading="loading" @click="submitManual">
              {{ editData ? '保存' : '添加' }}
            </BaseButton>
          </div>
        </div>
        <div v-else-if="activeLoginTab === 'wx_qr'" class="space-y-4" role="tabpanel" aria-label="微信扫码登录">
          <BaseInput
            v-model="form.name"
            label="账号备注（可留空）"
            placeholder="留空时使用微信昵称"
            class="farm-input"
          />
          <div class="min-h-64 flex flex-col items-center justify-center gap-3">
            <div v-if="wxQrUrl" class="bg-white p-2">
              <img :src="wxQrUrl" alt="微信登录二维码" class="h-52 w-52">
            </div>
            <div v-else class="h-52 w-52 flex items-center justify-center text-sm opacity-60">
              {{ wxLoading ? '正在获取二维码...' : '二维码不可用' }}
            </div>
            <p class="text-sm" :style="{ color: 'var(--theme-text)' }">
              {{ wxStatus }}
            </p>
            <p v-if="wxError" class="text-sm text-red-500">
              {{ wxError }}
            </p>
          </div>
          <div class="flex justify-end gap-2">
            <BaseButton variant="outline" @click="startWxLogin">
              刷新二维码
            </BaseButton>
            <BaseButton variant="outline" @click="close">
              取消
            </BaseButton>
          </div>
        </div>
        <div v-else-if="activeLoginTab === 'qq_qr'" class="space-y-4" role="tabpanel" aria-label="QQ扫码登录">
          <BaseInput
            v-model="form.name"
            label="账号备注（可留空）"
            placeholder="留空时使用 QQ 昵称"
            class="farm-input"
          />
          <div class="min-h-64 flex flex-col items-center justify-center gap-3">
            <div v-if="qqQrUrl" class="bg-white p-2">
              <img :src="qqQrUrl" alt="QQ登录二维码" class="h-52 w-52">
            </div>
            <div v-else class="h-52 w-52 flex items-center justify-center text-sm opacity-60">
              {{ qqLoading ? '正在获取二维码...' : '二维码不可用' }}
            </div>
            <p class="text-sm" :style="{ color: 'var(--theme-text)' }">
              {{ qqStatus }}
            </p>
            <p v-if="qqError" class="text-sm text-red-500">
              {{ qqError }}
            </p>
          </div>
          <div class="flex justify-end gap-2">
            <BaseButton variant="outline" :loading="qqLoading" @click="startQqLogin(true)">
              刷新二维码
            </BaseButton>
            <BaseButton variant="outline" @click="close">
              取消
            </BaseButton>
          </div>
        </div>
        <CaptureLoginPanel
          v-else-if="activeLoginTab === 'capture'"
          :initial-name="form.name"
          @saved="handleCaptureSaved"
          @cancel="close"
        />
      </div>
    </NCard>
  </NModal>
</template>

<style scoped>
.account-modal-card {
  width: min(448px, calc(100vw - 32px));
}

.account-modal-content {
  max-height: calc(90vh - 100px);
}
</style>
