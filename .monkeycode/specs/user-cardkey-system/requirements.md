# Requirements Document

## Introduction

当前 QQ 农场挂机面板仅支持单一超级管理员登录，游戏账号全部归属于该管理员实例。本需求将面板扩展为多用户系统：普通用户可注册、登录并管理自己的游戏账号；通过卡密获得使用权限。卡密分为时间卡密与额度卡密两类。管理员可在后台开关用户注册与卡密领取，并生成、查询、作废卡密。

## Glossary

- **System**: QQ 农场挂机 Web 面板及其后端服务
- **Administrator**: 现有超级管理员账号，拥有用户管理、卡密管理、注册开关和全部游戏账号的访问权限
- **User**: 通过注册创建的普通面板账号，仅能访问该 User 自己绑定的游戏账号
- **Card Key**: 由 Administrator 生成的一次性兑换码，用于向 User 授予时间或额度
- **Time Card Key**: 兑换后为 User 增加会员有效期的 Card Key
- **Quota Card Key**: 兑换后为 User 增加游戏账号槽位的 Card Key
- **Membership**: User 的有效使用状态，由到期时间决定
- **Account Slot**: User 可添加并运行的游戏账号数量上限；新注册 User 的默认槽位上限为 2
- **Registration Switch**: Administrator 控制是否允许新 User 注册
- **Card Claim Switch**: Administrator 控制是否允许 User 兑换 Card Key
- **Game Account**: 面板中用于挂机的 QQ/微信农场账号，归属某一个 User 或 Administrator

## Requirements

### Requirement 1: 用户注册与登录

**User Story:** AS 访客, I want 在管理员开放注册时创建自己的面板账号, so that 我可以登录并使用挂机功能

#### Acceptance Criteria

1. WHEN Registration Switch 为开启且访客提交符合规则的用户名和非空密码, the System SHALL 创建 User 记录并返回登录成功结果
2. WHEN Registration Switch 为关闭且访客请求注册, the System SHALL 拒绝注册并提示注册未开放
3. WHEN User 或 Administrator 提交正确的用户名和密码, the System SHALL 签发会话令牌并返回角色信息
4. IF 同一用户名已存在, the System SHALL 拒绝注册并提示用户名已被占用
5. IF 登录失败次数达到现有安全策略阈值, the System SHALL 按现有锁定与频率限制规则拒绝后续尝试

### Requirement 2: 用户会话与资料

**User Story:** AS User, I want 查看自己的账号状态并修改密码, so that 我能确认会员剩余时间和账号槽位

#### Acceptance Criteria

1. WHEN 已登录 User 请求当前资料, the System SHALL 返回用户名、角色、会员到期时间、已用槽位和槽位上限
2. WHEN 已登录 User 提供正确原密码与非空新密码, the System SHALL 更新密码并作废该 User 的既有会话令牌
3. WHILE User 尚未开通会员或会员已过期, the System SHALL 允许登录并仅提供资料查看、修改密码和兑换卡密
4. WHILE User 尚未开通会员或会员已过期, the System SHALL 停止该 User 名下游戏账号的自动化运行
5. WHEN System 创建新 User, the System SHALL 将该 User 的槽位上限设为 2，并将会员状态设为未开通

### Requirement 3: 游戏账号租户隔离

**User Story:** AS User, I want 只看到和管理自己的游戏账号, so that 我的挂机数据不会被其他用户访问

#### Acceptance Criteria

1. WHEN User 请求游戏账号列表, the System SHALL 仅返回归属该 User 的游戏账号
2. WHEN User 新增游戏账号且当前已用槽位小于槽位上限且会员未过期, the System SHALL 创建归属该 User 的游戏账号
3. IF User 新增游戏账号时会员未开通或已过期, the System SHALL 拒绝创建并提示需要先兑换时间卡密
4. IF User 新增游戏账号时已用槽位已达到槽位上限, the System SHALL 拒绝创建并提示槽位不足
5. WHEN User 访问不属于该 User 的游戏账号或管理接口, the System SHALL 拒绝请求
6. WHEN Administrator 请求游戏账号列表, the System SHALL 返回全部游戏账号及其归属用户
7. WHEN System 首次启用用户体系且数据中已有未标注归属的游戏账号, the System SHALL 将这些游戏账号归属给 Administrator

### Requirement 4: 时间卡密

**User Story:** AS User, I want 兑换时间卡密以延长会员有效期, so that 我可以在有效期内继续挂机

#### Acceptance Criteria

1. WHEN Administrator 提交自定义正整数天数和生成数量, the System SHALL 生成对应数量的唯一时间卡密，每张记录类型为时间、面值天数和未使用状态
2. WHEN User 在 Card Claim Switch 开启时兑换一张未使用且未作废的时间卡密, the System SHALL 将该卡密标记为已使用，并把 User 的会员到期时间按面值天数延长
3. IF User 当前会员已过期或尚未开通, the System SHALL 从兑换成功时刻起计算新的到期时间
4. IF User 当前会员尚未过期, the System SHALL 从现有到期时间起累加面值天数
5. IF 卡密不存在、已使用或已作废, the System SHALL 拒绝兑换并保持 User 会员状态不变

### Requirement 5: 额度卡密

**User Story:** AS User, I want 兑换额度卡密以增加可挂机的游戏账号数量, so that 我可以同时运行更多账号

#### Acceptance Criteria

1. WHEN Administrator 指定槽位数量和生成数量生成额度卡密, the System SHALL 生成对应数量的唯一 Card Key，每张记录类型为额度、面值槽位数和未使用状态
2. WHEN User 在 Card Claim Switch 开启时兑换一张未使用且未作废的额度卡密, the System SHALL 将该卡密标记为已使用，并把 User 的槽位上限增加该卡密面值
3. IF User 尚未开通会员, the System SHALL 拒绝兑换额度卡密并提示需要先兑换时间卡密
4. IF 卡密不存在、已使用或已作废, the System SHALL 拒绝兑换并保持 User 槽位上限不变
5. WHEN User 的槽位上限被调低且已用槽位大于新上限, the System SHALL 保留已有游戏账号并阻止继续新增，直到已用槽位低于或等于新上限
6. WHEN 已登录 User 请求兑换记录, the System SHALL 仅返回该 User 自己的卡密兑换记录，字段包含卡密类型、面值、兑换时间和脱敏卡密

### Requirement 6: 管理员开关注册与领取卡密

**User Story:** AS Administrator, I want 分别控制是否开放注册和是否允许领取卡密, so that 我能按运营需要启停用户增长和卡密兑换

#### Acceptance Criteria

1. WHEN Administrator 将 Registration Switch 设为开启或关闭, the System SHALL 立即按新状态处理后续注册请求
2. WHEN Administrator 将 Card Claim Switch 设为开启或关闭, the System SHALL 立即按新状态处理后续卡密兑换请求
3. WHEN Card Claim Switch 为关闭且 User 请求兑换卡密, the System SHALL 拒绝兑换并提示领取未开放
4. WHEN 未登录访客请求当前开关状态, the System SHALL 返回 Registration Switch 状态，供登录页展示是否显示注册入口
5. WHEN Administrator 请求运营配置, the System SHALL 返回 Registration Switch 和 Card Claim Switch 的当前值

### Requirement 7: 管理员卡密生命周期

**User Story:** AS Administrator, I want 批量生成、查询和作废卡密, so that 我能向用户发放使用权限并处理误发或泄露

#### Acceptance Criteria

1. WHEN Administrator 提交卡密类型、面值和生成数量, the System SHALL 生成唯一卡密列表并返回明文卡密一次
2. WHEN Administrator 按类型、状态或使用者筛选卡密, the System SHALL 返回匹配的卡密记录，已使用记录包含使用用户和兑换时间
3. WHEN Administrator 作废一张未使用卡密, the System SHALL 将该卡密标记为已作废
4. IF Administrator 作废一张已使用卡密, the System SHALL 拒绝作废并提示该卡密已被兑换
5. WHEN Administrator 查看卡密列表, the System SHALL 对未使用卡密展示完整卡密，对已使用卡密展示脱敏卡密

### Requirement 8: 管理员用户管理

**User Story:** AS Administrator, I want 查看和调整用户的会员与槽位, so that 我能处理投诉、补偿和违规账号

#### Acceptance Criteria

1. WHEN Administrator 请求用户列表, the System SHALL 返回每个 User 的用户名、会员到期时间、槽位上限、已用槽位和启用状态
2. WHEN Administrator 调整某 User 的会员到期时间或槽位上限, the System SHALL 保存新值并立即按新值约束该 User 的运行和新增账号
3. WHEN Administrator 禁用某 User, the System SHALL 作废该 User 的会话令牌并停止该 User 名下游戏账号的自动化运行
4. WHILE 某 User 处于禁用状态, the System SHALL 拒绝该 User 的登录请求
5. WHEN Administrator 启用某 User, the System SHALL 允许该 User 在会员有效期内重新登录并恢复自动化运行

### Requirement 9: 权限边界

**User Story:** AS Administrator, I want 普通用户无法访问后台管理能力, so that 运营配置和全站数据只由管理员控制

#### Acceptance Criteria

1. WHEN User 请求卡密生成、卡密列表、用户列表或运营开关接口, the System SHALL 拒绝请求
2. WHILE User 已登录且会员未过期, the System SHALL 允许该 User 使用现有挂机面板功能，范围限于该 User 的游戏账号
3. WHEN Administrator 访问现有设置、系统配置和全部游戏账号接口, the System SHALL 继续允许访问
4. WHEN 现有默认 Administrator 账号首次启动, the System SHALL 保留该账号为唯一超级管理员，不把该账号计入普通 User 卡密体系
5. WHILE Administrator 使用面板, the System SHALL 对 Administrator 的游戏账号数量和会员时间不做卡密限制
