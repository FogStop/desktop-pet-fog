/**
 * 对话走第三方中转站（OpenAI 兼容网关，如 vibeapi.cn / omyai.vip）——
 * 独立模式（standalone）没有 DSH 的模型后端，但用户在设置面板里填了中转站
 * Base URL + API Key + 模型名后，对话就由这里直连中转站的 /v1/chat/completions 完成。
 *
 * 设计：
 * - 配置来源：与余额查询同源——relay-config.json（DSH_PET_RELAY_CONFIG 指向的本地文件，
 *   由 standalone 上下文把取路径函数注入 ctx.relayConfigPath）；
 * - 站点选择：第一个「API Key 非空 **且 model 非空**」的站点（对话必须知道模型名，
 *   余额查询不需要模型，所以模型空着的站点跳过）；
 * - 请求：OpenAI 兼容非流式（stream:false），messages = system 人设 + 历史 + 当前输入；
 * - 零第三方依赖：Node 18+ 全局 fetch；短超时（对话 60s 足够）；
 * - 失败显式结构化返回，不伪造文案。
 */

import { readFileSync } from 'node:fs';

/** 对话生成失败原因（与 chat.ts 的 ChatGenerateResult 同构） */
export type RelayChatResult =
  | { ok: true; text: string }
  | { ok: false; reason: 'provider-missing' | 'generate-error'; message?: string };

/** 单次请求超时（ms） */
const TIMEOUT_MS = 60_000;

/** 中转站对话配置（从 relay-config.json 里取，字段与面板保存的 provider 一致） */
interface RelayProviderConfig {
  name?: unknown;
  baseUrl?: unknown;
  apiKey?: unknown;
  model?: unknown;
}

function relayConfigPathOf(ctx: { relayConfigPath?: () => string }): string {
  try {
    const p = ctx.relayConfigPath?.();
    return typeof p === 'string' && p.length > 0 ? p : '';
  } catch {
    return '';
  }
}

/**
 * 读中转站配置，找第一个可用（Key + 模型都非空）的站点。
 * @returns { baseUrl, apiKey, model } 或 undefined（无可用站点）
 */
export function pickRelayChatProvider(
  ctx: { relayConfigPath?: () => string },
): { baseUrl: string; apiKey: string; model: string } | undefined {
  const file = relayConfigPathOf(ctx);
  if (!file) return undefined;
  let parsed: { providers?: unknown };
  try {
    // strip UTF-8 BOM（\uFEFF）：编辑器/某些写入工具会带 BOM，JSON.parse 会因它直接报错
    parsed = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) as { providers?: unknown };
  } catch {
    return undefined;
  }
  const providers = Array.isArray(parsed.providers) ? parsed.providers : [];
  for (const p of providers) {
    if (!p || typeof p !== 'object') continue;
    const prov = p as RelayProviderConfig;
    const apiKey = typeof prov.apiKey === 'string' ? prov.apiKey.trim() : '';
    const model = typeof prov.model === 'string' ? prov.model.trim() : '';
    const baseUrl = String(prov.baseUrl ?? '').trim().replace(/\/+$/, '');
    if (apiKey && model && baseUrl) return { baseUrl, apiKey, model };
  }
  return undefined;
}

/**
 * 经中转站生成一句对话回复（OpenAI 兼容非流式）。
 * @param ctx 宿主上下文（注入 relayConfigPath 取配置路径）
 * @param system 人设提示词
 * @param history 最近记忆（user/assistant 交替，时间正序）
 * @param userText 用户刚输入的对话
 * @returns 回复文本，或结构化失败
 */
export async function relayChat(
  ctx: { relayConfigPath?: () => string },
  system: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  userText: string,
): Promise<RelayChatResult> {
  const prov = pickRelayChatProvider(ctx);
  if (!prov) {
    return {
      ok: false,
      reason: 'provider-missing',
      message: '中转站未配置对话模型（请在「中转站设置」面板为该站点填写模型名）',
    };
  }
  const messages: Array<{ role: string; content: string }> = [];
  if (system.trim()) messages.push({ role: 'system', content: system.trim() });
  for (const m of history) messages.push({ role: m.role, content: m.content });
  messages.push({ role: 'user', content: userText });

  let res: Response;
  try {
    res = await fetch(prov.baseUrl + '/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + prov.apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ model: prov.model, messages, stream: false }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    return { ok: false, reason: 'generate-error', message: e instanceof Error ? e.message : String(e) };
  }
  if (res.status < 200 || res.status >= 300) {
    return {
      ok: false,
      reason: 'generate-error',
      message: '中转站返回 HTTP ' + res.status + '（' + prov.baseUrl + '）',
    };
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    return { ok: false, reason: 'generate-error', message: '中转站响应不是合法 JSON' };
  }
  const body = json && typeof json === 'object' ? (json as Record<string, unknown>) : {};
  const choices = Array.isArray(body.choices) ? body.choices : [];
  const first = choices[0] && typeof choices[0] === 'object' ? (choices[0] as Record<string, unknown>) : {};
  const msg = first.message && typeof first.message === 'object' ? (first.message as Record<string, unknown>) : {};
  const text = typeof msg.content === 'string' ? msg.content.trim() : '';
  if (!text) {
    const err = typeof body.error === 'object' ? JSON.stringify(body.error) : '';
    return {
      ok: false,
      reason: 'generate-error',
      message: '中转站未返回文本' + (err ? '：' + err : ''),
    };
  }
  return { ok: true, text };
}
