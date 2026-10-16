/**
 * 宠物的"活生生"行为单元测试（时段 / 安静时段 / 连击情绪 / 缺席判定 / 台词池）。
 *
 * 钉住的不变式：
 *   - 时段表与 host 的 time-context.ts 同口径（0–23 全覆盖、不重叠）；
 *   - 安静时段（23:00–05:59）不主动开口、间隔拉长——深夜话痨比不说话更烦人；
 *   - 连击过窗归零重算（戳一下歇三分钟不算连击）；情绪档只升不降地按次数映射；
 *   - 缺席先重逢后求关注（间隔越长档位越高），安静时段一律不主动；
 *   - 台词池非空、取句避开上一句、桌面端原有 19 句俏皮话一句不丢。
 *
 * 跑法：node --experimental-strip-types --test src/shared/life.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  BORED_AFTER_MS,
  BORED_LINES,
  CLICK_COMBO_WINDOW_MS,
  CLICK_LINES,
  MORNING_LINES,
  NIGHT_LINES,
  QUIET_DELAY_SCALE,
  REUNION_AFTER_MS,
  REUNION_LINES,
  absenceLineFor,
  absenceMoodOf,
  clickLineFor,
  clickMoodOf,
  dayPhaseOf,
  isQuietHour,
  lifeDelay,
  morningLineFor,
  nextClickCombo,
  nightLineFor,
  type ClickMood,
} from './life.ts';

describe('dayPhaseOf —— 小时 → 时段（与 host time-context 同口径）', () => {
  test('0–23 全覆盖、不重叠、逐档钉死', () => {
    const expected: Record<number, string> = {
      0: '凌晨',
      1: '凌晨',
      2: '凌晨',
      3: '凌晨',
      4: '凌晨',
      5: '清晨',
      6: '清晨',
      7: '早上',
      8: '早上',
      9: '上午',
      10: '上午',
      11: '中午',
      12: '中午',
      13: '下午',
      14: '下午',
      15: '下午',
      16: '下午',
      17: '傍晚',
      18: '傍晚',
      19: '晚上',
      20: '晚上',
      21: '晚上',
      22: '晚上',
      23: '深夜',
    };
    for (let h = 0; h < 24; h++) {
      assert.equal(dayPhaseOf(h), expected[h], `hour=${h}`);
    }
  });

  test('异常输入不抛，落凌晨兜底（提示词/行为路径都不能因为时间失败）', () => {
    assert.equal(dayPhaseOf(Number.NaN), '凌晨');
  });
});

describe('安静时段（isQuietHour）', () => {
  test('23:00–05:59 为安静，6 点整恢复精神', () => {
    for (const h of [23, 0, 1, 2, 3, 4, 5]) assert.equal(isQuietHour(h), true, `hour=${h} 应安静`);
    for (const h of [6, 12, 18, 22]) assert.equal(isQuietHour(h), false, `hour=${h} 应清醒`);
  });

  test('NaN 按非安静：宁可多说一句，也不要永久静音', () => {
    assert.equal(isQuietHour(Number.NaN), false);
  });

  test('lifeDelay：安静时段间隔拉长，白天原样', () => {
    const base = 60_000;
    assert.equal(lifeDelay(base, 23), base * QUIET_DELAY_SCALE);
    assert.equal(lifeDelay(base, 2), base * QUIET_DELAY_SCALE);
    assert.equal(lifeDelay(base, 6), base);
    assert.equal(lifeDelay(base, 15), base);
  });
});

describe('clickMoodOf —— 连击次数 → 情绪档', () => {
  test('档位边界逐个钉死', () => {
    const table: Array<[number, ClickMood]> = [
      [1, 'playful'],
      [2, 'playful'],
      [3, 'ticklish'],
      [4, 'ticklish'],
      [5, 'annoyed'],
      [6, 'annoyed'],
      [7, 'angry'],
      [9, 'angry'],
      [10, 'pleading'],
      [99, 'pleading'],
    ];
    for (const [n, mood] of table) assert.equal(clickMoodOf(n), mood, `combo=${n}`);
  });

  test('非正数/NaN 按第一次算：第一次点击永远是俏皮', () => {
    assert.equal(clickMoodOf(0), 'playful');
    assert.equal(clickMoodOf(-5), 'playful');
    assert.equal(clickMoodOf(Number.NaN), 'playful');
  });
});

describe('nextClickCombo —— 连击状态机', () => {
  const t0 = 1_000_000;

  test('无历史 → 新连击第一次（俏皮）', () => {
    const s = nextClickCombo(null, t0);
    assert.deepEqual(s, { count: 1, at: t0, mood: 'playful' });
  });

  test('窗口内连续点击：计数递增、情绪跟着升档', () => {
    let s = nextClickCombo(null, t0);
    for (let i = 2; i <= 7; i++) s = nextClickCombo(s, t0 + (i - 1) * 1000);
    assert.equal(s.count, 7);
    assert.equal(s.mood, 'angry');
  });

  test('过窗再点 → 归 1 重新起连（戳一下歇三分钟不算连击）', () => {
    const s = nextClickCombo({ count: 9, at: t0, mood: 'angry' }, t0 + CLICK_COMBO_WINDOW_MS + 1);
    assert.equal(s.count, 1);
    assert.equal(s.mood, 'playful');
  });

  test('恰好等于窗口宽度仍算连击（边界含端点）', () => {
    const s = nextClickCombo({ count: 9, at: t0, mood: 'angry' }, t0 + CLICK_COMBO_WINDOW_MS);
    assert.equal(s.count, 10);
    assert.equal(s.mood, 'pleading');
  });
});

describe('absenceMoodOf —— 缺席判定', () => {
  const noon = 12;

  test('间隔不够 → 不开口', () => {
    assert.equal(absenceMoodOf(0, noon), null);
    assert.equal(absenceMoodOf(BORED_AFTER_MS - 1, noon), null);
  });

  test('先求关注、后重逢（间隔越长档位越高）', () => {
    assert.equal(absenceMoodOf(BORED_AFTER_MS, noon), 'bored');
    assert.equal(absenceMoodOf(REUNION_AFTER_MS - 1, noon), 'bored');
    assert.equal(absenceMoodOf(REUNION_AFTER_MS, noon), 'reunion');
    assert.equal(absenceMoodOf(10 * 3_600_000, noon), 'reunion');
  });

  test('安静时段一律不主动撒娇（顶多它自己困了时说一句）', () => {
    assert.equal(absenceMoodOf(10 * 3_600_000, 23), null);
    assert.equal(absenceMoodOf(10 * 3_600_000, 3), null);
  });

  test('异常间隔 → 不开口', () => {
    assert.equal(absenceMoodOf(-1, noon), null);
    assert.equal(absenceMoodOf(Number.NaN, noon), null);
  });
});

describe('台词池', () => {
  test('四个池都非空、句句非空白', () => {
    for (const [name, pool] of [
      ['NIGHT_LINES', NIGHT_LINES],
      ['MORNING_LINES', MORNING_LINES],
      ['BORED_LINES', BORED_LINES],
      ['REUNION_LINES', REUNION_LINES],
    ] as const) {
      assert.ok(pool.length > 0, name + ' 不能空');
      for (const line of pool) assert.ok(line.trim().length > 0, name + ' 有空句');
    }
  });

  test('点击池覆盖全部 5 个情绪档，且每档至少 3 句（避开上一句时才不会露底）', () => {
    for (const mood of ['playful', 'ticklish', 'annoyed', 'angry', 'pleading'] as ClickMood[]) {
      assert.ok(CLICK_LINES[mood].length >= 3, mood + ' 档句数不足');
    }
  });

  test('桌面端原有 18 句俏皮话一句不丢（搬迁进分档池时的回归护栏）', () => {
    const original = [
      '嘿嘿，被我抓到啦！',
      '摸我干嘛呀～痒痒的～',
      '主人又来逗我玩啦？',
      '啪！吓你一跳！',
      '我可不是好惹的哦～',
      '再摸我可就咬你啦！',
      '你是不是偷偷喜欢我呀～',
      '诶嘿，你上当啦！',
      '哇！有没有吓到？',
      '本宠物今天心情好，饶了你～',
      '别戳啦，小心我挠你痒痒！',
      '这手感不错吧？嘿嘿～',
      '再摸一下，我就唱首歌（五音不全那种）～',
      '嘘——我假装在睡觉，别吵～',
      '哈！你被我的可爱迷住了吧？',
      '要不要我表演个原地消失？（并不）',
      '略略略，够不着我～',
      '主人手闲不下来是不是～',
    ];
    assert.equal(original.length, 18, '原池就是 18 句（改这个数字前先回去数一遍 sprite.js）');
    const all = Object.values(CLICK_LINES).flat();
    for (const line of original) assert.ok(all.includes(line), '丢了：' + line);
  });
});

describe('取句函数', () => {
  test('clickLineFor：落在对应情绪档的池内', () => {
    const line = clickLineFor('angry');
    assert.ok(CLICK_LINES.angry.includes(line));
  });

  test('避开上一句（池大于 1 时不得连续重复）', () => {
    const first = clickLineFor('ticklish');
    let changed = false;
    for (let i = 0; i < 30 && !changed; i++) {
      if (clickLineFor('ticklish', first) !== first) changed = true;
    }
    assert.ok(changed, '30 次内应出现与上一句不同的句子');
  });

  test('其余取句函数都从各自池出', () => {
    assert.ok(NIGHT_LINES.includes(nightLineFor()));
    assert.ok(MORNING_LINES.includes(morningLineFor()));
    assert.ok(BORED_LINES.includes(absenceLineFor('bored')));
    assert.ok(REUNION_LINES.includes(absenceLineFor('reunion')));
  });
});
