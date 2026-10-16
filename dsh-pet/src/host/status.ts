/**
 * host 侧「当前状况」采集（自包含，不 import src/shared —— DSH 单文件加载约束）。
 *
 * 定位：桌宠从"只会卖萌"变成"真的看得见你在过什么样的电脑生活"——它周期性（默认 60s，
 * 配置 eventsRefreshSec.status）读一次本机事实，写进 S 的 sections.status，两端按 counter
 * 变化渲染成气泡。全部数据来自本机 OS，**零 token**：不联网、不调模型。
 *
 * 采什么：
 *   - CPU / 内存：node:os 直接读（CPU 用两个时刻的 times 差分，不做 sleep——一次 tick 与
 *     下一次 tick 之间天然有几十秒间隔，差分就是"这段时间的平均占用"）；
 *   - 电量：Windows 用 Win32_Battery（PowerShell，非 Windows 直接 null 降级）；
 *   - 前台应用 + 用户空闲时长：一次 PowerShell 里用 user32 读（GetForegroundWindow +
 *     GetLastInputInfo），省得为两条数据起两个子进程。
 *
 * 派生出来的三个"人的状态"（本模块的核心价值，OS 不会直接告诉你）：
 *   - appMin  专注时长：同一个前台应用连续待了多久（切走即归零重算）；
 *   - workMin 连续工作时长：人还在（空闲 < AWAY_AFTER_MS）持续了多久；人一走就清零；
 *   - awayMin 离开时长：没人动键鼠多久了（走开超过阈值 → 宠物不再喊"该休息了"）。
 *
 * 为什么这些必须在 host 做而不是端上：浏览器端拿不到 CPU/电量，桌面端拿得到但只有它自己
 * 看得见——多端要显示同一份"当前状况"，数据就只能有一个出口（/state），与余额/工作状态
 * 同一套架构。
 *
 * 不用 class：本仓库 tsconfig 开了 useDefineForClassFields，类字段会被打包器降级成
 * @oxc-project/runtime 帮助模块 → 运行时 UNRESOLVED_IMPORT。一律工厂函数。
 */

import { spawn } from 'node:child_process';
import { cpus, freemem, platform, totalmem, uptime } from 'node:os';

/** 一次本机采样（全是可空字段：拿不到就 null，展示层跳过那一行，绝不编数字） */
export interface StatusSample {
  /** CPU 占用百分比（0–100，一位小数；首次采样无基线 → null） */
  cpu: number | null;
  /** 内存占用百分比（0–100） */
  memPct: number | null;
  /** 已用内存 GB（一位小数） */
  memUsedGb: number | null;
  /** 总内存 GB（一位小数） */
  memTotalGb: number | null;
  /** 电量百分比（0–100）；无电池 / 读不到 → null */
  battery: number | null;
  /** 是否插着电源（无电池信息时=false） */
  charging: boolean;
  /** 前台应用进程名（如 `Code`、`chrome`）；读不到 → null */
  app: string | null;
  /** 当前前台应用连续停留分钟数（刚切换 = 0） */
  appMin: number | null;
  /** 连续工作分钟数（人还在 → 持续累加；人走开 → 归零） */
  workMin: number | null;
  /** 离开分钟数（没人动键鼠多久了；<1 分钟按 0 算） */
  awayMin: number | null;
  /** 系统已运行分钟数（开机多久了） */
  uptimeMin: number | null;
  /** 采样时间戳 */
  ts: number;
}

/** /state 里 sections.status 的载荷 */
export interface StatusSnapshot {
  ok: boolean;
  sample: StatusSample;
}

/** 空采样（拿不到任何数据时的兜底：ok=false，字段全空，展示层显式说明而不是显示 0） */
export function emptyStatusSample(now = Date.now()): StatusSample {
  return {
    cpu: null,
    memPct: null,
    memUsedGb: null,
    memTotalGb: null,
    battery: null,
    charging: false,
    app: null,
    appMin: null,
    workMin: null,
    awayMin: null,
    uptimeMin: null,
    ts: now,
  };
}

/** 空闲超过这个时长算"人走了"（5 分钟：够长，不至于看一眼手机就被判离席） */
export const AWAY_AFTER_MS = 5 * 60 * 1000;

/**
 * 数值安全化：null/undefined/空串 → null，非有限数 → null（脏数据不进展示层，与 balance 同口径）。
 * null 必须显式挡在 Number() 之前——`Number(null) === 0`，漏判就会把"读不到"变成 0。
 */
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 一位小数（展示用，避免 63.33333333 这种长尾） */
function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/** CPU 快照：所有核的 idle 与 total 之和（user+nice+sys+idle+irq） */
function cpuTimes(): { idle: number; total: number } {
  let idle = 0;
  let total = 0;
  for (const c of cpus()) {
    idle += c.times.idle;
    total += c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq;
  }
  return { idle, total };
}

/**
 * 两次 CPU 快照 → 这段时间的平均占用百分比。
 * 首次（无 prev）返回 null：宁可这一拍不显示 CPU，也不要编一个 0 —— 0% 会被读成"电脑很闲"。
 */
export function cpuPercent(
  prev: { idle: number; total: number } | null,
  next: { idle: number; total: number },
): number | null {
  if (!prev) return null;
  const dTotal = next.total - prev.total;
  const dIdle = next.idle - prev.idle;
  if (dTotal <= 0) return null;
  const busy = dTotal - dIdle;
  return round1(Math.min(100, Math.max(0, (busy / dTotal) * 100)));
}

/** 内存采样（GB 用 1024 进制：与 Windows 任务管理器一致，用户不会觉得数字对不上） */
export function memSample(): { memPct: number; memUsedGb: number; memTotalGb: number } | null {
  const total = totalmem();
  const free = freemem();
  if (!Number.isFinite(total) || total <= 0) return null;
  const used = Math.max(0, total - free);
  return {
    memPct: round1((used / total) * 100),
    memUsedGb: round1(used / 1024 ** 3),
    memTotalGb: round1(total / 1024 ** 3),
  };
}

/** Windows 侧一次 PowerShell 拿回的三件事 */
export interface WindowsProbe {
  /** 前台应用进程名（读不到 → null） */
  app: string | null;
  /** 用户空闲毫秒数（读不到 → null） */
  idleMs: number | null;
  /** 电量百分比（无电池 → null） */
  battery: number | null;
  /** 是否插着电源 */
  charging: boolean;
}

/**
 * Windows 探针的 PowerShell（一次进程取回前台应用 + 空闲时长 + 电量）。
 *
 * 为什么是 PowerShell 而不是 native 模块：桌宠不能为这点信息引入编译依赖（用户机器上没有
 * 构建工具链），而 user32 的 GetLastInputInfo 是"人到底还在不在"的唯一低成本可靠来源——
 * 前台窗口不动也可能是人在看文档不动鼠标，但键鼠空闲时长不会骗人。
 * 读不到（无 PowerShell / 非 Windows / 权限）→ 返回空探针，展示层少几行，不影响其它功能。
 */
const PS_PROBE = [
  // user32：前台窗口 + 最后输入时间（后者用于判"人在不在"）
  "Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;using System.Text;" +
    'public class W32{' +
    '[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();' +
    '[DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);' +
    '[DllImport("user32.dll",CharSet=CharSet.Auto)]public static extern int GetWindowText(IntPtr h,StringBuilder sb,int max);' +
    'public struct LASTINPUTINFO{public uint cbSize;public uint dwTime;}' +
    '[DllImport("user32.dll")]public static extern bool GetLastInputInfo(ref LASTINPUTINFO li);}\'',
  '$r=@{}',
  '$h=[W32]::GetForegroundWindow()',
  'if($h -ne [IntPtr]::Zero){$pid2=0;[void][W32]::GetWindowThreadProcessId($h,[ref]$pid2);' +
    'try{$r.proc=(Get-Process -Id $pid2 -ErrorAction Stop).ProcessName}catch{$r.proc=""};' +
    '$sb=New-Object System.Text.StringBuilder 256;[void][W32]::GetWindowText($h,$sb,256);$r.title=$sb.ToString()}',
  '$li=New-Object W32+LASTINPUTINFO;$li.cbSize=[System.Runtime.InteropServices.Marshal]::SizeOf($li)',
  'if([W32]::GetLastInputInfo([ref]$li)){$r.idle=[Environment]::TickCount-[int]$li.dwTime}',
  '$b=Get-CimInstance -ClassName Win32_Battery -ErrorAction SilentlyContinue|Select-Object -First 1',
  'if($b){$r.bat=[int]$b.EstimatedChargeRemaining;$r.ac=[int]$b.BatteryStatus}',
  '[Console]::Out.WriteLine(($r|ConvertTo-Json -Compress))',
].join('\n');

/** 探针超时（ms）：PowerShell 冷启动 + CIM 查询偶发 2s+，卡死不让宿主等 */
const PROBE_TIMEOUT_MS = 5000;

/**
 * 跑一次 Windows 探针。非 Windows / 失败 / 超时 → 空探针（静默降级，不抛）。
 * 返回的 Promise 永不 reject：采集失败不该影响周期定时器下一次 tick。
 */
export function probeWindows(timeoutMs = PROBE_TIMEOUT_MS): Promise<WindowsProbe> {
  const empty: WindowsProbe = { app: null, idleMs: null, battery: null, charging: false };
  if (platform() !== 'win32') return Promise.resolve(empty);
  return new Promise((resolve) => {
    let done = false;
    const finish = (p: WindowsProbe): void => {
      if (done) return;
      done = true;
      resolve(p);
    };
    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS_PROBE], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      finish(empty);
      return;
    }
    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        /* 已退出 */
      }
      finish(empty);
    }, timeoutMs);
    let out = '';
    proc.stdout?.setEncoding('utf8');
    proc.stdout?.on('data', (c: string) => {
      out += c;
    });
    proc.on('error', () => {
      clearTimeout(timer);
      finish(empty);
    });
    proc.on('close', () => {
      clearTimeout(timer);
      finish(parseProbe(out));
    });
  });
}

/** 探针输出 → WindowsProbe（JSON 里字段可能缺失/类型不对，逐个安全化） */
export function parseProbe(out: string): WindowsProbe {
  const empty: WindowsProbe = { app: null, idleMs: null, battery: null, charging: false };
  const line = String(out ?? '')
    .split('\n')
    .map((s) => s.trim())
    .find((s) => s.startsWith('{'));
  if (!line) return empty;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return empty;
  }
  const appRaw = typeof raw.proc === 'string' ? raw.proc.trim() : '';
  const idle = num(raw.idle);
  const bat = num(raw.bat);
  const ac = num(raw.ac);
  return {
    app: appRaw.length > 0 ? appRaw : null,
    // TickCount 是 uint32，回绕/乱序可能算出负数 → 夹到 0
    idleMs: idle === null ? null : Math.max(0, idle),
    battery: bat === null ? null : Math.min(100, Math.max(0, bat)),
    // BatteryStatus：1=放电，其余（2=AC/充电/充满/未知）都按"插着电"处理
    charging: ac !== null && ac !== 1,
  };
}

/**
 * 状态跟踪器（工厂函数，不用 class）：跨 tick 记住「上一个前台应用」「连续工作起点」
 * 「CPU 差分基线」，把一次次的原始采样变成"人在过什么样的生活"。
 *
 * tick() 是唯一的入口：每拍读一次 OS + Windows 探针，返回一份可直接写进 /state 的快照。
 */
export function createStatusTracker() {
  let cpuBase: { idle: number; total: number } | null = null;
  let lastApp: string | null = null;
  let appSince = 0;
  let workSince = 0;
  let awaySince = 0;

  /**
   * 采一次。now 只由调用方传（测试里能钉死时间轴）。
   * 探针是异步的，所以 tick 返回 Promise——周期定时器 await 它再写 S。
   */
  const tick = async (now = Date.now()): Promise<StatusSample> => {
    const nextCpu = cpuTimes();
    const cpu = cpuPercent(cpuBase, nextCpu);
    cpuBase = nextCpu;

    const mem = memSample();
    const probe = await probeWindows();

    // 专注时长：前台应用没变 → 累加；变了（含从"读不到"变出来）→ 从这一拍重新起算
    const app = probe.app ?? null;
    if (app !== lastApp) {
      lastApp = app;
      appSince = now;
    }
    // 人在不在：键鼠空闲超过 AWAY_AFTER_MS 就算走了
    const idleMs = probe.idleMs;
    const away = idleMs !== null && idleMs >= AWAY_AFTER_MS;
    if (away) {
      if (awaySince === 0) awaySince = now - Math.min(idleMs ?? 0, now);
      workSince = 0; // 人走了，连续工作时长清零（回来重新算）
    } else {
      awaySince = 0;
      if (workSince === 0) workSince = now;
    }

    const mins = (since: number): number | null => (since > 0 ? Math.max(0, Math.round((now - since) / 60000)) : null);
    const upMin = uptime();
    return {
      cpu,
      memPct: mem?.memPct ?? null,
      memUsedGb: mem?.memUsedGb ?? null,
      memTotalGb: mem?.memTotalGb ?? null,
      battery: probe.battery,
      charging: probe.charging,
      app,
      appMin: mins(appSince),
      workMin: mins(workSince),
      awayMin: awaySince > 0 ? mins(awaySince) : 0,
      uptimeMin: Number.isFinite(upMin) ? Math.max(0, Math.round(upMin / 60)) : null,
      ts: now,
    };
  };

  return { tick };
}
