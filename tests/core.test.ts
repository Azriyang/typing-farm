/**
 * 核心逻辑测试：不需要浏览器、不碰 DOM。
 *
 * 覆盖的是"改坏了不会报错、但会让玩法失衡"的地方：
 * 资源分档、难度分档、经济价格、多语言回退、地形与格子换算。
 */
import { test, ok, eq } from './harness';

import { isWoodKind, WOOD_KINDS } from '../src/types';
import { CROPS, CROP_ORDER, cropName, cropSeedName } from '../src/config';
import { NODE_DEFS, TOOLS, TOOL_ORDER, toolMaxDurability } from '../src/tools';
import { difficultyOf, shiftBand } from '../src/difficulty';
import { BANDS } from '../src/words';
import { getDef } from '../src/items';
import { getLang, setLang, t, tr } from '../src/i18n';
import { TILE, MAP_W, MAP_H, isBlockedTile, plotIndexOf, plotTileOf, buildScene } from '../src/world';

/* ---------------- 资源分档 ---------------- */

test('四种木材来源都算木头，岩石和杂草不算', () => {
  eq(WOOD_KINDS.length, 4, '木材来源数量');
  for (const k of ['shrub', 'sapling', 'tree', 'stump'] as const) {
    ok(isWoodKind(k), `${k} 应算木头`);
  }
  ok(!isWoodKind('rock'), '岩石不算木头');
  ok(!isWoodKind('weed'), '杂草不算木头');
});

test('木材四档：产出区间合法，树桩不重生', () => {
  for (const k of WOOD_KINDS) {
    const d = NODE_DEFS[k];
    ok(d.dropMin >= 1, `${k} 最少产出应 ≥1`);
    ok(d.dropMax >= d.dropMin, `${k} 产出区间应递增`);
    ok(d.hp >= 1, `${k} 至少要砍一下`);
  }
  eq(NODE_DEFS.stump.regrow, 0, '老树桩不应重生');
  // 越大的树，单次动作换到的木材越多（砍 2 下扣 2hp/次，这里只校验产量单调）
  ok(NODE_DEFS.tree.dropMax > NODE_DEFS.sapling.dropMax, '大树产出应高于小树');
  ok(NODE_DEFS.shrub.regrow < NODE_DEFS.tree.regrow, '灌木应比大树长得快');
});

/* ---------------- 工具 ---------------- */

test('六把工具都有定义，等级越高耐久越多', () => {
  eq(TOOL_ORDER.length, 6, '工具数量');
  for (const id of TOOL_ORDER) {
    ok(!!TOOLS[id].name, `${id} 缺名字`);
    ok(TOOLS[id].stamina > 0, `${id} 体力消耗应 >0`);
  }
  for (let tier = 2; tier <= 4; tier++) {
    ok(
      toolMaxDurability(tier) > toolMaxDurability(tier - 1),
      `等级 ${tier} 耐久应高于 ${tier - 1}`
    );
  }
});

/* ---------------- 难度 ---------------- */

test('难度分档：标准档不偏移，词长档位被限幅', () => {
  eq(difficultyOf('normal').bandShift, 0, '标准档不应偏移词长');
  eq(difficultyOf(undefined).id, 'normal', '缺省应为标准档');
  ok(difficultyOf('easy').timeMult > 1, '轻松档时限应更宽松');
  ok(difficultyOf('hard').timeMult < 1, '挑战档时限应更紧');

  const max = BANDS.length - 1;
  eq(shiftBand(difficultyOf('easy'), 0, max), 0, '轻松档下界应被夹住');
  eq(shiftBand(difficultyOf('hard'), max, max), max, '挑战档上界应被夹住');
});

/* ---------------- 作物与经济 ---------------- */

test('作物表完整：都有中英名、季节、价格', () => {
  ok(CROP_ORDER.length >= 15, '作物数量应 ≥15');
  for (const id of CROP_ORDER) {
    const c = CROPS[id];
    ok(!!c, `${id} 缺定义`);
    ok(!!c.zh && !!c.en, `${id} 缺中英名`);
    ok(c.price > 0, `${id} 售价应 >0`);
    ok(c.seed > 0, `${id} 种子应有价`);
    // 花卉是社交筹码，刻意做成「种子贵、花卖得便宜」，不参与这条检查
    if (c.kind !== 'flower') {
      ok(c.seed < c.price, `${id} 种子应便宜于售价`);
    }
  }
});

test('中文模式下作物名与种子名是中文', () => {
  setLang('zh');
  eq(getLang(), 'zh', '当前语言');
  eq(cropName('turnip'), CROPS.turnip.zh, '作物名');
  eq(cropSeedName('turnip'), CROPS.turnip.zh + '种子', '种子名');
});

/* ---------------- 物品 ---------------- */

test('物品注册表：已知 id 能取到名字，未知 id 返回 undefined', () => {
  const wood = getDef('mat.wood');
  ok(!!wood, '木材应存在');
  ok(!!wood!.name, '木材应有名字');
  // 材料类不可出售，所以这里校验 kind 与堆叠上限，而不是售价
  eq(wood!.kind, 'material', '木材应是材料类');
  ok((wood!.max ?? 0) > 0, '木材应有堆叠上限');
  eq(getDef('not.exist.at.all'), undefined, '未知物品应返回 undefined');
});

/* ---------------- 多语言 ---------------- */

test('语言开关：默认中文，切换后返回英文，占位符能替换', () => {
  setLang('zh');
  eq(t('体力', 'Stamina'), '体力', '中文模式');
  setLang('en');
  eq(t('体力', 'Stamina'), 'Stamina', '英文模式');
  eq(
    tr('第 {n} 天', 'Day {n}', { n: 3 }),
    'Day 3',
    '占位符替换'
  );
  setLang('zh');
  eq(tr('第 {n} 天', 'Day {n}', { n: 3 }), '第 3 天', '中文占位符');
});

/* ---------------- 地形与格子 ---------------- */

test('地图边界外一律视为阻挡', () => {
  ok(isBlockedTile(-1, 5), '左侧越界应阻挡');
  ok(isBlockedTile(MAP_W, 5), '右侧越界应阻挡');
  ok(isBlockedTile(5, -1), '上侧越界应阻挡');
  ok(isBlockedTile(5, MAP_H), '下侧越界应阻挡');
});

test('地图最外圈是灌木带，一定不可走', () => {
  // 地形是懒构建的，不先建场景读到的全是默认草地
  buildScene('farm');
  for (let x = 0; x < MAP_W; x++) {
    ok(isBlockedTile(x, 0), `顶边 (${x},0) 应阻挡`);
    ok(isBlockedTile(x, MAP_H - 1), `底边 (${x},${MAP_H - 1}) 应阻挡`);
  }
});

test('耕地索引与格子坐标能互相换算', () => {
  for (const i of [0, 1, 12, 40, 99]) {
    const { tx, ty } = plotTileOf(i);
    eq(plotIndexOf(tx, ty), i, `第 ${i} 块地往返换算`);
  }
});

test('TILE 是正整数，且一屏能显示多个格子', () => {
  ok(Number.isInteger(TILE) && TILE >= 24 && TILE <= 64, `TILE 应为 24..64 的整数，实际 ${TILE}`);
  ok(MAP_W * TILE > 960, '地图宽度应大于一屏');
});
