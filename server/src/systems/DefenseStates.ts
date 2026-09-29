// ============================================================
// Активная защита: уклонение (i-frames) и блок — Empire of Safavids
// ============================================================
// Кратковременные защитные состояния, инициируемые игроком через
// combat:action (actionType dodge/block). Читаются боевым циклом
// (GameLoop) и PvP-путём (GameSocketHandler). Состояния в памяти:
// живут доли секунды и не должны переживать рестарт сервера.

interface DefenseState {
  dodgeUntil: number;
  blockUntil: number;
  /** Когда последний раз успешно начали уклонение (для отката рывка) */
  dodgeStartedAt: number;
  /** Сколько защита уже согласована - по этому числу считается, не протухла ли она */
  blockStartedAt: number;
}

const DODGE_DURATION_MS = 1500;
const BLOCK_DURATION_MS = 2000;
const BLOCK_REDUCTION = 0.6; // блок гасит 60% урона
/**
 * Откат рывка.
 *
 * Раньше его не было: уклонение стоило 15 стамины, и при регенерации
 * стамины её можно было тратить снова и снова - неуязвимость включалась
 * практически непрерывно. Теперь между рывками есть пауза.
 */
const DODGE_COOLDOWN_MS = 800;
/**
 * Запас сверх досягаемости.
 *
 * Позиция приходит пакетами, поэтому между последним пакетом позиции
 * атакующего и ударом игрок может немного разойтись. Без запаса честный удар
 * по цели, которая чуть отошла, отклонялся бы - и игрок считал бы игру
 * сломанной.
 *
 * Запас меньше, чем кажется на первый взгляд: при дальностях 2.2-2.8 запас в
 * 1.5 съедал разницу между оружием целиком, и сабля доставала бы ровно так же
 * далеко, как клинок Шаха. Сначала поставили 1.5, потом это показал тест на
 * досягаемость: он честно упал, потому что при 2.5 и 2.7 окно одинаковое.
 */
const REACH_TOLERANCE = 0.8;

/**
 * Окно парирования и отражение.
 *
 * Парирование - первые миллисекунды блока: игрок жмёт щит за мгновение до
 * удара, удар гасится полностью, а атакующего отбрасывает. Отдельного действия
 * нет, только щит и отклик, - иначе «парирование» было бы ещё одной кнопкой
 * вместо тайминга.
 */
const PARRY_WINDOW_MS = 260;
/** Доля отражённого урона: парирование не просто гасит, а возвращает */
const PARRY_REFLECT = 0.35;

function freshState(): DefenseState {
  return { dodgeUntil: 0, blockUntil: 0, dodgeStartedAt: 0, blockStartedAt: 0 };
}

export class DefenseStates {
  private static instance: DefenseStates;
  private states = new Map<string, DefenseState>();
  /** Позиции для проверки досягаемости. Ставит сокет-обработчик из пакетов позиции. */
  private positions = new Map<string, { x: number; y: number; z: number }>();

  static getInstance(): DefenseStates {
    if (!DefenseStates.instance) {
      DefenseStates.instance = new DefenseStates();
    }
    return DefenseStates.instance;
  }

  /**
   * Активировать уклонение: 1.5 секунды полной неуязвимости.
   *
   * Возвращает false, если рывок ещё на откате. Проверки не было: уклонение
   * стоило 15 стамины, и пока стамина регенерировала, её можно было тратить
   * снова и снова - неуязвимость включалась почти непрерывно.
   */
  activateDodge(characterId: string, now = Date.now()): boolean {
    const st = this.states.get(characterId) ?? freshState();
    if (st.dodgeStartedAt > 0 && now - st.dodgeStartedAt < DODGE_COOLDOWN_MS) return false;
    st.dodgeStartedAt = now;
    st.dodgeUntil = now + DODGE_DURATION_MS;
    // Рывок отменяет щит: держать блок и уклоняться разом нельзя
    st.blockUntil = 0;
    this.states.set(characterId, st);
    return true;
  }

  /** Активировать блок: 2 секунды снижения урона на 60% */
  activateBlock(characterId: string, now = Date.now()): void {
    const st = this.states.get(characterId) ?? freshState();
    // Блок отменяет неуязвимость, иначе игрок держал бы щит и рывок вместе
    st.dodgeUntil = 0;
    st.blockUntil = now + BLOCK_DURATION_MS;
    st.blockStartedAt = now;
    this.states.set(characterId, st);
  }

  /**
   * Досягаемость удара.
   *
   * Считается по оружию в руках, а не «одно число на всех»: у сабли и
   * клинка разная длина, и проверка обязана это учитывать. Если оружие не
   * определено (слот пуст, оружие без полей), берётся боевое умолчание.
   *
   * Если сервер не знает позицию цели (игрок только что вошёл и ещё не
   * отправил ни одного пакета позиции), проверка пропускается: отклонять
   * удар по отсутствию данных означало бы «первый удар не проходит».
   */
  canReach(characterId: string, range: number, targetPos: { x: number; y: number; z: number } | null): boolean {
    if (!targetPos) return true;
    const pos = this.positions.get(characterId);
    if (!pos) return true;
    const dx = pos.x - targetPos.x;
    const dz = pos.z - targetPos.z;
    return Math.sqrt(dx * dx + dz * dz) <= range + REACH_TOLERANCE;
  }

  /** Запомнить позицию персонажа (для проверки досягаемости) */
  setPosition(characterId: string, pos: { x: number; y: number; z: number }): void {
    this.positions.set(characterId, pos);
  }

  /** Рывок сейчас на откате? */
  isDodgeOnCooldown(characterId: string, now = Date.now()): boolean {
    const st = this.states.get(characterId);
    if (!st || st.dodgeStartedAt === 0) return false;
    return now - st.dodgeStartedAt < DODGE_COOLDOWN_MS;
  }

  /**
   * Снять резерв рывка, если действие не состоялось (например, не хватило
   * стамины). Без этого игрок ждал бы отката за рывок, которого не было.
   */
  clearDodge(characterId: string): void {
    const st = this.states.get(characterId);
    if (!st) return;
    st.dodgeUntil = 0;
    st.dodgeStartedAt = 0;
  }

  /** Уклонение активно? */
  isDodging(characterId: string, now = Date.now()): boolean {
    return (this.states.get(characterId)?.dodgeUntil ?? 0) > now;
  }

  /**
   * Блок активен?
   *
   * Метод добавлен вместе с проверкой «блок и рывок не действуют разом».
   * Через getIncomingMultiplier это правило не увидеть: там сначала
   * проверяется неуязвимость, и при активном рывке она возвращает 0 независимо
   * от того, погасил ли рывок щит. То есть проверка «рывок отменяет блок»
   * проходила бы и при выключенном сбросе - то есть ничего не проверяла.
   */
  isBlocking(characterId: string, now = Date.now()): boolean {
    return (this.states.get(characterId)?.blockUntil ?? 0) > now;
  }

  /**
   * Множитель входящего урона (1 — без изменений, 0 — промах).
   *
   * blockReduction передаётся из стойки: у «Танца серпа» щит держит четверть
   * урона, у «Шахского щита» — почти всё. Без этого аргумента стойка была бы
   * только множителем урона, а обещание «оборонительный стиль» - пустым.
   */
  getIncomingMultiplier(characterId: string, now = Date.now(), blockReduction = BLOCK_REDUCTION): number {
    const st = this.states.get(characterId);
    if (!st) return 1;
    if (st.dodgeUntil > now) return 0;
    if (st.blockUntil > now) return 1 - blockReduction;
    return 1;
  }

  /**
   * Парирование: удар попал в первые миллисекунды щита?
   *
   * Возвращает долю урона, которую надо отразить. Ноль - значит не парировано.
   * Проверяется по времени начала блока, а не по отдельному действию.
   */
  getParryReflect(characterId: string, now = Date.now()): number {
    const st = this.states.get(characterId);
    if (!st) return 0;
    if (st.dodgeUntil > now) return 0;
    if (st.blockUntil <= now) return 0;
    // Окно считается от начала блока: игрок должен поднять щит прямо перед
    // ударом. Удар через две секунды после поднятия щита - это уже блок, а
    // не парирование, иначе щик держал бы щит постоянно.
    if (st.blockStartedAt === 0 || now - st.blockStartedAt > PARRY_WINDOW_MS) return 0;
    return PARRY_REFLECT;
  }

  cleanup(characterId: string): void {
    this.states.delete(characterId);
    this.positions.delete(characterId);
  }
}
