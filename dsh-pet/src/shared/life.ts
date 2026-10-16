// 宠物的"活生生"行为（src/shared 纯逻辑，浏览器 bundle 与桌面 shared-core 共用同一份）：
// 时段感知（早/午/晚/深夜 + 安静时段）、点击连击情绪升级、久别重逢 / 求关注。
//
// **本模块零 API、零 token、零 IO**：全部结论由「现在几点 / 上次互动是什么时候 / 连戳了几下」
// 这三个本地事实推出，不碰网络、不碰模型。它替代的是"只会循环播动画的电子宠物"——
// 让宠物有作息（深夜闭嘴）、有脾气（连戳会生气）、有记性（好久没理它会撒娇）。
//
// 为什么不放 host：host 半侧受 DSH 单文件加载约束不能 import src/shared，且这些行为
// 只发生在**端上**（浏览器 overlay / 桌面 sprite），host 连时钟都不该替它们读。
// 时钟由调用方传进来（`hour` / `now`），测试里才能把边界钉死。

import { pick } from './pickers';

// ---------- 时段 ----------

/** 一天 9 档（口径与 host 的 time-context.ts 完全一致：那里管提示词，这里管行为，两边不能漂） */
export type DayPhase = '凌晨' | '清晨' | '早上' | '上午' | '中午' | '下午' | '傍晚' | '晚上' | '深夜';

/**
 * 小时 → 时段（含起始小时，0–23 全覆盖、不重叠）：
 * 凌晨 0–4 / 清晨 5–6 / 早上 7–8 / 上午 9–10 / 中午 11–12 / 下午 13–16 / 傍晚 17–18 / 晚上 19–22 / 深夜 23
 */
export function dayPhaseOf(hour: number): DayPhase {
  if (hour >= 23 || hour < 0) return '深夜';
  if (hour >= 19) return '晚上';
  if (hour >= 17) return '傍晚';
  if (hour >= 13) return '下午';
  if (hour >= 11) return '中午';
  if (hour >= 9) return '上午';
  if (hour >= 7) return '早上';
  if (hour >= 5) return '清晨';
  return '凌晨';
}

/** 安静时段起点（含）：23 点以后宠物开始"犯困"——少说话、不主动搭话 */
export const QUIET_FROM_HOUR = 23;
/** 安静时段终点（不含）：6 点前都算深夜，6 点整恢复精神 */
export const QUIET_TO_HOUR = 6;

/** 是否安静时段（23:00–05:59）。越界/NaN 按非安静处理：宁可多说一句，也不要永久静音 */
export function isQuietHour(hour: number): boolean {
  if (!Number.isFinite(hour)) return false;
  return hour >= QUIET_FROM_HOUR || hour < QUIET_TO_HOUR;
}

/** 安静时段的台词间隔放大倍数：深夜还按白天的频率自言自语，只会显得吵 */
export const QUIET_DELAY_SCALE = 2.5;

/** 台词基础间隔 → 实际间隔（安静时段拉长；调用方传自己那档的基准值） */
export function lifeDelay(baseMs: number, hour: number): number {
  return isQuietHour(hour) ? Math.round(baseMs * QUIET_DELAY_SCALE) : baseMs;
}

// ---------- 点击连击情绪 ----------

/**
 * 连戳情绪档（由一次会话内的连击次数决定，窗口见 CLICK_COMBO_WINDOW_MS）：
 *   playful  俏皮（刚被戳，还觉得好玩）
 *   ticklish 痒（戳得有点多了，开始躲）
 *   annoyed  烦（明确表示不爽）
 *   angry    气（再戳就咬人）
 *   pleading 求饶（戳累了，主人饶了我吧）
 */
export type ClickMood = 'playful' | 'ticklish' | 'annoyed' | 'angry' | 'pleading';

/** 连击判定窗口（ms）：两次点击间隔超过它 → 连击数归 1 重新算（戳一下歇三分钟不算连击） */
export const CLICK_COMBO_WINDOW_MS = 3500;

/** 各情绪档的连击次数下限（>= 即入档；查表从高往低，第一个命中的即当前档） */
const CLICK_MOOD_STEPS: ReadonlyArray<readonly [number, ClickMood]> = [
  [10, 'pleading'],
  [7, 'angry'],
  [5, 'annoyed'],
  [3, 'ticklish'],
  [1, 'playful'],
];

/** 连击次数 → 情绪档。非正数（0/负数/NaN）按 1 次算：第一次点击永远是俏皮 */
export function clickMoodOf(combo: number): ClickMood {
  const n = Number.isFinite(combo) ? Math.max(1, Math.floor(combo)) : 1;
  for (const [min, mood] of CLICK_MOOD_STEPS) {
    if (n >= min) return mood;
  }
  return 'playful';
}

/** 连击状态（调用方持有；null = 上一次点击已过窗，本次是新连击的第一次） */
export interface ClickComboState {
  /** 本次连击已连续点击几次（含本次） */
  count: number;
  /** 本次连击最近一次点击的时间戳（ms） */
  at: number;
  /** 当前连击次数对应的情绪档 */
  mood: ClickMood;
}

/**
 * 一次点击 → 新的连击状态（纯函数，调用方存返回值即可）。
 * 超过窗口重新起连：`count` 归 1，情绪回 playful——"过一会儿再戳"它就不生气了，
 * 符合"宠物记性不长但当下有脾气"的直觉。
 */
export function nextClickCombo(prev: ClickComboState | null, now: number): ClickComboState {
  const count = prev && now - prev.at <= CLICK_COMBO_WINDOW_MS ? prev.count + 1 : 1;
  return { count, at: now, mood: clickMoodOf(count) };
}

// ---------- 台词池（全部本地字面量：不联网、不调模型、零 token） ----------

/** 点击俏皮话：按情绪档分池（原桌面端 CLICK_CATCH_LINES 的 19 句原样编入各档，一句没丢） */
export const CLICK_LINES: Readonly<Record<ClickMood, readonly string[]>> = {
  playful: [
    '嘿嘿，被我抓到啦！',
    '摸我干嘛呀～痒痒的～',
    '主人又来逗我玩啦？',
    '诶嘿，你上当啦！',
    '哇！有没有吓到？',
    '要不要我表演个原地消失？（并不）',
    '略略略，够不着我～',
    '主人手闲不下来是不是～',
    '哈！你被我的可爱迷住了吧？',
    '嘘——我假装在睡觉，别吵～',
  ],
  ticklish: [
    '啪！吓你一跳！',
    '我可不是好惹的哦～',
    '别戳啦，小心我挠你痒痒！',
    '这手感不错吧？嘿嘿～',
    '再摸一下，我就唱首歌（五音不全那种）～',
  ],
  annoyed: ['再摸我可就咬你啦！', '你是不是偷偷喜欢我呀～', '本宠物今天心情好，饶了你～'],
  angry: ['哼！再戳我生气啦！', '啊啊啊痒死了！住手住手！', '说好了就戳三下，主人说话不算数！'],
  pleading: ['别戳啦……我认输，主人最厉害了……', '手手疼……歇会儿好不好～', '我躲！哎哟，撞到边框了……'],
};

/** 深夜台词（安静时段专用：它也没睡，或者困得睁不开眼） */
export const NIGHT_LINES: readonly string[] = [
  '主人还不睡呀？我都困了……',
  'Zzz……（偷偷打瞌睡）',
  '深夜了，早点休息哦～',
  '屏幕该关掉啦，对眼睛不好……',
  '我陪主人熬这最后一次夜！',
  '呜……眼皮在打架了……',
  '深夜的屏幕好刺眼，调暗一点嘛～',
];

/** 早安台词（当天第一次开口时用；由调用方保证一天只问一次） */
export const MORNING_LINES: readonly string[] = [
  '早安主人！昨晚睡得好吗～',
  '主人早上好！新的一天加油呀～',
  '早呀～记得吃早饭哦！',
  '起床啦起床啦！懒虫主人～',
  '早安！今天也要元气满满！',
];

/** 求关注台词（好久没人理它，但还没到"久别重逢"的程度） */
export const BORED_LINES: readonly string[] = [
  '主人……都不理我……',
  '戳我一下嘛，就一下～',
  '无聊到数毛中了……',
  '主人还在忙吗？我乖乖等着～',
  '要不要休息一下，陪我玩玩？',
];

/** 久别重逢台词（离开很久后回来） */
export const REUNION_LINES: readonly string[] = [
  '主人你终于回来啦！想你了～',
  '哇！主人！我等到花儿都谢了……',
  '欢迎回来！我给你攒了一堆话想说～',
  '主人主人，你去哪儿啦？',
  '回来就好，我还以为你不要我了……',
];

// ---------- 缺席判定（求关注 / 久别重逢） ----------

/** 多久没人互动开始求关注（25 分钟）：再短就变话痨，主人开会能把宠物烦死 */
export const BORED_AFTER_MS = 25 * 60_000;
/** 多久算"久别重逢"（90 分钟）：通常是午休/下班回来，该说"想你了"而不是"理我一下" */
export const REUNION_AFTER_MS = 90 * 60_000;

/** 缺席情绪（null = 还不用说话） */
export type AbsenceMood = 'bored' | 'reunion';

/**
 * 距上次互动的间隔 → 该用什么姿态开口（纯函数，状态由调用方保管）。
 * - 安静时段一律 null：深夜它不主动撒娇，顶多在自己困的时候说一句（见 NIGHT_LINES）；
 * - 先重逢后求关注：间隔越长档位越高，别在"等了一下午"时只说"戳我一下嘛"。
 */
export function absenceMoodOf(gapMs: number, hour: number): AbsenceMood | null {
  if (!Number.isFinite(gapMs) || gapMs < 0) return null;
  if (isQuietHour(hour)) return null;
  if (gapMs >= REUNION_AFTER_MS) return 'reunion';
  if (gapMs >= BORED_AFTER_MS) return 'bored';
  return null;
}

// ---------- 取句（统一走 pick：等概率 + 避开上一句，避免连续重复） ----------

/** 点击台词：按情绪档取一句，尽量避开上一句（同档池小时"避开"会自动退回原池） */
export function clickLineFor(mood: ClickMood, current?: string): string {
  return pick(CLICK_LINES[mood] as string[], current);
}

/** 深夜台词一句（current 避开上一句） */
export function nightLineFor(current?: string): string {
  return pick(NIGHT_LINES as string[], current);
}

/** 早安台词一句（current 避开上一句） */
export function morningLineFor(current?: string): string {
  return pick(MORNING_LINES as string[], current);
}

/** 缺席台词一句（按求关注/重逢取池，current 避开上一句） */
export function absenceLineFor(mood: AbsenceMood, current?: string): string {
  return pick((mood === 'reunion' ? REUNION_LINES : BORED_LINES) as string[], current);
}
