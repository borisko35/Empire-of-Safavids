// ============================================================
// Tutorial Overlay — Empire of Safavids
// ============================================================
// Пошаговый туториал с подсказками, тултипами и прогресс-баром.

import { api } from './api';
import { session } from './state';
import { toast } from './hud';

interface TutorialStep {
  id: number;
  title: string;
  titleRu: string;
  description: string;
  descriptionRu: string;
  action: string;
  target?: string;
  hint: string;
  hintRu: string;
}

let overlayEl: HTMLElement | null = null;
let progressBar: HTMLElement | null = null;
let totalSteps = 9;
let isTutorialActive = false;
let stepCompleted = false;

/** Инициализировать туториал */
export async function initTutorial(characterId: string): Promise<void> {
  try {
    const data = await api.tutorialProgress(characterId);
    if (data.progress.completed) {
      isTutorialActive = false;
      return;
    }
    isTutorialActive = true;
    createOverlay();
    showStep(data.currentStep);
  } catch {
    // Туториал недоступен — пропускаем
    isTutorialActive = false;
  }
}

/** Создать DOM-структуру оверлея */
function createOverlay(): void {
  if (overlayEl) return;

  overlayEl = document.createElement('div');
  overlayEl.id = 'tutorial-overlay';
  overlayEl.className = 'tutorial-overlay hidden';
  overlayEl.innerHTML = `
    <div class="tutorial-box">
      <div class="tutorial-progress">
        <div class="tutorial-progress-bar" id="tutorial-bar"></div>
      </div>
      <div class="tutorial-step-counter" id="tutorial-counter">1 / ${totalSteps}</div>
      <h3 class="tutorial-title" id="tutorial-title"></h3>
      <p class="tutorial-desc" id="tutorial-desc"></p>
      <div class="tutorial-hint" id="tutorial-hint"></div>
      <div class="tutorial-buttons">
        <button class="tutorial-btn tutorial-btn--skip" id="tutorial-skip">Пропустить туториал</button>
        <button class="tutorial-btn tutorial-btn--next" id="tutorial-next">Далее →</button>
      </div>
    </div>
    <div class="tutorial-tooltip" id="tutorial-tooltip">
      <div class="tutorial-tooltip-arrow"></div>
      <div class="tutorial-tooltip-text" id="tutorial-tooltip-text"></div>
    </div>
  `;
  document.body.append(overlayEl);

  progressBar = document.getElementById('tutorial-bar');

  document.getElementById('tutorial-skip')?.addEventListener('click', skipTutorial);
  document.getElementById('tutorial-next')?.addEventListener('click', advanceTutorial);
}

/** Показать шаг */
function showStep(step: TutorialStep | null): void {
  if (!step || !overlayEl) return;
  stepCompleted = false;

  const lang = (session as unknown as { lang?: string }).lang ?? 'ru';
  const title = lang === 'en' ? step.title : step.titleRu;
  const desc = lang === 'en' ? step.description : step.descriptionRu;
  const hint = lang === 'en' ? step.hint : step.hintRu;

  const titleEl = document.getElementById('tutorial-title');
  const descEl = document.getElementById('tutorial-desc');
  const hintEl = document.getElementById('tutorial-hint');
  const counterEl = document.getElementById('tutorial-counter');

  if (titleEl) titleEl.textContent = title;
  if (descEl) descEl.textContent = desc;
  if (hintEl) hintEl.textContent = hint;
  if (counterEl) counterEl.textContent = `${step.id + 1} / ${totalSteps}`;
  if (progressBar) progressBar.style.width = `${((step.id + 1) / totalSteps) * 100}%`;

  // Показываем тултип на целевом элементе
  highlightTarget(step.target);

  // Показываем оверлей
  overlayEl.classList.remove('hidden');

  // Показываем/скрываем кнопку "Далее" в зависимости от типа шага
  const nextBtn = document.getElementById('tutorial-next') as HTMLButtonElement;
  if (nextBtn) {
    if (step.action === 'complete') {
      nextBtn.textContent = 'Начать игру!';
      nextBtn.classList.add('tutorial-btn--final');
    } else {
      nextBtn.textContent = 'Далее →';
      nextBtn.classList.remove('tutorial-btn--final');
    }
  }
}

/** Подсветить целевой элемент */
function highlightTarget(target?: string): void {
  // Убираем предыдущую подсветку
  document.querySelectorAll('.tutorial-highlight').forEach(el => el.classList.remove('tutorial-highlight'));

  if (!target) return;

  // Ищем элемент по ID или классу
  const el = document.getElementById(target)
    ?? document.querySelector(`[data-npc="${target}"]`)
    ?? document.querySelector(`[data-monster="${target}"]`);
  if (el) {
    el.classList.add('tutorial-highlight');
  }
}

/** Перейти к следующему шагу */
async function advanceTutorial(): Promise<void> {
  if (stepCompleted) return;
  stepCompleted = true;

  try {
    const result = await api.tutorialAdvance(session.character!.id);

    if (result.completed) {
      hideTutorial();
      toast('Туториал пройден! Удачи в Империи!', 'success');
      return;
    }

    showStep(result.tutorialStep);
  } catch (err) {
    toast((err as Error).message, 'error');
  }
}

/** Пропустить туториал */
async function skipTutorial(): Promise<void> {
  try {
    await api.tutorialSkip(session.character!.id);
    hideTutorial();
    toast('Туториал пропущен', 'info');
  } catch {
    hideTutorial();
  }
}

/** Скрыть туториал */
function hideTutorial(): void {
  isTutorialActive = false;
  overlayEl?.classList.add('hidden');
  document.querySelectorAll('.tutorial-highlight').forEach(el => el.classList.remove('tutorial-highlight'));
}

/** Проверить, активен ли туториал */
export function isTutorialActiveCheck(): boolean {
  return isTutorialActive;
}

/** Автоматически завершить шаг при определённом действии */
export function onTutorialAction(action: string, _target?: string): void {
  if (!isTutorialActive) return;
  // Простая проверка — при реальных действиях игрока
  if (action === 'attack' || action === 'move' || action === 'use_skill') {
    // Даём подождать немного перед автоматическим переходом
    setTimeout(() => {
      if (!stepCompleted) {
        void advanceTutorial();
      }
    }, 1500);
  }
}
