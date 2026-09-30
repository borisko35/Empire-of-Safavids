// ============================================================
// Guild Routes — Empire of Safavids
// ============================================================

import { Router } from 'express';
import { GuildService } from '../services/GuildService';
import { CharacterService } from '../services/CharacterService';
import { authMiddleware } from '../middleware/auth';
// Право ранга, справочник навыков и цена уровня нужны маршруту GET /skills:
// он сам решает, что показать кнопкой, а что - зачёркнутым пунктом.
import { getGuildRankPermissions } from '../data/guilds';
import { GUILD_SKILLS } from '../data/guilds';
import { isSkillWired, upgradeCost } from '../systems/GuildBonuses';

const router = Router();
const guilds = new GuildService();
const characters = new CharacterService();

/**
 * Персонаж текущего игрока.
 *
 * ТУТ БЫЛА ПОЛОМКА, ИДУЩАЯ ЧЕРЕДОЙ: этот файл целиком передавал сервису
 * req.userId — идентификатор АККАУНТА, а GuildService ищет по character_id
 * (guild_members.character_id, characters.id). Это разные числа, поэтому
 * getGuildByCharacter возвращал null, и панель гильдий показывала «вы не в
 * гильдии» игроку, который в гильдии состоял. Ровно та же ошибка, что была с
 * задачами дня, репутацией и башней.
 *
 * Персонаж запрашивается явно (тело запроса или ?characterId=) и
 * проверяется на принадлежность аккаунту.
 */
async function ownCharacterId(req: any): Promise<string | null> {
  const characterId = String(req.body?.characterId ?? req.query?.characterId ?? '');
  if (!characterId) return null;
  const character = await characters.getCharacterById(characterId);
  return character && character.userId === req.userId ? characterId : null;
}

router.get('/', authMiddleware, async (req: any, res) => {
  try {
    const characterId = await ownCharacterId(req);
    if (!characterId) { res.json(null); return; }
    const data = await guilds.getGuildByCharacter(characterId);
    res.json(data);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.get('/search', authMiddleware, async (req, res) => {
  // Без try/catch ошибка БД уходила в unhandled rejection: ответ не
  // отправлялся вовсе, клиент висел и получал 504
  try {
    const q = String(req.query.q || '');
    const results = await guilds.searchGuilds(q);
    res.json({ guilds: results });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post('/create', authMiddleware, async (req: any, res) => {
  try {
    const { name, tag, description } = req.body;
    if (!name || !tag) { res.status(400).json({ error: 'Name and tag required' }); return; }
    const characterId = await ownCharacterId(req);
    if (!characterId) { res.status(403).json({ error: 'characterId is required' }); return; }
    const guild = await guilds.createGuild(name, tag, characterId, description || '');
    res.json({ success: true, guild });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

router.post('/join', authMiddleware, async (req: any, res) => {
  try {
    const characterId = await ownCharacterId(req);
    if (!characterId) { res.status(403).json({ error: 'characterId is required' }); return; }
    await guilds.addMember(req.body.guildId, characterId);
    res.json({ success: true });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

router.post('/leave', authMiddleware, async (req: any, res) => {
  try {
    const characterId = await ownCharacterId(req);
    if (!characterId) { res.status(400).json({ error: 'characterId is required' }); return; }
    const data = await guilds.getGuildByCharacter(characterId);
    if (!data) { res.status(400).json({ error: 'Not in a guild' }); return; }
    // ТУТ БЫЛО removeMember. Уход главы оставлял гильдию сиротой: в
    // guilds.leader_id оставался его UUID, а назначить нового главу было
    // некому и нечем. leaveGuild передаёт главенство старшему из оставшихся.
    await guilds.leaveGuild(data.guild.id, characterId);
    res.json({ success: true });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

router.get('/members', authMiddleware, async (req: any, res) => {
  try {
    const characterId = await ownCharacterId(req);
    if (!characterId) { res.json({ members: [] }); return; }
    const data = await guilds.getGuildByCharacter(characterId);
    if (!data) { res.json({ members: [] }); return; }
    const members = await guilds.getMembers(data.guild.id);
    res.json({ members });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.post('/rank', authMiddleware, async (req: any, res) => {
  try {
    const actorId = await ownCharacterId(req);
    if (!actorId) { res.status(403).json({ error: 'characterId is required' }); return; }
    const data = await guilds.getGuildByCharacter(actorId);
    if (!data || !['leader', 'officer'].includes(data.rank)) {
      res.status(403).json({ error: 'No permission' }); return;
    }
    // Кто просит (actorId) и кого меняем (body.targetId) — разные люди.
    // Раньше передавалось только двое, и сервис не мог отличить
    // «офицер назначает офицером» от «офицер назначает себя главным».
    await guilds.setRank(data.guild.id, actorId, req.body.targetId, req.body.rank);
    res.json({ success: true });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

router.post('/deposit-gold', authMiddleware, async (req: any, res) => {
  try {
    const characterId = await ownCharacterId(req);
    if (!characterId) { res.status(403).json({ error: 'characterId is required' }); return; }
    const data = await guilds.getGuildByCharacter(characterId);
    if (!data) { res.status(400).json({ error: 'Not in a guild' }); return; }
    await guilds.depositGold(data.guild.id, characterId, req.body.amount);
    res.json({ success: true });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

/**
 * Покупка уровня гильдейского навыка.
 *
 * ЧТО БЫЛО. GuildService.upgradeSkill был написан целиком: проверял право
 * manageTreasury, считал цену, не давал в долг и сбрасывал кэш бонусов. И
 * не вызывался НИГДЕ - маршрута не было. Три навыка имели настоящие
 * эффекты (опыт, золото, скорость крафта), и ни один нельзя было купить.
 *
 * Это тот же класс поломки, что был со складом: depositItem тоже был
 * единственным писателем в guild_bank и тоже не вызывался, пока не
 * появился маршрут. Метод без маршрута выглядит работающей функцией и
 * молчит.
 *
 * ПРАВО. Качает уровень, а не деньги: деньги идут из котла гильдии. Но
 * решение тратит котло��вое золото, поэтому право то же, что и у вывода
 * средств, - manageTreasury. Сделать это может офицер с соответствующим
 * правом, а не рядовой участник.
 */
/**
 * Навыки гильдии: уровни, цены и право на покупку.
 *
 * Право и возможность покупки считает сервер и присылает готовыми: клиент
 * не должен решать, можно ли купить, - иначе он нарисует кнопку для
 * навыка без точки применения, игрок нажмёт и получит отказ с ценой на
 * экране.
 *
 * available - это ровно та же isSkillWired, которую проверяет upgradeSkill.
 * Расхождение этих двух было бы хуже отсутствия поля: кнопка есть, цена
 * есть, покупка невозможна.
 */
router.get('/skills', authMiddleware, async (req: any, res) => {
  try {
    const characterId = await ownCharacterId(req);
    if (!characterId) { res.status(403).json({ error: 'characterId is required' }); return; }
    const data = await guilds.getGuildByCharacter(characterId);
    if (!data) { res.status(400).json({ error: 'Not in a guild' }); return; }

    const уровни = await guilds.getSkillLevels(data.guild.id);
    res.json({
      gold: data.guild.gold,
      // Право тратить казну - то же, что и у вывода средств. Качает
      // уровень офицер, у которого есть manageTreasury.
      canManage: Boolean(getGuildRankPermissions(data.rank as Parameters<typeof getGuildRankPermissions>[0])?.manageTreasury),
      skills: GUILD_SKILLS.map((skill: (typeof GUILD_SKILLS)[number]) => {
        const level = Number(уровни[skill.id] ?? 0);
        const максимум = level >= skill.maxLevel;
        return {
          id: skill.id,
          name: skill.name,
          nameRu: skill.nameRu,
          // Описание в данных только на русском. Перевод сюда не вносится:
          // выдуманный текст хуже русского среди азербайджана.
          description: skill.description,
          level,
          maxLevel: skill.maxLevel,
          // Нулевая цена означает «уже максимум», и клиент это не
          // отличает от «бесплатно» - поэтому цена идёт вместе с флагом.
          costNext: максимум ? 0 : upgradeCost(skill.id, 1),
          maxed: максимум,
          available: isSkillWired(skill.id),
        };
      }),
    });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

router.post('/skills/upgrade', authMiddleware, async (req: any, res) => {
  try {
    const characterId = await ownCharacterId(req);
    if (!characterId) { res.status(403).json({ error: 'characterId is required' }); return; }
    const { skillId, levels } = req.body ?? {};
    if (!skillId) { res.status(400).json({ error: 'skillId is required' }); return; }

    const data = await guilds.getGuildByCharacter(characterId);
    if (!data) { res.status(400).json({ error: 'Not in a guild' }); return; }

    const result = await guilds.upgradeSkill(data.guild.id, characterId, skillId, levels);
    res.json({ success: true, ...result });
  } catch (err) {
    // Ошибки сервиса названы словами и осмысленны, а не тексты ради текста:
    // клиенту нужно отличить «нет права» от «нет золота», иначе он
    // покажет одно и то же на все случаи.
    const code = (err as Error).message;
    const статус: Record<string, number> = {
      NOT_A_MEMBER: 403,
      SKILLS_FORBIDDEN: 403,
      // Навык без точки применения - это не ошибка игрока, а наша недоработка.
      // Отдаём 409, а не 400: так в логах видно, что дело в сервере.
      SKILL_UNAVAILABLE: 409,
      SKILL_UNKNOWN: 404,
      SKILL_MAXED: 400,
      NOT_ENOUGH_GUILD_GOLD: 400,
    };
    res.status(статус[code] ?? 400).json({ error: code });
  }
});

/**
 * Склад гильдии: вклад и выдача предметов.
 *
 * ЧТО БЫЛО. GuildService.depositItem был единственным писателем в таблицу
 * guild_bank во всём репозитории — и не вызывался нигде. Маршрут /deposit-gold
 * вызывал depositGold, у которого похожее имя, и это легко принять за
 * рабочую связку. Панель склада показывала пустоту, работала только кнопка
 * вклада золота.
 *
 * Склада «положить, но не забрать» не было бы: игрок потерял бы вещи навсегда.
 */
router.post('/deposit-item', authMiddleware, async (req: any, res) => {
  try {
    const characterId = await ownCharacterId(req);
    if (!characterId) { res.status(403).json({ error: 'characterId is required' }); return; }
    if (!req.body.itemId) { res.status(400).json({ error: 'itemId is required' }); return; }
    const data = await guilds.getGuildByCharacter(characterId);
    if (!data) { res.status(400).json({ error: 'Not in a guild' }); return; }
    await guilds.depositItem(data.guild.id, characterId, req.body.itemId, Number(req.body.qty ?? 1));
    res.json({ success: true });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

router.post('/withdraw-item', authMiddleware, async (req: any, res) => {
  try {
    const characterId = await ownCharacterId(req);
    if (!characterId) { res.status(403).json({ error: 'characterId is required' }); return; }
    const bankId = Number(req.body.bankId);
    if (!Number.isInteger(bankId) || bankId <= 0) { res.status(400).json({ error: 'bankId is required' }); return; }
    const data = await guilds.getGuildByCharacter(characterId);
    if (!data) { res.status(400).json({ error: 'Not in a guild' }); return; }
    await guilds.withdrawItem(data.guild.id, characterId, bankId, Number(req.body.qty ?? 1));
    res.json({ success: true });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

router.get('/bank', authMiddleware, async (req: any, res) => {
  try {
    const characterId = await ownCharacterId(req);
    if (!characterId) { res.json({ items: [] }); return; }
    const data = await guilds.getGuildByCharacter(characterId);
    if (!data) { res.json({ items: [] }); return; }
    const items = await guilds.getBankItems(data.guild.id);
    res.json({ items });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.post('/kick', authMiddleware, async (req: any, res) => {
  try {
    const characterId = await ownCharacterId(req);
    if (!characterId) { res.status(403).json({ error: 'characterId is required' }); return; }
    const data = await guilds.getGuildByCharacter(characterId);
    if (!data || !['leader', 'officer'].includes(data.rank)) {
      res.status(403).json({ error: 'No permission' }); return;
    }
    await guilds.removeMember(data.guild.id, req.body.targetId);
    res.json({ success: true });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

export default router;
