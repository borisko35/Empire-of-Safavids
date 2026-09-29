// Бонусы профессий: числами, а не словами.
import { professionBonuses } from '../systems/ProfessionBonuses';

const NONE = { damage: 1, price: 1, potion: 1, experience: 1, enhanceCost: 1 };

describe('Без профессии бонусов нет', () => {
  it('нет профессии — все множители единицы', () => {
    // Не ноль: нулевой множитель обнулил бы урон и цену, и игрок без
    // профессии получил бы «бонус» ценой в ноль урона.
    expect(professionBonuses(null, 10)).toEqual(NONE);
  });

  it('неизвестная профессия из базы не ломает бой', () => {
    // Профессию могли переименовать или испортить правкой вручную. Бой и
    // экономика обязаны продолжить работать.
    expect(professionBonuses('профессия_из_будущего', 7)).toEqual(NONE);
    expect(professionBonuses('', 7)).toEqual(NONE);
  });
});

describe('Бонус растёт с уровнем', () => {
  it('каждая профессия на втором уровне сильнее первого', () => {
    const ids = ['warrior', 'archer', 'merchant', 'herbalist', 'blacksmith', 'explorer'];
    const out: Record<string, boolean> = {};
    for (const id of ids) {
      const l1 = professionBonuses(id, 1);
      const l2 = professionBonuses(id, 2);
      // Сравниваем по «своему» полю: у торговца падает цена, у кузнеца —
      // стоимость улучшения, то есть меньше значит сильнее.
      const own = (b: typeof NONE) => id === 'merchant' ? -b.price : id === 'blacksmith' ? -b.enhanceCost
        : b.damage + b.potion + b.experience;
      out[id] = own(l2) > own(l1);
    }
    expect(out).toEqual({
      warrior: true, archer: true, merchant: true, herbalist: true, blacksmith: true, explorer: true,
    });
  });
});

describe('Числа совпадают с обещанием в описании', () => {
  // Описание в панели и формула здесь обязаны совпадать. Расхождение
  // означало бы, что игрока снова обманули - только тише, чем раньше.

  it('воин: +2% урона за уровень, на потолке вдвое больше базы', () => {
    expect({
      первый: professionBonuses('warrior', 1).damage,
      десятый: professionBonuses('warrior', 10).damage,
      пятидесятый: professionBonuses('warrior', 50).damage,
    }).toEqual({ первый: 1.02, десятый: 1.2, пятидесятый: 2 });
  });

  it('лучник: +1.6% урона за уровень', () => {
    expect({
      первый: professionBonuses('archer', 1).damage,
      пятидесятый: professionBonuses('archer', 50).damage,
    }).toEqual({ первый: 1.016, пятидесятый: 1.8 });
  });

  it('тоговец: 1% скидки за уровень, не ниже половины', () => {
    expect({
      первый: professionBonuses('merchant', 1).price,
      десятый: professionBonuses('merchant', 10).price,
      пятидесятый: professionBonuses('merchant', 50).price,
    }).toEqual({ первый: 0.99, десятый: 0.9, пятидесятый: 0.5 });
  });

  it('скидка не съедает цену целиком даже на потолке', () => {
    // Ключевая защита экономики: цена должна остаться положительной, иначе
    // торговые маршруты стали бы бесплатными.
    for (let lv = 1; lv <= 500; lv++) {
      const p = professionBonuses('merchant', lv).price;
      if (!(p >= 0.5) || !(p <= 1)) {
        throw new Error(`скидка вышла из границ на уровне ${lv}: ${p}`);
      }
    }
    // Граница достижима ровно на потолке профессии. В прошлой версии
    // потолок был 20 при границе 0.5, то есть ограничение не могло
    // сработать никогда: страховка, которая ничего не страхует.
    expect({ на_потолке: professionBonuses('merchant', 50).price, за_потолком: professionBonuses('merchant', 999).price })
      .toEqual({ на_потолке: 0.5, за_потолком: 0.5 });
  });

  it('травник: +6% к зельям за уровень', () => {
    expect({
      первый: professionBonuses('herbalist', 1).potion,
      пятый: professionBonuses('herbalist', 5).potion,
    }).toEqual({ первый: 1.024, пятый: 1.12 });
  });

  it('кузнец: -1.2% к улучшению, на потолке ровно 0.4', () => {
    expect({
      первый: professionBonuses('blacksmith', 1).enhanceCost,
      десятый: professionBonuses('blacksmith', 10).enhanceCost,
      пятидесятый: professionBonuses('blacksmith', 50).enhanceCost,
      потолок: professionBonuses('blacksmith', 999).enhanceCost,
    }).toEqual({ первый: 0.988, десятый: 0.88, пятидесятый: 0.4, потолок: 0.4 });
  });

  it('исследователь: +1.6% опыта за уровень', () => {
    expect({
      первый: professionBonuses('explorer', 1).experience,
      пятидесятый: professionBonuses('explorer', 50).experience,
    }).toEqual({ первый: 1.016, пятидесятый: 1.8 });
  });
});

describe('Мусор в базе не ломает расчёт', () => {
  it('отрицательный уровень читается как нулевой', () => {
    expect(professionBonuses('warrior', -5)).toEqual(NONE);
  });

  it('дробный уровень округляется вниз', () => {
    expect(professionBonuses('warrior', 3.9).damage).toEqual(professionBonuses('warrior', 3).damage);
  });

  it('нечисловой уровень читается как нулевой', () => {
    expect(professionBonuses('warrior', NaN)).toEqual(NONE);
  });

  it('уровень выше потолка зажат', () => {
    // character_professions.level - обычная колонка без ограничения, её
    // могли поправить руками. Бонус от 999 уровня не должен ломать урон.
    expect(professionBonuses('warrior', 999).damage).toEqual(professionBonuses('warrior', 50).damage);
  });
});

describe('Чужие профессии не влияют друг на друга', () => {
  it('у воина нет скидки, у торговца нет урона', () => {
    expect({
      урон_воина_у_торговца: professionBonuses('merchant', 10).damage,
      скидка_воина: professionBonuses('warrior', 10).price,
      зелья_воина: professionBonuses('warrior', 10).potion,
    }).toEqual({ урон_воина_у_торговца: 1, скидка_воина: 1, зелья_воина: 1 });
  });
});
