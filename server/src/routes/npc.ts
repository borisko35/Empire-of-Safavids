// ============================================================
// NPC Routes v2 — Empire of Safavids
// ============================================================
// Интеллект НПС: память о игроке, динамические диалоги.

import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import { getNpcDialogue, NPC_DIALOGUES } from '../data/npcDialogues';
import { getNpcDynamicProfile } from '../data/npcDynamicProfiles';
import { NpcMemoryService } from '../services/NpcMemoryService';
import { checkCondition, getEligibleLines, pickRandomLine, NpcContext } from '../services/NpcIntelligenceService';
import { QuestService } from '../services/QuestService';
import { CharacterService } from '../services/CharacterService';

export const npcRouter = Router();
const memoryService = new NpcMemoryService();
const questService = new QuestService();
const characterService = new CharacterService();

/**
 * Персонаж для NPC-роутов: characterId приходит от клиента
 * (query/body), владение проверяется по req.userId.
 * Ошибка уже отправлена в ответе, если вернули null.
 */
async function resolveNpcCharacter(req: Request, res: Response) {
  const characterId = (req.query.characterId as string | undefined)
    ?? (req.body as { characterId?: string } | undefined)?.characterId;
  if (!characterId) {
    res.status(400).json({ error: 'characterId is required' });
    return null;
  }
  const character = await characterService.getCharacterById(characterId).catch(() => null);
  if (!character || character.userId !== req.userId) {
    res.status(404).json({ error: 'Character not found' });
    return null;
  }
  return character;
}

npcRouter.get('/info', authMiddleware, (_req: Request, res: Response) => {
  const npcs = NPC_DIALOGUES.map((d: any) => ({
    npcId: d.npcId,
    nameRu: d.nameRu,
    role: d.role,
    region: d.region,
    helloLineId: d.helloLine,
  }));
  res.json({ npcs });
});

npcRouter.get('/:npcId/dialog', authMiddleware, async (req: Request, res: Response) => {
  const dialogue = getNpcDialogue(req.params.npcId);
  if (!dialogue) return res.status(404).json({ error: 'NPC not found' });

  const character = await resolveNpcCharacter(req, res);
  if (!character) return;
  const characterId = character.id;
  const memory = await memoryService.getMemory(req.params.npcId, characterId);
  const chatCount = await memoryService.getChatCount(req.params.npcId, characterId);

  // Разговор состоялся — засчитать talk-цели квестов сразу при открытии,
  // не дожидаясь клика по реплике (иначе стрелка-навигатор не двигалась)
  const questsCompleted = await questService.recordTalk(characterId, req.params.npcId).catch(() => []);

  const questState = await questService.getState(characterId).catch(() => []);
  const activeQuestIds = questState.filter((s: any) => s.status === 'active').map((s: any) => s.questId);
  const completedQuestIds = questState.filter((s: any) => s.status === 'completed').map((s: any) => s.questId);
  const inventory = await characterService.getItemQuantities(characterId).catch(() => ({} as Record<string, number>));

  const ctx: NpcContext = {
    characterId,
    characterLevel: character.level,
    activeQuestIds,
    completedQuestIds,
    gold: character.gold,
    region: character.region,
    gameHour: Math.floor(Date.now() / 3600000) % 24,
    inventory,
  } as unknown as NpcContext;

  let lineId = req.query.line as string ?? dialogue.helloLine;

  // Первое знакомство
  if (chatCount === 0 && memory.firstMeetingPhrases?.length) {
    const phrases = memory.firstMeetingPhrases;
    const randomPhrase = phrases[Math.floor(Math.random() * phrases.length)];
    return res.json({
      npcId: dialogue.npcId,
      nameRu: dialogue.nameRu,
      role: dialogue.role,
      region: dialogue.region,
      line: { id: 'first_meeting', textRu: randomPhrase, choices: [{ labelRu: 'Продолжить', nextId: dialogue.helloLine }] },
      memory: { chatCount, friendshipLevel: memory.friendshipLevel },
      questsCompleted,
    });
  }

  // Дружеское приветствие
  if (memory.friendshipLevel >= 2 && Math.random() < 0.3) {
    const friendlyLine = dialogue.greetings?.level2 ?? dialogue.lines[dialogue.helloLine]?.textRu ?? 'Привет!';
    return res.json({
      npcId: dialogue.npcId,
      nameRu: dialogue.nameRu,
      role: dialogue.role,
      region: dialogue.region,
      line: { id: 'friendly', textRu: friendlyLine, choices: [{ labelRu: 'Продолжить', nextId: dialogue.helloLine }] },
      memory: { chatCount, friendshipLevel: memory.friendshipLevel },
      questsCompleted,
    });
  }

  let line = dialogue.lines[lineId];
  if (!line) return res.status(404).json({ error: 'Line not found' });

  // Случайные реплики при повторных разговорах
  if (chatCount > 0 && lineId !== dialogue.helloLine && dialogue.randomLines) {
    const randomPool: Record<string, any> = {};
    for (const rl of dialogue.randomLines) {
      if (await checkCondition(rl.when, ctx)) {
        randomPool[rl.id] = rl;
      }
    }
    const eligibleRandom = await getEligibleLines(randomPool, ctx);
    const randomId = pickRandomLine(eligibleRandom, [lineId]);
    if (randomId && dialogue.lines[randomId]) {
      line = dialogue.lines[randomId];
    }
  }

  // Ветвление: фильтруем выборы по условиям (уровень/золото/регион/час/предмет/квест)
  if (line.choices?.length) {
    const filtered: typeof line.choices = [];
    for (const ch of line.choices) {
      const when: any = (ch as unknown as { when?: unknown }).when;
      if (!when || await checkCondition(when as never, ctx)) filtered.push(ch);
    }
    line = { ...line, choices: filtered };
  }
  // Тон из памяти — подмешиваем в ответ для клиента
  const toneLine = (memory as unknown as { tone?: string }).tone ?? 'neutral';
  // LLM-хинт не отправляем клиенту в открытую, но логируем для будущего LLM
  // console.log(build hint) — оставим в памяти

  res.json({
    npcId: dialogue.npcId,
    nameRu: dialogue.nameRu,
    role: dialogue.role,
    region: dialogue.region,
    line,
    memory: { chatCount, friendshipLevel: memory.friendshipLevel, tone: toneLine },
    questsCompleted,
  });
});

npcRouter.post('/:npcId/dialog', authMiddleware, async (req: Request, res: Response) => {
  const dialogue = getNpcDialogue(req.params.npcId);
  if (!dialogue) return res.status(404).json({ error: 'NPC not found' });

  const character = await resolveNpcCharacter(req, res);
  if (!character) return;
  const characterId = character.id;
  const { lineId, choiceIndex } = req.body as { lineId?: string; choiceIndex?: number };
  const memory = await memoryService.getMemory(req.params.npcId, characterId);
  const chatCount = await memoryService.incrementChat(req.params.npcId, characterId);
  await memoryService.updateLastInteraction(req.params.npcId, characterId);

  if (choiceIndex === undefined && !lineId) {
    const line = dialogue.lines[dialogue.helloLine];
    return res.json({ npcId: dialogue.npcId, nameRu: dialogue.nameRu, line, memory: { chatCount, friendshipLevel: memory.friendshipLevel } });
  }

  const currentLine = dialogue.lines[lineId ?? dialogue.helloLine];
  if (!currentLine || !currentLine.choices) return res.status(400).json({ error: 'No choices available' });

  if (choiceIndex === undefined) {
    return res.json({ npcId: dialogue.npcId, nameRu: dialogue.nameRu, line: currentLine, memory: { chatCount, friendshipLevel: memory.friendshipLevel } });
  }

  const choice = currentLine.choices[choiceIndex];
  if (!choice) return res.status(400).json({ error: 'Invalid choice index' });

  // Обработка квестов — напрямую через QuestService, без похода в панель
  if (choice.action === 'quest' && choice.questId) {
    if (memory.givenQuests.includes(choice.questId)) {
      return res.json({
        npcId: dialogue.npcId,
        nameRu: dialogue.nameRu,
        line: { id: 'already_given', textRu: 'Я уже давал тебе это задание. Иди и выполни!', choices: [{ labelRu: 'Понятно', nextId: 'bye' }] },
        memory: { chatCount, friendshipLevel: memory.friendshipLevel },
      });
    }
    // Прямая выдача квеста — источник истины QuestService
    const acceptRes = await questService.accept(characterId, choice.questId);
    if (!acceptRes.ok) {
      const msg = acceptRes.code === 'quest_level_low' ? 'Ты ещё не дорос до этого задания.' : acceptRes.code === 'quest_locked' ? 'Сначала заверши предыдущие задания.' : 'Не удалось взять квест.';
      return res.json({
        npcId: dialogue.npcId,
        nameRu: dialogue.nameRu,
        line: { id: 'quest_denied', textRu: msg, choices: [{ labelRu: 'Понятно', nextId: 'bye' }] },
        memory: { chatCount, friendshipLevel: memory.friendshipLevel },
      });
    }
    await memoryService.addGivenQuest(req.params.npcId, characterId, choice.questId);
  }

  let nextLine = dialogue.lines[choice.nextId];
  if (!nextLine) return res.status(404).json({ error: 'Next line not found' });

  // Ветвление следующей реплики тоже фильтруем выборы
  if (nextLine.choices?.length) {
    const qs2 = await questService.getState(characterId).catch(() => [] as unknown as { questId: string; status: string }[]);
    const activeQuestIds2 = (qs2 as unknown as { questId: string; status: string }[]).filter(s => s.status === 'active').map(s => s.questId);
    const completedQuestIds2 = (qs2 as unknown as { questId: string; status: string }[]).filter(s => s.status === 'completed').map(s => s.questId);
    const ctx2 = {
      characterId, characterLevel: character.level, activeQuestIds: activeQuestIds2,
      completedQuestIds: completedQuestIds2, gold: character.gold, region: character.region,
      gameHour: Math.floor(Date.now() / 3600000) % 24,
      inventory: await characterService.getItemQuantities(characterId).catch(() => ({} as Record<string, number>)),
    } as unknown as NpcContext;
    const filteredNext: typeof nextLine.choices = [];
    for (const ch of nextLine.choices) {
      const when: any = (ch as unknown as { when?: unknown }).when;
      if (!when || await checkCondition(when as never, ctx2)) filteredNext.push(ch);
    }
    nextLine = { ...nextLine, choices: filteredNext };
  }

  // Модификация ответа при выполнении квеста
  let modifiedLine = { ...nextLine };
  if (choice.action === 'quest' && choice.questId && memory.completedQuests.includes(choice.questId)) {
    const dynamicProfile = getNpcDynamicProfile(req.params.npcId);
    if (dynamicProfile?.questCompletePhrases?.length) {
      modifiedLine = {
        ...modifiedLine,
        textRu: dynamicProfile.questCompletePhrases[Math.floor(Math.random() * dynamicProfile.questCompletePhrases.length)],
      };
    }
  }

  res.json({ npcId: dialogue.npcId, nameRu: dialogue.nameRu, choice, nextLine: modifiedLine, memory: { chatCount, friendshipLevel: memory.friendshipLevel, tone: (memory as unknown as { tone?: string }).tone ?? 'neutral' }, questsCompleted: await questService.recordTalk(characterId, req.params.npcId).catch(() => []) });
});

npcRouter.post('/:npcId/complete-quest', authMiddleware, async (req: Request, res: Response) => {
  const { questId } = req.body as { questId?: string };
  if (!questId) return res.status(400).json({ error: 'questId is required' });

  const character = await resolveNpcCharacter(req, res);
  if (!character) return;
  const characterId = character.id;
  await memoryService.addCompletedQuest(req.params.npcId, characterId, questId);

  const memory = await memoryService.getMemory(req.params.npcId, characterId);
  memory.friendshipLevel = Math.min(5, memory.friendshipLevel + 1);
  await memoryService.saveMemory(req.params.npcId, characterId, memory);

  const phrases = ['Ты действительно помог!', 'Благодарю за помощь!', 'Империя будет помнить твое дело.', 'Ты настоящий герой!'];
  await memoryService.addNote(req.params.npcId, characterId, phrases[Math.floor(Math.random() * phrases.length)]);

  res.json({ success: true, friendshipLevel: memory.friendshipLevel });
});

npcRouter.get('/:npcId/memory', authMiddleware, async (req: Request, res: Response) => {
  const character = await resolveNpcCharacter(req, res);
  if (!character) return;
  const characterId = character.id;
  const memory = await memoryService.getMemory(req.params.npcId, characterId);
  const chatCount = await memoryService.getChatCount(req.params.npcId, characterId);
  res.json({ npcId: req.params.npcId, memory: { ...memory, chatCount } });
});
