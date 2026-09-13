// ============================================================
// Игровой мир: сокеты, движение, бой — Empire of Sefevids
// ============================================================
// Протокол: shared/constants.ts (SOCKET_EVENTS / SERVER_EVENTS).

import { socket } from './net';
import { api } from './api';
import { t } from './i18n';
import { Character, session, Vec3 } from './state';
import { World, PlayerEntity } from './entities';
import { loadPanelContent } from './panels';
import { World3D } from './game3d/world3d';
import { audio } from './audio';
import {
  chatMessage, chatVisible, closeChat, hideTarget, loadInventory, loadQuests, loadRegions, updateMinimap,
  loadSkillbar, openChat, refreshBars, setWorldTime, showTarget, startCooldown,
  tickCooldowns, toast,
} from './hud';
import { icon, type IconName } from '../ui/icons';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

const MOVE_SEND_MS = 100;   // частота пакетов движения (лимит анти-чита 30/сек)

let world3d: World3D | null = null;
let world: World | null = null;
let me: PlayerEntity | null = null;
let raf = 0;
let lastFrame = 0;
let lastMoveSent = 0;
let lastMinimapDraw = 0;
let night = 0;
let deathTimer: ReturnType<typeof setTimeout> | null = null;

// ── Вход в мир ───────────────────────────────────────────────

export async function enterWorld(character: Character): Promise<void> {
  session.character = character;
  session.hp = character.hp; session.maxHp = character.maxHp;
  session.mana = character.mana; session.maxMana = character.maxMana;
  session.stamina = character.stamina; session.maxStamina = character.maxStamina;
  session.level = character.level;
  session.experience = character.experience;

  showScreen('screen-world');
  document.querySelectorAll<HTMLElement>('[data-icon]').forEach((el) => {
    el.innerHTML = icon(el.dataset.icon as IconName, 18);
  });
  refreshBars();
  void loadSkillbar();
  void loadRegions();
  void loadQuests();

  world = new World();
  world3d = new World3D();
  world3d.init(document.getElementById('game3d-root') as HTMLElement, {
    onAttack: () => basicAttack(),
    onTarget: (name, hp, maxHp) => showTarget(name, hp, maxHp),
    onTargetCleared: () => hideTarget(),
    onNpc: (panel, name) => {
      // Клик по NPC: открыть связанную панель (кнопкой-переключателем,
      // чтобы не ломать состояние .hidden/.active)
      const btn = document.querySelector<HTMLButtonElement>(`.panel-toggles button[data-panel="${panel}"]`);
      const el = document.getElementById(panel);
      if (btn && el?.classList.contains('hidden')) btn.click();
      else loadPanelContent(panel);
      if (name) toast(`${name} — ${t('panels.npc_greeting')}`, 'info');
    },
  });

  me = {
    id: character.id,
    name: character.name,
    charClass: character.class,
    pos: { ...character.position },
    target: { ...character.position },
    moving: false,
    seed: 0,
    flipped: false,
    isSelf: true,
  };
  world.players.set(me.id, me);
  world3d.attach(world, me);
  audio.ensure();

  // Отладочный хук для e2e-проверок (не влияет на игру)
  (window as unknown as { __eos: unknown }).__eos = {
    get monsters() { return [...(world?.monsters.values() ?? [])].map((m) => ({ id: m.instanceId, name: m.nameRu, x: Math.round(m.pos.x), z: Math.round(m.pos.z), hp: m.hp })); },
    get me() { return me ? { x: Math.round(me.pos.x), z: Math.round(me.pos.z) } : null; },
    get cam() { return world3d?.getCameraPose() ?? null; },
    setCam(yaw: number, pitch: number, dist?: number): void { world3d?.setCameraPose(yaw, pitch, dist); },
    attack(): void { world3d?.attackFromCamera(); },
    setHour(hour: number): void { world3d?.setClock(hour); },
    tp(x: number, z: number): void {
      if (me && world) {
        me.pos.x = x; me.pos.z = z;
        me.target = { ...me.pos };
      }
    },
  };

  wireSocket();
  wireInput();

  if (socket.connected) {
    socket.emit('auth', { token: session.token, characterId: character.id });
  } else {
    socket.connect(); // по 'connect' обработчик сам пришлёт auth
  }
  chatMessage(null, t('world.connecting'), true);
  document.getElementById('chat-log')?.lastElementChild?.setAttribute('data-conn-status', '');

  lastFrame = performance.now();
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(loop);
}

export function leaveWorld(): void {
  cancelAnimationFrame(raf);
  audio.dispose();
  socket.disconnect();
  if (deathTimer) clearTimeout(deathTimer);
  world3d?.dispose();
  world3d = null;
  world = null; me = null;
}

// ── Экраны ───────────────────────────────────────────────────

export function showScreen(id: string): void {
  for (const el of document.querySelectorAll<HTMLElement>('.screen')) {
    el.classList.toggle('hidden', el.id !== id);
  }
}

// ── Сокет-протокол ───────────────────────────────────────────

function wireSocket(): void {
  socket.off();

  socket.on('connect', () => {
    if (session.character) {
      socket.emit('auth', { token: session.token, characterId: session.character.id });
    }
  });

  socket.on('auth:success', ({ character }: { character: Character }) => {
    // Снять строку «Подключение к серверу…» и подтвердить вход в мир
    const log = document.getElementById('chat-log');
    log?.querySelector('[data-conn-status]')?.remove();
    chatMessage(null, t('world.connected'), true);
    if (me && world) {
      me.target = { ...character.position };
      me.pos = { ...character.position };
    }
  });

  socket.on('auth:error', ({ message }: { message: string }) => {
    toast(`${t('common.error')}: ${message}`, 'error');
    showLostScreen(message);
  });

  socket.on('player:joined', ({ characterId, name, charClass, position }: { characterId: string; name: string; charClass?: string; position: Vec3 }) => {
    if (!world || characterId === me?.id) return;
    world.players.set(characterId, {
      id: characterId, name, charClass: charClass ?? 'qizilbash',
      pos: { ...position }, target: { ...position }, moving: false,
      seed: characterId.length, flipped: false,
    });
    chatMessage(null, `${name} — ${t('world.online')}`, true);
  });

  socket.on('player:moved', ({ characterId, position }: { characterId: string; position: Vec3 }) => {
    const p = world?.players.get(characterId);
    if (p) p.target = { ...position };
  });

  socket.on('player:left', ({ characterId }: { characterId: string }) => {
    const p = world?.players.get(characterId);
    if (p && world) {
      chatMessage(null, `${p.name} — ${t('badges.statuses.offline')}`, true);
      world.players.delete(characterId);
    }
  });

  // ── Монстры ──
  socket.on('monster:spawned', (payload: { instanceId: string; monsterId: string; nameRu: string; position: Vec3; hp: number; maxHp?: number; type: string }) => {
    if (!world) return;
    world.monsters.set(payload.instanceId, {
      instanceId: payload.instanceId,
      monsterId: payload.monsterId,
      nameRu: payload.nameRu,
      type: payload.type,
      pos: { ...payload.position },
      target: { ...payload.position },
      speed: 3.5,
      hp: payload.hp,
      maxHp: payload.maxHp ?? payload.hp,
      deadAt: 0,
      seed: payload.instanceId.length % 2,
    });
  });

  socket.on('monster:ai_action', ({ instanceId, action }: { instanceId: string; action: { type: string; destination?: Vec3; targetId?: string; skillId?: string } }) => {
    const m = world?.monsters.get(instanceId);
    if (!m) return;
    if (action.destination) {
      m.target = { ...action.destination };
      m.speed = 3.2;
    }
    if ((action.type === 'attack' || action.type === 'skill') && action.targetId && world) {
      const victim = world.players.get(action.targetId);
      if (victim) {
        world.addEffect('hit', m.pos.x, m.pos.z, victim.pos.x, victim.pos.z, '#e07a4a');
      }
    }
  });

  socket.on('monster:killed', ({ instanceId, killerId, expReward, gold, loot, leveledUp, newLevel }: {
    instanceId: string; killerId: string; expReward: number;
    gold?: number; loot?: { itemId: string; nameRu: string; qty: number }[];
    leveledUp?: boolean; newLevel?: number;
  }) => {
    const w = world;
    const m = w?.monsters.get(instanceId);
    if (!w || !m) return;
    m.deadAt = performance.now();
    w.addFloater(m.pos.x, m.pos.z - 1.2, '☠', '#F4D26C');
    setTimeout(() => world?.monsters.delete(instanceId), 950);
    audio.kill();
    if (killerId === me?.id) {
      session.kills[m.monsterId] = (session.kills[m.monsterId] ?? 0) + 1;
      session.experience += expReward;
      w.addFloater(m.pos.x, m.pos.z - 0.8, `+${expReward} ${t('world.exp')}`, '#F4D26C');
      if (gold) {
        if (session.character) session.character.gold += gold;
        w.addFloater(m.pos.x, m.pos.z - 0.3, `+${gold} ◉`, '#F4D26C');
      }
      if (loot?.length) {
        const line = `${t('world.loot')}: ${loot.map(l => `${l.nameRu} ×${l.qty}`).join(', ')}`;
        chatMessage(null, line, true);
        toast(line, 'success');
      }
      if (leveledUp && newLevel) {
        session.level = newLevel;
        audio.levelUp();
        toast(`${t('world.levelup')} ${newLevel}!`, 'success');
        void loadRegions();
        void loadQuests();
      }
      void loadQuests();
      void loadInventory();
      refreshBars();
    }
  });

  // Квест завершён сервером: награды уже начислены в БД
  socket.on('quest:completed', ({ quests }: {
    quests: {
      questId: string; titleRu: string; experience: number; gold: number;
      items: { nameRu: string; quantity: number }[]; leveledUp?: boolean; newLevel?: number;
    }[];
  }) => {
    for (const q of quests) {
      const items = q.items?.length ? ` · ${q.items.map((i) => `${i.nameRu} ×${i.quantity}`).join(', ')}` : '';
      toast(`${t('world.quest_completed')}: ${q.titleRu} (+${q.experience} ${t('world.exp')}, +${q.gold} ◉${items})`, 'success');
      if (q.leveledUp && q.newLevel) {
        session.level = q.newLevel;
        audio.levelUp();
        toast(`${t('world.levelup')} ${q.newLevel}!`, 'success');
      }
    }
    void loadQuests();
    void loadInventory();
    refreshBars();
  });

  // ── Бой ──
  socket.on('combat:result', (r: { attackerId: string; targetId: string; damage: number; isCritical: boolean; isBlocked: boolean; isDodged: boolean; targetHp?: number; targetMaxHp?: number }) => {
    if (!world) return;
    const attacker = world.players.get(r.attackerId);
    const target = world.monsters.get(r.targetId) ?? world.players.get(r.targetId);
    if (!attacker || !target) return;
    if (r.attackerId === me?.id) {
      if (r.isDodged) {
        world.addFloater(target.pos.x, target.pos.z - 1, t('world.dodge'), '#cfe3f0');
      } else {
        world.addEffect('slash', attacker.pos.x, attacker.pos.z, target.pos.x, target.pos.z, r.isCritical ? '#F4D26C' : '#e8e2d2');
        world.addFloater(
          target.pos.x, target.pos.z - 1,
          `-${r.damage}${r.isCritical ? '!' : r.isBlocked ? ' ⛨' : ''}`,
          r.isCritical ? '#F4D26C' : '#ffffff', r.isCritical,
        );
        const m = world.monsters.get(r.targetId);
        if (m && r.targetHp != null) m.hp = r.targetHp;
        if (r.targetId === world.targetId && r.targetHp != null) {
          showTarget(m?.nameRu ?? '', r.targetHp, r.targetMaxHp ?? m?.maxHp ?? 1);
        }
      }
    }
  });

  socket.on('combat:hit', (r: { damage: number; isDodged: boolean; isBlocked: boolean; hp: number; maxHp: number }) => {
    session.hp = r.hp;
    session.maxHp = r.maxHp;
    if (world && me) {
      if (r.isDodged) world.addFloater(me.pos.x, me.pos.z - 1, t('world.dodge'), '#cfe3f0');
      else world.addFloater(me.pos.x, me.pos.z - 1, `-${r.damage}`, '#ff8d7e', true);
    }
    audio.hit();
    refreshBars();
  });

  // Периодический синк ресурсов с сервера (регенерация, золото, уровень)
  socket.on('player:resources', (r: {
    hp: number; maxHp: number; mana: number; maxMana: number;
    stamina: number; maxStamina: number; level: number; experience: number; gold: number;
  }) => {
    session.hp = r.hp; session.maxHp = r.maxHp;
    session.mana = r.mana; session.maxMana = r.maxMana;
    session.stamina = r.stamina; session.maxStamina = r.maxStamina;
    session.level = r.level; session.experience = r.experience;
    if (session.character) session.character.gold = r.gold;
    refreshBars();
  });

  socket.on('combat:heal', (r: { targetId: string; heal: number; hp: number; maxHp: number }) => {
    if (!world || !me) return;
    const target = world.players.get(r.targetId);
    if (target) world.addEffect('heal', target.pos.x, target.pos.z, target.pos.x, target.pos.z, '#6ecf7a');
    if (r.targetId === me.id) {
      session.hp = r.hp;
      session.maxHp = r.maxHp;
      world.addFloater(me.pos.x, me.pos.z - 1, `+${r.heal}`, '#6ecf7a');
      refreshBars();
    }
  });

  socket.on('combat:error', ({ message }: { message: string }) => toast(message, 'error'));

  socket.on('combat:visual', (v: { attackerId: string; targetId: string }) => {
    if (!world || v.attackerId === me?.id) return; // свой урон уже отрисован по combat:result
    const a = world.players.get(v.attackerId);
    const b = world.monsters.get(v.targetId) ?? world.players.get(v.targetId);
    if (a && b) world.addEffect('slash', a.pos.x, a.pos.z, b.pos.x, b.pos.z, '#b9c8d6');
  });

  // ── Смерть и возрождение ──
  socket.on('player:died', () => {
    document.getElementById('overlay-death')?.classList.remove('hidden');
    audio.playerDeath();
    if (me) world?.addFloater(me.pos.x, me.pos.z - 1, t('world.died'), '#ff8d7e');
  });

  socket.on('player:respawned', ({ hp, maxHp, position }: { hp: number; maxHp: number; position: Vec3 }) => {
    document.getElementById('overlay-death')?.classList.add('hidden');
    session.hp = hp;
    session.maxHp = maxHp;
    if (me) {
      me.pos = { ...position };
      me.target = { ...position };
    }
    toast(t('world.respawned'), 'success');
    refreshBars();
  });

  // ── Чат ──
  const chatEvents = ['chat:world', 'chat:region'] as const;
  for (const ev of chatEvents) {
    socket.on(ev, ({ characterId, message }: { characterId: string; message: string }) => {
      const p = world?.players.get(characterId);
      chatMessage(p?.name ?? '???', message);
    });
  }

  socket.on('notification', (msg: { message?: string; text?: string; title?: string }) => {
    toast(msg.message ?? msg.text ?? msg.title ?? '', 'info');
  });

  socket.on('world:time', (payload: Record<string, unknown>) => {
    setWorldTime(payload);
    const tod = String(payload.timeOfDay ?? '');
    night = tod === 'night' || tod === 'midnight' ? 1 : tod === 'evening' || tod === 'dawn' ? 0.5 : 0;
    const hour = Number(payload.gameHour ?? payload.hour);
    if (Number.isFinite(hour)) world3d?.setClock(hour);
  });

  socket.on('move:rejected', ({ reason }: { reason?: string }) => {
    if (me && session.character) {
      me.pos = { ...session.character.position };
      me.target = { ...session.character.position };
    }
    toast(reason ?? 'move rejected', 'error');
  });

  socket.on('force:disconnect', ({ reason }: { reason: string }) => {
    showLostScreen(reason);
  });

  socket.on('disconnect', (reason: string) => {
    if (reason === 'io server disconnect' || reason === 'transport close') {
      showLostScreen('disconnect');
    }
  });
}

function showLostScreen(reason: string): void {
  const el = document.getElementById('overlay-lost');
  if (!el) return;
  (document.getElementById('lost-reason') as HTMLElement).textContent = reason;
  el.classList.remove('hidden');
  setTimeout(() => {
    leaveWorld();
    // Возврат к выбору персонажа
    void import('./main').then((m) => m.gotoCharacters());
  }, 2200);
}

// ── Ввод ─────────────────────────────────────────────────────

function wireInput(): void {
  window.onkeydown = (e) => {
    if (chatVisible()) return;
    if (e.code === 'Enter') {
      e.preventDefault();
      // Чат требует курсора: выходим из pointer lock, если захвачен 3D-движком
      if (document.pointerLockElement) document.exitPointerLock();
      openChat();
    } else if (e.code === 'Escape') {
      document.getElementById('overlay-menu')?.classList.toggle('hidden');
    } else if (/^Digit[1-4]$/.test(e.code)) {
      const idx = Number(e.code.slice(5)) - 1;
      const skill = session.skills[idx];
      if (skill) useSkill(skill.id);
    }
  };

  window.addEventListener('game:skill', (e) => useSkill((e as CustomEvent<string>).detail));

  $('btn-continue')?.addEventListener('click', () => document.getElementById('overlay-menu')?.classList.add('hidden'));
  $('btn-exit')?.addEventListener('click', () => {
    document.getElementById('overlay-menu')?.classList.add('hidden');
    void api.logout().catch(() => {});
    leaveWorld();
    void import('./main').then((m) => m.logoutLocal());
  });

  // Чат: отправка
  ($('chat-form') as HTMLFormElement).onsubmit = (e) => {
    e.preventDefault();
    const input = $('chat-text') as HTMLInputElement;
    const text = input.value.trim();
    if (text && socket.connected) {
      socket.emit('chat:message', {
        message: text,
        channel: ($('chat-channel') as HTMLSelectElement).value,
      });
      input.value = '';
    }
    closeChat();
  };

  // Переключатели панелей
  for (const btn of document.querySelectorAll<HTMLButtonElement>('.panel-toggles button')) {
    btn.addEventListener('click', () => {
      const panel = document.getElementById(btn.dataset.panel!);
      panel?.classList.toggle('hidden');
      btn.classList.toggle('active', !panel?.classList.contains('hidden'));
      if (btn.dataset.panel === 'panel-regions') void loadRegions();
      if (btn.dataset.panel === 'panel-quests') void loadQuests();
      if (btn.dataset.panel === 'panel-inventory') void loadInventory();
      loadPanelContent(btn.dataset.panel);
    });
  }
}

// ── Бой ──────────────────────────────────────────────────────

function emitCombat(actionType: 'attack' | 'skill', skillId?: string): void {
  if (!me || !world || !session.character) return;
  if (!world.targetId) {
    toast(t('world.attack_hint'), 'info');
    return;
  }
  socket.emit('combat:action', {
    characterId: me.id,
    actionType,
    skillId,
    targetId: world.targetId,
    position: me.pos,
    direction: world3d?.moveDir ?? { x: 0, y: 0, z: 1 },
    timestamp: Date.now(),
  });
}

function basicAttack(): void {
  emitCombat('attack');
}

function useSkill(skillId: string): void {
  const skill = session.skills.find((s) => s.id === skillId);
  if (!skill) return;
  if (skill.manaCost > session.mana || skill.staminaCost > session.stamina) {
    toast(`${t('common.error')}: ${t('world.mana')}/${t('world.stamina')}`, 'error');
    return;
  }
  // Локальный расход и кулдаун (сервер перепроверит)
  session.mana -= skill.manaCost;
  session.stamina -= skill.staminaCost;
  startCooldown(skillId, skill.cooldown);
  refreshBars();
  emitCombat('skill', skillId);
}

// ── Игровой цикл ─────────────────────────────────────────────

function loop(now: number): void {
  raf = requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;

  if (!world || !me) return;

  // Сетевые сущности: интерполяция чужих игроков/монстров, чистка FX
  world.update(dt);

  // 3D-движок: управление мной, физика, риги, камера, рендер
  world3d?.update(dt, now, night);

  // Пакеты движения — по факту позиции, которую задал 3D-движок
  if (me.moving && now - lastMoveSent > MOVE_SEND_MS) {
    lastMoveSent = now;
    socket.emit('player:move', {
      position: { ...me.pos },
      direction: world3d?.moveDir ?? { x: 0, y: 0, z: 1 },
    });
  }

  // Ресурсы: медленная регенерация (косметика, сервер перепроверит)
  session.mana = Math.min(session.maxMana, session.mana + session.maxMana * 0.02 * dt);
  session.stamina = Math.min(session.maxStamina, session.stamina + session.maxStamina * 0.035 * dt);
  if (Math.random() < dt * 0.5) refreshBars();

  tickCooldowns();

  // Мини-карта: игрок в центре, монстры вокруг (раз в ~0.5с)
  if (now - lastMinimapDraw > 500) {
    lastMinimapDraw = now;
    updateMinimap(
      { x: me.pos.x, z: me.pos.z },
      [...world.monsters.values()].map((m) => ({ x: m.pos.x, z: m.pos.z })),
    );
  }
}
