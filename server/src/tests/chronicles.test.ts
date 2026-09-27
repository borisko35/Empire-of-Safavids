// Хроники Сефевидов: логика открытия записей.
// Маршрут отдавал все записи подряд, а getUnlocked не вызывался ни одним
// маршрутом — условия открытия были чистой декорацией, и игрок видел всю
// энциклопедию сразу. Здесь проверяем, что гейт работает по-настоящему.
import { CHRONICLES, ChroniclesService } from '../services/ChroniclesService';
import { QUESTS_DATABASE } from '../data/quests';

const service = new ChroniclesService();

describe('Хроники Сефевидов', () => {
  it('без выполненных квестов открыты только базовые записи', () => {
    const view = service.getView([]);
    const openIds = view.filter(e => e.unlocked).map(e => e.id);
    const expected = CHRONICLES.filter(c => c.unlockCondition === 'default').map(c => c.id);
    expect(openIds).toEqual(expected);
    expect(openIds.length).toBeGreaterThan(0);
  });

  it('выполнение квеста открывает ровно связанные с ним записи', () => {
    for (const entry of CHRONICLES) {
      if (entry.unlockCondition === 'default') continue;
      const view = service.getView([entry.unlockCondition]);
      const opened = view.filter(e => e.unlocked).map(e => e.id);
      expect({ quest: entry.unlockCondition, includes: opened.includes(entry.id) })
        .toEqual({ quest: entry.unlockCondition, includes: true });
    }
  });

  it('у закрытой записи есть понятная подсказка с названием квеста', () => {
    const view = service.getView([]);
    for (const e of view) {
      if (e.unlocked) { expect(e.unlockHintRu).toBeNull(); continue; }
      expect({ id: e.id, hint: !!e.unlockHintRu }).toEqual({ id: e.id, hint: true });
      // Подсказка — название квеста из каталога, а не сырой id
      expect(e.unlockHintRu).not.toBe(e.unlockCondition);
      expect(e.unlockHintRu).toBe(QUESTS_DATABASE[e.unlockCondition].titleRu);
    }
  });

  it('прогресс не убывает: выполненные квесты только открывают', () => {
    const all = [...new Set(CHRONICLES.map(c => c.unlockCondition).filter(c => c !== 'default'))];
    const done: string[] = [];
    let last = 0;
    for (const q of all) {
      done.push(q);
      // Список выполненных накапливается: открытых записей становится
      // только больше, закрытая запись не может снова закрыться.
      const n = service.getView(done).filter(e => e.unlocked).length;
      expect({ after: q, opened: n }).toEqual({ after: q, opened: n });
      expect(n).toBeGreaterThan(last);
      last = n;
    }
    // Выполнив все квесты-условия, открыто всё
    expect(service.getView(all).filter(e => e.unlocked).length).toBe(CHRONICLES.length);
  });

  it('у записи и во виде одинаковый набор полей', () => {
    const [first] = CHRONICLES;
    const view = service.getView([]).find(e => e.id === first.id)!;
    expect(view.id).toBe(first.id);
    expect(view.contentRu).toBe(first.contentRu);
    expect(view.category).toBe(first.category);
  });

  it('getUnlocked отдаёт только открытые записи', () => {
    const open = service.getUnlocked([]);
    expect(open.length).toBe(service.getView([]).filter(e => e.unlocked).length);
    for (const e of open) {
      expect(e.unlockCondition).toBe('default');
    }
  });
});
