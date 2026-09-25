// ============================================================
// Tutorial Service — Empire of Safavids
// ============================================================

import { DatabaseService } from './DatabaseService';
import { logger } from '../utils/logger';

export interface TutorialStep {
  id: number;
  title: string;
  titleRu: string;
  description: string;
  descriptionRu: string;
  action: 'move' | 'attack' | 'use_skill' | 'talk_npc' | 'open_inventory' | 'buy_item' | 'kill_monster' | 'complete';
  target?: string;
  hint: string;
  hintRu: string;
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 0,
    title: 'Welcome to Safavids',
    titleRu: 'Добро пожаловать в Сефевиды',
    description: 'You have been summoned by Shah Ismail I to serve the Empire.',
    descriptionRu: 'Шах Исмаил I призвал вас на службу Империи.',
    action: 'move',
    hint: 'Use WASD to move around',
    hintRu: 'Используйте WASD для передвижения',
  },
  {
    id: 1,
    title: 'Camera Control',
    titleRu: 'Управление камерой',
    description: 'Look around with mouse. Hold right-click to rotate view.',
    descriptionRu: 'Смотрите вокруг мышью. Зажмите правую кнопку для вращения камеры.',
    action: 'move',
    hint: 'Move mouse to look around',
    hintRu: 'Двигайте мышь чтобы осмотреться',
  },
  {
    id: 2,
    title: 'Basic Attack',
    titleRu: 'Базовая атака',
    description: 'Left-click to attack. Practice on the training dummy.',
    descriptionRu: 'Левый клик для атаки. Потренируйтесь на тренировочном манекене.',
    action: 'attack',
    target: 'training_dummy',
    hint: 'Left-click to attack',
    hintRu: 'Левый клик для атаки',
  },
  {
    id: 3,
    title: 'Use Skills',
    titleRu: 'Использование навыков',
    description: 'Press 1-4 to use skills. Each class has unique abilities.',
    descriptionRu: 'Нажмите 1-4 для использования навыков. У каждого класса уникальные способности.',
    action: 'use_skill',
    hint: 'Press 1-4 keys',
    hintRu: 'Нажмите клавиши 1-4',
  },
  {
    id: 4,
    title: 'Talk to NPCs',
    titleRu: 'Разговор с NPC',
    description: 'Approach an NPC and click to open dialogue.',
    descriptionRu: 'Подойдите к NPC и нажмите чтобы открыть диалог.',
    action: 'talk_npc',
    target: 'npc_merchant',
    hint: 'Click on NPC to talk',
    hintRu: 'Нажмите на NPC чтобы поговорить',
  },
  {
    id: 5,
    title: 'Open Inventory',
    titleRu: 'Открытие инвентаря',
    description: 'Press I to open inventory. Equip weapons and armor.',
    descriptionRu: 'Нажмите I чтобы открыть инвентарь. Экипируйте оружие и броню.',
    action: 'open_inventory',
    hint: 'Press I key',
    hintRu: 'Нажмите клавишу I',
  },
  {
    id: 6,
    title: 'Buy Supplies',
    titleRu: 'Покупка припасов',
    description: 'Buy a health potion from the merchant.',
    descriptionRu: 'Купите зелье здоровья у торговца.',
    action: 'buy_item',
    target: 'pot_health_small',
    hint: 'Buy from merchant',
    hintRu: 'Купите у торговца',
  },
  {
    id: 7,
    title: 'Hunt Bandits',
    titleRu: 'Охота на бандитов',
    description: 'Leave the camp and defeat 3 bandits in the wild.',
    descriptionRu: 'Покиньте лагерь и победите 3 бандитов в диких землях.',
    action: 'kill_monster',
    target: 'mob_bandit_scout',
    hint: 'Kill 3 bandits',
    hintRu: 'Убейте 3 бандитов',
  },
  {
    id: 8,
    title: 'Tutorial Complete!',
    titleRu: 'Туториал пройден!',
    description: 'You are ready to explore the Empire. Good luck!',
    descriptionRu: 'Вы готовы исследовать Империю. Удачи!',
    action: 'complete',
    hint: '',
    hintRu: '',
  },
];

export class TutorialService {
  private db = DatabaseService.getInstance();

  /** Получить текущий шаг туториала */
  async getProgress(characterId: string): Promise<{ step: number; completed: boolean }> {
    const row = await this.db.queryOne<{ current_step: number; completed: boolean }>(
      'SELECT current_step, completed FROM tutorial_progress WHERE character_id = $1',
      [characterId]
    );
    return row ? { step: row.current_step, completed: row.completed } : { step: 0, completed: false };
  }

  /** Отметить шаг как выполненный */
  async advanceStep(characterId: string): Promise<{ step: number; completed: boolean; tutorialStep: TutorialStep }> {
    const progress = await this.getProgress(characterId);
    if (progress.completed) {
      return { step: -1, completed: true, tutorialStep: TUTORIAL_STEPS[TUTORIAL_STEPS.length - 1] };
    }

    const nextStep = progress.step + 1;
    const completed = nextStep >= TUTORIAL_STEPS.length;

    await this.db.query(
      `INSERT INTO tutorial_progress (character_id, current_step, completed, completed_at, updated_at)
       VALUES ($1, $2, $3, ${completed ? 'NOW()' : 'NULL'}, NOW())
       ON CONFLICT (character_id) DO UPDATE SET current_step = $2, completed = $3, completed_at = ${completed ? 'NOW()' : 'tutorial_progress.completed_at'}, updated_at = NOW()`,
      [characterId, nextStep, completed]
    );

    const tutorialStep = TUTORIAL_STEPS[Math.min(nextStep, TUTORIAL_STEPS.length - 1)];
    logger.info(`[Tutorial] Character ${characterId} advanced to step ${nextStep}`);
    return { step: nextStep, completed, tutorialStep };
  }

  /** Пропустить туториал */
  async skipTutorial(characterId: string): Promise<void> {
    await this.db.query(
      `INSERT INTO tutorial_progress (character_id, current_step, completed, completed_at, updated_at)
       VALUES ($1, $2, TRUE, NOW(), NOW())
       ON CONFLICT (character_id) DO UPDATE SET current_step = $2, completed = TRUE, completed_at = NOW(), updated_at = NOW()`,
      [characterId, TUTORIAL_STEPS.length]
    );
    logger.info(`[Tutorial] Character ${characterId} skipped tutorial`);
  }

  /** Получить определённый шаг */
  getStep(stepIndex: number): TutorialStep | null {
    return TUTORIAL_STEPS[stepIndex] ?? null;
  }

  /** Получить все шаги (для клиента) */
  getAllSteps(): TutorialStep[] {
    return TUTORIAL_STEPS;
  }
}
