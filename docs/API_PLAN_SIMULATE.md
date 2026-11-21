# POST /api/v1/safety/plan/simulate

## 用途

只读情景推演接口。调用方可以临时关闭出口或区域，并复用当前进程中的最新观测与事件计算一次疏散方案。

接口使用克隆后的场景和临时 `SafetyDecisionService`，不会修改当前场景、约束版本、观测版本、发布方案或四态决策。它是研究原型的辅助比较接口，不是方案发布或人工审批接口。

## 请求

```http
POST /api/v1/safety/plan/simulate
Content-Type: application/json
```

```json
{
  "disabled_exits": ["GATE_02_G02", "GATE_09_G09"],
  "closed_regions": ["R_GATE_01_PLAZA"],
  "horizon_minutes": 30,
  "scenario_name": "G02+G09 同时失效"
}
```

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `disabled_exits` | `string[]` | 否 | `[]` | 临时关闭的出口 ID |
| `closed_regions` | `string[]` | 否 | `[]` | 临时禁用的区域 ID |
| `horizon_minutes` | 正整数 | 否 | 场景配置值 | 当前版本只校验和接收，不参与求解，见“已知限制” |
| `scenario_name` | 非空字符串，最长 200 字符 | 否 | `未命名情景` | 仅在响应中回显 |

此接口不加写操作鉴权，因为它不写入运行状态。生产环境的读鉴权边界仍应按部署策略配置。

## 成功响应

```json
{
  "simulation_id": "sim-20261121T143000-8f3a",
  "scenario_name": "G02+G09 同时失效",
  "applied": {
    "disabled_exits": ["GATE_02_G02", "GATE_09_G09"],
    "closed_regions": ["R_GATE_01_PLAZA"],
    "horizon_minutes": null
  },
  "state": {
    "state": "NORMAL",
    "headline": "当前观测可信且方案已通过独立校验",
    "reasons": [],
    "publishable": true
  },
  "plan": {},
  "validation": {},
  "exclusions": [
    {
      "kind": "exit",
      "id": "GATE_02_G02",
      "reason": "disabled_by_simulation"
    },
    {
      "kind": "region",
      "id": "R_GATE_01_PLAZA",
      "reason": "closed_by_simulation"
    }
  ],
  "solve_ms": 12
}
```

`state` 是现有四态状态机的完整快照。`plan` 和 `validation` 分别为现有 `EvacuationPlan` 与 `SafetyValidationResult` 契约；数据不可信或无法形成候选方案时可以为 `null`。

`exclusions.reason` 的可能值：

| `kind` | `reason` | 含义 |
| --- | --- | --- |
| `exit` | `disabled_by_simulation` | 出口存在，已在本次克隆场景中关闭 |
| `region` | `closed_by_simulation` | 区域存在，已在本次克隆场景中禁用 |
| `exit` / `region` | `not_found` | ID 不存在，未应用该项 |

未知 ID 不会导致整个请求失败。接口返回 `200`，并把每个未知 ID 记录为 `not_found`，避免静默忽略。

## 错误响应

### 400 INVALID_INPUT

请求体不符合 Zod 契约，例如数组中含空字符串、`horizon_minutes` 不是正整数，或 `scenario_name` 为空。

```json
{
  "error": {
    "code": "INVALID_INPUT",
    "message": "请求体不合法",
    "detail": []
  }
}
```

### 500 SIMULATION_FAILED

临时服务创建或求解抛出异常。

```json
{
  "error": {
    "code": "SIMULATION_FAILED",
    "message": "情景推演失败",
    "detail": "具体错误信息"
  }
}
```

## 契约测试

测试文件：`backend/tests/safety/plan-simulate.test.ts`。

| 用例 | 输入 | 验证结果 |
| --- | --- | --- |
| 基线 | 无关闭项 | 返回 `200`、`NORMAL/REROUTE` 且 `plan` 非空 |
| 单闸口失效 | 关闭 `GATE_02_G02` | 方案不向该出口分配人员，exclusions 记录关闭原因 |
| 双闸口失效 | 关闭 `GATE_02_G02`、`GATE_09_G09` | 当前容量仍充足，返回可用重分配方案，两个出口均为零分配 |
| 容量不足 | 关闭除 `GATE_07_G07` 外的 10 个出口 | 返回 `REJECT` 且不可发布 |
| 非法 ID | 关闭 `NOT_EXIST` | 返回 `200`，exclusions 含 `not_found` |
| 状态隔离 | 关闭出口与区域后再次读取 `/status` | 当前版本和决策指纹保持不变；忽略每次读取都会变化的 `decided_at` |

测试基线会为所有 44 个启用区域准备观测，以验证规划与容量语义。补齐的门区人数仅属于测试夹具，不是场景测量值或运行时默认数据。

## 已知限制

- `horizon_minutes` 仅回显、不参与求解；`applied.horizon_minutes` 恒为 `null`。当前接口继续使用场景自身的规划时域，没有为了展示效果修改规划器或场景默认值。
- `GET /api/v1/safety/scenario` 返回的 `simulation_baseline` 仅覆盖 33/44 个启用区域，缺少 11 个 `R_GATE_*_PLAZA`。只注入该基线会使缺少观测的区域被判为不可信，系统进入 `DEGRADED`，因此不会产生方案。
- 当前只接受“闸口失效”和“区域封控”两类情景，不接受通道方向、容量、人数或概率参数的临时覆盖。
- 需求人数来自当前 `ObservationStore` 的最新观测字段 `estimated_count`，接口不接受自定义需求人数。
- 每次请求只计算一次，不写入当前运行状态，也不会把临时方案发布为当前方案。
