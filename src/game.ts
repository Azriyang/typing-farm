/* ============================================================
   game.ts — 主循环、交互、背包、工具、农作、经济、存档
   ============================================================ */

import { CFG, CROPS, CROP_ORDER } from './config';
import { storage } from './platform';
import { Sound } from './audio';
import { TypingSession } from './typing';
import { initRenderer, render, burst, floatText, debugCamera, debugSampleBase, applySeason } from './render';
import * as UI from './ui';
import {
  seasonOfDay, rollWeather, weatherWaters, growthMultiplier, isInSeason,
  SEASON_LABEL, SEASON_ICON
} from './seasons';
import {
  buildMap, facingTile, plotTileOf, canStand, setNodeBlock, TILE, PLOT_COUNT,
  TREE_SPOTS, ROCK_SPOTS, isOpenGround, MAP_W, MAP_H, plotIndexOf, inAnimalArea
} from './world';
import {
  resolveTarget, heldTool, hotbarSlotOfTool, heldSeedId, ActionInfo
} from './action';
import {
  TOOLS, NODE_DEFS, tierInfo, upgradeMaterial, multiTarget, hitCount,
  dropMultiplier, repeatCount, biteWindow, BITE_DELAY
} from './tools';
import {
  ANIMAL_DEFS, ANIMAL_ORDER, createAnimal, updateAnimals, animalNear,
  animalById, happinessQuality, settleAnimalsOvernight
} from './animals';
import * as Bag from './items';
import { getDef, pickFish, sellPrice, isSellable } from './items';
import type { FishDef } from './items';
import {
  makeWord, makeWords, bandForValue, getCustomSets, upsertCustom, removeCustom,
  toggleCustom, normalizeWords, totalWords, CATEGORY_LABEL, BANDS, bandStats, distribution
} from './words';
import type { WordCategory, CustomSet } from './words';
import type {
  GameState, Plot, CropId, Word, ToolId, ResNode, ItemStack, HotbarRef, NodeKind,
  Animal, AnimalKind
} from './types';

/* ---------------- 运行时 ---------------- */

let state: GameState;
let running = false;
let lastTs = 0;
const keys = new Set<string>();

interface Pending {
  kind: ActionInfo['kind'] | 'fishCast' | 'fishReel' | 'feed' | 'collect' | 'milk' | 'pet';
  tool: ToolId | null;
  plots: number[];
  nodeKey: string | null;
  crop?: CropId;
  animalId?: string;
  stamina: number;
  time: number;
  label: string;
}

let pending: Pending | null = null;
let currentLabel = '走近田地，按空格开始劳作';

/* ---------------- 钓鱼状态 ---------------- */

interface FishingState {
  phase: 'idle' | 'wait' | 'bite' | 'reel';
  biteAt: number;
  biteEnd: number;
  window: number;
  fish: FishDef | null;
  tier: number;
  quality: number;
}

const fishing: FishingState = {
  phase: 'idle', biteAt: 0, biteEnd: 0, window: 0, fish: null, tier: 1, quality: 1
};

/* ---------------- 打字会话 ---------------- */

const session = new TypingSession({
  onKey: (ok) => {
    if (ok) {
      Sound.play('key');
    } else {
      Sound.play('error');
      UI.flashError();
      state.combo = 0;
    }
  },
  onComplete: (r) => {
    const p = pending;
    pending = null;
    if (!p) return;

    if (p.kind === 'fishCast') {
      if (r.perfect) state.combo++;
      else state.combo = 0;
      spend(p);
      UI.flashSuccess();
      beginWaiting();
      return;
    }

    if (p.kind === 'fishReel') {
      finishReel(r.perfect);
      UI.flashSuccess();
      return;
    }

    if (p.kind === 'feed' || p.kind === 'collect' || p.kind === 'milk' || p.kind === 'pet') {
      if (r.perfect) {
        state.combo++;
        state.stats.maxCombo = Math.max(state.stats.maxCombo, state.combo);
        checkComboHeal();
      } else {
        state.combo = 0;
      }
      applyAnimalAction(p, r.perfect);
      spend(p);
      UI.flashSuccess();
      const a = p.animalId ? animalById(state, p.animalId) : null;
      if (a && state.stamina > 0 && !UI.isModalOpen()) openAnimalPanel(a);
      return;
    }

    if (r.perfect) {
      state.combo++;
      state.stats.maxCombo = Math.max(state.stats.maxCombo, state.combo);
      checkComboHeal();
    } else {
      state.combo = 0;
    }
    applyAction(p, r.perfect);
    spend(p);
    UI.flashSuccess();
  },
  onFail: () => {
    const p = pending;
    pending = null;
    state.combo = 0;
    Sound.play('fail');

    if (p && (p.kind === 'fishCast' || p.kind === 'fishReel')) {
      if (p.kind === 'fishCast') state.stamina = Math.max(0, state.stamina - Math.ceil(p.stamina / 2));
      escapeFish(p.kind === 'fishCast' ? '手忙脚乱，鱼线缠住了' : '鱼挣脱了');
      return;
    }

    if (p && (p.kind === 'feed' || p.kind === 'collect' || p.kind === 'milk' || p.kind === 'pet')) {
      state.stamina = Math.max(0, state.stamina - Math.ceil(p.stamina / 2));
      UI.toast('超时了……动物歪着头看你', 'bad');
      if (state.stamina <= 0) { faint(); return; }
      const a = p.animalId ? animalById(state, p.animalId) : null;
      if (a && !UI.isModalOpen()) openAnimalPanel(a);
      return;
    }

    if (p) {
      const half = Math.ceil(p.stamina / 2);
      state.stamina = Math.max(0, state.stamina - half);
      UI.toast('超时了！手忙脚乱，白费了一半力气', 'bad');
      if (state.stamina <= 0) faint();
    }
    currentLabel = '走近田地，按空格开始劳作';
    UI.resetTypingCache();
  }
});

/* ---------------- 状态构造 ---------------- */

function makeNodes(): ResNode[] {  const nodes: ResNode[] = [];
  for (const [tx, ty] of TREE_SPOTS) {
    nodes.push({ key: `t:${tx},${ty}`, kind: 'tree', tx, ty, hp: 3, maxHp: 3, regrowDay: 0 });
  }
  for (const [tx, ty] of ROCK_SPOTS) {
    nodes.push({ key: `r:${tx},${ty}`, kind: 'rock', tx, ty, hp: 2, maxHp: 2, regrowDay: 0 });
  }
  return nodes;
}

function emptyHotbar(): (HotbarRef | null)[] {
  return [null, null, null, null, null, null, null, null];
}

/** 补齐旧存档缺失的字段（例如新增工具、新统计项） */
function normalizeState(s: GameState): void {
  if (!s.tools) s.tools = {} as GameState['tools'];
  for (const id of Object.keys(TOOLS) as ToolId[]) {
    if (!s.tools[id]) s.tools[id] = { id, owned: id === 'hoe' || id === 'can', tier: 1 };
  }
  if (!s.stats) s.stats = {} as GameState['stats'];
  if (typeof s.stats.fishCaught !== 'number') s.stats.fishCaught = 0;
  if (typeof s.stats.animalsTended !== 'number') s.stats.animalsTended = 0;
  if (typeof s.stats.productsCollected !== 'number') s.stats.productsCollected = 0;
  if (!Array.isArray(s.hotbar) || s.hotbar.length !== 8) s.hotbar = emptyHotbar();
  if (typeof s.bagSize !== 'number') s.bagSize = s.bag.length;
  if (typeof s.equipSlot !== 'number') s.equipSlot = 0;
  if (!Array.isArray(s.nodes)) s.nodes = makeNodes();
  if (!Array.isArray(s.animals)) s.animals = [];
}

function newState(): GameState {
  const plots: Plot[] = [];
  for (let i = 0; i < PLOT_COUNT; i++) {
    plots.push({ tilled: false, crop: null, stage: 0, watered: false, quality: 1 });
  }

  const bag = Bag.emptyBag(16);
  for (const [id, n] of Object.entries(CFG.START_SEEDS)) {
    if (n) Bag.addToBag(bag, Bag.makeStack(Bag.seedItemId(id as CropId), n));
  }

  const hotbar = emptyHotbar();
  hotbar[0] = { type: 'tool', id: 'hoe' };
  hotbar[1] = { type: 'tool', id: 'can' };

  const tools = {} as GameState['tools'];
  for (const id of Object.keys(TOOLS) as ToolId[]) {
    tools[id] = { id, owned: id === 'hoe' || id === 'can', tier: 1 };
  }

  const s: GameState = {
    version: 2,
    day: 1,
    time: CFG.DAY_START,
    weather: 'sunny',
    stamina: CFG.STAMINA_MAX,
    coins: CFG.START_COINS,
    plots,
    combo: 0,
    player: { x: 5 * TILE + 24, y: 8 * TILE + 24, dir: 'down', moving: false, walkT: 0 },
    stats: { harvested: 0, sold: 0, earned: 0, actions: 0, maxCombo: 0, daysPlayed: 0, chopped: 0, mined: 0, fishCaught: 0, animalsTended: 0, productsCollected: 0 },
    todayHarvest: 0,
    todayEarned: 0,
    bag,
    bagSize: 16,
    hotbar,
    equipSlot: 0,
    tools,
    nodes: makeNodes(),
    animals: [],
    autoSwitch: true,
    todayCleared: 0
  };

  syncBlockers(s);
  spawnWeeds(s, 6);
  return s;
}

/* ---------------- 节点 ---------------- */

function syncBlockers(s: GameState): void {
  for (const n of s.nodes) {
    if (n.kind === 'tree' || n.kind === 'rock') {
      setNodeBlock(n.tx, n.ty, n.hp > 0);
    }
  }
}

function spawnWeeds(s: GameState, count: number): void {
  const existing = s.nodes.filter((n) => n.kind === 'weed' && n.hp > 0).length;
  const room = Math.max(0, 20 - existing);
  const want = Math.min(count, room);
  let placed = 0;
  let guard = 0;
  while (placed < want && guard < 400) {
    guard++;
    const tx = 1 + Math.floor(Math.random() * (MAP_W - 2));
    const ty = 1 + Math.floor(Math.random() * (MAP_H - 2));

    if (!isOpenGround(tx, ty)) continue;
    if (s.nodes.some((n) => n.tx === tx && n.ty === ty)) continue;
    // 不挡在门口与通道正中，也不长进畜栏
    if (ty === 7 || ty === 8) continue;
    if (inAnimalArea(tx, ty)) continue;

    s.nodes.push({
      key: `w:${tx},${ty},${s.day}`,
      kind: 'weed', tx, ty, hp: 1, maxHp: 1, regrowDay: 0
    });
    placed++;
  }
}

function nodeByKey(key: string): ResNode | null {
  for (const n of state.nodes) if (n.key === key) return n;
  return null;
}

/* ---------------- 存档 ---------------- */

function save(): void {
  storage.set(CFG.SAVE_KEY, JSON.stringify(state));
}

function hasSave(): boolean {
  return storage.get(CFG.SAVE_KEY) != null;
}

function loadSave(): boolean {
  try {
    const raw = storage.get(CFG.SAVE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw) as GameState & { tool?: number; seeds?: Record<string, number>; basket?: Array<{ crop: CropId; quality: number }> };

    if (data.version === 2 && Array.isArray(data.plots) && data.plots.length === PLOT_COUNT) {
      state = data;
      normalizeState(state);
      syncBlockers(state);
      return true;
    }

    // v1 → v2 迁移
    if (Array.isArray(data.plots) && data.plots.length === PLOT_COUNT) {
      state = migrateV1(data);
      save();
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

interface LegacySave {
  day?: number; time?: number; weather?: GameState['weather']; stamina?: number;
  coins?: number; plots?: Plot[]; player?: GameState['player']; stats?: Partial<GameState['stats']>;
  tool?: number; seeds?: Record<string, number>;
  basket?: Array<{ crop: CropId; quality: number }>;
}

function migrateV1(old: LegacySave): GameState {
  const s = newState();
  if (typeof old.day === 'number') s.day = old.day;
  if (typeof old.time === 'number') s.time = old.time;
  if (old.weather) s.weather = old.weather;
  if (typeof old.stamina === 'number') s.stamina = old.stamina;
  if (typeof old.coins === 'number') s.coins = old.coins;
  if (Array.isArray(old.plots)) s.plots = old.plots;
  if (old.player) s.player = { ...old.player };
  if (old.stats) s.stats = { ...s.stats, ...old.stats } as GameState['stats'];

  // 工具等级继承
  const tier = Math.max(1, Math.min(4, (old.tool ?? 0) + 1));
  s.tools.hoe.tier = tier;
  s.tools.can.tier = tier;

  // 种子与出货篮转入背包
  s.bag = Bag.emptyBag(s.bagSize);
  if (old.seeds) {
    for (const [id, n] of Object.entries(old.seeds)) {
      if (n > 0) Bag.addToBag(s.bag, Bag.makeStack(Bag.seedItemId(id as CropId), n));
    }
  }
  if (Array.isArray(old.basket)) {
    for (const b of old.basket) {
      Bag.addToBag(s.bag, Bag.makeStack(Bag.cropItemId(b.crop), 1, b.quality));
    }
  }
  return s;
}

/* ---------------- 数值 ---------------- */


function toolTier(tool: ToolId | null): number {
  return tool ? state.tools[tool].tier : 1;
}

function actionCost(info: ActionInfo): { stamina: number; time: number } {
  let base: { stamina: number; time: number };
  if (info.tool) {
    const def = TOOLS[info.tool];
    base = { stamina: def.stamina * tierInfo(toolTier(info.tool)).stamina, time: def.time };
  } else if (info.kind === 'plant') {
    base = { stamina: CFG.COST.plant.stamina, time: CFG.COST.plant.time };
  } else {
    base = { stamina: CFG.COST.harvest.stamina, time: CFG.COST.harvest.time };
  }
  const night = state.time >= CFG.NIGHT_FROM;
  return { stamina: Math.max(1, Math.round(base.stamina * (night ? 2 : 1))), time: base.time };
}

function checkComboHeal(): void {
  if (CFG.COMBO_HEAL_AT.includes(state.combo)) {
    state.stamina = Math.min(CFG.STAMINA_MAX, state.stamina + CFG.COMBO_HEAL);
    UI.toast(`连击 ×${state.combo}！干劲上来了（体力 +${CFG.COMBO_HEAL}）`, 'good');
  }
}

/* ---------------- 动作应用 ---------------- */

function plotCenter(i: number): { x: number; y: number } {
  const { tx, ty } = plotTileOf(i);
  return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 };
}

function applyAction(p: Pending, perfect: boolean): void {
  switch (p.kind) {
    case 'till': {
      for (const i of p.plots) {
        state.plots[i].tilled = true;
        const c = plotCenter(i);
        burst(c.x, c.y + 10, '#8b6a44', 10);
      }
      const first = plotCenter(p.plots[0]);
      floatText(first.x, first.y - 12, '开垦', '#ffe9a8');
      Sound.play('till');
      break;
    }
    case 'plant': {
      const i = p.plots[0];
      if (!p.crop) return;
      const plot = state.plots[i];
      plot.crop = p.crop;
      plot.stage = 0;
      plot.growth = 0;
      plot.watered = false;
      plot.quality = 1;
      Bag.removeFromBag(state.bag, Bag.seedItemId(p.crop), 1);
      const c = plotCenter(i);
      burst(c.x, c.y + 12, '#9ad06a', 8);
      floatText(c.x, c.y - 12, `种下 ${CROPS[p.crop].zh}`, '#d8f5c0');
      Sound.play('plant');
      if (!isInSeason(CROPS[p.crop], seasonOfDay(state.day))) {
        UI.toast(`${CROPS[p.crop].zh}不是当季作物，会长得慢一倍`, 'bad');
      }
      break;
    }
    case 'water': {
      for (const i of p.plots) {
        const plot = state.plots[i];
        plot.watered = true;
        if (perfect && plot.quality < 5) plot.quality++;
        const c = plotCenter(i);
        burst(c.x, c.y, 'rgba(140,210,240,.9)', 8);
      }
      const c0 = plotCenter(p.plots[0]);
      floatText(c0.x, c0.y - 12, perfect ? '浇水 ★' : '浇水', '#cdeaff');
      Sound.play('water');
      break;
    }
    case 'harvest': {
      const i = p.plots[0];
      const plot = state.plots[i];
      const cropId = plot.crop;
      if (!cropId) return;
      const def = CROPS[cropId];
      const q = Math.min(5, plot.quality + (perfect ? 1 : 0));
      Bag.addToBag(state.bag, Bag.makeStack(Bag.cropItemId(cropId), 1, q));
      state.todayHarvest++;
      state.stats.harvested++;
      plot.crop = null;
      plot.stage = 0;
      plot.growth = 0;
      plot.watered = false;
      plot.quality = 1;
      const c = plotCenter(i);
      burst(c.x, c.y, def.fruit, 16, 1.2);
      burst(c.x, c.y, '#ffe9a8', 6, 1.4);
      floatText(c.x, c.y - 14, `${def.zh} ${'★'.repeat(q)}`, '#fff2b8', 15);
      Sound.play('harvest');
      break;
    }
    case 'chop':
    case 'mine':
    case 'cut': {
      const node = p.nodeKey ? nodeByKey(p.nodeKey) : null;
      if (!node) return;
      hitNode(node, p.tool as ToolId, perfect);
      break;
    }
    default:
      break;
  }
}

function hitNode(node: ResNode, tool: ToolId, perfect: boolean): void {
  const def = NODE_DEFS[node.kind as NodeKind];
  const tier = toolTier(tool);
  const c = { x: node.tx * TILE + TILE / 2, y: node.ty * TILE + TILE / 2 };

  node.hp -= hitCount(tool);

  if (node.hp > 0) {
    if (node.kind === 'tree') {
      burst(c.x, c.y - 20, '#8a6038', 10);
      Sound.play('till');
      floatText(c.x, c.y - 40, `${node.hp}/${node.maxHp}`, '#ffd9a0', 12);
    } else if (node.kind === 'rock') {
      burst(c.x, c.y - 8, '#b3aca4', 12);
      Sound.play('till');
      floatText(c.x, c.y - 30, `${node.hp}/${node.maxHp}`, '#e0dcd6', 12);
    } else {
      Sound.play('harvest');
    }
    return;
  }

  // 击破
  node.hp = 0;
  const mult = dropMultiplier(tool, tier);
  const n = Math.max(1, (def.dropMin + Math.floor(Math.random() * (def.dropMax - def.dropMin + 1))) * mult);
  const left = Bag.addToBag(state.bag, Bag.makeStack(def.drop, n));
  const got = n - left;

  if (got > 0) {
    const itemDef = getDef(def.drop);
    floatText(c.x, c.y - 16, `+${got} ${itemDef?.name ?? ''}`, '#ffe9a8', 14);
    burst(c.x, c.y, '#f0c86a', 12);
  }
  if (left > 0) UI.toast('背包满了，有些东西散落在地里消失了', 'bad');

  if (node.kind === 'tree') {
    state.stats.chopped++;
    Sound.play('harvest');
  } else if (node.kind === 'rock') {
    state.stats.mined++;
  } else {
    state.todayCleared++;
    state.nodes = state.nodes.filter((x) => x.key !== node.key);
  }

  if (def.regrow > 0) {
    node.regrowDay = state.day + def.regrow;
  }
  syncBlockers(state);
  void perfect;
}

/* ---------------- 消耗 ---------------- */

function spend(p: Pending): void {
  state.stamina = Math.max(0, state.stamina - p.stamina);
  state.time += p.time;
  state.stats.actions++;
  currentLabel = '走近田地，按空格开始劳作';
  UI.resetTypingCache();
  if (state.time >= 26 * 60) {
    UI.toast('已经凌晨两点了，眼前一黑……', 'bad');
    if (state.stamina > 0) state.stamina = 0;
    faint();
    return;
  }
  if (state.stamina <= 0) faint();
}

/* ---------------- 钓鱼 ---------------- */

function canHoldFish(): boolean {
  return state.bag.some((s) => s === null || s.kind === 'fish');
}

function startFishing(): void {
  const cost = actionCost({ kind: 'fish', tool: 'rod', tx: 0, ty: 0, plotIndex: -1, nodeKey: null, needsSeed: false, label: '钓鱼' });
  if (state.stamina < cost.stamina) {
    UI.toast('体力不够了，回屋睡觉吧', 'bad');
    return;
  }
  if (!canHoldFish()) {
    UI.toast('背包满了，先去出货或者整理一下', 'bad');
    return;
  }

  const tier = state.tools.rod.tier;
  const t = tierInfo(tier);
  const castWord = makeWord('fish', TOOLS.rod.band, '抛竿');

  pending = {
    kind: 'fishCast',
    tool: 'rod',
    plots: [],
    nodeKey: null,
    stamina: cost.stamina,
    time: cost.time,
    label: '抛竿'
  };

  currentLabel = `钓鱼 · ${['铜', '银', '金', '秘银'][tier - 1]}钓竿`;
  fishing.tier = tier;
  fishing.phase = 'idle';
  UI.resetTypingCache();
  UI.resetFishingCache();
  session.start([castWord], t.tolerance, t.time, performance.now());
}

function beginWaiting(): void {
  const [lo, hi] = BITE_DELAY;
  fishing.phase = 'wait';
  fishing.biteAt = performance.now() + lo + Math.random() * (hi - lo);
  fishing.window = biteWindow(fishing.tier);
  currentLabel = `钓鱼 · ${['铜', '银', '金', '秘银'][fishing.tier - 1]}钓竿`;
  UI.resetFishingCache();
  UI.toast('盯着浮标……');
}

function tickFishing(now: number): void {
  if (fishing.phase === 'wait') {
    if (now >= fishing.biteAt) {
      fishing.phase = 'bite';
      fishing.biteEnd = now + fishing.window;
      fishing.fish = pickFish(fishing.tier);
      Sound.play('bite');
      UI.resetFishingCache();
    }
    return;
  }
  if (fishing.phase === 'bite' && now > fishing.biteEnd) {
    escapeFish('等太久，鱼吐钩跑了');
  }
}

function onReelPress(now: number): void {
  if (fishing.phase !== 'bite' || !fishing.fish) return;

  const left = Math.max(0, fishing.biteEnd - now);
  const ratio = left / fishing.window;
  fishing.quality = ratio > 0.85 ? 5 : ratio > 0.7 ? 4 : ratio > 0.5 ? 3 : ratio > 0.25 ? 2 : 1;

  const tier = fishing.tier;
  const t = tierInfo(tier);
  const fish = fishing.fish;

  fishing.phase = 'reel';
  pending = {
    kind: 'fishReel',
    tool: 'rod',
    plots: [],
    nodeKey: null,
    stamina: 0,
    time: 0,
    label: `收线 ${fish.zh}`
  };

  currentLabel = `收线 · ${fish.zh}`;
  UI.resetTypingCache();
  UI.resetFishingCache();
  // 收线词的难度跟着这条鱼的价值走：稀有的鱼要打更长的词
  const reelWord = makeWord('fish', bandForValue(fish.price), `收线 · ${fish.zh}`);
  session.start([reelWord], t.tolerance, t.time, performance.now());
}

function finishReel(perfect: boolean): void {
  const fish = fishing.fish;
  if (!fish) {
    fishing.phase = 'idle';
    return;
  }
  const q = Math.min(5, fishing.quality + (perfect ? 1 : 0));
  const leftover = Bag.addToBag(state.bag, Bag.makeStack(`fish.${fish.id}`, 1, q));

  if (leftover > 0) {
    UI.toast('背包满了，鱼滑回了水里', 'bad');
  } else {
    state.stats.fishCaught++;
    state.combo++;
    state.stats.maxCombo = Math.max(state.stats.maxCombo, state.combo);
    checkComboHeal();
    Sound.play(perfect ? 'perfect' : 'coin');
    floatText(state.player.x, state.player.y - 52, `${fish.zh} ${'★'.repeat(q)}`, '#cdeaff', 15);
    UI.toast(`钓到 ${fish.zh}！${'★'.repeat(q)}`, 'good');
    burst(state.player.x, state.player.y - 30, '#8cd2f0', 16, 1.2);
  }

  fishing.phase = 'idle';
  fishing.fish = null;
  currentLabel = '走近田地，按空格开始劳作';
  UI.resetTypingCache();
  UI.resetHotbarCache();
}

function escapeFish(reason: string): void {
  fishing.phase = 'idle';
  fishing.fish = null;
  state.combo = 0;
  currentLabel = '走近田地，按空格开始劳作';
  UI.resetTypingCache();
  UI.resetFishingCache();
  UI.toast(reason, 'bad');
  if (state.stamina <= 0) faint();
}

function cancelFishing(): void {
  if (fishing.phase !== 'wait' && fishing.phase !== 'bite') return;
  fishing.phase = 'idle';
  fishing.fish = null;
  currentLabel = '走近田地，按空格开始劳作';
  UI.resetFishingCache();
  UI.toast('收竿了');
}

/* ---------------- 开始一次劳作 ---------------- */

/** 多目标：锄头/水壶秘银级一次处理多格 */
function collectPlots(info: ActionInfo): number[] {
  if (info.plotIndex < 0) return [];
  const tool = info.tool;
  const max = tool ? multiTarget(tool, toolTier(tool)) : 1;
  if (max <= 1) return [info.plotIndex];

  const out: number[] = [info.plotIndex];
  const dir = state.player.dir;
  const dv: Record<string, [number, number]> = {
    up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0]
  };
  const [dx, dy] = dv[dir];
  const { tx, ty } = plotTileOf(info.plotIndex);
  for (let step = 1; step < max; step++) {
    const nx = tx + dx * step;
    const ny = ty + dy * step;
    const pi = plotIndexOf(nx, ny);
    if (pi < 0) break;
    if (!state.plots[pi].tilled && info.kind === 'till') out.push(pi);
    else if (state.plots[pi].tilled && state.plots[pi].crop && !state.plots[pi].watered && info.kind === 'water') out.push(pi);
    else break;
  }
  return out;
}

/**
 * 按「动作 + 价值」生成要打的词。
 * 词义与玩法解耦：这里只决定类别与难度档，词本身来自词库。
 */
function buildWords(info: ActionInfo, crop: CropId | null): Word[] {
  switch (info.kind) {
    case 'till':
      return makeWords('farm', TOOLS.hoe.band, info.label, 1);
    case 'water':
      return makeWords('farm', TOOLS.can.band, info.label, 1);
    case 'plant':
      return makeWords('farm', 1, info.label, 1);
    case 'harvest': {
      // 收获两词连打，难度跟着作物的售价走
      const price = crop ? CROPS[crop].price : 120;
      return makeWords('farm', bandForValue(price), info.label, 2);
    }
    case 'chop':
    case 'mine':
    case 'cut':
    case 'fish': {
      const tool = (info.tool ?? 'hoe') as ToolId;
      const def = TOOLS[tool];
      return makeWords(def.wordCat, def.band, info.label, repeatCount(tool));
    }
    default:
      return [];
  }
}

function startAction(info: ActionInfo): void {
  if (session.active) return;

  const cost = actionCost(info);
  if (state.stamina < cost.stamina) {
    UI.toast('体力不够了，回屋睡觉吧', 'bad');
    return;
  }

  // 背包空间预检
  if (info.kind === 'harvest') {
    const plot = state.plots[info.plotIndex];
    if (plot.crop) {
      const probe = Bag.makeStack(Bag.cropItemId(plot.crop), 1, plot.quality);
      if (!Bag.canFit(state.bag, probe)) {
        UI.toast('背包满了，先去出货或者整理一下', 'bad');
        return;
      }
    }
  }

  const plots = collectPlots(info);
  const crop = info.kind === 'plant'
    ? cropIdFromSeed(heldSeedId(state))
    : info.plotIndex >= 0 ? state.plots[info.plotIndex].crop : null;

  if (info.kind === 'plant' && !crop) return;

  const tier = toolTier(info.tool);
  const t = tierInfo(tier);
  const timeScale = info.tool ? TOOLS[info.tool].timeScale : 1;

  pending = {
    kind: info.kind,
    tool: info.tool,
    plots,
    nodeKey: info.nodeKey,
    crop: crop ?? undefined,
    stamina: cost.stamina,
    time: cost.time,
    label: info.label
  };

  const words = buildWords(info, crop ?? null);
  currentLabel = info.tool
    ? `${info.label} · ${['铜', '银', '金', '秘银'][tier - 1]}${TOOLS[info.tool].name}`
    : info.label;

  UI.resetTypingCache();
  session.start(words, t.tolerance, t.time * timeScale, performance.now());
}

function cropIdFromSeed(seedItemId: string | null): CropId | null {
  if (!seedItemId) return null;
  const id = seedItemId.replace('seed.', '') as CropId;
  return CROPS[id] ? id : null;
}

/* ---------------- 交互 ---------------- */

function tryInteract(): void {
  if (!running || session.active || UI.isModalOpen()) return;
  if (fishing.phase !== 'idle') return;

  // 优先：面朝的动物
  const near = animalNear(state, state.player.x, state.player.y, state.player.dir);
  if (near) { openAnimalPanel(near); return; }

  const { tx, ty } = facingTile(state.player);
  const info = resolveTarget(state, tx, ty);
  if (!info) return;

  if (info.kind === 'door') { openHouse(); return; }
  if (info.kind === 'bin') { openBin(); return; }
  if (info.kind === 'order') { openShop(); return; }

  // 自动切换到正确工具
  if (info.tool && heldTool(state) !== info.tool) {
    const slot = hotbarSlotOfTool(state, info.tool);
    if (slot >= 0) {
      state.equipSlot = slot;
      UI.resetHotbarCache();
      if (state.autoSwitch) {
        UI.toast(`自动换上 ${['铜', '银', '金', '秘银'][state.tools[info.tool].tier - 1]}${TOOLS[info.tool].name}`);
      }
    } else if (!state.tools[info.tool].owned) {
      UI.toast(`需要${TOOLS[info.tool].name}，可以在订购箱购买`, 'bad');
      return;
    } else {
      UI.toast(`${TOOLS[info.tool].name}不在快捷栏里，按 Tab 打开背包放进去`, 'bad');
      return;
    }
  }

  if (info.needsSeed) {
    if (!ensureSeedInHand()) return;
  }

  if (info.kind === 'fish') {
    startFishing();
    return;
  }

  startAction(info);
}

/** 保证手里拿着可用的种子 */
function ensureSeedInHand(): boolean {
  const ref = state.hotbar[state.equipSlot];
  if (ref && ref.type === 'seed' && Bag.countInBag(state.bag, ref.id) > 0) return true;

  // 快捷栏里是否有别的种子
  for (let i = 0; i < state.hotbar.length; i++) {
    const r = state.hotbar[i];
    if (r && r.type === 'seed' && Bag.countInBag(state.bag, r.id) > 0) {
      state.equipSlot = i;
      UI.resetHotbarCache();
      return true;
    }
  }

  // 从背包里拿一份种子放进快捷栏
  const seed = state.bag.find((s) => s && s.kind === 'seed');
  if (!seed) {
    UI.toast('没有种子了，去订购箱买一些', 'bad');
    return false;
  }
  const slot = state.hotbar.findIndex((r) => r === null);
  const refNew: HotbarRef = { type: 'seed', id: seed.id };
  if (slot >= 0) {
    state.hotbar[slot] = refNew;
    state.equipSlot = slot;
  } else {
    state.hotbar[state.equipSlot] = refNew;
  }
  UI.resetHotbarCache();
  UI.toast(`把${getDef(seed.id)?.name ?? '种子'}放到手上`);
  return true;
}

/* ---------------- 动物照料 ---------------- */

type AnimalAction = 'feed' | 'collect' | 'milk' | 'pet';

const ANIMAL_COST: Record<AnimalAction, { stamina: number; time: number }> = {
  feed: { stamina: 2, time: 10 },
  collect: { stamina: 2, time: 5 },
  milk: { stamina: 4, time: 15 },
  pet: { stamina: 1, time: 5 }
};

function animalCost(action: AnimalAction): { stamina: number; time: number } {
  const base = ANIMAL_COST[action];
  const night = state.time >= CFG.NIGHT_FROM;
  return { stamina: Math.max(1, Math.round(base.stamina * (night ? 2 : 1))), time: base.time };
}

function buildAnimalWords(action: AnimalAction): Word[] {
  switch (action) {
    case 'feed': return makeWords('animal', 1, '喂食', 1);
    case 'collect': return makeWords('animal', 1, '捡蛋', 1);
    case 'milk': return makeWords('animal', 0, '挤奶', 3);
    case 'pet': return makeWords('animal', 0, '抚摸', 1);
  }
}

function openAnimalPanel(a: Animal): void {
  const def = ANIMAL_DEFS[a.kind];
  const q = happinessQuality(a.happiness);
  const collectLabel = a.kind === 'chicken' ? '捡蛋' : '挤奶';
  const collectAction: AnimalAction = a.kind === 'chicken' ? 'collect' : 'milk';
  const happyPct = Math.round(a.happiness);

  const status = `
    <div class="animal-status">
      <div class="as-row"><span class="k">心情</span>
        <span class="happy-bar"><i style="width:${happyPct}%"></i></span>
        <span class="v">${happyPct} · ${'★'.repeat(q)}</span></div>
      <div class="as-row"><span class="k">喂食</span><span class="v">${a.fedToday ? '✓ 已喂' : '✗ 还没喂'}</span></div>
      <div class="as-row"><span class="k">${def.productName}</span><span class="v">${a.productReady ? '✓ 可收获' : '— 喂了明天才有'}</span></div>
      <div class="as-row"><span class="k">抚摸</span><span class="v">${a.pettedToday ? '✓ 已抚摸' : '✗ 还没摸'}</span></div>
    </div>
    <p class="dim">心情越好，${def.productName}品质越高。喂食 + 抚摸涨心情，饿着会掉。</p>`;

  UI.showModal(
    `${def.icon} ${def.name}`,
    status,
    [
      { label: a.fedToday ? '已喂食' : '喂食', cls: a.fedToday ? 'ghost' : 'green', onClick: () => { if (!a.fedToday) { UI.hideModal(); startAnimalAction(a, 'feed'); } } },
      { label: a.productReady ? collectLabel : '无产物', cls: a.productReady ? 'green' : 'ghost', onClick: () => { if (a.productReady) { UI.hideModal(); startAnimalAction(a, collectAction); } } },
      { label: a.pettedToday ? '已抚摸' : '抚摸', cls: a.pettedToday ? 'ghost' : '', onClick: () => { if (!a.pettedToday) { UI.hideModal(); startAnimalAction(a, 'pet'); } } },
      { label: '离开', cls: 'ghost', onClick: () => UI.hideModal() }
    ]
  );
}

function startAnimalAction(a: Animal, action: AnimalAction): void {
  if (session.active) return;
  const cost = animalCost(action);
  if (state.stamina < cost.stamina) {
    UI.toast('体力不够了，回屋睡觉吧', 'bad');
    openAnimalPanel(a);
    return;
  }
  if (action === 'collect' || action === 'milk') {
    const def = ANIMAL_DEFS[a.kind];
    const probe = Bag.makeStack(def.productId, 1, happinessQuality(a.happiness));
    if (!Bag.canFit(state.bag, probe)) {
      UI.toast('背包满了，先去出货', 'bad');
      openAnimalPanel(a);
      return;
    }
  }

  const label = action === 'feed' ? '喂食' : action === 'pet' ? '抚摸' : action === 'collect' ? '捡蛋' : '挤奶';
  pending = {
    kind: action, tool: null, plots: [], nodeKey: null,
    animalId: a.id, stamina: cost.stamina, time: cost.time, label
  };
  currentLabel = `${label} · ${ANIMAL_DEFS[a.kind].name}`;
  UI.resetTypingCache();
  session.start(buildAnimalWords(action), 0, 1, performance.now());
}

function applyAnimalAction(p: Pending, perfect: boolean): void {
  const a = p.animalId ? animalById(state, p.animalId) : null;
  if (!a) return;
  const def = ANIMAL_DEFS[a.kind];
  const cx = a.x, cy = a.y;

  switch (p.kind) {
    case 'feed':
      a.fedToday = true;
      a.happiness = Math.min(100, a.happiness + 8);
      state.stats.animalsTended++;
      floatText(cx, cy - 30, '喂食', '#d8f5c0');
      burst(cx, cy - 10, '#e8c86a', 8);
      Sound.play('plant');
      break;
    case 'pet':
      a.pettedToday = true;
      a.happiness = Math.min(100, a.happiness + 6);
      state.stats.animalsTended++;
      floatText(cx, cy - 30, '抚摸 ♥', '#f0a0b0');
      burst(cx, cy - 16, '#f0a0b0', 8);
      Sound.play('click');
      break;
    case 'collect':
    case 'milk': {
      if (!a.productReady) return;
      const q = Math.min(5, happinessQuality(a.happiness) + (perfect ? 1 : 0));
      Bag.addToBag(state.bag, Bag.makeStack(def.productId, 1, q));
      a.productReady = false;
      a.happiness = Math.min(100, a.happiness + 2);
      state.stats.productsCollected++;
      floatText(cx, cy - 34, `${def.productName} ${'★'.repeat(q)}`, '#fff2b8', 15);
      burst(cx, cy - 10, '#f5f0e6', 12);
      Sound.play('harvest');
      break;
    }
    default:
      break;
  }
}

function buyAnimal(kind: AnimalKind): void {
  const def = ANIMAL_DEFS[kind];
  if (state.coins < def.price) { UI.toast('金币不够', 'bad'); return; }
  const count = state.animals.filter((a) => a.kind === kind).length;
  if (count >= 6) { UI.toast('围栏已经满了（每种最多 6 只）', 'bad'); return; }
  state.coins -= def.price;
  state.animals.push(createAnimal(kind));
  Sound.play('levelup');
  UI.toast(`购入 ${def.name}！去围栏看看它`, 'good');
  save();
  openShop();
}

/* ---------------- 出货 ---------------- */

interface SellLine { stack: ItemStack; total: number }

function sellLines(): SellLine[] {
  const lines: SellLine[] = [];
  for (const s of state.bag) {
    if (!s || !isSellable(s)) continue;
    lines.push({ stack: s, total: sellPrice(s) * s.qty });
  }
  return lines;
}

function openBin(): void {
  const lines = sellLines();
  if (lines.length === 0) {
    UI.toast('背包里没有可出售的东西');
    return;
  }
  const total = lines.reduce((n, l) => n + l.total, 0);
  const rows = lines.map((l) => {
    const def = getDef(l.stack.id);
    const q = l.stack.quality ?? 1;
    return `<div class="report-grid">
      <span class="k">${def?.icon ?? ''} ${def?.name ?? ''} ×${l.stack.qty} <span class="dim">${'★'.repeat(q)}</span></span>
      <span class="v">${l.total} G</span></div>`;
  }).join('');

  UI.showModal(
    '出货箱',
    `${rows}<hr class="report-hr">
     <div class="report-total"><span>合计</span><span>${total} G</span></div>
     <p class="dim">出货会卖掉背包里所有作物、鱼和动物产物。</p>`,
    [
      { label: '算了', cls: 'ghost', onClick: () => UI.hideModal() },
      { label: `全部出货 ${total}G`, cls: 'green', onClick: () => { UI.hideModal(); sellAll(); } }
    ]
  );
}

function sellAll(): void {
  let total = 0;
  let count = 0;
  for (const s of state.bag) {
    if (!s || !isSellable(s)) continue;
    total += sellPrice(s) * s.qty;
    count += s.qty;
  }
  if (count === 0) return;
  for (let i = 0; i < state.bag.length; i++) {
    const s = state.bag[i];
    if (s && isSellable(s)) state.bag[i] = null;
  }
  state.coins += total;
  state.todayEarned += total;
  state.stats.earned += total;
  state.stats.sold += count;
  Sound.play('coin');
  floatText(18 * TILE + 24, 8 * TILE - 10, `+${total}G`, '#ffe27a', 18);
  UI.toast(`出货 ${count} 件，收入 ${total} G`, 'good');
  UI.resetHotbarCache();
  save();
}

/* ---------------- 商店 ---------------- */

function openShop(): void {
  const curSeason = seasonOfDay(state.day);
  const seedRows = CROP_ORDER.map((id) => {
    const c = CROPS[id];
    const cant = state.coins < c.seed ? ' cant' : '';
    const stock = Bag.countInBag(state.bag, Bag.seedItemId(id));
    const inSeason = c.season === curSeason;
    const seasonTag = inSeason
      ? `<span class="season-tag in">${SEASON_ICON[c.season]} 当季</span>`
      : `<span class="season-tag off">${SEASON_ICON[c.season]} ${SEASON_LABEL[c.season]}季 · 慢一倍</span>`;
    return `<div class="shop-row${cant}">
      <div>
        <div class="nm">${c.emoji} ${c.zh}种子 <span class="dm">${c.en}</span> ${seasonTag}</div>
        <div class="dt">${c.days}天成熟 · 售${c.price}G · 持有 ${stock}</div>
      </div>
      <div class="pr">${c.seed}G</div>
      <div class="buy-group">
        <button class="btn small" data-seed="${id}" data-n="1" ${state.coins < c.seed ? 'disabled' : ''}>1</button>
        <button class="btn small ghost" data-seed="${id}" data-n="5" ${state.coins < c.seed * 5 ? 'disabled' : ''}>5</button>
      </div>
    </div>`;
  }).join('');

  const toolRows = (Object.keys(TOOLS) as ToolId[]).map((id) => {
    const def = TOOLS[id];
    const st = state.tools[id];
    if (!st.owned) {
      return `<div class="shop-row${state.coins < def.price ? ' cant' : ''}">
        <div><div class="nm">${def.icon} ${def.name}</div>
        <div class="dt">${def.actionLabel} · 体力 ${def.stamina} · 未持有</div></div>
        <div class="pr">${def.price}G</div>
        <div class="buy-group"><button class="btn small" data-tool="${id}" ${state.coins < def.price ? 'disabled' : ''}>购买</button></div>
      </div>`;
    }
    if (st.tier >= 4) {
      return `<div class="shop-row done">
        <div><div class="nm">${def.icon} 秘银${def.name}</div>
        <div class="dt">已满级 · ${tierInfo(4).desc}</div></div>
        <div class="pr">MAX</div><div class="buy-group"></div>
      </div>`;
    }
    const next = st.tier + 1;
    const info = tierInfo(next);
    const mat = upgradeMaterial(id, next);
    const wood = Bag.countInBag(state.bag, 'mat.wood');
    const stone = Bag.countInBag(state.bag, 'mat.stone');
    const enough = state.coins >= mat.cost && wood >= mat.wood && stone >= mat.stone;
    const need = [
      mat.cost > 0 ? `${mat.cost}G` : '',
      mat.wood > 0 ? `木${mat.wood}(${wood})` : '',
      mat.stone > 0 ? `石${mat.stone}(${stone})` : ''
    ].filter(Boolean).join(' + ');
    return `<div class="shop-row${enough ? '' : ' cant'}">
      <div><div class="nm">${def.icon} ${['铜', '银', '金', '秘银'][st.tier - 1]}${def.name} → ${info.name}${def.name}</div>
      <div class="dt">${info.desc} · 需要 ${need}</div></div>
      <div class="pr">${info.name}</div>
      <div class="buy-group"><button class="btn small" data-up="${id}" ${enough ? '' : 'disabled'}>升级</button></div>
    </div>`;
  }).join('');

  const animalRows = ANIMAL_ORDER.map((kind) => {
    const def = ANIMAL_DEFS[kind];
    const count = state.animals.filter((a) => a.kind === kind).length;
    const full = count >= 6;
    const cant = state.coins < def.price || full;
    return `<div class="shop-row${cant ? ' cant' : ''}">
      <div><div class="nm">${def.icon} ${def.name}</div>
      <div class="dt">产${def.productName}（${getDef(def.productId)?.price ?? 0}G/天）· 已养 ${count}/6</div></div>
      <div class="pr">${def.price}G</div>
      <div class="buy-group"><button class="btn small" data-animal="${kind}" ${cant ? 'disabled' : ''}>${full ? '满栏' : '购买'}</button></div>
    </div>`;
  }).join('');

  const bagRow = state.bagSize < 32
    ? `<div class="shop-row${state.coins < (state.bagSize === 16 ? 2000 : 5000) ? ' cant' : ''}">
        <div><div class="nm">🎒 背包扩容</div>
        <div class="dt">${state.bagSize} → ${state.bagSize === 16 ? 24 : 32} 格</div></div>
        <div class="pr">${state.bagSize === 16 ? 2000 : 5000}G</div>
        <div class="buy-group"><button class="btn small" id="btn-bagup"
          ${state.coins < (state.bagSize === 16 ? 2000 : 5000) ? 'disabled' : ''}>扩容</button></div>
      </div>`
    : '<p class="dim">背包已经是最大容量了。</p>';

  UI.showModal(
    '订购箱',
    `<p class="dim">邮购直达。种子、工具、动物、背包扩容都在这儿。现在是 ${SEASON_ICON[curSeason]} <b>${SEASON_LABEL[curSeason]}季</b>，当季作物长得快。</p>
     <h3>种子</h3><div class="shop-list">${seedRows}</div>
     <h3>工具</h3><div class="shop-list">${toolRows}</div>
     <h3>动物</h3><div class="shop-list">${animalRows}</div>
     <h3>其他</h3><div class="shop-list">${bagRow}</div>
     <hr class="report-hr">
     <div class="report-total"><span>持有金币</span><span>${state.coins} G</span></div>
     <p class="dim">材料：🪵 木材 ${Bag.countInBag(state.bag, 'mat.wood')} · 🪨 石材 ${Bag.countInBag(state.bag, 'mat.stone')} · 🌿 纤维 ${Bag.countInBag(state.bag, 'mat.fiber')}</p>`,
    [{ label: '离开', cls: 'ghost', onClick: () => UI.hideModal() }],
    true
  );

  document.querySelectorAll<HTMLElement>('[data-seed]').forEach((el) => {
    el.addEventListener('click', () => {
      buySeed(el.dataset.seed as CropId, Number(el.dataset.n ?? '1'));
    });
  });
  document.querySelectorAll<HTMLElement>('[data-tool]').forEach((el) => {
    el.addEventListener('click', () => buyTool(el.dataset.tool as ToolId));
  });
  document.querySelectorAll<HTMLElement>('[data-up]').forEach((el) => {
    el.addEventListener('click', () => upgradeTool(el.dataset.up as ToolId));
  });
  document.querySelectorAll<HTMLElement>('[data-animal]').forEach((el) => {
    el.addEventListener('click', () => buyAnimal(el.dataset.animal as AnimalKind));
  });
  document.getElementById('btn-bagup')?.addEventListener('click', () => upgradeBag());
}

function buySeed(id: CropId, n: number): void {
  const c = CROPS[id];
  const cost = c.seed * n;
  if (state.coins < cost) { UI.toast('金币不够', 'bad'); return; }
  const item = Bag.makeStack(Bag.seedItemId(id), n);
  if (!Bag.canFit(state.bag, item)) { UI.toast('背包放不下了', 'bad'); return; }

  state.coins -= cost;
  Bag.addToBag(state.bag, item);
  Sound.play('coin');
  UI.toast(`购入 ${c.zh}种子 ×${n}`, 'good');
  UI.resetHotbarCache();
  save();
  openShop();
}

function buyTool(id: ToolId): void {
  const def = TOOLS[id];
  if (state.tools[id].owned) return;
  if (state.coins < def.price) { UI.toast('金币不够', 'bad'); return; }
  state.coins -= def.price;
  state.tools[id].owned = true;
  state.tools[id].tier = 1;

  const slot = state.hotbar.findIndex((r) => r === null);
  if (slot >= 0) state.hotbar[slot] = { type: 'tool', id };

  Sound.play('levelup');
  UI.toast(`获得 ${def.name}！已放进快捷栏`, 'good');
  UI.resetHotbarCache();
  save();
  openShop();
}

function upgradeTool(id: ToolId): void {
  const st = state.tools[id];
  if (st.tier >= 4) return;
  const next = st.tier + 1;
  const mat = upgradeMaterial(id, next);

  if (state.coins < mat.cost) { UI.toast('金币不够', 'bad'); return; }
  if (Bag.countInBag(state.bag, 'mat.wood') < mat.wood) { UI.toast(`木材不够，需要 ${mat.wood}`, 'bad'); return; }
  if (Bag.countInBag(state.bag, 'mat.stone') < mat.stone) { UI.toast(`石材不够，需要 ${mat.stone}`, 'bad'); return; }

  state.coins -= mat.cost;
  if (mat.wood) Bag.removeFromBag(state.bag, 'mat.wood', mat.wood);
  if (mat.stone) Bag.removeFromBag(state.bag, 'mat.stone', mat.stone);
  st.tier = next;

  Sound.play('levelup');
  UI.toast(`${TOOLS[id].name} 升级为 ${tierInfo(next).name}${TOOLS[id].name}！`, 'good');
  UI.resetHotbarCache();
  save();
  openShop();
}

function upgradeBag(): void {
  if (state.bagSize >= 32) return;
  const cost = state.bagSize === 16 ? 2000 : 5000;
  if (state.coins < cost) { UI.toast('金币不够', 'bad'); return; }
  state.coins -= cost;
  const next = state.bagSize === 16 ? 24 : 32;
  const grown = Bag.emptyBag(next);
  for (let i = 0; i < state.bag.length; i++) grown[i] = state.bag[i];
  state.bag = grown;
  state.bagSize = next;
  Sound.play('levelup');
  UI.toast(`背包扩容到 ${next} 格`, 'good');
  save();
  openShop();
}

/* ---------------- 背包界面 ---------------- */

type BagFilter = 'all' | 'seed' | 'crop' | 'fish' | 'product' | 'material' | 'tool';
let bagFilter: BagFilter = 'all';
let bagSel = -1;

function openBag(): void {
  bagSel = -1;
  renderBag();
}

function renderBag(): void {
  const tabs: Array<{ id: BagFilter; label: string }> = [
    { id: 'all', label: '全部' },
    { id: 'seed', label: '种子' },
    { id: 'crop', label: '作物' },
    { id: 'fish', label: '鱼' },
    { id: 'product', label: '产物' },
    { id: 'material', label: '材料' },
    { id: 'tool', label: '工具' }
  ];
  const tabHtml = tabs.map((t) =>
    `<button class="tab${bagFilter === t.id ? ' on' : ''}" data-tab="${t.id}">${t.label}</button>`
  ).join('');

  let gridHtml = '';
  if (bagFilter === 'tool') {
    gridHtml = `<div class="bag-grid tools">${(Object.keys(TOOLS) as ToolId[]).map((id) => {
      const st = state.tools[id];
      const def = TOOLS[id];
      if (!st.owned) {
        return `<div class="bag-slot locked"><span class="ic">🔒</span><span class="nm">${def.name}</span></div>`;
      }
      return `<div class="bag-slot tool" data-toolid="${id}">
        <span class="ic">${def.icon}</span>
        <span class="nm">${['铜', '银', '金', '秘银'][st.tier - 1]}${def.name}</span></div>`;
    }).join('')}</div>`;
  } else {
    gridHtml = `<div class="bag-grid">${state.bag.map((s, i) => {
      if (!s) return `<div class="bag-slot empty" data-slot="${i}"></div>`;
      if (bagFilter !== 'all' && s.kind !== bagFilter) {
        return `<div class="bag-slot dimmed" data-slot="${i}"></div>`;
      }
      const def = getDef(s.id);
      const star = s.quality ? `<span class="st">${'★'.repeat(s.quality)}</span>` : '';
      return `<div class="bag-slot${bagSel === i ? ' sel' : ''}" data-slot="${i}">
        <span class="ic">${def?.icon ?? '?'}</span>
        <span class="ct">${s.qty}</span>
        ${star}
      </div>`;
    }).join('')}</div>`;
  }

  // 详情
  let detail = '<p class="dim">点击格子查看详情</p>';
  if (bagFilter === 'tool') {
    detail = '<p class="dim">点击工具放入快捷栏</p>';
  } else if (bagSel >= 0 && state.bag[bagSel]) {
    const s = state.bag[bagSel]!;
    const def = getDef(s.id);
    detail = `<div class="bag-detail">
      <div><b>${def?.name ?? s.id}</b>${s.quality ? ` <span class="st">${'★'.repeat(s.quality)}</span>` : ''} ×${s.qty}</div>
      <div class="dim">${def?.desc ?? ''}</div>
      <div class="det-actions">
        ${s.kind === 'seed' ? '<button class="btn small" id="d-hotbar">放入快捷栏</button>' : ''}
        <button class="btn small ghost" id="d-drop">丢弃 1 个</button>
      </div>
    </div>`;
  }

  UI.showModal(
    '背包',
    `<div class="tabs">${tabHtml}</div>
     ${gridHtml}
     <div class="bag-detail-wrap">${detail}</div>`,
    [{ label: '关闭', cls: 'ghost', onClick: () => UI.hideModal() }],
    true
  );

  document.querySelectorAll<HTMLElement>('[data-tab]').forEach((el) => {
    el.addEventListener('click', () => {
      bagFilter = el.dataset.tab as BagFilter;
      bagSel = -1;
      renderBag();
    });
  });
  document.querySelectorAll<HTMLElement>('[data-slot]').forEach((el) => {
    el.addEventListener('click', () => {
      const i = Number(el.dataset.slot);
      const s = state.bag[i];
      if (!s) {
        bagSel = -1;
        renderBag();
        return;
      }
      // 被当前筛选排除的格子不响应点击
      if (bagFilter !== 'all' && s.kind !== bagFilter) return;
      bagSel = i;
      renderBag();
    });
  });
  document.querySelectorAll<HTMLElement>('[data-toolid]').forEach((el) => {
    el.addEventListener('click', () => {
      putToolInHotbar(el.dataset.toolid as ToolId);
      renderBag();
    });
  });
  document.getElementById('d-hotbar')?.addEventListener('click', () => {
    const s = state.bag[bagSel];
    if (!s) return;
    putSeedInHotbar(s.id);
    renderBag();
  });
  document.getElementById('d-drop')?.addEventListener('click', () => {
    const s = state.bag[bagSel];
    if (!s) return;
    Bag.removeFromBag(state.bag, s.id, 1, s.quality);
    UI.toast(`丢弃了 1 个 ${getDef(s.id)?.name ?? ''}`);
    if (!state.bag[bagSel]) bagSel = -1;
    UI.resetHotbarCache();
    renderBag();
  });
}

function putToolInHotbar(id: ToolId): void {
  const existing = state.hotbar.findIndex((r) => r && r.type === 'tool' && r.id === id);
  if (existing >= 0) {
    state.equipSlot = existing;
    UI.toast(`${TOOLS[id].name}已在快捷栏 ${existing + 1}`);
    UI.resetHotbarCache();
    return;
  }
  const slot = state.hotbar.findIndex((r) => r === null);
  const target = slot >= 0 ? slot : state.equipSlot;
  state.hotbar[target] = { type: 'tool', id };
  state.equipSlot = target;
  UI.resetHotbarCache();
  UI.toast(`${TOOLS[id].name} 放入快捷栏 ${target + 1}`);
}

function putSeedInHotbar(itemId: string): void {
  const existing = state.hotbar.findIndex((r) => r && r.type === 'seed' && r.id === itemId);
  if (existing >= 0) {
    state.equipSlot = existing;
    UI.resetHotbarCache();
    UI.toast('已经在快捷栏里了');
    return;
  }
  const slot = state.hotbar.findIndex((r) => r === null);
  const target = slot >= 0 ? slot : state.equipSlot;
  state.hotbar[target] = { type: 'seed', id: itemId };
  state.equipSlot = target;
  UI.resetHotbarCache();
  UI.toast(`${getDef(itemId)?.name ?? '种子'} 放入快捷栏 ${target + 1}`);
}

/* ---------------- 词库界面 ---------------- */

let editingSet: CustomSet | null = null;

function uid(): string {
  return 'ws' + Math.random().toString(36).slice(2, 8);
}

function catOptions(current: string): string {
  const opts: Array<[string, string]> = [
    ['all', '全部动作'],
    ...(Object.keys(CATEGORY_LABEL) as WordCategory[]).map((c) => [c, CATEGORY_LABEL[c]] as [string, string])
  ];
  return opts.map(([v, l]) => `<option value="${v}"${v === current ? ' selected' : ''}>${l}</option>`).join('');
}

function openWords(): void {
  editingSet = null;
  renderWords();
}

function renderWords(): void {
  const sets = getCustomSets();
  const cats = Object.keys(CATEGORY_LABEL) as WordCategory[];
  const stats = cats.map((c) => `${CATEGORY_LABEL[c]} ${totalWords(c)}`).join(' · ');

  // 档位覆盖表：每类 × 每档的词数，空档标红
  const covHead = BANDS.map((b) => `<th title="难度分 ${b.min} ~ ${b.max === 999 ? '∞' : b.max}">${b.label}</th>`).join('');
  const covRows = cats.map((c) => {
    const counts = bandStats(c);
    const cells = counts.map((n) => {
      const cls = n === 0 ? 'zero' : n <= 2 ? 'thin' : '';
      const tip = n === 0 ? '该档无词，会向邻近档借词' : `${n} 个词`;
      return `<td class="${cls}" title="${tip}">${n}</td>`;
    }).join('');
    return `<tr><td class="cat">${CATEGORY_LABEL[c]}</td>${cells}</tr>`;
  }).join('');
  const coverage = `<table class="cov"><thead><tr><th></th>${covHead}</tr></thead><tbody>${covRows}</tbody></table>
    <p class="dim cov-note">数字 = 该档可用词数。<span class="cov-zero">红色 0</span> 表示该档没有词，打到这里会向邻近档借词，价值曲线会稍微变形。</p>`;

  const listHtml = sets.length === 0
    ? '<p class="dim">还没有自定义词库。在下面新建一个，或者从别处导入。</p>'
    : `<div class="words-list">${sets.map((s) => `
        <div class="word-row">
          <div class="wr-main">
            <b>${s.name}</b>
            <span class="wr-meta">${s.bind === 'all' ? '全部动作' : CATEGORY_LABEL[s.bind as WordCategory]} · ${s.words.length} 词 · ${s.enabled ? '启用中' : '已停用'}</span>
          </div>
          <div class="wr-btns">
            <button class="btn tiny ${s.enabled ? '' : 'ghost'}" data-toggle="${s.id}">${s.enabled ? '停用' : '启用'}</button>
            <button class="btn tiny ghost" data-edit="${s.id}">编辑</button>
            <button class="btn tiny ghost" data-del="${s.id}">删除</button>
          </div>
        </div>`).join('')}</div>`;

  const form = editingSet
    ? `<div class="words-form">
        <div class="wf-row">
          <input id="ws-name" class="inp" maxlength="20" placeholder="词库名称" value="${editingSet.name.replace(/"/g, '&quot;')}">
          <select id="ws-bind" class="inp">${catOptions(editingSet.bind)}</select>
        </div>
        <textarea id="ws-text" class="inp ta" rows="5" placeholder="一行一个词，或用空格/逗号分隔。只保留英文字母，长度 2~14。">${editingSet.words.join(' ')}</textarea>
        <div id="ws-preview" class="ws-preview dim"></div>
        <div class="wf-row right">
          <button class="btn tiny ghost" id="ws-cancel">取消</button>
          <button class="btn tiny green" id="ws-save">保存</button>
        </div>
      </div>`
    : `<div class="wf-row"><button class="btn small" id="ws-new">＋ 新建词库</button></div>`;

  UI.showModal(
    '词库',
    `<p class="dim">
       打什么词，与做什么事是分开的：每个动作只决定「要一个多难的词」。
       价值越高、词越难。难度不只看长度——重复字符、左右手交替都算在内。
     </p>
     <p class="dim">当前可用词数：${stats}</p>
     ${coverage}
     ${listHtml}
     <h3>${editingSet ? '编辑 / 新建' : '新建'}</h3>
     ${form}
     <h3>导入 / 导出</h3>
     <textarea id="ws-io" class="inp ta" rows="3" placeholder="导出后这里会出现 JSON；也可以粘贴 JSON，或者直接粘贴一串单词再点导入。"></textarea>
     <div class="wf-row right">
       <button class="btn tiny ghost" id="ws-export">导出全部</button>
       <button class="btn tiny ghost" id="ws-import">导入</button>
     </div>`,
    [{ label: '关闭', cls: 'ghost', onClick: () => UI.hideModal() }],
    true
  );

  // 保存前的难度分布预览
  const previewEl = document.getElementById('ws-preview');
  const textEl = document.getElementById('ws-text') as HTMLTextAreaElement | null;
  const updatePreview = (): void => {
    if (!previewEl || !textEl) return;
    const words = normalizeWords(textEl.value);
    if (words.length === 0) {
      previewEl.textContent = '输入单词后，这里会显示难度分布';
      return;
    }
    const dist = distribution(words);
    const parts = BANDS.map((b, i) => dist[i] > 0 ? `${b.label}×${dist[i]}` : null).filter(Boolean);
    previewEl.textContent = `识别 ${words.length} 词 · ${parts.join(' ')}`;
  };
  textEl?.addEventListener('input', updatePreview);
  updatePreview();

  document.getElementById('ws-new')?.addEventListener('click', () => {
    editingSet = { id: uid(), name: '', bind: 'all', words: [], enabled: true };
    renderWords();
  });

  document.querySelectorAll<HTMLElement>('[data-edit]').forEach((el) => {
    el.addEventListener('click', () => {
      const s = getCustomSets().find((x) => x.id === el.dataset.edit);
      if (s) {
        editingSet = { ...s, words: [...s.words] };
        renderWords();
      }
    });
  });

  document.querySelectorAll<HTMLElement>('[data-del]').forEach((el) => {
    el.addEventListener('click', () => {
      removeCustom(el.dataset.del as string);
      if (editingSet && editingSet.id === el.dataset.del) editingSet = null;
      UI.toast('已删除');
      renderWords();
    });
  });

  document.querySelectorAll<HTMLElement>('[data-toggle]').forEach((el) => {
    el.addEventListener('click', () => {
      toggleCustom(el.dataset.toggle as string);
      renderWords();
    });
  });

  document.getElementById('ws-save')?.addEventListener('click', () => {
    if (!editingSet) return;
    const nameEl = document.getElementById('ws-name') as HTMLInputElement | null;
    const bindEl = document.getElementById('ws-bind') as HTMLSelectElement | null;
    const textEl = document.getElementById('ws-text') as HTMLTextAreaElement | null;
    const name = (nameEl?.value ?? '').trim() || '未命名词库';
    const words = normalizeWords(textEl?.value ?? '');
    if (words.length === 0) {
      UI.toast('没有识别到有效的英文单词', 'bad');
      return;
    }
    upsertCustom({
      id: editingSet.id,
      name,
      bind: (bindEl?.value ?? 'all') as CustomSet['bind'],
      words,
      enabled: true
    });
    editingSet = null;
    UI.toast(`保存 ${name}（${words.length} 词）`, 'good');
    renderWords();
  });

  document.getElementById('ws-cancel')?.addEventListener('click', () => {
    editingSet = null;
    renderWords();
  });

  document.getElementById('ws-export')?.addEventListener('click', () => {
    const io = document.getElementById('ws-io') as HTMLTextAreaElement | null;
    if (!io) return;
    io.value = JSON.stringify(getCustomSets(), null, 2);
    UI.toast('已导出到文本框，选中复制即可');
  });

  document.getElementById('ws-import')?.addEventListener('click', () => {
    const io = document.getElementById('ws-io') as HTMLTextAreaElement | null;
    if (!io) return;
    const raw = io.value.trim();
    if (!raw) return;

    let imported = 0;
    try {
      const data = JSON.parse(raw) as CustomSet | CustomSet[];
      const arr = Array.isArray(data) ? data : [data];
      for (const s of arr) {
        if (!s || !Array.isArray(s.words)) continue;
        upsertCustom({
          id: uid(),
          name: s.name || '导入的词库',
          bind: s.bind ?? 'all',
          words: normalizeWords(s.words.join(' ')),
          enabled: true
        });
        imported++;
      }
    } catch {
      const words = normalizeWords(raw);
      if (words.length > 0) {
        upsertCustom({ id: uid(), name: '导入的词库', bind: 'all', words, enabled: true });
        imported = 1;
      }
    }

    if (imported > 0) {
      UI.toast(`导入 ${imported} 个词库`, 'good');
      renderWords();
    } else {
      UI.toast('没能解析出词库', 'bad');
    }
  });
}

/* ---------------- 房屋 ---------------- */

function openHouse(): void {
  UI.showModal(
    '温暖的小屋',
    `<p>墙上挂着爷爷的旧照片，桌上还有半杯凉茶。</p>
     <div class="report-grid">
       <span class="k">现在是</span><span class="v">第 ${state.day} 天 ${UI.clockText(state.time)}</span>
       <span class="k">体力</span><span class="v">${Math.round(state.stamina)} / ${CFG.STAMINA_MAX}</span>
       <span class="k">金币</span><span class="v">${state.coins} G</span>
     </div>
     <p class="dim">睡觉会结束今天，作物在夜里生长；没浇水的作物不会长。</p>`,
    [
      { label: '农场图鉴', cls: 'ghost', onClick: openDex },
      { label: '睡一觉', cls: 'green', onClick: () => { UI.hideModal(); sleep(); } },
      { label: '离开', cls: 'ghost', onClick: () => UI.hideModal() }
    ]
  );
}

function openDex(): void {
  const items = CROP_ORDER.map((id) => {
    const c = CROPS[id];
    return `<div class="dex-item"><span class="em">${c.emoji}</span>
      <span class="info"><b>${c.zh}</b> <span class="en">${c.en}</span><br>
      ${c.days}天 · ${c.price}G · ${SEASON_ICON[c.season]}${SEASON_LABEL[c.season]}季</span></div>`;
  }).join('');
  const toolsHtml = (Object.keys(TOOLS) as ToolId[]).map((id) => {
    const t = TOOLS[id];
    return `<div class="dex-item"><span class="em">${t.icon}</span>
      <span class="info"><b>${t.name}</b><br>${t.actionLabel} · 打 <span class="en">${t.flavor}</span></span></div>`;
  }).join('');
  const animalsHtml = ANIMAL_ORDER.map((kind) => {
    const a = ANIMAL_DEFS[kind];
    return `<div class="dex-item"><span class="em">${a.icon}</span>
      <span class="info"><b>${a.name}</b><br>产${a.productName} · ${a.price}G 购入</span></div>`;
  }).join('');
  UI.showModal(
    '农场图鉴',
    `<h3>作物</h3><div class="dex-grid">${items}</div>
     <h3>工具</h3><div class="dex-grid">${toolsHtml}</div>
     <h3>动物</h3><div class="dex-grid">${animalsHtml}</div>`,
    [{ label: '返回', cls: 'ghost', onClick: () => UI.hideModal() }],
    true
  );
}

/* ---------------- 一天的结算 ---------------- */

function sleep(fainted = false): void {
  const reportDay = state.day;
  const harvested = state.todayHarvest;
  const earned = state.todayEarned;
  const oldSeason = seasonOfDay(reportDay);

  // 作物生长：当季 1 倍速，反季 2 倍慢（生长累积，跨夜保留进度）
  for (const plot of state.plots) {
    if (plot.crop) {
      if (plot.watered) {
        const def = CROPS[plot.crop];
        const mult = growthMultiplier(def, oldSeason);
        plot.growth = (plot.growth ?? 0) + 1 / mult;
        while (plot.growth >= 1 && plot.stage < def.days) {
          plot.stage++;
          plot.growth -= 1;
        }
        if (plot.stage >= def.days) plot.growth = 0;
      }
      plot.watered = false;
    }
  }

  // 动物结算：喂了 → 明天有产物；没喂 → 掉心情
  settleAnimalsOvernight(state);

  state.day++;
  state.stats.daysPlayed++;
  state.time = CFG.DAY_START;
  state.stamina = CFG.STAMINA_MAX;

  const newSeason = seasonOfDay(state.day);
  const changedSeason = newSeason !== oldSeason;
  state.weather = rollWeather(newSeason);
  if (changedSeason) applySeason(newSeason);

  // 节点恢复
  for (const n of state.nodes) {
    if (n.hp <= 0 && n.regrowDay > 0 && state.day >= n.regrowDay) {
      n.hp = n.maxHp;
      n.regrowDay = 0;
    }
  }
  // 清掉已消失的杂草
  state.nodes = state.nodes.filter((n) => n.kind !== 'weed' || n.hp > 0);

  // 只有雨会自动浇灌；雪不会
  if (weatherWaters(state.weather)) {
    for (const plot of state.plots) if (plot.crop) plot.watered = true;
  }

  spawnWeeds(state, 5 + Math.floor(Math.random() * 4));
  syncBlockers(state);

  state.todayHarvest = 0;
  state.todayEarned = 0;
  state.todayCleared = 0;
  state.combo = 0;
  pending = null;
  currentLabel = '走近田地，按空格开始劳作';
  UI.resetTypingCache();
  UI.resetHotbarCache();

  save();
  Sound.play('day');

  const weatherNote = state.weather === 'rain'
    ? '<p class="dim">🌧️ 外面下起了雨，作物今晚会自动喝饱水。</p>'
    : state.weather === 'snow'
      ? '<p class="dim">🌨️ 明天飘雪。雪不会浇灌作物，记得手动浇水。</p>'
      : '<p class="dim">☀️ 明天是个晴天，记得给作物浇水。</p>';

  const seasonNote = changedSeason
    ? `<p class="season-note">${SEASON_ICON[newSeason]} <b>${SEASON_LABEL[newSeason]}天来了！</b>当季作物正常生长，反季的会慢一倍。</p>`
    : '';

  UI.showModal(
    fainted ? `第 ${reportDay} 天 · 累倒了` : `第 ${reportDay} 天 · 晚安`,
    `${fainted ? '<p style="color:#c0392b;font-weight:700">你在田里睡着了，邻居把你送回了家。</p>' : ''}
     <div class="report-grid">
       <span class="k">今日收获</span><span class="v">${harvested} 件</span>
       <span class="k">今日收入</span><span class="v">${earned} G</span>
       <span class="k">持有金币</span><span class="v">${state.coins} G</span>
       <span class="k">连击纪录</span><span class="v">×${state.stats.maxCombo}</span>
     </div>
     ${seasonNote}${weatherNote}`,
    [{ label: `开始第 ${state.day} 天`, cls: 'green', onClick: () => UI.hideModal() }]
  );
}

function faint(): void {
  const fee = Math.min(state.coins, Math.round(state.coins * CFG.FAINT_FEE_RATE));
  state.coins -= fee;
  state.stamina = 0;
  save();
  sleep(true);
  if (fee > 0) UI.toast(`医药费 -${fee} G`, 'bad');
}

/* ---------------- 玩家移动 ---------------- */

function updatePlayer(dt: number): void {
  const p = state.player;
  if (session.active || UI.isModalOpen() || fishing.phase !== 'idle') {
    p.moving = false;
    return;
  }

  let dx = 0;
  let dy = 0;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) dx -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) dx += 1;
  if (keys.has('KeyW') || keys.has('ArrowUp')) dy -= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) dy += 1;

  if (dx === 0 && dy === 0) {
    p.moving = false;
    return;
  }

  if (dx !== 0 && dy !== 0) {
    const inv = 1 / Math.SQRT2;
    dx *= inv;
    dy *= inv;
  }

  const run = keys.has('ShiftLeft') || keys.has('ShiftRight');
  const speed = run ? 250 : 168;

  const nx = p.x + dx * speed * dt;
  const ny = p.y + dy * speed * dt;

  if (canStand(nx, p.y)) p.x = nx;
  if (canStand(p.x, ny)) p.y = ny;

  p.moving = true;
  p.walkT += dt;

  if (Math.abs(dx) > Math.abs(dy)) p.dir = dx > 0 ? 'right' : 'left';
  else if (dy !== 0) p.dir = dy > 0 ? 'down' : 'up';
}

/* ---------------- 快捷栏 ---------------- */

function selectSlot(i: number): void {
  if (i < 0 || i >= state.hotbar.length) return;
  const ref = state.hotbar[i];
  if (!ref) {
    state.equipSlot = i;
    UI.resetHotbarCache();
    return;
  }
  if (ref.type === 'seed' && Bag.countInBag(state.bag, ref.id) <= 0) {
    UI.toast('这个种子用完了', 'bad');
    state.hotbar[i] = null;
    UI.resetHotbarCache();
    return;
  }
  state.equipSlot = i;
  Sound.play('click');
  UI.resetHotbarCache();
}

function cycleSlot(dir: number): void {
  const n = state.hotbar.length;
  let i = state.equipSlot;
  for (let k = 1; k <= n; k++) {
    const next = (i + dir * k + n * 2) % n;
    if (state.hotbar[next]) {
      selectSlot(next);
      return;
    }
  }
}

/* ---------------- 主循环 ---------------- */

function frame(ts: number): void {
  const dt = Math.min(0.05, Math.max(0, (ts - lastTs) / 1000));
  lastTs = ts;

  if (running) {
    tickFishing(ts);
    if (session.active) session.update(ts);
    updatePlayer(dt);
    if (!session.active && !UI.isModalOpen() && fishing.phase === 'idle') {
      updateAnimals(state, dt);
    }
  }

  render(state, dt, ts);

  if (running) {
    UI.syncHud(state);
    if (fishing.phase === 'wait') {
      UI.syncFishing('wait', 1, currentLabel);
    } else if (fishing.phase === 'bite') {
      UI.syncFishing('bite', (fishing.biteEnd - ts) / fishing.window, currentLabel);
    } else {
      UI.syncTyping(session, currentLabel, state.combo);
    }
    UI.renderHotbar(state, selectSlot);
  }

  requestAnimationFrame(frame);
}

/* ---------------- 输入 ---------------- */

function onKeyDown(e: KeyboardEvent): void {
  if (!running) return;

  if (UI.isModalOpen()) {
    if (e.code === 'Escape') UI.hideModal();
    return;
  }

  // 咬钩瞬间：任意提交键都能提竿
  if (fishing.phase === 'bite') {
    if (e.code === 'Space' || e.code === 'KeyE' || e.code === 'Enter') {
      e.preventDefault();
      onReelPress(performance.now());
    }
    return;
  }

  if (fishing.phase === 'wait') {
    if (e.code === 'Space') {
      e.preventDefault();
      UI.toast('还早呢，别急着提竿');
    } else if (e.code === 'Escape') {
      e.preventDefault();
      cancelFishing();
    }
    return;
  }

  if (session.active) {
    if (session.handleKey(e.key, performance.now())) e.preventDefault();
    return;
  }

  if (e.repeat) return;

  keys.add(e.code);

  switch (e.code) {
    case 'Space':
    case 'KeyE':
    case 'Enter':
      e.preventDefault();
      UI.hideHint();
      tryInteract();
      break;
    case 'Tab':
    case 'KeyB':
      e.preventDefault();
      openBag();
      break;
    case 'KeyQ':
      e.preventDefault();
      cycleSlot(-1);
      break;
    case 'ArrowUp':
    case 'ArrowDown':
    case 'ArrowLeft':
    case 'ArrowRight':
      e.preventDefault();
      break;
    default:
      if (e.code.startsWith('Digit')) {
        const n = Number(e.code.slice(5)) - 1;
        if (n >= 0 && n < 8) selectSlot(n);
      }
  }
}

function onKeyUp(e: KeyboardEvent): void {
  keys.delete(e.code);
}

/* ---------------- 启动 ---------------- */

function startGame(fresh: boolean): void {
  if (fresh) state = newState();
  applySeason(seasonOfDay(state.day));
  running = true;
  UI.hideHint();
  document.getElementById('title-screen')?.classList.add('hidden');
  Sound.init();
  Sound.startBGM();
  UI.resetHotbarCache();
  UI.syncHud(state);
  UI.resetTypingCache();

  if (fresh) showIntro();
}

function showIntro(): void {
  UI.showModal(
    '爷爷的信',
    `<p>“这片地荒了很多年。但土是好的，水是好的。”</p>
     <p style="background:#efe2c8;border-left:4px solid #b08b57;padding:10px 14px;border-radius:6px">
       <b>hoe</b> 开垦 · <b>water</b> 浇水 · <b>turnip</b> 播种 · <b>harvest</b> 收获</p>
     <p class="dim">
       走到田边面朝土地按 <b>空格</b>，用当前工具完成农活。<br>
       工具会自动切换；斧头、镐、镰刀要去订购箱买。<br>
       砍树挖石得来的木材石材，是升级工具的必需品。
     </p>`,
    [{ label: '开始干活', cls: 'green', onClick: () => UI.hideModal() }]
  );
}

function setupTitle(): void {
  const btnNew = UI.$('btn-new');
  const btnCont = UI.$('btn-continue');

  if (hasSave()) btnCont.classList.remove('hidden');

  btnNew.addEventListener('click', () => startGame(true));
  btnCont.addEventListener('click', () => {
    if (!loadSave()) { startGame(true); return; }
    startGame(false);
    UI.toast('回到农场', 'good');
  });

  UI.$('btn-bag').addEventListener('click', () => {
    if (running && !UI.isModalOpen() && !session.active) openBag();
  });

  UI.$('btn-words').addEventListener('click', () => {
    if (!running) return;
    if (session.active || fishing.phase !== 'idle') return;
    openWords();
  });

  UI.$('btn-help').addEventListener('click', () => {
    if (!running) return;
    UI.showModal(
      '怎么玩',
      `<h3>操作</h3>
       <ul>
         <li><b>WASD / 方向键</b> 移动，<b>Shift</b> 跑</li>
         <li><b>空格 / E</b> 使用手持物</li>
         <li><b>1~8</b> 选快捷栏，<b>Q</b> 循环，<b>Tab</b> 背包</li>
       </ul>
       <h3>工具</h3>
       <ul>
         <li>锄头 开垦 · 水壶 浇水 · 斧头 砍树 · 镐 挖石 · 镰刀 割草 · 钓竿 钓鱼</li>
         <li>拿错工具时，只要快捷栏里有对的，会自动换上</li>
         <li>斧头连砍三下放倒一棵树，镐要两下敲碎岩石</li>
         <li>升级工具需要 木材 / 石材，所以要先去砍树挖石</li>
         <li>钓鱼：抛竿 → 等浮标动 → 咬钩瞬间按空格 → 打一个词收线，反应越快星级越高</li>
       </ul>
       <h3>动物</h3>
       <ul>
         <li>订购箱买鸡 / 牛，走到围栏里面朝动物按空格照料</li>
         <li>喂食 → 第二天才有蛋 / 奶；抚摸涨心情</li>
         <li>心情决定蛋 / 奶品质，饿着会掉心情</li>
         <li>挤奶是三连短词，像挤奶的节奏</li>
       </ul>
       <h3>四季</h3>
       <ul>
         <li>一年 32 天，每季 8 天：春 🌸 夏 ☀️ 秋 🍂 冬 ❄️</li>
         <li>每种作物有适宜季节，当季正常长，<b>反季慢一倍</b></li>
         <li>春种萝卜/土豆/草莓，夏种番茄/玉米，秋种卷心菜/南瓜，冬种菠菜</li>
         <li>春雨多、冬飘雪；雨自动浇灌，雪不会，冬天要手动浇水</li>
       </ul>
       <h3>一天的循环</h3>
       <ul>
         <li>每做一次农活消耗体力并推进时间，22:00 后体力消耗翻倍</li>
         <li>回屋睡觉 → 浇过水的作物生长；杂草每天重新长出来</li>
         <li>体力耗尽或凌晨 2 点会累倒，扣医药费</li>
       </ul>
       <h3>打字技巧</h3>
       <ul>
         <li>打错不中断，但会断连击、掉品质</li>
         <li>超时才算失败，只消耗一半体力</li>
         <li>连击 5/10/20/40 回复体力</li>
         <li>收获是两词连打</li>
       </ul>`,
      [{ label: '知道了', cls: 'green', onClick: () => UI.hideModal() }]
    );
  });

  UI.$('btn-sound').addEventListener('click', () => {
    const on = Sound.toggle();
    UI.$('btn-sound').textContent = on ? '🔊' : '🔇';
  });
}

export function boot(): void {
  buildMap();

  const cv = UI.$<HTMLCanvasElement>('cv');
  initRenderer(cv, window.devicePixelRatio || 1);

  state = newState();
  UI.bindModalMask();
  setupTitle();

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', () => keys.clear());
  window.addEventListener('beforeunload', () => {
    if (running) save();
  });

  lastTs = performance.now();
  requestAnimationFrame(frame);

  (window as unknown as Record<string, unknown>).__farm = {
    get state() { return state; },
    get pending() { return pending; },
    get fishing() { return fishing; },
    session,
    interact: tryInteract,
    save,
    newState,
    debugCamera,
    debugSampleBase
  };
}
