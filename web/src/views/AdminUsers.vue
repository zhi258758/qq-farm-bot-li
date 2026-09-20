<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import api, { getApiErrorMessage } from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'

interface PanelUser {
  id: string
  username: string
  qq: string
  enabled: boolean
  membershipExpiresAt: number | null
  membershipActive: boolean
  slotLimit: number
  slotUsed: number
}

interface CardKeyItem {
  code: string
  rawCode?: string
  type: 'time' | 'quota'
  value: number
  status: 'unused' | 'used' | 'voided'
  createdAt: number
  usedAt?: number | null
  usedByUsername?: string | null
}

const registrationEnabled = ref(false)
const cardClaimEnabled = ref(false)
const claimCardCode = ref('')
const configSaving = ref(false)
const users = ref<PanelUser[]>([])
const keys = ref<CardKeyItem[]>([])
const createdKeys = ref<CardKeyItem[]>([])
const error = ref('')
const notice = ref('')

const generateForm = ref({
  type: 'time',
  value: '30',
  count: '1',
})
const generating = ref(false)
const filterType = ref('')
const filterStatus = ref('')

const typeOptions = [
  { label: '时间卡密', value: 'time' },
  { label: '额度卡密', value: 'quota' },
]
const filterTypeOptions = [
  { label: '全部类型', value: '' },
  ...typeOptions,
]
const filterStatusOptions = [
  { label: '全部状态', value: '' },
  { label: '未使用', value: 'unused' },
  { label: '已使用', value: 'used' },
  { label: '已作废', value: 'voided' },
]

const generateHint = computed(() => generateForm.value.type === 'time' ? '天数' : '槽位数')

function formatTime(value?: number | null) {
  if (!value)
    return '未开通'
  return new Date(value).toLocaleString()
}

function typeLabel(type: string) {
  return type === 'quota' ? '额度卡密' : '时间卡密'
}

function statusLabel(status: string) {
  if (status === 'used')
    return '已使用'
  if (status === 'voided')
    return '已作废'
  return '未使用'
}

async function loadConfig() {
  const res = await api.get('/api/admin/auth-config')
  if (res.data.ok) {
    registrationEnabled.value = res.data.data.registrationEnabled === true
    cardClaimEnabled.value = res.data.data.cardClaimEnabled === true
    claimCardCode.value = String(res.data.data.claimCardCode || '')
  }
}

async function saveConfig() {
  configSaving.value = true
  error.value = ''
  notice.value = ''
  try {
    const res = await api.put('/api/admin/auth-config', {
      registrationEnabled: registrationEnabled.value,
      cardClaimEnabled: cardClaimEnabled.value,
      claimCardCode: claimCardCode.value.trim(),
    })
    if (res.data.ok)
      notice.value = '运营开关已保存'
  }
  catch (e) {
    error.value = getApiErrorMessage(e, '保存失败')
  }
  finally {
    configSaving.value = false
  }
}

async function loadUsers() {
  const res = await api.get('/api/admin/users')
  if (res.data.ok)
    users.value = res.data.data || []
}

async function loadKeys() {
  const res = await api.get('/api/admin/cardkeys', {
    params: {
      type: filterType.value || undefined,
      status: filterStatus.value || undefined,
    },
  })
  if (res.data.ok)
    keys.value = res.data.data || []
}

async function generateKeys() {
  generating.value = true
  error.value = ''
  notice.value = ''
  try {
    const res = await api.post('/api/admin/cardkeys', {
      type: generateForm.value.type,
      value: Number(generateForm.value.value),
      count: Number(generateForm.value.count),
    })
    if (res.data.ok) {
      createdKeys.value = res.data.data || []
      notice.value = `已生成 ${createdKeys.value.length} 张卡密`
      await loadKeys()
    }
  }
  catch (e) {
    error.value = getApiErrorMessage(e, '生成失败')
  }
  finally {
    generating.value = false
  }
}

async function voidKey(code: string) {
  error.value = ''
  try {
    const res = await api.post(`/api/admin/cardkeys/${encodeURIComponent(code)}/void`)
    if (res.data.ok) {
      notice.value = '卡密已作废'
      await loadKeys()
    }
  }
  catch (e) {
    error.value = getApiErrorMessage(e, '作废失败')
  }
}

async function toggleUser(user: PanelUser, enabled?: boolean) {
  const nextEnabled = enabled === true
  error.value = ''
  const res = await api.patch(`/api/admin/users/${user.id}`, { enabled: nextEnabled })
  if (res.data.ok)
    await loadUsers()
}

async function saveUser(user: PanelUser) {
  error.value = ''
  notice.value = ''
  const expires = Number(user.membershipExpiresAt)
  const res = await api.patch(`/api/admin/users/${user.id}`, {
    membershipExpiresAt: Number.isFinite(expires) && expires > 0 ? expires : null,
    slotLimit: Number(user.slotLimit),
    qq: user.qq,
  })
  if (res.data.ok)
    notice.value = `已更新用户 ${user.username}`
  else
    error.value = res.data.error || '保存失败'
}

onMounted(async () => {
  await Promise.all([loadConfig(), loadUsers(), loadKeys()])
})
</script>

<template>
  <div class="admin-page space-y-4 p-4">
    <header>
      <h2 class="text-xl font-bold">
        用户与卡密
      </h2>
      <p class="mt-1 text-sm text-gray-500">
        开关注册和卡密领取，生成时间卡密或额度卡密，并管理用户会员与槽位。
      </p>
    </header>

    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
      {{ error }}
    </p>
    <p v-if="notice" class="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
      {{ notice }}
    </p>

    <section class="farm-card rounded-lg p-4">
      <h3 class="mb-3 font-bold">
        运营开关
      </h3>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div class="rounded-lg border border-gray-200 p-3">
          <BaseSwitch v-model="registrationEnabled" label="开放用户注册" />
        </div>
        <div class="rounded-lg border border-gray-200 p-3">
          <BaseSwitch v-model="cardClaimEnabled" label="开放卡密领取" />
        </div>
      </div>
      <div class="mt-3">
        <BaseInput
          v-model="claimCardCode"
          label="指定领取卡密（留空自动选择可用时间卡密）"
          placeholder="例如 QFXXXXXXXXXXXXXXXXXXXX"
        />
      </div>
      <div class="mt-3 flex justify-end">
        <BaseButton variant="primary" size="sm" :loading="configSaving" @click="saveConfig">
          保存开关
        </BaseButton>
      </div>
    </section>

    <section class="farm-card rounded-lg p-4">
      <h3 class="mb-3 font-bold">
        生成卡密
      </h3>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <BaseSelect v-model="generateForm.type" label="类型" :options="typeOptions" />
        <BaseInput v-model="generateForm.value" :label="generateHint" type="number" />
        <BaseInput v-model="generateForm.count" label="数量" type="number" />
        <div class="flex items-end">
          <BaseButton variant="primary" block :loading="generating" @click="generateKeys">
            生成
          </BaseButton>
        </div>
      </div>
      <div v-if="createdKeys.length" class="mt-3 rounded-lg bg-gray-50 p-3 text-sm">
        <p class="mb-2 font-medium">
          新卡密（仅展示一次）
        </p>
        <div class="space-y-1 font-mono">
          <div v-for="item in createdKeys" :key="item.code">
            {{ item.rawCode || item.code }} · {{ typeLabel(item.type) }} · {{ item.value }}
          </div>
        </div>
      </div>
    </section>

    <section class="farm-card rounded-lg p-4">
      <div class="mb-3 flex flex-wrap items-end gap-3">
        <h3 class="font-bold">
          卡密列表
        </h3>
        <BaseSelect v-model="filterType" label="类型" :options="filterTypeOptions" @change="loadKeys" />
        <BaseSelect v-model="filterStatus" label="状态" :options="filterStatusOptions" @change="loadKeys" />
      </div>
      <div class="overflow-auto">
        <table class="min-w-full text-left text-sm">
          <thead>
            <tr class="border-b text-gray-500">
              <th class="py-2 pr-3">卡密</th>
              <th class="py-2 pr-3">类型</th>
              <th class="py-2 pr-3">面值</th>
              <th class="py-2 pr-3">状态</th>
              <th class="py-2 pr-3">使用者</th>
              <th class="py-2 pr-3">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in keys" :key="item.code + item.createdAt" class="border-b border-gray-100">
              <td class="py-2 pr-3 font-mono">
                {{ item.rawCode || item.code }}
              </td>
              <td class="py-2 pr-3">
                {{ typeLabel(item.type) }}
              </td>
              <td class="py-2 pr-3">
                {{ item.type === 'time' ? `${item.value} 天` : `${item.value} 槽` }}
              </td>
              <td class="py-2 pr-3">
                {{ statusLabel(item.status) }}
              </td>
              <td class="py-2 pr-3">
                {{ item.usedByUsername || '-' }}
              </td>
              <td class="py-2 pr-3">
                <BaseButton
                  v-if="item.status === 'unused'"
                  size="sm"
                  variant="secondary"
                  @click="voidKey(item.rawCode || item.code)"
                >
                  作废
                </BaseButton>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="farm-card rounded-lg p-4">
      <h3 class="mb-3 font-bold">
        用户列表
      </h3>
      <div class="overflow-auto">
        <table class="min-w-full text-left text-sm">
          <thead>
            <tr class="border-b text-gray-500">
              <th class="py-2 pr-3">用户名</th>
              <th class="py-2 pr-3">QQ号</th>
              <th class="py-2 pr-3">会员到期</th>
              <th class="py-2 pr-3">槽位</th>
              <th class="py-2 pr-3">启用</th>
              <th class="py-2 pr-3">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="user in users" :key="user.id" class="border-b border-gray-100">
              <td class="py-2 pr-3">
                {{ user.username }}
              </td>
              <td class="py-2 pr-3">
                <input v-model="user.qq" class="w-32 rounded border px-2 py-1" type="text" placeholder="未绑定">
              </td>
              <td class="py-2 pr-3">
                <input
                  v-model.number="user.membershipExpiresAt"
                  class="w-48 rounded border px-2 py-1"
                  type="number"
                >
                <div class="text-xs text-gray-400">
                  {{ formatTime(user.membershipExpiresAt) }}
                </div>
              </td>
              <td class="py-2 pr-3">
                <input v-model.number="user.slotLimit" class="w-20 rounded border px-2 py-1" type="number">
                <span class="ml-1 text-xs text-gray-400">已用 {{ user.slotUsed }}</span>
              </td>
              <td class="py-2 pr-3">
                <BaseSwitch :model-value="user.enabled" @update:model-value="toggleUser(user, $event)" />
              </td>
              <td class="py-2 pr-3">
                <BaseButton size="sm" variant="primary" @click="saveUser(user)">
                  保存
                </BaseButton>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
