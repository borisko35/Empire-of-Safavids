// ============================================================
// Тесты — AISystem — Empire of Safavids
// ============================================================

import { AISystem } from '../systems/AISystem';
import { MONSTERS_DATABASE } from '../data/monsters';
import { Region } from '../types/game.types';

describe('AISystem', () => {
  let ai: AISystem;
  const banditDef = MONSTERS_DATABASE['mob_bandit_scout'];

  beforeEach(() => {
    ai = new AISystem();
  });

  describe('spawnMonster', () => {
    it('должен создавать контекст с полным HP', () => {
      const ctx = ai.spawnMonster(banditDef, { x: 0, y: 0, z: 0 });
      expect(ctx.currentHp).toBe(banditDef.hp);
      expect(ctx.maxHp).toBe(banditDef.hp);
      expect(ctx.state).toBe('patrol');
    });

    it('должен генерировать точки патруля', () => {
      const ctx = ai.spawnMonster(banditDef, { x: 0, y: 0, z: 0 });
      expect(ctx.patrolPoints.length).toBeGreaterThan(0);
    });
  });

  describe('tick', () => {
    it('должен патрулировать без игроков', () => {
      const ctx = ai.spawnMonster(banditDef, { x: 0, y: 0, z: 0 });
      const action = ai.tick(ctx.instanceId, []);
      expect(['patrol', 'idle', 'move']).toContain(action.type);
    });

    it('должен атаковать ближнего игрока', () => {
      const ctx = ai.spawnMonster(banditDef, { x: 0, y: 0, z: 0 });
      const players = [{ id: 'player1', position: { x: 1, y: 0, z: 0 }, hp: 100 }];
      // Добавляем угрозу в аггро-таблицу
      ai.addThreat(ctx.instanceId, 'player1', 100);
      const action = ai.tick(ctx.instanceId, players);
      expect(['attack', 'chase', 'skill']).toContain(action.type);
    });
  });

  describe('takeDamage', () => {
    it('должен уменьшать HP', () => {
      const ctx = ai.spawnMonster(banditDef, { x: 0, y: 0, z: 0 });
      const dead = ai.takeDamage(ctx.instanceId, 100, 'player1');
      const updated = ai.getContext(ctx.instanceId);
      expect(dead).toBe(false);
      expect(updated?.currentHp).toBe(banditDef.hp - 100);
    });

    it('должен возвращать true при смерти', () => {
      const ctx = ai.spawnMonster(banditDef, { x: 0, y: 0, z: 0 });
      const dead = ai.takeDamage(ctx.instanceId, banditDef.hp + 1, 'player1');
      expect(dead).toBe(true);
      expect(ai.getContext(ctx.instanceId)).toBeUndefined();
    });
  });
});
