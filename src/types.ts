/* ============================================================
   类型定义（v2：物品 / 工具 / 背包 / 资源节点）
   ============================================================ */

export type CropId =
  | 'turnip'
  | 'potato'
  | 'cabbage'
  | 'tomato'
  | 'corn'
  | 'pumpkin'
  | 'strawberry'
  | 'spinach';

export type ToolId = 'hoe' | 'can' | 'axe' | 'pick' | 'sickle' | 'rod';

export type Dir = 'down' | 'up' | 'left' | 'right';
export type Weather = 'sunny' | 'rain' | 'snow';
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export type FruitShape = 'round' | 'long' | 'berry' | 'gourd' | 'root' | 'leafy';

export interface CropDef {
  id: CropId;
  zh: string;
  en: string;
  days: number;
  price: number;
  seed: number;
  leaf: string;
  fruit: string;
  shape: FruitShape;
  emoji: string;
  /** 适宜季节；反季生长 ×2 慢 */
  season: Season;
}

export interface Word {
  text: string;
  zh: string;
  /** 打字难度分（长度 + 手感修正），用于时限计算 */
  diff?: number;
}

/* ---------------- 物品 ---------------- */

export type ItemKind = 'seed' | 'crop' | 'material' | 'tool' | 'fish' | 'product';

export interface ItemDef {
  id: string;
  kind: ItemKind;
  name: string;
  icon: string;
  /** 单格堆叠上限 */
  max: number;
  /** 中文说明 */
  desc: string;
  /** 1 星基础售价（作物 / 鱼有，素材为 0） */
  price?: number;
}

export interface ItemStack {
  /** 物品定义 id，例如 seed.turnip / crop.corn / mat.wood */
  id: string;
  kind: ItemKind;
  qty: number;
  /** 仅作物：品质 1~5 */
  quality?: number;
}

/* ---------------- 工具栏 ---------------- */

export type HotbarRef =
  | { type: 'tool'; id: ToolId }
  | { type: 'seed'; id: string };

/* ---------------- 工具 ---------------- */

export interface ToolState {
  id: ToolId;
  owned: boolean;
  /** 1~4：铜 / 银 / 金 / 秘银 */
  tier: number;
}

/* ---------------- 资源节点 ---------------- */

export type NodeKind = 'tree' | 'rock' | 'weed';

export interface ResNode {
  key: string;
  kind: NodeKind;
  tx: number;
  ty: number;
  hp: number;
  maxHp: number;
  /** 重新长好的日子；0 表示已消失（杂草） */
  regrowDay: number;
}

/* ---------------- 动物 ---------------- */

export type AnimalKind = 'chicken' | 'cow';

export interface Animal {
  id: string;
  kind: AnimalKind;
  /** 心情 0~100，决定产物品质 */
  happiness: number;
  fedToday: boolean;
  pettedToday: boolean;
  /** 蛋 / 奶是否可收 */
  productReady: boolean;
  x: number;
  y: number;
  dir: Dir;
  moving: boolean;
  /** 游走计时与目标 */
  wanderT: number;
  tx: number;
  ty: number;
}

/* ---------------- 地块 ---------------- */

export interface Plot {
  tilled: boolean;
  crop: CropId | null;
  stage: number;
  watered: boolean;
  quality: number;
  /** 当前阶段的生长累积 0~1；反季每晚 +0.5，当季 +1。旧存档缺省按 0 */
  growth?: number;
}

export interface Player {
  x: number;
  y: number;
  dir: Dir;
  moving: boolean;
  walkT: number;
}

export interface Stats {
  harvested: number;
  sold: number;
  earned: number;
  actions: number;
  maxCombo: number;
  daysPlayed: number;
  chopped: number;
  mined: number;
  fishCaught: number;
  animalsTended: number;
  productsCollected: number;
}

export interface GameState {
  version: number;
  day: number;
  time: number;
  weather: Weather;
  stamina: number;
  coins: number;
  plots: Plot[];
  combo: number;
  player: Player;
  stats: Stats;
  todayHarvest: number;
  todayEarned: number;

  /* v2 新增 */
  bag: (ItemStack | null)[];
  bagSize: number;
  hotbar: (HotbarRef | null)[];
  equipSlot: number;
  tools: Record<ToolId, ToolState>;
  nodes: ResNode[];
  animals: Animal[];
  autoSwitch: boolean;
  /** 今日已割草数量（用于统计） */
  todayCleared: number;
}
