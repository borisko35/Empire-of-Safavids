// ============================================================
// NPC Диалоги — Empire of Safavids
// ============================================================
// Интерактивные диалоги с НПС: реплики, выборы, переходы между
// линиями. Открывается при клике по NPC (panel-npc).

import { api } from './api';
import { session } from './state';
import { t } from './i18n';
import { playCutscene, requestCutsceneForQuest, type CutsceneData } from './cutscene';
import { toast } from './hud';
import { onTutorialAction } from './tutorial';

interface DialogLine {
  id: string;
  textRu: string;
  choices?: { labelRu: string; nextId: string; action?: string; questId?: string }[];
}

/** Память NPC: сколько раз говорили и насколько подружились */
interface NpcMemory {
  chatCount: number;
  friendshipLevel: number;
  tone?: 'neutral' | 'friendly' | 'hostile';
}

interface NpcInfo {
  npcId: string;
  nameRu: string;
  role: string;
  region: string;
  line: DialogLine;
  memory?: NpcMemory;
  questsCompleted?: { questId: string; titleRu: string; experience: number; gold: number }[];
}

let currentNpc: NpcInfo | null = null;
let currentLineId: string = '';

/** Открыть диалог с NPC */
export async function openNpcDialogue(npcId: string): Promise<void> {
  const el = document.getElementById('panel-dialog');
  if (!el) return;
  el.classList.remove('hidden');
  el.classList.add('active');
  // Шаг туториала «поговори с NPC» засчитывается здесь
  onTutorialAction('talk_npc', npcId);

  try {
    const data = await api.npcDialog(npcId, undefined, session.character?.id);
    currentNpc = data;
    currentLineId = data.line.id;
    renderDialogue(data);
    // Разговор мог закрыть talk-цель — обновляем журнал и стрелку-навигатор
    if (data.questsCompleted?.length) {
      for (const q of data.questsCompleted) {
        toast(`Квест завершён: ${q.titleRu} (+${q.experience} ${t('world.exp')})`, 'success');
      }
    }
    window.dispatchEvent(new CustomEvent('quest:accepted'));
  } catch (err) {
    toast('Не удалось начать разговор', 'error');
    closeNpcDialogue();
  }
}

/** Закрыть диалог */
export function closeNpcDialogue(): void {
  const el = document.getElementById('panel-dialog');
  if (el) {
    el.classList.add('hidden');
    el.classList.remove('active');
  }
  currentNpc = null;
  currentLineId = '';
}

/** Рендер диалога */
function renderDialogue(data: NpcInfo): void {
  const nameEl = document.getElementById('dialog-npc-name')!;
  const textEl = document.getElementById('dialog-text')!;
  const choicesEl = document.getElementById('dialog-choices')!;

  // Показываем уровень дружбы/тон в заголовке
  const lvl = data.memory?.friendshipLevel ?? 0;
  const tone = data.memory?.tone ?? 'neutral';
  const toneIcon = tone === 'friendly' ? '😊' : tone === 'hostile' ? '😠' : '😐';
  nameEl.textContent = `${data.nameRu} ${toneIcon} Lv.${lvl}`;
  (nameEl as HTMLElement).title = `Дружба ${lvl}/5 tone=${tone}`;
  textEl.textContent = data.line.textRu;

  choicesEl.innerHTML = '';

  // Клиентская ветвление: прячем выборы, не проходящие when (сервер уже отфильтровал, но дублируем)
  const rawChoices = data.line.choices ?? [];
  const choices = rawChoices.filter(c => {
    const w: any = (c as unknown as { when?: Record<string, unknown> }).when;
    if (!w) return true;
    if (w.minLevel && (session.character?.level ?? 1) < (w.minLevel as number)) return false;
    if (w.maxLevel && (session.character?.level ?? 1) > (w.maxLevel as number)) return false;
    // hasItem/minGold/maxGold частично — без инвентаря скрываем если требует предмет
    if (w.hasItem) return false; // сервер уже решил, на клиенте прячем — придёт отфильтровано
    return true;
  });
  if (!choices || choices.length === 0) {
    // Монолог — кнопка закрытия
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'dialog-close-btn';
    closeBtn.textContent = 'Завершить разговор';
    closeBtn.addEventListener('click', closeNpcDialogue);
    choicesEl.appendChild(closeBtn);
  } else {
    for (let i = 0; i < choices.length; i++) {
      const c = choices[i];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dialog-choice-btn';
      btn.textContent = c.labelRu;
      btn.addEventListener('click', () => handleChoice(i));
      choicesEl.appendChild(btn);
    }
  }
}

/** Обработка выбора */
async function handleChoice(choiceIndex: number): Promise<void> {
  if (!currentNpc) return;

  const choice = currentNpc.line.choices?.[choiceIndex];
  if (!choice) return;

  // Квест выдан сервером в POST /dialog (questService.accept) — повторный
  // accept с клиента не нужен: он создавал дубль строки character_quests
  // (до появления уникального индекса) и сбрасывал progress.
  if (choice.action === 'quest' && choice.questId) {
    toast('Квест принят! Проверь панель квестов (J)', 'success');
    // авто-обновим панель квестов без похода в меню
    try { const { loadQuests } = await import('./hud'); await loadQuests(); } catch {}
  }

  // Проверка перемещения к NPC
  if (choice.action === 'move') {
    toast('Направляйтесь к нужному NPC', 'info');
  }

  // Загрузить следующую реплику
  try {
    const data = await api.npcReply(currentNpc.npcId, currentLineId, choiceIndex, session.character?.id);
    currentNpc = {
      npcId: data.npcId,
      nameRu: data.nameRu,
      role: '',
      region: '',
      line: data.nextLine,
      // Раньше memory здесь не переносилась: заголовок «Lv.N» показывался
      // до первого клика по реплике, а после — снова «Lv.0». Игрок решил бы,
      // что дружба обнуляется при каждом ответе
      memory: data.memory
        ? {
            chatCount: data.memory.chatCount,
            friendshipLevel: data.memory.friendshipLevel,
            tone: data.memory.tone as NpcMemory['tone'],
          }
        : undefined,
    };
    currentLineId = data.nextLine.id;
    renderDialogue(currentNpc);
    // Разговор мог закрыть talk-цель / завершить квест — обновить журнал и стрелку
    if (data.questsCompleted?.length) {
      for (const q of data.questsCompleted) {
        toast(`Квест завершён: ${q.titleRu} (+${q.experience} ${t('world.exp')})`, 'success');
        void requestCutsceneForQuest(q.questId);
      }
    }
    // Сюжетная сцена на принятии квеста: сервер прислал её с этим ответом
    if (data.cutscene) {
      playCutscene(data.cutscene as CutsceneData);
    }
    // Дружба выросла. Раньше она не росла нигде, игрок не знал бы, что NPC
    // к нему привязывается, и заголовок диалога всегда показывал Lv.0
    if (data.friendshipUp) {
      toast(t('dialogue.friendship_up'), 'success');
    }
    window.dispatchEvent(new CustomEvent('quest:accepted'));
  } catch (err) {
    toast('Ошибка диалога', 'error');
  }
}

// Привязка кнопки закрытия при загрузке
document.addEventListener('DOMContentLoaded', () => {
  const closeBtn = document.getElementById('dialog-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', closeNpcDialogue);
  }
});
