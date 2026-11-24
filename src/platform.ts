/* ============================================================
   platform.ts — 运行环境接缝层
   ------------------------------------------------------------
   目标：让「浏览器」与「桌面（Electron / Steam）」共用同一套游戏代码。
   所有持久化都从这里走，以后套壳只需替换 StorageAdapter 的实现，
   不必再翻 game.ts / words.ts 里散落的 localStorage。

   现阶段（浏览器）：LocalStorageAdapter。
   桌面阶段（未实现）：DesktopFileAdapter —— 真实存档文件，供 Steam 云同步。
   ============================================================ */

export type Runtime = 'browser' | 'electron';

/** 桌面壳通过 preload 注入的桥（现在还没有，留好位置） */
interface DesktopBridge {
  storage?: {
    get(key: string): string | null;
    set(key: string, value: string): void;
    remove(key: string): void;
  };
}

declare global {
  interface Window {
    __FARM_DESKTOP__?: DesktopBridge;
  }
}

export function detectRuntime(): Runtime {
  if (typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent)) return 'electron';
  if (typeof window !== 'undefined' && window.__FARM_DESKTOP__) return 'electron';
  return 'browser';
}

/* ---------------- 存储接缝 ---------------- */

export interface StorageAdapter {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

/** 浏览器：localStorage。隐私模式等异常下静默降级为内存。 */
class LocalStorageAdapter implements StorageAdapter {
  private mem = new Map<string, string>();

  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return this.mem.get(key) ?? null;
    }
  }

  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      this.mem.set(key, value);
    }
  }

  remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      this.mem.delete(key);
    }
  }
}

/**
 * 桌面：真实文件存档（Steam 云同步的前提）。
 * 壳还没搭，这里先回退到 localStorage，保证任何阶段游戏都能跑；
 * 等 Electron preload 注入 __FARM_DESKTOP__.storage 后自动接管。
 */
class DesktopFileAdapter implements StorageAdapter {
  private fallback = new LocalStorageAdapter();

  private bridge(): DesktopBridge['storage'] | null {
    return window.__FARM_DESKTOP__?.storage ?? null;
  }

  get(key: string): string | null {
    return this.bridge()?.get(key) ?? this.fallback.get(key);
  }

  set(key: string, value: string): void {
    const b = this.bridge();
    if (b) b.set(key, value);
    else this.fallback.set(key, value);
  }

  remove(key: string): void {
    const b = this.bridge();
    if (b) b.remove(key);
    else this.fallback.remove(key);
  }
}

/* ---------------- 对外 ---------------- */

export const runtime: Runtime = detectRuntime();
export const isDesktop: boolean = runtime === 'electron';

export const storage: StorageAdapter = isDesktop
  ? new DesktopFileAdapter()
  : new LocalStorageAdapter();

/**
 * 平台能力开关。接 Steamworks 时把对应项点亮，
 * 游戏逻辑只查这里，不直接碰 Steam API。
 */
export const capabilities = {
  cloudSave: false,
  achievements: false,
  fullscreenToggle: false
};
