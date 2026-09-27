// ============================================================
// Сюжет: главы и кат-сцены — API routes
// ============================================================
// Сцену отдаём один раз: при срабатывании помечаем просмотренной.
// Иначе игрок перебором id прочитал бы весь сюжет заранее —
// на клиенте сцена лежит обычным списком строк.

import { Router, Request, Response } from 'express';
import { StoryService } from '../services/StoryService';
import { CUTSCENES } from '../data/cutscenes';
import { secureMiddleware } from '../middleware/auth';
import { CharacterService } from '../services/CharacterService';

const router = Router();
const story = new StoryService();
const characters = new CharacterService();

/** Свой персонаж по id — иначе можно было бы смотреть чужой сюжет */
async function ownCharacter(req: Request, res: Response) {
  const characterId = String(req.body?.characterId ?? req.query.characterId ?? '');
  if (!characterId) {
    res.status(400).json({ error: 'characterId required' });
    return null;
  }
  const character = await characters.getCharacterById(characterId).catch(() => null);
  if (!character || character.userId !== req.userId) {
    res.status(403).json({ error: 'Character does not belong to you' });
    return null;
  }
  return character;
}

// GET /api/story/state — главы, прогресс и какие сцены уже просмотрены
router.get('/state', secureMiddleware, async (req: Request, res: Response) => {
  const character = await ownCharacter(req, res);
  if (!character) return;
  const state = await story.getState(character.id, character.level);
  res.json({ ...state, cutscenesTotal: CUTSCENES.length });
});

// POST /api/story/cutscene/take — забрать сцену по событию квеста.
// Клиент дёргает это после завершения квеста: так покрыты все пути
// завершения (бой, диалог, квест из панели) без правки каждого.
router.post('/cutscene/take', secureMiddleware, async (req: Request, res: Response) => {
  const character = await ownCharacter(req, res);
  if (!character) return;
  const { questId, trigger } = req.body as { questId?: string; trigger?: 'accept' | 'complete' };
  if (!questId || (trigger !== 'accept' && trigger !== 'complete')) {
    return res.status(400).json({ error: 'questId and trigger are required' });
  }
  const cutscene = await story.takeCutscene(character.id, questId, trigger);
  res.json({ cutscene });
});

// POST /api/story/cutscene/skipped — игрок нажал «пропустить».
// Отметка нужна, чтобы при повторном событии квеста сцена не всплыла снова.
router.post('/cutscene/skipped', secureMiddleware, async (req: Request, res: Response) => {
  const character = await ownCharacter(req, res);
  if (!character) return;
  const { cutsceneId } = req.body as { cutsceneId?: string };
  if (!cutsceneId) return res.status(400).json({ error: 'cutsceneId required' });
  await story.markSkipped(character.id, cutsceneId);
  res.json({ success: true });
});

export default router;
