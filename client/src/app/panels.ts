// ============================================================
// Панели: данжи, магазин, крафт, аукцион, группа, караваны
// ============================================================
// Рендеры следуют стилю loadInventory (hud.ts): строки-карточки с
// кнопками-действиями; ошибки — тосты. Данные серверные, оптимизм
// не используется: после действия — перезагрузка панели.

import { api } from './api';
import { t } from './i18n';
import { session } from './state';
import { toast, refreshBars, loadInventory } from './hud';

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

export async function loadShop(): Promise<void> {
  if (!session.character) return;
  try {
    const { shops } = await api.shops();
    const box = $('shop-list');
    if (!box) return;
    box.innerHTML = '';
    for (const shop of shops) {
      const head = document.createElement('div');
      head.className = 'panel-subhead';
      head.textContent = shop.nameRu;
      box.append(head);
      for (const item of shop.items) {
        if (item.currency !== 'gold') continue;
        const row = rowEl('inv-item');
        const label = document.createElement('span');
        label.className = 'inv-name';
        label.textContent = item.itemId;
        const price = document.createElement('span');
        price.className = 'inv-qty';
        price.textContent = `◉ ${item.price}`;
        row.append(label, price);
        row.append(actionButton(t('panels.buy'), async () => {
          const res = await api.shopBuy(shop.id, cid(), item.itemId);
          session.character && (session.character.gold = res.gold);
          refreshBars();
          toast(t('panels.bought'), 'success');
          await loadShop();
        }));
        box.append(row);
      }
    }
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
      emptyBox(box);
      return;
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
  } catch {
    /* панель недоступна */
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

export async function loadTrade(): Promise<void> {
  if (!session.character) return;
  try {
    const { contracts } = await api.tradeContracts();
    const box = $('trade-list');
    if (!box) return;
    box.innerHTML = '';
    if (!contracts.length) {
      emptyBox(box);
      return;
    }
    for (const c of contracts) {
      const row = rowEl('inv-item');
      const label = document.createElement('span');
      label.className = 'inv-name';
      label.textContent = `${c.nameRu} · ${c.cargoNameRu} ×${c.cargoQty} → ◉ ${c.rewardGold}`;
      row.append(label);
      row.append(actionButton(t('panels.trade_accept'), async () => {
        await api.tradeAccept(cid(), c.id);
        toast(t('panels.trade_accepted'), 'success');
      }));
      box.append(row);
    }
    const deliverRow = rowEl('inv-item dungeon-status');
    const hint = document.createElement('span');
    hint.className = 'inv-name';
    hint.textContent = t('panels.trade_hint');
    deliverRow.append(hint);
    deliverRow.append(actionButton(t('panels.trade_deliver'), async () => {
      const res = await api.tradeDeliver(cid());
      session.character && (session.character.gold += res.gold);
      refreshBars();
      toast(`${t('panels.trade_done')}: +◉ ${res.gold}`, 'success');
    }));
    deliverRow.append(actionButton(t('panels.trade_cancel'), async () => {
      await api.tradeCancel(cid());
      toast(t('panels.trade_cancelled'), 'info');
    }));
    box.append(deliverRow);
  } catch {
    /* панель недоступна */
  }
}

// ── Диспетчер панелей ────────────────────────────────────────

const LOADERS: Record<string, () => Promise<void>> = {
  'panel-dungeons': loadDungeons,
  'panel-shop': loadShop,
  'panel-craft': loadCraft,
  'panel-auction': loadAuction,
  'panel-party': loadParty,
  'panel-trade': loadTrade,
};

/** Загрузить содержимое панели при открытии (для новых панелей) */
export function loadPanelContent(panelId: string | undefined): void {
  const loader = panelId ? LOADERS[panelId] : undefined;
  if (loader) void loader();
}
