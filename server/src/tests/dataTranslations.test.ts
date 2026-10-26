// Переводы данных: каждый id, который игрок видит в панели, имеет строку
// во всех трёх словарях.
//
// ЗА ЧТО БОРЕТСЯ. Игровые данные (магазины, битлпасс, описания регионов)
// хранят русский текст в nameRu/description, а словари — переводы по id.
// Клиент печатает через tOr('словарь.id', nameRu): нет строки — игрок на
// en/az видит русский посреди английского интерфейса. Так и было (§347):
// заголовок сезона битлпасса, названия магазинов и описания городов
// оставались русскими, потому что строк просто не было. Этот набор падает,
// как только в данные попадает новый магазин/тир сезона/регион без строки
// в en.json, ru.json и az.json.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NPC_SHOPS } from '../services/AuctionService';
import { BATTLE_PASS_TIERS, CURRENT_SEASON } from '../systems/PremiumSystem';

const repoRoot = join(__dirname, '..', '..', '..');
const LOCALES = ['en', 'ru', 'az'] as const;

const словари = Object.fromEntries(
  LOCALES.map((lang) => [lang, JSON.parse(readFileSync(join(repoRoot, 'shared/locales', `${lang}.json`), 'utf-8'))])
);

function строки(lang: string, раздел: string): Record<string, string> {
  const value = словари[lang][раздел];
  return value && typeof value === 'object' ? value : {};
}

describe('Переводы данных: у каждого id есть строка во всех словарях', () => {
  it('данные действительно взяты (набор не вхолостую)', () => {
    expect(Object.keys(NPC_SHOPS).length).toBeGreaterThan(5);
    expect(BATTLE_PASS_TIERS.length).toBeGreaterThan(5);
  });

  for (const lang of LOCALES) {
    it(`${lang}: у каждого магазина есть название`, () => {
      const названия = строки(lang, 'shop');
      const missing = Object.keys(NPC_SHOPS).filter((id) => !(названия[id] ?? '').trim());
      expect({ lang, missing }).toEqual({ lang, missing: [] });
    });

    it(`${lang}: у сезона битлпасса есть название`, () => {
      const bp = строки(lang, 'battlepass');
      expect((bp[`season_${CURRENT_SEASON.id}`] ?? '').trim()).not.toBe('');
    });

    it(`${lang}: у каждого тира битлпасса переведены награды`, () => {
      const bp = строки(lang, 'battlepass');
      const missing: string[] = [];
      for (const tier of BATTLE_PASS_TIERS) {
        if (!(bp[`tier_${tier.tier}_free`] ?? '').trim()) missing.push(`tier_${tier.tier}_free`);
        if (tier.premiumReward && !(bp[`tier_${tier.tier}_premium`] ?? '').trim()) missing.push(`tier_${tier.tier}_premium`);
      }
      expect({ lang, missing }).toEqual({ lang, missing: [] });
    });

    it(`${lang}: у каждого региона есть описание`, () => {
      // Имена регионов живут в словаре с первой выкатки — их ключи и есть
      // эталон списка регионов: route world.ts держит ровно эти id.
      const имена = строки(lang, 'regions');
      const описания = строки(lang, 'region_desc');
      const missing = Object.keys(имена).filter((id) => !(описания[id] ?? '').trim());
      expect({ lang, total: Object.keys(имена).length, missing }).toEqual({
        lang,
        total: Object.keys(имена).length,
        missing: [],
      });
    });
  }

  it('ключи трёх новых разделов совпадают во всех словарях', () => {
    // Перевод, добавленный в en и забытый в az, падает здесь, а не в
    // отчёте игрока.
    for (const раздел of ['region_desc', 'battlepass']) {
      const базовые = Object.keys(строки('en', раздел)).sort();
      for (const lang of LOCALES) {
        expect({ раздел, lang, keys: Object.keys(строки(lang, раздел)).sort() }).toEqual({
          раздел,
          lang,
          keys: базовые,
        });
      }
    }
    const базовые = Object.keys(NPC_SHOPS).sort();
    for (const lang of LOCALES) {
      const вСловаре = Object.keys(строки(lang, 'shop'))
        .filter((k) => k.startsWith('shop_'))
        .sort();
      expect({ lang, keys: вСловаре }).toEqual({ lang, keys: базовые });
    }
  });
});
