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
  /**
   * Что должен сделать игрок. На эти значения подписан клиент —
   * см. server/src/tests/tutorial.test.ts, список KNOWN_ACTIONS.
   *
   * 'read' — шаг закрывается кнопкой «Далее», ничего делать не нужно.
   */
  action:
    | 'read' | 'move' | 'camera' | 'attack' | 'use_skill' | 'talk_npc'
    | 'open_inventory' | 'buy_item' | 'kill_monster' | 'complete';
  /**
   * Идентификатор цели. ОБЯЗАН существовать в данных игры, иначе шаг
   * невозможно закрыть: клиент сверяет его при каждом действии.
   * Проверяется тестом tutorial.test.ts.
   */
  target?: string;
  /** Сколько раз повторить действие (для «победите 3 бандитов») */
  count?: number;
  hint: string;
  hintRu: string;
}

// ТУТ БЫЛО ЧЕТЫРЕ ШАГА, КОТОРЫЕ НЕВОЗМОЖНО БЫЛО ЗАКРЫТЬ.
//  - 'training_dummy'  — манекена в игре нет вообще, шаг его обещал;
//  - 'npc_merchant'    — торговца так зовут 'npc_bazaar_merchant';
//  - 'pot_health_small'— в магазине это 'con_health_potion_s';
//  - «победите 3 бандитов» в тексте, а засчитывался первый убитый.
// Кроме того текст шага не совпадал с условием его выполнения: шаг «камера»
// требовал пройти 3 метра, а шаг «приветствие» требовал куда-то идти.
// Теперь текст и условие совпадают в каждом шаге, а существование целей
// проверяется тестом.
export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 0,
    title: 'Welcome to Safavids',
    titleRu: 'Добро пожаловать в Сефевиды',
    description: 'Shah Ismail I has summoned you to serve the Empire.',
    descriptionRu: 'Шах Исмаил I призвал вас на службу Империи.',
    // Раньше было 'move' — приветствие требовало куда-то идти прежде, чем
    // игрок его прочитал. Теперь закрывается кнопкой «Далее».
    action: 'read',
    hint: 'Read and continue',
    hintRu: 'Прочитайте и нажмите «Далее»',
  },
  {
    id: 1,
    title: 'Movement',
    titleRu: 'Передвижение',
    description: 'Use WASD to walk. Walk a few meters.',
    descriptionRu: 'Ходите клавишами WASD. Пройдите несколько метров.',
    // Проверяется по РЕАЛЬНО пройденному расстоянию, а не по нажатию
    // клавиши: иначе шаг проходил, стоя на месте
    action: 'move',
    hint: 'Press W, A, S or D and walk',
    hintRu: 'Нажмите W, A, S или D и пройдитесь',
  },
  {
    id: 2,
    title: 'Camera',
    titleRu: 'Камера',
    // Текст обещал «зажмите правую кнопку мыши», но правая кнопка в игре —
    // это блок, а камеру крутит движение мыши. Игрок зажимал правую кнопку,
    // блокировал щитом и не понимал, почему шаг не проходит.
    description: 'Move the mouse to look around. Scroll the wheel to zoom in and out.',
    descriptionRu: 'Двигайте мышью, чтобы осмотреться. Колесо мыши — приближение и отдаление.',
    action: 'camera',
    hint: 'Move the mouse to look around',
    hintRu: 'Двигайте мышью, чтобы осмотреться',
  },
  {
    id: 3,
    title: 'Basic Attack',
    titleRu: 'Атака',
    description: 'Left-click to swing your weapon at anything nearby.',
    descriptionRu: 'Левый клик — замах оружием. Направьте на любого, кто рядом.',
    // Раньше целью был 'training_dummy' — такого в игре нет. Убираем
    // обещание, которого игрок не мог бы выполнить
    action: 'attack',
    hint: 'Left-click to attack',
    hintRu: 'Левый клик — атака',
  },
  {
    id: 4,
    title: 'Use Skills',
    titleRu: 'Использование навыков',
    description: 'Press 1-4 to use skills. Each class has unique abilities.',
    descriptionRu: 'Нажмите 1-4 для использования навыков. У каждого класса уникальные способности.',
    action: 'use_skill',
    hint: 'Press 1-4 keys',
    hintRu: 'Нажмите клавиши 1-4',
  },
  {
    id: 5,
    title: 'Talk to the Merchant',
    titleRu: 'Разговор с торговцем',
    description: 'Approach the Bazaar Merchant in Isfahan and click to talk.',
    descriptionRu: 'Подойдите к Базарному торговцу в Исфахане и нажмите, чтобы поговорить.',
    action: 'talk_npc',
    // Было 'npc_merchant' — такого NPC в игре нет, шаг не закрывался НИКОГДА
    target: 'npc_bazaar_merchant',
    hint: 'Click on the merchant to talk',
    hintRu: 'Нажмите на торговца, чтобы поговорить',
  },
  {
    id: 6,
    title: 'Open Inventory',
    titleRu: 'Инвентарь',
    description: 'Press I (or click the bag icon) to open inventory. Equip gear there.',
    descriptionRu: 'Нажмите I (или значок сумки), чтобы открыть инвентарь. Там надеваете снаряжение.',
    action: 'open_inventory',
    hint: 'Press I or click the bag',
    hintRu: 'Нажмите I или значок сумки',
  },
  {
    id: 7,
    title: 'Buy Supplies',
    titleRu: 'Покупка припасов',
    description: 'Buy a small health potion from the merchant.',
    descriptionRu: 'Купите у торговца малое зелье здоровья.',
    action: 'buy_item',
    // Было 'pot_health_small' — такого товара в магазине нет. В проекте
    // две схемы наименования (определение предмета и продажа в магазине),
    // и в магазине оно называется con_health_potion_s
    target: 'con_health_potion_s',
    hint: 'Buy a health potion',
    hintRu: 'Купите зелье здоровья',
  },
  {
    id: 8,
    title: 'Hunt Bandits',
    titleRu: 'Охота на бандитов',
    description: 'Leave the city and defeat 3 bandit scouts in the wilds.',
    descriptionRu: 'Покиньте город и победите 3 разведчиков-бандитов в диких землях.',
    action: 'kill_monster',
    // Было «победите 3 бандитов» в тексте, а засчитывался первый же убитый —
    // игрок думал, что не доделал, а шаг был уже закрыт
    target: 'mob_bandit_scout',
    count: 3,
    hint: 'Defeat 3 bandit scouts',
    hintRu: 'Победите 3 разведчиков-бандитов',
  },
  {
    id: 9,
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

  /** Сколько всего шагов — клиент рисует прогресс по этому числу */
  get totalSteps(): number {
    return TUTORIAL_STEPS.length;
  }

  /** Получить текущий шаг туториала */
  async getProgress(characterId: string): Promise<{ step: number; completed: boolean }> {
    const row = await this.db.queryOne<{ current_step: number; completed: boolean }>(
      'SELECT current_step, completed FROM tutorial_progress WHERE character_id = $1',
      [characterId]
    );
    return row ? { step: row.current_step, completed: row.completed } : { step: 0, completed: false };
  }

  /** Отметить шаг как выполненный */
  async advanceStep(characterId: string): Promise<{ step: number; completed: boolean; tutorialStep: TutorialStep; totalSteps: number }> {
    const progress = await this.getProgress(characterId);
    if (progress.completed) {
      return { step: -1, completed: true, tutorialStep: TUTORIAL_STEPS[TUTORIAL_STEPS.length - 1], totalSteps: TUTORIAL_STEPS.length };
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
    return { step: nextStep, completed, tutorialStep, totalSteps: TUTORIAL_STEPS.length };
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
