export interface MenuItem {
  path: string
  name: string
  label: string
  icon: string
  component: () => Promise<any>
  adminOnly?: boolean
  membershipRequired?: boolean
  meta?: {
    fullBleed?: boolean
  }
}

export const menuRoutes: MenuItem[] = [
  {
    path: '',
    name: 'dashboard',
    label: '概览',
    icon: 'i-carbon-dashboard',
    membershipRequired: true,
    component: () => import('@/views/Dashboard.vue'),
  },
  {
    path: 'personal',
    name: 'personal',
    label: '个人',
    icon: 'i-carbon-sprout',
    membershipRequired: true,
    component: () => import('@/views/Personal.vue'),
  },
  {
    path: 'activity',
    name: 'activity-center',
    label: '活动',
    icon: 'i-carbon-events',
    membershipRequired: true,
    component: () => import('@/views/ActivityCenter.vue'),
  },
  {
    path: 'friends',
    name: 'friends',
    label: '好友',
    icon: 'i-carbon-user-multiple',
    membershipRequired: true,
    component: () => import('@/views/Friends.vue'),
  },
  {
    path: 'analytics',
    name: 'analytics',
    label: '分析',
    icon: 'i-carbon-chart-line',
    membershipRequired: true,
    component: () => import('@/views/Analytics.vue'),
  },
  {
    path: 'mystery-shop',
    name: 'mystery-shop',
    label: '神秘商人',
    icon: 'i-carbon-store',
    membershipRequired: true,
    component: () => import('@/views/MysteryShop.vue'),
  },
  {
    path: 'game-mall',
    name: 'game-mall',
    label: '游戏商城',
    icon: 'i-carbon-shopping-cart',
    membershipRequired: true,
    component: () => import('@/views/GameMall.vue'),
  },
  {
    path: 'settings',
    name: 'Settings',
    label: '设置',
    icon: 'i-carbon-settings',
    component: () => import('@/views/Settings.vue'),
  },
  {
    path: 'admin-users',
    name: 'admin-users',
    label: '用户与卡密',
    icon: 'i-carbon-user-role',
    adminOnly: true,
    component: () => import('@/views/AdminUsers.vue'),
  },
]
