// 「当前状况」（status）——浏览器 bundle 与桌面 shared-core 共用同一份纯逻辑。
// host 侧（src/host/status.ts）负责采集本机事实（CPU/内存/电量/前台应用/空闲时长）并写进
// S 的 sections.status；本模块只做三件事：
//   1. 叶子解析（脏数据一律丢弃，不进展示层）；
//   2. 档位判定（statusLevelOf → events.status 动画数组索引）+ 情绪判定（statusMoodOf）；
//   3. 气泡行（statusBubbleView）与台词池（STATUS_LINES）。
//
// **本模块零 API、零 token**：文案全是本地字面量，判定全靠传进来的数字。
// 时钟由调用方传入（hour），测试里才能把深夜/白天边界钉死。

import { pick } from './pickers';

// ---------- 契约（与 host 的 StatusSample 同构；host 不 import 本文件，两边靠形状对齐） ----------

/** 一次本机采样（字段全可空：拿不到就 null，展示层跳过那一行） */
export interface StatusSample {
  cpu: number | null; // CPU 占用 %
  memPct: number | null; // 内存占用 %
  memUsedGb: number | null;
  memTotalGb: number | null;
  battery: number | null; // 电量 %
  charging: boolean;
  app: string | null; // 前台应用进程名
  appMin: number | null; // 当前应用专注分钟数
  workMin: number | null; // 连续工作分钟数
  awayMin: number | null; // 离开分钟数
  uptimeMin: number | null; // 开机分钟数
  ts: number;
}

/** S 里 sections.status 的载荷 */
export interface StatusState {
  ok: boolean;
  sample: StatusSample;
}

// ---------- 解析 ----------

/**
 * 数字的严格收窄：null/undefined/空串 → null，非有限数 → null。
 *
 * **null 必须显式挡在 Number() 之前**：`Number(null) === 0`，漏判会把"读不到"变成"CPU 0%"
 * （实测踩过：叶子往返一次 JSON 后所有 null 字段全成了 0，桌宠一脸正经地报"CPU 0%"）。
 * 0 只在真的是 0 时才显示——不拿 0 冒充"读不到"。
 */
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 字符串的严格收窄：非字符串/空串 → null */
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

/**
 * 叶子 → StatusState。形状不对（非对象 / 没有 sample）→ null（消费端跳过这一拍，不抛）。
 * 单个字段脏只丢该字段，不整拍作废——CPU 读不到照样显示内存和电量。
 */
export function toStatusState(raw: unknown): StatusState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { ok?: unknown; sample?: unknown };
  // 没有 sample → 认不出这一拍（返回 null 让消费端跳过）：空壳状态只会显示"读取不到"，
  // 那是把"没数据"说成"采集失败"，属于编造
  if (!r.sample || typeof r.sample !== 'object') return null;
  const s = r.sample as Record<string, unknown>;
  const sample: StatusSample = {
    cpu: num(s.cpu),
    memPct: num(s.memPct),
    memUsedGb: num(s.memUsedGb),
    memTotalGb: num(s.memTotalGb),
    battery: num(s.battery),
    charging: s.charging === true,
    app: str(s.app),
    appMin: num(s.appMin),
    workMin: num(s.workMin),
    awayMin: num(s.awayMin),
    uptimeMin: num(s.uptimeMin),
    ts: num(s.ts) ?? 0,
  };
  return { ok: r.ok === true, sample };
}

// ---------- 情绪 / 档位 ----------

/**
 * 状况情绪（决定台词池与动画档位）：
 *   lowbattery 电量告急 / hot 机器压力大 / longwork 连续工作太久 / focus 专注很久 /
 *   night 深夜该睡 / away 人不在 / calm 一切如常
 */
export type StatusMood = 'lowbattery' | 'hot' | 'longwork' | 'focus' | 'night' | 'away' | 'calm';

/**
 * 动画档位（events.status 数组索引，顺序勿在中间插入）：
 * 0 calm / 1 focus / 2 longwork / 3 hot / 4 lowbattery / 5 night / 6 away
 */
export const STATUS_LEVEL: Record<StatusMood, number> = {
  calm: 0,
  focus: 1,
  longwork: 2,
  hot: 3,
  lowbattery: 4,
  night: 5,
  away: 6,
};

/** 判定阈值（集中在常量里，改口径只改这一处） */
export const STATUS_THRESHOLD = {
  /** 电量低于此值（且没插电）＝告急 */
  batteryLow: 20,
  /** CPU 高于此值 ＝ 机器吃力 */
  cpuHot: 85,
  /** 内存高于此值 ＝ 机器吃力 */
  memHot: 90,
  /** 连续工作超过此分钟数 ＝ 该休息了 */
  workLong: 50,
  /** 同一应用停留超过此分钟数 ＝ 专注 */
  focusLong: 45,
  /** 离开超过此分钟数 ＝ 人不在 */
  awayLong: 25,
  /** 安静时段起点（与 life.ts 的 QUIET_FROM_HOUR 同口径） */
  quietFrom: 23,
  /** 安静时段终点（不含） */
  quietTo: 6,
} as const;

/** 是否安静时段（23:00–05:59）：越界/NaN 按非安静处理——宁可多说一句，也不要永久静音 */
export function isStatusQuietHour(hour: number): boolean {
  if (!Number.isFinite(hour)) return false;
  return hour >= STATUS_THRESHOLD.quietFrom || hour < STATUS_THRESHOLD.quietTo;
}

/**
 * 采样 → 情绪（判定顺序即优先级，命中即返回）。
 * 为什么电量排第一：它是最"要紧"的一件事（快没电了比什么都急）；深夜排在人不在之后——
 * 人都走了就别喊睡觉了（喊了也没人听，还显得傻）。
 */
export function statusMoodOf(sample: StatusSample, hour: number): StatusMood {
  if (sample.battery !== null && !sample.charging && sample.battery <= STATUS_THRESHOLD.batteryLow) return 'lowbattery';
  const cpuHot = sample.cpu !== null && sample.cpu >= STATUS_THRESHOLD.cpuHot;
  const memHot = sample.memPct !== null && sample.memPct >= STATUS_THRESHOLD.memHot;
  if (cpuHot || memHot) return 'hot';
  if (sample.awayMin !== null && sample.awayMin >= STATUS_THRESHOLD.awayLong) return 'away';
  if (isStatusQuietHour(hour)) return 'night';
  if (sample.workMin !== null && sample.workMin >= STATUS_THRESHOLD.workLong) return 'longwork';
  if (sample.appMin !== null && sample.appMin >= STATUS_THRESHOLD.focusLong) return 'focus';
  return 'calm';
}

/** 采样 → 动画档位（events.status 数组索引） */
export function statusLevelOf(sample: StatusSample, hour: number): number {
  return STATUS_LEVEL[statusMoodOf(sample, hour)];
}

/**
 * 采样 → 最该说的一句俏皮话（按情绪取池）。
 * prev = 上一句（内部用它避开连续重复；池里只有一句时退回重复，与 pick 的哲学一致）。
 */
export function statusLineOf(sample: StatusSample, hour: number, prev?: string): string {
  const pool = STATUS_LINES[statusMoodOf(sample, hour)] as string[];
  return pick(pool, prev);
}

// ---------- 展示格式化 ----------

/** 分钟 → 「1小时20分 / 45分钟 / 不到1分钟」 */
export function formatMinutes(min: number | null): string {
  if (min === null || !Number.isFinite(min) || min < 0) return '-';
  const m = Math.floor(min);
  if (m < 1) return '不到1分钟';
  if (m < 60) return `${m}分钟`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h}小时` : `${h}小时${rest}分`;
}

/** 常见进程名 → 中文应用名（认不出的回落原始进程名，绝不瞎猜） */
const APP_NAMES: Readonly<Record<string, string>> = {
  code: '写代码',
  'code - insiders': '写代码',
  cursor: '写代码',
  devenv: '写代码',
  idea64: '写代码',
  pycharm64: '写代码',
  webstorm64: '写代码',
  chrome: '浏览器',
  msedge: '浏览器',
  firefox: '浏览器',
  brave: '浏览器',
  wechat: '微信',
  wechatappex: '微信',
  qq: 'QQ',
  wemeet: '腾讯会议',
  dingtalk: '钉钉',
  feishu: '飞书',
  lark: '飞书',
  explorer: '文件管理',
  notepad: '记事本',
  'windows terminal': '终端',
  windowsterminal: '终端',
  powershell: '终端',
  'windows powershell': '终端',
  cmd: '终端',
  excel: '表格',
  winword: '文档',
  powerpnt: '幻灯片',
  wps: 'WPS',
  et: 'WPS表格',
  wpp: 'WPS演示',
  spotify: '听歌',
  cloudmusic: '听歌',
  qqmusic: '听歌',
  potplayer: '看视频',
  vlc: '看视频',
  steam: '打游戏',
  photoshop: '修图',
  figma: '画图',
  obs64: '录屏',
  'obs studio': '录屏',
  everything: '找文件',
  '7zfm': '压缩包',
  taskmgr: '任务管理器',
};

/** 进程名 → 展示名（大小写不敏感；认不出 → 原样返回，不编造） */
export function appDisplayName(app: string | null): string | null {
  if (!app) return null;
  const key = app.trim().toLowerCase();
  return APP_NAMES[key] ?? app;
}

// ---------- 台词池（全部本地字面量：不联网、不调模型、零 token） ----------

/** 台词池（按情绪分档；每档都混了"报状况"和"俏皮安慰"两类，避免每次都是干巴巴的数字播报） */
export const STATUS_LINES: Readonly<Record<StatusMood, readonly string[]>> = {
  calm: [
    '一切正常，我就在旁边陪着你~',
    '电脑挺精神的，主人也精神吗？',
    '风平浪静，适合摸一会儿鱼',
    '状态不错，要不要来戳我一下',
    '安安静静的，我在这儿守着',
  ],
  focus: [
    '盯这么久了，眼睛要休息一下哦',
    '专注模式启动中，我不打扰你',
    '你好认真，我都不好意思闹你了',
    '这个界面你待好久了，进展顺利吗',
  ],
  hot: [
    '电脑有点喘不过气啦，要不要关掉几个网页',
    'CPU 快烧起来了，我先躲远点',
    '这么卡你还忍得住？我看着都急',
    '内存也快满了，去关点东西吧主人',
    '机器在冒烟啦，歇一会儿好不好',
  ],
  lowbattery: [
    '快没电啦，快去插上电源！',
    '电量告急，我还想多陪你一会儿呢',
    '要不要先充电？不然我们一会儿就要说再见了',
    '电只剩一点点了，主人注意一下呀',
  ],
  longwork: [
    '坐了这么久，起来动一动吧~',
    '该休息啦，喝口水好不好',
    '你已经连续工作好久了，我有点心疼',
    '站起来伸个懒腰，我在这儿等你',
    '脖子酸不酸？转一转吧',
  ],
  night: ['很晚了，该睡啦~', '深夜了，明天再继续好不好', '我要打瞌睡了，主人也早点休息', '再熬下去明天会很难受哦'],
  away: ['主人去哪儿啦？我一个人好无聊', '你不在，我就自己玩一会儿', '回来了记得叫我一声呀'],
};

/**
 * 采样 → 气泡行（纯函数，不碰 DOM/React）。行结构与余额气泡一致（复用同一套渲染）。
 * 拿不到的字段整行不出现：绝不显示"CPU 0%"这种假数字。
 *
 * 最后一行是**这个状况该说的一句俏皮话**（按情绪取池）——只报数字的桌宠是仪表盘，
 * 会"心疼你坐太久""催你去充电"的才是宠物。
 * @param opts.hour 当前小时（缺省由采样时间戳推出）：决定深夜档的判定
 * @param opts.prevLine 上一句台词（传进来可避开连续重复，与 life 的台词池同款用法）
 */
export function statusBubbleView(
  state: StatusState,
  opts?: { hour?: number; prevLine?: string },
): Array<{ role: 'label' | 'sub'; text: string }> {
  const s = state.sample;
  const rows: Array<{ role: 'label' | 'sub'; text: string }> = [];

  // 主行：机器压力（CPU / 内存）
  const parts: string[] = [];
  if (s.cpu !== null) parts.push(`CPU ${Math.round(s.cpu)}%`);
  if (s.memPct !== null) parts.push(`内存 ${Math.round(s.memPct)}%`);
  if (parts.length > 0) rows.push({ role: 'label', text: parts.join(' · ') });

  // 次行 1：人的状态（已工作 / 当前应用）
  const human: string[] = [];
  if (s.workMin !== null && s.workMin >= 1) human.push(`已工作 ${formatMinutes(s.workMin)}`);
  const app = appDisplayName(s.app);
  if (app) human.push(app + (s.appMin !== null && s.appMin >= 5 ? ` ${formatMinutes(s.appMin)}` : ''));
  if (human.length > 0) rows.push({ role: 'sub', text: human.join(' · ') });

  // 次行 2：电量（有电池才有这一行）
  if (s.battery !== null) {
    rows.push({ role: 'sub', text: `电量 ${Math.round(s.battery)}%${s.charging ? '（充电中）' : ''}` });
  }

  // 一行都没有（全部读不到）：显式说明，不显示空气泡（也不硬塞一句台词——没数据就别装作知道）
  if (rows.length === 0) return [{ role: 'label', text: '当前状况读取不到' }];

  // 收尾一句：按当前情绪取台词（深夜/电量/压力/久坐……各自有池）
  const hour = opts?.hour ?? new Date(s.ts > 0 ? s.ts : Date.now()).getHours();
  rows.push({ role: 'sub', text: statusLineOf(s, hour, opts?.prevLine) });
  return rows;
}
