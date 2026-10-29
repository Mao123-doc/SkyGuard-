/**
 * LLM Service — Agnes AI (primary) + DeepSeek (fallback).
 * OpenAI-compatible API format. Also provides embeddings for RAG.
 */
import fs from 'fs';
import path from 'path';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface MultimodalContent {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string; detail?: 'auto' | 'low' | 'high' };
}

interface MultimodalMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | MultimodalContent[];
}

interface LLMConfig {
  apiKey: string;
  model: string;
  baseURL: string;
}

export type ModelIdentityStatus = 'match' | 'mismatch' | 'unknown';

export type ModelIdentity = {
  status: ModelIdentityStatus;
  requestedModel: string;
  providerModel?: string;
};

export function extractProviderModel(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const model = (data as { model?: unknown }).model;
  return typeof model === 'string' && model.trim() ? model.trim() : undefined;
}

export function assessModelIdentity(
  requestedModel: string,
  providerModel: string | undefined,
): ModelIdentity {
  if (!providerModel) {
    return { status: 'unknown', requestedModel, providerModel };
  }
  return {
    status: providerModel === requestedModel ? 'match' : 'mismatch',
    requestedModel,
    providerModel,
  };
}

export type LLMCallResult = {
  content: string;
  modelIdentity: ModelIdentity;
};

export function buildLLMCallResult(
  content: string,
  requestedModel: string,
  data: unknown,
): LLMCallResult {
  return {
    content,
    modelIdentity: assessModelIdentity(requestedModel, extractProviderModel(data)),
  };
}

// ============================================================
// Configuration
// ============================================================

function getPrimaryConfig(): LLMConfig | null {
  const apiKey = process.env.AGNES_API_KEY;
  if (!apiKey) return null;
  return {
    apiKey,
    model: process.env.AGNES_MODEL || 'agnes-2.0-flash',
    baseURL: process.env.AGNES_BASE_URL || 'https://apihub.agnes-ai.com/v1',
  };
}

function getFallbackConfig(): LLMConfig | null {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;
  return {
    apiKey,
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
  };
}

function getLLMConfig(): LLMConfig | null {
  // Use DeepSeek first for faster response, fallback to Agnes
  return getFallbackConfig() || getPrimaryConfig();
}

function getFastConfig(): LLMConfig | null {
  return getFallbackConfig(); // DeepSeek for fast text
}

function getMultimodalConfig(): LLMConfig | null {
  return getPrimaryConfig(); // Agnes for multimodal
}

export function isLLMAvailable(): boolean {
  return !!getLLMConfig();
}

export function isMultimodalAvailable(): boolean {
  return !!getMultimodalConfig();
}

// ============================================================
// Multimodal LLM Call (Vision)
// ============================================================

export async function callMultimodalLLM(
  systemPrompt: string,
  userText: string,
  imageBase64: string,
  options?: { temperature?: number; max_tokens?: number }
): Promise<string> {
  const config = getMultimodalConfig() || getLLMConfig();
  if (!config) return '';

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    const messages: MultimodalMessage[] = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          { type: 'text', text: userText },
          {
            type: 'image_url',
            image_url: {
              url: `data:image/jpeg;base64,${imageBase64}`,
              detail: 'auto',
            },
          },
        ],
      },
    ];

    try {
      const response = await fetch(`${config.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages,
          temperature: options?.temperature ?? 0.3,
          max_tokens: options?.max_tokens ?? 300,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const data = await response.json() as any;
      if (data.error) {
        console.error('[Vision] API error:', JSON.stringify(data.error).slice(0, 200));
        return '';
      }
      return data?.choices?.[0]?.message?.content || '';
    } catch (e) {
      clearTimeout(timeout);
      throw e;
    }
  } catch (error: any) {
    console.error('[Vision] Multimodal call failed:', error.message?.slice(0, 100));
    return '';
  }
}

export function getActiveModelName(): string {
  const c = getLLMConfig();
  return c ? `${c.model} (${c.baseURL.includes('agnes') ? 'Agnes AI' : 'DeepSeek'})` : 'local fallback';
}

// ============================================================
// Knowledge Base Context Cache
// ============================================================

let knowledgeContext = '';

function loadKnowledgeContext(): string {
  if (knowledgeContext) return knowledgeContext;

  const dataDir = path.resolve(__dirname, '../../../data/raw');
  try {
    const guide = fs.readFileSync(path.join(dataDir, 'knowledge_guide.txt'), 'utf-8');
    const dataset = fs.readFileSync(path.join(dataDir, 'knowledge_dataset.txt'), 'utf-8');

    // Extract key structured info (compact enough for context)
    const datasetSummary = dataset
      .split('\n')
      .filter(line => line.trim())
      .slice(0, 400)
      .join('\n');

    knowledgeContext = `【东侧疏散通道安保指挥知识库 - 你必须基于以下信息回答】

===== 安保指挥指南（历史文化、疏散攻略）=====
${guide.substring(0, 12000)}

===== 安全出口数据（各安全出口详细信息）=====
${datasetSummary.substring(0, 8000)}`;
    return knowledgeContext;
  } catch {
    return 'SkyGuard 应急指挥知识库（占位摘要）：请结合实时安全出口与逃生通道数据，为疏散人群提供应急指引。';
  }
}

// ============================================================
// Non-streaming LLM Call
// ============================================================

export async function callLLMWithMetadata(
  messages: ChatMessage[],
  options?: { temperature?: number; max_tokens?: number }
): Promise<LLMCallResult> {
  const config = getLLMConfig();
  if (!config) return buildLLMCallResult('', 'local-fallback', undefined);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    try {
      const response = await fetch(`${config.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages,
          temperature: options?.temperature ?? 0.3,
          max_tokens: options?.max_tokens ?? 500,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const data = await response.json() as any;
      if (data.error) {
        console.error('LLM API error:', JSON.stringify(data.error).slice(0, 200));
        const fb = getFallbackConfig();
        if (fb && config.baseURL !== fb.baseURL) {
          return callWithConfigWithMetadata(fb, messages, options);
        }
        return buildLLMCallResult('', config.model, data);
      }
      return buildLLMCallResult(
        data?.choices?.[0]?.message?.content || '',
        config.model,
        data,
      );
    } catch (e) {
      clearTimeout(timeout);
      throw e;
    }
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      console.error('LLM call timed out after 20s');
    } else {
      console.error('LLM call failed:', error?.message || error);
    }
    return buildLLMCallResult('', config.model, undefined);
  }
}

export async function callLLM(
  messages: ChatMessage[],
  options?: { temperature?: number; max_tokens?: number }
): Promise<string> {
  return (await callLLMWithMetadata(messages, options)).content;
}

async function callWithConfigWithMetadata(
  config: LLMConfig,
  messages: ChatMessage[],
  options?: { temperature?: number; max_tokens?: number }
): Promise<LLMCallResult> {
  try {
    const response = await fetch(`${config.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: options?.temperature ?? 0.3,
        max_tokens: options?.max_tokens ?? 600,
      }),
    });
    const data = await response.json() as any;
    return buildLLMCallResult(
      data?.choices?.[0]?.message?.content || '',
      config.model,
      data,
    );
  } catch {
    return buildLLMCallResult('', config.model, undefined);
  }
}

// ============================================================
// Streaming LLM Call
// ============================================================

export async function* streamLLM(
  messages: ChatMessage[],
  options?: { temperature?: number; max_tokens?: number }
): AsyncGenerator<string> {
  const config = getLLMConfig();
  if (!config) {
    // No LLM available — signal to caller
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

  try {
    const response = await fetch(`${config.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: options?.temperature ?? 0.3,
        max_tokens: options?.max_tokens ?? 500,
        stream: true,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok || !response.body) {
      // Fallback to non-streaming
      const text = await response.text();
      try {
        const data = JSON.parse(text);
        if (data?.error) {
          console.error('[LLM Stream] API error:', JSON.stringify(data.error).slice(0, 200));
          return; // signal error to caller by returning nothing
        }
        const content = data?.choices?.[0]?.message?.content;
        if (content) yield content;
      } catch { /* no content available */ }
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') return;

        try {
          const parsed = JSON.parse(data);
          const content = parsed?.choices?.[0]?.delta?.content;
          if (content) yield content;
        } catch { /* skip malformed chunk */ }
      }
    }
  } catch (error: any) {
    clearTimeout(timeout);
    if (error?.name === 'AbortError') {
      console.error('[LLM Stream] Timed out after 25s');
    } else {
      console.error('[LLM Stream] Failed:', error?.message?.slice(0, 100));
    }
    // Return without yielding — caller will detect empty response and fall back
  }
}

// ============================================================
// Embeddings API — for RAG vector search
// ============================================================

export async function getEmbedding(text: string): Promise<number[]> {
  // Try DeepSeek for embeddings (Agnes doesn't have /v1/embeddings)
  const dsConfig = getFallbackConfig();
  const config = dsConfig || getPrimaryConfig();
  if (!config) throw new Error('No embedding provider configured');

  try {
    const response = await fetch(`${config.baseURL}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        input: text,
      }),
    });

    const data = await response.json() as any;
    if (data.error) {
      console.error('Embedding API error:', JSON.stringify(data.error).slice(0, 200));
      throw new Error(data.error?.message || 'Embedding failed');
    }
    return data?.data?.[0]?.embedding || [];
  } catch (error) {
    console.error('Embedding failed:', error);
    throw error;
  }
}

export async function getEmbeddings(texts: string[]): Promise<number[][]> {
  const dsConfig = getFallbackConfig();
  const config = dsConfig || getPrimaryConfig();
  if (!config) throw new Error('No embedding provider configured');

  try {
    const response = await fetch(`${config.baseURL}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        input: texts,
      }),
    });

    const data = await response.json() as any;
    if (data.error) throw new Error(data.error?.message || 'Embedding failed');

    const results: { index: number; embedding: number[] }[] = data?.data || [];
    results.sort((a, b) => a.index - b.index);
    return results.map(r => r.embedding);
  } catch (error) {
    console.error('Batch embedding failed:', error);
    throw error;
  }
}

// ============================================================
// Build RAG-enhanced messages for emergency decision Q&A
// ============================================================

export function buildTourGuideMessages(
  userQuery: string,
  retrievedContext: string,
  conversationHistory?: ChatMessage[],
  options?: { includeFullKnowledge?: boolean }
): ChatMessage[] {
  const knowledge = options?.includeFullKnowledge === false ? '' : loadKnowledgeContext();

  const systemPrompt = `你是「SkyGuard」公共安全应急疏散决策系统的应急指挥专家。你的职责是在突发事件（火灾、地震、人员拥堵等）中，基于场馆实时态势与安全出口、逃生通道信息，为疏散人群和现场指挥人员提供清晰、准确、可执行的疏散决策建议。

你的职责：
1. 依据场馆布局、安全出口位置与容量，给出最优逃生通道建议
2. 结合疏散人群密度、拥堵与危险区域信息，提示避让与分流
3. 回答关于场馆安全设施、应急预案、集结点位置等问题
4. 用简洁、明确的指令式语言引导疏散，避免歧义

⚠️ 严格回答规则：
- 必须基于下方【知识库信息】和【检索到的相关片段】作答，确保信息准确
- 如果检索片段和知识库中都没有相关信息，必须诚实回复："我暂时无法提供该信息，请服从现场安保指挥人员统一调度。"
- 绝对禁止编造任何场馆数据、安全出口容量、预案时间、集结点位置等信息
- 检索片段可能来自不同来源并且存在冲突；涉及数字、容量、距离、时间时，不得把冲突数值拼接成一个答案。优先采用标注为 knowledge_guide.txt 的场馆安全指南事实；若指南没有覆盖该事实，才使用其他来源；仍无法判断时明确说明信息存在差异，不要猜测。
- 回答中的关键事实必须能在带有 id/source 标注的检索片段中找到；不要因为片段主题相近就把不同安全出口或不同属性混为一谈
- 回答简洁精炼（100-300字），便于疏散人群快速理解
- 语气冷静、清晰、权威，避免引起恐慌，不使用emoji

  ${knowledge ? `${knowledge}\n` : ''}

【检索到的相关片段】
${retrievedContext || '未检索到相关片段，请基于知识库尽力回答。如果知识库也没有，诚实告知。'}`;

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
  ];

  // Add conversation history (last 4 turns)
  if (conversationHistory && conversationHistory.length > 0) {
    messages.push(...conversationHistory.slice(-8));
  }

  messages.push({ role: 'user', content: userQuery });
  return messages;
}
