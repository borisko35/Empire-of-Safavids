// ============================================================
// Anti-Cheat System — Empire of Safavids
// ============================================================

import { logger } from '../utils/logger';
import { DatabaseService } from '../services/DatabaseService';
import { RedisService } from '../services/RedisService';
import { Vector3 } from '../types/game.types';

export type ViolationType =
  | 'speed_hack'
  | 'teleport'
  | 'damage_hack'
  | 'item_dupe'
  | 'packet_flood'
  | 'invalid_position'
  | 'impossible_action';

export interface ViolationRecord {
  characterId: string;
  type: ViolationType;
  details: string;
  severity: 1 | 2 | 3; // 1=warn, 2=kick, 3=ban
  detectedAt: Date;
}

// Максимальная скорость персонажа (унит/сек)
const MAX_SPEED = 12.0;
// Максимальный урон за удар (base * multiplier)
const MAX_DAMAGE_MULTIPLIER = 15.0;
// Максимальное количество пакетов в секунду
const MAX_PACKETS_PER_SECOND = 30;
// Максимальное расстояние прыжка за тик (метры)
const MAX_TELEPORT_DISTANCE = 20.0;
// Порог нарушений до автобана
const AUTO_BAN_VIOLATIONS = 5;

export class AntiCheatSystem {
  private db    = DatabaseService.getInstance();
  private redis = RedisService.getInstance();

  // Позиции игроков за прошлый тик
  private lastPositions = new Map<string, { pos: Vector3; time: number }>();
  // Счётчики пакетов
  private packetCounters = new Map<string, { count: number; windowStart: number }>();

  // ============================================================
  // Проверка скорости движения
  // ============================================================
  validateMovement(
    characterId: string,
    newPos: Vector3,
    now: number = Date.now()
  ): { valid: boolean; reason?: string } {
    const last = this.lastPositions.get(characterId);

    if (last) {
      const rawDt = (now - last.time) / 1000; // секунды
      if (rawDt <= 0) return { valid: true };

      const dx = newPos.x - last.pos.x;
      const dy = newPos.y - last.pos.y;
      const dz = newPos.z - last.pos.z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

      // Клиент шлёт позицию каждые ~100мс. При сетевых задержках пакеты
      // приходят пачками (два пакета за 10-30мс): измеренный dt тогда
      // в разы меньше реального времени движения, и честная скорость
      // бега 7.6 u/s превращается в ложные 20+ u/s. Ограничиваем dt
      // снизу интервалом отправки клиента — скученность пакетов не
      // должна раздувать скорость.
      const dt = Math.max(rawDt, 0.08);

      // Проверка телепорта
      if (distance > MAX_TELEPORT_DISTANCE && dt < 0.5) {
        return { valid: false, reason: `Teleport detected: ${distance.toFixed(1)}m in ${dt.toFixed(2)}s @(${newPos.x.toFixed(0)},${newPos.z.toFixed(0)})` };
      }

      // Проверка speed hack
      if (distance / dt > MAX_SPEED * 1.3) { // +30% толерантность
        return { valid: false, reason: `Speed hack: ${(distance / dt).toFixed(1)} u/s (max ${MAX_SPEED}) @(${newPos.x.toFixed(0)},${newPos.z.toFixed(0)})` };
      }
    }

    this.lastPositions.set(characterId, { pos: newPos, time: now });
    return { valid: true };
  }

  // ============================================================
  // Проверка урона
  // ============================================================
  validateDamage(
    _characterId: string,
    damage: number,
    baseDamage: number
  ): { valid: boolean; reason?: string } {
    const multiplier = damage / Math.max(1, baseDamage);
    if (multiplier > MAX_DAMAGE_MULTIPLIER) {
      return {
        valid: false,
        reason: `Damage hack: ${damage} dmg (base ${baseDamage}, multiplier ${multiplier.toFixed(1)}x)`,
      };
    }
    return { valid: true };
  }

  // ============================================================
  // Проверка частоты пакетов
  // ============================================================
  validatePacketRate(
    characterId: string,
    now: number = Date.now()
  ): { valid: boolean; reason?: string } {
    const counter = this.packetCounters.get(characterId);
    const windowMs = 1000;

    if (!counter || now - counter.windowStart > windowMs) {
      this.packetCounters.set(characterId, { count: 1, windowStart: now });
      return { valid: true };
    }

    counter.count++;
    if (counter.count > MAX_PACKETS_PER_SECOND) {
      return {
        valid: false,
        reason: `Packet flood: ${counter.count} packets/sec (max ${MAX_PACKETS_PER_SECOND})`,
      };
    }
    return { valid: true };
  }

  // ============================================================
  // Запись нарушения и автоматические санкции
  // ============================================================
  async recordViolation(
    characterId: string,
    type: ViolationType,
    details: string,
    severity: 1 | 2 | 3
  ): Promise<{ action: 'warn' | 'kick' | 'ban' }> {
    logger.warn(`[AntiCheat] ${type} | ${characterId} | ${details}`);

    // Сохраняем в БД
    await this.db.query(
      `INSERT INTO anticheat_violations (character_id, type, details, severity, detected_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [characterId, type, details, severity]
    );

    // Считаем нарушения за последние 24 часа
    const recentRows = await this.db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM anticheat_violations
       WHERE character_id = $1 AND detected_at > NOW() - INTERVAL '24 hours'`,
      [characterId]
    );
    const recentCount = parseInt(recentRows[0]?.count ?? '0');

    // Автобан при превышении порога
    if (recentCount >= AUTO_BAN_VIOLATIONS || severity === 3) {
      await this.db.query(
        `UPDATE users SET is_banned = TRUE, ban_reason = $1
         WHERE id = (SELECT user_id FROM characters WHERE id = $2)`,
        [`[AutoBan] ${type}: ${details}`, characterId]
      );
      await this.redis.publish('anticheat:ban', { characterId, reason: type });
      logger.error(`[AntiCheat] AUTO-BAN: ${characterId} (${recentCount} violations)`);
      return { action: 'ban' };
    }

    if (severity === 2) {
      await this.redis.publish('anticheat:kick', { characterId, reason: details });
      return { action: 'kick' };
    }

    return { action: 'warn' };
  }

  // Очистка при отключении
  cleanup(characterId: string): void {
    this.lastPositions.delete(characterId);
    this.packetCounters.delete(characterId);
  }

  // Сброс базовой позиции после серверного телепорта (респавн, смена
  // региона, вход в игру): иначе следующий пакет движения сравнивается
  // со старой точкой и даёт ложные speed_hack/teleport.
  resetPosition(characterId: string, pos: Vector3): void {
    this.lastPositions.set(characterId, { pos: { ...pos }, time: Date.now() });
  }
}
