/* ============================================================
   pathfind.ts — 格子寻路（A*）
   ------------------------------------------------------------
   玩家点击移动和 NPC 走位**共用同一套寻路**。

   地图 50×22 = 1100 格，4 方向 A* 单次耗时 < 1ms，
   所以不需要预计算导航网格，每次现算就行。

   4 方向而不是 8 方向：角色贴图只有上下左右四向，
   斜走会让朝向和位移对不上，看起来像在滑。
   ============================================================ */

export interface PathNode {
  tx: number;
  ty: number;
}

/** 判断某格能不能走（由调用方注入，以适配不同场景） */
export type WalkTest = (tx: number, ty: number) => boolean;

const DIRS: Array<[number, number]> = [
  [0, -1], [1, 0], [0, 1], [-1, 0]
];

interface SearchNode {
  tx: number;
  ty: number;
  g: number;
  f: number;
  parent: SearchNode | null;
}

/**
 * 从 (sx,sy) 走到 (gx,gy)，返回不含起点、含终点的格子序列。
 * 走不通返回 null。
 */
export function findPath(
  sx: number, sy: number,
  gx: number, gy: number,
  walkable: WalkTest,
  maxNodes = 4000
): PathNode[] | null {
  if (sx === gx && sy === gy) return [];
  if (!walkable(gx, gy)) return null;

  const open: SearchNode[] = [];
  const openMap = new Map<string, SearchNode>();
  const closed = new Set<string>();
  const key = (x: number, y: number): string => x + ',' + y;

  const h = (x: number, y: number): number => Math.abs(x - gx) + Math.abs(y - gy);

  const start: SearchNode = { tx: sx, ty: sy, g: 0, f: h(sx, sy), parent: null };
  open.push(start);
  openMap.set(key(sx, sy), start);

  let expanded = 0;

  while (open.length > 0) {
    // 取 f 最小的（格子数不多，线性找够了）
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[bestIdx].f) bestIdx = i;
    }
    const cur = open.splice(bestIdx, 1)[0];
    openMap.delete(key(cur.tx, cur.ty));

    if (cur.tx === gx && cur.ty === gy) {
      // 回溯
      const path: PathNode[] = [];
      let n: SearchNode | null = cur;
      while (n && n.parent) {
        path.push({ tx: n.tx, ty: n.ty });
        n = n.parent;
      }
      path.reverse();
      return path;
    }

    closed.add(key(cur.tx, cur.ty));
    if (++expanded > maxNodes) break;

    for (const [dx, dy] of DIRS) {
      const nx = cur.tx + dx;
      const ny = cur.ty + dy;
      const nk = key(nx, ny);
      if (closed.has(nk)) continue;
      if (!walkable(nx, ny)) continue;

      const g = cur.g + 1;
      const existing = openMap.get(nk);
      if (existing && existing.g <= g) continue;

      const node: SearchNode = { tx: nx, ty: ny, g, f: g + h(nx, ny), parent: cur };
      if (existing) {
        existing.g = g;
        existing.f = node.f;
        existing.parent = cur;
      } else {
        open.push(node);
        openMap.set(nk, node);
      }
    }
  }
  return null;
}

/**
 * 目标不可走时，找一个最近的可行走格。
 * 用户点击水面/墙时，应该走到它旁边而不是没反应。
 */
export function nearestWalkable(
  gx: number, gy: number,
  walkable: WalkTest,
  maxRadius = 6
): PathNode | null {
  if (walkable(gx, gy)) return { tx: gx, ty: gy };
  for (let r = 1; r <= maxRadius; r++) {
    let best: PathNode | null = null;
    let bestD = Infinity;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        // 只看这一圈的边框
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = gx + dx;
        const ny = gy + dy;
        if (!walkable(nx, ny)) continue;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = { tx: nx, ty: ny }; }
      }
    }
    if (best) return best;
  }
  return null;
}

/**
 * 把格子路径简化成「拐点」序列。
 * 直线上连续同方向的格子合并，减少移动时的抖动。
 */
export function simplifyPath(path: PathNode[]): PathNode[] {
  if (path.length <= 2) return path;
  const out: PathNode[] = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const prev = path[i - 1];
    const cur = path[i];
    const next = path[i + 1];
    const d1x = cur.tx - prev.tx;
    const d1y = cur.ty - prev.ty;
    const d2x = next.tx - cur.tx;
    const d2y = next.ty - cur.ty;
    if (d1x !== d2x || d1y !== d2y) out.push(cur);
  }
  out.push(path[path.length - 1]);
  return out;
}