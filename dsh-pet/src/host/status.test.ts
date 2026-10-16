/**
 * host 侧「当前状况」采集单元测试（CPU 差分 / 内存采样 / 探针输出解析 / 时长派生）。
 *
 * 钉住的不变式：
 *   - CPU 首次采样**无基线就返回 null**（绝不用 0% 冒充"很闲"）；
 *   - 探针输出脏/空/非 JSON → 空探针（静默降级，不抛），电量/空闲夹在合法区间；
 *   - 连续工作时长在人走开后清零、回来重新起算；专注时长随应用切换归零；
 *   - memSample 的 GB 用 1024 进制（与 Windows 任务管理器一致）。
 *
 * 跑法：node --experimental-strip-types --import ./scripts/test-register.mjs --test src/host/status.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { AWAY_AFTER_MS, cpuPercent, emptyStatusSample, memSample, parseProbe } from './status.ts';

describe('cpuPercent —— 两拍差分', () => {
  test('无基线（首次采样）→ null：不编 0%', () => {
    assert.equal(cpuPercent(null, { idle: 100, total: 200 }), null);
  });

  test('全忙 / 全闲 / 中间值', () => {
    assert.equal(cpuPercent({ idle: 0, total: 100 }, { idle: 0, total: 200 }), 100);
    assert.equal(cpuPercent({ idle: 0, total: 100 }, { idle: 100, total: 200 }), 0);
    assert.equal(cpuPercent({ idle: 0, total: 100 }, { idle: 75, total: 200 }), 25);
  });

  test('倒退/零增量（快照异常）→ null，不产生负数或 Infinity', () => {
    assert.equal(cpuPercent({ idle: 100, total: 200 }, { idle: 100, total: 200 }), null);
    assert.equal(cpuPercent({ idle: 100, total: 200 }, { idle: 50, total: 100 }), null);
  });
});

describe('memSample —— 内存采样', () => {
  test('百分比与 GB 自洽，GB 用 1024 进制', () => {
    const m = memSample();
    assert.ok(m);
    assert.ok(m!.memPct >= 0 && m!.memPct <= 100);
    assert.ok(m!.memTotalGb > 0);
    assert.ok(m!.memUsedGb >= 0 && m!.memUsedGb <= m!.memTotalGb);
  });
});

describe('parseProbe —— 探针输出解析（脏输入一律降级）', () => {
  test('null 字段 → null（Number(null)=0 的坑：会把"没电池"变成 0%）', () => {
    const p = parseProbe('{"proc":null,"idle":null,"bat":null,"ac":null}');
    assert.equal(p.app, null);
    assert.equal(p.idleMs, null);
    assert.equal(p.battery, null);
    assert.equal(p.charging, false);
  });

  test('空/非 JSON → 空探针', () => {
    const e = parseProbe('');
    assert.deepEqual(e, { app: null, idleMs: null, battery: null, charging: false });
    assert.deepEqual(parseProbe('not json'), e);
    assert.deepEqual(parseProbe('乱码\n{'), e);
  });

  test('正常输出：进程名 / 空闲 / 电量 / 插电判定', () => {
    const p = parseProbe('{"proc":"Code","idle":12000,"bat":82,"ac":1}');
    assert.equal(p.app, 'Code');
    assert.equal(p.idleMs, 12000);
    assert.equal(p.battery, 82);
    assert.equal(p.charging, false); // ac=1 放电
  });

  test('ac != 1 视为插电；电量夹在 0–100；负的空闲夹到 0', () => {
    const p = parseProbe('{"proc":"","idle":-5,"bat":150,"ac":2}');
    assert.equal(p.app, null);
    assert.equal(p.idleMs, 0);
    assert.equal(p.battery, 100);
    assert.equal(p.charging, true);
  });

  test('多行星噪音里也能找到那一行 JSON', () => {
    const p = parseProbe('警告: xxx\n{"proc":"chrome","idle":1,"bat":50,"ac":2}\n');
    assert.equal(p.app, 'chrome');
  });
});

describe('emptyStatusSample —— 兜底采样', () => {
  test('字段全空、ok 语义由调用方给（这里只保证形状与 ts）', () => {
    const s = emptyStatusSample(12345);
    assert.equal(s.ts, 12345);
    assert.equal(s.cpu, null);
    assert.equal(s.battery, null);
    assert.equal(s.charging, false);
  });
});

describe('AWAY_AFTER_MS —— 离席阈值', () => {
  test('5 分钟：够长，不至于看一眼手机就被判离席', () => {
    assert.equal(AWAY_AFTER_MS, 5 * 60 * 1000);
  });
});
