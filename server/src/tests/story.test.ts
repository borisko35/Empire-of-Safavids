// Главы и кат-сцены: главное — чтобы они ссылались на реально
// существующие квесты. Раньше хроники ссылались на main_005_isfahan
// и main_006_simurgh_nest, которых в базе нет: гейт открывался
// никогда, и запись висела закрытой навсегда.
import { CHAPTERS } from '../data/chapters';
import { CUTSCENES, getCutsceneForQuest } from '../data/cutscenes';
import { QUESTS_DATABASE } from '../data/quests';

describe('Главы', () => {
  it('главы идут по порядку без пропусков и дублей', () => {
    const orders = CHAPTERS.map(c => c.order);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
    for (let i = 0; i < orders.length; i++) expect(orders[i]).toBe(i + 1);
    expect(new Set(CHAPTERS.map(c => c.id)).size).toBe(CHAPTERS.length);
  });

  it('каждый квест главы существует', () => {
    const missing: string[] = [];
    for (const ch of CHAPTERS) {
      for (const q of ch.quests) {
        if (!QUESTS_DATABASE[q]) missing.push(`${ch.id} → ${q}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('в главе есть хотя бы один квест', () => {
    // Пустая глава — это заголовок без содержания: игрок не понимает,
    // что вообще делать дальше
    for (const ch of CHAPTERS) {
      expect({ id: ch.id, quests: ch.quests.length > 0 }).toEqual({ id: ch.id, quests: true });
    }
  });

  it('квест не стоит в двух главах сразу', () => {
    // Иначе игрок увидит «2/2 выполнено» в обеих и не поймёт, где искать
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    for (const ch of CHAPTERS) {
      for (const q of ch.quests) {
        if (seen.has(q)) dupes.push(`${q}: ${seen.get(q)} и ${ch.id}`);
        else seen.set(q, ch.id);
      }
    }
    expect(dupes).toEqual([]);
  });

  it('сцены главы существуют', () => {
    for (const ch of CHAPTERS) {
      for (const id of ch.cutscenes) {
        expect({ chapter: ch.id, cutscene: CUTSCENES.some(c => c.id === id) })
          .toEqual({ chapter: ch.id, cutscene: true });
      }
    }
  });

  it('у главы реалистичный уровень открытия', () => {
    for (const ch of CHAPTERS) {
      const questLevels = ch.quests.map(q => QUESTS_DATABASE[q]?.minLevel ?? 0);
      const lowest = Math.min(...questLevels);
      // Порог не должен быть выше минимального уровня квестов главы:
      // иначе игрок выполнит квесты, но глава останется «закрытой»
      expect({ id: ch.id, minLevel: ch.minLevel, lowestQuest: lowest, ok: ch.minLevel <= lowest })
        .toEqual({ id: ch.id, minLevel: ch.minLevel, lowestQuest: lowest, ok: true });
    }
  });
});

describe('Кат-сцены', () => {
  it('у сцены есть реплики на обоих языках', () => {
    for (const c of CUTSCENES) {
      expect({ id: c.id, lines: c.lines.length > 0 }).toEqual({ id: c.id, lines: true });
      for (const [i, l] of c.lines.entries()) {
        expect({ id: c.id, i, ru: !!l.textRu?.trim(), en: !!l.text?.trim() })
          .toEqual({ id: c.id, i, ru: true, en: true });
        expect({ id: c.id, i, who: !!l.speakerName?.trim() }).toEqual({ id: c.id, i, who: true });
      }
    }
  });

  it('сцена привязана к существующему квесту', () => {
    for (const c of CUTSCENES) {
      expect({ id: c.id, quest: !!QUESTS_DATABASE[c.triggerQuest] })
        .toEqual({ id: c.id, quest: true });
    }
  });

  it('сцена относится к существующей главе', () => {
    for (const c of CUTSCENES) {
      expect({ id: c.id, chapter: CHAPTERS.some(ch => ch.id === c.chapterId) })
        .toEqual({ id: c.id, chapter: true });
    }
  });

  it('на одну пару «квест + событие» не больше одной сцены', () => {
    const keys = CUTSCENES.map(c => `${c.triggerQuest}:${c.trigger}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('поиск сцены по событию работает', () => {
    expect(getCutsceneForQuest('main_001_awakening', 'accept')?.id).toBe('cut_001_awakening');
    // На принятие сцены нет — и на завершение тоже
    expect(getCutsceneForQuest('main_001_awakening', 'complete')).toBeUndefined();
    expect(getCutsceneForQuest('side_001_scorpion_nest', 'accept')).toBeUndefined();
  });

  it('каждая сцена попадает в список сцен своей главы', () => {
    for (const c of CUTSCENES) {
      const ch = CHAPTERS.find(x => x.id === c.chapterId);
      expect({ id: c.id, listed: ch?.cutscenes.includes(c.id) })
        .toEqual({ id: c.id, listed: true });
    }
  });
});
