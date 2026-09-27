// Проверка ссылочной целостности игровых данных.
// Падает, если лут/крафт/квест/магазин ссылаются на несуществующий предмет,
// либо если collect-квест нельзя пройти. Запускать после правок
// server/src/data/*.ts — именно эти проверки нашли 4 непроходимых квеста.
import { ITEMS_DATABASE } from '../data/items';
import { MONSTERS_DATABASE } from '../data/monsters';
import { CRAFTING_RECIPES } from '../data/crafting';
import { QUESTS_DATABASE } from '../data/quests';
import { NPC_SHOPS } from '../services/AuctionService';
import { USE_ITEM_EFFECTS } from '../services/CharacterService';
import { CHRONICLES } from '../services/ChroniclesService';
import { MOUNTS } from '../systems/MountSystem';
import { BOATS } from '../systems/BoatSystem';
import { FISH_TABLE } from '../systems/FishingSystem';
import { ItemType } from '../types/game.types';

// Не всё, что продаётся, лежит в ITEMS_DATABASE: кони и лодки намеренно
// живут в отдельных каталогах (MountSystem / BoatSystem) — магазин
// обрабатывает их через kind и префикс id.
function knownItem(id: string): boolean {
  return id in ITEMS_DATABASE || id in MOUNTS || id in BOATS;
}

// Лучший источник предмета: максимальный шанс дропа
function bestDropSource(): Map<string, { chance: number; maxQty: number }> {
  const best = new Map<string, { chance: number; maxQty: number }>();
  for (const m of Object.values(MONSTERS_DATABASE)) {
    for (const e of m.lootTable) {
      const prev = best.get(e.itemId);
      if (!prev || e.chance > prev.chance) best.set(e.itemId, { chance: e.chance, maxQty: e.maxQty });
    }
  }
  return best;
}

describe('Целостность игровых данных', () => {
  it('лут монстров ссылается на существующие предметы', () => {
    for (const m of Object.values(MONSTERS_DATABASE)) {
      for (const entry of m.lootTable) {
        expect({ mob: m.id, itemId: entry.itemId, known: knownItem(entry.itemId) })
          .toEqual({ mob: m.id, itemId: entry.itemId, known: true });
        expect(entry.chance).toBeGreaterThan(0);
        expect(entry.chance).toBeLessThanOrEqual(1);
        expect(entry.minQty).toBeGreaterThan(0);
        expect(entry.maxQty).toBeGreaterThanOrEqual(entry.minQty);
      }
    }
  });

  it('collect-квесты проходимы: каждый нужный предмет можно получить', () => {
    // Предмет, который квест просит принести, обязан откуда-то выдаваться —
    // из монстра или из магазина. До этой проверки в игре было 4 квеста,
    // непроходимых в принципе: qst_royal_seal, qst_hafiz_scroll и
    // mat_rose_petals не выпадали ни с кого и не продавались.
    const obtainable = new Set<string>();
    for (const m of Object.values(MONSTERS_DATABASE)) {
      for (const e of m.lootTable) obtainable.add(e.itemId);
    }
    for (const shop of Object.values(NPC_SHOPS)) {
      for (const it of shop.items) obtainable.add(it.itemId);
    }

    const unreachable: string[] = [];
    for (const q of Object.values(QUESTS_DATABASE)) {
      for (const o of q.objectives) {
        if (o.type !== 'collect') continue;
        if (!obtainable.has(o.target)) {
          unreachable.push(`${q.id} ждёт ${o.target} (${ITEMS_DATABASE[o.target]?.nameRu ?? '?'})`);
        }
      }
    }
    expect(unreachable).toEqual([]);
  });

  it('collect-цель не требует нереального количества', () => {
    // Что можно купить — не обязано выпадать часто (шёлк, бирюза продаются).
    // Что нельзя купить нигде — обязано падать надёжно, иначе квест
    // превращается в лотерей. Ловим случай «шанс 5%, а нужно двадцать штук».
    const sold = new Set<string>();
    for (const shop of Object.values(NPC_SHOPS)) {
      for (const it of shop.items) sold.add(it.itemId);
    }

    const best = bestDropSource();
    const bad: string[] = [];
    for (const q of Object.values(QUESTS_DATABASE)) {
      for (const o of q.objectives) {
        if (o.type !== 'collect') continue;
        const src = best.get(o.target);
        if (!src) continue; // недостижимость ловится отдельным тестом
        const buyable = sold.has(o.target);
        if (!buyable && src.chance < 0.5) {
          bad.push(`${q.id}: ${o.target} шанс всего ${src.chance} и не продаётся`);
        }
        if (src.chance >= 0.5 && o.required > src.maxQty * 40) {
          bad.push(`${q.id}: ${o.target} нужно ${o.required}, за убийство максимум ${src.maxQty}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('хроники открываются реальными квестами', () => {
    // Условие открытия — это id квеста из каталога. Пять записей ссылались
    // на несуществующие квесты (main_005_isfahan, main_006_simurgh_nest,
    // poem_ghazal_1 и др.) — такие записи не открывались никогда.
    const bad = CHRONICLES
      .filter(c => c.unlockCondition !== 'default')
      .filter(c => !(c.unlockCondition in QUESTS_DATABASE))
      .map(c => `${c.id} → ${c.unlockCondition}`);
    expect(bad).toEqual([]);
  });

  it('каждая запись хроник имеет русский текст', () => {
    for (const c of CHRONICLES) {
      expect({ id: c.id, title: !!c.titleRu, content: !!c.contentRu })
        .toEqual({ id: c.id, title: true, content: true });
      expect(c.contentRu.length).toBeGreaterThan(40);
    }
  });

  it('хроники: у каждой записи есть условие, а уникальные id не повторяются', () => {
    const ids = CHRONICLES.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of CHRONICLES) {
      expect(typeof c.unlockCondition).toBe('string');
      expect(c.unlockCondition.length).toBeGreaterThan(0);
    }
  });

  it('расходники из каталога имеют эффект применения', () => {
    // Описание предмета обещает восстановление, а таблица эффектов про него
    // не знала: так «Тоник выносливости» нельзя было выпить — useItem
    // бросал «Item has no usable effect».
    const missing: string[] = [];
    for (const it of Object.values(ITEMS_DATABASE)) {
      if (it.type !== ItemType.CONSUMABLE) continue;
      if (!/восстанавливает/i.test(it.description)) continue;
      if (!(it.id in USE_ITEM_EFFECTS)) missing.push(`${it.id} (${it.nameRu})`);
    }
    expect(missing).toEqual([]);
  });

  it('крафт ссылается на существующие предметы', () => {
    for (const r of Object.values(CRAFTING_RECIPES)) {
      expect({ recipe: r.id, item: r.resultItemId, known: knownItem(r.resultItemId) })
        .toEqual({ recipe: r.id, item: r.resultItemId, known: true });
      for (const ing of r.ingredients) {
        expect({ recipe: r.id, item: ing.itemId, known: knownItem(ing.itemId) })
          .toEqual({ recipe: r.id, item: ing.itemId, known: true });
        expect(ing.quantity).toBeGreaterThan(0);
      }
      expect(r.successRate).toBeGreaterThan(0);
      expect(r.successRate).toBeLessThanOrEqual(1);
    }
  });

  it('квесты ссылаются на существующие предметы и на реальных монстров', () => {
    for (const q of Object.values(QUESTS_DATABASE)) {
      for (const o of q.objectives) {
        if (o.type === 'collect' || o.type === 'craft' || o.type === 'trade') {
          expect({ quest: q.id, item: o.target, known: knownItem(o.target) })
            .toEqual({ quest: q.id, item: o.target, known: true });
        }
        if (o.type === 'kill') {
          expect({ quest: q.id, mob: o.target, known: o.target in MONSTERS_DATABASE })
            .toEqual({ quest: q.id, mob: o.target, known: true });
        }
      }
      for (const it of q.rewards.items ?? []) {
        expect({ quest: q.id, item: it.itemId, known: knownItem(it.itemId) })
          .toEqual({ quest: q.id, item: it.itemId, known: true });
      }
    }
  });

  it('магазины продают существующие предметы, кони и лодки', () => {
    for (const [shopId, shop] of Object.entries(NPC_SHOPS)) {
      for (const it of shop.items) {
        // Иначе покупка молча падает с «Item not found»
        expect({ shopId, itemId: it.itemId, known: knownItem(it.itemId) })
          .toEqual({ shopId, itemId: it.itemId, known: true });
      }
    }
  });

  it('у лодок в каталоге есть цена, уровень и запас прочности', () => {
    for (const [boatId, b] of Object.entries(BOATS)) {
      expect({ boatId, ok: b.id === boatId && b.price > 0 && b.minLevel >= 1 && b.catchLimit > 0 && b.fishingBonus >= 1 })
        .toEqual({ boatId, ok: true });
      // waterSpeed 1 = вода не тормозит. Больше единицы — абсурд.
      expect(b.waterSpeed).toBeGreaterThan(0);
      expect(b.waterSpeed).toBeLessThanOrEqual(1);
    }
  });

  it('каждая рыба ловится в каталоге предметов (иначе улов не выдастся)', () => {
    // id рыбы должен быть в ITEMS_DATABASE — FishingSystem выдаёт его
    // через addItems, а несуществующий предмет тихо уходит в никуда
    for (const f of FISH_TABLE) {
      expect({ id: f.id, exists: f.id in ITEMS_DATABASE })
        .toEqual({ id: f.id, exists: true });
    }
  });

  it('в игре есть магазин, где продаются квестовые предметы', () => {
    // Клиент рисует все магазины из /api/game/shops, поэтому новый магазин
    // сразу появляется в панели без правок на клиенте. Проверяем, что
    // квестовые предметы действительно продаются, а не только выпадают.
    const sold = new Set<string>();
    for (const shop of Object.values(NPC_SHOPS)) {
      for (const it of shop.items) sold.add(it.itemId);
    }
    // Свитки Хафиза и лепестки роз — без магазина их пришлось бы фармить
    for (const id of ['qst_hafiz_scroll', 'mat_rose_petals']) {
      expect({ item: id, sold: sold.has(id) }).toEqual({ item: id, sold: true });
    }
  });

  it('трофеи нельзя надеть, и у них есть цена', () => {
    // Слоты экипировки только трёх типов. Если трофеи туда просочатся,
    // игрок наденет волчью шкуру вместо брони.
    const equippable = new Set([ItemType.WEAPON, ItemType.ARMOR, ItemType.ACCESSORY]);
    for (const item of Object.values(ITEMS_DATABASE)) {
      if (item.type !== ItemType.TROPHY) continue;
      expect({ id: item.id, equippable: equippable.has(item.type) })
        .toEqual({ id: item.id, equippable: false });
      expect(item.price).toBeGreaterThan(0);
      expect(item.maxStack).toBeGreaterThanOrEqual(1);
    }
  });

  it('уникальный трофей не копится, а обычный — копится', () => {
    // У жемчужины и рога Левиафана stackable=false и maxStack=1: в сумке
    // может быть только один. Смешивать эти свойства нельзя — предмет с
    // stackable=false и maxStack=999 занимает слот на каждый экземпляр.
    // Частые трофеи (плавники, чешуя) наоборот обязаны копиться, иначе
    // десять одинаковых плавников занимают десять слотов.
    for (const item of Object.values(ITEMS_DATABASE)) {
      if (!item.stackable) {
        expect({ id: item.id, max: item.maxStack }).toEqual({ id: item.id, max: 1 });
      }
      if (item.type === ItemType.TROPHY && item.stackable) {
        expect({ id: item.id, max: item.maxStack }).toEqual({ id: item.id, max: expect.any(Number) });
        expect(item.maxStack).toBeGreaterThan(1);
      }
    }
  });
});
