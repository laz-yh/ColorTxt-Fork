/**
 * 朗读文本切段（按「字数单位」+ 句末切分，便于 Edge 多段缓冲与后续按句跳转）。
 */

/**
 * 是否含 TTS 可朗读的实义字符（字母、数字、CJK 等）。
 * 仅空白、标点、符号（如 ※、──）返回 false，避免 Edge 无音频与长时间重试。
 */
export function hasVoiceReadSpeakableText(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return false;
  return /[\p{L}\p{N}\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/u.test(t);
}

/** CJK 等计 2，其余计 1 */
export function countVoiceReadUnits(text: string): number {
  let count = 0;
  for (const ch of text) {
    count += /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/.test(ch) ? 2 : 1;
  }
  return count;
}

/** Edge */
export const VOICE_READ_CHUNK_UNITS_EDGE = 800;
/** DashScope / 系统 */
export const VOICE_READ_CHUNK_UNITS_DEFAULT = 500;

/**
 * 在句读边界切分，单段不超过 `maxUnits`（字数单位）。
 */
export function splitVoiceReadChunks(text: string, maxUnits: number): string[] {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned || !hasVoiceReadSpeakableText(cleaned)) return [];
  if (countVoiceReadUnits(cleaned) <= maxUnits) return [cleaned];

  const sentences = cleaned.split(/(?<=[。！？.!?\n])\s*/);
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (countVoiceReadUnits(current + sentence) > maxUnits && current) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current += sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}
