// Поток квестов: ни дыр, ни стен.
//
// ЧТО БЫЛО. Разбор вел игрока уровень за уровнем по всем первым двадцати
// уровням и смотрел, открывается ли хоть что-то. Пустыми оказались девять
// уровней из двадцати: 4, 7, 9, 11, 13, 14, 16, 17 и 19. На них не
// открывалось ничего, кроме ежедневных заданий, а те раз в сутки. Новичок
// доходил до двадцатого уровня и упирался в пустоту.
//
// Одновременно нашлось второе: пять квестов требовали обязательной цели на
// 12–30 уровней выше собственного уровня. «Акулы Залива» двенадцатого
// уровня требовали двух боссов тридцатого; «Кавказский поход» двадцать
// пятого — пятнадцать элит пятьдесят пятого. За «Кавказским походом» стоят
// «Испытание пустыни» и «Битва за залив», то есть непроходимой была вся
// главная линия целиком.
//
// ПРАВИЛО, КОТОРОЕ ЗДЕСЬ ЗАКРЕПЛЯЕТСЯ. Ранние квесты в игре написаны так:
// волк шестого уровня на третьем игроке, янычар тридцать пятого на
// тридцатом. Цель может быть на пять уровней выше квеста — это «сложно, но
// честно». Дальше пяти — стена. Уровень квеста это обещание «на этом
// уровне можно пройти», а не украшение.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QUESTS_DATABASE, type QuestDefinition } from '../data/quests';
import { MONSTERS_DATABASE } from '../data/monsters';
import { NPC_DIALOGUES } from '../data/npcDialogues';
import { NPC_DYNAMIC_PROFILES } from '../data/npcDynamicProfiles';
import { QUEST_NPC_ALIAS } from '../../../shared/constants';

/** На сколько уровней цель может быть выше квеста. См. описание сверху. */
const STRETCH = 5;

/** Проверяемый отрезок пути новичка. */
const FIRST_TWENTY = 20;

const quests: QuestDefinition[] = Object.values(QUESTS_DATABASE);

/**
 * Игрок проходит по уровням и делает всё, что открылось. Возвращает
 * сколько квестов доступно на каждом уровне — с учётом выполненных
 * предыдущих, иначе цепочки квестов выглядели бы «пустыми» только
 * потому, что предшественник ещё не взят.
 */
function questsPerLevel(maxLevel: number): Map<number, string[]> {
  const done = new Set<string>();
  const out = new Map<number, string[]>();
  for (let level = 1; level <= maxLevel; level++) {
    const open = quests.filter(q =>
      q.minLevel <= level &&
      !done.has(q.id) &&
      q.prerequisites.every(p => done.has(p)));
    out.set(level, open.map(q => q.id));
    for (const q of open) done.add(q.id);
  }
  return out;
}

describe('Первые двадцать уровней без дыр', () => {
  const perLevel = questsPerLevel(FIRST_TWENTY);

  it('на каждом уровне открывается хоть один квест', () => {
    // САМА ПРОВЕРКА ЗАДАЧИ. Пустые уровни — это место, где игрок встаёт.
    const empty: number[] = [];
    for (const [level, ids] of perLevel) if (ids.length === 0) empty.push(level);
    expect(empty).toEqual([]);
  });

  it('до двадцатого уровня есть квесты сюжетной линии', () => {
    // Побочные квесты держат игрока, но история должна вести вперёд.
    // Три главных квеста на 1, 3 и 15 уровнях — это минимум.
    const mainInRange = quests.filter(q => q.type === 'main' && q.minLevel <= FIRST_TWENTY);
    expect(mainInRange.length).toBeGreaterThanOrEqual(3);
  });

  it('уровень квеста не ниже уровня его предшественников', () => {
    // Иначе квест обещает открыться на 30-м, а ждёт выполнения с 40-го:
    // игрок видит его в списке и не может взять, пока не прокачается
    // лишнего. Именно так был написан «Загадка Поэта» (30 при
    // предшественнике 40).
    const bad: string[] = [];
    for (const q of quests) {
      for (const p of q.prerequisites) {
        const prev = QUESTS_DATABASE[p];
        if (prev && prev.minLevel > q.minLevel) {
          bad.push(`${q.id}(l${q.minLevel}) ждёт ${p}(l${prev.minLevel})`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('Обязательная цель не выше уровня квеста', () => {
  it('ни одна стена не осталась', () => {
    // Главная находка этого разбора. +12…+30 уровней разницы означало
    // не «сложно», а «невозможно»: 4500 HP элиты тридцать пятого уровня
    // игрок восемнадцатого не снимает.
    const walls: string[] = [];
    for (const q of quests) {
      for (const o of q.objectives) {
        if (o.type !== 'kill' || o.optional) continue;
        const mob = MONSTERS_DATABASE[o.target];
        if (!mob) continue;
        const diff = mob.level - q.minLevel;
        if (diff > STRETCH) walls.push(`${q.id}(l${q.minLevel}) → ${o.target}(l${mob.level}) +${diff}`);
      }
    }
    expect(walls).toEqual([]);
  });

  it('правило записано константой, а не спрятано в числах', () => {
    // Чтобы следующий квест не пришлось угадывать: правило названо своими
    // словами и лежит рядом с проверкой, которая его держит
    expect(STRETCH).toBe(5);
  });
});

describe('Главная линия идёт без молчания', () => {
  it('между соседними главными квестами не больше двадцати уровней', () => {
    // Проверка на непрерывность, а не на стены (стены ловит проверка выше).
    // Молчание в двадцать уровней — это двадцать уровней без причины
    // заглянуть в журнал квестов.
    const main = quests.filter(q => q.type === 'main').sort((a, b) => a.minLevel - b.minLevel);
    const gaps: string[] = [];
    for (let i = 1; i < main.length; i++) {
      const gap = main[i].minLevel - main[i - 1].minLevel;
      if (gap > FIRST_TWENTY) gaps.push(`${main[i - 1].id}(l${main[i - 1].minLevel}) → ${main[i].id}(l${main[i].minLevel}) +${gap}`);
    }
    expect(gaps).toEqual([]);
  });

  it('главная линия начинается с первого уровня', () => {
    const firstMain = quests.filter(q => q.type === 'main').reduce((a, b) => (a.minLevel <= b.minLevel ? a : b));
    expect({ id: firstMain.id, level: firstMain.minLevel }).toEqual({ id: expect.any(String), level: 1 });
  });

  it('главный квест не висит в стороне', () => {
    // Главный квест посередине, которого не требует ни один следующий, —
    // это не линия, а отдельная ветка, забытая при переносе. Именно так
    // от него отвалился «Заставы Кавказа»: мост на 38 уровень стоял между
    // 30 и 50, но Кавказский поход его не требовал — и мост ничего не
    // соединял. Считаем не прямые ссылки, а всё, что квест требует по
    // цепочке. Последний квест линии отговоркой не считается: его и не
    // должен требовать никто.
    const requiredSomewhere = new Set<string>();
    const collect = (id: string, depth = 0): void => {
      if (depth > 20) return;
      for (const p of QUESTS_DATABASE[id]?.prerequisites ?? []) {
        if (requiredSomewhere.has(p)) continue;
        requiredSomewhere.add(p);
        collect(p, depth + 1);
      }
    };
    for (const q of quests) collect(q.id);

    const main = quests.filter(q => q.type === 'main').sort((a, b) => a.minLevel - b.minLevel);
    const lastLevel = main[main.length - 1].minLevel;
    const orphans = main
      .filter((q, i) => i > 0 && q.minLevel < lastLevel && !requiredSomewhere.has(q.id))
      .map(q => q.id);
    expect(orphans).toEqual([]);
  });
});

describe('Квест не разъезжается с каталогом', () => {
  it('id внутри квеста совпадает с его ключом', () => {
    // Каталог — объект, и два одинаковых ключа молча схлопываются в один:
    // квест исчезает без единой ошибки. А вот ключ с чужим id внутри
    // виден не сразу: сервер отдаёт одно, а ссылки ведут на другое.
    const mismatch = Object.entries(QUESTS_DATABASE)
      .filter(([key, def]) => def.id !== key)
      .map(([key, def]) => `${key} → ${def.id}`);
    expect(mismatch).toEqual([]);
  });

  it('id квеста уникальны', () => {
    const ids = quests.map(q => q.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dupes).toEqual([]);
  });
});

describe('Квестодатель есть в мире', () => {
  // Квестодатели из квестов — не настоящие NPC, а псевдонимы; настоящие
  // лежат в QUEST_NPC_ALIAS. Если псевдоним потеряется, квест останется в
  // журнале, а маркер «!» над NPC не появится: игрок ищет источник, которого
  // нет. Настоящие NPC описаны в трёх местах, и все три нужны.
  const realNpcs = new Set<string>([
    ...NPC_DIALOGUES.map(d => d.npcId),
    ...NPC_DYNAMIC_PROFILES.map(p => p.npcId),
    ...[...readFileSync(
      join(__dirname, '..', '..', '..', 'client', 'src', 'app', 'game3d', 'npc.ts'),
      'utf-8',
    ).matchAll(/id:\s*'(npc_[a-z_]+)'/g)].map(m => m[1]),
  ]);

  it('список настоящих NPC не пуст (иначе проверка ниже проходит вхолостую)', () => {
    expect(realNpcs.size).toBeGreaterThan(10);
  });

  it('каждый квестодатель разрешается в существующего NPC', () => {
    const bad: string[] = [];
    for (const q of quests) {
      const real = QUEST_NPC_ALIAS[q.npcGiver] ?? q.npcGiver;
      if (!realNpcs.has(real)) bad.push(`${q.id}: ${q.npcGiver} → ${real}`);
    }
    expect(bad).toEqual([]);
  });

  it('цели «поговорить» тоже указывают на реального NPC', () => {
    // Иначе разговор не засчитается никогда: сервер сверяет цель с тем
    // NPC, с которым игрок заговорил, и не находит совпадения.
    const bad: string[] = [];
    for (const q of quests) {
      for (const o of q.objectives) {
        if (o.type !== 'talk') continue;
        const real = QUEST_NPC_ALIAS[o.target] ?? o.target;
        if (!realNpcs.has(real)) bad.push(`${q.id}: ${o.target} → ${real}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
