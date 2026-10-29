// 强制指定本地代理（Watt Toolkit / Clash 等）。如端口不对请改成实际值。
process.env.HTTP_PROXY = 'http://127.0.0.1:26561';
process.env.HTTPS_PROXY = 'http://127.0.0.1:26561';

const TTS_SERVER_URL = process.env.TTS_SERVER_URL || 'http://127.0.0.1:8001';

interface TTSResult {
  audioBase64: string;
  duration: number;
  visemes: Array<{ time_ms: number; viseme_id: number; viseme_name: string; shape: { w: number; h: number } }>;
  voice: string;
}

export async function textToSpeech(text: string, options?: { voice?: string; rate?: string; pitch?: string }): Promise<TTSResult | null> {
  const cleanText = text.replace(/["'`$\\]/g, '').trim();
  console.log(`[TTS] textToSpeech called, text length=${cleanText.length}, first 50 chars="${cleanText.slice(0, 50)}"`);
  if (!cleanText || cleanText.length < 2) {
    console.log('[TTS] text too short, returning null');
    return null;
  }

  const voice = options?.voice || 'zh-CN-XiaoxiaoNeural';

  // ── 方案1：优先用 npm edge-tts 直接合成（走网络，使用上方代理） ──
  try {
    console.log('[TTS] 正在请求外部语音服务...');
    const { tts } = await import('edge-tts');
    const buf: Buffer = await tts(cleanText, {
      voice,
      rate: options?.rate || '+0%',
      pitch: options?.pitch || '+0Hz',
      volume: '+0%',
    });
    if (buf && buf.length > 200) {
      console.log('[TTS] 外部语音服务已返回');
      console.log(`[TTS] edge-tts(npm) success, audio bytes=${buf.length}`);
      return {
        audioBase64: buf.toString('base64'),
        duration: Math.max(Math.round(buf.length / 1000), 800),
        visemes: [],
        voice,
      };
    }
    console.log('[TTS] edge-tts(npm) returned empty audio');
  } catch (e) {
    console.error('❌ TTS合成失败:', e);
  }

  // ── 方案2：回退到 Python 8001 TTS 服务 ──
  try {
    const payload = { text: cleanText, voice, rate: options?.rate || '+0%', pitch: options?.pitch || '+0Hz' };
    const res = await fetch(`${TTS_SERVER_URL}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(25000),
    });
    const data = await res.json() as any;
    if (data.error) { console.error('[TTS] Python server error:', data.error); return null; }
    if (!data.audio_base64) { console.error('[TTS] Python server returned no audio'); return null; }
    return {
      audioBase64: data.audio_base64,
      duration: data.duration_ms,
      visemes: data.visemes || [],
      voice: data.voice || voice,
    };
  } catch (e: any) {
    console.error('❌ TTS合成失败:', e);
    return null;
  }
}

export async function generateSpeechAudio(text: string): Promise<string | null> {
  const r = await textToSpeech(text);
  return r?.audioBase64 || null;
}