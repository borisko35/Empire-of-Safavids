// Туториал новичка — самая важная вещь для удержания.
//
// ТУТ БЫЛА НАЙДЕНА МЁРТВАЯ ФУНКЦИЯ. Файл написан целиком (оверлей,
// прогресс, шаги, стили, api), но initTutorial() не вызывался НИ РАЗУ,
// а onTutorialAction() не был подписан ни на одно событие. Игрок видел
// город с двадцатью кнопками и не понимал, куда нажать.
//
// ПОТОМ ВЫЯСНИЛОСЬ, ЧТО И ЧЕТЫРЕ ШАГА БЫЛИ НЕЗАКРЫВАЕМЫ: цели шагов
// ('npc_merchant', 'pot_health_small', 'training_dummy') не существовали
// в данных игры. Клиент сверял их при каждом действии и молча отказывался
// засчитывать шаг — игрок буксовал и уходил.
//
// Проверяем то, что ломается незаметно:
//   1) каждая цель шага РЕАЛЬНО существует в данных игры;
//   2) на каждое действие шага подписан клиент (иначе шаг не закроется);
//   3) шаг с предметом требует именно его, а не любой;
//   4) текст шага не обещает того, чего условие не проверяет.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { TUTORIAL_STEPS } from '../services/TutorialService';

const repoRoot = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');

/** Действия, на которые подписан клиент */
const KNOWN_ACTIONS = [
  'read', 'move', 'camera', 'attack', 'use_skill', 'talk_npc',
  'open_inventory', 'buy_item', 'kill_monster', 'complete',
];

const clientFiles = [
  'client/src/app/tutorial.ts',
  'client/src/app/world.ts',
  'client/src/app/panels.ts',
  'client/src/app/dialogue.ts',
  'client/src/app/game3d/world3d.ts',
].map(read).join('\n');

/** Идентификаторы NPC из игровых данных клиента */
function npcIds(): Set<string> {
  const src = read('client/src/app/game3d/npc.ts');
  return new Set((src.match(/id:\s*'(npc_[a-z_]+)'/g) ?? [])
    .map((m) => m.replace(/id:\s*'/, '').replace(/'$/, '')));
}

/** Идентификаторы монстров из игровых данных сервера */
function monsterIds(): Set<string> {
  const src = read('server/src/data/monsters.ts');
  return new Set((src.match(/id:\s*'(mob_[a-z_]+)'/g) ?? [])
    .map((m) => m.replace(/id:\s*'/, '').replace(/'$/, '')));
}

/** Идентификаторы предметов из игровых данных сервера */
function itemIds(): Set<string> {
  const src = read('server/src/data/items.ts');
  return new Set((src.match(/id:\s*'([a-z]+_[a-z_]+)'/g) ?? [])
    .map((m) => m.replace(/id:\s*'/, '').replace(/'$/, '')));
}

const NPC_IDS = npcIds();
const MONSTER_IDS = monsterIds();
const ITEM_IDS = itemIds();

describe('Туториал: подключение', () => {
  it('initTutorial вызывается при входе в мир (иначе оверлей не покажется)', () => {
    // Раньше функция была мертвой: определена, но не вызвана нигде
    expect(clientFiles).toMatch(/void initTutorial\(/);
  });

  it('покадровая проверка подключена к игровому циклу', () => {
    // Шаг «иди» без покадровой проверки не засчитывается никогда
    expect(clientFiles).toMatch(/tickTutorial\(\)/);
  });

  it('каждое действие шага имеет подписку в клиенте', () => {
    // 'read' и 'complete' — исключения: их закрывает только кнопка «Далее»
    const needsHook = KNOWN_ACTIONS.filter((a) => a !== 'read' && a !== 'complete');
    for (const action of needsHook) {
      const hooked = (clientFiles.match(new RegExp(`onTutorialAction\\('${action}'`, 'g')) ?? []).length;
      // 'move' засчитывается покадрово по расстоянию, а не вызовом из события
      const ok = action === 'move' ? /currentAction !== 'move'/.test(clientFiles) : hooked > 0;
      expect({ action, ok }).toEqual({ action, ok: true });
    }
  });

  it('кнопка «Далее» и «Пропустить» прописаны в разметке оверлея', () => {
    expect(clientFiles).toMatch(/tutorial-next/);
    expect(clientFiles).toMatch(/tutorial-skip/);
  });
});

describe('Туториал: цели шагов существуют в игре', () => {
  // ГЛАВНЫЙ ТЕСТ ФАЙЛА. Четыре шага были незакрываемы, потому что их цели
  // были выдуманы: 'npc_merchant' (в игре npc_bazaar_merchant),
  // 'pot_health_small' (в магазине con_health_potion_s), 'training_dummy'
  // (не существует вовсе). Клиент сверял цель и молча не засчитывал шаг.
  const targetByAction: Record<string, (id: string) => boolean> = {
    talk_npc: (id) => NPC_IDS.has(id),
    kill_monster: (id) => MONSTER_IDS.has(id),
    buy_item: (id) => ITEM_IDS.has(id),
  };

  for (const step of TUTORIAL_STEPS) {
    if (!step.target) continue;
    const target = step.target;
    const check = targetByAction[step.action];
    it(`шаг «${step.titleRu}» — цель '${target}' существует`, () => {
      // Для действия без справочника проверяем, что id не выдуман:
      // он обязан встречаться хотя бы где-то в игровых данных
      const known = check
        ? check(target)
        : [NPC_IDS, MONSTER_IDS, ITEM_IDS].some((s) => s.has(target));
      expect({ target, exists: known }).toEqual({ target, exists: true });
    });
  }

  it('справочники данных не пустые (иначе проверка выше проходит вхолостую)', () => {
    // Защита от тихой поломки самого теста: если файлы данных переедут,
    // тест обязан покраснеть, а не радостно пропустить всё
    expect(NPC_IDS.size).toBeGreaterThan(5);
    expect(MONSTER_IDS.size).toBeGreaterThan(5);
    expect(ITEM_IDS.size).toBeGreaterThan(20);
  });
});

describe('Туториал: защита от жадного пропуска', () => {
  it('шаг засчитывается только при совпадении действия', () => {
    // Прежний код переходил на следующий шаг от ЛЮБОГО действия, и игрок
    // прокликивал все шаги, не сделав ни одного
    expect(clientFiles).toMatch(/currentAction !== action/);
  });

  it('шаг с предметом требует именно этот предмет', () => {
    expect(clientFiles).toMatch(/currentTarget && target && target !== currentTarget/);
  });

  it('шаг с повторами считает их, а не закрывается первым же', () => {
    // В тексте было «победите 3 бандитов», а засчитывался первый убитый
    expect(clientFiles).toMatch(/currentCount > 1/);
    expect(clientFiles).toMatch(/currentDone < currentCount/);
  });

  it('шаг «иди» считается по расстоянию, а не по нажатию клавиши', () => {
    expect(clientFiles).toMatch(/MOVE_DONE_M/);
    expect(clientFiles).toMatch(/session\.selfPos/);
  });
});

describe('Туториал: текст шага совпадает с условием', () => {
  // Проверяем, что цель шага не выдумана, а текст не врёт про игру.
  // Раньше шаг «камера» обещал правую кнопку мыши, хотя ею в игре
  // блокируют щитом, а камеру крутит движение мыши.
  const steps = TUTORIAL_STEPS.filter((s) => s.action === 'camera');
  it('шаг камеры не обещает правую кнопку мыши (ею блокируют)', () => {
    for (const s of steps) {
      const text = `${s.description} ${s.descriptionRu} ${s.hint} ${s.hintRu}`.toLowerCase();
      expect(/правую кнопку|right mouse/.test(text)).toBe(false);
    }
  });

  it('у каждого шага есть заголовок, описание и подсказка (кроме финального)', () => {
    for (const s of TUTORIAL_STEPS) {
      expect({ id: s.id, hasTitle: !!s.titleRu, hasDesc: !!s.descriptionRu })
        .toEqual({ id: s.id, hasTitle: true, hasDesc: true });
      if (s.action !== 'complete') {
        expect({ id: s.id, hasHint: !!s.hintRu }).toEqual({ id: s.id, hasHint: true });
      }
    }
  });

  it('действия шагов принадлежат известному набору', () => {
    for (const s of TUTORIAL_STEPS) {
      expect(KNOWN_ACTIONS).toContain(s.action);
    }
  });

  it('шаг с повторами говорит о числе, которое и требует', () => {
    // Текст «победите 3» и count: 3 обязаны совпадать, иначе игрок снова
    // будет считать недоработанным уже закрытый шаг
    for (const s of TUTORIAL_STEPS.filter((x) => x.count)) {
      expect(`${s.hintRu} ${s.descriptionRu}`).toContain(String(s.count));
    }
  });
});

describe('Туториал: переводы', () => {
  const keys = ['tutorial.skip', 'tutorial.next', 'tutorial.start_game', 'tutorial.done'];
  for (const lang of ['ru', 'en', 'az']) {
    it(`в ${lang} есть все строки туториала`, () => {
      const json = JSON.parse(read(`shared/locales/${lang}.json`)) as Record<string, unknown>;
      for (const k of keys) {
        const val = k.split('.').reduce<unknown>((o, p) => (o as Record<string, unknown>)?.[p], json);
        expect({ key: k, present: !!val }).toEqual({ key: k, present: true });
      }
    });
  }

  it('текст шага выбирается по языку игрока, а не всегда по-русски', () => {
    // Английному игроку показывался русский туториал
    expect(clientFiles).toMatch(/document\.documentElement\.lang/);
  });

  it('число шагов берётся с сервера, а не зашито в клиенте', () => {
    // Было зашито 9 — расходилось с сервером при любой правке шагов
    expect(clientFiles).toMatch(/totalSteps/);
    expect(clientFiles).not.toMatch(/const totalSteps = \d/);
  });
});
