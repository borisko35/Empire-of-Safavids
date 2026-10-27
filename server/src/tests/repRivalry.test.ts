// Обратная сторона медали (§363): репутация у одной фракции меняет
// отношение другой.
//
// ЗА ЧТО БОРЕТСЯ. Владелец назвал болезнь точно: «репутация есть, но у неё
// нет отрицательной ветки... Без этого это просто новый счётчик». Пол стоял
// в нуле, лестницы шли только вверх, и выбор между орденами ничего не стоил.
//
// ЧТО ТЕПЕРЬ. Две враждебные пары (кызылбаши↔ассасины — меч и тень;
// торговцы↔суфии — стяжание и отречение): положительное начисление зеркалит
// потерю сопернице один-к-одному, пол опущен до −300, у каждой лестницы
// есть враждебный ранг на дне. Следствие первое — из примера владельца
// «рост цен»: враг Гильдии платит в лавках больше, и в витрине стоит та же
// цена, что в чеке.
//
// ПОЧЕМУ ЛЕСТНИЦЫ ПРОВЕРЯЮТСЯ ПОВЕДЕНЬЕМ. FACTIONS — чистые данные: их
// можно импортировать и посчитать. Регуляркой «враждебный ранг есть»
// проверялась бы строка, а не лестница.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FACTIONS, FACTION_RIVALS, REP_HOSTILE_FLOOR, HOSTILE_PRICE_MULT,
} from '../services/ReputationService';

const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');

function must(условие: unknown, причина: string): asserts условие {
  if (!условие) throw new Error(причина);
}

describe('Враждебные пары: модель согласована', () => {
  it('соперничество взаимно: соперник соперника — ты сам', () => {
    must(Object.keys(FACTION_RIVALS).length === FACTIONS.length,
      'пары покрывают не все фракции: у кого-то рост бесплатен');
    for (const [id, rival] of Object.entries(FACTION_RIVALS)) {
      must(FACTION_RIVALS[rival] === id, `соперничество ${id} ↔ ${rival} не взаимно: зеркало одностороннее`);
      must(FACTIONS.some(f => f.id === rival), `${id} соперничает с несуществующей фракцией ${rival}`);
    }
  });

  it('пол враждебности отрицательный и достижимый', () => {
    must(REP_HOSTILE_FLOOR < 0, 'пол не отрицательный: отрицательной ветки снова нет');
    must(REP_HOSTILE_FLOOR >= -1000, `пол ${REP_HOSTILE_FLOOR} слишком глубок: это приговор, а не репутация`);
  });

  it('у каждой лестницы есть враждебный ранг на дне', () => {
    for (const f of FACTIONS) {
      const sorted = [...f.ranks].sort((a, b) => a.minRep - b.minRep);
      must(sorted[0].minRep === REP_HOSTILE_FLOOR,
        `у ${f.id} нет враждебного ранга на дне: пол reachable, а ранга нет`);
      // Лестница отсортирована: иначе getRankForRep возьмёт не тот ранг.
      for (let i = 1; i < sorted.length; i++) {
        must(sorted[i].minRep > sorted[i - 1].minRep,
          `лестница ${f.id} не отсортирована: ранги перепутаны`);
      }
    }
  });

  it('множитель цены заметен, но не грабёж', () => {
    must(HOSTILE_PRICE_MULT > 1 && HOSTILE_PRICE_MULT <= 1.3,
      `множитель врага Гильдии ${HOSTILE_PRICE_MULT}: либо незаметен, либо разоряет`);
  });
});

describe('Проводка: зеркало и цена', () => {
  const сервис = читать('server/src/services/ReputationService.ts');
  const маршруты = читать('server/src/routes/game.ts');
  const клиент = читать('client/src/app/panels.ts');

  it('зеркало стоит на положительных начислениях и не зеркалит в ответ', () => {
    must(/if \(amount > 0\) \{\s*\n\s*const rivalId = FACTION_RIVALS\[factionId\];/.test(сервис),
      'зеркало работает не только на росте: потеря качала бы обе стороны в ноль');
    must(/await this\.applyRep\(charId, rival, -amount\);/.test(сервис),
      'зеркало идёт мимо ядра: либо рекурсия, либо потеря не пишется');
    // Рекурсии нет: applyRep не зовёт addReputation.
    const ядро = сервис.slice(сервис.indexOf('private async applyRep'), сервис.indexOf('shopPriceMultiplier'));
    must(!/addReputation/.test(ядро), 'ядро зовёт addReputation: бесконечное зеркало');
  });

  it('ранг пересчитывается в обе стороны', () => {
    const ядро = сервис.slice(сервис.indexOf('private async applyRep'), сервис.indexOf('shopPriceMultiplier'));
    must(/const newRank = this\.getRankForRep\(faction, newRep\);/.test(ядро),
      'ранг не пересчитывается: враждебный титул не встанет');
  });

  it('цена врага Гильдии стоит и в витрине, и в чеке', () => {
    must((маршруты.match(/shopPriceMultiplier/g) ?? []).length === 2,
      'множитель цены живёт в одном месте: витрина врёт о цене чека');
    must(/price: Math\.floor\(item\.price \* множитель\)/.test(маршруты),
      'витрина не множит цену: враг Гильдии увидит старую цену и заплатит новую');
    must(/professionBonuses\(prof\?\.id \?\? null, prof\?\.level \?\? 0\)\.price \* гильдия/.test(маршруты),
      'в чеке гильдейский множитель не в продукте со скидкой профессии');
  });

  it('витрина зовёт с персонажем, без персонажа — базовые цены', () => {
    must(/api\.shops\(cid\(\)\)/.test(клиент), 'клиент не передаёт персонажа: множитель витрины мёртв');
    must(/characterId \? `\/api\/game\/shops\?characterId=/.test(клиент.replace(/'/g, '`')) ||
      /characterId\?/.test(клиент) === false && /characterId/.test(читать('client/src/app/api.ts')),
      'api.shops не умеет персонажа');
    // Пробники без characterId получают базовые цены: витрина не падает.
    must(/let множитель = 1;/.test(маршруты), 'без персонажа множитель не нейтрален: витрина падает');
  });
});
