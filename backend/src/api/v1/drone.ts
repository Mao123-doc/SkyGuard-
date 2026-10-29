import { Router, Request, Response } from 'express';
import { planRouteRequest } from '../../services/route/route-planning-service';
import { validateRoute, type RoutePlan } from '../../services/route/route-validator';
import { loadRouteGraph } from '../../services/route/route-contract';
import { SceneStateSchema, type SceneState } from '../../services/scene/scene-state';

// 无人机模拟数据上报路由（挂载于 /api，最终路径为 /api/mock-drone）
const droneRouter = Router();

// zone -> 路由图中的点位 ID（用于 currentLocation）
const ZONE_TO_SPOT: Record<string, string> = {
  'A区': 'LS-011', 'A区看台': 'LS-011',
  'B区': 'LS-013', 'B区看台': 'LS-013',
  'C区': 'LS-014', '西侧看台': 'LS-014',
  '中央广场': 'LS-006',
  '高区塔楼': 'LS-015',
  '活动大厅': 'NH-004',
  '商业通道': 'NH-003',
  '东区': 'NH-001', '东区集结点': 'NH-001',
  '室外疏散区': 'NH-002',
  '主入口': 'LS-004',
  '南侧安全出口': 'LS-001',
};

function zoneToSpotId(zone: unknown): string {
  if (typeof zone === 'string' && zone) {
    const direct = ZONE_TO_SPOT[zone];
    if (direct) return direct;
    const fuzzy = Object.entries(ZONE_TO_SPOT).find(([key]) => key.includes(zone) || zone.includes(key));
    if (fuzzy) return fuzzy[1];
  }
  return 'LS-004'; // 默认主入口
}

function buildSceneState(currentLocation: string, remainingMinutes: number): SceneState {
  return SceneStateSchema.parse({
    currentLocation,
    currentTime: '10:00',
    remainingMinutes,
    mobility: 'unknown',
    interests: [],
    mustVisitSpotIds: [],
    preferredPerformanceIds: [],
    visitedSpotIds: [],
    missingCriticalFields: [],
  });
}

droneRouter.post('/mock-drone', async (req: Request, res: Response) => {
  console.log('收到无人机模拟数据:', req.body);

  const body = (req.body ?? {}) as { zone?: unknown; density?: unknown; status?: unknown };
  const { zone, density, status } = body;
  const densityNum = Number(density);
  const isDanger = densityNum > 90 || status === 'danger';

  try {
    const graph = loadRouteGraph();
    const currentLocation = zoneToSpotId(zone);

    if (isDanger) {
      // 硬逻辑：通道超载/危险状态，构造校验失败的输入丢给校验器，强制拒绝
      const scene = buildSceneState(currentLocation, 5); // 极短剩余时间，制造超载
      const failingPlan: RoutePlan = {
        feasible: false,
        startTime: '10:00',
        steps: [
          {
            spotId: currentLocation,
            arrive: '10:00',
            start: '10:00',
            end: '12:00',
            walkMinutes: 0,
            visitMinutes: 120,
            reasonCode: 'normal',
          },
        ],
        totalMinutes: 120,
        walkingMinutes: 0,
        visitingMinutes: 120,
        waitingMinutes: 0,
        satisfiedConstraints: [],
        rejectedRequests: [],
      };
      const validation = validateRoute(failingPlan, scene, graph);
      console.log('[mock-drone] 通道超载，校验失败 violations:', validation.violations.map(v => v.code));
      return res.json({
        status: 'rejected',
        message: '校验失败，当前通道超载，系统拒绝生成危险路线',
      });
    }

    // 正常情况：调用项目原有的路径规划 + 校验逻辑生成路线
    const scene_state = buildSceneState(currentLocation, 120);
    const result = await planRouteRequest({ scene_state });

    if (!result.route.feasible) {
      return res.json({
        status: 'rejected',
        message: '校验失败，当前无法生成可行疏散路线',
      });
    }

    const spotNames = new Map(graph.spots.map(spot => [spot.id, spot.name]));
    const route = result.route.steps.map(step => ({
      spot_id: step.spotId,
      spot_name: spotNames.get(step.spotId) ?? step.spotId,
      arrive: step.arrive,
      start: step.start,
      end: step.end,
      walk_minutes: step.walkMinutes,
      visit_minutes: step.visitMinutes,
    }));

    return res.json({ status: 'success', route });
  } catch (error) {
    console.error('[mock-drone] 处理失败:', error);
    return res.status(500).json({
      status: 'error',
      message: error instanceof Error ? error.message : '无人机数据处理失败',
    });
  }
});

export { droneRouter };

