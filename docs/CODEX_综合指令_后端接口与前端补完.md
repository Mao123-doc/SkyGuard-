# Codex 综合指令 · 补齐 P1 情景推演后端接口 + 完成前端剩余页面

> 前提：第 1–5 批已提交；第 6 批 P1 界面进行中。
> 本指令**同时**解决两件事：① 加后端接口让 P1 真正能算；② 补完 Live/Replay/Audit 三页。
> **执行顺序：先做第 1 部分（后端接口），再做第 2 部分（前端接线），最后统一验收。**

---

## 背景：你发现的问题是真实的

你确认了：
- `POST /plan/recompute` 无参数，不接受活动参数或情景勾选
- `traces` 没有前端 service 方法
- `staff` 缺 `duty` / `instruction` / 排队字段

**这三条都对。第一、二条本次解决，第三条保持"未知"标注。**

---

# 第一部分：新增后端接口 `POST /plan/simulate`

## 1.1 目标

让前端能把"哪些闸口失效、哪些区域封控"传给后端，复用现有规划器与校验器算出结果。

## 1.2 接口契约

```
POST /api/v1/safety/plan/simulate

Request body:
{
  "disabled_exits": ["GATE_02_G02", "GATE_09_G09"],   // 可选，默认 []
  "closed_regions": [],                               // 可选，默认 []
  "horizon_minutes": 30,                              // 可选，默认取 scenario.config.horizon_minutes
  "scenario_name": "G02+G09 同时失效"                  // 可选，仅用于回显
}

Response 200:
{
  "simulation_id": "sim-20261120T213300-8f3a",
  "scenario_name": "G02+G09 同时失效",
  "applied": {
    "disabled_exits": ["GATE_02_G02", "GATE_09_G09"],
    "closed_regions": []
  },
  "state": {
    "state": "REJECT" | "REROUTE" | "NORMAL" | "DEGRADED",
    "publishable": false,
    "headline": "……",
    "reasons": [{ "code": "C2_EXIT_UNAVAILABLE", "message": "……", "severity": "hard" }]
  },
  "plan": { /* EvacuationPlan 原样返回，结构见 safetyApi.ts */ },
  "validation": { /* SafetyValidationResult 原样返回 */ },
  "solve_ms": 12,
  "exclusions": [{ "kind": "exit", "id": "GATE_02_G02", "reason": "disabled_by_simulation" }]
}

Response 400: 请求体不合法（zod 校验失败）
Response 404: 场景不存在
Response 500: 求解失败（附 message）
```

## 1.3 实现要点

**文件**：`backend/src/api/v1/safety.ts`（新增一个路由，不改现有路由）

**核心逻辑（复用现有代码，不要重写算法）**：

```typescript
// 1. 读取当前场景
const scenario = loadScenario();   // 用现有的场景加载函数

// 2. 克隆场景并覆盖失效项（不要改原对象）
const patched = structuredClone(scenario);
for (const exitId of body.disabled_exits ?? []) {
  const exit = patched.exits.find(e => e.id === exitId);
  if (exit) {
    exit.status = 'closed';
    exit.status_source = 'simulation';
    exit.updated_at = new Date().toISOString();
  }
}
for (const regionId of body.closed_regions ?? []) {
  const region = patched.regions.find(r => r.id === regionId);
  if (region) region.enabled = false;
}

// 3. 从最新观测构造需求
const observations = /* 用现有的最新观测读取逻辑 */;
const demandByRegion = new Map(
  observations.map(o => [o.region_id, o.count])
);

// 4. 复用现有规划器
const planOut = planEvacuation({
  scenario: patched,
  network: buildEffectiveNetwork(patched),   // 用现有的网络构建函数
  demandByRegion,
  scenarioVersion: patched.version,
  constraintVersion: currentConstraintVersion(patched),
  observationVersion: currentObservationVersion(),
  horizonMinutes: body.horizon_minutes,
});

// 5. 复用现有校验器
const validation = validateSafetyPlan({
  plan: planOut.plan,
  scenario: patched,
  network: buildEffectiveNetwork(patched),
  config: /* 现有 config */,
});

// 6. 复用现有状态机
const state = evaluateSafetyState({ /* 传入 plan / validation / observations */ });

// 7. 记录审计（可选但建议）
//    用现有的 audit 写入函数，标记 source: 'simulation'
```

**红线**：
```
❌ 不要修改 planEvacuation / validateSafetyPlan / evaluateSafetyState
❌ 不要修改 scenario.ts 的加载逻辑
✅ 只新增一个路由 + 一个请求 schema
```

## 1.4 需要确认的现有函数名

实现前先 grep 确认这些函数的真实名称与导出位置：

```bash
# 找场景加载
rg "loadScenario|readScenarioJson|scenarioCache" backend/src --type ts -l

# 找网络构建
rg "buildEffectiveNetwork|effectiveNetwork|EffectiveNetwork" backend/src --type ts -l

# 找版本号工具
rg "constraintVersion|observationVersion" backend/src --type ts -l

# 找状态机入口
rg "evaluateSafetyState|resolveSafetyState" backend/src --type ts -l

# 找审计写入
rg "appendAudit|writeAudit|auditStore" backend/src --type ts -l
```

**如果某个函数不存在，用现有的等价实现，不要自己造。**

## 1.5 测试要求

新增一个后端测试文件：

```
backend/src/api/v1/__tests__/plan-simulate.test.ts
```

至少测 4 个用例：

| 用例 | 输入 | 期望 |
|---|---|---|
| 正常场景 | `disabled_exits: []` | `state.state === 'NORMAL'` 或 `'REROUTE'`，`publishable` 视校验结果 |
| 单闸口失效 | `disabled_exits: ['GATE_02_G02']` | 计划里不再出现该闸口的分配 |
| 多闸口失效 | `disabled_exits: ['GATE_02_G02','GATE_09_G09']` | 若容量不足则 `state === 'REJECT'` |
| 非法闸口 ID | `disabled_exits: ['NOT_EXIST']` | 200，但 `exclusions` 里标注未找到，或 400（二选一，需在文档写明） |

---

# 第二部分：前端接线与补完

## 2.1 P1 预案推演（`/plan`）

### 现有缺口的处理

你之前标注的"本地预案输入，尚未由后端执行"**现在可以改成真实调用**。

### 情景勾选 → 调接口

```typescript
// 用户勾选闸口/区域后，点击「生成预案」
const res = await fetch('/api/v1/safety/plan/simulate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    disabled_exits: selectedExits,
    closed_regions: selectedRegions,
    scenario_name: buildScenarioName(selectedExits, selectedRegions),
  }),
});

// 返回结果直接渲染
// res.state     → 右栏结论卡（大字号 + 颜色）
// res.validation.violations → 命中规则列表
// res.plan      → 中栏疏散路线（复用 NetworkMap）
```

### 8 情景矩阵

**逐项调用接口，串行或并发（≤3 并发）：**

```typescript
const SCENARIOS = [
  { name: '① 全部正常',        disabled_exits: [], closed_regions: [] },
  { name: '② G02 失效',        disabled_exits: ['GATE_02_G02'], closed_regions: [] },
  { name: '③ G09 失效',        disabled_exits: ['GATE_09_G09'], closed_regions: [] },
  { name: '④ G02+G09 同时失效', disabled_exits: ['GATE_02_G02','GATE_09_G09'], closed_regions: [] },
  { name: '⑤ 北段全失效',      disabled_exits: ['GATE_01_G01','GATE_02_G02','GATE_03_G03'], closed_regions: [] },
  { name: '⑥ 中段全失效',      disabled_exits: ['GATE_04_G04','GATE_05_G05','GATE_06_G06'], closed_regions: [] },
  { name: '⑦ G02 失效+封控',   disabled_exits: ['GATE_02_G02'], closed_regions: ['R_GATE_01_PLAZA'] },
  { name: '⑧ 逆流管制启动',    disabled_exits: [], closed_regions: [] },
];

// 逐项调接口，填表：
// 情景名 | 完成时间(从 plan.evacuated_persons/unresolved_persons 推算 或 solve_ms) | 状态 | 关键约束
```

**注意**：
- 每格结果必须来自接口返回，**不要伪造**
- 若某情景接口报错，该格显示 `—` 并标注失败原因
- 全部完成后显示耗时总和

### 界面文案

```
标题旁：`后端实时推演 · 点击生成后调用 /plan/simulate`
矩阵标题：`8 个情景推演结果`
若某项失败：`⚠ 该情景求解失败：<原因>`
```

## 2.2 LivePage 补完（目标 ≥ 200 行）

```
左栏 DutyTable：
- 数据：GET /api/v1/mvp/staff  → 11 条
- 列：入口 | 值守人 | 排队 | 系统建议 | 当前指令
- 入口：从 staff[].region_id 映射到场景区域名
- 值守人：staff[].name（真实）
- 排队 / 系统建议：从 GET /api/v1/mvp/dashboard 里取该区域人数，
  超阈值给建议；无数据显示 `—`
- 当前指令：无字段 → 显示「未知」并加 title="后端未提供 instruction 字段"

中栏 OccupancyGrid：
- 数据：GET /api/v1/safety/scenario（regions 的 holding_capacity_persons）
       + GET /api/v1/mvp/dashboard（各区域当前人数）
- 每格：`已进 / 容量` 百分比 + 进度条
- >75% 标红

右栏 VerdictCard：
- 数据：GET /api/v1/safety/status
- 大字号 state + headline + reasons
```

## 2.3 ReplayPage 补完（目标 ≥ 180 行）

```
时间轴：
- 数据：GET /api/v1/safety/audit
- 按时间排序渲染事件点

态势快照：
- 复用 NetworkMap，传当前时刻的 observations

证据四卡（不含固定摄像头）：
- 数据快照 ×2：从 audit 记录里的 observation 关联信息
- 无人机帧：从 perception 相关记录
- 人工上报：从 GET /api/v1/safety/incidents

推理链：
- 从 audit 记录按时间顺序展示
```

## 2.4 AuditPage 补完（目标 ≥ 200 行）

```
数据：GET /api/v1/safety/audit

筛选条：时间范围 / 类型 / 操作人 / 结果
六项统计：总条数 / 拒绝次数 / 上报次数 / 无人机架次 / 平均响应 / 最长间隔
主表：时间 | 类型 | 内容 | 操作人 | 结果 | 留痕ID
右侧抽屉：点行展开，显示完整 JSON + 关联规则
```

---

# 第三部分：验收

## 3.1 命令

```powershell
# 后端
cd backend
cmd /c "npm test"

# 前端
cd frontend
cmd /c "npm run build"
cmd /c "npm test"
```

**三条全绿才算完成。**

## 3.2 12 项内容迁移对照

每项必须给「文件:行号」，不接受只勾选：

```
| 旧区块 | 新位置 | 文件:行号 | 状态 |
|---|---|---|---|
| 各区域观测 | LivePage 左栏 | LivePage.tsx:NN | ✅ |
| 安全决策引擎 | LivePage 中栏 | … | ✅ |
| 疏散任务状态 | LivePage 右栏 | … | ✅ |
| 独立校验结果 | ReplayPage 推理链 | … | ✅ |
| 风险告警 | LivePage 阈值卡 | … | ✅ |
| 出口分配 | LivePage 右栏 | … | ✅ |
| 事件时间线 | AuditPage 主表 | … | ✅ |
| 竞赛基准结果 | P1 底部 | … | ✅ |
| 多区域协同调查 | P1 底部 | … | ✅ |
| 摄像头状态 | LivePage 无人机区 | … | ✅ |
| 工作人员 | LivePage 值守表 | … | ✅ |
| 审批中心与工单 | AuditPage | … | ✅ |
```

## 3.3 接口文档

在 `docs/API_PLAN_SIMULATE.md` 写一段：

```markdown
## POST /api/v1/safety/plan/simulate

请求 / 响应 / 错误码 / 4 个测试用例结果

已知限制：
- 只接受闸口失效与区域封控两类情景
- 不接受自定义需求人数（使用最新观测）
- 结果为一次性计算，不写入当前运行状态
```

## 3.4 提交

```
feat(backend): 新增 POST /plan/simulate 情景推演接口
feat(frontend): P1 接线后端推演 + 补完 Live/Replay/Audit
```

---

# 执行顺序

```
1. 第一部分：后端接口 + 测试         ← 先做，前端要依赖它
2. 第二部分 2.1：P1 接线
3. 第二部分 2.2–2.4：Live/Replay/Audit 补完
4. 第三部分：验收 + 交付
```

**每完成一个小步就 build 一次，不要攒。**

---

# 红线（重申）

```
❌ 不改 evacuation-planner.ts / validator.ts / state-machine.ts
❌ 不改 frontend/src/services/
❌ 不改 NetworkMap.tsx 的 JSX（只加 data-density-level）
❌ 不伪造数据 —— 缺失字段一律显示「未知」或「—」
❌ 不删现有测试
```

---

# 一句话

> **加一个 80 行的接口让 P1 真能算，然后把它和剩下三页一起补完；数据缺就如实标「未知」，不猜、不编。**
