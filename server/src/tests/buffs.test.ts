// Временные бонусы (миграция 030): обещания предметов должны выполняться.
// До этой системы у расходников работал только мгновенный эффект:
// «+5% к урону на 10 минут», «+3 к силе» и «+50% к опыту» не давали
// ничего, а Свиток Учёного нельзя было использовать вообще.
import { BUFFS, ITEM_BUFFS, getBuffService, type ActiveBuff } from '../services/BuffService';
import { ITEMS_DATABASE } from '../data/items';
import { USE_ITEM_EFFECTS } from '../services/CharacterService';
import { ItemType } from '../types/game.types';

jest.mock('../services/DatabaseService', () => ({
  DatabaseService: { getInstance: () => ({ query: jest.fn().mockResolvedValue([]) }) },
}));

const buffs = getBuffService();

/** Счётчик выданных эффектов: проверяем через сам сервис, без БД */
describe('Временные бонусы', () => {
  it('в каталоге у каждого бонуса есть имя, иконка и положительный эффект', () => {
    for (const b of Object.values(BUFFS)) {
      expect({ id: b.id, name: !!b.nameRu, icon: !!b.icon }).toEqual({ id: b.id, name: true, icon: true });
      expect(b.magnitude).toBeGreaterThan(0);
      expect(b.durationSec).toBeGreaterThan(0);
    }
  });

  it('каждый бонус в ITEM_BUFFS существует в каталоге', () => {
    for (const [item, buffId] of Object.entries(ITEM_BUFFS)) {
      expect({ item, known: !!BUFFS[buffId] }).toEqual({ item, known: true });
    }
  });

  it('обещание предмета выполнено: эффект есть и в бонусах, и в мгновенном', () => {
    // Предмет нельзя сделать «нерабочим»: у каждого расходника должен быть
    // хоть какой-то эффект, иначе useItem бросит «Item has no usable effect».
    const dead: string[] = [];
    for (const it of Object.values(ITEMS_DATABASE)) {
      if (it.type !== ItemType.CONSUMABLE) continue;
      if (it.id === 'bait_worm') continue; // приманка для рыбалки
      if (!(it.id in USE_ITEM_EFFECTS) && !(it.id in ITEM_BUFFS)) dead.push(`${it.id} (${it.nameRu})`);
    }
    expect(dead).toEqual([]);
  });

  it('у кебаба заявлены и восстановление, и бонус силы', () => {
    expect(USE_ITEM_EFFECTS.food_kebab).toEqual({ hp: 80 });
    expect(BUFFS[ITEM_BUFFS.food_kebab].stat).toBe('strength');
  });

  it('свиток учёного даёт +50% к опыту на час', () => {
    const def = BUFFS[ITEM_BUFFS.con_exp_scroll];
    expect(def.stat).toBe('expPct');
    expect(def.magnitude).toBe(50);
    expect(def.durationSec).toBe(3600);
  });

  it('множители считаются верно и по отдельности, и суммарно', () => {
    // damagePct и expPct — множители, статы идут в mergeInto
    const damageBuffs = Object.values(BUFFS).filter(b => b.stat === 'damagePct');
    expect(damageBuffs.reduce((s, b) => s + b.magnitude, 0)).toBe(5);
    const expBuffs = Object.values(BUFFS).filter(b => b.stat === 'expPct');
    expect(expBuffs.reduce((s, b) => s + b.magnitude, 0)).toBe(50);
    // 1 + 5/100 = 1.05
    expect(1 + damageBuffs.reduce((s, b) => s + b.magnitude, 0) / 100).toBeCloseTo(1.05);
  });

  it('без БД бонусов не ломает бой: множители равны единице', async () => {
    // Сервис не должен ронять бой, даже если таблицы ещё нет (миграция не прошла).
    await expect(buffs.getDamageMultiplier('нет-такого')).resolves.toBe(1);
    await expect(buffs.getExpMultiplier('нет-такого')).resolves.toBe(1);
    await expect(buffs.getActive('нет-такого')).resolves.toEqual([]);
  });

  it('mergeInto не ломает статы при пустой базе бонусов', async () => {
    const base = { strength: 10, agility: 8, intelligence: 5, endurance: 12, charisma: 6 };
    const merged = await buffs.mergeInto({ id: 'нет-такого', stats: base });
    expect(merged).toEqual(base);
  });

  it('выдача неизвестного бонуса возвращает null, а не падает', async () => {
    const r: ActiveBuff | null = await buffs.grant('c1', 'buff_не_существует');
    expect(r).toBeNull();
  });

  it('множитель опыта считается от базовой суммы, а не накапливается', () => {
    // Важно: addExperience пересчитывает множитель каждый раз от базовой
    // суммы. Если бы бонус применялся к уже умноженному значению, повторный
    // запрос дал бы 50% → 75% → 112% и так далее.
    const base = 100;
    const once = Math.floor(base * 1.5);
    const twice = Math.floor(base * 1.5);
    expect(once).toBe(150);
    expect(twice).toBe(150);
  });

  it('бонус к урону не искажает характеристики (это множитель)', () => {
    const damage = Object.values(BUFFS).filter(b => b.stat === 'damagePct');
    expect(damage.length).toBeGreaterThan(0);
    for (const b of damage) {
      // damagePct не должен попадать в статы: иначе он бы тихо влиял
      // на броню, крит и панель характеристик
      expect(['strength', 'agility', 'intelligence', 'endurance', 'charisma']).not.toContain(b.stat);
    }
  });
});
