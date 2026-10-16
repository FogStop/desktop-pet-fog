/**
 * 第三方中转站路由（provider id `standalone`）—— 账户金额。
 *
 * 独立模式（standalone）没有 DSH 模型供应商，`agentDefaultModel.currentSelection()` 恒报
 * `standalone`，原注册表匹配不到 → 旧行为是「当前服务商暂不支持余额查询」。本路由把该 id
 * 接进**本地中转站配置**（设置面板写入的 relay-config.json），余额/用量走站点的 billing 类
 * 接口（credit_grants / user/self / user/balance / api/balance —— 全是查询接口，**不发起任何
 * 模型请求，不消耗 token**）。
 *
 * 与其余路由同 shape（money）：气泡「余额 ¥x.xx」。不伪造任何数字 —— 查询失败一律 throw，
 * 由 queryBalance 统一落成 `fetch-error`；余额数值来自站点响应，原样呈现。
 */
import { readFileSync } from 'node:fs';
import { fetchWithRetry } from '../internal';
import type { BalanceProvider, BalanceSuccess } from '../types';

/** 中转站配置文件定位：环境变量 DSH_PET_RELAY_CONFIG 优先，缺省用本机默认路径（设置面板的落盘位置） */
function relayConfigPath(): string {
  const env = process.env.DSH_PET_RELAY_CONFIG;
  return env && env.length > 0 ? env : 'E:\\zhuoCh\\relay\\relay-config.json';
}

/** 余额/用量端点池（全部为零 token 的 billing/balance 接口）。
 * 实测口径：vibeapi 等 OpenAI 兼容系网关无余额接口（credit_grants 已随官方下线、one-api 管理路由
 * 不认模型 Key），但 /v1/dashboard/billing/usage 可用（OpenAI 官方消耗接口，美元口径）。
 * one-api / new-api 系站点走 /api/user/self（quota 余额）。 */
const PATH_POOL: Array<{ path: string; kind: 'balance' | 'usage' }> = [
  { path: '/api/user/self', kind: 'balance' }, // one-api / new-api 系
  { path: '/v1/user/balance', kind: 'balance' },
  { path: '/api/balance', kind: 'balance' },
  { path: '/v1/dashboard/billing/credit_grants', kind: 'balance' }, // OpenAI 旧版余额
  { path: '/v1/dashboard/billing/usage', kind: 'usage' }, // OpenAI 消耗（需日期参数）
];

/** YYYY-MM-DD（本地时区） */
function dateStr(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + m + '-' + day;
}

/** usage 端点需要近 30 天日期区间（OpenAI 官方参数） */
function usageUrl(base: string): string {
  const now = new Date();
  const start = new Date(now.getTime() - 30 * 86400000);
  return base + '/v1/dashboard/billing/usage?start_date=' + dateStr(start) + '&end_date=' + dateStr(now);
}

/** 宽松取字段（对象任意层级都不深挖，只取一层 + one-api 常见的 data. 包裹） */
function pick(o: unknown, keys: string[]): unknown {
  if (!o || typeof o !== 'object') return undefined;
  for (const k of keys) {
    const v = (o as Record<string, unknown>)[k];
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

/** 响应是否为显式失败（网关对无效 key 常回 200 + success:false / error 字段） */
function explicitFail(json: unknown): boolean {
  if (!json || typeof json !== 'object') return false;
  const j = json as Record<string, unknown>;
  return (
    j.success === false ||
    (typeof j.error === 'string' && j.error.length > 0) ||
    j.error_code !== undefined
  );
}

/** 数值 → 展示串：整数原样，小数收敛到 2 位（不引入浮点噪声） */
function fmtNumber(v: unknown): string | undefined {
  if (typeof v === 'string' && v.length > 0) {
    const n = Number(v);
    return Number.isFinite(n) ? (Number.isInteger(n) ? String(n) : n.toFixed(2)) : undefined;
  }
  if (typeof v === 'number' && Number.isFinite(v)) return Number.isInteger(v) ? String(v) : v.toFixed(2);
  return undefined;
}

export const relayStandalone: BalanceProvider = {
  ids: ['standalone'],
  credential: { mode: 'none' }, // 凭证来自本地中转站配置，不经 DSH 凭证系统
  async fetch({ provider }): Promise<BalanceSuccess> {
    // 1. 读中转站配置
    let raw = '';
    try {
      raw = readFileSync(relayConfigPath(), 'utf8');
    } catch {
      throw new Error('dsh-pet: 未找到中转站配置（' + relayConfigPath() + '），请先打开设置面板填写 API Key');
    }
    let parsed: { providers?: unknown };
    try {
      // strip UTF-8 BOM（\uFEFF）：编辑器/某些写入工具会带 BOM，JSON.parse 会因它直接报错
      parsed = JSON.parse(raw.replace(/^\uFEFF/, '')) as { providers?: unknown };
    } catch {
      throw new Error('dsh-pet: 中转站配置文件损坏（' + relayConfigPath() + '）');
    }
    const providers = Array.isArray(parsed.providers) ? parsed.providers : [];
    // 取第一个带 API Key 的站点（面板里可配置多个，主查询用第一个）
    const target = providers.find((p) => {
      if (!p || typeof p !== 'object') return false;
      const apiKey = (p as Record<string, unknown>).apiKey;
      return typeof apiKey === 'string' && apiKey.length > 0;
    }) as Record<string, unknown> | undefined;
    if (!target) {
      throw new Error('dsh-pet: 中转站未配置 API Key（请在设置面板填写后保存）');
    }
    const baseUrl = String(target.baseUrl ?? '').replace(/\/+$/, '');
    if (!baseUrl) throw new Error('dsh-pet: 中转站未配置 Base URL');

    // 面板自定义换算（convertRate = 显示值系数；convertUnit = 显示单位；label = 气泡文案前缀）
    const rate = Number(target.convertRate);
    const convRate = Number.isFinite(rate) && rate !== 0 ? rate : undefined;
    const unit = typeof target.convertUnit === 'string' ? target.convertUnit.trim() : '';
    const label = typeof target.label === 'string' ? target.label.trim() : '';
    const fmtNum = (n: number): string => {
      const r = Math.round(n * 10000) / 10000; // 收敛到最多 4 位小数，去浮点噪声
      return String(r);
    };
    const applyConv = (v: string | undefined): string | undefined => {
      if (v === undefined) return undefined;
      const n = Number(v);
      if (!Number.isFinite(n)) return v; // 非数字原样
      const out = convRate !== undefined ? fmtNum(n * convRate) : v;
      return unit.length > 0 ? out + ' ' + unit : out;
    };

    // 2. 逐个尝试余额/用量端点（全部为零 token 消耗的查询接口）
    let lastError = '';
    for (const { path, kind } of PATH_POOL) {
      const url = kind === 'usage' ? usageUrl(baseUrl) : baseUrl + path;
      let res: Response;
      try {
        res = await fetchWithRetry(url, String(target.apiKey ?? ''));
      } catch (e) {
        lastError = url + ' → ' + (e instanceof Error ? e.message : String(e));
        continue;
      }
      if (res.status < 200 || res.status >= 300) {
        lastError = url + ' → HTTP ' + res.status;
        continue;
      }
      let json: unknown = null;
      try {
        json = await res.json();
      } catch {
        lastError = url + ' → 响应非 JSON';
        continue;
      }
      if (explicitFail(json)) {
        lastError = url + ' → 鉴权失败';
        continue;
      }
      const body = json && typeof json === 'object' ? (json as Record<string, unknown>) : {};
      const data = body.data && typeof body.data === 'object' ? (body.data as Record<string, unknown>) : undefined;

      // 3. 解析余额/消耗：usage 端点按 OpenAI 官方 total_usage（USD 消耗）；其余按常见字段名探测余额
      if (kind === 'usage') {
        const used = fmtNumber(pick(body, ['total_usage', 'total_used', 'total']));
        if (used === undefined) {
          lastError = url + ' → 响应中没有 total_usage';
          continue;
        }
        return {
          ok: true,
          provider,
          shape: 'money',
          data: {
            currency: 'USD',
            // 气泡主行：OpenAI 兼容网关无余额接口，这里给近 30 天消耗（美元），
            // 用户可在面板自定义换算系数/单位/文案前缀
            total: applyConv(used) ?? '0',
            granted: '',
            toppedUp: '',
            noSymbol: unit.length > 0,
            label: label.length > 0 ? label : undefined,
          },
        };
      }
      const avail =
        pick(body, ['total_available', 'available_balance', 'balance', 'available', 'quota', 'remaining', 'credits', 'credit']) ??
        (data && pick(data, ['quota', 'balance', 'remaining', 'credits', 'remain_quota', 'available_balance']));
      const used =
        pick(body, ['total_used', 'used_balance', 'used', 'used_quota', 'consumed']) ??
        (data && pick(data, ['used_quota', 'used_balance', 'used']));
      const totalVal =
        pick(body, ['total_granted', 'total_balance', 'total', 'granted', 'total_quota']) ??
        (data && pick(data, ['total_quota', 'total_granted', 'total_balance']));

      const total = fmtNumber(avail);
      if (total === undefined && used === undefined && totalVal === undefined) {
        // 响应 2xx 但一个余额字段都认不出 → 记录并继续下一个端点
        lastError = url + ' → 响应中没有可识别的余额字段';
        continue;
      }
      const currencyRaw = String(
        pick(body, ['currency', 'unit']) ?? (data && pick(data, ['currency', 'unit'])) ?? '',
      );
      const currency = currencyRaw.length > 0 ? currencyRaw.toUpperCase() : 'CNY';
      return {
        ok: true,
        provider,
        shape: 'money',
        data: {
          currency,
          // 气泡主行：剩余额度（可经面板自定义换算系数/单位/文案前缀）
          total: applyConv(total) ?? '0',
          // 已用 / 总额度随数据带出（展示层当前不渲染这两个字段，留作完整数据）
          granted: used !== undefined ? (fmtNumber(used) ?? String(used)) : '',
          toppedUp: totalVal !== undefined ? (fmtNumber(totalVal) ?? String(totalVal)) : '',
          // 不提供档位基准：不替站点猜一个额度基准，因此不播档位动画（绝不伪造）
          noSymbol: unit.length > 0,
          label: label.length > 0 ? label : undefined,
        },
      };
    }
    throw new Error('dsh-pet: 中转站余额查询失败：' + (lastError || '全部端点不可达'));
  },
};
