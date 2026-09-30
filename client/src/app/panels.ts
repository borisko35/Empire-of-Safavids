// ============================================================
// Панели: данжи, магазин, крафт, аукцион, группа, караваны
// ============================================================
// Рендеры следуют стилю loadInventory (hud.ts): строки-карточки с
// кнопками-действиями; ошибки — тосты. Данные серверные, оптимизм
// не используется: после действия — перезагрузка панели.

import { api, EquipmentState } from './api';
import { t } from './i18n';
import { session, Character } from './state';
import { toast, refreshBars, loadInventory, renderUnreadBadge, setDailyTasksOpen } from './hud';
import { onTutorialAction } from './tutorial';
import { onSearching as onPvpSearching, onPvpHide } from './pvp';
import { loadMediaPanel } from './media';
// Панель гильдии вынесена в отдельный файл: в panels.ts она занимала сорок
// строк, умела три вещи из десяти и не позволяла вступить в чужую гильдию
import { loadGuild } from './guild';
import { RARITY_COLORS } from '../ui/icons';
import { getStance, STANCES, STANCE_ORDER } from './stance';

// Простой словарь имен предметов для магазина (itemId -> ключ перевода)
const SHOP_ITEM_NAMES: Record<string, string> = {
  'con_health_potion_s': 'items.con_health_potion_s',
  'con_stamina_food': 'items.con_stamina_food',
  'mat_iron_ore': 'items.mat_iron_ore',
  'wpn_iron_sword': 'items.wpn_iron_sword',
  'arm_leather_vest': 'items.arm_leather_vest',
  'con_health_potion_m': 'items.con_health_potion_m',
  'con_mana_potion': 'items.con_mana_potion',
  'mat_silk': 'items.mat_silk',
  'mat_saffron': 'items.mat_saffron',
  'con_exp_scroll': 'items.con_exp_scroll',
  'wpn_qizilbash_saber': 'items.wpn_qizilbash_saber',
  'arm_silk_robe': 'items.arm_silk_robe',
  'mat_turquoise': 'items.mat_turquoise',
  'mat_dragon_scale': 'items.mat_dragon_scale',
  'acc_silk_road_amulet': 'items.acc_silk_road_amulet',
  'mount_arabian_horse': 'items.mount_arabian_horse',
  'mount_bactrian_camel': 'items.mount_bactrian_camel',
  'mount_qizilbash_warhorse': 'items.mount_qizilbash_warhorse',
  'acc_boots_silk': 'items.acc_boots_silk_road',
  'acc_boots_seafarer': 'items.acc_boots_seafarer',
  'acc_cloim_rain': 'items.acc_cloak_monsoon',
};

function itemName(itemId: string): string {
  return t(SHOP_ITEM_NAMES[itemId] ?? itemId);
}

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

function cid(): string {
  return session.character?.id ?? '';
}

function actionButton(label: string, onClick: () => Promise<void>, cls = 'inv-action'): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = label;
  b.addEventListener('click', async () => {
    try {
      await onClick();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  });
  return b;
}

function rowEl(cls = 'inv-item'): HTMLDivElement {
  const row = document.createElement('div');
  row.className = cls;
  return row;
}

function emptyBox(box: HTMLElement): void {
  box.innerHTML = `<div class="inv-empty">—</div>`;
}

// ── Данжи ────────────────────────────────────────────────────

export async function loadDungeons(): Promise<void> {
  if (!session.character) return;
  try {
    const [{ dungeons }, status] = await Promise.all([
      api.dungeons(),
      api.dungeonStatus(cid()),
    ]);
    const box = $('dungeons-list');
    if (!box) return;
    box.innerHTML = '';

    // Попытки на сегодня. Кнопка «Войти» без этого сообщения в конце дня
    // просто перестаёт работать, и игрок думает, что игра сломалась.
    // Сообщаем один раз на всю панель: счётчик общий на персонажа, и
    // приписывать его к каждому данжу было бы враньём — они считаются
    // раздельно, и одна цифра означала бы разное для разных данжей
    const attempts = (status as { attempts?: Record<string, number> }).attempts;
    if (attempts && Object.values(attempts).every(n => n <= 0)) {
      const warn = document.createElement('div');
      warn.className = 'dungeon-attempts-over';
      warn.textContent = t('dungeon.attempts_over');
      box.append(warn);
    }

    if (status.active) {
      const st = rowEl('inv-item dungeon-status');
      const name = document.createElement('span');
      name.className = 'inv-name';
      name.textContent = `${status.dungeonNameRu} (${t('panels.bosses')}: ${status.killedBossCount}/${status.bossCount})`;
      st.append(name);
      st.append(actionButton(t('panels.leave'), async () => {
        await api.dungeonLeave(cid());
        toast(t('panels.dungeon_left'), 'info');
        await loadDungeons();
      }));
      box.append(st);
    }

    if (!dungeons.length) {
      emptyBox(box);
      return;
    }
    for (const d of dungeons) {
      const row = rowEl('inv-item');
      const label = document.createElement('span');
      label.className = 'inv-name';
      label.textContent = `${d.nameRu} · ${t('badges.level')} ${d.minLevel}–${d.maxLevel}`;
      row.append(label);
      if (!status.active) {
        row.append(actionButton(t('panels.enter'), async () => {
          const res = await api.dungeonEnter(d.id, cid());
          toast(`${res.session.dungeonNameRu}: ${t('panels.dungeon_started')}`, 'success');
          await loadDungeons();
        }));
      }
      box.append(row);
    }
  } catch {
    /* панель недоступна */
  }
}

// ── Магазин ──────────────────────────────────────────────────

async function renderShopWallet(box: HTMLElement): Promise<void> {
  try {
    const [wallet, ratesInfo] = await Promise.all([
      api.wallet(cid()),
      api.paymentRates().catch(() => null),
    ]);
    const packs = ratesInfo?.packs ?? [];
    const firstBonus = ratesInfo?.firstBonus;
    const simulatorOn = ratesInfo?.simulator === true;
    if (session.character) {
      session.character.gold = wallet.gold;
      session.character.azens = wallet.azens;
      session.character.isfahanSilver = wallet.isfahanSilver;
      session.character.syrianGold = wallet.syrianGold;
      refreshBars();
    }
    const w = rowEl('inv-item dungeon-status');
    const wLabel = document.createElement('span');
    wLabel.className = 'inv-name';
    wLabel.textContent = t('wallet.balance_row').replace('{azens}', String(wallet.azens)).replace('{gold}', String(wallet.gold)).replace('{silver}', String(wallet.isfahanSilver)).replace('{syrian}', String(wallet.syrianGold));
    w.append(wLabel);
    box.append(w);
    if (!wallet.hasToppedUp) {
      const fb = rowEl('inv-item dungeon-status');
      const fbLabel = document.createElement('span');
      fbLabel.className = 'inv-name';
      fbLabel.textContent = t('wallet.first_purchase_bonus').replace('{mult}', String(firstBonus?.multiplier ?? 2)).replace('{max}', String(firstBonus?.maxBonus ?? 0));
      fb.append(fbLabel);
      box.append(fb);
    }

    const statusRow = rowEl('inv-item dungeon-status');
    const statusLabel = document.createElement('span');
    statusLabel.className = 'inv-name';
    statusLabel.textContent = t('wallet.pay_not_created');
    statusRow.append(statusLabel);
    box.append(statusRow);

    /**
 * Что делать с только что созданным платежом.
 *
 * Три честных исхода, и каждый показывается по-разному:
 * 1. Есть адрес оплаты — уводим игрока на страницу провайдера. Только там он
 *    вводит карту.
 * 2. Счёт не создан, потому что приём платежей не настроен — говорим прямо.
 *    Молчаливое «платёж создан» здесь означало бы, что игрок заплатил и ничего
 *    не получил, а узнал бы об этом через неделю.
 * 3. Счёт создан, но адреса нет — счёт где-то есть, а найти его нечем; ждём
 *    уведомление от провайдера и опрашиваем статус.
 */
function goToCheckout(created: {
  paymentId: string; azensExpected: number; checkoutUrl: string | null; providerError: string | null;
}): void {
  if (created.providerError === 'provider_not_configured') {
    statusLabel.textContent = t('wallet.pay_provider_not_ready');
    toast(t('wallet.pay_provider_not_ready'), 'error');
    return;
  }
  if (created.checkoutUrl) {
    // Ссылка ведёт на чужой домен, и это ожидаемо: там ввод карты.
    // Открываем в текущей вкладке, чтобы возврат на сайт был прямым и
    // paymentId в адресе дожил до проверки после оплаты.
    window.location.href = created.checkoutUrl;
    return;
  }
  if (created.providerError) {
    statusLabel.textContent = t('wallet.pay_provider_failed');
    toast(t('wallet.pay_provider_failed'), 'error');
    return;
  }
  void pollPayment(created.paymentId, created.azensExpected);
}

async function pollPayment(paymentId: string, expected: number): Promise<void> {
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 3000));
        let st: Awaited<ReturnType<typeof api.paymentStatus>>;
        try {
          st = await api.paymentStatus(paymentId);
        } catch { continue; }
        if (st.status === 'completed') {
          try {
            const wallet = await api.wallet(cid());
            if (session.character) {
              session.character.gold = wallet.gold;
              session.character.azens = wallet.azens;
            }
          } catch { /* баланс обновится позже */ }
          refreshBars();
          const bonusTxt = st.bonus > 0 ? t('wallet.bonus_suffix').replace('{n}', String(st.bonus)) : '';
          statusLabel.textContent = t('wallet.pay_confirmed') + bonusTxt;
          toast(`+${expected} AZENS${bonusTxt}`, 'success');
          await loadShop();
          return;
        }
        if (st.status === 'failed') {
          statusLabel.textContent = t('wallet.pay_rejected_provider');
          toast(t('wallet.pay_rejected'), 'error');
          return;
        }
      }
      statusLabel.textContent = t('wallet.pay_timeout');
    }

    const top = rowEl('inv-item');
    const cur = document.createElement('select');
    cur.className = 'inv-action';
    try {
      const rates = ratesInfo?.rates ?? {};
      for (const [code, r] of Object.entries(rates)) {
        const o = document.createElement('option');
        o.value = code;
        o.textContent = `${code.toUpperCase()}: ${r.realAmount} = ${r.azensAmount} AZENS`;
        cur.append(o);
      }
    } catch { /* курсы недоступны */ }
    const amt = document.createElement('input');
    amt.type = 'number';
    amt.min = '1';
    amt.placeholder = t('common.amount');
    amt.style.width = '80px';
    top.append(cur, amt);
    // ── Награда за переход по рекламной ссылке ──────────────────
    //
    // Кнопка делает две вещи: открывает ссылку партнёра с идентификатором
    // ИГРОКА (не заглушкой) и забирает награду. Порядок именно такой:
    // сначала ссылка, потом кнопка забирает, - потому что выдача происходит
    // по нажатию, а не по факту перехода.
    //
    // ЧЕСТНОЕ ОГРАНИЧЕНИЕ, ОНО НЕ СПРЯТАНО. Игрок может нажать «забрать»,
    // не уходя по ссылке, и золото всё равно получит: подтверждения от
    // партнёрской сети нет. Защита одна - награда выдаётся один раз на
    // персонажа, и проверяет это база.
    const rewardRow = document.createElement('div');
    rewardRow.className = 'topup-row';
    const rewardBtn = actionButton(t('wallet.reward_btn').replace('{gold}', '100'), async () => {
      rewardBtn.disabled = true;
      try {
        const info = await api.rewardLink(cid());
        if (!info.alreadyClaimed) window.open(info.url, '_blank', 'noopener');
        const got = await api.claimReward(cid());
        if (got?.success) {
          toast(`+${info.gold} ${t('common.gold')}`, 'success');
          if (session.character && typeof got.gold === 'number') session.character.gold = got.gold;
          refreshBars();
        }
      } catch {
        // 409 already_claimed - это «уже получено», а не поломка. Показать
        // игроку ошибку здесь означало бы наказать его за честное
        // повторное нажатие.
        toast(t('wallet.reward_already'), 'info');
      } finally {
        rewardBtn.disabled = false;
        loadRewards();
      }
    });
    rewardRow.append(rewardBtn);
    const rewardsHost = document.createElement('div');
    rewardsHost.append(rewardRow);
    top.append(rewardsHost);

    /** Погасить кнопку, если награда уже получена. */
    async function loadRewards(): Promise<void> {
      try {
        const info = await api.rewardLink(cid());
        rewardBtn.disabled = info.alreadyClaimed;
        rewardBtn.textContent = info.alreadyClaimed
          ? t('wallet.reward_done')
          : t('wallet.reward_btn').replace('{gold}', String(info.gold));
      } catch { /* панель работает и без награды */ }
    }
    void loadRewards();

    top.append(actionButton(t('wallet.topup_btn'), async () => {
      const sum = Number(amt.value);
      if (!sum || sum <= 0) { toast(t('wallet.enter_amount'), 'error'); return; }
      const created = await api.paymentTopup(cid(), { realCurrency: cur.value, amount: sum });
      statusLabel.textContent = t('wallet.payment_pending').replace('{id}', created.paymentId.slice(0, 8)).replace('{azens}', String(created.azensExpected));
      if (simulatorOn) {
        statusRow.append(actionButton(t('wallet.simulate'), async () => {
          const done = await api.paymentSimulate(cid(), created.paymentId);
          if (session.character && typeof done.azens === 'number') session.character.azens = done.azens;
          refreshBars();
          statusLabel.textContent = t('wallet.pay_confirmed_sim');
          toast(`+${created.azensExpected} AZENS`, 'success');
          await loadShop();
        }));
      }
      toast(t('wallet.pay_created'), 'info');
      goToCheckout(created);
    }));
    box.append(top);

    // Пакеты AZENS с бонусом за объём
    for (const pack of packs) {
      const row = rowEl('inv-item');
      const label = document.createElement('span');
      label.className = 'inv-name';
      label.textContent = `${pack.realAmount} ${pack.realCurrency.toUpperCase()} → ${pack.azens} AZENS${pack.bonusPct ? ` (+${pack.bonusPct}%)` : ''}${pack.tagRu ? ` [${pack.tagRu}]` : ''}`;
      row.append(label);
      row.append(actionButton(t('panels.buy'), async () => {
        const created = await api.paymentTopup(cid(), { packId: pack.id });
        statusLabel.textContent = t('wallet.pack_pending').replace('{id}', String(pack.id)).replace('{azens}', String(created.azensExpected));
        if (simulatorOn) {
          statusRow.append(actionButton(t('wallet.simulate'), async () => {
            const done = await api.paymentSimulate(cid(), created.paymentId);
            if (session.character && typeof done.azens === 'number') session.character.azens = done.azens;
            refreshBars();
            const b = typeof done.bonus === 'number' && done.bonus > 0 ? t('wallet.bonus_suffix').replace('{n}', String(done.bonus)) : '';
            statusLabel.textContent = t('wallet.pay_confirmed_sim_bonus').replace('{bonus}', b);
            toast(`+${created.azensExpected} AZENS${b}`, 'success');
            await loadShop();
          }));
        }
        toast(t('wallet.pay_created'), 'info');
        goToCheckout(created);
      }));
      box.append(row);
    }

    // Премиум-аккаунт за AZENS
    try {
      const prem = await api.premiumStatus(cid());
      const ph = document.createElement('div');
      ph.className = 'panel-subhead';
      ph.textContent = prem.active ? t('wallet.premium_active') : t('wallet.premium_title');
      box.append(ph);
      if (!prem.active) {
        for (const d of prem.durations) {
          const row = rowEl('inv-item');
          const label = document.createElement('span');
          label.className = 'inv-name';
          label.textContent = t('wallet.premium_days').replace('{days}', String(d.days)).replace('{azens}', String(d.priceAzens));
          row.append(label);
          row.append(actionButton(t('panels.buy'), async () => {
            const res = await api.premiumPurchase(cid(), d.days);
            if (session.character) session.character.azens = res.azens;
            refreshBars();
            toast(t('wallet.premium_activated'), 'success');
            await loadShop();
          }));
          box.append(row);
        }
      }
    } catch { /* премиум недоступен */ }

    // Промокод
    const promoRow = rowEl('inv-item');
    const promoInput = document.createElement('input');
    promoInput.placeholder = t('wallet.promo_title');
    promoInput.style.width = '140px';
    promoRow.append(promoInput);
    promoRow.append(actionButton(t('wallet.promo_activate'), async () => {
      const code = promoInput.value.trim();
      if (!code) { toast(t('wallet.promo_enter'), 'error'); return; }
      const res = await api.promoRedeem(cid(), code);
      if (session.character) {
        session.character.azens = res.wallet.azens;
        session.character.isfahanSilver = res.wallet.isfahanSilver;
        session.character.syrianGold = res.wallet.syrianGold;
      }
      refreshBars();
      const parts: string[] = [];
      if (res.reward.azens) parts.push(`${res.reward.azens} AZENS`);
      if (res.reward.silver) parts.push(t('wallet.reward_silver').replace('{n}', String(res.reward.silver)));
      if (res.reward.syrian) parts.push(t('wallet.reward_syrian').replace('{n}', String(res.reward.syrian)));
      toast(t('wallet.promo_reward').replace('{parts}', parts.join(', ')), 'success');
      await loadShop();
    }));
    box.append(promoRow);

    // Обменник свободных валют
    try {
      const { pairs } = await api.exchangePairs();
      if (pairs.length) {
        const exHead = document.createElement('div');
        exHead.className = 'panel-subhead';
        exHead.textContent = t('wallet.exchange_title');
        box.append(exHead);
        const exRow = rowEl('inv-item');
        const pairSel = document.createElement('select');
        pairSel.className = 'inv-action';
        for (const p of pairs) {
          const o = document.createElement('option');
          o.value = p.id;
          o.textContent = `${p.give} ${p.from} → ${p.receive} ${p.to}`;
          pairSel.append(o);
        }
        const timesInput = document.createElement('input');
        timesInput.type = 'number';
        timesInput.min = '1';
        timesInput.max = '100';
        timesInput.value = '1';
        timesInput.style.width = '60px';
        exRow.append(pairSel, timesInput);
        exRow.append(actionButton(t('wallet.exchange_btn'), async () => {
          const times = Math.max(1, Math.min(100, Number(timesInput.value) || 1));
          const res = await api.exchange(cid(), pairSel.value, times);
          if (session.character) {
            session.character.gold = res.wallet.gold;
            session.character.isfahanSilver = res.wallet.silver;
            session.character.syrianGold = res.wallet.syrian;
          }
          refreshBars();
          toast(t('wallet.exchange_done'), 'success');
          await loadShop();
        }));
        box.append(exRow);
      }
    } catch { /* обменник недоступен */ }

    const consent = document.createElement('div');
    consent.className = 'dungeon-status';
    consent.textContent = t('wallet.consent');
    box.append(consent);
  } catch { /* кошелёк недоступен */ }
}

async function loadPaymentHistory(box: HTMLElement): Promise<void> {
  let history: Awaited<ReturnType<typeof api.paymentHistory>>;
  try {
    history = await api.paymentHistory(cid());
  } catch { return; }
  if (!history.payments.length) return;
  const head = document.createElement('div');
  head.className = 'panel-subhead';
  head.textContent = t('wallet.my_purchases');
  box.append(head);
  for (const p of history.payments.slice(0, 10)) {
    const row = rowEl('inv-item');
    const label = document.createElement('span');
    label.className = 'inv-name';
    const what = p.packId ? t('wallet.pack_word').replace('{id}', String(p.packId)) : `${p.realAmount} ${p.realCurrency.toUpperCase()}`;
    label.textContent = `${what} → ${p.azensExpected} AZENS — ${p.status}`;
    row.append(label);
    box.append(row);
  }
}

async function loadBattlepass(box: HTMLElement): Promise<void> {
  let status: Awaited<ReturnType<typeof api.battlepassStatus>>;
  try {
    status = await api.battlepassStatus(cid());
  } catch { return; }
  const head = document.createElement('div');
  head.className = 'panel-subhead';
  head.textContent = t('wallet.battlepass_season').replace('{name}', status.season.nameRu);
  box.append(head);
  const claimed: number[] = Array.isArray(status.progress?.claimed_tiers)
    ? (status.progress.claimed_tiers as number[])
    : [];
  const pts = status.progress?.points ?? 0;
  if (!status.progress?.is_premium) {
    const row = rowEl('inv-item');
    const label = document.createElement('span');
    label.className = 'inv-name';
    label.textContent = t('wallet.premium_price').replace('{n}', String(status.season.premiumPrice));
    row.append(label);
    row.append(actionButton(t('panels.buy'), async () => {
      const res = await api.battlepassPurchase(cid());
      if (session.character) session.character.azens = res.azens;
      refreshBars();
      toast(t('wallet.battlepass_premium_on'), 'success');
      await loadShop();
    }));
    box.append(row);
  }
  for (const tier of status.tiers) {
    const unlocked = pts >= tier.requiredPoints;
    const got = claimed.includes(tier.tier);
    const row = rowEl('inv-item');
    const label = document.createElement('span');
    label.className = 'inv-name';
    label.textContent = t('wallet.battlepass_tier').replace('{tier}', String(tier.tier)).replace('{free}', tier.freeReward.nameRu).replace('{premium}', tier.premiumReward.nameRu);
    row.append(label);
    if (unlocked && !got) {
      row.append(actionButton(t('panels.collect'), async () => {
        await api.battlepassClaim(cid(), tier.tier, false);
        toast(t('mail.claimed'), 'success');
        await loadShop();
      }));
      if (status.progress?.is_premium) {
        row.append(actionButton(t('wallet.premium'), async () => {
          await api.battlepassClaim(cid(), tier.tier, true);
          toast(t('wallet.premium_reward_claimed'), 'success');
          await loadShop();
        }));
      }
    }
    box.append(row);
  }
}

export async function loadShop(): Promise<void> {
  if (!session.character) return;
  try {
    const { shops } = await api.shops();
    const box = $('shop-list');
    if (!box) return;
    box.innerHTML = '';
    await renderShopWallet(box);
    for (const shop of shops) {
      const head = document.createElement('div');
      head.className = 'panel-subhead';
      head.textContent = shop.nameRu;
      box.append(head);
      for (const item of shop.items) {
        const cur2 = (item.currency === 'premium' ? 'azens' : item.currency) as 'gold' | 'azens' | 'silver' | 'syrian';
        const row = rowEl('inv-item');
        const label = document.createElement('span');
        label.className = 'inv-name';
        label.textContent = item.nameRu ?? itemName(item.itemId);
        const price = document.createElement('span');
        price.className = 'inv-qty';
        price.textContent = cur2 === 'azens' ? `AZENS ${item.price}` : cur2 === 'silver' ? `SILVER ${item.price}` : cur2 === 'syrian' ? `SYRIAN ${item.price}` : `gold ${item.price}`;
        row.append(label, price);
        row.append(actionButton(t('panels.buy'), async () => {
          const res = await api.shopBuy(shop.id, cid(), item.itemId, cur2);
          if (session.character) {
            if (typeof res.gold === 'number') session.character.gold = res.gold;
            if (typeof res.azens === 'number') session.character.azens = res.azens;
            if (typeof res.silver === 'number') session.character.isfahanSilver = res.silver;
            if (typeof res.syrian === 'number') session.character.syrianGold = res.syrian;
          }
          refreshBars();
          // Шаг туториала «купи зелье»: засчитывается только нужный предмет
          onTutorialAction('buy_item', item.itemId);
          toast(t('panels.bought'), 'success');
          await loadShop();
        }));
        box.append(row);
      }
    }
    await loadBattlepass(box);
    await loadPaymentHistory(box);
    if (!box.children.length) emptyBox(box);
  } catch {
    /* панель недоступна */
  }
}

// ── Крафт ────────────────────────────────────────────────────

let craftJobId = localStorage.getItem('eos_craft_job') ?? '';
let craftCompletesAt = Number(localStorage.getItem('eos_craft_until') ?? 0);

export async function loadCraft(): Promise<void> {
  if (!session.character) return;
  try {
    const { recipes } = await api.craftingRecipes();
    // Уровень по профессиям. Шесть значений вместо одного общего числа:
    // игрок должен видеть, ЧЕГО ему не хватает. Раньше рецепт был «Закрыт»
    // без причины, и отличить «подними алхимию» от «подними кузнеца»
    // было невозможно
    // Откат: если маршрут не ответил, панель всё равно показывает рецепты,
    // просто без уровней профессий. Тип указываем явно — из catch выходит
    // {} без индекса, и TS не может доказать, что доступ даст число
    const craftLevels: Record<string, number> =
      (await api.craftingSkills(cid()).catch(() => ({ levels: {} as Record<string, number> }))).levels;
    const box = $('craft-list');
    if (!box) return;
    box.innerHTML = '';

    // Шесть профессий в порядке данных — тот же, что в панели,
    // чтобы игрок не искал, где что
    const ORDER = ['blacksmithing', 'tailoring', 'alchemy',
      'cooking', 'jewelcrafting', 'carpentry'];
    const skills = document.createElement('div');
    skills.className = 'craft-skills';
    for (const cat of ORDER) {
      const lvl = craftLevels[cat] ?? 1;
      const pill = document.createElement('span');
      pill.className = 'craft-skill';
      pill.textContent = `${t('craft.' + cat)} ${t('craft.lvl').replace('%d', String(lvl))}`;
      skills.append(pill);
    }
    box.append(skills);

    if (craftJobId) {
      const remain = Math.ceil((craftCompletesAt - Date.now()) / 1000);
      const st = rowEl('inv-item dungeon-status');
      const name = document.createElement('span');
      name.className = 'inv-name';
      name.textContent = remain > 0
        ? `${t('panels.crafting')} · ${remain} ${t('panels.seconds')}`
        : t('panels.craft_ready');
      st.append(name);
      if (remain <= 0) {
        st.append(actionButton(t('panels.collect'), async () => {
          const res = await api.craftingComplete(craftJobId, cid());
          craftJobId = '';
          localStorage.removeItem('eos_craft_job');
          localStorage.removeItem('eos_craft_until');
          toast(res.success ? t('panels.craft_done') : t('panels.craft_failed'), res.success ? 'success' : 'error');
          await loadCraft();
        }));
      }
      box.append(st);
    }

    for (const r of recipes) {
      const row = rowEl('inv-item');
      const label = document.createElement('span');
      label.className = 'inv-name';
      label.textContent = `${r.nameRu} → ${r.resultItemId} ×${r.resultQuantity}`;
      const meta = document.createElement('span');
      meta.className = 'inv-qty';
      meta.textContent = `${t('badges.level')} ${r.requiredLevel} · ${Math.round(r.successRate * 100)}%`;
      row.append(label, meta);
      if (!craftJobId) {
        row.append(actionButton(t('panels.craft_start'), async () => {
          const res = await api.craftingStart(cid(), r.id);
          craftJobId = res.job.id;
          craftCompletesAt = new Date(res.job.completesAt).getTime();
          localStorage.setItem('eos_craft_job', craftJobId);
          localStorage.setItem('eos_craft_until', String(craftCompletesAt));
          toast(t('panels.crafting'), 'info');
          await loadCraft();
        }));
      }
      box.append(row);
    }
    if (!box.children.length) emptyBox(box);
  } catch {
    /* панель недоступна */
  }
}

// ── Аукцион ──────────────────────────────────────────────────

export async function loadAuction(): Promise<void> {
  if (!session.character) return;
  try {
    const { listings } = await api.auctionSearch({ limit: 20 });
    const box = $('auction-list');
    if (!box) return;
    box.innerHTML = '';
    if (!listings.length) {
      const empty = document.createElement('div');
      empty.className = 'lb-empty';
      empty.textContent = t('auction.empty');
      box.append(empty);
    }
    for (const l of listings) {
      const row = rowEl('inv-item');
      const label = document.createElement('span');
      label.className = 'inv-name';
      label.textContent = `${l.itemId}${l.enhancement > 0 ? ` +${l.enhancement}` : ''} ×${l.quantity}`;
      const price = document.createElement('span');
      price.className = 'inv-qty';
      price.textContent = `◉ ${l.price}`;
      row.append(label, price);
      row.append(actionButton(t('panels.buy'), async () => {
        const res = await api.auctionBuy(l.id, cid());
        toast(res.message || t('panels.bought'), 'success');
        await loadAuction();
        await loadInventory();
      }));
      box.append(row);
    }

    // ── Мои лоты ────────────────────────────────────────────
    // Раздела не было: игрок не видел, что выставил, и не мог снять лот.
    // api.auctionCancel и AuctionService.getSellerListings были написаны и
    // не вызывались ни разу
    try {
      const { listings: mine } = await api.auctionMine(cid());
      const mineTitle = document.createElement('div');
      mineTitle.className = 'panel-subhead';
      mineTitle.textContent = t('auction.mine');
      box.append(mineTitle);
      if (!mine?.length) {
        const none = document.createElement('div');
        none.className = 'lb-empty';
        none.textContent = t('auction.mine_empty');
        box.append(none);
      }
      for (const l of mine) {
        const row = rowEl('inv-item');
        const name = document.createElement('span');
        name.className = 'inv-name';
        name.textContent = `${l.nameRu} ×${l.quantity}`;
        const price = document.createElement('span');
        price.className = 'inv-qty';
        // Срок горит жёлтым, когда лот уже просрочен: предмет вернётся сам,
        // но пока уборка не прошла, игрок может снять его кнопкой
        const left = new Date(l.expiresAt).getTime() - Date.now();
        const expired = !l.sold && left <= 0;
        price.textContent = l.sold
          ? t('auction.sold')
          : expired ? t('auction.expired') : `${t('auction.left')}: ${Math.max(1, Math.round(left / 3600000))} ${t('auction.hours')}`;
        if (expired) price.style.color = '#e8a84a';
        row.append(name, price);
        if (l.canCancel) {
          row.append(actionButton(t('auction.cancel'), async () => {
            try {
              const res = await api.auctionCancel(l.id, cid());
              toast(res.success ? t('auction.cancelled') : t('auction.cancel_failed'), res.success ? 'success' : 'error');
              await loadAuction();
              await loadInventory();
            } catch (err) { toast((err as Error).message, 'error'); }
          }));
        }
        box.append(row);
      }
    } catch (err) {
      const failRow = document.createElement('div');
      failRow.className = 'lb-empty';
      failRow.textContent = (err as Error).message;
      box.append(failRow);
    }

    // ── Форма размещения лота: предмет из сумки + цена ──
    try {
      const { items } = await api.inventory(cid());
      const formTitle = document.createElement('div');
      formTitle.className = 'panel-subhead';
      formTitle.textContent = t('auction.place');
      box.append(formTitle);
      if (!items.length) {
        const note = document.createElement('div');
        note.className = 'lb-empty';
        note.textContent = t('auction.bag_empty');
        box.append(note);
      } else {
        const form = document.createElement('div');
        form.className = 'auction-form';
        const itemSel = document.createElement('select');
        for (const it of items) {
          const opt = document.createElement('option');
          opt.value = it.itemId;
          opt.textContent = `${it.nameRu} ×${it.quantity}`;
          itemSel.append(opt);
        }
        const qtyInput = document.createElement('input');
        qtyInput.type = 'number'; qtyInput.min = '1'; qtyInput.value = '1';
        qtyInput.placeholder = t('auction.qty');
        const priceInput = document.createElement('input');
        priceInput.type = 'number'; priceInput.min = '1'; priceInput.value = '100';
        priceInput.placeholder = t('auction.price');
        const submitBtn = document.createElement('button');
        submitBtn.className = 'quest-accept';
        submitBtn.textContent = t('auction.list');
        submitBtn.addEventListener('click', async () => {
          try {
            await api.auctionList({
              characterId: cid(),
              itemId: itemSel.value,
              quantity: Math.max(1, Number(qtyInput.value) || 1),
              price: Math.max(1, Number(priceInput.value) || 1),
            });
            toast(t('auction.listed'), 'success');
            await loadAuction();
          } catch (err) { toast((err as Error).message, 'error'); }
        });
        form.append(itemSel, qtyInput, priceInput, submitBtn);
        box.append(form);
      }
    } catch { /* форма недоступна без инвентаря */ }
  } catch (err) {
    const box = $('auction-list');
    if (box) box.innerHTML = `<div class="lb-empty">${t('panels.load_error_msg').replace('{msg}', (err as Error).message)}</div>`;
  }
}

// ── Группа ───────────────────────────────────────────────────

function storedPartyId(): string {
  return localStorage.getItem('eos_party') ?? '';
}

export async function loadParty(): Promise<void> {
  if (!session.character) return;
  try {
    const box = $('party-list');
    if (!box) return;
    box.innerHTML = '';
    const partyId = storedPartyId();

    if (partyId) {
      const { party } = await api.partyInfo(partyId);
      if (!party) {
        localStorage.removeItem('eos_party');
      } else {
        const head = document.createElement('div');
        head.className = 'panel-subhead';
        head.textContent = `${t('panels.party')} (${party.members.length}/${party.maxSize})`;
            box.append(head);

        // ── Пригласить ──────────────────────────────────
            // Маршрут /parties/:partyId/invite был написан, клиентской
            // обёртки не было: партия всегда состояла из одного человека, и
            // пригласить было некем.
            //
            // Приглашение сразу добавляет игрока в группу — согласия у него не
            // спрашивается. Пока у партии нет последствий, это терпимо; когда
            // появится общий опыт, понадобится подтверждение.
        const isLeader = party.members.some(
          (m: { characterId: string; role: string }) => m.characterId === cid() && m.role === 'leader');
        if (isLeader && party.members.length < party.maxSize) {
          const inviteRow = rowEl('inv-item');
          const nameField = document.createElement('input');
          nameField.type = 'text';
          nameField.placeholder = t('party.invite_ph');
          nameField.style.cssText = 'background:#1a1410;color:#f5f0e8;border:1px solid #5a4a30;padding:4px 8px;border-radius:4px;flex:1;min-width:0';
          inviteRow.append(nameField);
          inviteRow.append(actionButton(t('party.invite'), async () => {
            const target = nameField.value.trim();
            if (!target) { toast(t('party.invite_empty'), 'error'); return; }
            try {
              await api.partyInvite(partyId, cid(), target);
              nameField.value = '';
              toast(t('party.invited'), 'success');
              await loadParty();
            } catch (err) { toast((err as Error).message, 'error'); }
          }));
          box.append(inviteRow);
            }
            for (const m of party.members) {
          const row = rowEl('inv-item');
          const label = document.createElement('span');
          label.className = 'inv-name';
          label.textContent = m.characterId === cid() ? session.character!.name : m.characterId.slice(0, 8);
          const role = document.createElement('span');
          role.className = 'inv-qty';
          role.textContent = m.role === 'leader' ? '★' : '·';
          row.append(label, role);
          box.append(row);
        }
        const leaveRow = rowEl('inv-item');
        leaveRow.append(actionButton(t('panels.party_leave'), async () => {
          await api.partyLeave(partyId, cid());
          localStorage.removeItem('eos_party');
          toast(t('panels.party_left'), 'info');
          await loadParty();
        }));
        box.append(leaveRow);
        return;
      }
    }

    const row = rowEl('inv-item');
    const label = document.createElement('span');
    label.className = 'inv-name';
    label.textContent = t('panels.party_none');
    row.append(label);
    row.append(actionButton(t('panels.party_create'), async () => {
      const res = await api.partyCreate(cid());
      localStorage.setItem('eos_party', res.party.id);
      toast(t('panels.party_created'), 'success');
      await loadParty();
    }));
    box.append(row);
  } catch {
    /* панель недоступна */
  }
}

// ── Караваны ─────────────────────────────────────────────────

// ── Предупреждение о водной опасности ─────────────────────────
/**
 * Подводные существа бьют только того, кто в воде. Без предупреждения
 * игрок выплывает на середину озера и получает урон из ниоткуда: на
 * берегу монстр не агрится вообще, и заметить «невидимого» врага
 * заранее нечем. Знак появляется, как только тварь рядом.
 *
 * Список существ не зашит: признак aquatic приходит с сервера при спавне.
 */

/** Подсказка про опасность показывается один раз за сессию */
let waterDangerHinted = false;

/**
 * Раз в секунду из игрового цикла. Показываем знак только когда игрок
 * действительно в воде: с берега и из лодки подводные существа не бьют,
 * так что тревожить там нечем.
 */
export function checkWaterDanger(opts: {
  swimming: boolean;
  inBoat: boolean;
  monsters: { aquatic?: boolean; pos: { x: number; z: number } }[];
}): void {
  const el = $('water-danger');
  if (!el) return;
  const p = session.selfPos;

  const dangerous = opts.swimming && !opts.inBoat && opts.monsters.some(m =>
    m.aquatic === true && Math.hypot(m.pos.x - p.x, m.pos.z - p.z) < 20
  );

  el.classList.toggle('hidden', !dangerous);
  if (dangerous) {
    el.textContent = t('world.water_danger');
    if (!waterDangerHinted) {
      waterDangerHinted = true;
      toast(t('world.water_danger_hint'), 'error');
    }
  }
}

/** Сброс при выходе в мир заново (новый вход) */
export function resetWaterDanger(): void {
  waterDangerHinted = false;
  $('water-danger')?.classList.add('hidden');
}

/** Таймер каравана: тикает, пока открыта панель «Караваны» */
let caravanTimer: number | null = null;
/**
 * Приход каравана уже запрошен у сервера. Без этого флага панель
 * перезагружала себя бесконечно: каждая перезагрузка создавала новую
 * строку, таймер снова видел «время пришло» и снова вызывал перезагрузку.
 */
let caravanArrivalAskedFor = '';

function fmtCaravanEta(msLeft: number): string {
  const total = Math.max(0, Math.ceil(msLeft / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s} ${t('panels.trade_sec')}`;
}

export async function loadTrade(): Promise<void> {
  if (!session.character) return;
  try {
    const { contracts, active, serverTime } = await api.tradeContracts(cid());
    const box = $('trade-list');
    if (!box) return;
    box.innerHTML = '';
    if (caravanTimer !== null) { clearInterval(caravanTimer); caravanTimer = null; }

    // ── Мой караван в пути: счётчик до прихода ──
    // Новый контракт (или его отсутствие) сбрасывает защиту от повторного
    // опроса сервера по поводу уже обработанного прихода
    if (caravanArrivalAskedFor && (!active || active.contractId !== caravanArrivalAskedFor)) {
      caravanArrivalAskedFor = '';
    }
    if (active) {
      const def = contracts.find(c => c.id === active.contractId);
      const row = rowEl('inv-item caravan-active');
      // Отдельные узлы под каждый кусок текста. Раньше здесь стояло
      // label.textContent = ... — присваивание стирало сам счётчик
      // и название контракта после первого же тика.
      const titleEl = document.createElement('span');
      const etaBox = document.createElement('b');
      etaBox.className = 'caravan-eta';
      const nameEl = document.createElement('span');
      const label = document.createElement('span');
      label.className = 'inv-name';
      label.append(titleEl, etaBox, nameEl);
      row.append(label);
      box.append(row);
      nameEl.textContent = def ? ` · ${def.nameRu}` : '';

      // Смещение часов игрока и сервера — иначе таймер врал бы на минуты
      const clockOffset = serverTime - Date.now();
      const paint = () => {
        // Панель закрыли — строка исчезла из DOM. Останавливаем таймер,
        // иначе он будет тикать раз в секунду до конца сессии впустую.
        if (!row.isConnected) {
          if (caravanTimer !== null) { clearInterval(caravanTimer); caravanTimer = null; }
          return;
        }
        const left = active.arrivesAt - (Date.now() + clockOffset);
        if (left > 0) {
          titleEl.textContent = `${t('panels.trade_caravan_title')}: `;
          etaBox.textContent = fmtCaravanEta(left);
          row.classList.remove('caravan-arrived');
        } else {
          // Время пришло: показываем «прибыл» и один раз просим сервер
          // вернуть груз. Повторно не спрашиваем — иначе панель замкнётся
          // на себя (каждый ответ снова показывает «пришло»).
          titleEl.textContent = `${t('panels.trade_caravan_arrived')} `;
          etaBox.textContent = '';
          row.classList.add('caravan-arrived');
          if (active.status === 'transit' && caravanArrivalAskedFor !== active.contractId) {
            caravanArrivalAskedFor = active.contractId;
            void loadTrade();
          }
        }
      };
      // Только после вставки в DOM: paint() проверяет row.isConnected
      paint();

      // Пока едет — груз в караване, сдавать нечего
      if (active.status === 'transit') {
        caravanTimer = window.setInterval(paint, 1000);
      }
    }

    // emptyBox чистит весь бокс, поэтому вызываем его только когда каравана
    // нет — иначе он стирал бы строку «караван в пути»
    if (!contracts.length && !active) {
      emptyBox(box);
      return;
    }
    for (const c of contracts) {
      // Пока караван в пути, новый контракт взять нельзя
      if (active) break;
      const row = rowEl('inv-item');
      const label = document.createElement('span');
      label.className = 'inv-name';
      label.textContent = `${c.nameRu} · ${c.cargoNameRu} ×${c.cargoQty} → ◉ ${c.rewardGold}`;
      row.append(label);
      if (c.rewardSilver) label.textContent += t('panels.reward_silver_add').replace('{n}', String(c.rewardSilver));
      if (c.rewardSyrian) label.textContent += t('panels.reward_syrian_add').replace('{n}', String(c.rewardSyrian));
      label.title = `${t('panels.trade_travel')}: ${c.travelMinutes} ${t('panels.trade_min')}`;
      row.append(actionButton(t('panels.trade_accept'), async () => {
        try {
          await api.tradeAccept(cid(), c.id);
          toast(t('panels.trade_accepted'), 'success');
        } catch (e) {
          const code = String((e as { code?: string })?.code ?? '');
          if (code.includes('no_items') || code.includes('not_enough')) toast(t('panels.trade_err_no_cargo'), 'error');
          else if (code.includes('level_low')) toast(t('panels.trade_err_level'), 'error');
          else if (code.includes('wrong_region')) toast(t('panels.trade_err_wrong_city'), 'error');
          else if (code.includes('unavailable')) toast(t('panels.trade_err_unavailable'), 'error');
          else toast(t('panels.trade_err_none'), 'error');
        }
        await loadTrade();
      }));
      box.append(row);
    }
    // Подсказка на отдельной строке: в общем ряду с кнопками она
    // сжималась в узкую колонку и переносилась на шесть строк
    const deliverRow = rowEl('inv-item dungeon-status trade-actions');
    const hint = document.createElement('div');
    hint.className = 'inv-name trade-hint';
    hint.textContent = active ? t('panels.trade_hint_active') : t('panels.trade_hint');
    deliverRow.append(hint);
    const btnRow = document.createElement('div');
    btnRow.className = 'trade-buttons';
    deliverRow.append(btnRow);
    btnRow.append(actionButton(t('panels.trade_deliver'), async () => {
      // Раньше ошибки молча проглатывались внешним catch — игрок нажимал
      // «Сдать» и не понимал, почему ничего не происходит
      try {
        const res = await api.tradeDeliver(cid());
        if (session.character) {
          session.character.gold += res.gold;
          session.character.isfahanSilver = (session.character.isfahanSilver ?? 0) + (res.silver ?? 0);
          session.character.syrianGold = (session.character.syrianGold ?? 0) + (res.syrian ?? 0);
        }
        refreshBars();
        toast(`${t('panels.trade_done')}: +◉ ${res.gold}`, 'success');
      } catch (e) {
        const code = String((e as { code?: string })?.code ?? (e as Error)?.message ?? '');
        if (code.includes('in_transit')) toast(t('panels.trade_err_in_transit'), 'error');
        else if (code.includes('not_delivered')) toast(t('panels.trade_err_wrong_city'), 'error');
        else toast(t('panels.trade_err_none'), 'error');
      }
      await loadTrade();
    }));
    btnRow.append(actionButton(t('panels.trade_cancel'), async () => {
      try {
        await api.tradeCancel(cid());
        toast(t('panels.trade_cancelled'), 'info');
      } catch {
        toast(t('panels.trade_err_none'), 'error');
      }
      await loadTrade();
    }));
    box.append(deliverRow);

    // Подарки другим игрокам
    const giftHead = document.createElement('div');
    giftHead.className = 'panel-subhead';
    giftHead.textContent = t('panels.gift_title');
    box.append(giftHead);
    try {
      const { items } = await api.inventory(cid());
      const giftRow = rowEl('inv-item');
      const targetInput = document.createElement('input');
      targetInput.placeholder = t('panels.gift_recipient');
      targetInput.style.width = '130px';
      const itemSel = document.createElement('select');
      itemSel.className = 'inv-action';
      for (const it of items) {
        const o = document.createElement('option');
        o.value = it.itemId;
        o.textContent = `${it.nameRu} x${it.quantity}`;
        itemSel.append(o);
      }
      const qtyInput = document.createElement('input');
      qtyInput.type = 'number';
      qtyInput.min = '1';
      qtyInput.value = '1';
      qtyInput.style.width = '50px';
      giftRow.append(targetInput, itemSel, qtyInput);
      giftRow.append(actionButton(t('panels.gift_send'), async () => {
        const target = targetInput.value.trim();
        if (!target) { toast(t('panels.gift_need_recipient'), 'error'); return; }
        await api.giftSend(cid(), target, itemSel.value, Math.max(1, Number(qtyInput.value) || 1));
        toast(t('panels.gift_sent'), 'success');
        await loadTrade();
      }));
      box.append(giftRow);
    } catch { /* инвентарь недоступен */ }
  } catch {
    /* панель недоступна */
  }
}

// ── Конюшня ──────────────────────────────────────────────

/** Скакун в том виде, в каком его отдаёт сервер: скорость уже посчитана */
interface MountView {
  mount_id: string; name_ru: string; rarity: string;
  level: number; speed: number; base_speed: number; max_speed: number;
  is_active: boolean; carry_bonus: number;
}

/**
 * Запомнить активного скакуна в сессии.
 *
 * Отсюда world.ts берёт скорость каждый кадр. Раньше скорость не хранилась
 * нигде: MountSystem.getMountSpeed был написан, но не вызывался, и купленный
 * конь не менял ровно ничего.
 */
function applyActiveMount(mounts: MountView[] | undefined): void {
  const active = (mounts ?? []).find(m => m.is_active);
  session.mount = active
    ? { id: active.mount_id, nameRu: active.name_ru, speed: active.speed, level: active.level }
    : null;
}

/**
 * Загрузить список скакунов и применить активного.
 *
 * Вызывается и при входе в игру, и при открытии конюшни: скорость должна
 * быть известна сразу, а не после первого захода в панель.
 */
export async function loadActiveMount(): Promise<void> {
  if (!session.character) return;
  try {
    const { mounts } = await api.mountsMy(cid());
    applyActiveMount(mounts as MountView[]);
  } catch { /* конюшня недоступна — едем пешком */ }
}

const RARITY_RU: Record<string, string> = {
  common: t('badges.rarity.common'), rare: t('badges.rarity.rare'), epic: t('badges.rarity.epic'), legendary: t('badges.rarity.legendary'), mythical: t('badges.rarity.mythic'),
};

export async function loadMounts(): Promise<void> {
  if (!session.character) return;
  const box = $('mount-stable-content');
  if (!box) return;
  box.innerHTML = '';

  try {
    const { mounts } = await api.mountsMy(cid());
    const owned = (mounts ?? []) as MountView[];
    applyActiveMount(owned);

    // ── Свои скакуны ──
    // Раньше этот раздел печатал только заголовок «Ваши скакуны (N)» и
    // больше ничего: сами строки рисовались только для товаров конюшни.
    // Конь из боевого пропуска в конюшне не продаётся — значит, надеть его
    // было нечем, а «Верхом» без скорости ничего не давал.
    const mine = document.createElement('div');
    mine.className = 'panel-subhead';
    mine.textContent = owned.length ? t('mounts.yours').replace('{n}', String(owned.length)) : t('mounts.none');
    box.append(mine);

    for (const m of owned) {
      const row = rowEl('inv-item');
      const name = document.createElement('span');
      name.className = 'inv-name';
      name.textContent = m.name_ru;
      const speed = document.createElement('span');
      speed.className = 'inv-qty';
      // Текущая скорость, а не диапазон: игроку важно, насколько быстро он
      // поедет сейчас, а не на каком он уровне
      speed.textContent = t('mounts.speed').replace('{n}', String(m.speed));
      row.append(name, speed);
      const info = document.createElement('span');
      info.style.cssText = 'color:#8a8; font-size:0.82em; width:100%';
      info.textContent =
        t('mounts.level_speed').replace('{lvl}', String(m.level)).replace('{min}', String(m.base_speed)).replace('{max}', String(m.max_speed)) +
        (m.carry_bonus ? t('mounts.carry').replace('{n}', String(m.carry_bonus)) : '') +
        (m.rarity in RARITY_RU ? ` · ${RARITY_RU[m.rarity]}` : '');
      row.append(info);
      const actBtn = actionButton(m.is_active ? t('mounts.riding_on') : t('mounts.riding'), async () => {
        await api.mountActivate(cid(), m.mount_id);
        await loadMounts();
        toast(m.is_active ? t('mounts.released').replace('{name}', m.name_ru) : t('mounts.summoning').replace('{name}', m.name_ru), 'success');
      });
      if (m.is_active) actBtn.style.opacity = '0.7';
      row.append(actBtn);
      box.append(row);
    }

    // ── Конюшня ──
    const { shops } = await api.shops();
    const stableShop = shops.find(s => s.id === 'shop_isfahan_stable');
    if (!stableShop) return;

    const title = document.createElement('div');
    title.className = 'panel-subhead';
    title.textContent = t('mounts.available');
    box.append(title);

    for (const item of stableShop.items) {
      const cur2 = item.currency as 'gold' | 'azens' | 'silver' | 'syrian';
      const row = rowEl('inv-item');
      const name = document.createElement('span');
      name.className = 'inv-name';
      name.textContent = itemName(item.itemId);
      const price = document.createElement('span');
      price.className = 'inv-qty';
      price.textContent = `${cur2 === 'azens' ? 'AZENS' : 'gold'} ${item.price}`;
      row.append(name, price);
      if (owned.some(m => m.mount_id === item.itemId)) {
        // Уже есть: покупать второй раз смысла нет, кнопка в списке сверху
        const has = document.createElement('span');
        has.style.cssText = 'color:#8a8; font-size:0.82em; width:100%';
        has.textContent = t('mounts.already');
        row.append(has);
        box.append(row);
        continue;
      }
      const buyBtn = actionButton(t('panels.buy'), async () => {
        const res = await api.mountsBuy('shop_isfahan_stable', cid(), item.itemId);
        if (res.success && session.character) {
          if (typeof res.gold === 'number') session.character.gold = res.gold;
          if (typeof res.azens === 'number') session.character.azens = res.azens;
          refreshBars();
          toast(t('mounts.bought').replace('{name}', name.textContent ?? ''), 'success');
          await loadMounts();
        } else if (res && 'error' in res) {
          toast(String(res.error), 'error');
        }
      });
      row.append(buyBtn);
      box.append(row);
    }
  } catch {
    /* недоступно */
  }
}


async function loadLeaderboard(): Promise<void> {
  const box = $('panel-leaderboard');
  if (!box) return;
  box.innerHTML = '';

  const types = [
    { id: 'level', label: t('panels.lb_level') },
    { id: 'pvp', label: 'PvP' },
    { id: 'kills', label: t('panels.lb_kills') },
    { id: 'quests', label: t('panels.lb_quests') },
  ];

  // Табы
  const tabsEl = document.createElement('div');
  tabsEl.className = 'lb-tabs';
  for (const tp of types) {
    const btn = document.createElement('button');
    btn.className = 'lb-tab' + (tp.id === 'level' ? ' active' : '');
    btn.textContent = tp.label;
    btn.addEventListener('click', async () => {
      tabsEl.querySelectorAll('.lb-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      await renderLeaderboard(box, tp.id);
    });
    tabsEl.append(btn);
  }
  box.append(tabsEl);

  // Контейнер для списка
  const listEl = document.createElement('div');
  listEl.id = 'lb-list';
  box.append(listEl);

  await renderLeaderboard(box, 'level');
}

async function renderLeaderboard(container: HTMLElement, type: string): Promise<void> {
  const listEl = container.querySelector('#lb-list') ?? container;
  listEl.innerHTML = '';
  try {
    const data = await api.leaderboard(type);
    const entries = data.entries ?? [];
    if (!entries.length) {
      listEl.innerHTML = `<div class="lb-empty">${t('panels.lb_empty')}</div>`;
      return;
    }
    // Ваша позиция
    try {
      const meData = await api.leaderboardMe(type, cid());
      if (meData.rank) {
        const myRow = document.createElement('div');
        myRow.className = 'lb-entry';
        myRow.style.cssText = 'background:rgba(201,168,76,0.1);border:1px solid rgba(201,168,76,0.3);';
        myRow.innerHTML = `<span class="lb-rank">👤 ${meData.rank.rank}</span>` +
          `<span class="lb-name">${session.character?.name ?? t('panels.you')}</span>` +
          `<span class="lb-value">${meData.rank.value}</span>`;
        listEl.append(myRow);
      }
    } catch {}
    for (const e of entries) {
      const row = document.createElement('div');
      row.className = 'lb-entry';
      const medal = e.rank === 1 ? '🥇' : e.rank === 2 ? '🥈' : e.rank === 3 ? '🥉' : '';
      row.innerHTML =
        `<span class="lb-rank">${medal} ${e.rank}</span>` +
        `<span class="lb-name">${e.characterName}</span>` +
        `<span class="lb-class">${t('badges.level')}${e.level}</span>` +
        (e.guild ? `<span class="lb-guild">[${e.guild}]</span>` : '') +
        `<span class="lb-value">${e.value.toLocaleString()}</span>`;
      listEl.append(row);
    }
  } catch {
    listEl.innerHTML = `<div class="lb-empty">${t('panels.load_error')}</div>`;
  }
}

// ── Приглашение друга ──────────────────────────────────────
//
// Панель стоит рядом с «Друзьями»: кто зовёт друзей, ищет их там.
// Главное здесь — кнопка копирования ссылки. Без неё ссылка есть,
// но игрок не сможет ею поделиться, и вся механика умирает.

async function loadReferral(): Promise<void> {
  const box = $('referral-content');
  if (!box) return;
  box.innerHTML = '';
  try {
    const info = await api.referralInfo();

    const desc = document.createElement('p');
    desc.className = 'ref-desc';
    desc.textContent = t('referral.desc');
    box.append(desc);

    // Ссылка крупным шрифтом: её нужно разглядеть, а потом скопировать
    const link = document.createElement('div');
    link.className = 'ref-link';
    link.textContent = info.link;
    box.append(link);

    // Копирование. navigator.clipboard требует https и может быть
    // недоступен на http — поэтому есть запасной путь через textarea
    const copyBtn = document.createElement('button');
    copyBtn.className = 'ref-copy';
    copyBtn.type = 'button';
    copyBtn.textContent = t('referral.copy');
    copyBtn.addEventListener('click', async () => {
      const ok = await copyText(info.link);
      copyBtn.textContent = ok ? t('referral.copied') : t('referral.copy_failed');
      setTimeout(() => { copyBtn.textContent = t('referral.copy'); }, 2500);
    });
    box.append(copyBtn);

    // Сколько пригласил и сколько заработал — без этого мотивации звать нет
    const stats = document.createElement('div');
    stats.className = 'ref-stats';
    stats.textContent = t('referral.stats')
      .replace('{n}', String(info.invited))
      .replace('{gold}', String(info.earnedGold));
    box.append(stats);

    const reward = document.createElement('p');
    reward.className = 'ref-reward';
    reward.textContent = t('referral.reward');
    box.append(reward);

    // ── Поделиться ────────────────────────────────────────────
    // Ссылка и кнопка копирования уже были, но игроку оставалось самому
    // придумывать текст, открывать соцсеть и вставлять адрес руками.
    //
    // Так почти никто и не делится: копировать голую ссылку без причины
    // не найдётся желающих. Теперь есть готовый текст и кнопки под каждую
    // площадку — остаётся нажать одну, и сообщение уходит со ссылкой, по
    // которой другу начислится награда.
    const shareText = t('referral.share_text').replace('{link}', info.link);
    const shareBlock = document.createElement('div');
    shareBlock.className = 'ref-share';
    const shareTitle = document.createElement('div');
    shareTitle.className = 'ref-share-title';
    shareTitle.textContent = t('referral.share_title');
    shareBlock.append(shareTitle);

    const buttons: { id: string; label: string; href: (u: string, s: string) => string }[] = [
      { id: 'vk',   label: 'VK',        href: (u, s) => `https://vk.com/share.php?url=${u}&title=${s}` },
      { id: 'tg',   label: 'Telegram',  href: (u, s) => `https://t.me/share/url?url=${u}&text=${s}` },
      { id: 'wa',   label: 'WhatsApp',  href: (u, s) => `https://wa.me/?text=${s}%20${u}` },
      { id: 'x',    label: 'X',         href: (u, s) => `https://twitter.com/intent/tweet?url=${u}&text=${s}` },
    ];
    const enc = encodeURIComponent;
    for (const b of buttons) {
      const link = document.createElement('a');
      link.className = `ref-share-btn ref-share-${b.id}`;
      link.textContent = b.label;
      link.target = '_blank';
      link.rel = 'noopener';
      link.href = b.href(enc(info.link), enc(shareText));
      shareBlock.append(link);
    }
    box.append(shareBlock);

    // Тот же текст копируется целиком — со ссылкой и описанием, а не голая
    const shareCopy = document.createElement('button');
    shareCopy.className = 'ref-copy';
    shareCopy.type = 'button';
    shareCopy.textContent = t('referral.share_copy');
    shareCopy.addEventListener('click', async () => {
      const ok = await copyText(shareText);
      shareCopy.textContent = ok ? t('referral.copied') : t('referral.copy_failed');
      setTimeout(() => { shareCopy.textContent = t('referral.share_copy'); }, 2500);
    });
    box.append(shareCopy);
  } catch {
    const empty = document.createElement('div');
    empty.className = 'lb-empty';
    empty.textContent = t('referral.unavailable');
    box.append(empty);
  }
}

/** Скопировать текст. Возвращает false, если браузер не дал доступ к буферу */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Запасной путь: временный textarea + execCommand. Работает и без
    // разрешения на буфер, и на http, где clipboard API может быть закрыт
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px';
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

// ── Друзья ────────────────────────────────────────────────

async function loadFriends(): Promise<void> {
  const box = $('panel-friends');
  if (!box) return;
  box.innerHTML = '';
  try {
    const data = await api.friends();

    // Входящие запросы
    if (data.pending.length) {
      const pendingLabel = document.createElement('div');
      pendingLabel.className = 'pending-label';
      pendingLabel.textContent = t('panels.pending_requests_n').replace('{n}', String(data.pending.length));
      box.append(pendingLabel);
      for (const p of data.pending) {
        const row = document.createElement('div');
        row.className = 'pending-entry';
        row.innerHTML =
          `<span class="friend-name">${p.friendName}</span>` +
          `<span class="friend-info">${t('badges.level')}${p.level}</span>`;
        const acceptBtn = document.createElement('button');
        acceptBtn.className = 'friend-btn friend-btn--accept';
        acceptBtn.textContent = t('panels.friend_accept');
        acceptBtn.addEventListener('click', async () => {
          await api.friendAccept(p.userId);
          toast(t('panels.friend_accepted'), 'success');
          void loadFriends();
        });
        row.append(acceptBtn);
        box.append(row);
      }
    }

    // Список друзей
    if (data.friends.length) {
      for (const f of data.friends) {
        const row = document.createElement('div');
        row.className = 'friend-entry';
        row.innerHTML =
          `<span class="${f.online ? 'friend-online' : 'friend-offline'}"></span>` +
          `<span class="friend-name">${f.friendName}</span>` +
          `<span class="friend-info">${t('badges.level')}${f.level} · ${regionName(f.region)}</span>`;
        const actionsEl = document.createElement('span');
        actionsEl.className = 'friend-actions';
        const removeBtn = document.createElement('button');
        removeBtn.className = 'friend-btn friend-btn--danger';
        removeBtn.textContent = '×';
        removeBtn.title = t('panels.friend_delete');
        removeBtn.addEventListener('click', async () => {
          await api.friendRemove(f.friendId);
          toast(t('panels.friend_removed'), 'info');
          void loadFriends();
        });
        actionsEl.append(removeBtn);
        row.append(actionsEl);
        box.append(row);
      }
    } else if (!data.pending.length) {
      const empty = document.createElement('div');
      empty.className = 'lb-empty';
      empty.textContent = t('panels.no_friends');
      box.append(empty);
    }

    // Поиск и добавление друзей
    const searchRow = document.createElement('div');
    searchRow.style.cssText = 'display:flex;gap:6px;margin-top:12px';
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = t('panels.friend_search_ph');
    searchInput.style.cssText = 'flex:1;background:#1a1410;color:#f5f0e8;border:1px solid #5a4a30;padding:6px 8px;border-radius:4px;font-size:12px;';
    searchInput.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      const val = searchInput.value.trim();
      if (!val) return;
      try {
        await api.friendRequest(val);
        toast(t('panels.friend_sent').replace('{name}', val), 'success');
        searchInput.value = '';
        void loadFriends();
      } catch (err) {
        toast((err as Error).message, 'error');
      }
    });
    const addBtn = document.createElement('button');
    addBtn.className = 'quest-accept';
    addBtn.textContent = t('panels.friend_add');
    addBtn.addEventListener('click', () => {
      const ev = new KeyboardEvent('keydown', { key: 'Enter' });
      searchInput.dispatchEvent(ev);
    });
    searchRow.append(searchInput, addBtn);
    box.append(searchRow);
  } catch {
    box.innerHTML = `<div class="lb-empty">${t('panels.friends_unavailable')}</div>`;
  }
}

// ── Шахматы Шаха ──────────────────────────────────────────

async function loadChess(): Promise<void> {
  const box = $('panel-chess');
  if (!box) return;
  box.innerHTML = '';

  const betRow = document.createElement('div');
  betRow.className = 'chess-bet-row';
  betRow.innerHTML = `<span style="color:var(--cream-dim);font-size:12px;">${t('chess.bet_label')}</span>`;
  const betInput = document.createElement('input');
  betInput.className = 'chess-bet-input';
  betInput.type = 'number';
  betInput.value = '50';
  betInput.min = '10';
  betInput.max = '5000';
  betRow.append(betInput);
  const startBtn = document.createElement('button');
  startBtn.className = 'quest-accept';
  startBtn.textContent = t('site.chess_start');
  startBtn.addEventListener('click', async () => {
    const bet = Number(betInput.value) || 50;
    try {
      // Персонаж обязателен: золото и партия принадлежат персонажу, а не
    // аккаунту. Без него сервер считал id сессии за персонажа и отвечал
    // «не хватает золота» при полном кошельке.
    const charId = cid();
    if (!charId) return;
    const game = await api.chessStart(charId, bet);
      renderChessBoard(box, game);
    } catch (err) { toast((err as Error).message, 'error'); }
  });
  betRow.append(startBtn);
  box.append(betRow);

  const statusEl = document.createElement('div');
  statusEl.className = 'chess-status';
  statusEl.textContent = t('chess.need_bet');
  box.append(statusEl);
}

function renderChessBoard(container: HTMLElement, game: { gameId: string; board: (string | null)[][]; turn: string; status: string; betGold: number }): void {
  container.innerHTML = '';
  const PIECES: Record<string, string> = {
    K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙',
    k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟',
  };

  let selectedCell: { row: number; col: number } | null = null;

  const boardEl = document.createElement('div');
  boardEl.className = 'chess-board';

  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 6; c++) {
      const cell = document.createElement('div');
      cell.className = `chess-cell ${(r + c) % 2 === 0 ? 'light' : 'dark'}`;
      const piece = game.board[r][c];
      if (piece) cell.textContent = PIECES[piece] ?? piece;

      cell.addEventListener('click', async () => {
        if (game.status === 'checkmate' || game.status === 'stalemate') return;

        if (!selectedCell) {
          if (piece && piece === piece.toUpperCase()) {
            selectedCell = { row: r, col: c };
            cell.classList.add('selected');
          }
        } else {
          try {
            const result = await api.chessMove(cid(), game.gameId, selectedCell, { row: r, col: c });
            game.board = result.board;
            game.turn = result.turn;
            game.status = result.status;
            if (result.result) {
              toast(result.result.messageRu, result.result.winner === 'white' ? 'success' : 'error');
            }
            renderChessBoard(container, game);
          } catch {
            toast(t('chess.illegal'), 'error');
            selectedCell = null;
            boardEl.querySelectorAll('.selected').forEach(el => el.classList.remove('selected'));
          }
        }
      });

      boardEl.append(cell);
    }
  }
  container.append(boardEl);

  const statusEl = document.createElement('div');
  statusEl.className = 'chess-status';
  if (game.status === 'checkmate') {
    statusEl.textContent = t('chess.checkmate');
  } else if (game.status === 'stalemate') {
    statusEl.textContent = t('chess.stalemate');
  } else {
    statusEl.textContent = t('chess.turn').replace('{who}', game.turn === 'white' ? t('panels.you') : t('chess.master')).replace('{bet}', String(game.betGold));
  }
  container.append(statusEl);

  const resignBtn = document.createElement('button');
  resignBtn.className = 'quest-accept';
  resignBtn.textContent = t('chess.resign');
  resignBtn.style.marginTop = '8px';
  resignBtn.addEventListener('click', async () => {
    await api.chessResign(cid(), game.gameId);
    toast(t('chess.resigned'), 'info');
    void loadChess();
  });
  container.append(resignBtn);
}

// ── Стихи Хафиза ──────────────────────────────────────────

async function loadPoetry(): Promise<void> {
  const box = $('panel-poetry');
  if (!box) return;
  box.innerHTML = '';

  // Сначала показываем список вызовов
  let challenges: { id: string; titleRu: string; difficulty: string; lineCount: number; reward: { gold: number; experience: number } }[] = [];
  try { challenges = (await api.poetryChallenges()).challenges; } catch {}

  if (!challenges.length) {
    box.innerHTML = `<div class="lb-empty">${t('poetry.unavailable')}</div>`;
    return;
  }

  const info = document.createElement('div');
  info.style.cssText = 'color:var(--cream-dim);font-size:12px;margin-bottom:8px';
  info.textContent = t('poetry.choose');
  box.append(info);

  const listEl = document.createElement('div');
  listEl.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-bottom:12px';

  for (const ch of challenges) {
    const row = document.createElement('div');
    row.className = 'friend-entry';
    row.style.cursor = 'pointer';
    row.style.padding = '8px';
    row.style.borderRadius = '6px';
    row.style.border = '1px solid rgba(201,168,76,0.15)';
    row.innerHTML = `<span class="friend-name">${ch.titleRu}</span>` +
      `<span class="friend-info">${ch.difficulty} · ${t('poetry.lines').replace('{n}', String(ch.lineCount))}</span>` +
      `<span class="lb-value">◉${ch.reward.gold} ⚡${ch.reward.experience}</span>`;
    row.addEventListener('click', () => startPoetryGame(ch));
    listEl.append(row);
  }
  box.append(listEl);

  async function startPoetryGame(challenge: typeof challenges[0]): Promise<void> {
    box.innerHTML = '';
    try {
      const data = await api.poetryStart(challenge.difficulty);
      let selectedIndices: number[] = [];

      const titleEl = document.createElement('h3');
      titleEl.style.cssText = 'color:var(--cream);margin:0 0 4px;font-size:15px;';
      titleEl.textContent = data.challenge.titleRu;
      box.append(titleEl);

      const hintEl = document.createElement('p');
      hintEl.style.cssText = 'color:var(--cream-dim);font-size:12px;margin:0 0 10px;';
      hintEl.textContent = t('poetry.hint').replace('{diff}', data.challenge.difficulty).replace('{n}', String(data.challenge.lineCount));
      box.append(hintEl);

      const resultEl = document.createElement('div');
      resultEl.className = 'poetry-result';
      box.append(resultEl);

      const optionsEl = document.createElement('div');
      optionsEl.className = 'poetry-options';

      function renderOptions(): void {
        optionsEl.innerHTML = '';
        data.options.forEach((opt: { textRu: string }, idx: number) => {
          const line = document.createElement('div');
          line.className = 'poetry-line';
          if (selectedIndices.includes(idx)) line.classList.add('selected');
          line.textContent = opt.textRu;
          line.addEventListener('click', async () => {
            if (selectedIndices.includes(idx)) return;
            selectedIndices.push(idx);
            try {
              const res = await api.poetrySelect(data.gameId, idx);
              renderOptions();
              if (res.isComplete) {
                optionsEl.querySelectorAll('.poetry-line').forEach(l => l.classList.add(res.isCorrect ? 'correct' : 'wrong'));
                if (!res.isCorrect) {
                  resultEl.className = 'poetry-result wrong';
                  resultEl.textContent = t('site.poetry_wrong');
                  return;
                }
                // Награду забираем у сервера, а не показываем из своих
                // данных. Панель знала challenge.reward.gold из собственной
                // копии каталога и показывала число, которого никто не
                // платил: маршрута завершения не было вовсе.
                //
                // Теперь маршрут есть, и показывается то, что сервер
                // начислил на самом деле. Если сервер по какой-то причине
                // не заплатил, игрок увидит это, а не правдоподобное число.
                resultEl.className = 'poetry-result correct';
                resultEl.textContent = t('poetry.correct');
                try {
                  const charId = cid();
                  const finish = charId ? await api.poetryFinish(charId, data.gameId) : null;
                  if (finish?.reward) {
                    resultEl.textContent = t('poetry.correct')
                      + `${finish.reward.gold} ${t('common.gold')}`
                      + ` · ${finish.reward.experience} ${t('world.exp')}`;
                    // Золото на сервере изменилось - полосы обязаны это показать.
                    // session.character.gold, а не session.gold: так обновляют
                    // все прочие места, и отдельное поле было бы вторым
                    // источником правды о кошельке.
                    if (session.character && typeof finish.gold === 'number') {
                      session.character.gold = finish.gold;
                    }
                    refreshBars();
                  }
                  for (const id of finish?.achievements ?? []) {
                    toast(t('notifications.achievement_unlocked'), 'success');
                    void id;
                  }
                } catch (err) {
                  // Стих собран верно, а награда не пришла. Говорим прямо:
                  // молчание выглядело бы так, будто всё в порядке.
                  resultEl.textContent = t('poetry.correct') + ' — ' + t('poetry.reward_failed');
                  toast(t('poetry.reward_failed'), 'error');
                }
              }
            } catch (err) { toast((err as Error).message, 'error'); }
          });
          optionsEl.append(line);
        });
      }

      renderOptions();
      box.append(optionsEl);

      const undoBtn = document.createElement('button');
      undoBtn.className = 'quest-accept';
      undoBtn.textContent = t('common.cancel');
      undoBtn.style.marginTop = '8px';
      undoBtn.addEventListener('click', async () => {
        if (selectedIndices.length === 0) return;
        selectedIndices.pop();
        await api.poetryUndo(data.gameId);
        resultEl.textContent = '';
        resultEl.className = 'poetry-result';
        renderOptions();
      });
      box.append(undoBtn);

      const backBtn = document.createElement('button');
      backBtn.style.cssText = 'background:none;border:1px solid #5a4a30;color:var(--cream-dim);padding:4px 10px;border-radius:4px;margin-top:6px;font-size:11px;cursor:pointer;';
      backBtn.textContent = t('common.back_list');
      backBtn.addEventListener('click', () => void loadPoetry());
      box.append(backBtn);

    } catch {
      box.innerHTML = `<div class="lb-empty">${t('chess.start_error')}</div>`;
    }
  }
}

// ── Сюжет: главы ───────────────────────────────────────────

interface ChapterView {
  chapter: { id: string; order: number; title: string; titleRu: string; description: string; descriptionRu: string; region: string; minLevel: number };
  quests: { id: string; titleRu: string; status: 'completed' | 'active' | 'locked' }[];
  done: number; total: number; percent: number; unlocked: boolean; started: boolean;
  cutscenes: { id: string; titleRu: string; watched: boolean }[];
}

export async function loadStory(): Promise<void> {
  if (!session.character) return;
  const box = $('story-content');
  if (!box) return;
  try {
    const data = await api.storyState(session.character.id);
    box.innerHTML = '';

    const total = document.createElement('div');
    total.className = 'story-total';
    total.textContent = `${t('story.progress')}: ${data.totalDone} / ${data.totalQuests} · ${t('story.scenes')}: ` +
      `${data.chapters.reduce((a, c) => a + c.cutscenes.filter(s => s.watched).length, 0)} / ${data.cutscenesTotal}`;
    box.append(total);

    const bar = document.createElement('div');
    bar.className = 'story-bar';
    const fill = document.createElement('i');
    fill.style.width = `${data.totalQuests ? (data.totalDone / data.totalQuests) * 100 : 0}%`;
    bar.append(fill);
    box.append(bar);

    for (const ch of data.chapters as ChapterView[]) {
      const isCurrent = ch.chapter.id === data.currentChapterId;
      const card = document.createElement('div');
      card.className = 'chapter' + (ch.unlocked ? '' : ' locked') + (isCurrent ? ' current' : '');

      const h = document.createElement('h4');
      h.textContent = `${ch.chapter.order}. ${ch.chapter.titleRu}`;
      card.append(h);

      const p = document.createElement('p');
      p.textContent = ch.chapter.descriptionRu;
      card.append(p);

      const b = document.createElement('div');
      b.className = 'story-bar';
      const bf = document.createElement('i');
      bf.style.width = `${ch.percent * 100}%`;
      b.append(bf);
      card.append(b);

      for (const q of ch.quests) {
        const line = document.createElement('span');
        line.className = `chapter-q ${q.status}`;
        line.textContent = q.titleRu;
        card.append(line);
      }

      if (!ch.unlocked) {
        const lock = document.createElement('span');
        lock.className = 'chapter-q locked';
        lock.textContent = `${t('story.unlocks_at')} ${ch.chapter.minLevel}`;
        card.append(lock);
      }

      if (ch.cutscenes.length) {
        // Узлы DOM, а не innerHTML: иначе <span> попадал в textContent
        // и игрок видел в панели «✓ <span class="watched">Призыв</span>»
        const scenes = document.createElement('div');
        scenes.className = 'chapter-scenes';
        scenes.append(document.createTextNode(`${t('story.scenes_in_chapter')}: `));
        ch.cutscenes.forEach((s, i) => {
          if (i > 0) scenes.append(document.createTextNode(' · '));
          const span = document.createElement('span');
          if (s.watched) {
            span.className = 'watched';
            span.textContent = `✓ ${s.titleRu}`;
          } else {
            span.textContent = s.titleRu;
          }
          scenes.append(span);
        });
        card.append(scenes);
      }

      box.append(card);
    }
  } catch {
    box.innerHTML = '<div class="inv-empty">—</div>';
  }
}

// ── Хроники Сефевидов ─────────────────────────────────────

async function loadChronicles(): Promise<void> {
  const box = $('panel-chronicles');
  if (!box) return;
  box.innerHTML = '';

  try {
    const data = await api.chronicles();
    const categories = [
      { id: 'history', label: t('chronicles.cat_history') },
      { id: 'culture', label: t('chronicles.cat_culture') },
      { id: 'geography', label: t('chronicles.cat_geography') },
      { id: 'biography', label: t('chronicles.cat_biographies') },
      { id: 'mythology', label: t('chronicles.cat_mythology') },
    ];

    const tabsEl = document.createElement('div');
    tabsEl.className = 'lb-tabs';
    let activeCat = '';
    for (const cat of categories) {
      const btn = document.createElement('button');
      btn.className = 'lb-tab' + (cat.id === activeCat ? ' active' : '');
      btn.textContent = cat.label;
      btn.addEventListener('click', () => {
        tabsEl.querySelectorAll('.lb-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeCat = cat.id;
        renderChronicles(listEl, data.entries, cat.id);
      });
      tabsEl.append(btn);
    }
    box.append(tabsEl);

    const listEl = document.createElement('div');
    listEl.className = 'chronicles-grid';
    box.append(listEl);

    // Прогресс энциклопедии: видно, что контент открывается по мере игры
    if (typeof data.unlocked === 'number' && data.total > 0) {
      const prog = document.createElement('div');
      prog.className = 'chronicles-progress';
      prog.textContent = t('chronicles.unlocked').replace('{unlocked}', String(data.unlocked)).replace('{total}', String(data.total));
      box.append(prog);
    }

    renderChronicles(listEl, data.entries, '');
  } catch {
    box.innerHTML = `<div class="lb-empty">${t('chronicles.unavailable')}</div>`;
  }
}

interface ChronicleView {
  id: string; category: string; title: string; titleRu: string;
  content: string; contentRu: string;
  unlocked: boolean; unlockHintRu: string | null;
}

function renderChronicles(container: HTMLElement, entries: ChronicleView[], category: string): void {
  container.innerHTML = '';
  const filtered = category ? entries.filter(e => e.category === category) : entries;

  if (!filtered.length) {
    container.innerHTML = `<div class="lb-empty">${t('chronicles.none')}</div>`;
    return;
  }

  for (const entry of filtered) {
    const card = document.createElement('div');
    // Считаем запись закрытой только когда сервер явно сказал false:
    // иначе при разговоре со старой версией сервера панель «закрылась» бы целиком.
    const locked = entry.unlocked === false;
    // Закрытая запись не показывает текст и не открывается: так условие
    // открытия работает, а не рисует серую карточку с полным текстом.
    card.className = locked ? 'chronicle-card locked' : 'chronicle-card';
    card.style.position = 'relative';
    if (locked) {
      card.innerHTML =
        `<span class="chronicle-lock">🔒</span>` +
        `<span class="chronicle-cat">${entry.category}</span>` +
        `<h4>???</h4>` +
        (entry.unlockHintRu
          ? `<p class="chronicle-hint">${t('chronicles.unlock_after').replace('{hint}', entry.unlockHintRu ?? '')}</p>`
          : `<p class="chronicle-hint">${t('chronicles.unlock_later')}</p>`);
    } else {
      card.innerHTML =
        `<span class="chronicle-cat">${entry.category}</span>` +
        `<h4>${entry.titleRu}</h4>` +
        `<p>${entry.contentRu.slice(0, 120)}…</p>`;
    }
    if (locked) { container.append(card); continue; }
    card.addEventListener('click', () => {
      const modal = document.createElement('div');
      modal.className = 'death-overlay';
      modal.style.zIndex = '102';
      modal.innerHTML = `
        <div class="death-content" style="max-width:560px;text-align:left;">
          <h3 style="color:var(--cream);margin:0 0 8px;">${entry.titleRu}</h3>
          <p style="color:var(--cream-dim);font-size:13px;line-height:1.6;margin:0;">${entry.contentRu}</p>
          <button class="death-btn death-btn--free" style="margin-top:16px;" onclick="this.closest('.death-overlay').remove()">${t('common.close')}</button>
        </div>
      `;
      document.body.append(modal);
    });
    container.append(card);
  }
}

const REGION_NAMES: Record<string, string> = {
  tabriz: 'regions.tabriz', isfahan: 'regions.isfahan', shiraz: 'regions.shiraz', caucasus: 'regions.caucasus',
  mesopotamia: 'regions.mesopotamia', khorasan: 'regions.khorasan', persian_gulf: 'regions.persian_gulf',
};

function regionName(region: string): string {
  const key = REGION_NAMES[region];
  return key ? t(key) : region;
}

// ── Гильдии ────────────────────────────────────────────────

// ── Достижения ─────────────────────────────────────────────

async function loadAchievements(): Promise<void> {
  const box = $('panel-achievements');
  if (!box) return;
  box.innerHTML = '';
  try {
    const charId = cid();
    if (!charId) return;
    const data = await api.achievements(charId);
    const stats = document.createElement('div');
    stats.className = 'lb-my-rank';
    stats.textContent = t('achievements.stats').replace('{done}', String(data.unlockedCount)).replace('{total}', String(data.total));
    box.append(stats);
    if (!data.achievements.length) {
      const empty = document.createElement('div');
      empty.className = 'lb-empty';
      empty.textContent = t('achievements.coming');
      box.append(empty);
      return;
    }
    // Название берём по языку игрока — как в задачах дня: у достижений
    // поля называются title / title_ru. ТУТ БЫЛА ПОЛОМКА: читалось
    // a.titleRu, такого поля у сервера нет, и в КАЖДОЙ строке стояло
    // «undefined» — 21 достижение подряд выглядели как битые
    const en = document.documentElement.lang === 'en';
    for (const a of data.achievements) {
      const row = document.createElement('div');
      row.className = 'friend-entry' + (a.unlocked ? '' : ' locked');
      row.style.opacity = a.unlocked ? '1' : '0.4';
      const icon = a.icon ?? '★';
      const name = en ? a.title : a.title_ru;
      const desc = en ? a.description : a.description_ru;
      // Прогресс. Для достижения со счётчиком - «7 / 10», и цифра растёт
      // по мере игры. Для достижения без счётчика - «пока не считается»:
      // там нет колонки в базе, и ноль был бы правдоподобной ложью -
      // рядом с «Скрафтить 50 предметов» игрок решил бы, что не крафтил.
      const progress = a.counted && a.need
        ? `${Math.min(a.current ?? 0, a.need)} / ${a.need}`
        : t('achievements.not_counted');
      row.innerHTML = `<span style="font-size:18px;">${icon}</span>` +
        `<span class="friend-name">${name ?? ''}</span>` +
        `<span class="friend-info">${desc ?? ''}</span>` +
        `<span class="lb-value">${progress}</span>` +
        (a.reward_gold ? `<span class="lb-value">◉${a.reward_gold}</span>` : '');
      box.append(row);
    }
  } catch { box.innerHTML = `<div class="lb-empty">${t('achievements.unavailable')}</div>`; }
}

// ── Ежедневные задачи ──────────────────────────────────────

async function loadTasks(): Promise<void> {
  // Раньше бралась сама панель, и innerHTML стирал её заголовок вместе с
  // иконкой. Остальные панели берут внутренний div — так и здесь.
  const box = $('tasks-content');
  if (!box) return;
  box.innerHTML = '';
  try {
    const charId = session.character?.id;
    if (!charId) return;
    const data = await api.tasks(charId);
    // Панель открылась — значит, цифра на кнопке в ряду могла устареть
    setDailyTasksOpen(data.tasks.filter((task: { completed?: boolean }) => !task.completed).length);
    const stats = document.createElement('div');
    stats.className = 'lb-my-rank';
    stats.textContent = `${t('site.tasks_done')}: ${data.completedCount}`;
    box.append(stats);
    if (!data.tasks.length) {
      const empty = document.createElement('div');
      empty.className = 'lb-empty';
      empty.textContent = t('site.tasks_empty');
      box.append(empty);
      return;
    }
    for (const task of data.tasks) {
      const row = document.createElement('div');
      row.className = 'friend-entry';
      const pct = Math.min(100, Math.round((task.current / task.required_count) * 100));
      // Название и подпись берём по языку игрока: у задач есть и ru, и en
      const en = document.documentElement.lang === 'en';
      const name = en ? task.title : task.title_ru;
      const desc = en ? task.description : task.description_ru;
      row.innerHTML = `<span class="friend-name">${name}</span>` +
        `<span class="friend-info">${task.current}/${task.required_count}</span>` +
        `<span class="lb-value">${pct}%</span>`;
      row.title = desc ?? '';
      if (task.completed) row.style.borderLeft = '2px solid #4AA86A';
      box.append(row);
    }
  } catch { box.innerHTML = `<div class="lb-empty">${t('tasks.unavailable')}</div>`; }
}

// ── Питомцы ────────────────────────────────────────────────

async function loadPets(): Promise<void> {
  const box = $('panel-pets');
  if (!box) return;
  box.innerHTML = '';
  try {
    const data = await api.pets(cid());
    if (!data.pets.length) {
      const empty = document.createElement('div');
      empty.className = 'lb-empty';
      empty.textContent = t('site.pets_none');
      box.append(empty);
      
      const shopBtn = document.createElement('button');
      shopBtn.className = 'quest-accept';
      shopBtn.textContent = t('site.pets_buy');
      shopBtn.style.marginTop = '8px';
      shopBtn.addEventListener('click', () => {
        // Магазин питомцев: явные кнопки покупки
        const old = box.querySelector('.pet-shop');
        if (old) { old.remove(); return; }
        const list = document.createElement('div');
        list.className = 'pet-shop';
        for (const p of data.allDefs as any[]) {
          const row = document.createElement('div');
          row.className = 'friend-entry';
          const label = document.createElement('span');
          label.className = 'friend-name';
          label.textContent = p.name_ru ?? p.id;
          const info = document.createElement('span');
          info.className = 'friend-info';
          info.textContent = `${p.type ?? ''} · ${p.rarity ?? ''}`;
          const buyBtn = document.createElement('button');
          buyBtn.className = 'friend-btn';
          buyBtn.textContent = t('panels.buy');
          buyBtn.addEventListener('click', async () => {
            try { await api.petAcquire(cid(), p.id); toast(t('pets.received'), 'success'); void loadPets(); }
            catch (err) { toast((err as Error).message, 'error'); }
          });
          row.append(label, info, buyBtn);
          list.append(row);
        }
        box.append(list);
      });
      box.append(shopBtn);
      return;
    }
    for (const p of data.pets) {
      const def = data.allDefs.find((d: any) => d.id === p.pet_id);
      const row = document.createElement('div');
      row.className = 'friend-entry' + (p.is_active ? ' current' : '');
      const nameEl = document.createElement('span');
      nameEl.className = 'friend-name';
      nameEl.textContent = p.nickname ?? def?.name_ru ?? p.pet_id;
      const infoEl = document.createElement('span');
      infoEl.className = 'friend-info';
      infoEl.textContent = `${t('badges.level')}${p.level} · ${def?.type ?? ''}`;
      row.append(nameEl, infoEl);
      if (!p.is_active) {
        const actBtn = document.createElement('button');
        actBtn.className = 'friend-btn';
        actBtn.textContent = t('site.pets_select');
        actBtn.addEventListener('click', async () => { await api.petActivate(cid(), p.id); void loadPets(); });
        row.append(actBtn);
      }

      // Переименовать и отпустить.
      //
      // Маршруты /pets/rename и /pets/release и обёртки petRename/petRelease
      // были написаны, а кнопок не было. Заодно выяснилось, что сервер искал
      // питомцев по идентификатору АККАУНТА: список был пуст, а переименование
      // меняло чужую строку — то есть молчало.
      const renameBtn = document.createElement('button');
      renameBtn.className = 'friend-btn';
      renameBtn.textContent = t('pets.rename_btn');
      renameBtn.addEventListener('click', async () => {
        const nickname = prompt(t('pets.new_name'), p.nickname ?? def?.name_ru ?? '');
        if (!nickname || !nickname.trim()) return;
        try {
          await api.petRename(cid(), p.id, nickname.trim());
          toast(t('pets.renamed'), 'success');
          void loadPets();
        } catch (err) { toast((err as Error).message, 'error'); }
      });
      row.append(renameBtn);

      const releaseBtn = document.createElement('button');
      releaseBtn.className = 'friend-btn friend-btn--danger';
      releaseBtn.textContent = t('pets.release');
      releaseBtn.addEventListener('click', async () => {
        // Отпустить питомца необратимо, поэтому спрашиваем. Раньше кнопки не
        // было, и игрок не мог понять, что она вообще нужна
        if (!confirm(t('pets.release_confirm'))) return;
        try {
          await api.petRelease(cid(), p.id);
          toast(t('pets.released'), 'info');
          void loadPets();
        } catch (err) { toast((err as Error).message, 'error'); }
      });
      row.append(releaseBtn);

      box.append(row);
    }
  } catch (err) {
    box.innerHTML = `<div class="lb-empty">${t('panels.error_msg').replace('{msg}', (err as Error).message)}</div>`;
  }
}

// ── Уведомления ────────────────────────────────────────────

/**
 * Список уведомлений.
 *
 * ЧТО БЫЛО. Панели не существовало. NotificationService писал строки в
 * таблицу notifications (мировой босс, лот продан, новое письмо), и всё, что
 * могло их показать, — тост, исчезавший через пару секунд. Возвращаться к
 * списку было некуда, а счётчика непрочитанных не существовало.
 */
/**
 * Зал славы: кто повалил мирового босса и сколько раз.
 *
 * Панели не было. Таблица world_boss_kills наполнялась с прошлого коммита,
 * но смотреть на историю было некому — то есть она наполнялась впустую.
 *
 * Про долю урона: сервер не собирает расклад по урону за бой, поэтому
 * колонка top_damage хранит только победителя. Показывать «долю урона»
 * было бы значило показать игроку цифру, которую никто не измерял,
 * поэтому её здесь нет.
 */
/**
 * Почтовый ящик: письма с наградами, которые нельзя было выдать сразу.
 *
 * ЧТО БЫЛО. Таблица mailbox была пуста. Награда, которая не помещалась
 * в сумку, просто пропадала: игрок заплатил на аукционе, вещь ему
 * отдали, но сумка переполнилась — и забрать было негде.
 *
 * Кнопка «Забрать» вызывает серверный забор: письмо удаляется только
 * после успешной выдачи, поэтому повторным нажатием награду не получить.
 */
async function loadMail(): Promise<void> {
  const box = $('panel-mail');
  if (!box) return;
  box.innerHTML = `<div class="lb-empty">${t('mail.empty')}</div>`;
  try {
    const { items } = await api.mail(cid());
    if (!items.length) {
      box.innerHTML = `<div class="lb-empty">${t('mail.empty')}</div>`;
      return;
    }
    const list = document.createElement('div');
    list.className = 'mail-list';
    for (const m of items) {
      const row = document.createElement('div');
      row.className = 'mail-row' + (m.isRead ? '' : ' mail-new');

      const head = document.createElement('div');
      head.className = 'mail-subject';
      head.textContent = m.subject;
      const when = document.createElement('div');
      when.className = 'mail-when';
      when.textContent = new Date(m.createdAt).toLocaleString();
      head.append(when);

      if (m.body) {
        const body = document.createElement('div');
        body.className = 'mail-body';
        body.textContent = m.body;
        row.append(head, body);
      } else {
        row.append(head);
      }

      // Награда: золото, предмет, или и то и другое
      const parts: string[] = [];
      if (m.gold > 0) parts.push(`${m.gold} ${t('mail.gold')}`);
      if (m.itemId && m.itemQty > 0) parts.push(`${t('mail.item')} ×${m.itemQty}`);
      if (parts.length) {
        const reward = document.createElement('div');
        reward.className = 'mail-reward';
        reward.textContent = parts.join(' · ');
        row.append(reward);

        const take = document.createElement('button');
        take.className = 'quest-accept';
        take.textContent = t('mail.claim');
        take.addEventListener('click', async () => {
          take.disabled = true;
          try {
            const got = await api.mailClaim(cid(), m.id);
            const gotParts: string[] = [];
            if (got.gold > 0) gotParts.push(`+${got.gold} ${t('mail.gold')}`);
            for (const it of got.items) gotParts.push(`+${it.qty} ${t('mail.item')}`);
            toast(gotParts.join(' · ') || t('mail.claimed'), 'success');
            void loadMail();
          } catch (err) {
            toast((err as Error).message, 'error');
            take.disabled = false;
          }
        });
        row.append(take);
      } else {
        // Письмо без награды: забирать нечего, достаточно отметить
        // прочитанным, чтобы оно не висело непрочитанным
        void api.mailRead(cid(), m.id).catch(() => {});
      }

      list.append(row);
    }
    box.innerHTML = '';
    box.append(list);
  } catch (err) {
    box.innerHTML = `<div class="lb-empty">${(err as Error).message}</div>`;
  }
}

async function loadHallOfFame(): Promise<void> {
  const box = $('panel-hall-of-fame');
  if (!box) return;
  box.innerHTML = '<div class="lb-empty">' + t('hall.empty') + '</div>';
  try {
    const { entries } = await api.hallOfFame(20);
  if (!entries.length) {
    box.innerHTML = '<div class="lb-empty">' + t('hall.empty') + '</div>';
    return;
  }

  const list = document.createElement('div');
  list.className = 'hall-list';
  for (const e of entries) {
    const row = document.createElement('div');
    // Первые три места подсвечиваются: залав славы без разницы выглядит
    // как обычный список, а именно он зовёт людей драться за босса
    row.className = 'hall-row' + (e.rank <= 3 ? ' hall-top' : '');

    const place = document.createElement('span');
    place.className = 'hall-place';
    place.textContent = e.rank === 1 ? '1' : e.rank === 2 ? '2' : e.rank === 3 ? '3' : String(e.rank);

    const who = document.createElement('div');
    who.className = 'hall-who';
    const name = document.createElement('div');
    name.className = 'hall-name';
    name.textContent = e.characterName;
    const meta = document.createElement('div');
    meta.className = 'hall-meta';
    meta.textContent = [
      e.class,
      e.guildName,
      new Date(e.lastKill).toLocaleDateString(),
    ].filter(Boolean).join(' · ');
    who.append(name, meta);

    const kills = document.createElement('span');
    kills.className = 'hall-kills';
    kills.textContent = t('hall.kills').replace('%d', String(e.kills));

    row.append(place, who, kills);
    list.append(row);
  }
  box.innerHTML = '';
  box.append(list);
  } catch (err) {
  box.innerHTML = '<div class="lb-empty">' + (err as Error).message + '</div>';
  }
}

async function loadNotifications(): Promise<void> {
  const box = $('notifications-list');
  if (!box) return;
  box.innerHTML = '';
  try {
    const { items, unread } = await api.notifications(cid());
    session.notifications.unread = unread;
    renderUnreadBadge();

    if (!items?.length) {
      const empty = document.createElement('div');
      empty.className = 'lb-empty';
      empty.textContent = t('notifications.empty');
      box.append(empty);
      return;
    }

    for (const n of items) {
      const row = document.createElement('div');
      row.className = 'note-row' + (n.is_read ? '' : ' unread');
      const title = document.createElement('div');
      title.className = 'note-title';
      title.textContent = n.title_ru;
      const body = document.createElement('div');
      body.className = 'note-body';
      body.textContent = n.body_ru;
      const when = document.createElement('div');
      when.className = 'note-when';
      when.textContent = new Date(n.created_at).toLocaleString();
      row.append(title, body, when);
      if (!n.is_read) {
        // Клик по строке снимает точку: читать по одному «Прочитать все» —
        // неудобно, когда в списке пятьдесят строк
        row.addEventListener('click', async () => {
          try { await api.notificationRead(cid(), n.id); } catch { /* не критично */ }
          row.classList.remove('unread');
          session.notifications.unread = Math.max(0, session.notifications.unread - 1);
          renderUnreadBadge();
        });
      }
      box.append(row);
    }

    if (unread > 0) {
      const all = document.createElement('button');
      all.className = 'quest-accept';
      all.style.marginTop = '10px';
      all.textContent = t('notifications.read_all');
      all.addEventListener('click', async () => {
        all.disabled = true;
        try {
          await api.notificationsReadAll(cid());
          session.notifications.unread = 0;
          renderUnreadBadge();
          for (const el of box.querySelectorAll('.note-row.unread')) el.classList.remove('unread');
        } catch (err) { toast((err as Error).message, 'error'); all.disabled = false; }
      });
      box.append(all);
    }
  } catch (err) {
    box.innerHTML = `<div class="lb-empty">${(err as Error).message}</div>`;
  }
}

// ── Дом ────────────────────────────────────────────────────

const HOUSE_DEFS: Record<string, { nameKey: string; price: number; slots: number; craftBonus: string }> = {
  cottage:    { nameKey: 'house.t_cottage',   price: 2000,  slots: 20, craftBonus: '0%' },
  house:      { nameKey: 'house.t_house',     price: 5000,  slots: 40, craftBonus: '+5%' },
  villa:      { nameKey: 'house.t_villa',     price: 15000, slots: 60, craftBonus: '+10%' },
  mansion:    { nameKey: 'house.t_mansion',   price: 40000, slots: 80, craftBonus: '+15%' },
  palace:     { nameKey: 'house.t_palace',    price: 100000,slots: 100,craftBonus: '+20%' },
};

const HOUSE_REGIONS = [
  { id: 'tabriz',    nameKey: 'regions.tabriz' },
  { id: 'isfahan',   nameKey: 'regions.isfahan' },
  { id: 'shiraz',    nameKey: 'regions.shiraz' },
  { id: 'caucasus',  nameKey: 'regions.caucasus' },
  { id: 'khorasan',  nameKey: 'regions.khorasan' },
  { id: 'mesopotamia', nameKey: 'regions.mesopotamia' },
  { id: 'persian_gulf', nameKey: 'regions.persian_gulf' },
];

async function loadHouse(): Promise<void> {
  const box = $('house-list');
  if (!box) return;
  box.innerHTML = '';
  try {
    const data = await api.house(cid());
    if (!data.house) {
      // Нет дома — показываем выбор
      const empty = document.createElement('div');
      empty.className = 'lb-empty';
      empty.textContent = t('site.house_none');
      box.append(empty);

      const info = document.createElement('div');
      info.style.cssText = 'color:#bfae8a;font-size:11px;margin:6px 0 10px;line-height:1.5';
      info.innerHTML = t('house.intro');
      box.append(info);

      // Выбор типа
      const typeRow = document.createElement('div');
      typeRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px';
      const typeLabel = document.createElement('span');
      typeLabel.style.cssText = 'color:#d9c27a;font-size:12px;width:80px';
      typeLabel.textContent = t('house.type_label');
      typeRow.append(typeLabel);
      const typeSel = document.createElement('select');
      typeSel.style.cssText = 'background:#1a1410;color:#f5f0e8;border:1px solid #5a4a30;padding:4px 8px;border-radius:4px';
      for (const [key, def] of Object.entries(HOUSE_DEFS)) {
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = `${t(def.nameKey)} · ${def.price.toLocaleString()}g · 📦${def.slots} · ⚒${def.craftBonus}`;
        typeSel.append(opt);
      }
      typeRow.append(typeSel);
      box.append(typeRow);

      // Выбор региона
      const regRow = document.createElement('div');
      regRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:12px';
      const regLabel = document.createElement('span');
      regLabel.style.cssText = 'color:#d9c27a;font-size:12px;width:80px';
      regLabel.textContent = t('house.region_label');
      regRow.append(regLabel);
      const regSel = document.createElement('select');
      regSel.style.cssText = 'background:#1a1410;color:#f5f0e8;border:1px solid #5a4a30;padding:4px 8px;border-radius:4px';
      for (const r of HOUSE_REGIONS) {
        const opt = document.createElement('option');
        opt.value = r.id;
        opt.textContent = t(r.nameKey);
        regSel.append(opt);
      }
      regRow.append(regSel);
      box.append(regRow);

      const buyBtn = document.createElement('button');
      buyBtn.className = 'quest-accept';
      buyBtn.textContent = t('panels.buy');
      buyBtn.style.marginTop = '8px';
      buyBtn.addEventListener('click', async () => {
        const type = typeSel.value;
        const region = regSel.value;
        try {
          await api.houseBuy(cid(), region, type);
          toast(t('house.bought'), 'success');
          void loadHouse();
        } catch (err) {
          toast((err as Error).message, 'error');
        }
      });
      box.append(buyBtn);
      return;
    }

    const h = data.house;
    const def = HOUSE_DEFS[h.house_type] ?? { nameKey: h.house_type, price: 0, slots: 0, craftBonus: '0%' };
    const nextTypeIdx = Object.keys(HOUSE_DEFS).indexOf(h.house_type) + 1;
    const nextType = Object.keys(HOUSE_DEFS)[nextTypeIdx];
    const nextDef = nextType ? HOUSE_DEFS[nextType] : null;

    const title = document.createElement('h3');
    title.style.cssText = 'color:var(--cream);margin:0 0 4px';
    title.textContent = `🏠 ${t(def.nameKey)} · ${t('badges.level')}${h.level}`;
    box.append(title);

    const info2 = document.createElement('p');
    info2.style.cssText = 'color:var(--cream-dim);font-size:12px;margin:0 0 4px';
    info2.textContent = t('house.info').replace('{region}', h.region).replace('{slots}', String(h.storage_slots)).replace('{bonus}', def.craftBonus);
    box.append(info2);

    if (nextDef) {
      const upBtn = document.createElement('button');
      upBtn.className = 'quest-accept';
      upBtn.textContent = t('house.upgrade_to').replace('{name}', t(nextDef.nameKey)).replace('{price}', nextDef.price.toLocaleString());
      upBtn.addEventListener('click', async () => {
        try { await api.houseUpgrade(cid()); toast(t('house.upgraded'), 'success'); void loadHouse(); }
        catch (err) { toast((err as Error).message, 'error'); }
      });
      box.append(upBtn);
    } else {
      const maxLabel = document.createElement('div');
      maxLabel.style.cssText = 'color:#5a4; font-size:12px; margin-top:8px';
      maxLabel.textContent = t('house.max_level');
      box.append(maxLabel);
    }

    // ── Обстановка ─────────────────────────────────────────
    // Маршрут /house/decorate и обёртка houseDecorate были написаны, а кнопки
    // не было: api.house() отдавал allDecorations, и панель его игнорировала.
    // Заодно выяснилось, что маршрут отдавал сервису идентификатор АККАУНТА
    // вместо персонажа — то есть расставить было нечем, даже если бы кнопка
    // появилась.
    const placed = new Set((data.playerDecorations ?? []).map((d: { decoration_id?: string }) => d.decoration_id));
    const decorHead = document.createElement('div');
    decorHead.className = 'panel-subhead';
    decorHead.textContent = t('house.decor_title');
    box.append(decorHead);

    const available = (data.allDecorations ?? []).filter((d: { id: string }) => !placed.has(d.id));
    if (!available.length) {
      const none = document.createElement('div');
      none.className = 'lb-empty';
      none.textContent = t('house.decor_none');
      box.append(none);
    } else {
      const sel = document.createElement('select');
      sel.style.cssText = 'background:#1a1410;color:#f5f0e8;border:1px solid #5a4a30;padding:4px 8px;border-radius:4px;max-width:100%';
      for (const d of available) {
        const opt = document.createElement('option');
        opt.value = d.id;
        opt.textContent = `${d.name_ru ?? d.name ?? d.id} · ${d.price ?? 0} ${t('world.gold')}`;
        sel.append(opt);
      }
      const put = document.createElement('button');
      put.className = 'quest-accept';
      put.style.marginTop = '8px';
      put.textContent = t('house.decor_place');
      put.addEventListener('click', async () => {
        put.disabled = true;
        try {
          await api.houseDecorate(cid(), sel.value);
          toast(t('house.decor_placed'), 'success');
          void loadHouse();
        } catch (err) { toast((err as Error).message, 'error'); put.disabled = false; }
      });
      box.append(sel, put);
    }

    if (placed.size) {
      const mine = document.createElement('div');
      mine.className = 'note-when';
      mine.style.marginTop = '8px';
      mine.textContent = `${t('house.decor_count')}: ${placed.size}`;
      box.append(mine);
    }
  } catch {
    box.innerHTML = `<div class="lb-empty">${t('panels.load_error')}</div>`;
  }
}

// ── PvP Арена ──────────────────────────────────────────────

async function loadPvP(): Promise<void> {
  const box = $('panel-pvp');
  if (!box) return;
  box.innerHTML = '';
  try {
    let rankData: { ranking?: any } = {};
    let rankRes: { rankings?: any[] } = {};
    try { [rankData, rankRes] = await Promise.all([api.pvpMe(cid()), api.pvpRankings(10)]); } catch {}
    const myRank = rankData.ranking;
    if (myRank) {
      const tierIcons: Record<string, string> = { bronze: '🥉', silver: '🥈', gold: '🥇', diamond: '💎', legendary: '👑' };
      const rankEl = document.createElement('div');
      rankEl.className = 'lb-my-rank';
      rankEl.textContent = t('pvp.rank_row').replace('{icon}', tierIcons[myRank.tier] ?? '').replace('{tier}', myRank.tier.toUpperCase()).replace('{rating}', String(myRank.rating)).replace('{wins}', String(myRank.wins)).replace('{losses}', String(myRank.losses)).replace('{streak}', String(myRank.streak));
      box.append(rankEl);
    } else {
      const info = document.createElement('div');
      info.style.cssText = 'color:var(--cream-dim);font-size:12px;margin-bottom:8px';
      info.textContent = t('pvp.no_fights');
      box.append(info);
    }
    const findBtn = document.createElement('button');
    findBtn.className = 'quest-accept';
    findBtn.textContent = t('site.pvp_find');
    findBtn.style.margin = '8px 0';
    // Соперника может не оказаться: тогда сервер позовёт позже через
    // pvp:match_found, а сейчас просто ждём. Отменить ожидание было нечем —
    // матч оставался в состоянии 'waiting' до бесконечности, и повторное
    // «Найти бой» натыкалось на «Already searching».
    let pendingMatchId: number | null = null;
    findBtn.addEventListener('click', async () => {
      findBtn.disabled = true;
      onPvpSearching();
      try {
        const res = await api.pvpFindMatch(cid());
        pendingMatchId = typeof res?.match?.id === 'number' ? res.match.id : null;
      } catch (err) {
        onPvpHide();
        toast((err as Error).message, 'error');
      } finally {
        findBtn.disabled = false;
      }
    });
    box.append(findBtn);

    // Отмена поиска. Маршрут /pvp/cancel был написан, обёртки не было.
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'quest-accept';
    cancelBtn.style.margin = '0 0 8px';
    cancelBtn.textContent = t('pvp.cancel_search');
    cancelBtn.disabled = true;
    cancelBtn.addEventListener('click', async () => {
      if (pendingMatchId === null) { toast(t('pvp.no_match_to_cancel'), 'info'); return; }
      cancelBtn.disabled = true;
      try {
        await api.pvpCancel(cid(), pendingMatchId);
        pendingMatchId = null;
        onPvpHide();
        toast(t('pvp.search_cancelled'), 'info');
        void loadPvP();
      } catch (err) {
        toast((err as Error).message, 'error');
        cancelBtn.disabled = false;
      }
    });
    box.append(cancelBtn);
    // Топ-10
    const title = document.createElement('div');
    title.className = 'panel-subhead';
    title.textContent = t('pvp.top');
    box.append(title);
    const rankings = rankRes.rankings ?? [];
    if (!rankings.length) {
      const empty = document.createElement('div');
      empty.className = 'lb-empty';
      empty.textContent = t('pvp.no_participants');
      box.append(empty);
    } else {
      for (const r of rankings.slice(0, 10)) {
        const row = document.createElement('div');
        row.className = 'lb-entry';
        row.innerHTML = `<span class="lb-rank">${r.tier === 'legendary' ? '👑' : r.tier === 'diamond' ? '💎' : ''} ${r.rating}</span>` +
          `<span class="lb-name">${r.character_name}</span>` +
          `<span class="lb-value">W:${r.wins}</span>`;
        box.append(row);
      }
    }
  } catch { box.innerHTML = `<div class="lb-empty">${t('pvp.unavailable')}</div>`; }
}

// ── Бесконечная Башня ──────────────────────────────────────

/** Этаж башни в том виде, как его отдаёт сервер */
interface TowerFloor {
  floor: number; monsterCount: number; monsterLevel: number;
  reward: { gold: number; experience: number; items: string[] };
}

/**
 * С какого момента игрок бежит этаж. По этому времени считается «лучшее
 * время» в рейтинге башни: сервер берёт число из тела запроса и проверить
 * его не может, поэтому честная оценка — единственное, что у нас есть.
 * Пол ключа — номер этажа.
 */
const towerRunStartedAt = new Map<number, number>();
/** Ниже этого сервер не примет: меньше десяти секунд на этаж не бывает */
const MIN_FLOOR_SECONDS = 10;

async function loadTower(): Promise<void> {
  const box = $('panel-tower');
  if (!box) return;
  box.innerHTML = '';
  try {
    // Персонаж обязателен: сервер ищет по endless_tower.character_id, а не по
    // аккаунту. Раньше он не передавался, и прогресс башни был всегда нулевым
    let progData: { progress?: { max_floor: number; current_floor: number; runs_total: number; best_time_seconds: number }; floor?: TowerFloor } = {};
    try { progData = await api.towerProgress(cid()); } catch {}
    const p = progData.progress ?? { max_floor: 0, current_floor: 0, runs_total: 0, best_time_seconds: 0 };
    const info = document.createElement('div');
    info.className = 'lb-my-rank';
    info.textContent = `🏰 ${t('tower.title')} · ${t('tower.max_floor')}: ${p.max_floor} · ${t('tower.current')}: ${p.current_floor} · ${t('tower.runs')}: ${p.runs_total}`;
    box.append(info);

    // Описание текущего этажа: сколько монстров, какой уровень, что за награда
    const floor = progData.floor;
    if (floor) {
      if (!towerRunStartedAt.has(floor.floor)) towerRunStartedAt.set(floor.floor, Date.now());
      const d = document.createElement('div');
      d.className = 'inv-item';
      const head = document.createElement('span');
      head.className = 'inv-name';
      head.textContent = `${t('tower.floor')} ${floor.floor}`;
      const info2 = document.createElement('span');
      info2.className = 'inv-qty';
      info2.textContent = t('tower.floor_info').replace('{count}', String(floor.monsterCount)).replace('{lvl}', String(floor.monsterLevel));
      d.append(head, info2);
      const reward = document.createElement('span');
      reward.style.cssText = 'color:#8a8; font-size:0.82em; width:100%';
      reward.textContent =
        `${t('tower.reward')}: ${floor.reward.gold} ${t('world.gold')}, ${floor.reward.experience} ${t('world.exp')}` +
        (floor.reward.items.length ? `, ${floor.reward.items.length}× ${t('tower.items')}` : '');
      d.append(reward);
      box.append(d);
    }

    const startBtn = document.createElement('button');
    startBtn.className = 'quest-accept';
    startBtn.textContent = t('tower.start');
    startBtn.style.margin = '8px 0';
    startBtn.addEventListener('click', async () => {
      startBtn.disabled = true;
      try {
        const res = await api.towerStart(cid());
        // Забег начат — отсчёт этажа 1 с этого момента
        towerRunStartedAt.set(1, Date.now());
        toast(`${t('tower.floor')} 1: ${res.floor.monsterCount} ${t('tower.monsters')}, ${t('panels.char_level')} ${res.floor.monsterLevel}`, 'info');
        void loadTower();
      } catch (err) { toast((err as Error).message, 'error'); }
      finally { startBtn.disabled = false; }
    });
    box.append(startBtn);

    // Кнопки «Пройти этаж» не было НИКОГДА. api.towerCompleteFloor и
    // api.towerFloor были написаны и не вызывались ни разу, поэтому пройти
    // этаж было нечем: кнопка «Начать забег» показывала состав врагов и
    // перерисовывала панель в то же состояние, а max_floor оставался нулём.
    const clearBtn = document.createElement('button');
    clearBtn.className = 'quest-accept';
    clearBtn.style.margin = '8px 0';
    clearBtn.textContent = `${t('tower.clear')} ${p.current_floor}`;
    clearBtn.addEventListener('click', async () => {
      clearBtn.disabled = true;
      try {
        // Время идёт с момента, когда этаж был показан игроку, а не с
        // момента нажатия: иначе кнопка всегда отправляла бы «1 секунда» и
        // рейтинг «лучшее время» врал бы каждому. Отсчёт на клиенте —
        // честная оценка; сервер отсекает заведомо неправдоподобное время
        // (см. MIN_FLOOR_SECONDS в EndGameService).
        const started = towerRunStartedAt.get(p.current_floor) ?? Date.now();
        const seconds = Math.max(MIN_FLOOR_SECONDS, Math.round((Date.now() - started) / 1000));
        const res = await api.towerCompleteFloor(cid(), p.current_floor, seconds);
        const items = res.reward.items.length ? ` + ${res.reward.items.length}× ${t('tower.items')}` : '';
        toast(`${t('tower.cleared')} ${p.current_floor}: +${res.reward.gold} ${t('world.gold')}, +${res.reward.experience} ${t('world.exp')}${items}`, 'success');
        if (res.newMax) toast(t('tower.new_record'), 'success');
        void loadTower();
      } catch (err) { toast((err as Error).message, 'error'); }
      finally { clearBtn.disabled = false; }
    });
    box.append(clearBtn);
    // Лидерборд
    let lbData: { leaderboard?: any[] } = {};
    try { lbData = await api.towerLeaderboard(); } catch {}
    const rankings = lbData.leaderboard ?? [];
    if (rankings.length) {
      const lbTitle = document.createElement('div');
      lbTitle.className = 'panel-subhead';
      lbTitle.textContent = t('tower.leaderboard');
      box.append(lbTitle);
      for (const e of rankings.slice(0, 10)) {
        const row = document.createElement('div');
        row.className = 'lb-entry';
        row.innerHTML = `<span class="lb-rank">🏰 ${e.max_floor}</span>` +
          `<span class="lb-name">${e.character_name}</span>` +
          `<span class="lb-value">${e.best_time_seconds}s</span>`;
        box.append(row);
      }
    } else {
      const empty = document.createElement('div');
      empty.className = 'lb-empty';
      empty.textContent = t('tower.empty');
      box.append(empty);
    }
  } catch { box.innerHTML = `<div class="lb-empty">${t('tower.unavailable')}</div>`; }
}

// ── Репутация ──────────────────────────────────────────────

/** Фракция с её лестницей рангов — приходит с сервера вместе с порогами. */
interface FactionInfo {
  id: string; name: string; nameRu: string;
  ranks: { name: string; nameRu: string; minRep: number }[];
}

/** Ключ перевода ранга по его английскому названию: «Trade Prince» → trade_prince. */
function rankKey(englishName: string): string {
  return `reputation.rank.${englishName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
}

/**
 * Ранг по числу репутации.
 *
 * Считаем здесь, а не берём rank_title из ответа: сервер хранит в базе
 * русское название, и в английской версии панель показывала бы «Тень».
 * Если ключа перевода нет — откатываемся на серверное название.
 */
function rankOf(faction: FactionInfo, value: number): { label: string; next: number | null } {
  let index = 0;
  faction.ranks.forEach((r, i) => { if (value >= r.minRep) index = i; });
  const current = faction.ranks[index];
  const label = t(rankKey(current.name)) === rankKey(current.name) ? current.nameRu : t(rankKey(current.name));
  const following = faction.ranks[index + 1];
  return { label, next: following ? following.minRep : null };
}

async function loadReputation(): Promise<void> {
  const box = $('panel-reputation');
  if (!box) return;
  box.innerHTML = '';
  const characterId = cid();
  if (!characterId) {
    box.innerHTML = `<div class="lb-empty">${t('reputation.no_character')}</div>`;
    return;
  }
  try {
    // Фракции берём отдельным запросом: там и все четыре (а не только те,
    // где что-то начислено), и пороги рангов для полоски прогресса.
    const [repData, factionData] = await Promise.all([
      api.reputation(characterId),
      api.factions(),
    ]);
    const mine = new Map((repData.reputation ?? []).map(r => [r.faction, r.reputation]));
    const factions = (factionData.factions as FactionInfo[]) ?? [];

    for (const f of factions) {
      const value = mine.get(f.id) ?? 0;
      const { label, next } = rankOf(f, value);
      const row = document.createElement('div');
      row.className = 'rep-row';
      const pct = next === null
        ? 100
        : Math.max(0, Math.min(100, Math.round(((value - lastThreshold(f, value)) / Math.max(1, next - lastThreshold(f, value))) * 100)));
      const nameKey = `reputation.faction.${f.id}`;
      const name = t(nameKey) === nameKey ? f.nameRu : t(nameKey);
      row.innerHTML =
        `<div class="rep-head">` +
          `<span class="rep-faction">${name}</span>` +
          `<span class="rep-rank">${label}</span>` +
          `<span class="rep-num">${value}</span>` +
        `</div>` +
        `<div class="rep-bar"><i style="width:${pct}%"></i></div>` +
        (next === null ? '' : `<div class="rep-next">${t('reputation.next_rank')}: ${next}</div>`);
      box.append(row);
    }

    const hint = document.createElement('div');
    hint.className = 'rep-hint';
    hint.textContent = t('reputation.hint');
    box.append(hint);
  } catch {
    box.innerHTML = `<div class="lb-empty">${t('reputation.unavailable')}</div>`;
  }
}

/** Порог, с которого считается текущий шаг прогресса к следующему рангу. */
function lastThreshold(faction: FactionInfo, value: number): number {
  let min = faction.ranks[0]?.minRep ?? 0;
  for (const r of faction.ranks) { if (value >= r.minRep) min = r.minRep; }
  return min;
}

// ── Диспетчер панелей ────────────────────────────────────────

function isSenior(): boolean {
  return session.isAdmin && session.isAdminRole !== 'gm';
}

function adminSub(box: HTMLElement, text: string): void {
  const head = document.createElement('div');
  head.className = 'panel-subhead';
  head.textContent = text;
  box.append(head);
}

function adminInput(placeholder: string, width = '110px', type = 'text'): HTMLInputElement {
  const el = document.createElement('input');
  el.type = type;
  el.placeholder = placeholder;
  el.style.width = width;
  return el;
}

/** Прочерк вместо выдуманного числа: делить не на что или день не наступил */
function dash(): string {
  return '—';
}

/** Процент, если есть знаменатель. Нет знаменателя — прочерк, а не 0% */
function shareText(share: number | null): string {
  return share === null ? dash() : `${share}%`;
}

/**
 * Раздел «Воронка и удержание» в админ-панели.
 *
 * Показывает три вещи: провал между соседними шагами воронки, удержание по
 * когортам и активных игроков по дням. Все три — с оговорками о данных,
 * иначе цифры врут тихо.
 */
async function renderAdminFunnel(box: HTMLElement, days: number): Promise<void> {
  // Один контейнер на все нажатия: два нажатия подряд показали бы два
  // отчёта, и какой из них свежий, пришлось бы угадывать
  const outId = 'admin-funnel-out';
  let out = document.getElementById(outId) as HTMLDivElement | null;
  if (!out) {
    out = document.createElement('div');
    out.id = outId;
    out.style.width = '100%';
    box.append(out);
  }
  out.innerHTML = `<div class="quest-j-desc">${t('admin.funnel_loading')}</div>`;
  try {
    const rep = await api.adminFunnel(days);

    // ── Воронка ──
    const lines: string[] = [
      t('admin.funnel_window').replace('{from}', rep.funnel.from).replace('{to}', rep.funnel.to),
    ];
    for (const step of rep.funnel.steps) {
      lines.push(
        t('admin.funnel_step')
          .replace('{title}', step.titleRu)
          .replace('{users}', String(step.users))
          .replace('{prev}', shareText(step.fromPrevious))
          .replace('{start}', shareText(step.fromStart)),
      );
    }
    if (rep.funnel.steps.every(s => s.users === 0)) {
      lines.push(t('admin.funnel_no_players'));
    }

    // ── Удержание ──
    const r = rep.retention;
    lines.push('');
    lines.push(t('admin.funnel_retention_title'));
    lines.push(
      t('admin.funnel_retention_totals')
        .replace('{users}', String(r.totals.users))
        .replace('{d1}', shareText(r.totals.d1))
        .replace('{d7}', shareText(r.totals.d7))
        .replace('{d30}', shareText(r.totals.d30)),
    );
    if (r.incompleteCohorts > 0) {
      lines.push(t('admin.funnel_retention_incomplete').replace('{count}', String(r.incompleteCohorts)));
    }
    // Когорты показываем новые сверху: свежая когорта отвечает на вопрос
    // «что сейчас происходит», а не «что было месяц назад»
    const recent = [...r.cohorts].reverse().slice(0, 10);
    for (const c of recent) {
      lines.push(
        t('admin.funnel_cohort')
          .replace('{day}', c.day)
          .replace('{users}', String(c.users))
          .replace('{d1}', shareText(c.d1))
          .replace('{d7}', shareText(c.d7))
          .replace('{d30}', shareText(c.d30))
          + (c.full ? '' : ' ' + t('admin.funnel_cohort_partial')),
      );
    }

    // ── Активные по дням ──
    lines.push('');
    lines.push(t('admin.funnel_active_title'));
    const peak = Math.max(1, ...rep.active.map(a => Math.max(a.logins, a.sessions)));
    const bars: string[] = [];
    for (const a of rep.active.slice(-14)) {
      const h = Math.round((Math.max(a.logins, a.sessions) / peak) * 26);
      bars.push(`${a.day.slice(5)}: ${t('admin.funnel_active_row').replace('{logins}', String(a.logins)).replace('{sessions}', String(a.sessions))} ${'▇'.repeat(Math.max(1, h))}`);
    }
    lines.push(...bars);

    // ── Честность данных ──
    // Самое важное в разделе. Событие, которое никто не писал, даёт ноль
    // в воронке, и этот ноль без даты выглядит как «игроки застревают».
    const missing = Object.entries(rep.eventSince).filter(([, since]) => !since).map(([ev]) => ev);
    if (missing.length) {
      lines.push('');
      lines.push(t('admin.funnel_data_missing').replace('{events}', missing.join(', ')));
    }
    lines.push(t('admin.funnel_data_since').replace('{day}', rep.sessionStartSince));

    out.innerHTML = lines.map(l => (l === '' ? '<div style="height:6px"></div>' : `<div class="quest-j-desc">${l}</div>`)).join('');
  } catch (err) {
    out.innerHTML = `<div class="lb-empty">${t('admin.funnel_failed')}</div>`;
    console.warn('[admin] funnel report failed', err);
  }
}

export async function loadAdmin(): Promise<void> {
  const box = $('admin-list');
  if (!box) return;
  box.innerHTML = '';
  if (!session.isAdmin) {
    box.innerHTML = `<div class="inv-empty">${t('admin.no_access')}</div>`;
    return;
  }

  // ── Воронка и удержание ──
  // Первым разделом: это ответ на вопрос «что происходит с игрой», и он
  // не должен прятаться под поиском игроков и наказаниями
  adminSub(box, t('admin.funnel_title'));
  const funnelRow = rowEl('inv-item');
  let funnelDays = 30;
  const funnelBtn = actionButton(t('admin.funnel_show'), async () => {
    await renderAdminFunnel(box, funnelDays);
  });
  const winRow = rowEl('inv-item');
  for (const w of [7, 30, 90]) {
    winRow.append(actionButton(`${w} ${t('admin.funnel_days')}`, async () => {
      funnelDays = w;
      await renderAdminFunnel(box, funnelDays);
    }));
  }
  funnelRow.append(funnelBtn);
  box.append(funnelRow, winRow);

  // ── Поиск игрока ──
  adminSub(box, t('admin.players_sub').replace('{role}', String(session.isAdminRole)));
  const searchRow = rowEl('inv-item');
  const q = adminInput(t('admin.search_field'), '150px');
  const results = document.createElement('div');
  results.style.width = '100%';
  searchRow.append(q);
  searchRow.append(actionButton(t('admin.search_btn'), async () => {
    const { results: list } = await api.adminSearch(q.value.trim());
    results.innerHTML = '';
    if (!list.length) {
      results.textContent = t('admin.nothing_found');
      return;
    }
    for (const p of list) {
      const row = rowEl('inv-item');
      const label = document.createElement('span');
      label.className = 'inv-name';
      label.textContent = t('admin.player_row').replace('{name}', p.name).replace('{lvl}', String(p.level)).replace('{region}', p.region).replace('{ban}', p.is_banned ? ' [BAN]' : '');
      row.append(label);
      row.append(actionButton(t('site.pets_select'), async () => {
        (document.getElementById('admin-target-char') as HTMLInputElement).value = p.id;
        (document.getElementById('admin-target-user') as HTMLInputElement).value = p.user_id;
        (document.getElementById('admin-target-name') as HTMLElement).textContent = t('admin.target_is').replace('{name}', p.name);
      }));
      results.append(row);
    }
  }));
  box.append(searchRow, results);

  // ── Цель и наказания ──
  adminSub(box, t('admin.punishments'));
  const targetName = document.createElement('div');
  targetName.id = 'admin-target-name';
  targetName.className = 'inv-name';
  targetName.textContent = t('admin.target_none');
  box.append(targetName);
  const charIdInput = adminInput('characterId', '150px');
  charIdInput.id = 'admin-target-char';
  const userIdInput = adminInput('userId', '150px');
  userIdInput.id = 'admin-target-user';
  box.append(charIdInput, userIdInput);

  const muteRow = rowEl('inv-item');
  const muteMin = adminInput(t('admin.minutes'), '70px', 'number');
  muteMin.value = '30';
  const muteReason = adminInput(t('admin.mute_reason'), '150px');
  muteRow.append(muteMin, muteReason);
  muteRow.append(actionButton(t('admin.act_mute'), async () => {
    const cid2 = (document.getElementById('admin-target-char') as HTMLInputElement).value.trim();
    if (!cid2 || !muteReason.value.trim()) { toast(t('admin.need_target_reason'), 'error'); return; }
    await api.adminMute(cid2, Number(muteMin.value) || 30, muteReason.value.trim());
    toast(t('admin.mute_done'), 'success');
  }));
  box.append(muteRow);

  const banRow = rowEl('inv-item');
  const banReason = adminInput(t('admin.ban_reason'), '150px');
  const banDays = adminInput(t('admin.days'), '60px', 'number');
  banDays.value = '7';
  banRow.append(banReason, banDays);
  banRow.append(actionButton(t('admin.act_ban'), async () => {
    const uid = (document.getElementById('admin-target-user') as HTMLInputElement).value.trim();
    if (!uid || !banReason.value.trim()) { toast(t('admin.need_target_reason'), 'error'); return; }
    await api.adminBan(uid, banReason.value.trim(), Number(banDays.value) || 7);
    toast(t('admin.ban_done'), 'success');
  }));
  banRow.append(actionButton(t('admin.unban'), async () => {
    const uid = (document.getElementById('admin-target-user') as HTMLInputElement).value.trim();
    if (!uid) { toast(t('admin.need_target'), 'error'); return; }
    await api.adminUnban(uid);
    toast(t('admin.unbanned'), 'success');
  }));
  box.append(banRow);

  // ── Телепорт и золото ──
  adminSub(box, t('admin.tp_gold'));
  const tpRow = rowEl('inv-item');
  const tpX = adminInput('X', '60px', 'number');
  const tpZ = adminInput('Z', '60px', 'number');
  const tpRegion = adminInput(t('chars.region'), '90px');
  tpRegion.value = 'tabriz';
  tpRow.append(tpX, tpZ, tpRegion);
  tpRow.append(actionButton(t('admin.teleport'), async () => {
    const cid2 = (document.getElementById('admin-target-char') as HTMLInputElement).value.trim();
    if (!cid2) { toast(t('admin.need_target'), 'error'); return; }
    await api.adminTeleport(cid2, { x: Number(tpX.value) || 0, y: 0, z: Number(tpZ.value) || 0 }, tpRegion.value.trim() || 'tabriz');
    toast(t('admin.teleported'), 'success');
  }));
  box.append(tpRow);

  const goldRow = rowEl('inv-item');
  const goldAmt = adminInput(t('common.amount'), '90px', 'number');
  goldRow.append(goldAmt);
  goldRow.append(actionButton(t('admin.give_gold'), async () => {
    const cid2 = (document.getElementById('admin-target-char') as HTMLInputElement).value.trim();
    if (!cid2 || !Number(goldAmt.value)) { toast(t('admin.need_target_amount'), 'error'); return; }
    await api.adminGiveGold(cid2, Number(goldAmt.value));
    toast(t('admin.gold_given'), 'success');
  }));
  box.append(goldRow);

  // ── Погода: переключение вручную ──
  // Раньше погода менялась только сама, по расписанию раз в 4 минуты:
  // чтобы увидеть грозу или снег, надо было ждать нужный слот.
  adminSub(box, t('admin.weather'));
  const weatherRow = rowEl('inv-item');
  for (const kind of ['clear', 'cloudy', 'rain', 'storm', 'fog', 'sandstorm', 'snow', 'wind']) {
    const label = t(`admin.weather_${kind}`);
    weatherRow.append(actionButton(label, async () => {
      await api.adminWeather(kind);
      toast(`${t('admin.weather')}: ${label}`, 'success');
    }));
  }
  weatherRow.append(actionButton(t('admin.weather_auto'), async () => {
    await api.adminWeather('auto');
    toast(t('admin.weather_auto_done'), 'success');
  }));
  box.append(weatherRow);

  if (!isSenior()) return;

  // ── Деньги (senior+) ──
  adminSub(box, t('admin.currency'));
  const grantRow = rowEl('inv-item');
  const curSel = document.createElement('select');
  curSel.className = 'inv-action';
  for (const cur of ['azens', 'gold', 'isfahan_silver', 'syrian_gold']) {
    const o = document.createElement('option');
    o.value = cur;
    o.textContent = cur;
    curSel.append(o);
  }
  const grantAmt = adminInput(t('common.amount'), '80px', 'number');
  const grantReason = adminInput(t('admin.reason_required'), '170px');
  grantRow.append(curSel, grantAmt, grantReason);
  grantRow.append(actionButton(t('admin.grant_btn'), async () => {
    const cid2 = (document.getElementById('admin-target-char') as HTMLInputElement).value.trim();
    if (!cid2 || !Number(grantAmt.value) || grantReason.value.trim().length < 5) {
      toast(t('admin.grant_hint'), 'error');
      return;
    }
    const res = await api.adminGrantCurrency(cid2, curSel.value, Number(grantAmt.value), grantReason.value.trim());
    toast(t('admin.granted').replace('{balance}', String(res.balance)), 'success');
  }));
  box.append(grantRow);

  const refundRow = rowEl('inv-item');
  const refundPay = adminInput('paymentId', '170px');
  const refundReason = adminInput(t('admin.reason_required'), '170px');
  refundRow.append(refundPay, refundReason);
  refundRow.append(actionButton(t('admin.refund'), async () => {
    if (!refundPay.value.trim() || refundReason.value.trim().length < 5) {
      toast(t('admin.refund_hint'), 'error');
      return;
    }
    await api.adminRefund(refundPay.value.trim(), refundReason.value.trim());
    toast(t('admin.refund_done'), 'success');
  }));
  box.append(refundRow);

  const finRow = rowEl('inv-item');
  const finOut = document.createElement('div');
  finOut.style.width = '100%';
  finRow.append(actionButton(t('admin.finance_summary'), async () => {
    const s = await api.adminFinance();
    const lines = [
      t('admin.finance_circulating').replace('{azens}', String(s.circulating.azens)).replace('{gold}', String(s.circulating.gold)).replace('{silver}', String(s.circulating.silver)).replace('{syrian}', String(s.circulating.syrian)).replace('{debtors}', String(s.circulating.debtors)),
      ...s.byStatus.map(b => t('admin.finance_payments').replace('{status}', b.status).replace('{count}', String(b.count)).replace('{minted}', String(b.minted)).replace('{bonus}', String(b.bonus))),
      t('admin.finance_promo').replace('{azens}', String(s.promoGranted.azens)).replace('{redemptions}', String(s.promoGranted.redemptions)),
      ...s.grants.map(g => t('admin.finance_grants').replace('{currency}', g.currency).replace('{count}', String(g.count)).replace('{total}', String(g.total))),
      s.velocity.length ? t('admin.velocity_active').replace('{list}', s.velocity.map(v => `${v.user_id.slice(0, 8)} (${v.completed_24h})`).join(', ')) : t('admin.velocity_none'),
    ];
    finOut.innerHTML = lines.map(l => `<div class="quest-j-desc">• ${l}</div>`).join('');
  }));
  finRow.append(finOut);
  box.append(finRow);

  // ── Промокоды (senior+) ──
  adminSub(box, t('admin.promo_title'));
  const promoRow = rowEl('inv-item');
  const promoCode = adminInput(t('admin.code'), '90px');
  const promoAzens = adminInput('AZENS', '60px', 'number');
  const promoSilver = adminInput(t('admin.silver'), '70px', 'number');
  const promoMax = adminInput(t('admin.limit'), '60px', 'number');
  promoMax.value = '100';
  promoRow.append(promoCode, promoAzens, promoSilver, promoMax);
  promoRow.append(actionButton(t('admin.create'), async () => {
    if (!promoCode.value.trim()) { toast(t('admin.enter_code'), 'error'); return; }
    await api.adminPromoCreate({
      code: promoCode.value.trim(),
      azens: Number(promoAzens.value) || 0,
      silver: Number(promoSilver.value) || 0,
      maxUses: Number(promoMax.value) || 100,
    });
    toast(t('admin.promo_created'), 'success');
    await loadAdmin();
  }));
  box.append(promoRow);

  const promoListRow = rowEl('inv-item');
  const promoOut = document.createElement('div');
  promoOut.style.width = '100%';
  promoListRow.append(actionButton(t('admin.promo_list'), async () => {
    const { promos } = await api.adminPromos();
    promoOut.innerHTML = promos.length
      ? promos.slice(0, 20).map(p => `<div class="quest-j-desc">${t('admin.promo_row').replace('{code}', p.code).replace('{azens}', String(p.azens)).replace('{used}', String(p.usedCount)).replace('{max}', String(p.maxUses))}</div>`).join('')
      : `<div class="quest-j-desc">${t('admin.promo_none')}</div>`;
  }));
  promoListRow.append(promoOut);
  box.append(promoListRow);
}

// ── Панель персонажа (F): статы + слоты экипировки ──────────
// Слоты в HTML (голова/грудь/…) шире, чем серверная модель (weapon/armor/
// accessory) — наполняем те, что реально поддерживаются, остальные показываем
// как пустые. Статы берём из session.character + бонусы снаряжения.
const EQUIP_SLOT_TARGETS: Record<string, string> = {
  weapon: 'eq-weapon',
  armor: 'eq-chest',
  accessory: 'eq-amulet',
};

const ATTR_KEYS: { key: keyof Character['stats']; i18n: string }[] = [
  { key: 'strength', i18n: 'panels.char_strength' },
  { key: 'agility', i18n: 'panels.char_agility' },
  { key: 'intelligence', i18n: 'panels.char_intelligence' },
  { key: 'endurance', i18n: 'panels.char_endurance' },
  { key: 'charisma', i18n: 'panels.char_charisma' },
];

function statRow(label: string, value: string, extra?: string): string {
  return `<div class="stat-row"><span>${label}</span><b>${value}${extra ?? ''}</b></div>`;
}

export async function loadCharacterPanel(): Promise<void> {
  const box = document.getElementById('char-stats');
  const ch = session.character;
  if (!box || !ch) return;

  let eq: EquipmentState | null = null;
  try { eq = await api.equipment(ch.id); } catch { eq = null; }
  const bonus = eq?.stats ?? {};
  const bySlot = new Map((eq?.items ?? []).map((i) => [i.slot, i]));

  // ── Слоты: название предмета вместо подписи, цвет по редкости ──
  for (const [slot, elId] of Object.entries(EQUIP_SLOT_TARGETS)) {
    const el = document.getElementById(elId);
    const label = el?.querySelector<HTMLElement>('.equip-label');
    if (!el || !label) continue;
    if (!el.dataset.emptyLabel) el.dataset.emptyLabel = label.textContent ?? '';
    const item = bySlot.get(slot);
    if (item) {
      label.textContent = item.enhancement > 0 ? `${item.nameRu} +${item.enhancement}` : item.nameRu;
      label.style.color = RARITY_COLORS[item.rarity] ?? 'inherit';
      el.classList.add('equipped');
    } else {
      label.textContent = el.dataset.emptyLabel;
      label.style.color = '';
      el.classList.remove('equipped');
    }
  }

  const expNext = expForLevel(ch.level + 1);
  const pct = expNext > 0 ? Math.min(100, Math.round((ch.experience / expNext) * 100)) : 0;

  const attrs = ATTR_KEYS.map(({ key, i18n }) => {
    const base = ch.stats?.[key] ?? 0;
    const b = bonus[key] ?? 0;
    return statRow(t(i18n), String(base), b > 0 ? ` <i class="stat-bonus">+${b}</i>` : '');
  }).join('');

  box.innerHTML =
    `<div class="stat-row"><span>${t('panels.char_class')}</span><b>${t(`classes.${ch.class}`)}</b></div>` +
    statRow(t('panels.char_level'), String(ch.level)) +
    statRow(t('panels.char_exp'), `${ch.experience} / ${expNext} · ${pct}%`) +
    statRow(t('panels.char_hp'), `${Math.round(ch.hp)} / ${ch.maxHp}`) +
    statRow(t('panels.char_mp'), `${Math.round(ch.mana)} / ${ch.maxMana}`) +
    statRow(t('panels.char_stamina'), `${Math.round(ch.stamina)} / ${ch.maxStamina}`) +
    `<div class="stat-divider"></div>` +
    `<div class="stat-caption">${t('panels.char_attributes')}</div>` + attrs +
    `<div class="stat-divider"></div>` +
    stancePickerHtml() +
    `<div class="stat-divider"></div>` +
    `<div class="stat-caption">${t('panels.char_currency')}</div>` +
    statRow(t('panels.char_gold'), `${ch.gold}`) +
    statRow(t('panels.char_azens'), `${ch.azens ?? 0}`) +
    (ch.isfahanSilver ? statRow(t('panels.char_silver'), `${ch.isfahanSilver}`) : '') +
    (ch.syrianGold ? statRow(t('panels.char_syrian'), `${ch.syrianGold}`) : '') +
    stanceSwitchScript();
}

/**
 * Переключатель боевой стойки в панели персонажа.
 *
 * Показывает все стойки, включая недоступные, но недоступные — приглушены и
 * подписаны. Скрывать их нельзя: игрок должен видеть, что такой стиль есть и
 * что для него нужен скакун, иначе «конная стрельба» выглядит как
 * несуществующая.
 */
function stancePickerHtml(): string {
  const active = getStance();
  const mounted = (session.mount?.speed ?? 0) > 0;
  const rows = STANCE_ORDER.map((s) => {
    const info = STANCES[s];
    const locked = info.requiresMount && !mounted;
    const on = s === active;
    return (
      `<button class="stance-row${on ? ' on' : ''}${locked ? ' locked' : ''}" data-stance="${s}"${locked ? ' disabled' : ''}>` +
      `<span class="stance-name">${t(`world.stance_${s}`)}</span>` +
      `<span class="stance-hint">${t(`world.stance_${s}_hint`)}</span>` +
      '</button>'
    );
  }).join('');
  return (
    `<div class="stat-caption">${t('world.stance_title')}</div>` +
    `<div class="stance-list">${rows}</div>`
  );
}

/** Навешивание обработчиков на стойки. Скриптом, чтобы панель перерисовывалась. */
function stanceSwitchScript(): string {
  return (
    '<script>(function(){' +
    'var box=document.querySelector(".stance-list");if(!box)return;' +
    'box.addEventListener("click",function(e){' +
    'var b=e.target.closest("[data-stance]");if(!b||b.disabled)return;' +
    'if(window.requestStance)window.requestStance(b.getAttribute("data-stance"));' +
    '});})();</script>'
  );
}

/** Порог опыта для следующего уровня (приблизительная кривая) */
function expForLevel(level: number): number {
  return Math.round(100 * Math.pow(level, 1.6));
}

// ── Рыбалка ─────────────────────────────────────────────────

/** Состояние рыбалки клиента: таймер поклёвки и поплавок */
let fishCast: { castId: string; biteAt: number; waitTotalMs: number } | null = null;
let fishClockOffset = 0;   // серверное время минус клиентское
let fishTimer: number | null = null;
let fishBiteShown = false;

/** Смещение часов: иначе таймер поклёвки врал бы на минуты */
export function syncFishingClock(serverTime: number): void {
  fishClockOffset = serverTime - Date.now();
}

export function fishingCastId(): string | null {
  return fishCast?.castId ?? null;
}

function stopFishingTimer(): void {
  if (fishTimer !== null) { clearInterval(fishTimer); fishTimer = null; }
}

/**
 * Забросить удочку. Позицию берём у мира, а не у курсора: клиент мог бы
 * «забросить» в озеро из другого конца карты. Сервер всё равно проверит.
 */
export async function fishingCastLine(): Promise<void> {
  if (!session.character) return;
  // Живая позиция, а не session.character.position: та приходит с сервера
  // раз в несколько секунд, и удочка улетела бы не туда
  const position = session.selfPos;
  if (!position) { toast(t('panels.fishing_err_no_pos'), 'error'); return; }
  try {
    const res = await api.fishingCast(session.character.id, { x: position.x, z: position.z });
    fishCast = res.cast;
    syncFishingClock(res.serverTime);
    fishBiteShown = false;
    paintFishing();
    toast(t('panels.fishing_cast'), 'info');
  } catch (e) {
    const code = String((e as { code?: string })?.code ?? '');
    const map: Record<string, string> = {
      fishing_not_near_water: 'panels.fishing_err_no_water',
      fishing_need_boat: 'panels.fishing_err_need_boat',
      fishing_already_cast: 'panels.fishing_err_busy',
      fishing_boat_tired: 'panels.fishing_err_boat_tired',
    };
    toast(t(map[code] ?? 'panels.fishing_err_other'), 'error');
  }
}

/** Подсечь. Задержку считает сервер — клиент присылает только факт */
export async function fishingReel(): Promise<void> {
  if (!session.character || !fishCast) return;
  try {
    const res = await api.fishingReel(session.character.id, fishCast.castId);
    if (res.messageRu) toast(res.messageRu, 'success');
    if (res.gold && session.character) {
      session.character.gold += res.gold;
      refreshBars();
    }
    fishCast = null;
    stopFishingTimer();
    await loadFishing();
  } catch (e) {
    const code = String((e as { code?: string })?.code ?? '');
    if (code.includes('too_early')) toast(t('panels.fishing_err_early'), 'error');
    else if (code.includes('too_late')) toast(t('panels.fishing_err_late'), 'error');
    else if (code.includes('empty_hook')) toast(t('panels.fishing_err_empty'), 'error');
    else toast(t('panels.fishing_err_other'), 'error');
    fishCast = null;
    stopFishingTimer();
    paintFishing();
  }
}

/** Перерисовать блок рыбалки: поплавок, кнопки, усталость лодки */
export function paintFishing(): void {
  const box = $('fishing-content');
  if (!box) return;

  const status = $('fishing-status');
  const reelBtn = $('fishing-reel') as HTMLButtonElement | null;
  const castBtn = $('fishing-cast') as HTMLButtonElement | null;
  const cancelBtn = $('fishing-cancel') as HTMLButtonElement | null;
  const phase = $('fishing-phase');
  if (!status || !reelBtn || !castBtn || !phase) return;

  if (!fishCast) {
    status.textContent = t('panels.fishing_ready');
    phase.textContent = '';
    phase.className = 'fishing-float';
    reelBtn.classList.add('hidden');
    castBtn.classList.remove('hidden');
    cancelBtn?.classList.add('hidden');
    stopFishingTimer();
    return;
  }

  castBtn.classList.add('hidden');
  reelBtn.classList.remove('hidden');
  cancelBtn?.classList.remove('hidden');

  const tick = () => {
    const left = fishCast!.biteAt - (Date.now() + fishClockOffset);
    if (left > 0) {
      status.textContent = `${t('panels.fishing_wait')} ${Math.ceil(left / 1000)}`;
      phase.textContent = '';
      phase.className = 'fishing-float';
      if (fishBiteShown) {
        // Таймер сработал раньше реального клёва (расхождение часов) —
        // возвращаем ожидание, чтобы не подсечь в пустоту
        fishBiteShown = false;
      }
      return;
    }
    // Клюнуло: поплавок уходит под воду, кнопка подсечки мигает
    if (!fishBiteShown) {
      fishBiteShown = true;
      status.textContent = t('panels.fishing_bite');
    }
    phase.textContent = '↓';
    phase.className = 'fishing-float bite';
  };
  tick();
  stopFishingTimer();
  fishTimer = window.setInterval(tick, 250);
}

/**
 * Гараж лодок: список купленных и кнопка «встать на воду».
 * Без этого лодку было негде активировать — только через API.
 */
async function renderBoatGarage(): Promise<HTMLElement> {
  const wrap = document.createElement('div');
  const head = document.createElement('div');
  head.className = 'panel-subhead';
  head.textContent = t('panels.fishing_garage');
  wrap.append(head);

  if (!session.character) return wrap;
  let owned: { boatId: string; isActive: boolean; fatigue: number }[] = [];
  let catalog: Record<string, { id: string; nameRu: string; waterSpeed: number; fishingBonus: number; price: number; minLevel: number; descriptionRu: string }> = {};
  try {
    const res = await api.boats(session.character.id);
    owned = res.boats;
    catalog = res.catalog;
  } catch {
    const err = document.createElement('div');
    err.className = 'inv-empty';
    err.textContent = '—';
    wrap.append(err);
    return wrap;
  }

  if (!owned.length) {
    const none = document.createElement('div');
    none.className = 'inv-empty';
    none.textContent = t('panels.fishing_no_boats');
    wrap.append(none);
    return wrap;
  }

  for (const b of owned) {
    const def = catalog[b.boatId];
    if (!def) continue;
    const row = rowEl('inv-item');
    const label = document.createElement('span');
    label.className = 'inv-name';
    label.textContent = def.nameRu;
    label.title = def.descriptionRu;
    row.append(label);
    row.append(actionButton(t('panels.fishing_board'), async () => {
      try {
        await api.boatActivate(session.character!.id, b.boatId, {
          x: session.selfPos.x, z: session.selfPos.z,
        });
        toast(t('panels.fishing_boarded'), 'success');
      } catch {
        toast(t('panels.fishing_err_no_water'), 'error');
      }
      await loadFishing();
    }));
    wrap.append(row);
  }
  return wrap;
}

/** Панель «Рыбалка»: лодка, заброс, улов */
export async function loadFishing(): Promise<void> {
  if (!session.character) return;
  const box = $('fishing-content');
  if (!box) return;
  try {
    const { cast, boat, boatFatigue, fish, serverTime } = await api.fishingState(session.character.id);
    session.boat = boat
      ? {
          id: (boat as { id?: string }).id ?? 'boat',
          nameRu: boat.nameRu,
          waterSpeed: (boat as { waterSpeed?: number }).waterSpeed ?? 0.8,
          swimSpeed: (boat as { swimSpeed?: number }).swimSpeed ?? 5,
          fishingBonus: (boat as { fishingBonus?: number }).fishingBonus ?? 1,
          catchLimit: boat.catchLimit,
        }
      : null;
    syncFishingClock(serverTime);
    fishBiteShown = false;
    if (cast) {
      fishCast = { castId: cast.castId, biteAt: cast.biteAt, waitTotalMs: cast.waitTotalMs };
    } else {
      fishCast = null;
    }
    box.innerHTML = '';

    // ── Лодка ──
    if (boat) {
      const used = Math.min(boatFatigue, boat.catchLimit);
      const boatRow = rowEl('inv-item');
      const name = document.createElement('span');
      name.className = 'inv-name';
      name.textContent = `${t('panels.fishing_boat')}: ${boat.nameRu}`;
      boatRow.append(name);
      boatRow.append(actionButton(t('panels.fishing_land'), async () => {
        await api.boatDeactivate(session.character!.id);
        await loadFishing();
      }));
      box.append(boatRow);

      const bar = document.createElement('div');
      bar.className = 'fishing-bar';
      if (used >= boat.catchLimit) bar.classList.add('fat');
      const fill = document.createElement('i');
      fill.style.width = `${(used / boat.catchLimit) * 100}%`;
      bar.append(fill);
      const barRow = rowEl('inv-item');
      const cap = document.createElement('span');
      cap.className = 'inv-qty';
      cap.textContent = `${t('panels.fishing_tired')}: ${used}/${boat.catchLimit}`;
      barRow.append(bar, cap);
      box.append(barRow);
    } else {
      // Лодки в гараже: можно встать на воду, чтобы ловить глубже
      box.append(await renderBoatGarage());
    }

    // ── Заброс и подсечка ──
    const actRow = rowEl('inv-item fishing-actions');
    const status = document.createElement('span');
    status.className = 'inv-name';
    status.id = 'fishing-status';
    const phase = document.createElement('span');
    phase.className = 'fishing-float';
    phase.id = 'fishing-phase';

    const castBtn = actionButton(t('panels.fishing_cast_btn'), fishingCastLine) as HTMLButtonElement;
    castBtn.id = 'fishing-cast';
    const reelBtn = actionButton(t('panels.fishing_reel_btn'), fishingReel) as HTMLButtonElement;
    reelBtn.id = 'fishing-reel';

    const cancelBtn = actionButton(t('panels.fishing_cancel'), async () => {
      if (fishCast) await api.fishingCancel(session.character!.id, fishCast.castId);
      fishCast = null;
      await loadFishing();
    });
    cancelBtn.id = 'fishing-cancel';
    cancelBtn.classList.add('hidden');

    actRow.append(status, phase, castBtn, reelBtn, cancelBtn);
    box.append(actRow);

    // ── Что здесь ловится ──
    const listHead = document.createElement('div');
    listHead.className = 'panel-subhead';
    listHead.textContent = t('panels.fishing_catchable');
    box.append(listHead);

    const level = session.character.level;
    for (const f of fish) {
      if (f.minLevel > level) continue;
      const row = rowEl('inv-item');
      const name = document.createElement('span');
      name.className = `inv-name fish-${f.rarity}`;
      name.textContent = `${f.nameRu} · ${f.weightKg < 1 ? Math.round(f.weightKg * 1000) + t('common.grams') : f.weightKg + t('common.kg')}`;
      if (f.deepOnly) {
        const tag = document.createElement('small');
        tag.className = 'fish-tag';
        tag.textContent = t('panels.fishing_deep_only');
        name.append(tag);
      }
      row.append(name);
      box.append(row);
    }
  } catch {
    box.innerHTML = `<div class="inv-empty">—</div>`;
  } finally {
    paintFishing();
  }
}

const LOADERS: Record<string, () => Promise<void>> = {
  // Хаб панелей. Содержимое он собирает сам, но id должен быть в диспетчере:
  // иначе панель откроется пустой
  'panel-hub': async () => { const { loadHub } = await import('./hub'); loadHub(); },
  // Панели уведомлений не было: сервер писал строки в таблицу notifications,
  // а прочитать их было нечем. Тост исчезал за пару секунд
  'panel-notifications': loadNotifications,
  // Зал славы. Панели не было: история побед над боссами писалась в базу,
  // и смотреть на неё было некому
  'panel-hall-of-fame': loadHallOfFame,
  // Почтовый ящик. Панели не было: награды, не поместившиеся в сумку,
  // просто пропадали
  'panel-mail': loadMail,
  'panel-character': loadCharacterPanel,
  'panel-dungeons': loadDungeons,
  'panel-shop': loadShop,
  'panel-craft': loadCraft,
  'panel-auction': loadAuction,
  'panel-party': loadParty,
  'panel-trade': loadTrade,
  'panel-mount-stable': loadMounts,
  'panel-fishing': loadFishing,
  'panel-leaderboard': loadLeaderboard,
  'panel-friends': loadFriends,
  'panel-chess': loadChess,
  'panel-poetry': loadPoetry,
  'panel-chronicles': loadChronicles,
  'panel-referral': loadReferral,
  'panel-story': loadStory,
  'panel-guild': loadGuild,
  'panel-achievements': loadAchievements,
  'panel-tasks': loadTasks,
  'panel-pets': loadPets,
  'panel-house': loadHouse,
  'panel-pvp': loadPvP,
  'panel-tower': loadTower,
  'panel-reputation': loadReputation,
  'panel-admin': loadAdmin,
  'panel-media': loadMediaPanel,
  'panel-skills': loadSkills,
  'panel-settings': loadSettings,
};

/** Загрузить содержимое панели при открытии (для новых панелей) */
export function loadPanelContent(panelId: string | undefined): void {
  const loader = panelId ? LOADERS[panelId] : undefined;
  if (loader) void loader();
}

// ── Панель навыков и профессий ──────────────────────────────

/**
 * Полоса опыта.
 *
 * Ширина считается по порогу, который присылает сервер, а не «на глаз».
 * Заглушка на месте опыта выглядела бы как работающая шкала и молчала бы
 * о том, сколько осталось до уровня.
 */
function xpBar(xp: number, level: number, needed?: number): string {
  // Порог берётся из ответа сервера, если он есть. Формула здесь повторяет
  // серверную намеренно: без неё полоса была бы врёт при любом изменении
  // правил, а молчала бы ровно тогда, когда игрок смотрит на неё чаще всего.
  const need = needed ?? (100 + (Math.max(1, level) - 1) * 50);
  const pct = need > 0 ? Math.min(100, Math.max(0, Math.round((xp / need) * 100))) : 0;
  return `<div class="xp-bar" title="${xp} / ${need}"><i style="width:${pct}%"></i></div>`
    + `<div class="xp-text">${xp} / ${need} ${t('skills.xp_short')}</div>`;
}

export async function loadSkills(): Promise<void> {
  const charId = session.character?.id;
  if (!charId) return;
  const profBox = $('skills-profession');
  const skillsBox = $('skills-list');
  const availBox = $('skills-available');
  if (!profBox || !skillsBox || !availBox) return;

  // Профессия
  try {
    const { profession } = await api.getProfession(charId);
    profBox.innerHTML = profession
      // Полоса опыта у профессии. Раньше стояло только «уровень 3 (240 XP)»:
      // игрок видел число, но не знал, сколько нужно до следующего уровня,
      // и не мог понять, растёт оно вообще или нет.
      ? `<div class="inv-item"><b>${profession.nameRu}</b> — ${t('badges.level')}${profession.level}</div>`
        + xpBar(profession.xp, profession.level)
      : `<div class="inv-item" style="color:var(--cream-dim)">${t('skills.prof_none')}</div>
         <div style="margin-top:8px;display:flex;flex-direction:column;gap:6px">
           ${['warrior','archer','merchant','herbalist','blacksmith','dervish','explorer'].map(id => `
             <button class="inv-action" data-prof="${id}">📜 ${t('prof.' + id)} — ${t('skills.free')}</button>
           `).join('')}
         </div>`;
    profBox.querySelectorAll('[data-prof]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          const res = await api.unlockProfession(charId, (btn as HTMLButtonElement).dataset.prof!);
          toast(t('skills.prof_unlocked').replace('{name}', res.profession.nameRu), 'success');
          void loadSkills();
        } catch (e) { toast((e as Error).message, 'error'); }
      });
    });
  } catch { /* ignore */ }

  // Навыки
  try {
    const { skills } = await api.getSkills(charId);
    const profId = skills[0]?.professionId;
    if (skills.length) {
      // Прогресс каждого навыка запрашивается отдельно: в списке сервер
      // отдаёт уровень, но не порог следующего, а без порога полоса была бы
      // выдуманной. Отказ по одному навыку не роняет весь список.
      const bars = await Promise.all(skills.map(async (s) => {
        try {
          const { progress } = await api.skillProgress(charId, s.id);
          return xpBar(progress.xp, progress.level, progress.needed);
        } catch {
          return '';
        }
      }));
      // Пассивный навык помечен, и кнопки «включить» не получает: такая
      // кнопка обещала бы действие, которого у пассива нет.
      const skillRows = (s: { id: string; nameRu: string; level: number; manaCost: number; staminaCost: number; active?: unknown }, bar: string): string => {
        const translated = t(`skills.skill_${s.id}`);
        const name = translated && translated !== `skills.skill_${s.id}` ? translated : s.nameRu;
        const active = !!s.active;
        return `<div class="inv-item"><b>${name}</b> — ${t('badges.level')}${s.level} ⚡${s.manaCost} 🏃${s.staminaCost}`
          + (active ? ` <button class="inv-action" data-activate="${s.id}">${t('skills.skill_activate')}</button>`
                    : ` <i class="tag">${t('skills.skill_passive_badge')}</i>`)
          + `${bar}</div>`;
      };
      skillsBox.innerHTML = skills.map((s, i) => skillRows(s, bars[i] ?? '')).join('');

      // Включение активных навыков: Зикр, Тадж. Ответ сервера приходит
      // сюда же, и панель перерисовывается - игрок видит, что навык работает,
      // и сразу получает свою долю опыта.
      skillsBox.querySelectorAll('[data-activate]').forEach(btn => {
        btn.addEventListener('click', () => {
          // Через событие окна, а не напрямую в сокет: панель про сокет
          // ничего не знает. Так же сделан вызов навыков (game:skill).
          const id = (btn as HTMLButtonElement).dataset.activate;
          window.dispatchEvent(new CustomEvent('game:skill-activate', { detail: id }));
        });
      });
    } else {
      skillsBox.innerHTML = `<div class="inv-item" style="color:var(--cream-dim)">${t('skills.no_skills')}</div>`;
    }
    if (profId) {
      // Список берётся у сервера, а не с фильтром на клиенте.
      //
      // Почему так. Панель спрашивала /professions/:id/skills - список вообще
      // всех навыков профессии, без персонажа, и отсекала недоступные сама,
      // по закешированному уровню. Две беды: игрок, взявший уровень в бою,
      // не видел новый навык до перезагрузки, а расхождение с сервером
      // показало бы кнопку, которая не сработает. Свойство или отказ при
      // ошибке базы отдавали 0, и панель молча прятала всё.
      //
      // Теперь единственный источник правды - сервер, который и уровень
      // персонажа знает, и навык выдаёт по тому же правилу. Расхождение
      // между кнопкой и сервером невозможно по построению: кнопка рисуется
      // из ответа того же кода, который потом откажет.
      const { skills: available } = await api.getAvailableSkills(charId, profId);
      availBox.innerHTML = available.length
        ? available.map(s => `<div class="inv-item"><b>${s.nameRu}</b> — ${t('badges.level')}${s.level} <button class="inv-action" data-skill="${s.id}">${t('skills.study')}</button></div>`).join('')
        : '';
      availBox.querySelectorAll('[data-skill]').forEach(btn => {
        btn.addEventListener('click', async () => {
          try {
            await api.learnSkill(charId, (btn as HTMLButtonElement).dataset.skill!);
            toast(t('skills.learned'), 'success');
            void loadSkills();
          } catch (e) { toast((e as Error).message, 'error'); }
        });
      });
    }
  } catch { /* ignore */ }
}

// ── Панель настроек ─────────────────────────────────────────
export async function loadSettings(): Promise<void> {
  const oldPass = $('set-old-pass') as HTMLInputElement;
  const newPass = $('set-new-pass') as HTMLInputElement;
  const newPass2 = $('set-new-pass2') as HTMLInputElement;
  const newName = $('set-new-name') as HTMLInputElement;
  const statusEl = $('rename-status');

  // Форма, а не просто кнопка: Enter в поле пароля тоже отправляет —
  // это привычно игроку. Без preventDefault страница перезагрузилась бы.
  const doChangePass = async (): Promise<void> => {
    if (!oldPass.value || !newPass.value || newPass.value !== newPass2.value) {
      toast(t('settings.pwd_bad_fields'), 'error'); return;
    }
    try {
      await api.changePassword(oldPass.value, newPass.value);
      toast(t('settings.pwd_changed'), 'success');
      oldPass.value = ''; newPass.value = ''; newPass2.value = '';
    } catch (e) { toast((e as Error).message, 'error'); }
  };
  $('form-change-pass')?.addEventListener('submit', (e) => {
    e.preventDefault();
    void doChangePass();
  });
  $('btn-change-pass')?.addEventListener('click', (e) => {
    // Кнопка type="submit" — форма вызовет submit сама, гасим повтор
    e.preventDefault();
    void doChangePass();
  });

  $('btn-rename')?.addEventListener('click', async () => {
    if (!newName.value || newName.value.length < 2) {
      toast(t('chars.name_len'), 'error'); return;
    }
    try {
      const res = await api.renameCharacter(session.character!.id, newName.value);
      toast(t('chars.nick_changed').replace('{name}', res.character.name), 'success');
      newName.value = ''; statusEl.textContent = '';
      void refreshBars();
    } catch (e: any) {
      if (e.code === 'azens_debt' || e.message?.includes(t('common.azens_word'))) {
        statusEl.textContent = t('chars.need_azens').replace('{n}', String(session.character?.azens ?? 0));
        statusEl.style.color = '#e08080';
      } else {
        toast(e.message, 'error');
      }
    }
  });
}
