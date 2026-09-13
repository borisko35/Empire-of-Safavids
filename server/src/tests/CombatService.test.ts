// ============================================================
// Тесты — CombatService — Empire of Safavids
// ============================================================

import { CombatService } from '../services/CombatService';
import { Character, CharacterClass, Region } from '../types/game.types';

const makeCharacter = (overrides: Partial<Character> = {}): Character => ({
  serverId: 'isfahan',
  id: 'test-id',
  userId: 'user-id',
  name: 'TestChar',
  class: CharacterClass.QIZILBASH,
  level: 20,
  experience: 0,
  stats: { strength: 20, agility: 12, intelligence: 5, endurance: 18, charisma: 8 },
  hp: 280, maxHp: 280,
  mana: 90, maxMana: 90,
  stamina: 160, maxStamina: 160,
  position: { x: 0, y: 0, z: 0 },
  region: Region.TABRIZ,
  gold: 100,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('CombatService', () => {
  let service: CombatService;

  beforeEach(() => {
    service = new CombatService();
  });

  // ── Базовый урон
  describe('calculateDamage', () => {
    it('должен возвращать положительный урон', () => {
      const attacker = makeCharacter();
      const target   = makeCharacter({ id: 'target' });
      const action   = { characterId: attacker.id, actionType: 'attack' as const, position: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 }, timestamp: Date.now() };

      const result = service.calculateDamage(attacker, target, action);
      expect(result.damage).toBeGreaterThanOrEqual(0);
    });

    it('уклонение должно давать 0 урона при успехе', () => {
      // Цель с максимальной ловкостью — высокий шанс уклонения
      const attacker = makeCharacter();
      const target   = makeCharacter({ id: 'target', stats: { strength: 5, agility: 100, intelligence: 5, endurance: 5, charisma: 5 } });
      const action   = { characterId: attacker.id, actionType: 'attack' as const, position: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 }, timestamp: Date.now() };

      // Запускаем много раз — хотя бы один должен быть уклонение
      const results = Array.from({ length: 50 }, () => service.calculateDamage(attacker, target, action));
      const hasDodge = results.some(r => r.isDodged);
      expect(hasDodge).toBe(true);
    });

    it('критический удар должен быть больше обычного', () => {
      const attacker = makeCharacter({ stats: { strength: 50, agility: 50, intelligence: 5, endurance: 18, charisma: 8 } });
      const target   = makeCharacter({ id: 'target', stats: { strength: 5, agility: 5, intelligence: 5, endurance: 5, charisma: 5 } });
      const action   = { characterId: attacker.id, actionType: 'attack' as const, position: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 }, timestamp: Date.now() };

      const results = Array.from({ length: 100 }, () => service.calculateDamage(attacker, target, action));
      const crits   = results.filter(r => r.isCritical);
      const normals = results.filter(r => !r.isCritical && !r.isDodged && !r.isBlocked);

      if (crits.length > 0 && normals.length > 0) {
        const avgCrit   = crits.reduce((s, r) => s + r.damage, 0) / crits.length;
        const avgNormal = normals.reduce((s, r) => s + r.damage, 0) / normals.length;
        expect(avgCrit).toBeGreaterThan(avgNormal);
      }
    });
  });

  // ── Навыки
  describe('getClassSkills', () => {
    it('должен возвращать навыки для каждого класса', () => {
      for (const cls of Object.values(CharacterClass)) {
        const skills = service.getClassSkills(cls);
        expect(skills.length).toBeGreaterThan(0);
        expect(skills.every(s => s.id && s.name && s.cooldown >= 0)).toBe(true);
      }
    });

    it('у каждого класса должен быть ультимейт', () => {
      for (const cls of Object.values(CharacterClass)) {
        const skills = service.getClassSkills(cls);
        const ultimate = skills.find(s => s.id.includes('ultimate'));
        expect(ultimate).toBeDefined();
      }
    });
  });
});
