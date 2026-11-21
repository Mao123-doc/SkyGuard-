# 指令 · 第三轮前端体验修正 · 收尾（仅 3 项）

## 工作目录
`E:\Downloads\skyguard-evacuation-main`

## 当前状态（不要重做已完成的部分）
第三轮 8 条展示层改动已在工作区落地（15 个文件），`npm run build` 通过，前端 `npm test` 4 文件 18 tests 全绿。**这些改动尚未提交。** 本轮只补 3 处缺口，其余一律不动。

## 硬约束（违反即视为失败）
1. **不得修改任何测试文件**：`frontend/src/pages/**/__tests__/*.test.tsx`、`frontend/src/components/__tests__/*.test.tsx`。它们是验收基线，4 文件 18 tests 必须仍然全绿。
2. **禁止用 `sr-only` / `aria-label` / 隐藏 span 把英文塞回 DOM 来迎合测试断言**。上一轮在 `MvpPanels.tsx` 加的 `<span className="cc-sr-only">LOCAL DEMO</span>` 已回退，不得重新引入。
3. 不得修改 `frontend/src/pages/command-center/MvpPanels.tsx`（`LOCAL DEMO` 徽标保持英文，它属于旧版页面，不在本轮范围）。
4. 不动 `backend/`、`frontend/src/services/`、`NetworkMap.tsx`、`data/`。
5. 状态枚举 `NORMAL` / `DEGRADED` / `REROUTE` / `REJECT`、API 路径、Trace ID、区域与闸口 ID 保持原样，不翻译。
6. 不虚构数据：缺字段只能写「—」「未提供」「未接入」，不得编造运行策略、人数或时间。

## 改动 1：补全 7 处可见英文小标题（纯文案替换，类名与结构不变）
| 文件:行 | 现状 | 改为 |
| --- | --- | --- |
| `frontend/src/pages/plan/PlanPage.tsx:116` | `P1 / PLAN WORKBENCH` | `P1 · 预案工作台` |
| `frontend/src/pages/plan/PlanPage.tsx:123` | `SIMULATED PLAN` | `推演方案` |
| `frontend/src/pages/plan/PlanPage.tsx:126` | `COMPETITION BASELINE` | `竞赛基准` |
| `frontend/src/pages/plan/PlanPage.tsx:126` | `MULTI-REGION VOI` | `多区域调查` |
| `frontend/src/pages/plan/PlanPage.tsx:126` | `LIMITATIONS` | `边界说明` |
| `frontend/src/pages/audit/AuditPage.tsx:95` | `AUDIT TRAIL · P4` | `P4 · 审计轨迹` |
| `frontend/src/pages/LoginPage.tsx:53` | `SKYGUARD · TRUSTED EVACUATION INTELLIGENCE` | `SKYGUARD · 可信疏散决策` |

`SKYGUARD` 品牌名与 `P1`/`P4` 页码保留。

## 改动 2：无人机轮巡文案改为口径说明（不得再写成已实现的策略）
`frontend/src/components/DroneFeed.tsx:10` 现状：

```jsx
<div className="drone-patrol"><strong>无人机轮巡 · 每 3 分钟切换一个区域 · 优先密度最高</strong><span>当前目标：后端未提供轮巡目标数据</span></div>
```

改为：

```jsx
<div className="drone-patrol"><strong>无人机轮巡：未接入调度</strong><span>当前无轮巡目标数据 · 3 分钟轮巡周期为规划口径，非当前实现</span></div>
```

## 改动 3：占用率呼吸动画加无障碍降级
`frontend/src/components/OccupancyGrid.css`，在 `@keyframes occupancy-pulse` 之后追加：

```css
@media (prefers-reduced-motion: reduce) {
  .occ-cell[data-over="true"] { animation: none; }
}
```

## 验收（逐条执行，附预期输出）
1. `npm run build` → 期望出现 `built in`，无 TS 报错。
2. `npm test --prefix frontend` → 期望 `Test Files 4 passed (4)`、`Tests 18 passed (18)`。若失败，说明改到了不该改的文件。
3. 残留英文扫描（期望**无任何输出**）：
   ```powershell
   Select-String -Path frontend/src/pages/plan/PlanPage.tsx,frontend/src/pages/audit/AuditPage.tsx,frontend/src/pages/LoginPage.tsx,frontend/src/components/DroneFeed.tsx -Pattern 'PLAN WORKBENCH|SIMULATED PLAN|COMPETITION BASELINE|MULTI-REGION|LIMITATIONS|AUDIT TRAIL|TRUSTED EVACUATION|每 3 分钟'
   ```
4. 红线核验（期望**无任何输出**）：
   ```powershell
   git diff --name-only -- frontend/src/pages/command-center/MvpPanels.tsx "frontend/src/pages/**/__tests__"
   ```
5. 服务探活（必须用 curl，本机 `Invoke-WebRequest` 走系统代理会对 localhost 返回假 404）：
   ```powershell
   foreach ($p in 8010,5173) { curl.exe -s -o nul -w "$p -> %{http_code}`n" --noproxy '*' "http://localhost:$p/" }
   ```
   两个均返回 200 后，浏览器依次打开 `/plan`、`/audit`、`/login`、`/live` 目视确认：无英文小标题、无人机说明为新文案、console 无报错。

## 提交（通过验收后执行，不要 push）
```powershell
git add frontend/src/pages/plan/PlanPage.tsx frontend/src/pages/audit/AuditPage.tsx frontend/src/pages/LoginPage.tsx frontend/src/components/DroneFeed.tsx frontend/src/components/OccupancyGrid.css
git commit -m "feat(体验): 第三轮收尾 · 中文小标题、无人机口径、动画降级"
```

## 汇报格式
最后只需报告 5 行：build 是否通过 / 18 tests 是否通过 / 第 3 条扫描结果 / 第 4 条红线结果 / 提交 hash。

## 禁止事项
- 不得新增「场地面积」「预计人数」等输入字段（后端 `simulatePlan` 不接受自定义人数，加了就是假输入）。
- 不得用行数、`prettier`、格式化统计当作验收指标。
- 不得改测试、改 `MvpPanels`、改后端。
- 不得自行 `git push`。
