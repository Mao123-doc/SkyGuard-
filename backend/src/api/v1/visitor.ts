import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import {
  queryRAG, streamRAGQuery, getSessionHistory,
  initKnowledgeBase, getKnowledgeStats,
} from '../../services/rag-service';
import type { RAGExperimentConfig } from '../../services/rag-config';
import { textToSpeech } from '../../services/tts-service';
import { isLLMAvailable, getActiveModelName, callLLM, callMultimodalLLM, isMultimodalAvailable } from '../../services/llm-service';
import { analyzeEmotion } from '../../services/emotion-service';
import { broadcastQueryEvent } from '../../services/websocket-service';
import { SceneStateSchema } from '../../services/scene/scene-state';
import type { SceneExtractionResult } from '../../services/scene/scene-extractor';
import {
  planRouteRequest,
  RoutePlanningInputError,
  type RoutePlanningRequest,
} from '../../services/route/route-planning-service';
import { resolveDataPath } from '../../config/paths';
import {
  saveConversation, saveFeedback, getConversationStats,
  getHotQuestions as getDbHotQuestions, classifyQuery,
  updateConversationFeedback,
} from '../../db/store';

const visitorRouter = Router();

// ============ Spot Image Mapping ============

const SPOT_IMAGES: Record<string, string> = {
  'A区看台': 'lingshan_dafo.jpg',
  '中央广场': 'jiulong_guanyu.jpg',
  'B区看台': 'lingshan_fangong.jpg',
  '西侧看台': 'wuyin_tancheng.jpg',
  '北侧通道': 'xiangfu_temple.jpg',
  '东区': 'nianhua_wan.jpg',
  '东侧连廊': 'wuming_bridge.jpg',
  '场馆门楼': 'shengjing_gate.jpg',
  '中央水池': 'xixin_pond.jpg',
  '入口广场': 'fozu_altar.jpg',
  '中轴浮雕墙': 'xiangmo_relief.jpg',
  '中轴立柱': 'ayuwang_pillar.jpg',
  '中央雕塑': 'tianxiadiyizhang.jpg',
  '亲子集结点': 'baiziximile.jpg',
  '北侧广场': 'xingtan_square.jpg',
  '中央楼梯': 'dengyun_road.jpg',
  '南侧安全出口': 'lingshan_zhaobi.jpg',
  'B区展馆': 'zhenbao_hall.jpg',
  '高区塔楼': 'manfeilong_pagoda.jpg',
  '南侧樟树': 'foshou_zhang.jpg',
  '东侧水井': 'liujiao_well.jpg',
  '莲花水池': 'bailian_pond.jpg',
  '主入口': 'wuzhi_gate.jpg',
  '中央步道': 'puti_avenue.jpg',
  '应急物资仓库': 'fojiao_museum.jpg',
  '东区集结点': 'nianhua_square.jpg',
  '室外疏散区': 'fantian_huahai.jpg',
  '商业通道': 'xiangyue_street.jpg',
  '活动大厅': 'nianhua_hall.jpg',
  '中心湖区': 'wuhu_lamp.jpg',
  '山谷通道': 'luming_valley.jpg',
};

type SpotImage = { url: string; name: string };

function matchSpotsInText(text: string): string[] {
  if (!text) return [];
  const results: string[] = [];
  const sortedNames = Object.keys(SPOT_IMAGES).sort((a, b) => b.length - a.length);
  for (const spotName of sortedNames) {
    if (text.includes(spotName)) {
      results.push(spotName);
    }
  }
  return results;
}

function getImageUrls(question: string, answer: string): SpotImage[] {
  // Priority 1: spots mentioned in the user's question
  const questionSpots = matchSpotsInText(question);
  if (questionSpots.length > 0) {
    return questionSpots.map(name => ({ url: `/${SPOT_IMAGES[name]}`, name }));
  }
  // Priority 2: spots mentioned in the AI's answer
  const answerSpots = matchSpotsInText(answer);
  return answerSpots.map(name => ({ url: `/${SPOT_IMAGES[name]}`, name }));
}

// ============ Scenic Spots ============

const ALL_SPOTS = [
  { id: 'LS-011', name: 'A区看台', area: '主馆', category: '看台区', summary: 'A区主看台，可容纳约5000人', highlight: '应急广播覆盖，设两条疏散楼梯', lat: 31.43205, lng: 120.09151 },
  { id: 'LS-006', name: '中央广场', area: '主馆', category: '集散区', summary: '场馆中央集散广场', highlight: '紧急时可作临时集结点，设应急照明与扩音系统', lat: 31.42662, lng: 120.09523 },
  { id: 'LS-013', name: 'B区看台', area: '主馆', category: '看台区', summary: 'B区看台，邻近南侧安全出口', highlight: '疏散距离短，直通南侧安全出口', lat: 31.43065, lng: 120.09756 },
  { id: 'LS-014', name: '西侧看台', area: '主馆', category: '看台区', summary: '西区看台', highlight: '邻近西侧安全出口与东侧疏散通道', lat: 31.42664, lng: 120.09813 },
  { id: 'LS-010', name: '北侧通道', area: '主馆', category: '疏散通道', summary: '连接南北区的主要疏散通道', highlight: '地面设绿色疏散指示灯，宽约8米', lat: 31.42986, lng: 120.09309 },
  { id: 'LS-001', name: '南侧安全出口', area: '主馆', category: '安全出口', summary: '场馆主要安全出口，直通室外', highlight: '双开门设计，设应急照明与引导标识', lat: 31.42250, lng: 120.09740 },
  { id: 'LS-005', name: '中央步道', area: '主馆', category: '疏散通道', summary: '中央主步道，贯穿核心区域', highlight: '地面防滑，设应急照明，直通中央广场', lat: 31.42400, lng: 120.09670 },
  { id: 'LS-009', name: '亲子集结点', area: '主馆', category: '集结点', summary: '家庭应急集结点', highlight: '设有醒目标识与应急物资', lat: 31.42540, lng: 120.09760 },
  { id: 'LS-015', name: '高区塔楼', area: '主馆', category: '高层区域', summary: '高层观演区', highlight: '设有高层疏散楼梯，禁止乘坐电梯', lat: 31.42800, lng: 120.09900 },
  { id: 'LS-016', name: '东侧休息区', area: '主馆', category: '休息区', summary: '东侧休息与候场区', highlight: '设有应急饮用水与急救点', lat: 31.43050, lng: 120.09180 },
  { id: 'LS-002', name: '东侧连廊', area: '主馆', category: '连廊', summary: '连接东区与主馆的连廊', highlight: '设应急照明与防滑地面', lat: 31.42240, lng: 120.09740 },
  { id: 'LS-003', name: '入口广场', area: '主馆', category: '入口', summary: '主入口广场', highlight: '设安检与客流引导，紧急时作缓冲集散区', lat: 31.42330, lng: 120.09700 },
  { id: 'LS-004', name: '主入口', area: '主馆', category: '入口', summary: '场馆主入口', highlight: '设客流监测与应急广播', lat: 31.42460, lng: 120.09630 },
  { id: 'LS-007', name: '中轴浮雕墙', area: '主馆', category: '标志物', summary: '中轴线上标志性墙面', highlight: '可作为方位参照物', lat: 31.42500, lng: 120.09610 },
  { id: 'LS-008', name: '中轴立柱', area: '主馆', category: '标志物', summary: '中轴线上标志性立柱', highlight: '设应急照明，可作集结点参照', lat: 31.42530, lng: 120.09590 },
  { id: 'LS-012', name: '应急物资仓库', area: '主馆', category: '物资点', summary: '应急物资储备点', highlight: '储备应急照明、扩音器、急救包等', lat: 31.43205, lng: 120.09151 },
  { id: 'NH-001', name: '东区集结点', area: '东区', category: '集结点', summary: '东区室外集结点', highlight: '设醒目标识，可容纳数千人', lat: 31.41780, lng: 120.06950 },
  { id: 'NH-002', name: '室外疏散区', area: '东区', category: '疏散区', summary: '室外开阔疏散区', highlight: '紧急时作为大规模疏散缓冲地', lat: 31.41960, lng: 120.07620 },
  { id: 'NH-003', name: '商业通道', area: '东区', category: '通道', summary: '东区商业通道', highlight: '设应急照明与疏散标识', lat: 31.41950, lng: 120.07080 },
  { id: 'NH-005', name: '中心湖区', area: '东区', category: '水域', summary: '东区中心湖区', highlight: '设围栏与防溺水警示，紧急时远离水域', lat: 31.42000, lng: 120.07280 },
  { id: 'NH-004', name: '活动大厅', area: '东区', category: '大厅', summary: '东区活动大厅', highlight: '设多条疏散通道与应急广播', lat: 31.42120, lng: 120.07220 },
  { id: 'NH-006', name: '山谷通道', area: '东区', category: '通道', summary: '东区山谷步道', highlight: '注意地面湿滑，沿标识疏散', lat: 31.42430, lng: 120.07630 },
];

visitorRouter.get('/spots', (_req: Request, res: Response) => {
  res.json(ALL_SPOTS);
});

visitorRouter.get('/spots/:spotId', (req: Request, res: Response) => {
  const spot = ALL_SPOTS.find(s => s.id === req.params.spotId);
  if (!spot) return res.status(404).json({ error: '安全出口不存在' });
  res.json(spot);
});

// ============ Q&A (with SSE streaming) ============

visitorRouter.post('/qa', async (req: Request, res: Response) => {
  try {
    const { query, session_id, evaluation_config } = req.body;
    if (!query) {
      return res.status(400).json({ error: '请输入问题' });
    }

    const sessionId = session_id || uuidv4();
    const startTime = Date.now();

    // Check if client wants streaming
    const acceptSSE = req.headers.accept?.includes('text/event-stream');

    if (acceptSSE) {
      // SSE Streaming response
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');

      res.write(`data: ${JSON.stringify({ type: 'session', session_id: sessionId })}\n\n`);

      let fullAnswer = '';
      try {
        for await (const chunk of streamRAGQuery(query, sessionId, evaluation_config as Partial<RAGExperimentConfig> | undefined)) {
          fullAnswer += chunk;
          res.write(`data: ${JSON.stringify({ type: 'chunk', content: chunk })}\n\n`);
        }
      } catch (streamErr) {
        console.error('Stream error:', streamErr);
      }

      // Save conversation
      const elapsed = Date.now() - startTime;
      const emotion = await detectEmotion(query, fullAnswer);
      saveConversation({
        id: uuidv4(),
        session_id: sessionId,
        timestamp: new Date().toISOString(),
        query,
        answer: fullAnswer,
        emotion,
        used_llm: isLLMAvailable(),
        response_time_ms: elapsed,
      });

      // Broadcast to admin WebSocket subscribers
      broadcastQueryEvent({
        query_short: query.slice(0, 40),
        emotion,
        response_time_ms: elapsed,
        used_llm: isLLMAvailable(),
      });

      const spots = extractSpots(fullAnswer);
      res.write(`data: ${JSON.stringify({
        type: 'done',
        session_id: sessionId,
        emotion,
        related_spots: spots,
        image_urls: getImageUrls(query, fullAnswer),
        used_llm: isLLMAvailable(),
        model: getActiveModelName(),
      })}\n\n`);
      res.end();
    } else {
      // Non-streaming response
      const result = await queryRAG(query, sessionId, evaluation_config as Partial<RAGExperimentConfig> | undefined);

      // Save conversation
      const elapsed = Date.now() - startTime;
      saveConversation({
        id: uuidv4(),
        session_id: sessionId,
        timestamp: new Date().toISOString(),
        query,
        answer: result.answer,
        emotion: result.emotion,
        used_llm: result.usedLLM,
        response_time_ms: elapsed,
      });

      // Broadcast to admin WebSocket subscribers
      broadcastQueryEvent({
        query_short: query.slice(0, 40),
        emotion: result.emotion,
        response_time_ms: elapsed,
        used_llm: result.usedLLM,
      });

      res.json({
        answer: result.answer,
        session_id: sessionId,
        emotion: result.emotion,
        related_spots: result.relatedSpots,
        image_urls: getImageUrls(query, result.answer),
        used_llm: result.usedLLM,
         model: getActiveModelName(),
         retrieved_chunks: result.retrievedChunks,
         response_time_ms: elapsed,
         evaluation_trace: result.trace,
       });
    }
  } catch (error: any) {
    console.error('QA error:', error);
    res.status(500).json({ error: '问答处理失败' });
  }
});

// ============ TTS ============

visitorRouter.post('/tts', async (req: Request, res: Response) => {
  try {
    const { text, voice: reqVoice, rate, pitch } = req.body;
    if (!text) {
      return res.status(400).json({ error: '请输入文本' });
    }
    const result = await textToSpeech(text, {
      voice: reqVoice || 'zh-CN-XiaoxiaoNeural',
      rate: rate || '+0%',
      pitch: pitch || '+0Hz',
    });

    if (result) {
      res.json({
        audio_base64: result.audioBase64,
        duration: result.duration,
        visemes: result.visemes,
        voice: result.voice,
        format: 'mp3',
      });
    } else {
      res.json({ audio_base64: null, message: 'TTS不可用，请使用文本模式' });
    }
  } catch (error: any) {
    console.error('❌ TTS合成失败:', error);
    res.json({ audio_base64: null, error: 'TTS生成失败' });
  }
});

// ============ Session ============

visitorRouter.post('/session/init', (_req: Request, res: Response) => {
  const sessionId = uuidv4();
  res.json({
    session_id: sessionId,
    welcome_message: '您好！我是SkyGuard公共安全应急疏散决策系统的应急指挥专家🚨\n\n我可以为您提供逃生通道指引、安全出口查询、应急疏散建议。\n请问有什么可以帮您的？',
    llm_available: isLLMAvailable(),
    model: getActiveModelName(),
  });
});

// ============ Unified route planning ============

const SAFE_SCENE_EXTRACTION_FIELDS = new Set([
  ...Object.keys(SceneStateSchema.shape),
  'mustVisitSpotNames',
  'preferredPerformanceNames',
  'visitedSpotNames',
]);
const SAFE_SCENE_EXTRACTION_REASONS = new Set([
  'llm_unavailable',
  'llm_call_failed',
  'empty_response',
  'invalid_json',
  'forbidden_route_field',
  'schema_error',
  'low_critical_field_confidence',
  'invalid_scene_state',
]);
const SAFE_SCENE_EXTRACTION_SOURCES = new Set(['explicit', 'llm', 'rules', 'fallback', 'merged']);
const SAFE_SCENE_EXTRACTION_STATUSES = new Set(['success', 'fallback', 'failed', 'skipped']);

function sanitizeSceneExtraction(extraction: SceneExtractionResult) {
  const confidence = Object.fromEntries(
    Object.entries(extraction.confidence).filter(([field, value]) =>
      SAFE_SCENE_EXTRACTION_FIELDS.has(field)
      && Number.isFinite(value)
      && value >= 0
      && value <= 1,
    ),
  );
  const safeFields = (fields: string[]) => fields.filter(field => SAFE_SCENE_EXTRACTION_FIELDS.has(field));
  const trace = {
    configured: extraction.trace.configured === true,
    executed: extraction.trace.executed === true,
    status: SAFE_SCENE_EXTRACTION_STATUSES.has(extraction.trace.status)
      ? extraction.trace.status
      : 'failed',
    ...(typeof extraction.trace.model === 'string'
      && extraction.trace.model.length <= 100
      && /^[a-zA-Z0-9._:/-]+$/.test(extraction.trace.model)
      ? { model: extraction.trace.model }
      : {}),
    ...(typeof extraction.trace.latencyMs === 'number'
      && Number.isFinite(extraction.trace.latencyMs)
      && extraction.trace.latencyMs >= 0
      ? { latencyMs: extraction.trace.latencyMs }
      : {}),
    fallbackUsed: extraction.trace.fallbackUsed === true,
    ...(typeof extraction.trace.reason === 'string'
      && SAFE_SCENE_EXTRACTION_REASONS.has(extraction.trace.reason)
      ? { reason: extraction.trace.reason }
      : {}),
  };

  return {
    source: SAFE_SCENE_EXTRACTION_SOURCES.has(extraction.source) ? extraction.source : 'fallback',
    confidence,
    missingFields: safeFields(extraction.missingFields),
    conflicts: safeFields(extraction.conflicts),
    trace,
  };
}

async function handleRoutePlan(request: RoutePlanningRequest, res: Response): Promise<void> {
  try {
    const result = await planRouteRequest(request);
    res.json({
      ...result,
      scene_extraction: result.scene_extraction,
    });
  } catch (error: unknown) {
    if (error instanceof RoutePlanningInputError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    console.error('Route planning error:', error);
    res.status(400).json({ error: '逃生通道需求无法解析', detail: 'invalid_request' });
  }
}

visitorRouter.post('/route/plan', async (req: Request, res: Response) => {
  await handleRoutePlan(req.body || {}, res);
});

visitorRouter.post('/recommend', async (req: Request, res: Response) => {
  res.setHeader('Deprecation', 'true');
  const body = req.body || {};
  const interests = Array.isArray(body.interests) && body.interests.length > 0 ? body.interests : ['文化'];
  const duration = typeof body.duration === 'number' ? body.duration : undefined;
  const sceneState = {
    ...(typeof body.currentLocation === 'string' ? { currentLocation: body.currentLocation } : {}),
    ...(typeof body.currentTime === 'string' ? { currentTime: body.currentTime } : {}),
    ...(duration !== undefined ? { remainingMinutes: Math.round(duration * 60) } : {}),
    ...(body.mobility !== undefined ? { mobility: body.mobility } : {}),
    ...(body.pace !== undefined ? { pace: body.pace } : {}),
    ...(body.travelType !== undefined ? { partyType: body.travelType } : {}),
    interests,
    mustVisitSpotIds: Array.isArray(body.mustVisitSpotIds) ? body.mustVisitSpotIds : [],
    preferredPerformanceIds: Array.isArray(body.preferredPerformanceIds) ? body.preferredPerformanceIds : [],
    visitedSpotIds: Array.isArray(body.visitedSpotIds) ? body.visitedSpotIds : [],
    missingCriticalFields: [],
  };
  await handleRoutePlan({
    scene_state: sceneState as RoutePlanningRequest['scene_state'],
    advisory_profile: {
      ...(body.ageGroup ? { ageGroup: body.ageGroup } : {}),
      ...(body.budget ? { budget: body.budget } : {}),
    },
  }, res);
});

// ============ Feedback ============

visitorRouter.post('/feedback', (req: Request, res: Response) => {
  const { session_id, rating, comment } = req.body;
  saveFeedback({
    id: uuidv4(),
    session_id: session_id || 'anon',
    timestamp: new Date().toISOString(),
    rating: rating || 5,
    comment: comment || '',
  });
  res.json({ status: 'ok', message: '感谢您的反馈！' });
});

// ============ Conversation Feedback (public, no auth required) ============

visitorRouter.post('/conversation-feedback', (req: Request, res: Response) => {
  const { session_id, feedback } = req.body;
  console.log(`[visitor-feedback] session_id=${session_id}, feedback=${feedback}`);
  if (!session_id || !feedback) {
    return res.status(400).json({ error: '缺少参数' });
  }
  updateConversationFeedback(session_id, feedback as 'helpful' | 'unhelpful');
  res.json({ status: 'ok' });
});

// ============ Hot Questions ============

visitorRouter.get('/hot-questions', (_req: Request, res: Response) => {
  const dbHot = getDbHotQuestions(7);
  if (dbHot.length >= 5) {
    res.json(dbHot);
  } else {
    // Seed with defaults if no data yet
    res.json([
      { question: 'A区看台太挤了怎么办？', count: 0 },
      { question: '最近的逃生通道在哪里？', count: 0 },
      { question: '南侧安全出口怎么走？', count: 0 },
      { question: 'B区看台到集结点怎么走？', count: 0 },
      { question: '紧急疏散应该注意什么？', count: 0 },
      { question: '最近的应急物资仓库在哪里？', count: 0 },
    ]);
  }
});

// ============ Vision — Multimodal Spot Recognition ============

visitorRouter.post('/vision/recognize', async (req: Request, res: Response) => {
  try {
    const { image_base64 } = req.body;
    if (!image_base64) return res.status(400).json({ error: '请上传图片' });
    if (!isLLMAvailable()) return res.status(503).json({ error: 'AI模型不可用，请配置API密钥' });

    const systemPrompt = `你是应急指挥图像识别专家。请仔细观察这张图片，判断最可能是场馆的哪个区域或安全出口。

主馆区域：A区看台(主看台区，设两条疏散楼梯)、中央广场(中央集散广场)、B区看台(邻近南侧安全出口)、西侧看台(邻近西侧安全出口)、北侧通道(主疏散通道)、南侧安全出口(直通室外)、中央步道(中央主步道)、亲子集结点(家庭集结点)、高区塔楼(高层区域，禁乘电梯)、东侧休息区(休息与急救点)、入口广场(主入口广场)、主入口(客流监测)、中轴浮雕墙(方位参照)、中轴立柱(方位参照)、应急物资仓库(应急物资储备点)。

东区区域：东区集结点(室外集结点)、室外疏散区(大规模疏散缓冲地)、商业通道(应急照明通道)、中心湖区(远离水域)、活动大厅(多条疏散通道)、山谷通道(注意地面湿滑)。

请返回纯JSON（不要markdown代码块）：{"spot_name":"安全出口名称","confidence":0.0-1.0,"description":"100字以内的安全出口简介","nearby_spots":["附近安全出口1","附近安全出口2"]}`;

    const result = await callMultimodalLLM(
      systemPrompt,
      '请识别这张图片中的场馆安保指挥安全出口，并返回JSON格式结果。',
      image_base64,
      { temperature: 0.2, max_tokens: 350 }
    );

    if (!result) {
      return res.json({
        recognized: false,
        spot_name: '未能识别',
        confidence: 0,
        description: '请尝试拍摄更清晰的安全出口照片，或直接输入安全出口名称查询。',
        nearby_spots: [],
      });
    }

    // Try to parse JSON from response (handle markdown code blocks)
    try {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        res.json({ recognized: true, ...parsed });
      } else {
        res.json({
          recognized: true,
          spot_name: '东侧疏散通道',
          confidence: 0.5,
          description: result.slice(0, 200),
          nearby_spots: [],
        });
      }
    } catch {
      res.json({
        recognized: true,
        spot_name: '东侧疏散通道',
        confidence: 0.5,
        description: result.slice(0, 200),
        nearby_spots: [],
      });
    }
  } catch (e: any) {
    res.status(500).json({ error: '识别失败', detail: e.message });
  }
});

// ============ Status ============

visitorRouter.get('/status', (_req: Request, res: Response) => {
  const kbStats = getKnowledgeStats();
  const convStats = getConversationStats();
  res.json({
    llm_available: isLLMAvailable(),
    model: getActiveModelName(),
    tts_available: true,
    asr_available: true,
    knowledge_chunks: kbStats.chunkCount,
    knowledge_indexed: kbStats.isIndexed,
    total_conversations: convStats.total,
  });
});

// ============ Nearby Spots (GPS) ============

/**
 * Haversine distance in meters between two lat/lng points.
 */
function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000; // Earth radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

visitorRouter.get('/nearby', (req: Request, res: Response) => {
  const lat = parseFloat(req.query.lat as string);
  const lng = parseFloat(req.query.lng as string);
  const radius = parseFloat(req.query.radius as string) || 2000; // default 2km

  if (isNaN(lat) || isNaN(lng)) {
    return res.status(400).json({ error: '请提供有效的经纬度坐标 (lat, lng)' });
  }

  const nearby = ALL_SPOTS
    .map(spot => ({
      ...spot,
      distance: Math.round(haversineDistance(lat, lng, spot.lat, spot.lng)),
    }))
    .filter(s => s.distance <= radius)
    .sort((a, b) => a.distance - b.distance);

  const nearest = nearby[0] || null;

  res.json({
    location: { lat, lng },
    radius_m: radius,
    nearest_spot: nearest ? {
      id: nearest.id,
      name: nearest.name,
      area: nearest.area,
      distance_m: nearest.distance,
      direction_hint: nearest.distance < 50 ? '您已到达' :
        nearest.distance < 200 ? '步行2-3分钟' :
        nearest.distance < 500 ? '步行5-8分钟' :
        nearest.distance < 1000 ? '步行约15分钟' :
        '建议搭乘安保指挥接驳车',
      summary: nearest.summary,
      highlight: nearest.highlight,
    } : null,
    nearby_spots: nearby.slice(0, 10).map(s => ({
      id: s.id,
      name: s.name,
      area: s.area,
      distance_m: s.distance,
      category: s.category,
    })),
    total_nearby: nearby.length,
    tip: nearest
      ? `您当前位置距离${nearest.name}约${nearest.distance}米，${nearest.distance < 50 ? '已到达！' : nearest.distance < 200 ? '步行即达。' : nearest.distance < 500 ? '步行几分钟即达。' : '建议搭乘安保指挥接驳车前往。'}`
      : '附近暂未发现安全出口，请确认您位于东侧疏散通道安保指挥范围内。',
  });
});

// ============ Helpers ============

// ============ Nearby Facilities (Baidu Map POI) ============

const FACILITY_KEYWORDS: Record<string, string[]> = {
  'spots': ['安全出口'],
  'toilet': ['公共厕所'],
  'shop': ['商店'],
  'nursery': ['母婴室'],
  'entrance': ['入口'],
  'visitor_center': ['疏散人群中心'],
  'ticket': ['售票处'],
  'hotel': ['酒店'],
  'rest': ['休息区'],
  'sightseeing': ['观光车站'],
};

const BAIDU_MAP_AK = 'ZT4ycNFGJ6Q5JzZs6IRCXTRjhQGtHpIx';

visitorRouter.get('/nearby-facilities', async (req: Request, res: Response) => {
  try {
    // Fixed search center: Ling Shan scenic area center.
    // This ensures facilities returned are inside the scenic area.
    const searchLat = 31.4269;
    const searchLng = 120.1009;
    const type = req.query.type as string;

    // User's real coordinates (for distance calculation), fallback to Ling Shan center.
    let userLat = parseFloat(req.query.lat as string);
    let userLng = parseFloat(req.query.lng as string);
    if (isNaN(userLat) || isNaN(userLng)) {
      userLat = searchLat;
      userLng = searchLng;
    }

    if (!type || !FACILITY_KEYWORDS[type]) {
      return res.status(400).json({ error: '请提供有效的设施类型' });
    }

    console.log(`[nearby-facilities] 搜索圆心=(${searchLat},${searchLng}), 疏散人群坐标=(${userLat},${userLng}), type=${type}`);

    const keywords = FACILITY_KEYWORDS[type];
    let allResults: any[] = [];

    for (const keyword of keywords) {
      const url = `https://api.map.baidu.com/place/v2/search?query=${encodeURIComponent(keyword)}&location=${searchLat},${searchLng}&radius=3000&output=json&ak=${BAIDU_MAP_AK}`;
      console.log(`[nearby-facilities] 调用百度地图API: ${url}`);
      const response = await fetch(url);
      const data: any = await response.json();
      console.log(`[nearby-facilities] 百度地图API原始响应:`, JSON.stringify(data, null, 2));

      if (data.status === 0 && data.results) {
        const items = data.results.map((r: any) => {
          const itemLat = r.location?.lat;
          const itemLng = r.location?.lng;
          const dist = (itemLat && itemLng) ? Math.round(haversineDistance(userLat, userLng, itemLat, itemLng)) : 0;
          return {
            name: r.name,
            address: r.address || '',
            distance: dist,
            lat: itemLat,
            lng: itemLng,
            uid: r.uid || null,
          };
        });
        allResults = allResults.concat(items);
      }
    }

    // Filter out irrelevant peripheral-town shops (农资店、副食店、建材店 etc.)
    const IRRELEVANT_KEYWORDS = ['农资', '副食', '建材', '五金', '汽修', '农具', '饲料', '农药'];
    allResults = allResults.filter(item =>
      !IRRELEVANT_KEYWORDS.some(kw => (item.name || '').includes(kw))
    );

    // Sort by calculated distance, deduplicate by name
    allResults.sort((a, b) => a.distance - b.distance);
    const seen = new Set<string>();
    const unique = allResults.filter(item => {
      if (seen.has(item.name)) return false;
      seen.add(item.name);
      return true;
    });

    console.log(`[nearby-facilities] 解析后的设施列表数量: ${unique.length}`);
    const responseData = { facilities: unique.slice(0, 10) };
    console.log('[DEBUG] 返回给前端的设施数据:', JSON.stringify(responseData, null, 2));
    res.json(responseData);
  } catch (error: any) {
    console.error('Baidu Map API error:', error);
    res.status(500).json({ error: '设施搜索失败' });
  }
});

async function detectEmotion(query: string, answer: string): Promise<string> {
  return analyzeEmotion(query);
}

function extractSpots(text: string): string[] {
  const names = ALL_SPOTS.map(s => s.name);
  return names.filter(n => text.includes(n));
}

// ============ Digital Human public config (no auth) ============

visitorRouter.get('/dh-config', (_req: Request, res: Response) => {
  const configPath = resolveDataPath('dh_config.json');
  let stylePreset = 'zen_red_gold';
  let voiceId = 'zh-CN-XiaoxiaoNeural';
  try {
    if (fs.existsSync(configPath)) {
      const saved = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (saved.style_preset) stylePreset = saved.style_preset;
      if (saved.voice_id) voiceId = saved.voice_id;
    }
  } catch {}
  res.json({ style_preset: stylePreset, voice_id: voiceId });
});

export { visitorRouter };
