# SkyGuard 前端改造指令（给 Codex）

> 版本：v1.0　·　日期：2026-11-20
> 目标：把现有单页面（23 个面板平铺）重组为 4 个业务页面 + 1 个保底页，
> 视觉沿用现有深色令牌，信息层级按新设计图重排。
> **核心原则：数据结构、算法、API 一行不改；只重组前端。**

---

## 0. 绝对红线（违反即回滚）

```
❌ 不要修改 backend/src/services/safety/**
❌ 不要修改 backend/src/services/mvp/**
❌ 不要修改 frontend/src/services/**
❌ 不要重写 NetworkMap.tsx（只改 CSS 类，不改 JSX 结构）
❌ 不要删除现有测试
❌ 不要把深色主题改成浅色
```

**为什么**：`services/` 里有 47 个类型和 47 个 API 路由的契约，改一个字段会让整个前端崩。

---

## 1. 现状

```
frontend/src/
├─ App.tsx                    3 条路由
├─ index.css                  深色令牌（:root 变量）
├─ pages/
│   ├─ command-center/
│   │   ├─ CommandCenterPage.tsx      30.8 KB · 10 个区块
│   │   ├─ CommandCenterPage.css      44.2 KB
│   │   ├─ MvpPanels.tsx              38.8 KB · 13 个面板
│   │   ├─ MvpPanels.css              21.2 KB
│   │   ├─ SimulationPanel.tsx        11.1 KB
│   │   ├─ PerceptionReplayPanel.tsx  15.6 KB
│   │   ├─ ThemeSettings.tsx
│   │   └─ components/
│   │       ├─ NetworkMap.tsx         17.7 KB · 唯一地图渲染
│   │       └─ Panels.tsx
│   ├─ LoginPage.tsx
│   └─ StaffPage.tsx
└─ services/
    ├─ safetyApi.ts       24 类型
    ├─ mvpApi.ts          13 类型
    └─ perceptionApi.ts   10 类型
```

**问题**：`/` 一屏塞 23 个面板，观众不知道看什么。

---

## 2. 目标路由

```
/          → 重定向到 /plan
/plan      → P1 预案推演          【新建】
/live      → P2 现场总览          【新建，三时段】
/replay    → P3 决策回放          【新建，复用 PerceptionReplayPanel】
/audit     → P4 审计记录          【新建，复用 /safety/audit 数据】
/legacy    → 旧 CommandCenterPage 【保留，原样挂载】
/login     → 不变
/staff     → 不变
```

### App.tsx 改法

```tsx
const PlanPage = lazy(() => import('./pages/plan/PlanPage'));
const LivePage = lazy(() => import('./pages/live/LivePage'));
const ReplayPage = lazy(() => import('./pages/replay/ReplayPage'));
const AuditPage = lazy(() => import('./pages/audit/AuditPage'));
const LegacyPage = lazy(() => import('./pages/command-center/CommandCenterPage'));

<Route path="/" element={<Navigate to="/plan" replace />} />
<Route path="/plan" element={<PlanPage />} />
<Route path="/live" element={<LivePage />} />
<Route path="/replay" element={<ReplayPage />} />
<Route path="/audit" element={<AuditPage />} />
<Route path="/legacy" element={<LegacyPage />} />
```

---

## 3. 视觉令牌（沿用现有，不要改）

**从 `index.css` 的 `:root` 读取，不要硬编码颜色。**

```css
--bg: #070b13;          /* 页面底 */
--panel: #0c131f;       /* 面板底 */
--panel-2: #111a29;     /* 次级面板 */
--text: #e9eff8;        /* 主文字 */
--muted: #8295ad;       /* 次文字 */
--faint: #6b7f99;       /* 辅助 */
--border: #1d2a3d;      /* 边框 */
--accent: #34e0c8;      /* 强调（青） */
--ok: #43e0a0;          /* 正常 */
--warn: #f2c15c;        /* 警告 */
--degraded: #ff9b57;    /* 降级 */
--bad: #ff6b81;         /* 危险 */
--info: #7aa2ff;        /* 信息 */
```

**新增密度五档色阶**（加到 `index.css` 的 `:root`）：

```css
--dens-0: #3a4657;   /* <3   正常 */
--dens-1: #3d6ea8;   /* 3-4  观察 */
--dens-2: #b8832f;   /* 4-5  限流 */
--dens-3: #d96a2c;   /* 5-6  管制 */
--dens-4: #d63a4d;   /* >6   分流 */
```

> 这五档是**深色底上的半透明填充色**，不是纯色块。

---

## 4. 公共组件（新建）

```
frontend/src/components/
├─ TopBar.tsx            顶栏：Logo + 状态灯 + 时段切换器 + 页签 + 注入演示数据
├─ DutyTable.tsx         入口值守与指令表（P2 进场核心）
├─ OccupancyGrid.tsx     分区占用率网格
├─ ThresholdCard.tsx     阈值触发卡（已执行/忽略/上报）
├─ DroneFeed.tsx         无人机回传（四角标注 + 电量）
├─ VerdictCard.tsx       右栏结论卡（大字号）
├─ EvidenceCard.tsx      证据卡（数据快照/无人机帧/人工上报）
└─ TimeSegmentSwitch.tsx 三时段切换（纯手动）
```

**每个组件建 `.tsx` + `.css`，样式命名用组件前缀（`duty-`、`occ-`、`thr-`）。**

---

## 5. P1 预案推演（`/plan`）

### 布局

```
┌─────────────┬──────────────────────┬─────────────┐
│ 左 420px    │ 中 flex              │ 右 400px    │
│ 活动参数     │ 优先级规则表          │ 推演结论     │
│ 情景配置     │ 8 情景结果矩阵        │ 关键发现     │
│ [生成预案]   │                      │ 建议调整     │
└─────────────┴──────────────────────┴─────────────┘
```

### 情景配置（关键交互）

```tsx
// 四类情景，带展开选择
☑ 正常散场
☑ 闸口失效        [已选 N 个]  收起 ▴
   ┌ 按区段快捷选: [北段][中段][南段][两端]
   ┌ 多选网格（2 列 × 6 行）
   │ ☐ G01 江汉门  ●open   ☐ G07 兰陵门 ●open
   │ ☑ G02 华清门  受限     ☐ G08 清江门 ●open
   │ ...
   └ [全选] [清空]
☐ 局部区域封控    [已选 0 个]  展开 ▾
☐ 逆流管制        [已选 0 条]  展开 ▾
```

**每个闸口必须显示当前状态点**（`open` 灰 / `受限` 橙 / `关闭` 红）。

### 数据来源

```
GET  /api/v1/safety/scenario     → regions / corridors / exits / staff
POST /api/v1/safety/plan/recompute → 重新计算
GET  /api/v1/safety/plan         → 当前方案
```

### 需要后端新增（写在这，别自己造字段）

```json
// 场景 JSON 新增
"exit_groups": [
  { "id": "NORTH", "name": "北段", "exits": ["GATE_01_G01","GATE_02_G02","GATE_03_G03"] },
  { "id": "MIDDLE","name": "中段", "exits": ["GATE_04_G04","GATE_05_G05","GATE_06_G06"] },
  { "id": "SOUTH", "name": "南段", "exits": ["GATE_07_G07","GATE_08_G08","GATE_09_G09"] },
  { "id": "ENDS",  "name": "两端", "exits": ["GATE_10_G10","GATE_11_G11"] }
]
```

**如果后端还没加这个字段，前端先用硬编码的分组常量，但要写在 `constants/exitGroups.ts` 里，等后端就绪后切到接口。**

---

## 6. P2 现场总览（`/live`）— 三时段

### 顶栏时段切换器（纯手动，不依赖时间）

```tsx
// TimeSegmentSwitch.tsx
<segmented>
  <button data-active={seg==='entry'}>进场管控 18:30–19:00</button>
  <button data-active={seg==='active'}>活动进行 19:00–21:30</button>
  <button data-active={seg==='exit'}>散场疏散 21:30–22:00</button>
</segmented>

// 默认值按当前时间选，但用户点击后永久生效（存 localStorage）
```

**禁止用定时器自动切换。**

### 6.1 进场模式（`seg='entry'`）

```
┌──────────────┬────────────────────────┬──────────────┐
│ 入口值守与指令 │ 分区占用率              │ 判断依据      │
│ 536px        │ + 无人机回传              │ 440px        │
└──────────────┴────────────────────────┴──────────────┘
```

**左栏 `DutyTable`（核心，必须实现）**

```
表头：入口 | 值守人 | 排队 | 系统建议 | 当前指令
─────────────────────────────────────────────
G01 江汉门  王·S-0121  120   放行       (放行)
● 在岗
G02 华清门  李·S-0236  186   暂停放行   (限制入口)  ← 橙色高亮整行
● 在岗
G05 龟山门  刘·S-0518   —    数据过期   (放行)
● 在岗·数据旧
```

**数据来源**：
```
GET /api/v1/mvp/staff     → staff[].name, role, region_id, status
GET /api/v1/mvp/dashboard → 各区人数/密度
```

**需要后端新增**（前端先用 mock，标注 `// TODO: 等后端 staff.duty 字段`）：
```json
"staff": [
  { "id": "STAFF_GATE_01", "name": "江汉门巡检员",
    "duty": "on_duty",              // on_duty | off_duty
    "instruction": "allow",         // allow | restrict | close | divert
    "assigned_exit": "GATE_01_G01",
    "last_report_at": "2026-11-20T18:54:00Z" }
]
```

**中栏 `OccupancyGrid`**：11 列 × 3 行（闸口层/堤顶/堤下），每格显示 `已进/容量` 百分比 + 进度条。>75% 标红。

**中栏下 `DroneFeed`**：单台无人机主画面 + 四角标注（REC/编号、飞行状态、位置高度、采样结果）+ 右侧电量/续航/下一站。

**右栏 `VerdictCard`**：大字号结论 + 依据 + 建议动作 + 数据新鲜度警示。

### 6.2 活动进行模式（`seg='active'`）

```
┌──────────────┬────────────────────────┬──────────────┐
│ 各区域密度    │ 现场监控（主+缩略图）   │ 判断依据      │
│ 400px        │ + 无人机回传            │ 440px        │
└──────────────┴────────────────────────┴──────────────┘
```

**左栏密度列表**：
- 五档色阶色条（`--dens-0` ~ `--dens-4`）
- **已触发区域置顶**（不参与排序）
- 其余按密度降序
- 超阈值行加高，多一行提示

**中栏监控**：
- 主画面 1 路（16:9）
- 缩略图条 N 路，带密度角标
- 超阈值缩略图红色描边
- **如果没有视频源，显示 `SIGNAL OFFLINE` 占位，不要留空**

**阈值触发卡**：显示超阈值区域 + 三个按钮（已执行/忽略/上报）。

### 6.3 散场模式（`seg='exit'`）

```
┌──────────────┬────────────────────────┬──────────────┐
│ 各区域密度    │ NetworkMap（疏散路线）  │ 判断依据      │
│ 400px        │                        │ 440px        │
└──────────────┴────────────────────────┴──────────────┘
```

**中栏直接复用 `NetworkMap.tsx`**，数据传 `plan`：

```tsx
<NetworkMap
  regions={scenario.regions}
  exits={status.exits}
  plan={plan}              // EvacuationPlan
  observations={observations}
  onSelectRegion={setSelected}
/>
```

**只改一处**：给 `.map-region` 加 `data-density-level="0|1|2|3|4"` 属性，CSS 按档位填色。

```css
/* 追加到 NetworkMap 的 CSS */
.map-region[data-density-level="0"] { fill: color-mix(in srgb, var(--dens-0) 35%, transparent); }
.map-region[data-density-level="1"] { fill: color-mix(in srgb, var(--dens-1) 45%, transparent); }
.map-region[data-density-level="2"] { fill: color-mix(in srgb, var(--dens-2) 55%, transparent); }
.map-region[data-density-level="3"] { fill: color-mix(in srgb, var(--dens-3) 62%, transparent); }
.map-region[data-density-level="4"] { fill: color-mix(in srgb, var(--dens-4) 72%, transparent); }
```

**不要改 JSX 结构、不要改缩放/点击逻辑、不要重写路线渲染。**

---

## 7. P3 决策回放（`/replay`）

### 布局

```
┌─────────────────────────────────────────────────┐
│ 时间轴（8 个事件点 + 可拖动播放头）                │
├────────────────────────┬────────────────────────┤
│ 态势快照（左 900px）    │ 当时决策依据（右 960px）│
│ ├ 该时刻密度还原        │ ├ 结论卡                │
│ └ 证据四卡              │ ├ 推理链（逐秒）        │
│                        │ └ 命中规则              │
├────────────────────────┴────────────────────────┤
│ 底部统计条（6 项）                                │
└─────────────────────────────────────────────────┘
```

### 数据来源

```
GET /api/v1/safety/audit      → 审计记录列表
GET /api/v1/safety/traces     → Trace 列表
GET /api/v1/safety/trace/:id  → 单条 Trace 详情
```

### 证据四卡（**不含固定摄像头**）

| 卡 | 内容 | 数据来源 |
|---|---|---|
| 数据快照 ① | 区域名 + 密度 + 采样时刻 + 来源 + 置信度 | `observations` |
| 数据快照 ② | 同上（另一个区域） | `observations` |
| 无人机帧 | UAV 编号 + 位置 + 时刻 + 采样结果 | `perception` |
| 人工上报 | 上报人 + 内容 + 持续时长 + 生效时刻 | `incidents` |

> 如果某个时刻无人机没有飞行，显示灰色占位 + “该时刻未拍摄”。

### 复用 PerceptionReplayPanel

`PerceptionReplayPanel.tsx` 已经有 C3 热力回放的完整实现，**直接挂到 P3 左栏下方作为“感知帧”tab**。

---

## 8. P4 审计记录（`/audit`）

### 布局

```
┌─────────────────────────────────────────────────┐
│ 筛选条（时间 / 类型 / 操作人 / 结果 / 导出 CSV）  │
├─────────────────────────────────────────────────┤
│ 六项统计卡                                        │
├──────────────────────────────┬──────────────────┤
│ 主表（时间/类型/内容/操作人/  │ 详情抽屉          │
│      结果/留痕ID）            │ ├ 上报内容        │
│                              │ ├ 系统响应        │
│                              │ ├ 命中规则        │
│                              │ └ 标记复核        │
└──────────────────────────────┴──────────────────┘
```

### 数据来源

```
GET /api/v1/safety/audit   → 直接渲染
```

**这条路由已存在，返回的数据结构不用改。**

---

## 9. 顶栏「注入演示数据」

**不要单独做按钮，做成顶栏右侧一个主按钮 + 下拉：**

```tsx
<button className="topbar-demo">
  注入演示数据 ▾
</button>
// 展开：
// ├ 推演 A：正常散场
// ├ 推演 B：局部聚集 + 信息缺口
// ├ 推演 C：不可信 + 容量不足
// └ 重置
```

**底层调用现有 `SimulationPanel` 的逻辑**，不要重写。

```
POST /api/v1/mvp/simulation/start
POST /api/v1/mvp/simulation/step
POST /api/v1/mvp/demo/run
```

**`SimulationPanel.tsx` 保留文件，不删；只是把触发入口挪到顶栏。**

---

## 10. 内容迁移对照（不能丢）

改造后必须能在新页面找到以下 12 块内容：

| 旧区块 | 新位置 | 验收 |
|---|---|---|
| 各区域观测 | P2 左栏密度列表 | ☐ |
| 安全决策引擎 | P2 中栏五段进度 | ☐ |
| 疏散任务状态 | P2 散场右栏 | ☐ |
| 独立校验结果 | P3 推理链 | ☐ |
| 风险告警 | P2 阈值触发卡 | ☐ |
| 出口分配 | P2 散场右栏 | ☐ |
| 事件时间线 | P4 审计主表 | ☐ |
| 竞赛基准结果 | P1 底部 或 P3 底部 | ☐ |
| 多区域协同调查 | P1 底部 | ☐ |
| 摄像头状态 | P2 进场无人机区 | ☐ |
| 工作人员 | P2 值守表 | ☐ |
| 审批中心与工单 | P4 | ☐ |

---

## 11. 验收命令

```bash
cd frontend

# 1. 类型检查 + 构建（必须通过）
npm run build

# 2. 老测试必须全绿（4 个文件）
npm test

# 3. e2e smoke
npm run test:e2e
```

**三条全过，才算完成。**

---

## 12. 分批交付建议

| 批次 | 内容 | 预计 |
|---|---|---|
| **第 1 批** | 路由壳 + TopBar + TimeSegmentSwitch + `/legacy` 挂载 | 1 天 |
| **第 2 批** | P2 进场模式（DutyTable + OccupancyGrid + DroneFeed） | 3 天 |
| **第 3 批** | P2 活动 + 散场模式 | 3 天 |
| **第 4 批** | P4 审计（最容易，复用现有数据） | 1 天 |
| **第 5 批** | P3 回放（复用 PerceptionReplayPanel） | 2 天 |
| **第 6 批** | P1 预案推演（最复杂，需要后端字段） | 4 天 |

**每批完成后立刻跑一次 `npm run build` + `npm test`，不要攒到最后。**

---

## 13. 常见坑（提前避开）

| 坑 | 避法 |
|---|---|
| 改了 `services/` 导致类型全崩 | 只读不写，需要新字段就 `// TODO` 标注 |
| `NetworkMap` 缩放失灵 | 只加 `data-*` 属性，不动 `useRef` / `viewRef` |
| 深色主题被改成浅色 | 只用 `:root` 里的变量，不硬编码颜色 |
| 密度色阶在深底上看不清 | 用 `color-mix(..., transparent)` 叠半透明 |
| 时段自动切换打乱演示 | 纯手动，`localStorage` 记住选择 |
| 新页面没有数据时白屏 | 每个区块都要有空态（`暂无数据` / `SIGNAL OFFLINE`） |

---

## 14. 设计参考图位置

```
SkyGuard/assets/wire/
├─ P1_预案推演.png
├─ P2_现场总览_入场模式.png
├─ P2_现场总览_活动进行.png
├─ P2_现场总览_散场模式.png
├─ P2_上报闸口抽屉.png
├─ P3_态势回放.png
└─ P4_审计记录.png
```

**注意**：线框是**浅色**，实际实现要用**深色令牌**。布局照抄，配色按第 3 节。

---

## 15. 一句话总结

> **布局照线框，配色用现有深色令牌，数据全部走现有 API，算法一行不改。**
> 做完能跑通 `npm run build` + `npm test` + `npm run test:e2e`，12 项内容全部找到，就算完成。
