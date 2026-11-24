/* ============================================================
   ui.ts — DOM 层：HUD、快捷栏、弹窗、提示
   ============================================================ */

import { CFG } from './config';
import { TOOLS, toolMaxDurability, durabilityRatio, DURABILITY_WARN } from './tools';
import { DIFFICULTIES, DIFFICULTY_ORDER, difficultyOf } from './difficulty';
import { getDef } from './items';
import { usedSlots } from './items';
import { seasonOfDay, dayInSeason, SEASON_LABEL, SEASON_ICON, WEATHER_LABEL, WEATHER_ICON, festivalOfDay } from './seasons';
import type { DifficultyId } from './difficulty';
import type { GameState } from './types';
import type { TypingSession } from './typing';

export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`缺少元素 #${id}`);
  return el as T;
}

/* ---------------- 提示条 ---------------- */

let toastTimer = 0;

export function toast(msg: string, kind: 'bad' | 'good' | 'plain' = 'plain'): void {
  const el = $('toast');
  el.textContent = msg;
  el.className = 'toast show' + (kind === 'plain' ? '' : ' ' + kind);
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 1800);
}

export function hideHint(): void {
  $('hint').classList.add('hidden');
}

/* ---------------- 弹窗 ---------------- */

export interface ModalAction {
  label: string;
  cls?: string;
  onClick: () => void;
}

let modalOpen = false;

export function isModalOpen(): boolean {
  return modalOpen;
}

export function showModal(title: string, bodyHtml: string, actions: ModalAction[], wide = false): void {
  $('m-title').textContent = title;
  $('m-body').innerHTML = bodyHtml;
  const box = $('modal-box');
  box.style.width = wide ? 'min(720px, 96vw)' : 'min(560px, 100%)';

  const bar = $('m-actions');
  bar.innerHTML = '';
  for (const a of actions) {
    const btn = document.createElement('button');
    btn.className = 'btn ' + (a.cls ?? 'ghost');
    btn.textContent = a.label;
    btn.addEventListener('click', () => a.onClick());
    bar.appendChild(btn);
  }
  $('mask').classList.remove('hidden');
  modalOpen = true;
}

export function hideModal(): void {
  $('mask').classList.add('hidden');
  modalOpen = false;
}

export function bindModalMask(): void {
  $('mask').addEventListener('click', (e) => {
    if (e.target === $('mask')) hideModal();
  });
}

/* ---------------- HUD ---------------- */

function pad2(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

export function clockText(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = Math.floor(minutes % 60);
  return `${pad2(h)}:${pad2(m)}`;
}

let lastHud = '';

export function syncHud(state: GameState): void {
  const key = [
    state.day, state.time, state.weather, state.coins, state.stamina,
    state.todayEarned, usedSlots(state.bag), state.bagSize
  ].join('|');
  if (key === lastHud) return;
  lastHud = key;

  $('hud-day').textContent = String(state.day);
  $('hud-clock').textContent = clockText(state.time);
  $('hud-weather').textContent = WEATHER_LABEL[state.weather];
  $('hud-weather-ico').textContent = WEATHER_ICON[state.weather];
  const season = seasonOfDay(state.day);
  $('hud-season').textContent = SEASON_LABEL[season];
  $('hud-season-ico').textContent = SEASON_ICON[season];
  $('hud-season-day').textContent = `第${dayInSeason(state.day)}天`;

  // 难度徽章
  const d = difficultyOf(state.difficulty);
  $('hud-diff-ico').textContent = d.icon;
  $('hud-diff-name').textContent = d.name;
  $('hud-diff').className = 'stat diff ' + d.id;
  $('hud-diff').title = `${d.desc}（点击切换）`;

  const fest = festivalOfDay(state.day);
  const festEl = $('hud-festival');
  if (fest) {
    festEl.classList.remove('hidden');
    $('hud-festival-ico').textContent = fest.icon;
    $('hud-festival-name').textContent = fest.name;
    festEl.title = `${fest.intro}（${fest.effect}）`;
  } else {
    festEl.classList.add('hidden');
  }

  $('hud-coins').textContent = String(state.coins);
  $('hud-stamina').textContent = String(Math.max(0, Math.round(state.stamina)));
  $('hud-bag').textContent = `${usedSlots(state.bag)}/${state.bagSize}`;
  $('hud-today').textContent = String(state.todayEarned);

  const pct = Math.max(0, Math.min(1, state.stamina / CFG.STAMINA_MAX));
  const bar = $('gauge-stamina');
  bar.style.width = (pct * 100).toFixed(1) + '%';
  bar.className = 'gauge-fill' + (pct < 0.15 ? ' crit' : pct < 0.35 ? ' low' : '');
}

/* ---------------- 快捷栏 ---------------- */

export function toolTitle(state: GameState, toolId: keyof typeof TOOLS): string {
  const t = state.tools[toolId];
  return `${['铜', '银', '金', '秘银'][t.tier - 1]}${TOOLS[toolId].name}`;
}

let lastHotbarKey = '';

export function renderHotbar(state: GameState, onSelect: (i: number) => void): void {
  const key = state.hotbar
    .map((r) => (r
      ? (r.type === 'tool'
          ? `t:${r.id}:${state.tools[r.id].tier}:${Math.ceil(state.tools[r.id].durability)}`
          : `s:${r.id}`)
      : '-'))
    .join(',') + '#' + state.equipSlot;
  if (key === lastHotbarKey) return;
  lastHotbarKey = key;

  const box = $('hotbar');
  box.innerHTML = '';
  state.hotbar.forEach((ref, i) => {
    const el = document.createElement('div');
    el.className = 'hb-slot' + (i === state.equipSlot ? ' sel' : '') + (ref ? '' : ' empty');
    let icon = '';
    let name = '';
    let count = '';
    let durBar = '';
    if (ref && ref.type === 'tool') {
      const t = state.tools[ref.id];
      icon = TOOLS[ref.id].icon;
      name = `${['铜', '银', '金', '秘银'][t.tier - 1]}${TOOLS[ref.id].name}`;
      const ratio = durabilityRatio(t.durability, t.tier);
      const cls = ratio <= 0 ? 'dead' : ratio < DURABILITY_WARN ? 'low' : '';
      durBar = `<span class="dur-bar ${cls}" title="耐久 ${Math.ceil(t.durability)}/${toolMaxDurability(t.tier)}"><i style="width:${(ratio * 100).toFixed(0)}%"></i></span>`;
    } else if (ref && ref.type === 'seed') {
      const def = getDef(ref.id);
      icon = def?.icon ?? '·';
      name = def?.name ?? ref.id;
      let n = 0;
      for (const s of state.bag) if (s && s.id === ref.id) n += s.qty;
      count = String(n);
    }
    el.innerHTML = `<span class="k">${i + 1}</span><span class="ic">${icon}</span>
      <span class="nm">${name}</span><span class="ct">${count}</span>${durBar}`;
    el.addEventListener('click', () => onSelect(i));
    box.appendChild(el);
  });
}

export function resetHotbarCache(): void {
  lastHotbarKey = '';
}

/* ---------------- 难度选择 ---------------- */

/** 渲染标题页的难度卡片，返回当前选中项 */
export function renderDiffPicker(
  current: DifficultyId,
  onPick: (id: DifficultyId) => void
): void {
  const cards = $('diff-cards');
  cards.innerHTML = '';
  for (const id of DIFFICULTY_ORDER) {
    const d = DIFFICULTIES[id];
    const el = document.createElement('button');
    el.className = 'diff-card' + (id === current ? ' sel' : '') + ' ' + id;
    el.innerHTML = `<span class="dc-ico">${d.icon}</span><span class="dc-name">${d.name}</span>`;
    el.title = d.desc;
    el.addEventListener('click', () => onPick(id));
    cards.appendChild(el);
  }
  $('diff-desc').textContent = DIFFICULTIES[current].desc;
}

/* ---------------- 打字面板 ---------------- */

let lastTypingKey = '';

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] ?? c));
}

export function wordMarkup(word: string, typed: string): string {
  let out = '';
  for (let i = 0; i < word.length; i++) {
    const ch = word[i] === ' ' ? '&nbsp;' : escapeHtml(word[i]);
    const cls = i < typed.length ? 'done' : i === typed.length ? 'next' : '';
    out += `<span class="${cls}">${ch}</span>`;
  }
  return out;
}

export function syncTyping(session: TypingSession, actionLabel: string, combo: number): void {
  const card = $('typing-card');
  const nowWord = session.currentWord;

  const key = nowWord
    ? `${session.index}|${session.typed}|${actionLabel}|${combo}|${session.words.map((w) => w.text).join(',')}`
    : `idle|${actionLabel}|${combo}`;
  if (key === lastTypingKey) {
    if (nowWord) updateTimer(session);
    return;
  }
  lastTypingKey = key;

  if (!nowWord) {
    card.className = 'typing-card idle';
    $('t-action').textContent = actionLabel;
    $('t-zh').textContent = '\u3000';
    $('t-en').textContent = '—';
    $('t-chain').innerHTML = '';
    $('t-bar').style.transform = 'scaleX(0)';
    $('t-combo').textContent = '';
    return;
  }

  card.className = 'typing-card active';
  $('t-action').textContent = actionLabel;
  // 中文提示始终显示——顺带记住词义，隐藏它只是剥夺信息，不是增加难度
  $('t-zh').textContent = nowWord.zh;
  $('t-en').innerHTML = wordMarkup(nowWord.text, session.typed);

  let chain = '';
  for (let i = 0; i < session.words.length; i++) {
    const cls = i < session.index ? 'done' : i === session.index ? 'now' : '';
    chain += `<i class="${cls}" title="${escapeHtml(session.words[i].text)}"></i>`;
  }
  $('t-chain').innerHTML = chain;

  const comboEl = $('t-combo');
  comboEl.textContent = combo > 1 ? `连击 ×${combo}` : '';
  comboEl.className = 't-combo' + (combo >= 10 ? ' hot' : '');

  updateTimer(session);
}

function updateTimer(session: TypingSession): void {
  const p = session.progress;
  const bar = $('t-bar');
  bar.style.transform = `scaleX(${p.toFixed(3)})`;
  bar.className = p < 0.2 ? 'danger' : p < 0.45 ? 'warn' : '';
}

export function flashError(): void {
  const card = $('typing-card');
  card.classList.remove('error');
  void card.offsetWidth;
  card.classList.add('error');
  window.setTimeout(() => card.classList.remove('error'), 240);
}

/* ---------------- 钓鱼面板 ---------------- */

let lastFishingKey = '';

export function syncFishing(phase: 'wait' | 'bite', progress: number, label: string): void {
  const card = $('typing-card');
  const key = `${phase}|${label}`;
  if (key !== lastFishingKey) {
    lastFishingKey = key;
    lastTypingKey = '';
    card.className = 'typing-card ' + (phase === 'bite' ? 'bite' : 'active');
    $('t-action').textContent = label;
    $('t-zh').textContent = phase === 'bite' ? '咬钩了！按 空格' : '等待咬钩…';
    $('t-en').textContent = phase === 'bite' ? '!!!' : '· · ·';
    $('t-chain').innerHTML = '';
    $('t-combo').textContent = '';
  }
  const bar = $('t-bar');
  bar.style.transform = `scaleX(${Math.max(0, Math.min(1, progress)).toFixed(3)})`;
  bar.className = phase === 'bite' ? 'danger' : '';
}

export function resetFishingCache(): void {
  lastFishingKey = '';
}

export function flashSuccess(): void {
  const card = $('typing-card');
  card.classList.add('success');
  window.setTimeout(() => card.classList.remove('success'), 320);
  lastTypingKey = '';
}

export function resetTypingCache(): void {
  lastTypingKey = '';
}

/* ---------------- 通用 ---------------- */

export function starsMarkup(q: number): string {
  const n = Math.max(0, Math.min(5, Math.round(q)));
  return '★'.repeat(n) + '<span class="dim">' + '☆'.repeat(5 - n) + '</span>';
}
