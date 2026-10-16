/**
 * 「当前状况」单元测试（解析 / 情绪档位 / 格式化 / 气泡行 / 台词池）。
 *
 * 钉住的不变式：
 *   - 脏数据一律丢弃（非数字 → null），**绝不拿 0 冒充"读不到"**——显示 CPU 0% 是在骗人；
 *   - 情绪判定顺序即优先级（电量 > 机器压力 > 人不在 > 深夜 > 久坐 > 专注 > 如常）；
 *   - 档位索引与 events.status 数组长度一致（7 档），越界会让动画播不出来；
 *   - 气泡行只出现**读得到**的字段，全读不到时显式说明而不是空气泡；
 *   - 台词池每档非空，取句避开上一句。
 *
 * 跑法：node --experimental-strip-types --test src/shared/status.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  STATUS_LINES,
  STATUS_LEVEL,
  STATUS_THRESHOLD,
  appDisplayName,
  formatMinutes,
  isStatusQuietHour,
  statusBubbleView,
  statusLevelOf,
  statusLineOf,
  statusMoodOf,
  toStatusState,
  type StatusSample,
} from './status.ts';

/** 造一份采样（默认"什么都没有"；传入的字段覆盖） */
function sampleOf(over: Partial<StatusSample> = {}): StatusSample {
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
    ts: 1700000000000,
    ...over,
  };
}

describe('toStatusState —— 叶子解析（脏数据不进展示层）', () => {
  test('形状非法 → null（消费端跳过这一拍，不抛）', () => {
    assert.equal(toStatusState(null), null);
    assert.equal(toStatusState('x'), null);
    assert.equal(toStatusState({}), null);
  });

  test('没有 sample → null（空壳状态会把"没数据"说成"采集失败"，那是编造）', () => {
    assert.equal(toStatusState({ ok: true }), null);
    assert.equal(toStatusState({ sample: 'x' }), null);
  });

  test('字段逐个安全化：非数字 → null，绝不回落成 0', () => {
    const s = toStatusState({ ok: true, sample: { cpu: 'abc', memPct: NaN, battery: '80', ts: 1 } });
    assert.ok(s);
    assert.equal(s.sample.cpu, null);
    assert.equal(s.sample.memPct, null);
    assert.equal(s.sample.battery, 80); // 数字字符串可转
  });

  test('null 字段往返 JSON 后**仍是 null**（Number(null)=0 的坑：会显示成 CPU 0%）', () => {
    const raw = JSON.parse(JSON.stringify({ ok: true, sample: sampleOf({ memPct: 79 }) }));
    const s = toStatusState(raw);
    assert.equal(s?.sample.cpu, null, 'null 绝不能变成 0');
    assert.equal(s?.sample.battery, null);
    assert.equal(s?.sample.memPct, 79);
  });

  test('charging 只认严格 true；空 sample 也能解析（全 null）', () => {
    const s = toStatusState({ ok: true, sample: { charging: 1 } });
    assert.equal(s?.sample.charging, false);
    const empty = toStatusState({ ok: true, sample: {} });
    assert.equal(empty?.ok, true);
    assert.equal(empty?.sample.cpu, null);
  });
});

describe('statusMoodOf —— 情绪判定（判定顺序即优先级）', () => {
  test('一切如常 → calm', () => {
    assert.equal(statusMoodOf(sampleOf({ cpu: 12, memPct: 40 }), 14), 'calm');
  });

  test('电量告急（且没插电）压过一切', () => {
    const s = sampleOf({ battery: 15, charging: false, cpu: 99, workMin: 300 });
    assert.equal(statusMoodOf(s, 14), 'lowbattery');
  });

  test('插着电就不算告急（15% 但正在充电 → 按其它条件判）', () => {
    const s = sampleOf({ battery: 15, charging: true });
    assert.equal(statusMoodOf(s, 14), 'calm');
  });

  test('CPU 或内存任一超阈值 → hot', () => {
    assert.equal(statusMoodOf(sampleOf({ cpu: STATUS_THRESHOLD.cpuHot }), 14), 'hot');
    assert.equal(statusMoodOf(sampleOf({ memPct: STATUS_THRESHOLD.memHot }), 14), 'hot');
  });

  test('人不在 > 深夜（人都走了就别喊睡觉）', () => {
    const s = sampleOf({ awayMin: STATUS_THRESHOLD.awayLong });
    assert.equal(statusMoodOf(s, 23), 'away');
  });

  test('深夜 → night；久坐 → longwork；专注 → focus', () => {
    assert.equal(statusMoodOf(sampleOf(), 23), 'night');
    assert.equal(statusMoodOf(sampleOf(), 3), 'night');
    assert.equal(statusMoodOf(sampleOf({ workMin: STATUS_THRESHOLD.workLong }), 14), 'longwork');
    assert.equal(statusMoodOf(sampleOf({ appMin: STATUS_THRESHOLD.focusLong }), 14), 'focus');
  });
});

describe('statusLevelOf —— 动画档位（必须与 events.status 数组对齐）', () => {
  test('7 档全覆盖且与 STATUS_LEVEL 一致', () => {
    const levels = Object.values(STATUS_LEVEL);
    assert.equal(levels.length, 7);
    assert.deepEqual(
      [...levels].sort((a, b) => a - b),
      [0, 1, 2, 3, 4, 5, 6],
    );
    for (const [mood, idx] of Object.entries(STATUS_LEVEL)) {
      const s = sampleOf({ battery: 5 });
      assert.equal(typeof idx, 'number');
      assert.ok(idx >= 0 && idx <= 6, mood + ' 档位越界');
      assert.equal(statusLevelOf(s, 14), STATUS_LEVEL.lowbattery);
    }
  });

  test('quiet hour 边界：23 与 5 算深夜，6 点不算', () => {
    assert.equal(isStatusQuietHour(23), true);
    assert.equal(isStatusQuietHour(5), true);
    assert.equal(isStatusQuietHour(6), false);
    assert.equal(isStatusQuietHour(NaN), false); // 越界按非安静：宁可多说一句
  });
});

describe('formatMinutes —— 时长文案', () => {
  test('不到 1 分钟 / 分钟 / 小时 / 小时+分', () => {
    assert.equal(formatMinutes(0), '不到1分钟');
    assert.equal(formatMinutes(45), '45分钟');
    assert.equal(formatMinutes(60), '1小时');
    assert.equal(formatMinutes(80), '1小时20分');
  });

  test('null / 负数 → 「-」（不编造时长）', () => {
    assert.equal(formatMinutes(null), '-');
    assert.equal(formatMinutes(-5), '-');
  });
});

describe('appDisplayName —— 进程名 → 中文应用名', () => {
  test('认得出的进程名翻译，认不出的原样返回（不瞎猜）', () => {
    assert.equal(appDisplayName('Code'), '写代码');
    assert.equal(appDisplayName('chrome'), '浏览器');
    assert.equal(appDisplayName('SomeUnknownApp'), 'SomeUnknownApp');
    assert.equal(appDisplayName(null), null);
    assert.equal(appDisplayName(''), null);
  });
});

describe('statusBubbleView —— 气泡行', () => {
  test('只读得到的字段才出现（CPU 读不到就不显示 CPU 行）', () => {
    const rows = statusBubbleView({ ok: true, sample: sampleOf({ memPct: 61 }) }, { hour: 14 });
    const text = rows.map((r) => r.text).join(' | ');
    assert.ok(text.includes('内存 61%'));
    assert.ok(!text.includes('CPU'));
  });

  test('电量行带充电标记；无电池时整行不出现', () => {
    const withBat = statusBubbleView({ ok: true, sample: sampleOf({ battery: 82, charging: true }) }, { hour: 14 });
    assert.ok(withBat.some((r) => r.text.includes('电量 82%') && r.text.includes('充电中')));
    const noBat = statusBubbleView({ ok: true, sample: sampleOf({ cpu: 10 }) }, { hour: 14 });
    assert.ok(!noBat.some((r) => r.text.includes('电量')));
  });

  test('全读不到 → 显式说明，且**不硬塞台词**（没数据就别装作知道）', () => {
    const rows = statusBubbleView({ ok: true, sample: sampleOf() }, { hour: 14 });
    assert.deepEqual(rows, [{ role: 'label', text: '当前状况读取不到' }]);
  });

  test('有数据时收尾一句台词（来自当前情绪的池）', () => {
    const rows = statusBubbleView({ ok: true, sample: sampleOf({ cpu: 95 }) }, { hour: 14 });
    const last = rows[rows.length - 1];
    assert.equal(last.role, 'sub');
    assert.ok(STATUS_LINES.hot.includes(last.text));
  });
});

describe('statusLineOf —— 台词池', () => {
  test('每档非空，且取句避开上一句（池 > 1 句时）', () => {
    for (const [mood, pool] of Object.entries(STATUS_LINES)) {
      assert.ok(pool.length > 0, mood + ' 台词池为空');
    }
    const s = sampleOf({ cpu: 95 });
    const first = statusLineOf(s, 14);
    let same = 0;
    for (let i = 0; i < 20; i++) if (statusLineOf(s, 14, first) === first) same++;
    assert.ok(same < 20, '应当尽量避开上一句');
  });
});
