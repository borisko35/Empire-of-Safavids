// Смоук-тест новых систем: магазины, инвентарь, экипировка, заточка, крафт, аукцион-эскроу
// Запуск: node tools/smoke-test-inventory.mjs из каталога server/
import { createRequire } from 'node:module';
const require = createRequire(new URL('file:///' + process.cwd().replace(/\\/g, '/') + '/package.json'));
const { Client } = require('pg');

const BASE = 'http://127.0.0.1:3000';
const ts = Date.now().toString().slice(-8);
let failures = 0;

function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  [' + extra + ']' : ''}`);
  if (!cond) failures++;
}

async function api(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

let dbClient = null;
const DB = {
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_USER ?? 'safavid_user',
  password: process.env.DB_PASSWORD ?? 'safavid_pass',
  database: process.env.DB_NAME ?? 'empire_of_safavids',
};
async function psql(sql) {
  if (!dbClient) {
    dbClient = new Client(DB);
    await dbClient.connect();
  }
  const res = await dbClient.query(sql);
  return res.rows[0] ? Object.values(res.rows[0])[0]?.toString() ?? '' : '';
}

// 1. Регистрация и персонаж
const reg = await api('POST', '/api/auth/register', {
  username: `smoke_${ts}`, email: `smoke_${ts}@test.dev`,
  password: 'Passw0rd!234', confirmPassword: 'Passw0rd!234',
  agreeToTerms: true, agreeToPrivacy: true, birthYear: 1990,
});
check('register', reg.status === 200 || reg.status === 201, `status ${reg.status}`);
const token = reg.json.data?.token;
const charRes = await api('POST', '/api/characters', { name: `SmokeIron${ts}`, class: 'qizilbash' }, token);
check('create character', charRes.status === 201, `status ${charRes.status}`);
const cid = charRes.json.character.id;
console.log(`  character: ${cid}`);

// 2. Инвентарь пуст
let inv = (await api('GET', `/api/characters/${cid}/inventory`, null, token)).json.items ?? [];
check('inventory empty at start', inv.length === 0, JSON.stringify(inv));

// 3. Покупка в магазине (10 руды по 8g из 100g)
const buy = await api('POST', '/api/game/shops/shop_tabriz_general/buy',
  { characterId: cid, itemId: 'mat_iron_ore', quantity: 10 }, token);
check('shop buy 10x iron ore', buy.status === 201 && buy.json.goldSpent === 80, `gold ${buy.json.gold}`);
check('gold spent correctly', buy.json.gold === 20, `left ${buy.json.gold}`);
inv = (await api('GET', `/api/characters/${cid}/inventory`, null, token)).json.items;
check('ore in inventory', inv.find(i => i.itemId === 'mat_iron_ore')?.quantity === 10);

// 4. Валидация магазина
const badItem = await api('POST', '/api/game/shops/shop_tabriz_general/buy',
  { characterId: cid, itemId: 'mat_silk' }, token);
check('shop rejects foreign item', badItem.status === 400, badItem.json.error);
const badLvl = await api('POST', '/api/game/shops/shop_isfahan_bazaar/buy',
  { characterId: cid, itemId: 'wpn_qizilbash_saber' }, token);
check('shop enforces minLevel', badLvl.status === 400 && /level/i.test(badLvl.json.error), badLvl.json.error);

// 5. Крафт: 10 руды -> железный меч (30с); уровень ремесла считает сервер
const start = await api('POST', '/api/game/crafting/start',
  { characterId: cid, recipeId: 'recipe_iron_sword' }, token);
check('crafting started (mats seen in character_items)', start.status === 201, JSON.stringify(start.json).slice(0, 120));
await psql(`UPDATE characters SET gold = 5000 WHERE id = '${cid}'`); // бюджет для дальнейших шагов
console.log('  waiting 31s for craft job...');
await new Promise(r => setTimeout(r, 31000));
const done = await api('POST', `/api/game/crafting/${start.json.job.id}/complete`, {}, token);
check('crafting completed', done.status === 200 && done.json.success === true, JSON.stringify(done.json));
inv = (await api('GET', `/api/characters/${cid}/inventory`, null, token)).json.items;
const sword = inv.find(i => i.itemId === 'wpn_iron_sword');
check('sword crafted + ore consumed', sword?.quantity === 1 && !inv.find(i => i.itemId === 'mat_iron_ore'),
  JSON.stringify(inv.map(i => `${i.itemId}x${i.quantity}`)));

// 6. Экипировка
const eq = await api('POST', `/api/characters/${cid}/equipment/equip`, { itemId: 'wpn_iron_sword' }, token);
check('equip sword', eq.status === 200 && eq.json.items.some(i => i.slot === 'weapon'), JSON.stringify(eq.json.items));
check('equipment grants strength', eq.json.stats.strength === 5, `str ${eq.json.stats.strength}`);
inv = (await api('GET', `/api/characters/${cid}/inventory`, null, token)).json.items;
check('sword left the bag on equip', !inv.find(i => i.itemId === 'wpn_iron_sword'));

const un = await api('POST', `/api/characters/${cid}/equipment/unequip`, { slot: 'weapon' }, token);
check('unequip returns sword to bag', un.status === 200 && un.json.items.length === 0);
inv = (await api('GET', `/api/characters/${cid}/inventory`, null, token)).json.items;
check('sword back in inventory', inv.find(i => i.itemId === 'wpn_iron_sword')?.quantity === 1);

// 7. Заточка (+0 -> +1, шанс 100%); руда (2шт) нужна как материал
await psql(`UPDATE characters SET gold = 5000 WHERE id = '${cid}'`); // бюджет
await api('POST', '/api/game/shops/shop_tabriz_general/buy',
  { characterId: cid, itemId: 'mat_iron_ore', quantity: 2 }, token);
const enh = await api('POST', `/api/characters/${cid}/enhance`, { itemId: 'wpn_iron_sword' }, token);
check('enhance +1', enh.status === 200 && enh.json.result === 'success' && enh.json.newEnhancement === 1,
  JSON.stringify(enh.json));
inv = (await api('GET', `/api/characters/${cid}/inventory`, null, token)).json.items;
check('inventory shows +1 tier', inv.some(i => i.itemId === 'wpn_iron_sword' && i.enhancement === 1));

// Заточка расходника запрещена
const enhPotion = await api('POST', '/api/game/shops/shop_tabriz_general/buy',
  { characterId: cid, itemId: 'con_health_potion_s', quantity: 1 }, token);
check('buy potion', enhPotion.status === 201);
const enhBad = await api('POST', `/api/characters/${cid}/enhance`, { itemId: 'con_health_potion_s' }, token);
check('enhance rejects consumable', enhBad.status === 400 && /equipment/i.test(enhBad.json.error), enhBad.json.error);

// 8. Экипированный +1 меч: бонус с заточкой (5 * 1.05 = 5.25 -> 5)
const eq2 = await api('POST', `/api/characters/${cid}/equipment/equip`, { itemId: 'wpn_iron_sword' }, token);
check('re-equip takes enhanced copy', eq2.json.items.find(i => i.slot === 'weapon')?.enhancement === 1,
  `enh ${eq2.json.items.find(i => i.slot === 'weapon')?.enhancement}`);

// 9. Расходник: понизить hp и выпить зелье (200 HP)
await psql(`UPDATE characters SET hp = GREATEST(1, max_hp - 300) WHERE id = '${cid}'`);
const use = await api('POST', `/api/characters/${cid}/inventory/use`, { itemId: 'con_health_potion_s' }, token);
check('use potion restores hp', use.status === 200 && use.json.resources.hp > 1, `hp ${use.json.resources?.hp}`);
inv = (await api('GET', `/api/characters/${cid}/inventory`, null, token)).json.items;
check('potion consumed', !inv.find(i => i.itemId === 'con_health_potion_s'));

// 10. Аукцион: эскроу при выставлении и возврат при отмене
const ore2 = await api('POST', '/api/game/shops/shop_tabriz_general/buy',
  { characterId: cid, itemId: 'mat_iron_ore', quantity: 5 }, token);
check('buy ore for auction test', ore2.status === 201);
const list = await api('POST', '/api/game/auction/list',
  { characterId: cid, itemId: 'mat_iron_ore', quantity: 3, enhancement: 0, price: 10 }, token);
check('create listing', list.status === 201, JSON.stringify(list.json).slice(0, 100));
inv = (await api('GET', `/api/characters/${cid}/inventory`, null, token)).json.items;
check('escrow: ore removed from bag', inv.find(i => i.itemId === 'mat_iron_ore')?.quantity === 2,
  `left ${inv.find(i => i.itemId === 'mat_iron_ore')?.quantity}`);
const noOwn = await api('POST', '/api/game/auction/list',
  { characterId: cid, itemId: 'wpn_shah_blade', quantity: 1, enhancement: 0, price: 10 }, token);
check('cannot list items you do not own', noOwn.status === 400, noOwn.json.error);
const cancel = await api('DELETE', `/api/game/auction/${list.json.listing.id}`, { characterId: cid }, token);
check('cancel listing', cancel.status === 200);
inv = (await api('GET', `/api/characters/${cid}/inventory`, null, token)).json.items;
check('escrow returned on cancel', inv.find(i => i.itemId === 'mat_iron_ore')?.quantity === 5,
  `back to ${inv.find(i => i.itemId === 'mat_iron_ore')?.quantity}`);

// 11. Покупка на аукционе вторым персонажем того же юзера: лот + покупатель получает предмет
const char2 = await api('POST', '/api/characters', { name: `SmokeBuy${ts}`, class: 'sufi_mystic' }, token);
const cid2 = char2.json.character.id;
await psql(`UPDATE characters SET gold = 1000 WHERE id = '${cid2}'`);
const list2 = await api('POST', '/api/game/auction/list',
  { characterId: cid, itemId: 'mat_iron_ore', quantity: 2, enhancement: 0, price: 50 }, token);
const buy2 = await api('POST', `/api/game/auction/${list2.json.listing.id}/buy`, { characterId: cid2 }, token);
check('auction purchase', buy2.status === 200 && buy2.json.success === true, JSON.stringify(buy2.json));
const inv2 = (await api('GET', `/api/characters/${cid2}/inventory`, null, token)).json.items;
check('buyer received item', inv2.find(i => i.itemId === 'mat_iron_ore')?.quantity === 2);
const gold1 = Number(await psql(`SELECT gold FROM characters WHERE id = '${cid}'`));
// 5000 (бюджет) − 16 (2 руды до заточки) − 100 (заточка) − 15 (зелье) − 40 (руда) + 47 (продажа, 95%)
check('seller paid (95%)', gold1 === 5000 - 16 - 100 - 15 - 40 + Math.floor(50 * 0.95), `gold ${gold1}`);

// ── Фаза 1: данжи ──────────────────────────────────────────────
await psql(`UPDATE characters SET level = 10 WHERE id = '${cid}'`);
const dgEnter = await api('POST', '/api/game/dungeons/dungeon_tabriz_catacombs/enter', { characterId: cid }, token);
check('dungeon enter', dgEnter.status === 201 && dgEnter.json.session.monsterCount > 0, JSON.stringify(dgEnter.json).slice(0, 140));
const dgStatus = await api('POST', '/api/game/dungeons/status', { characterId: cid }, token);
check('dungeon status active', dgStatus.json.active === true);
const dgLeave = await api('POST', '/api/game/dungeons/leave', { characterId: cid }, token);
check('dungeon leave', dgLeave.json.success === true);
const dgStatus2 = await api('POST', '/api/game/dungeons/status', { characterId: cid }, token);
check('dungeon status inactive after leave', dgStatus2.json.active === false);

// ── Фаза 1: скупка лута магазином ─────────────────────────────
await api('POST', '/api/game/shops/shop_tabriz_general/buy', { characterId: cid, itemId: 'con_health_potion_s', quantity: 2 }, token);
const sell = await api('POST', '/api/game/shops/shop_tabriz_general/sell', { characterId: cid, itemId: 'con_health_potion_s', quantity: 2 }, token);
check('shop buys loot at 45%', sell.status === 200 && sell.json.goldGained === Math.floor(10 * 0.45) * 2, JSON.stringify(sell.json));

// ── Фаза 1: торговые контракты ────────────────────────────────
const contracts = await api('GET', '/api/game/trade/contracts', null, token);
check('trade contracts listed', contracts.json.contracts.length >= 5);
await api('POST', '/api/game/shops/shop_isfahan_bazaar/buy', { characterId: cid, itemId: 'mat_silk', quantity: 3 }, token);
const accept = await api('POST', '/api/game/trade/accept', { characterId: cid, contractId: 'trade_tabriz_isfahan_silk' }, token);
check('trade accept removes cargo', accept.status === 201);
const invAfterAccept = (await api('GET', `/api/characters/${cid}/inventory`, null, token)).json.items;
check('silk consumed by contract', !invAfterAccept.find(i => i.itemId === 'mat_silk'));
const wrongRegion = await api('POST', '/api/game/trade/deliver', { characterId: cid }, token);
check('deliver rejected in wrong region', wrongRegion.status === 400 && wrongRegion.json.error === 'contract_not_delivered');
await psql(`UPDATE characters SET region = 'isfahan' WHERE id = '${cid}'`);
const deliver = await api('POST', '/api/game/trade/deliver', { characterId: cid }, token);
check('deliver rewards in target region', deliver.status === 200 && deliver.json.gold > 0, JSON.stringify(deliver.json));

// ── Игровые серверы (шарды) ────────────────────────────────────
const srvs = await api('GET', '/api/game/servers', null, token);
check('servers list has 8 shards', srvs.status === 200 && srvs.json.servers.length === 8,
  srvs.json.servers.map(x => x.nameRu).join(','));
check('server online counts numeric', srvs.json.servers.every(x => Number.isFinite(x.online)));
const badSrv = await api('POST', '/api/characters', { name: 'BadSrv' + ts, class: 'qizilbash', serverId: 'atlantis' }, token);
check('unknown server rejected', badSrv.status === 400);
const srvChar = await api('POST', '/api/characters', { name: 'BakuHero' + ts, class: 'persian_archer', serverId: 'baku' }, token);
check('character created on chosen server', srvChar.status === 201 && srvChar.json.character.serverId === 'baku',
  srvChar.json.character.serverId);
const listed = (await api('GET', '/api/characters', null, token)).json.characters;
check('old characters default to isfahan', listed.some(c => c.serverId === 'isfahan'));

console.log(failures === 0 ? '\nALL SMOKE TESTS PASSED' : `\n${failures} FAILURES`);
if (dbClient) await dbClient.end();
process.exit(failures === 0 ? 0 : 1);
