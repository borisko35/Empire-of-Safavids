// ============================================================
// Туториал для новичка — Empire of Safavids
// ============================================================
// Первое, что определяет, останется ли новый игрок, — первые 60 секунд.
//
// ТУТ БЫЛА МЁРТВАЯ ФУНКЦИЯ. Оверлей, прогресс-бар, тултипы, стили и шаги
// были написаны, api был готов — но initTutorial() не вызывался НИ РАЗУ,
// а onTutorialAction() не был подписан ни на одно событие. Игрок видел
// город с двадцатью кнопками и не понимал, куда нажать.
//
// Что здесь важно:
//  1) Шаг переключается ТОЛЬКО на то действие, которое в нём описано.
//     Раньше advance дёргался от любого нажатия, и игрок пролистывал все
//     шаги, ни разу не сделав того, что в них написано.
//  2) Цель шага сверяется по-настоящему: «поговори с торговцем» засчитывает
//     разговор ИМЕННО с торговцем. Идентификаторы целей раньше были
//     выдуманы и не существовали в данных игры — такие шаги было невозможно
//     закрыть в принципе.
//  3) Шаг с count («победите 3 бандитов») считает повторы и показывает их.
//     Раньше в тексте обещали троих, а засчитывался первый же убитый.
//  4) Шаг «иди» засчитывается по РЕАЛЬНОМУ пройденному расстоянию, а не по
//     нажатию клавиши: иначе шаг прокручивался, стоя на месте.
//  5) Тексты — через i18n и по языку игрока, а не зашиты по-русски прямо
//     в разметку (английскому игроку показывался русский текст).

import { api, type TutorialStepApi } from './api';
import { session } from './state';
import { toast } from './hud';
import { t } from './i18n';

/** Сколько метров пройти, чтобы засчитать шаг «иди» */
const MOVE_DONE_M = 3;
/** Запас для кнопки «Далее»: шаг не должен висеть вечно, если игрок ушёл не туда */
const MOVE_FORCE_M = 12;

let overlayEl: HTMLElement | null = null;
let progressBar: HTMLElement | null = null;
/** Число шагов берём с сервера: раньше было зашито 9 и расходилось с ним */
let totalSteps = 0;
let isTutorialActive = false;
let stepCompleted = false;
/** Действие текущего шага — по нему решаем, что считать выполнением */
let currentAction: string | null = null;
/** Предмет/объект, которого требует шаг (например «поговори с торговцем») */
let currentTarget: string | null = null;
/** Сколько раз нужно повторить действие (для «победите 3 бандитов») */
let currentCount = 1;
/** Сколько уже повторов сделано в текущем шаге */
let currentDone = 0;
/** Откуда отсчитывать пройденное расстояние для шага «иди» */
let moveFrom = { x: 0, z: 0 };

/**
 * Язык текста шага. На сервере лежат только английский и русский варианты,
 * а показывался всегда русский — английскому игроку туториал был на чужом
 * языке. Азербайджанцу показываем английский: это лучше, чем чужой язык.
 */
function pick(ru: string, en: string): string {
  return document.documentElement.lang === 'ru' ? ru : en;
}

/** Инициализировать туториал. Вызывается один раз при входе в мир. */
export async function initTutorial(characterId: string): Promise<void> {
  if (overlayEl) return; // уже показан
  try {
    const data = await api.tutorialProgress(characterId);
    if (data.progress.completed) return;
    isTutorialActive = true;
    totalSteps = data.totalSteps ?? 0;
    createOverlay();
    showStep(data.currentStep);
  } catch (err) {
    // Туториал не должен ломать игру: нет доступа к прогрессу — просто молчим
    console.warn('[tutorial] недоступен:', (err as Error).message);
    isTutorialActive = false;
  }
}

/** Создать DOM-структуру оверлея */
function createOverlay(): void {
  if (overlayEl) return;

  overlayEl = document.createElement('div');
  overlayEl.id = 'tutorial-overlay';
  overlayEl.className = 'tutorial-overlay hidden';
  // Счётчик повторов (для «победите 3 бандитов») — пустой, если не нужен
  overlayEl.innerHTML = `
    <div class="tutorial-box">
      <div class="tutorial-progress">
        <div class="tutorial-progress-bar" id="tutorial-bar"></div>
      </div>
      <div class="tutorial-step-counter" id="tutorial-counter"></div>
      <h3 class="tutorial-title" id="tutorial-title"></h3>
      <p class="tutorial-desc" id="tutorial-desc"></p>
      <div class="tutorial-hint" id="tutorial-hint"></div>
      <div class="tutorial-count hidden" id="tutorial-count"></div>
      <div class="tutorial-buttons">
        <button class="tutorial-btn tutorial-btn--skip" id="tutorial-skip" type="button"></button>
        <button class="tutorial-btn tutorial-btn--next" id="tutorial-next" type="button"></button>
      </div>
    </div>
  `;
  document.body.append(overlayEl);
  progressBar = document.getElementById('tutorial-bar');

  document.getElementById('tutorial-skip')?.addEventListener('click', skipTutorial);
  document.getElementById('tutorial-next')?.addEventListener('click', () => void advanceTutorial());
}

/** Показать шаг */
function showStep(step: TutorialStepApi | null): void {
  if (!step || !overlayEl) return;
  stepCompleted = false;
  currentAction = step.action;
  currentTarget = step.target ?? null;
  currentCount = step.count ?? 1;
  currentDone = 0;
  // Отсюда считаем пройденное расстояние для шага «иди»
  moveFrom = { x: session.selfPos.x, z: session.selfPos.z };
  if (totalSteps <= 0) totalSteps = step.id + 1;

  const titleEl = document.getElementById('tutorial-title');
  const descEl = document.getElementById('tutorial-desc');
  const hintEl = document.getElementById('tutorial-hint');
  const counterEl = document.getElementById('tutorial-counter');
  const skipBtn = document.getElementById('tutorial-skip') as HTMLButtonElement | null;
  const nextBtn = document.getElementById('tutorial-next') as HTMLButtonElement | null;

  if (titleEl) titleEl.textContent = pick(step.titleRu, step.title);
  if (descEl) descEl.textContent = pick(step.descriptionRu, step.description);
  if (hintEl) {
    hintEl.textContent = pick(step.hintRu, step.hint);
    hintEl.classList.toggle('hidden', !step.hintRu && !step.hint);
  }
  if (counterEl) counterEl.textContent = `${step.id + 1} / ${totalSteps}`;
  if (progressBar) progressBar.style.width = `${((step.id + 1) / totalSteps) * 100}%`;
  if (skipBtn) skipBtn.textContent = t('tutorial.skip');
  updateCountBadge();

  if (nextBtn) {
    if (step.action === 'complete') {
      nextBtn.textContent = t('tutorial.start_game');
      nextBtn.classList.add('tutorial-btn--final');
    } else {
      nextBtn.textContent = t('tutorial.next');
      nextBtn.classList.remove('tutorial-btn--final');
    }
  }

  overlayEl.classList.remove('hidden');
}

/** Обновить значок «сделано 1 из 3» — показываем только когда есть count */
function updateCountBadge(): void {
  const el = document.getElementById('tutorial-count');
  if (!el) return;
  if (currentCount > 1) {
    el.textContent = `${currentDone} / ${currentCount}`;
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

/** Перейти к следующему шагу */
async function advanceTutorial(): Promise<void> {
  if (stepCompleted || !session.character) return;
  stepCompleted = true;
  try {
    const result = await api.tutorialAdvance(session.character.id);
    if (typeof result.totalSteps === 'number') totalSteps = result.totalSteps;
    if (result.completed) {
      hideTutorial();
      toast(t('tutorial.done'), 'success');
      return;
    }
    showStep(result.tutorialStep);
  } catch (err) {
    // Сервер не ответил — не блокируем игрока, просто прячем обучалку
    console.warn('[tutorial] не удалось перейти:', (err as Error).message);
    hideTutorial();
  }
}

/** Пропустить туториал */
async function skipTutorial(): Promise<void> {
  hideTutorial();
  try {
    if (session.character) await api.tutorialSkip(session.character.id);
  } catch {
    // Пропуск на сервере не прошёл — не страшно, вернёмся при следующем входе
  }
}

/** Скрыть туториал */
function hideTutorial(): void {
  isTutorialActive = false;
  currentAction = null;
  overlayEl?.classList.add('hidden');
}

/**
 * Сообщить туториалу о действии игрока.
 *
 * Шаг засчитывается ТОЛЬКО если действие совпадает с тем, что описано
 * в шаге. Раньше проверки не было вовсе, и любой клик прокручивал все шаги
 * подряд.
 *
 * target сверяется с целью шага: шаг «поговори с торговцем» не должен
 * закрыться разговором с кем угодно другим. Если действие не передаёт
 * цель (например замах), сверка не выполняется — иначе шаг был бы
 * непроходим.
 */
export function onTutorialAction(action: string, target?: string): void {
  if (!isTutorialActive || stepCompleted) return;
  // Шаг засчитывается только тем действием, которое в нём описано
  if (currentAction !== action) return;
  // Если шаг требует конкретную цель, а действие пришло с другой — не засчитываем
  if (currentTarget && target && target !== currentTarget) return;

  // Шаг с повторами: «победите 3 бандитов». Раньше обещали троих,
  // а засчитывался первый же — игрок думал, что не доделал
  if (currentCount > 1) {
    currentDone++;
    updateCountBadge();
    if (currentDone < currentCount) return;
  }
  void advanceTutorial();
}

/**
 * Покадровая проверка: засчитать шаг «иди», когда игрок действительно
 * прошёл расстояние, а не просто нажал клавишу.
 *
 * Вызывается из основного цикла игры вместе с кулдаунами.
 */
export function tickTutorial(): void {
  if (!isTutorialActive || stepCompleted) return;
  if (currentAction !== 'move') return;
  const moved = Math.hypot(session.selfPos.x - moveFrom.x, session.selfPos.z - moveFrom.z);
  // Кнопка «Далее» сама предлагает пройти 12 м, чтобы шаг не висел вечно
  if (moved > MOVE_DONE_M || moved > MOVE_FORCE_M) void advanceTutorial();
}
