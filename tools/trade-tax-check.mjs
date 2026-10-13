// Проверка налога trade_tax на живом сервере (ROADMAP §181).
//
// ЧТО ПРОВЕРЯЕТ. Гильдия, держущая территорию с бонусом trade_tax, должна
// получить часть награды за доставленный караван, а игрок — остаток. Плюс
// обратная сторона: свой караван своей гильдии налогом не облагается.
//
// ПОЧЕМУ ЗАСАДА ГОТОВИТСЯ ВРУЧНУЮ. Ни гильдий, ни захваченных территорий в
// базе нет: guilds пуста, у всех четырёх guild_territories guild_id равен NULL.
// Налог с такой базой сработал бы ноль раз, и проверить его было бы нечем.
// Поэтому тестовая гильдия и захват создаются напрямую и убираются в конце.
// Оба шага обратимы, и без них проверка не запустится.
//
// ПОЧЕМУ СРОК СДВИГАЕТСЯ ВРУЧНУЮ. Контракт из Тебриза идёт 3 минуты. Ждать
// три минуты ради проверки можно, но незачем: срок в таблице, и достаточно
// отнести started_at в прошлое. Прибытие считается по нему же.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const URL = process.env.EOS_GAME_URL ?? 'https://game.eos-gameonline.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const лог = (...a) => console.log(...a);

const psql = (sql) => execFileSync('docker', [
  'exec', 'empire-of-safavids-postgres-1', 'psql', '-U', 'safavid_user',
  '-d', 'empire_of_safavids', '-t', '-A', '-c', sql,
], { encoding: 'utf8' }).trim();

const raw = readFileSync('D:/My Projects/Empire of Sefevids/deploy/.test-account', 'utf8');
const вход = await fetch(`${URL}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: raw.match(/почта\s*:\s*(\S+)/)?.[1],
    password: raw.match(/пароль\s*:\s*(\S+)/)?.[1],
  }),
});
const token = (await вход.json()).data.token;
const заголовки = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
const список = await (await fetch(`${URL}/api/characters`, { headers: заголовки })).json();
const герой = список.characters.find((c) => c.name === 'EosProbe');
if (!герой) { лог('персонажа EosProbe нет'); process.exit(1); }
const me = герой.id;

const ТЕРРИТОРИЯ = 'territory_tabriz_market';
const КОНТРАКТ = 'trade_tabriz_isfahan_silk';

async function убрать() {
  // Строку территории НЕ удаляем, а возвращаем в исходное состояние.
  //
  // ЧТО ТУТ СЛОМАЛОСЬ. Первая версия проверки писала
  //   DELETE FROM guild_territories WHERE territory_id = 'territory_tabriz_market'
  // и запускалась несколько раз. Строка исчезла из базы по-настоящему, и
  // налог перестал считаться не из-за кода, а из-за того, что облагать стало
  // нечего. Проверка писала «не взялся» — ровно то же, что при настоящей
  // поломке. Строку пришлось восстанавливать вручную.
  //
  // Поэтому здесь нет ни одного DELETE по guild_territories: строка легитимна,
  // в ней прочность крепости, и она не принадлежит проверке.
  psql(`UPDATE guild_territories SET guild_id = NULL, captured_at = NULL WHERE territory_id = '${ТЕРРИТОРИЯ}'`);
  psql(`DELETE FROM guild_members WHERE guild_id IN (SELECT id FROM guilds WHERE name = 'Пробный налоговый дворик')`);
  psql(`DELETE FROM guilds WHERE name = 'Пробный налоговый дворик'`);
  psql(`UPDATE trade_caravans SET status = 'cancelled', completed_at = NOW() WHERE owner_id = '${me}' AND status = 'transit'`);
  psql(`DELETE FROM character_soldiers WHERE character_id = '${me}'`);
  if (уровеньБыл) {
    psql(`UPDATE characters SET guild_id = NULL, region = 'isfahan', level = ${уровеньБыл} WHERE id = '${me}'`);
  }
  лог('за собой убрал: гильдию, захват, караван, караул, уровень и регион вернул');
}

// Объявлено до уборки: уборка вызывается и на старте, и в конце, и должна знать
// прежний уровень обоих прогонов.
let уровеньБыл = 0;

// ── Уборка перед стартом: прошлый прогон мог остаться ──
убрать();

/**
 * Строка территории должна существовать ДО проверки.
 *
 * Если её нет, облагать нечего и проверка молча сообщила бы «не взялся» —
 * так же, как при настоящей поломке. Поэтому отсутствие строки останавливает
 * проверку, а не делает её бесполезной: молчаливый «не получилось» хуже отказа.
 */
if (Number(psql(`SELECT COUNT(*) FROM guild_territories WHERE territory_id = '${ТЕРРИТОРИЯ}'`)) !== 1) {
  лог(`СТРОКИ ТЕРРИТОРИИ НЕТ. Это не поломка налога: облагать нечего.`);
  лог(`Восстановить: INSERT INTO guild_territories (territory_id, defense_hp)`);
  лог(`  VALUES ('${ТЕРРИТОРИЯ}', 5000);   -- defense_hp из данных: defensePoints`);
  process.exit(2);
}
лог(`строка территории на месте: ${ТЕРРИТОРИЯ}`);

// ── Гильдия и захват Тебриза ──
psql(`INSERT INTO guilds (name, leader_id, gold) VALUES ('Пробный налоговый дворик', '${me}', 0)`);
const гильдия = psql(`SELECT id FROM guilds WHERE name = 'Пробный налоговый дворик'`);
// Персонаж намеренно НЕ состоит в гильдии-владельце. Первая версия проверки
// сделала его лидером этой гильдии — и налог не взялся, потому что своя
// гильдия своего каравана не облагается. Проверка была права, а тест врал:
// чтобы увидеть налог, сдавать груз должен чужой.
psql(`UPDATE characters SET guild_id = NULL WHERE id = '${me}'`);
// Контракт Тебриза требует 5 уровня, а тестовый персонаж первый. Поднимаем на
// время проверки и возвращаем обратно в уборке: иначе проверка налога
// отказывала бы не из-за налога, а из-за уровня, и сказала бы о налоге
// ровно то же самое, что и настоящая поломка.
уровеньБыл = Number(psql(`SELECT level FROM characters WHERE id = '${me}'`));
psql(`UPDATE characters SET region = 'tabriz', gold = 5000, level = 20 WHERE id = '${me}'`);
psql(`UPDATE guild_territories SET guild_id = '${гильдия}', captured_at = NOW() WHERE territory_id = '${ТЕРРИТОРИЯ}'`);
лог(`гильдия ${гильдия} держит «${ТЕРРИТОРИЯ}», налог 5%`);
лог(`персонаж ВНЕ гильдии, регион tabriz, золото 5000, уровень ${уровеньБыл} → 20 (вернётся)`);

// Кэш владельцев территорий живёт 30 секунд (TerritoryBonuses.СРОК_КЭША_МС),
// а база меняется в обход сервера. Без паузы сервер до конца проверки видел бы
// territories без владельца и решил бы, что налог брать некому.
лог('жду 35 секунд, пока сервер перечитает владельцев территорий');
await sleep(35000);

// ── Принять контракт из Тебриза ──
const контракты = await (await fetch(`${URL}/api/game/trade/contracts?characterId=${me}`, { headers: заголовки })).json();
const наш = контракты.contracts.find((c) => c.id === КОНТРАКТ);
if (!наш) { лог('контракта нет в каталоге'); убрать(); process.exit(1); }
лог(`контракт «${наш.nameRu}»: награда ${наш.rewardGold} зол`);

// Груза может не быть в сумке: контракт не примется без него, и проверка
// налога упала бы не из-за налога. Выдаём ровно на количество контракта.
const груз = наш.cargoItemId ?? наш.cargo_item_id ?? 'mat_silk';
const количество = наш.cargoQty ?? наш.cargo_quantity ?? 3;
psql(`DELETE FROM trade_caravans WHERE owner_id = '${me}'`);
// Ключ уникальности составной (character_id, item_id, enhancement, stack_index),
// поэтому ON CONFLICT по двум колонкам не прошёл бы. Проще удалить строку и
// положить заново, чем угадывать стек.
psql(`DELETE FROM character_items WHERE character_id = '${me}' AND item_id = '${груз}'`);
psql(`INSERT INTO character_items (character_id, item_id, quantity, enhancement, stack_index)
       VALUES ('${me}', '${груз}', ${количество}, 0, 0)`);
лог(`груз выдан: ${количество} × ${груз}`);
const приём = await (await fetch(`${URL}/api/game/trade/accept`, {
  method: 'POST', headers: заголовки, body: JSON.stringify({ characterId: me, contractId: КОНТРАКТ }),
})).json();
if (!приём.success) {
  лог('контракт не принят:', приём.error ?? приём.message);
  лог('(вероятно, не хватает груза в сумке — это ожидаемо и не ошибка налога)');
  убрать();
  process.exit(1);
}
лог('контракт принят, караван в пути');

// ── Прибытие: срок в таблице, отнесём начало в прошлое ──
psql(`UPDATE trade_caravans SET started_at = NOW() - (eta_minutes || ' minutes')::interval
       WHERE owner_id = '${me}' AND status = 'transit'`);

// ── Переехать в Исфахан и сдать ──
psql(`UPDATE characters SET region = 'isfahan', zone = 'isfahan_center' WHERE id = '${me}'`);

const золотоДо = Number(psql(`SELECT gold FROM characters WHERE id = '${me}'`));
const казнаДо = Number(psql(`SELECT gold FROM guilds WHERE id = '${гильдия}'`));
лог(`до сдачи: у игрока ${золотоДо}, у гильдии ${казнаДо}`);

const сдача = await (await fetch(`${URL}/api/game/trade/deliver`, {
  method: 'POST', headers: заголовки, body: JSON.stringify({ characterId: me }),
})).json();

const золотоПосле = Number(psql(`SELECT gold FROM characters WHERE id = '${me}'`));
const казнаПосле = Number(psql(`SELECT gold FROM guilds WHERE id = '${гильдия}'`));

лог('');
лог('--- ИТОГ ---');
лог(`ответ доставки: ${JSON.stringify(сдача).slice(0, 160)}`);
лог(`игрок:   ${золотоДо} → ${золотоПосле}   (+${золотоПосле - золотоДо})`);
лог(`гильдия: ${казнаДо} → ${казнаПосле}   (+${казнаПосле - казнаДо})`);

убрать();

лог('');
лог('--- ВЕРДИКТ ---');
const налог = казнаПосле - казнаДо;
const ожидаем = Math.floor(наш.rewardGold * 0.05);
лог(`  ${налог > 0 ? 'ДА' : 'НЕТ'}  гильдия получила налог (${налог}, ожидалось ${ожидаем})`);
лог(`  ${налог === ожидаем ? 'ДА' : 'НЕТ'}  налог ровно 5% от награды`);
лог(`  ${золотоПосле - золотоДо === наш.rewardGold - налог ? 'ДА' : 'НЕТ'}  игрок получил награду за вычетом налога`);
process.exit(налог === ожидаем && золотоПосле - золотоДо === наш.rewardGold - налог ? 0 : 1);