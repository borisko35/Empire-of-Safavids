// ============================================================
// Кат-сцены — Empire of Safavids
// ============================================================
// Оверлей сцены: затемнение, имя говорящего, текст печатной машинкой,
// кнопки «дальше» и «пропустить». Сцену присылает сервер только один
// раз — перечитать заранее весь сюжет нельзя.

import { t } from './i18n';
import { api, type StoryCutscene } from './api';
import { session } from './state';

export type CutsceneData = StoryCutscene;

export interface CutsceneLine {
  speaker: string;
  speakerName: string;
  text: string;
  textRu: string;
  delay?: number;
}

const TYPE_MS = 18;          // скорость печатной машинки
const BACKDROP_LABELS: Record<string, { ru: string; en: string }> = {
  throne_room: { ru: 'Тронный зал', en: 'Throne Room' },
  tabriz_gate: { ru: 'Ворота Тебриза', en: 'Tabriz Gate' },
  caravan_road: { ru: 'Караванная дорога', en: 'Caravan Road' },
  silk_road_fort: { ru: 'Крепость на Шёлковом Пути', en: 'Silk Road Fort' },
  caucasus_pass: { ru: 'Кавказский перевал', en: 'Caucasus Pass' },
  desert_dunes: { ru: 'Барханы Хорасана', en: 'Khorasan Dunes' },
  gulf_harbor: { ru: 'Пристань Залива', en: 'Gulf Harbour' },
};

interface Running {
  scene: CutsceneData;
  index: number;
  shown: number;      // сколько символов уже напечатано
  done: boolean;
  timer: number | null;
}

let running: Running | null = null;
let onFinish: (() => void) | null = null;

function lang(): 'ru' | 'en' | 'az' {
  return ((session as unknown as { lang?: string }).lang ?? 'ru') as 'ru' | 'en' | 'az';
}

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

/** Показать сцену. onEnd зовётся после закрытия (для выхода из паузы) */
export function playCutscene(scene: CutsceneData, end?: () => void): void {
  if (!scene || !scene.lines?.length) { end?.(); return; }
  stopTyping();
  onFinish = end ?? null;
  running = { scene, index: 0, shown: 0, done: false, timer: null };

  const overlay = el<HTMLElement>('cutscene');
  if (!overlay) { running = null; end?.(); return; }
  overlay.classList.remove('hidden');

  const place = BACKDROP_LABELS[scene.backdrop];
  const titleEl = el('cutscene-place');
  if (titleEl) titleEl.textContent = place ? (lang() === 'en' ? place.en : place.ru) : '';

  const nameEl = el('cutscene-speaker');
  if (nameEl) nameEl.textContent = scene.titleRu;

  wireButtons();
  showLine();
}

function wireButtons(): void {
  const next = el<HTMLButtonElement>('cutscene-next');
  const skip = el<HTMLButtonElement>('cutscene-skip');
  if (next && !next.dataset.wired) {
    next.dataset.wired = '1';
    next.addEventListener('click', () => advance());
  }
  if (skip && !skip.dataset.wired) {
    skip.dataset.wired = '1';
    skip.addEventListener('click', () => { void skipCutscene(); });
  }
}

function stopTyping(): void {
  if (running?.timer !== null && running?.timer !== undefined) {
    clearInterval(running.timer);
    running.timer = null;
  }
}

function lineText(line: CutsceneLine): string {
  return lang() === 'en' ? line.text : line.textRu;
}

function showLine(): void {
  if (!running) return;
  stopTyping();
  const line = running.scene.lines[running.index];
  if (!line) { closeCutscene(); return; }

  const speakerEl = el('cutscene-who');
  if (speakerEl) speakerEl.textContent = line.speakerName;
  const textEl = el('cutscene-text');
  if (!textEl) { closeCutscene(); return; }

  const full = lineText(line);
  // Уважаем задержку из сцены: пауза перед репликой задаёт ритм
  if (line.delay) {
    running.shown = 0;
    textEl.textContent = '';
    running.timer = window.setTimeout(() => {
      if (running) { running.shown = 0; startTyping(full, textEl); }
    }, line.delay);
    return;
  }
  running.shown = 0;
  startTyping(full, textEl);
}

function startTyping(full: string, textEl: HTMLElement): void {
  if (!running) return;
  running.shown = 0;
  running.timer = window.setInterval(() => {
    if (!running) return;
    running.shown += 3;
    textEl.textContent = full.slice(0, running.shown);
    if (running.shown >= full.length) {
      textEl.textContent = full;
      stopTyping();
      running.done = true;
    }
  }, TYPE_MS);
}

/** Клик по сцене: сначала допечатывает, потом листает */
export function advance(): void {
  if (!running) return;
  if (!running.done) {
    // Дописать текущую реплику целиком
    const line = running.scene.lines[running.index];
    if (line) {
      stopTyping();
      const textEl = el('cutscene-text');
      if (textEl) textEl.textContent = lineText(line);
      running.done = true;
    }
    return;
  }
  running.index++;
  if (running.index >= running.scene.lines.length) { closeCutscene(); return; }
  showLine();
}

export function isCutscenePlaying(): boolean {
  return running !== null;
}

function closeCutscene(): void {
  stopTyping();
  const overlay = el('cutscene');
  overlay?.classList.add('hidden');
  const cb = onFinish;
  onFinish = null;
  running = null;
  cb?.();
}

async function skipCutscene(): Promise<void> {
  const id = running?.scene.id;
  closeCutscene();
  if (id && session.character) {
    // Серверу надо знать, что сцена «просмотрена», иначе она всплывёт
    // снова при повторном событии квеста
    await api.storyCutsceneSkipped(session.character.id, id).catch(() => {});
  }
}

// ── Запрос сцены после завершения квеста ──────────────────────

/**
 * Клиент спрашивает сцену у сервера после `quest_completed`. Так покрыты
 * все пути завершения квеста (бой, диалог, панель) — не надо править
 * каждое место, где завершается квест.
 */
export async function requestCutsceneForQuest(questId: string): Promise<void> {
  if (!session.character) return;
  try {
    const { cutscene } = await api.storyTakeCutscene(session.character.id, questId, 'complete');
    if (cutscene) playCutscene(cutscene as CutsceneData);
  } catch {
    /* сцена не критична: не срываем из-за неё награду */
  }
}

export function tCut(key: string): string {
  return t(key);
}
