// canBeAttacked и isAuctionBanned — проверки кармы для PvP и аукциона.
//
 // ЧТО ПРОВЕРЯЕМ. Таблица последствий (KARMA_PENALTIES) объявляет поля:
 //   canBeAttacked — может ли игрока атаковать в PvP
 //   auctionBan    — запрещён ли аукцион
 // Эти поля читаются функциями canBeAttacked / isAuctionBanned, и никакое
 // другое место в коде не должно напрямую обращаться к KARMA_PENALTIES.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');

function должен(условие: unknown, причина: string): void {
  if (!условие) throw new Error(причина);
}

const КАРМА = читать('server/src/systems/KarmaSystem.ts');
// Убираем комментарии
const КОД = КАРМА.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('Карма: canBeAttacked и isAuctionBanned', () => {
  it('функция canBeAttacked существует и экспортируется', () => {
    должен(/export function canBeAttacked\(/.test(КОД), 'нет функции canBeAttacked');
  });

  it('функция isAuctionBanned существует и экспортируется', () => {
    должен(/export function isAuctionBanned\(/.test(КОД), 'нет функции isAuctionBanned');
  });

  it('canBeAttacked читает KARMA_PENALTIES, а не дублирует логику', () => {
    const fn = /export function canBeAttacked\(karma: number\): boolean \{([\s\S]*?)\}\s*(?=export|$)/.exec(КОД);
    должен(fn, 'нет тела canBeAttacked');
    const тело = fn![1];
    должен(/KARMA_PENALTIES\[getKarmaStatus\(karma\)\]\.canBeAttacked/.test(тело),
      'canBeAttacked не читает KARMA_PENALTIES — дублирует логику порогов');
    должны(!/if \(karma/.test(тело), 'canBeAttacked содержит свои if — логика разошлась с таблицей');
  });

  it('isAuctionBanned читает KARMA_PENALTIES, а не дублирует логику', () => {
    const fn = /export function isAuctionBanned\(karma: number\): boolean \{([\s\S]*?)\}\s*(?=export|$)/.exec(КОД);
    должен(fn, 'нет тела isAuctionBanned');
    const тело = fn![1];
    должен(/KARMA_PENALTIES\[getKarmaStatus\(karma\)\]\.auctionBan/.test(тело),
      'isAuctionBanned не читает KARMA_PENALTIES — дублирует логику порогов');
    должны(!/if \(karma/.test(тело), 'isAuctionBanned содержит свои if — логика разошлась с таблицей');
  });

  it('в таблице последствий auctionBan: true только у outlaw', () => {
    // Только у outlaw auctionBan = true
    должны(/outlaw:  \{ nameRu: 'Изгой',.*auctionBan: true/.test(КОД), 'auctionBan: true только у outlaw');
    должны(!/chaotic:.*auctionBan: true/.test(КОД), 'chaotic не должен иметь auctionBan');
    должны(!/red:.*auctionBan: true/.test(КОД), 'red не должен иметь auctionBan');
  });

  it('в таблице последствий canBeAttacked: false у saint/good/neutral, true у chaotic/red/outlaw', () => {
    должны(/saint:.*canBeAttacked: false/.test(КОД), 'saint: canBeAttacked: false');
    должны(/good:.*canBeAttacked: false/.test(КОД), 'good: canBeAttacked: false');
    должны(/neutral:.*canBeAttacked: false/.test(КОД), 'neutral: canBeAttacked: false');
    должны(/chaotic:.*canBeAttacked: true/.test(КОД), 'chaotic: canBeAttacked: true');
    должны(/red:.*canBeAttacked: true/.test(КОД), 'red: canBeAttacked: true');
    должны(/outlaw:.*canBeAttacked: true/.test(КОД), 'outlaw: canBeAttacked: true');
  });
});

function должны(условие: unknown, причина: string): void {
  if (!условие) throw new Error(причина);
}