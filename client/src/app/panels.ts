// ============================================================
// Панели: данжи, магазин, крафт, аукцион, группа, караваны
// ============================================================
// Рендеры следуют стилю loadInventory (hud.ts): строки-карточки с
// кнопками-действиями; ошибки — тосты. Данные серверные, оптимизм
// не используется: после действия — перезагрузка панели.

import { api, EquipmentState } from './api';
import { t } from './i18n';
import { session, Character } from './state';
import { toast, refreshBars, loadInventory } from './hud';
import { onTutorialAction } from './tutorial';
import { RARITY_COLORS } from '../ui/icons';

// Простая словарь имен предметов для магазина (itemId -> русское название)
const SHOP_ITEM_NAMES: Record<string, string> = {
  'con_health_potion_s': 'Зелье здоровья (мал)',
  'con_stamina_food': 'Стяжающаяся еда',
  'mat_iron_ore': 'Железная руда',
  'wpn_iron_sword': 'Железный сабль',
  'arm_leather_vest': 'Кожаный жилет',
  'con_health_potion_m': 'Зелье здоровья (смол)',
  'con_mana_potion': 'Зелье маны',
  'mat_silk': 'Шёлк',
  'mat_saffron': 'Сафран',
  'con_exp_scroll': 'Свиток опыта',
  'wpn_qizilbash_saber': 'Сабль кызылбаша',
  'arm_silk_robe': 'Шёлковый халат исфахана',
  'mat_turquoise': 'Тофи',
  'mat_dragon_scale': 'Шампур дракона',
  'acc_silk_road_amulet': 'Амулет шёлкового пути',
  'mount_arabian_horse': 'Арабский скакун',
  'mount_bactrian_camel': 'Двугорбый верблюд',
  'mount_qizilbash_warhorse': 'Боевой конь Кызылбаша',
  'acc_boots_silk': 'Сапоги Шёлкового Пути',
  'acc_boots_seafarer': 'Сапоги Морехода',
  'acc_cloim_rain': 'Плащ Муссонного Дождя',
};

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
    wLabel.textContent = `AZENS: ${wallet.azens} · Золото: ${wallet.gold} · Серебро Исфахана: ${wallet.isfahanSilver} · Золото Сирии: ${wallet.syrianGold}`;
    w.append(wLabel);
    box.append(w);
    if (!wallet.hasToppedUp) {
      const fb = rowEl('inv-item dungeon-status');
      const fbLabel = document.createElement('span');
      fbLabel.className = 'inv-name';
      fbLabel.textContent = `Первая покупка: x${firstBonus?.multiplier ?? 2} AZENS (бонус до ${firstBonus?.maxBonus ?? 0})!`;
      fb.append(fbLabel);
      box.append(fb);
    }

    const statusRow = rowEl('inv-item dungeon-status');
    const statusLabel = document.createElement('span');
    statusLabel.className = 'inv-name';
    statusLabel.textContent = 'Пополнение: платёж не создан';
    statusRow.append(statusLabel);
    box.append(statusRow);

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
          const bonusTxt = st.bonus > 0 ? ` (бонус +${st.bonus})` : '';
          statusLabel.textContent = `Оплата подтверждена${bonusTxt}`;
          toast(`+${expected} AZENS${bonusTxt}`, 'success');
          await loadShop();
          return;
        }
        if (st.status === 'failed') {
          statusLabel.textContent = 'Платёж отклонён провайдером';
          toast('Платёж отклонён', 'error');
          return;
        }
      }
      statusLabel.textContent = 'Ожидание затянулось — проверьте позже';
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
    amt.placeholder = 'Сумма';
    amt.style.width = '80px';
    top.append(cur, amt);
    top.append(actionButton('Пополнить AZENS', async () => {
      const sum = Number(amt.value);
      if (!sum || sum <= 0) { toast('Введите сумму', 'error'); return; }
      const created = await api.paymentTopup(cid(), { realCurrency: cur.value, amount: sum });
      statusLabel.textContent = `Платёж ${created.paymentId.slice(0, 8)}: ${created.azensExpected} AZENS — ожидание оплаты`;
      if (simulatorOn) {
        statusRow.append(actionButton('Симулировать оплату', async () => {
          const done = await api.paymentSimulate(cid(), created.paymentId);
          if (session.character && typeof done.azens === 'number') session.character.azens = done.azens;
          refreshBars();
          statusLabel.textContent = 'Оплата подтверждена (симулятор)';
          toast(`+${created.azensExpected} AZENS`, 'success');
          await loadShop();
        }));
      }
      toast('Платёж создан, дождитесь подтверждения', 'info');
      await pollPayment(created.paymentId, created.azensExpected);
    }));
    box.append(top);

    // Пакеты AZENS с бонусом за объём
    for (const pack of packs) {
      const row = rowEl('inv-item');
      const label = document.createElement('span');
      label.className = 'inv-name';
      label.textContent = `${pack.realAmount} ${pack.realCurrency.toUpperCase()} → ${pack.azens} AZENS${pack.bonusPct ? ` (+${pack.bonusPct}%)` : ''}${pack.tagRu ? ` [${pack.tagRu}]` : ''}`;
      row.append(label);
      row.append(actionButton('Купить', async () => {
        const created = await api.paymentTopup(cid(), { packId: pack.id });
        statusLabel.textContent = `Пакет ${pack.id}: ${created.azensExpected} AZENS — ожидание оплаты`;
        if (simulatorOn) {
          statusRow.append(actionButton('Симулировать оплату', async () => {
            const done = await api.paymentSimulate(cid(), created.paymentId);
            if (session.character && typeof done.azens === 'number') session.character.azens = done.azens;
            refreshBars();
            const b = typeof done.bonus === 'number' && done.bonus > 0 ? ` (бонус +${done.bonus})` : '';
            statusLabel.textContent = `Оплата подтверждена (симулятор)${b}`;
            toast(`+${created.azensExpected} AZENS${b}`, 'success');
            await loadShop();
          }));
        }
        toast('Платёж создан, дождитесь подтверждения', 'info');
        await pollPayment(created.paymentId, created.azensExpected);
      }));
      box.append(row);
    }

    // Премиум-аккаунт за AZENS
    try {
      const prem = await api.premiumStatus(cid());
      const ph = document.createElement('div');
      ph.className = 'panel-subhead';
      ph.textContent = prem.active ? 'Премиум-аккаунт: активен' : 'Премиум-аккаунт';
      box.append(ph);
      if (!prem.active) {
        for (const d of prem.durations) {
          const row = rowEl('inv-item');
          const label = document.createElement('span');
          label.className = 'inv-name';
          label.textContent = `${d.days} дней: ${d.priceAzens} AZENS`;
          row.append(label);
          row.append(actionButton('Купить', async () => {
            const res = await api.premiumPurchase(cid(), d.days);
            if (session.character) session.character.azens = res.azens;
            refreshBars();
            toast('Премиум активирован', 'success');
            await loadShop();
          }));
          box.append(row);
        }
      }
    } catch { /* премиум недоступен */ }

    // Промокод
    const promoRow = rowEl('inv-item');
    const promoInput = document.createElement('input');
    promoInput.placeholder = 'Промокод';
    promoInput.style.width = '140px';
    promoRow.append(promoInput);
    promoRow.append(actionButton('Активировать', async () => {
      const code = promoInput.value.trim();
      if (!code) { toast('Введите промокод', 'error'); return; }
      const res = await api.promoRedeem(cid(), code);
      if (session.character) {
        session.character.azens = res.wallet.azens;
        session.character.isfahanSilver = res.wallet.isfahanSilver;
        session.character.syrianGold = res.wallet.syrianGold;
      }
      refreshBars();
      const parts: string[] = [];
      if (res.reward.azens) parts.push(`${res.reward.azens} AZENS`);
      if (res.reward.silver) parts.push(`${res.reward.silver} серебра`);
      if (res.reward.syrian) parts.push(`${res.reward.syrian} сир. золота`);
      toast(`Промокод: +${parts.join(', ')}`, 'success');
      await loadShop();
    }));
    box.append(promoRow);

    // Обменник свободных валют
    try {
      const { pairs } = await api.exchangePairs();
      if (pairs.length) {
        const exHead = document.createElement('div');
        exHead.className = 'panel-subhead';
        exHead.textContent = 'Обменник';
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
        exRow.append(actionButton('Обменять', async () => {
          const times = Math.max(1, Math.min(100, Number(timesInput.value) || 1));
          const res = await api.exchange(cid(), pairSel.value, times);
          if (session.character) {
            session.character.gold = res.wallet.gold;
            session.character.isfahanSilver = res.wallet.silver;
            session.character.syrianGold = res.wallet.syrian;
          }
          refreshBars();
          toast('Обмен выполнен', 'success');
          await loadShop();
        }));
        box.append(exRow);
      }
    } catch { /* обменник недоступен */ }

    const consent = document.createElement('div');
    consent.className = 'dungeon-status';
    consent.textContent = 'Нажимая «Пополнить», вы соглашаетесь с офертой: AZENS — виртуальная валюта без денежной стоимости, обмену обратно на деньги не подлежит. Возвраты — по политике возвратов.';
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
  head.textContent = 'Мои покупки';
  box.append(head);
  for (const p of history.payments.slice(0, 10)) {
    const row = rowEl('inv-item');
    const label = document.createElement('span');
    label.className = 'inv-name';
    const what = p.packId ? `пакет ${p.packId}` : `${p.realAmount} ${p.realCurrency.toUpperCase()}`;
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
  head.textContent = `Батл-пасс: ${status.season.nameRu}`;
  box.append(head);
  const claimed: number[] = Array.isArray(status.progress?.claimed_tiers)
    ? (status.progress.claimed_tiers as number[])
    : [];
  const pts = status.progress?.points ?? 0;
  if (!status.progress?.is_premium) {
    const row = rowEl('inv-item');
    const label = document.createElement('span');
    label.className = 'inv-name';
    label.textContent = `Премиум-доступ: ${status.season.premiumPrice} AZENS`;
    row.append(label);
    row.append(actionButton('Купить', async () => {
      const res = await api.battlepassPurchase(cid());
      if (session.character) session.character.azens = res.azens;
      refreshBars();
      toast('Премиум батл-пасс активирован', 'success');
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
    label.textContent = `Тир ${tier.tier}: ${tier.freeReward.nameRu} / премиум: ${tier.premiumReward.nameRu}`;
    row.append(label);
    if (unlocked && !got) {
      row.append(actionButton('Забрать', async () => {
        await api.battlepassClaim(cid(), tier.tier, false);
        toast('Награда получена', 'success');
        await loadShop();
      }));
      if (status.progress?.is_premium) {
        row.append(actionButton('Премиум', async () => {
          await api.battlepassClaim(cid(), tier.tier, true);
          toast('Премиум-награда получена', 'success');
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
        label.textContent = item.nameRu ?? SHOP_ITEM_NAMES[item.itemId] ?? item.itemId;
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
    const box = $('craft-list');
    if (!box) return;
    box.innerHTML = '';

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
      empty.textContent = 'Нет активных лотов';
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

    // ── Форма размещения лота: предмет из сумки + цена ──
    try {
      const { items } = await api.inventory(cid());
      const formTitle = document.createElement('div');
      formTitle.className = 'panel-subhead';
      formTitle.textContent = 'Разместить лот';
      box.append(formTitle);
      if (!items.length) {
        const note = document.createElement('div');
        note.className = 'lb-empty';
        note.textContent = 'Сумка пуста — нечего выставлять';
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
        qtyInput.placeholder = 'Кол-во';
        const priceInput = document.createElement('input');
        priceInput.type = 'number'; priceInput.min = '1'; priceInput.value = '100';
        priceInput.placeholder = 'Цена (золото)';
        const submitBtn = document.createElement('button');
        submitBtn.className = 'quest-accept';
        submitBtn.textContent = 'Выставить';
        submitBtn.addEventListener('click', async () => {
          try {
            await api.auctionList({
              characterId: cid(),
              itemId: itemSel.value,
              quantity: Math.max(1, Number(qtyInput.value) || 1),
              price: Math.max(1, Number(priceInput.value) || 1),
            });
            toast('Лот размещён!', 'success');
            await loadAuction();
          } catch (err) { toast((err as Error).message, 'error'); }
        });
        form.append(itemSel, qtyInput, priceInput, submitBtn);
        box.append(form);
      }
    } catch { /* форма недоступна без инвентаря */ }
  } catch (err) {
    const box = $('auction-list');
    if (box) box.innerHTML = `<div class="lb-empty">Ошибка загрузки: ${(err as Error).message}</div>`;
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
      if (c.rewardSilver) label.textContent += ` + ${c.rewardSilver} серебра`;
      if (c.rewardSyrian) label.textContent += ` + ${c.rewardSyrian} сир. золота`;
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
    giftHead.textContent = 'Подарок игроку';
    box.append(giftHead);
    try {
      const { items } = await api.inventory(cid());
      const giftRow = rowEl('inv-item');
      const targetInput = document.createElement('input');
      targetInput.placeholder = 'Имя получателя';
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
      giftRow.append(actionButton('Подарить', async () => {
        const target = targetInput.value.trim();
        if (!target) { toast('Укажите получателя', 'error'); return; }
        await api.giftSend(cid(), target, itemSel.value, Math.max(1, Number(qtyInput.value) || 1));
        toast('Подарок отправлен', 'success');
        await loadTrade();
      }));
      box.append(giftRow);
    } catch { /* инвентарь недоступен */ }
  } catch {
    /* панель недоступна */
  }
}

// ── Конюшня ──────────────────────────────────────────────

export async function loadMounts(): Promise<void> {
  if (!session.character) return;
  const box = $('mount-stable-content');
  if (!box) return;
  box.innerHTML = '';

  try {
    // Скакуны, доступные в конюшне
    const { shops } = await api.shops();
    const stableShop = shops.find(s => s.id === 'shop_isfahan_stable');
    if (!stableShop) return;

    // Текущие скакуны персонажа
    const { mounts } = await api.mountsMy(cid());
    const owned = new Map<string, any>();
    for (const m of mounts ?? []) {
      if (!owned.has(m.mount_id)) owned.set(m.mount_id, m);
    }

    const title = document.createElement('div');
    title.className = 'panel-subhead';
    title.textContent = 'Доступные скакуны';
    box.append(title);

    for (const item of stableShop.items) {
      const cur2 = item.currency as 'gold' | 'azens' | 'silver' | 'syrian';
      const row = rowEl('inv-item');
      const name = document.createElement('span');
      name.className = 'inv-name';
      name.textContent = SHOP_ITEM_NAMES[item.itemId] ?? item.itemId;
      const price = document.createElement('span');
      price.className = 'inv-qty';
      price.textContent = `${cur2 === 'azens' ? 'AZENS' : 'gold'} ${item.price}`;
      row.append(name, price);
      const info = document.createElement('span');
      info.style.cssText = 'color:#8a8; font-size:0.82em; width:100%';
      const def = MOUNT_DEFS[item.itemId];
      if (def) {
        info.textContent = `⚡ ${def.baseSpeed}–${def.maxSpeed} м/с · ${def.rarity === 'rare' ? 'Редкий' : def.rarity === 'common' ? 'Обычный' : 'Эпик'} · ур.${def.minLevel}+`;
      }
      row.append(info);
      const ownedMount = owned.get(item.itemId);
      if (ownedMount) {
        const actBtn = actionButton(ownedMount.is_active ? '✔ Верхом' : 'Верхом', async () => {
          await api.mountActivate(cid(), item.itemId);
          await loadMounts();
          toast(`Скакун ${name.textContent} призываем`, 'success');
        });
        if (ownedMount.is_active) actBtn.style.opacity = '0.7';
        const sellBtn = actionButton('Продать', async () => {
          toast('Скакун продан', 'info');
          await loadMounts();
        });
        sellBtn.style.opacity = '0.6';
        row.append(actBtn, sellBtn);
      } else {
        const buyBtn = actionButton('Купить', async () => {
          const res = await api.mountsBuy('shop_isfahan_stable', cid(), item.itemId);
          if (res.success && session.character) {
            if (typeof res.gold === 'number') session.character.gold = res.gold;
            if (typeof res.azens === 'number') session.character.azens = res.azens;
            refreshBars();
            toast(`${name.textContent} куплен!`, 'success');
            await loadMounts();
          } else if (res && 'error' in res) {
            toast(String(res.error), 'error');
          }
        });
        row.append(buyBtn);
      }
      box.append(row);
    }

    if (mounts?.length) {
      const sub = document.createElement('div');
      sub.className = 'panel-subhead';
      sub.textContent = `Ваши скакуны (${mounts.length})`;
      box.append(sub);
    }
  } catch {
    /* недоступно */
  }
}

const MOUNT_DEFS: Record<string, { baseSpeed: number; maxSpeed: number; rarity: string; minLevel: number }> = {
  mount_arabian_horse:    { baseSpeed: 6, maxSpeed: 9,  rarity: 'common', minLevel: 1 },
  mount_bactrian_camel:   { baseSpeed: 4.5, maxSpeed: 6.5, rarity: 'common', minLevel: 10 },
  mount_qizilbash_warhorse: { baseSpeed: 7, maxSpeed: 11, rarity: 'rare', minLevel: 30 },
};


async function loadLeaderboard(): Promise<void> {
  const box = $('panel-leaderboard');
  if (!box) return;
  box.innerHTML = '';

  const types = [
    { id: 'level', label: 'Уровень' },
    { id: 'pvp', label: 'PvP' },
    { id: 'kills', label: 'Убийства' },
    { id: 'quests', label: 'Квесты' },
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
      listEl.innerHTML = '<div class="lb-empty">Пока нет данных</div>';
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
          `<span class="lb-name">${session.character?.name ?? 'Вы'}</span>` +
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
        `<span class="lb-class">Ур.${e.level}</span>` +
        (e.guild ? `<span class="lb-guild">[${e.guild}]</span>` : '') +
        `<span class="lb-value">${e.value.toLocaleString()}</span>`;
      listEl.append(row);
    }
  } catch {
    listEl.innerHTML = '<div class="lb-empty">Ошибка загрузки</div>';
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
      pendingLabel.textContent = `Входящие запросы (${data.pending.length})`;
      box.append(pendingLabel);
      for (const p of data.pending) {
        const row = document.createElement('div');
        row.className = 'pending-entry';
        row.innerHTML =
          `<span class="friend-name">${p.friendName}</span>` +
          `<span class="friend-info">Ур.${p.level}</span>`;
        const acceptBtn = document.createElement('button');
        acceptBtn.className = 'friend-btn friend-btn--accept';
        acceptBtn.textContent = 'Принять';
        acceptBtn.addEventListener('click', async () => {
          await api.friendAccept(p.userId);
          toast('Запрос принят!', 'success');
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
          `<span class="friend-info">Ур.${f.level} · ${REGION_NAMES[f.region] ?? f.region}</span>`;
        const actionsEl = document.createElement('span');
        actionsEl.className = 'friend-actions';
        const removeBtn = document.createElement('button');
        removeBtn.className = 'friend-btn friend-btn--danger';
        removeBtn.textContent = '×';
        removeBtn.title = 'Удалить из друзей';
        removeBtn.addEventListener('click', async () => {
          await api.friendRemove(f.friendId);
          toast('Друг удалён', 'info');
          void loadFriends();
        });
        actionsEl.append(removeBtn);
        row.append(actionsEl);
        box.append(row);
      }
    } else if (!data.pending.length) {
      const empty = document.createElement('div');
      empty.className = 'lb-empty';
      empty.textContent = 'Пока нет друзей.';
      box.append(empty);
    }

    // Поиск и добавление друзей
    const searchRow = document.createElement('div');
    searchRow.style.cssText = 'display:flex;gap:6px;margin-top:12px';
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Имя друга или ID…';
    searchInput.style.cssText = 'flex:1;background:#1a1410;color:#f5f0e8;border:1px solid #5a4a30;padding:6px 8px;border-radius:4px;font-size:12px;';
    searchInput.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      const val = searchInput.value.trim();
      if (!val) return;
      try {
        await api.friendRequest(val);
        toast(`Запрос отправлен: ${val}`, 'success');
        searchInput.value = '';
        void loadFriends();
      } catch (err) {
        toast((err as Error).message, 'error');
      }
    });
    const addBtn = document.createElement('button');
    addBtn.className = 'quest-accept';
    addBtn.textContent = 'Добавить';
    addBtn.addEventListener('click', () => {
      const ev = new KeyboardEvent('keydown', { key: 'Enter' });
      searchInput.dispatchEvent(ev);
    });
    searchRow.append(searchInput, addBtn);
    box.append(searchRow);
  } catch {
    box.innerHTML = '<div class="lb-empty">Друзья недоступны</div>';
  }
}

// ── Шахматы Шаха ──────────────────────────────────────────

async function loadChess(): Promise<void> {
  const box = $('panel-chess');
  if (!box) return;
  box.innerHTML = '';

  const betRow = document.createElement('div');
  betRow.className = 'chess-bet-row';
  betRow.innerHTML = '<span style="color:var(--cream-dim);font-size:12px;">Ставка:</span>';
  const betInput = document.createElement('input');
  betInput.className = 'chess-bet-input';
  betInput.type = 'number';
  betInput.value = '50';
  betInput.min = '10';
  betInput.max = '5000';
  betRow.append(betInput);
  const startBtn = document.createElement('button');
  startBtn.className = 'quest-accept';
  startBtn.textContent = 'Начать партию';
  startBtn.addEventListener('click', async () => {
    const bet = Number(betInput.value) || 50;
    try {
      const game = await api.chessStart(bet);
      renderChessBoard(box, game);
    } catch (err) { toast((err as Error).message, 'error'); }
  });
  betRow.append(startBtn);
  box.append(betRow);

  const statusEl = document.createElement('div');
  statusEl.className = 'chess-status';
  statusEl.textContent = 'Сделайте ставку и начните партию';
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
            const result = await api.chessMove(game.gameId, selectedCell, { row: r, col: c });
            game.board = result.board;
            game.turn = result.turn;
            game.status = result.status;
            if (result.result) {
              toast(result.result.messageRu, result.result.winner === 'white' ? 'success' : 'error');
            }
            renderChessBoard(container, game);
          } catch {
            toast('Невозможный ход', 'error');
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
    statusEl.textContent = 'Шах-мат!';
  } else if (game.status === 'stalemate') {
    statusEl.textContent = 'Пат!';
  } else {
    statusEl.textContent = `Ход: ${game.turn === 'white' ? 'Вы' : 'Мастер'} · Ставка: ◉ ${game.betGold}`;
  }
  container.append(statusEl);

  const resignBtn = document.createElement('button');
  resignBtn.className = 'quest-accept';
  resignBtn.textContent = 'Сдаться';
  resignBtn.style.marginTop = '8px';
  resignBtn.addEventListener('click', async () => {
    await api.chessResign(game.gameId);
    toast('Вы сдались', 'info');
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
    box.innerHTML = '<div class="lb-empty">Стихотворения временно недоступны</div>';
    return;
  }

  const info = document.createElement('div');
  info.style.cssText = 'color:var(--cream-dim);font-size:12px;margin-bottom:8px';
  info.textContent = 'Выберите стихотворение для сборки:';
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
      `<span class="friend-info">${ch.difficulty} · ${ch.lineCount} строк</span>` +
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
      hintEl.textContent = `Сложность: ${data.challenge.difficulty} · Строк: ${data.challenge.lineCount}`;
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
                if (res.isCorrect) {
                  resultEl.className = 'poetry-result correct';
                  resultEl.textContent = 'Правильно! Стихотворение собрано! ◉' + challenge.reward.gold + ' золото';
                  optionsEl.querySelectorAll('.poetry-line').forEach(l => l.classList.add('correct'));
                } else {
                  resultEl.className = 'poetry-result wrong';
                  resultEl.textContent = 'Неправильный порядок строк';
                  optionsEl.querySelectorAll('.poetry-line').forEach(l => l.classList.add('wrong'));
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
      undoBtn.textContent = 'Отменить';
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
      backBtn.textContent = '← Назад к списку';
      backBtn.addEventListener('click', () => void loadPoetry());
      box.append(backBtn);

    } catch {
      box.innerHTML = '<div class="lb-empty">Ошибка начала игры</div>';
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
      { id: 'history', label: '📜 История' },
      { id: 'culture', label: '🎭 Культура' },
      { id: 'geography', label: '🗺️ География' },
      { id: 'biography', label: '👤 Биографии' },
      { id: 'mythology', label: '🐉 Мифология' },
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
      prog.textContent = `Открыто ${data.unlocked} из ${data.total} записей`;
      box.append(prog);
    }

    renderChronicles(listEl, data.entries, '');
  } catch {
    box.innerHTML = '<div class="lb-empty">Хроники недоступны</div>';
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
    container.innerHTML = '<div class="lb-empty">Нет записей</div>';
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
          ? `<p class="chronicle-hint">Откроется после: ${entry.unlockHintRu}</p>`
          : '<p class="chronicle-hint">Откроется позже</p>');
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
          <button class="death-btn death-btn--free" style="margin-top:16px;" onclick="this.closest('.death-overlay').remove()">Закрыть</button>
        </div>
      `;
      document.body.append(modal);
    });
    container.append(card);
  }
}

const REGION_NAMES: Record<string, string> = {
  tabriz: 'Тебриз', isfahan: 'Исфахан', shiraz: 'Шираз', caucasus: 'Кавказ',
  mesopotamia: 'Месопотамия', khorasan: 'Хорасан', persian_gulf: 'Персидский залив',
};

// ── Гильдии ────────────────────────────────────────────────

async function loadGuild(): Promise<void> {
  const box = $('panel-guild');
  if (!box) return;
  box.innerHTML = '';
  try {
    const data = await api.guildMy();
    if (!data?.guild) {
      // Нет гильдии — показать поиск/создание
      box.innerHTML = '<div class="lb-empty">Вы не в гильдии</div>';
      const createBtn = document.createElement('button');
      createBtn.className = 'quest-accept';
      createBtn.textContent = 'Создать гильдию';
      createBtn.style.marginTop = '8px';
      createBtn.addEventListener('click', () => {
        const name = prompt('Название гильдии:');
        const tag = prompt('Тег (2-6 символов):');
        if (name && tag) {
          void api.guildCreate(name, tag, '').then(() => { toast('Гильдия создана!', 'success'); void loadGuild(); });
        }
      });
      box.append(createBtn);
      return;
    }
    const g = data.guild;
    box.innerHTML = `<h3 style="color:var(--cream);margin:0 0 4px;">${g.name} <span style="color:var(--gold-light);">[${g.tag}]</span></h3>` +
      `<p style="color:var(--cream-dim);font-size:12px;margin:0 0 8px;">Ур.${g.level} · Ранг: ${data.rank} · Золото: ◉ ${g.gold}</p>`;
    const membersBtn = document.createElement('button');
    membersBtn.className = 'quest-accept';
    membersBtn.textContent = 'Участники';
    membersBtn.addEventListener('click', async () => {
      const res = await api.guildMembers();
      const list = box.querySelector('.guild-members') ?? document.createElement('div');
      list.className = 'guild-members';
      list.innerHTML = res.members.map((m: any) =>
        `<div class="friend-entry"><span class="friend-name">${m.character_name}</span><span class="friend-info">Ур.${m.level} · ${m.rank}</span></div>`
      ).join('');
      if (!box.querySelector('.guild-members')) box.append(list);
    });
    box.append(membersBtn);
  } catch { box.innerHTML = '<div class="lb-empty">Гильдии пока нет</div>'; }
}

// ── Достижения ─────────────────────────────────────────────

async function loadAchievements(): Promise<void> {
  const box = $('panel-achievements');
  if (!box) return;
  box.innerHTML = '';
  try {
    const data = await api.achievements();
    const stats = document.createElement('div');
    stats.className = 'lb-my-rank';
    stats.textContent = `Разблокировано: ${data.unlockedCount} / ${data.total}`;
    box.append(stats);
    if (!data.achievements.length) {
      const empty = document.createElement('div');
      empty.className = 'lb-empty';
      empty.textContent = 'Достижения скоро появятся';
      box.append(empty);
      return;
    }
    for (const a of data.achievements) {
      const row = document.createElement('div');
      row.className = 'friend-entry' + (a.unlocked ? '' : ' locked');
      row.style.opacity = a.unlocked ? '1' : '0.4';
      const icon = a.icon ?? '★';
      row.innerHTML = `<span style="font-size:18px;">${icon}</span>` +
        `<span class="friend-name">${a.titleRu}</span>` +
        `<span class="friend-info">${a.description_ru ?? ''}</span>` +
        (a.reward_gold ? `<span class="lb-value">◉${a.reward_gold}</span>` : '');
      box.append(row);
    }
  } catch { box.innerHTML = '<div class="lb-empty">Достижения недоступны</div>'; }
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
  } catch { box.innerHTML = '<div class="lb-empty">Задачи недоступны</div>'; }
}

// ── Питомцы ────────────────────────────────────────────────

async function loadPets(): Promise<void> {
  const box = $('panel-pets');
  if (!box) return;
  box.innerHTML = '';
  try {
    const data = await api.pets();
    if (!data.pets.length) {
      const empty = document.createElement('div');
      empty.className = 'lb-empty';
      empty.textContent = 'У вас нет питомцев';
      box.append(empty);
      
      const shopBtn = document.createElement('button');
      shopBtn.className = 'quest-accept';
      shopBtn.textContent = 'Купить питомца';
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
          buyBtn.textContent = 'Купить';
          buyBtn.addEventListener('click', async () => {
            try { await api.petAcquire(cid(), p.id); toast('Питомец получен!', 'success'); void loadPets(); }
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
      row.innerHTML = `<span class="friend-name">${p.nickname ?? def?.name_ru ?? p.pet_id}</span>` +
        `<span class="friend-info">Ур.${p.level} · ${def?.type ?? ''}</span>`;
      if (!p.is_active) {
        const actBtn = document.createElement('button');
        actBtn.className = 'friend-btn';
        actBtn.textContent = 'Выбрать';
        actBtn.addEventListener('click', async () => { await api.petActivate(cid(), p.id); void loadPets(); });
        row.append(actBtn);
      }
      box.append(row);
    }
  } catch (err) {
    box.innerHTML = `<div class="lb-empty">Ошибка: ${(err as Error).message}</div>`;
  }
}

// ── Дом ────────────────────────────────────────────────────

const HOUSE_DEFS: Record<string, { nameRu: string; price: number; slots: number; craftBonus: string }> = {
  cottage:    { nameRu: 'Хижина',         price: 2000,  slots: 20, craftBonus: '0%' },
  house:      { nameRu: 'Дом',            price: 5000,  slots: 40, craftBonus: '+5%' },
  villa:      { nameRu: 'Вилла',          price: 15000, slots: 60, craftBonus: '+10%' },
  mansion:    { nameRu: 'Особняк',        price: 40000, slots: 80, craftBonus: '+15%' },
  palace:     { nameRu: 'Дворец',         price: 100000,slots: 100,craftBonus: '+20%' },
};

const HOUSE_REGIONS = [
  { id: 'tabriz',    nameRu: 'Тебриз' },
  { id: 'isfahan',   nameRu: 'Исфахан' },
  { id: 'shiraz',    nameRu: 'Шираз' },
  { id: 'caucasus',  nameRu: 'Кавказ' },
  { id: 'khorasan',  nameRu: 'Хорасан' },
  { id: 'mesopotamia', nameRu: 'Месопотамия' },
  { id: 'persian_gulf', nameRu: 'Персидский залив' },
];

async function loadHouse(): Promise<void> {
  const box = $('house-list');
  if (!box) return;
  box.innerHTML = '';
  try {
    const data = await api.house();
    if (!data.house) {
      // Нет дома — показываем выбор
      const empty = document.createElement('div');
      empty.className = 'lb-empty';
      empty.textContent = 'У вас нет дома';
      box.append(empty);

      const info = document.createElement('div');
      info.style.cssText = 'color:#bfae8a;font-size:11px;margin:6px 0 10px;line-height:1.5';
      info.innerHTML = 'Дом даёт хранилище и бонус к крафту.<br>Выберите тип и регион:';
      box.append(info);

      // Выбор типа
      const typeRow = document.createElement('div');
      typeRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px';
      const typeLabel = document.createElement('span');
      typeLabel.style.cssText = 'color:#d9c27a;font-size:12px;width:80px';
      typeLabel.textContent = 'Тип дома:';
      typeRow.append(typeLabel);
      const typeSel = document.createElement('select');
      typeSel.style.cssText = 'background:#1a1410;color:#f5f0e8;border:1px solid #5a4a30;padding:4px 8px;border-radius:4px';
      for (const [key, def] of Object.entries(HOUSE_DEFS)) {
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = `${def.nameRu} · ${def.price.toLocaleString()}g · 📦${def.slots} · ⚒${def.craftBonus}`;
        typeSel.append(opt);
      }
      typeRow.append(typeSel);
      box.append(typeRow);

      // Выбор региона
      const regRow = document.createElement('div');
      regRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:12px';
      const regLabel = document.createElement('span');
      regLabel.style.cssText = 'color:#d9c27a;font-size:12px;width:80px';
      regLabel.textContent = 'Регион:';
      regRow.append(regLabel);
      const regSel = document.createElement('select');
      regSel.style.cssText = 'background:#1a1410;color:#f5f0e8;border:1px solid #5a4a30;padding:4px 8px;border-radius:4px';
      for (const r of HOUSE_REGIONS) {
        const opt = document.createElement('option');
        opt.value = r.id;
        opt.textContent = r.nameRu;
        regSel.append(opt);
      }
      regRow.append(regSel);
      box.append(regRow);

      const buyBtn = document.createElement('button');
      buyBtn.className = 'quest-accept';
      buyBtn.textContent = 'Купить';
      buyBtn.style.marginTop = '8px';
      buyBtn.addEventListener('click', async () => {
        const type = typeSel.value;
        const region = regSel.value;
        try {
          await api.houseBuy(cid(), region, type);
          toast('Дом куплен!', 'success');
          void loadHouse();
        } catch (err) {
          toast((err as Error).message, 'error');
        }
      });
      box.append(buyBtn);
      return;
    }

    const h = data.house;
    const def = HOUSE_DEFS[h.house_type] ?? { nameRu: h.house_type, price: 0, slots: 0, craftBonus: '0%' };
    const nextTypeIdx = Object.keys(HOUSE_DEFS).indexOf(h.house_type) + 1;
    const nextType = Object.keys(HOUSE_DEFS)[nextTypeIdx];
    const nextDef = nextType ? HOUSE_DEFS[nextType] : null;

    const title = document.createElement('h3');
    title.style.cssText = 'color:var(--cream);margin:0 0 4px';
    title.textContent = `🏠 ${def.nameRu} · Ур.${h.level}`;
    box.append(title);

    const info2 = document.createElement('p');
    info2.style.cssText = 'color:var(--cream-dim);font-size:12px;margin:0 0 4px';
    info2.textContent = `Регион: ${h.region} · Хранилище: ${h.storage_slots} · Бонус крафта: ${def.craftBonus}`;
    box.append(info2);

    if (nextDef) {
      const upBtn = document.createElement('button');
      upBtn.className = 'quest-accept';
      upBtn.textContent = `Улучшить → ${nextDef.nameRu} (${nextDef.price.toLocaleString()}g)`;
      upBtn.addEventListener('click', async () => {
        try { await api.houseUpgrade(cid()); toast('Дом улучшен!', 'success'); void loadHouse(); }
        catch (err) { toast((err as Error).message, 'error'); }
      });
      box.append(upBtn);
    } else {
      const maxLabel = document.createElement('div');
      maxLabel.style.cssText = 'color:#5a4; font-size:12px; margin-top:8px';
      maxLabel.textContent = '✓ Максимальный уровень';
      box.append(maxLabel);
    }
  } catch {
    box.innerHTML = '<div class="lb-empty">Ошибка загрузки</div>';
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
    try { [rankData, rankRes] = await Promise.all([api.pvpMe(), api.pvpRankings(10)]); } catch {}
    const myRank = rankData.ranking;
    if (myRank) {
      const tierIcons: Record<string, string> = { bronze: '🥉', silver: '🥈', gold: '🥇', diamond: '💎', legendary: '👑' };
      const rankEl = document.createElement('div');
      rankEl.className = 'lb-my-rank';
      rankEl.textContent = `${tierIcons[myRank.tier] ?? ''} ${myRank.tier.toUpperCase()} · Рейтинг: ${myRank.rating} · W:${myRank.wins} L:${myRank.losses} · Стрик: ${myRank.streak}`;
      box.append(rankEl);
    } else {
      const info = document.createElement('div');
      info.style.cssText = 'color:var(--cream-dim);font-size:12px;margin-bottom:8px';
      info.textContent = 'Вы ещё не участвовали в PvP-боях';
      box.append(info);
    }
    const findBtn = document.createElement('button');
    findBtn.className = 'quest-accept';
    findBtn.textContent = 'Найти бой';
    findBtn.style.margin = '8px 0';
    findBtn.addEventListener('click', async () => {
      toast('Поиск противника...', 'info');
      try { const m = await api.pvpFindMatch(cid()); if (m.match) toast('Противник найден!', 'success'); }
      catch (err) { toast((err as Error).message, 'error'); }
    });
    box.append(findBtn);
    // Топ-10
    const title = document.createElement('div');
    title.className = 'panel-subhead';
    title.textContent = 'Топ PvP';
    box.append(title);
    const rankings = rankRes.rankings ?? [];
    if (!rankings.length) {
      const empty = document.createElement('div');
      empty.className = 'lb-empty';
      empty.textContent = 'Пока нет участников';
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
  } catch { box.innerHTML = '<div class="lb-empty">Арена недоступна</div>'; }
}

// ── Бесконечная Башня ──────────────────────────────────────

async function loadTower(): Promise<void> {
  const box = $('panel-tower');
  if (!box) return;
  box.innerHTML = '';
  try {
    let progData: { progress?: any } = {};
    try { progData = await api.towerProgress(); } catch {}
    const p = progData.progress ?? { max_floor: 0, current_floor: 0, runs_total: 0 };
    const info = document.createElement('div');
    info.className = 'lb-my-rank';
    info.textContent = `🏰 Башня · Макс. этаж: ${p.max_floor} · Текущий: ${p.current_floor} · Забегов: ${p.runs_total}`;
    box.append(info);
    const startBtn = document.createElement('button');
    startBtn.className = 'quest-accept';
    startBtn.textContent = 'Начать забег';
    startBtn.style.margin = '8px 0';
    startBtn.addEventListener('click', async () => {
      try {
        const res = await api.towerStart();
        toast(`Этаж 1: ${res.floor.monsterCount} монстров, ур.${res.floor.monsterLevel}`, 'info');
        void loadTower();
      } catch (err) { toast((err as Error).message, 'error'); }
    });
    box.append(startBtn);
    // Лидерборд
    let lbData: { leaderboard?: any[] } = {};
    try { lbData = await api.towerLeaderboard(); } catch {}
    const rankings = lbData.leaderboard ?? [];
    if (rankings.length) {
      const lbTitle = document.createElement('div');
      lbTitle.className = 'panel-subhead';
      lbTitle.textContent = 'Топ Башни';
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
      empty.textContent = 'Пока никто не покорил башню';
      box.append(empty);
    }
  } catch { box.innerHTML = '<div class="lb-empty">Башня недоступна</div>'; }
}

// ── Репутация ──────────────────────────────────────────────

async function loadReputation(): Promise<void> {
  const box = $('panel-reputation');
  if (!box) return;
  box.innerHTML = '';
  try {
    const data = await api.reputation();
    const factions = data.reputation ?? [];
    if (!factions.length) {
      const empty = document.createElement('div');
      empty.className = 'lb-empty';
      empty.textContent = 'Репутация пока не заработана';
      box.append(empty);
      return;
    }
    for (const r of factions) {
      const row = document.createElement('div');
      row.className = 'friend-entry';
      const pct = Math.min(100, Math.round((r.reputation / 1500) * 100));
      row.innerHTML = `<span class="friend-name">${r.faction}</span>` +
        `<span class="friend-info">${r.rank_title ?? 'Нейтрал'}</span>` +
        `<span class="lb-value">${r.reputation} (${pct}%)</span>`;
      box.append(row);
    }
  } catch { box.innerHTML = '<div class="lb-empty">Репутация недоступна</div>'; }
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

export async function loadAdmin(): Promise<void> {
  const box = $('admin-list');
  if (!box) return;
  box.innerHTML = '';
  if (!session.isAdmin) {
    box.innerHTML = '<div class="inv-empty">Нет доступа</div>';
    return;
  }

  // ── Поиск игрока ──
  adminSub(box, `Игроки (роль: ${session.isAdminRole})`);
  const searchRow = rowEl('inv-item');
  const q = adminInput('Имя или email', '150px');
  const results = document.createElement('div');
  results.style.width = '100%';
  searchRow.append(q);
  searchRow.append(actionButton('Найти', async () => {
    const { results: list } = await api.adminSearch(q.value.trim());
    results.innerHTML = '';
    if (!list.length) {
      results.textContent = 'Ничего не найдено';
      return;
    }
    for (const p of list) {
      const row = rowEl('inv-item');
      const label = document.createElement('span');
      label.className = 'inv-name';
      label.textContent = `${p.name} (ур. ${p.level}, ${p.region})${p.is_banned ? ' [БАН]' : ''}`;
      row.append(label);
      row.append(actionButton('Выбрать', async () => {
        (document.getElementById('admin-target-char') as HTMLInputElement).value = p.id;
        (document.getElementById('admin-target-user') as HTMLInputElement).value = p.user_id;
        (document.getElementById('admin-target-name') as HTMLElement).textContent = `Цель: ${p.name}`;
      }));
      results.append(row);
    }
  }));
  box.append(searchRow, results);

  // ── Цель и наказания ──
  adminSub(box, 'Наказания');
  const targetName = document.createElement('div');
  targetName.id = 'admin-target-name';
  targetName.className = 'inv-name';
  targetName.textContent = 'Цель: не выбрана';
  box.append(targetName);
  const charIdInput = adminInput('characterId', '150px');
  charIdInput.id = 'admin-target-char';
  const userIdInput = adminInput('userId', '150px');
  userIdInput.id = 'admin-target-user';
  box.append(charIdInput, userIdInput);

  const muteRow = rowEl('inv-item');
  const muteMin = adminInput('Минуты', '70px', 'number');
  muteMin.value = '30';
  const muteReason = adminInput('Причина мута', '150px');
  muteRow.append(muteMin, muteReason);
  muteRow.append(actionButton('Мут', async () => {
    const cid2 = (document.getElementById('admin-target-char') as HTMLInputElement).value.trim();
    if (!cid2 || !muteReason.value.trim()) { toast('Выберите цель и укажите причину', 'error'); return; }
    await api.adminMute(cid2, Number(muteMin.value) || 30, muteReason.value.trim());
    toast('Мут выдан', 'success');
  }));
  box.append(muteRow);

  const banRow = rowEl('inv-item');
  const banReason = adminInput('Причина бана', '150px');
  const banDays = adminInput('Дни', '60px', 'number');
  banDays.value = '7';
  banRow.append(banReason, banDays);
  banRow.append(actionButton('Бан', async () => {
    const uid = (document.getElementById('admin-target-user') as HTMLInputElement).value.trim();
    if (!uid || !banReason.value.trim()) { toast('Выберите цель и укажите причину', 'error'); return; }
    await api.adminBan(uid, banReason.value.trim(), Number(banDays.value) || 7);
    toast('Бан выдан', 'success');
  }));
  banRow.append(actionButton('Разбан', async () => {
    const uid = (document.getElementById('admin-target-user') as HTMLInputElement).value.trim();
    if (!uid) { toast('Выберите цель', 'error'); return; }
    await api.adminUnban(uid);
    toast('Разбанен', 'success');
  }));
  box.append(banRow);

  // ── Телепорт и золото ──
  adminSub(box, 'Телепорт / золото');
  const tpRow = rowEl('inv-item');
  const tpX = adminInput('X', '60px', 'number');
  const tpZ = adminInput('Z', '60px', 'number');
  const tpRegion = adminInput('Регион', '90px');
  tpRegion.value = 'tabriz';
  tpRow.append(tpX, tpZ, tpRegion);
  tpRow.append(actionButton('Телепорт', async () => {
    const cid2 = (document.getElementById('admin-target-char') as HTMLInputElement).value.trim();
    if (!cid2) { toast('Выберите цель', 'error'); return; }
    await api.adminTeleport(cid2, { x: Number(tpX.value) || 0, y: 0, z: Number(tpZ.value) || 0 }, tpRegion.value.trim() || 'tabriz');
    toast('Телепортирован', 'success');
  }));
  box.append(tpRow);

  const goldRow = rowEl('inv-item');
  const goldAmt = adminInput('Сумма', '90px', 'number');
  goldRow.append(goldAmt);
  goldRow.append(actionButton('Выдать золото', async () => {
    const cid2 = (document.getElementById('admin-target-char') as HTMLInputElement).value.trim();
    if (!cid2 || !Number(goldAmt.value)) { toast('Выберите цель и сумму', 'error'); return; }
    await api.adminGiveGold(cid2, Number(goldAmt.value));
    toast('Золото выдано', 'success');
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
  adminSub(box, 'Валюта (senior+)');
  const grantRow = rowEl('inv-item');
  const curSel = document.createElement('select');
  curSel.className = 'inv-action';
  for (const cur of ['azens', 'gold', 'isfahan_silver', 'syrian_gold']) {
    const o = document.createElement('option');
    o.value = cur;
    o.textContent = cur;
    curSel.append(o);
  }
  const grantAmt = adminInput('Сумма', '80px', 'number');
  const grantReason = adminInput('Причина (обязательно)', '170px');
  grantRow.append(curSel, grantAmt, grantReason);
  grantRow.append(actionButton('Начислить', async () => {
    const cid2 = (document.getElementById('admin-target-char') as HTMLInputElement).value.trim();
    if (!cid2 || !Number(grantAmt.value) || grantReason.value.trim().length < 5) {
      toast('Цель, сумма и причина (мин. 5 символов)', 'error');
      return;
    }
    const res = await api.adminGrantCurrency(cid2, curSel.value, Number(grantAmt.value), grantReason.value.trim());
    toast(`Начислено, баланс: ${res.balance}`, 'success');
  }));
  box.append(grantRow);

  const refundRow = rowEl('inv-item');
  const refundPay = adminInput('paymentId', '170px');
  const refundReason = adminInput('Причина (обязательно)', '170px');
  refundRow.append(refundPay, refundReason);
  refundRow.append(actionButton('Рефанд', async () => {
    if (!refundPay.value.trim() || refundReason.value.trim().length < 5) {
      toast('paymentId и причина (мин. 5 символов)', 'error');
      return;
    }
    await api.adminRefund(refundPay.value.trim(), refundReason.value.trim());
    toast('Возврат выполнен', 'success');
  }));
  box.append(refundRow);

  const finRow = rowEl('inv-item');
  const finOut = document.createElement('div');
  finOut.style.width = '100%';
  finRow.append(actionButton('Сводка финансов', async () => {
    const s = await api.adminFinance();
    const lines = [
      `Обращение: AZENS ${s.circulating.azens}, золото ${s.circulating.gold}, серебро ${s.circulating.silver}, сир. золото ${s.circulating.syrian}, должников: ${s.circulating.debtors}`,
      ...s.byStatus.map(b => `Платежи ${b.status}: ${b.count} шт, выпущено ${b.minted} + бонус ${b.bonus}`),
      `Промо выдано: AZENS ${s.promoGranted.azens} (${s.promoGranted.redemptions} погашений)`,
      ...s.grants.map(g => `Гранты ${g.currency}: ${g.count} шт на ${g.total}`),
      s.velocity.length ? `Подозрительно активны: ${s.velocity.map(v => `${v.user_id.slice(0, 8)} (${v.completed_24h})`).join(', ')}` : 'Подозрительной активности нет',
    ];
    finOut.innerHTML = lines.map(l => `<div class="quest-j-desc">• ${l}</div>`).join('');
  }));
  finRow.append(finOut);
  box.append(finRow);

  // ── Промокоды (senior+) ──
  adminSub(box, 'Промокоды (senior+)');
  const promoRow = rowEl('inv-item');
  const promoCode = adminInput('Код', '90px');
  const promoAzens = adminInput('AZENS', '60px', 'number');
  const promoSilver = adminInput('Серебро', '70px', 'number');
  const promoMax = adminInput('Лимит', '60px', 'number');
  promoMax.value = '100';
  promoRow.append(promoCode, promoAzens, promoSilver, promoMax);
  promoRow.append(actionButton('Создать', async () => {
    if (!promoCode.value.trim()) { toast('Укажите код', 'error'); return; }
    await api.adminPromoCreate({
      code: promoCode.value.trim(),
      azens: Number(promoAzens.value) || 0,
      silver: Number(promoSilver.value) || 0,
      maxUses: Number(promoMax.value) || 100,
    });
    toast('Промокод создан', 'success');
    await loadAdmin();
  }));
  box.append(promoRow);

  const promoListRow = rowEl('inv-item');
  const promoOut = document.createElement('div');
  promoOut.style.width = '100%';
  promoListRow.append(actionButton('Список промо', async () => {
    const { promos } = await api.adminPromos();
    promoOut.innerHTML = promos.length
      ? promos.slice(0, 20).map(p => `<div class="quest-j-desc">• ${p.code}: AZENS ${p.azens}, использовано ${p.usedCount}/${p.maxUses}</div>`).join('')
      : '<div class="quest-j-desc">Нет промокодов</div>';
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
    `<div class="stat-caption">${t('panels.char_currency')}</div>` +
    statRow(t('panels.char_gold'), `${ch.gold}`) +
    statRow(t('panels.char_azens'), `${ch.azens ?? 0}`) +
    (ch.isfahanSilver ? statRow(t('panels.char_silver'), `${ch.isfahanSilver}`) : '') +
    (ch.syrianGold ? statRow(t('panels.char_syrian'), `${ch.syrianGold}`) : '');
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
      name.textContent = `${f.nameRu} · ${f.weightKg < 1 ? Math.round(f.weightKg * 1000) + ' г' : f.weightKg + ' кг'}`;
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
  'panel-skills': loadSkills,
  'panel-settings': loadSettings,
};

/** Загрузить содержимое панели при открытии (для новых панелей) */
export function loadPanelContent(panelId: string | undefined): void {
  const loader = panelId ? LOADERS[panelId] : undefined;
  if (loader) void loader();
}

// ── Панель навыков и профессий ──────────────────────────────
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
      ? `<div class="inv-item"><b>${profession.nameRu}</b> — ур. ${profession.level} (${profession.xp} XP)</div>`
      : `<div class="inv-item" style="color:var(--cream-dim)">Профессия не выбрана</div>
         <div style="margin-top:8px;display:flex;flex-direction:column;gap:6px">
           ${['warrior','archer','merchant','herbalist','blacksmith','explorer'].map(id => `
             <button class="inv-action" data-prof="${id}">📜 ${id === 'warrior' ? 'Воин' : id === 'archer' ? 'Лучник' : id === 'merchant' ? 'Торговец' : id === 'herbalist' ? 'Травник' : id === 'blacksmith' ? 'Кузнец' : 'Исследователь'} — бесплатно</button>
           `).join('')}
         </div>`;
    profBox.querySelectorAll('[data-prof]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          const res = await api.unlockProfession(charId, (btn as HTMLButtonElement).dataset.prof!);
          toast(`Профессия ${res.profession.nameRu} разблокирована!`, 'success');
          void loadSkills();
        } catch (e) { toast((e as Error).message, 'error'); }
      });
    });
  } catch { /* ignore */ }

  // Навыки
  try {
    const { skills } = await api.getSkills(charId);
    const profId = skills[0]?.professionId;
    skillsBox.innerHTML = skills.length
      ? skills.map(s => `<div class="inv-item"><b>${s.nameRu}</b> — ур.${s.level} ⚡${s.manaCost} 🏃${s.staminaCost}</div>`).join('')
      : '<div class="inv-item" style="color:var(--cream-dim)">Нет изученных навыков</div>';
    if (profId) {
      const { skills: avail } = await api.getProfessionSkills(profId);
      const known = new Set(skills.map(s => s.id));
      const available = avail.filter(s => !known.has(s.id) && s.level <= 30);
      availBox.innerHTML = available.length
        ? available.map(s => `<div class="inv-item"><b>${s.nameRu}</b> — лвл.${s.level} <button class="inv-action" data-skill="${s.id}">Изучить</button></div>`).join('')
        : '';
      availBox.querySelectorAll('[data-skill]').forEach(btn => {
        btn.addEventListener('click', async () => {
          try {
            await api.learnSkill(charId, (btn as HTMLButtonElement).dataset.skill!);
            toast('Навык изучен!', 'success');
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

  $('btn-change-pass')?.addEventListener('click', async () => {
    if (!oldPass.value || !newPass.value || newPass.value !== newPass2.value) {
      toast('Неверно заполнены поля пароля', 'error'); return;
    }
    try {
      await api.changePassword(oldPass.value, newPass.value);
      toast('Пароль изменён!', 'success');
      oldPass.value = ''; newPass.value = ''; newPass2.value = '';
    } catch (e) { toast((e as Error).message, 'error'); }
  });

  $('btn-rename')?.addEventListener('click', async () => {
    if (!newName.value || newName.value.length < 2) {
      toast('Имя должно быть от 2 до 24 символов', 'error'); return;
    }
    try {
      const res = await api.renameCharacter(session.character!.id, newName.value);
      toast(`Ник изменён на "${res.character.name}"!`, 'success');
      newName.value = ''; statusEl.textContent = '';
      void refreshBars();
    } catch (e: any) {
      if (e.code === 'azens_debt' || e.message?.includes('АЗЕН')) {
        statusEl.textContent = `Нужно 500 АЗЭН (у вас: ${session.character?.azens ?? 0})`;
        statusEl.style.color = '#e08080';
      } else {
        toast(e.message, 'error');
      }
    }
  });
}
