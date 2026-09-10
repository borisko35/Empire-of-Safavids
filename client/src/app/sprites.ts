// ============================================================
// Загрузка спрайтов — Empire of Safavids
// ============================================================
// Пиксель-арт из tools/generate-sprites.js; image-rendering: pixelated.

import ground from './assets/sprites/ground.png';
import decorRock from './assets/sprites/decor_rock.png';
import decorBush from './assets/sprites/decor_bush.png';
import decorGrass from './assets/sprites/decor_grass.png';
import charQizilbash0 from './assets/sprites/char_qizilbash_0.png';
import charQizilbash1 from './assets/sprites/char_qizilbash_1.png';
import charSufiMystic0 from './assets/sprites/char_sufi_mystic_0.png';
import charSufiMystic1 from './assets/sprites/char_sufi_mystic_1.png';
import charPersianArcher0 from './assets/sprites/char_persian_archer_0.png';
import charPersianArcher1 from './assets/sprites/char_persian_archer_1.png';
import charBazaarMerchant0 from './assets/sprites/char_bazaar_merchant_0.png';
import charBazaarMerchant1 from './assets/sprites/char_bazaar_merchant_1.png';
import charCourtDiplomat0 from './assets/sprites/char_court_diplomat_0.png';
import charCourtDiplomat1 from './assets/sprites/char_court_diplomat_1.png';
import monBanditScout0 from './assets/sprites/mon_bandit_scout_0.png';
import monBanditScout1 from './assets/sprites/mon_bandit_scout_1.png';
import monBanditWarrior0 from './assets/sprites/mon_bandit_warrior_0.png';
import monBanditWarrior1 from './assets/sprites/mon_bandit_warrior_1.png';
import monOttomanJanissary0 from './assets/sprites/mon_ottoman_janissary_0.png';
import monOttomanJanissary1 from './assets/sprites/mon_ottoman_janissary_1.png';
import monMongolRaider0 from './assets/sprites/mon_mongol_raider_0.png';
import monMongolRaider1 from './assets/sprites/mon_mongol_raider_1.png';
import monDivFire0 from './assets/sprites/mon_div_fire_0.png';
import monDivFire1 from './assets/sprites/mon_div_fire_1.png';
import monSimurgh0 from './assets/sprites/mon_simurgh_0.png';
import monSimurgh1 from './assets/sprites/mon_simurgh_1.png';

const SOURCES: Record<string, string> = {
  ground,
  decor_rock: decorRock,
  decor_bush: decorBush,
  decor_grass: decorGrass,
  char_qizilbash_0: charQizilbash0,
  char_qizilbash_1: charQizilbash1,
  char_sufi_mystic_0: charSufiMystic0,
  char_sufi_mystic_1: charSufiMystic1,
  char_persian_archer_0: charPersianArcher0,
  char_persian_archer_1: charPersianArcher1,
  char_bazaar_merchant_0: charBazaarMerchant0,
  char_bazaar_merchant_1: charBazaarMerchant1,
  char_court_diplomat_0: charCourtDiplomat0,
  char_court_diplomat_1: charCourtDiplomat1,
  mon_bandit_scout_0: monBanditScout0,
  mon_bandit_scout_1: monBanditScout1,
  mon_bandit_warrior_0: monBanditWarrior0,
  mon_bandit_warrior_1: monBanditWarrior1,
  mon_ottoman_janissary_0: monOttomanJanissary0,
  mon_ottoman_janissary_1: monOttomanJanissary1,
  mon_mongol_raider_0: monMongolRaider0,
  mon_mongol_raider_1: monMongolRaider1,
  mon_div_fire_0: monDivFire0,
  mon_div_fire_1: monDivFire1,
  mon_simurgh_0: monSimurgh0,
  mon_simurgh_1: monSimurgh1,
};

const cache = new Map<string, HTMLImageElement>();

/** Загрузить все спрайты (вызвать один раз до старта рендера) */
export async function loadSprites(): Promise<void> {
  await Promise.all(
    Object.entries(SOURCES).map(
      ([name, src]) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => {
            cache.set(name, img);
            resolve();
          };
          img.onerror = () => resolve(); // отсутствующий спрайт не роняет игру
          img.src = src;
        }),
    ),
  );
}

export function spr(name: string): HTMLImageElement | undefined {
  return cache.get(name);
}

/** Серверные id монстров (mob_*, world_boss_*) -> база спрайта (mon_*) */
const MONSTER_SPRITE: Record<string, string> = {
  mob_bandit_scout: 'mon_bandit_scout',
  mob_bandit_warrior: 'mon_bandit_warrior',
  mob_ottoman_janissary: 'mon_ottoman_janissary',
  mob_mongol_raider: 'mon_mongol_raider',
  mob_div_fire: 'mon_div_fire',
  world_boss_simurgh: 'mon_simurgh',
};

export function monsterBase(monsterId: string): string {
  return MONSTER_SPRITE[monsterId] ?? 'mon_bandit_scout';
}

/** Кадр анимации ходьбы (0/1) по имени базового спрайта */
export function walkFrame(base: string, moving: boolean, timeMs: number, seed = 0): HTMLImageElement | undefined {
  const frame = moving ? Math.floor(timeMs / 180 + seed) % 2 : 0;
  return cache.get(`${base}_${frame}`);
}
