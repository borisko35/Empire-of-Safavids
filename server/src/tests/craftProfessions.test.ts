// Крафт по профессиям, а не одним общим уровнем.
//
// ЧТО БЫЛО. В данных шесть профессий (кузнец, портной, алхимик, повар,
// ювелир, плотник) — поле category есть у каждого рецепта. А сервер его
// игнорировал: уровень считался из одного общего characters.crafting_xp.
//
// Что это значило для игрока. Алхимик, который никогда не держал в руках
// молот, имел ту же «уровень крафта», что и кузнец, и рецепт ювелира
// открывался ему за кузнечный опыт. Таблица crafting_skills создана
// миграцией 002 именно под разделение по профессиям — и не использовалась.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './helpers/stripCode';

const repoRoot = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');
const src = (p: string): string => stripComments(read(p));

const service = src('server/src/services/CraftingService.ts');
const game = src('server/src/routes/game.ts');
const api = src('client/src/app/api.ts');
const panels = src('client/src/app/panels.ts');
const crafting = src('server/src/data/crafting.ts');

describe('Крафт: уровень берётся по профессии рецепта', () => {
  it('проверка уровня смотрит категорию рецепта', () => {
    // Суть всего изменения: раньше тут стоял общий уровень, и кузнечный
    // опыт открывал рецепты ювелира
    expect(service).toMatch(/levels\[recipe\.category\]/);
    expect(service).not.toMatch(/craftingLevelFromXp\(Number\(char\?\.crafting_xp/);
  });

  it('опыт капает в профессию, а не в общую кучу', () => {
    expect(service).toMatch(/INSERT INTO crafting_skills/);
    expect(service).toMatch(/job\.character_id, recipe\.category, recipe\.experienceGain/);
  });

  it('таблица crafting_skills наконец используется', () => {
    expect(service).toMatch(/FROM crafting_skills WHERE character_id = \$1/);
  });
});

describe('Крафт: перенос старого прогресса', () => {
  it('профессия без строки берёт общий опыт', () => {
    // Главное для игрока: персонаж с 5000 общего опыта получает уровень 51
    // в каждой профессии, а не начинает с нуля. Иначе все, кто играл до
    // этого изменения, молча потеряли бы накопленное и узнали бы об этом
    // только по закрытым рецептам
    expect(service).toMatch(/const pooled = rows\.length \? 0 : await this\.pooledXp\(characterId\)/);
  });

  it('все шесть профессий присутствуют и в данных, и в списке', () => {
    for (const cat of ['blacksmithing', 'tailoring', 'alchemy', 'cooking', 'jewelcrafting', 'carpentry']) {
      expect({ cat, есть_в_данных: crafting.includes(`'${cat}'`) }).toEqual({ cat, есть_в_данных: true });
    }
    const n = (service.match(/CATEGORIES: CraftingCategory\[\] = \[/) ?? []).length;
    expect({ список_профессий_объявлен: n }).toEqual({ список_профессий_объявлен: 1 });
  });
});

describe('Крафт: общий опыт не теряется', () => {
  it('characters.crafting_xp продолжает расти', () => {
    // Колонка NOT NULL и читается как сумма. Выбрасывать её ради чистоты
    // значило бы рисковать чужим прогрессом
    expect(service).toMatch(/UPDATE characters SET crafting_xp = crafting_xp \+ \$2/);
  });

  it('начисление идёт в той же транзакции, что и выдача предмета', () => {
    // Через client, а не через this.db: свой вызов открыл бы другое
    // соединение в обход транзакции, и при откате крафта опыт в профессии
    // остался бы, а предмет — нет
    const tx = service.indexOf('this.db.transaction');
    const grant = service.indexOf('INSERT INTO crafting_skills');
    const item = service.indexOf('INSERT INTO character_items');
    expect({ всё_в_одной_транзакции: tx > 0 && grant > tx && item > tx })
      .toEqual({ всё_в_одной_транзакции: true });
    // Между скобкой и строкой перевод строки, поэтому \s*, а не вплотную:
    // иначе правка форматирования тихо обнулила бы проверку
    expect(service).toMatch(/await client\.query\(\s*`INSERT INTO crafting_skills/);
  });
});

describe('Крафт: игрок видит, чего ему не хватает', () => {
  it('маршрут отдаёт уровни по профессиям', () => {
    expect(game).toMatch(/gameRouter\.get\('\/crafting\/skills'/);
    expect(game).toMatch(/craftingService\.skillLevels\(characterId\)/);
  });

  it('панель показывает все шесть', () => {
    expect(api).toMatch(/craftingSkills: \(characterId: string\)/);
    expect(panels).toMatch(/const ORDER = \['blacksmithing', 'tailoring', 'alchemy'/);
    expect(panels).toMatch(/craft-skills/);
  });

  it('названия профессий берутся из переводов, а не из кода', () => {
    // Ключ собирается выражением, поэтому читать переводы глазами нельзя.
    // Проверяем, что в коде нет русского текста
    expect(panels).toMatch(/t\('craft\.' \+ cat\)/);
    expect(panels).not.toMatch(/Кузнечное дело|Ювелирное дело|Плотницкое/);
  });

  it('если маршрут не ответил, панель всё равно показывает рецепты', () => {
    // Отдельный запрос за уровнями не должен ронять панель целиком: игрок
    // пришёл за рецептом, а не за числом
    expect(panels).toMatch(/craftingSkills\(cid\(\)\)\.catch\(/);
  });
});
