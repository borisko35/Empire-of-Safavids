// Назначать раны в гильдии может не всякий.
//
// ЧТО БЫЛО. setRank проверял, что ранг существует, что назначают не себя
// и что не лидера, - и этого хватало. Проверки прав НАЗНАЧАТЕЛЯ не было
// вовсе: любой участник гильдии, включая новобранца, мог сделать кого
// угодно офицером. Правила рангов были написаны в data/guilds.ts, который
// не импортировался нигде.
//
// ЧТО ТЕПЕРЬ. Сервис сверяется со справочником: право promote и правило
// «назначить можно только того, кто ниже тебя». Два источника прав о
// рангов были бы двумя правдами - список рангов в сервисе разошёлся бы со
// справочником, и при новом ранге одно из двух мест молча перестало бы
// работать.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GuildService } from '../services/GuildService';
import {
  GUILD_RANKS, getGuildRankPermissions, canPromote, type GuildRank,
} from '../data/guilds';

jest.mock('../services/DatabaseService', () => ({
  DatabaseService: { getInstance: () => ({ query: jest.fn(), queryOne: jest.fn(), transaction: jest.fn() }) },
}));
jest.mock('../services/RedisService', () => ({
  RedisService: { getInstance: () => ({ publish: jest.fn(), subscribe: jest.fn() }) },
}));
jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const GUILD = 'aaaaaaaa-1111-4111-8111-111111111111';
const LEADER = 'bbbbbbbb-1111-4111-8111-111111111111';
const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');

/**
 * Подмена базы.
 *
 * Ранг участника приходит одним SELECT, и подмена отвечает по тексту
 * запроса, а не по порядку вызовов: getGuild тоже ходит в базу, и ответ
 * «по очереди» привязал бы проверку к порядку запросов внутри метода.
 */
function подменить(opts: {
  рангНазначателя: GuildRank | null;
  рангЦели: GuildRank | null;
  /** Персонаж, который назначает. Ответ по нему и отличает его от цели. */
  персонажНазначателя?: string;
  лидерЦели?: boolean;
}): { service: GuildService; запросы: string[] } {
  const service = new GuildService();
  const запросы: string[] = [];
  const db = {
    query: jest.fn(async (sql: string) => {
      запросы.push(sql);
      if (/UPDATE guild_members SET rank/.test(sql)) return [{ character_id: 'x' }];
      return [];
    }),
    queryOne: jest.fn(async (sql: string, params: unknown[] = []) => {
      запросы.push(sql);
      if (/SELECT rank FROM guild_members/.test(sql)) {
        // Ответ по переданному персонажу, а не по порядку вызовов: оба
        // запроса дают одинаковый SQL, и прежняя подмена отдавала первую
        // же строку обоим, из-за чего «чужой» выглядел офицером.
        const кого = String(params[1] ?? '');
        const ранг = кого === opts.персонажНазначателя ? opts.рангНазначателя : opts.рангЦели;
        // Отсутствие строки - это null, а не объект с рангом null: объект
        // прошёл бы проверку «нет ли актера» как правдивый, и чужой получил
        // бы права неопределённого ранга вместо честного отказа.
        return ранг ? { rank: ранг } : null;
      }
      if (/FROM guilds/.test(sql)) {
        return { id: GUILD, name: 'Клан', tag: 'CLN', leader_id: opts.лидерЦели ? LEADER : 'другой' };
      }
      return null;
    }),
    transaction: jest.fn(),
  };
  (service as unknown as { db: unknown }).db = db;
  return { service, запросы };
}

describe('Справочник рангов и сервис говорят одно', () => {
  it('список рангов в сервисе взят из справочника, а не выдуман заново', () => {
    // Пять рангов против четырёх: в сервисе не было 'recruit', который в
    // справочнике есть. Расхождение в списке - это расхождение в правилах.
    const сервис = читать('server/src/services/GuildService.ts');
    expect({ справочник_импортирован: /from '\.\.\/data\/guilds'/.test(сервис) })
      .toEqual({ справочник_импортирован: true });
  });

  it('в справочнике есть право promote и оно не у всех', () => {
    // Если бы право было у всех рангов, проверка прав держалась бы на
    // одном лишь правиле «ниже тебя», и новичок всё равно смог бы
    // назначить офицера офицером.
    const права = GUILD_RANKS.map(r => ({ rank: r.rank, promote: r.permissions.promote }));
    expect({
      права,
      у_кого_есть: права.filter(p => p.promote).map(p => p.rank),
      у_кого_нет: права.filter(p => !p.promote).map(p => p.rank),
    }).toEqual({
      права,
      // Только лидер. Офицер умеет исключать и распоряжаться казной, но
      // ранги не назначает - так написано в справочнике.
      у_кого_есть: ['leader'],
      у_кого_нет: ['officer', 'veteran', 'member', 'recruit'],
    });
  });

  it('назначить можно только того, кто ниже по рангу', () => {
    // Порядок рангов в canPromote написан руками, а не выведен из
    // GUILD_RANKS: если бы порядок выводился из массива, смена сортировки
    // в справочнике тихо переставила бы права.
    // Правило: назначать можно ранг СТРОГО ниже своего, иначе офицер сделал
    // бы второго офицера, а новобранец - ветерана. Первый вариант проверки
    // ждал, что офицер может назначить ветерана, и ругался на верный код.
    expect({
      лидер_может_ветерана: canPromote('leader', 'veteran'),
      лидер_не_может_официера: canPromote('leader', 'officer'),
      ветеран_может_новобранца: canPromote('veteran', 'recruit'),
      ветеран_не_может_члена: canPromote('veteran', 'member'),
      новобранец_не_может_никого: canPromote('recruit', 'member'),
    }).toEqual({
      лидер_может_ветерана: true, лидер_не_может_официера: false,
      ветеран_может_новобранца: true, ветеран_не_может_члена: false,
      новобранец_не_может_никого: false,
    });
  });

  it('неизвестный ранг не проходит проверку прав', () => {
    // Ранг из базы может оказаться чем-то новым, чего справочник не знает.
    // Тогда прав нет, а не «кажется, можно».
    expect(getGuildRankPermissions('такого_ранга' as GuildRank)).toEqual(undefined);
  });
});

describe('Новобранец не может назначать ранги', () => {
  it('отказ идёт по правам, а запись не происходит', async () => {
    const { service, запросы } = подменить({ рангНазначателя: 'recruit', рангЦели: 'member', персонажНазначателя: 'recruit-char' });
    await expect(service.setRank(GUILD, 'recruit-char', 'target-char', 'officer'))
      .rejects.toThrow('RANKS_FORBIDDEN');
    expect({ записи_не_было: !запросы.some(q => /UPDATE guild_members SET rank/.test(q)) })
      .toEqual({ записи_не_было: true });
  });

  it('тот же отказ для ветерана и для обычного участника', async () => {
    for (const ранг of ['veteran', 'member'] as GuildRank[]) {
      const { service } = подменить({ рангНазначателя: ранг, рангЦели: 'member', персонажНазначателя: 'actor' });
      await expect(service.setRank(GUILD, 'actor', 'target', 'veteran'))
        .rejects.toThrow('RANKS_FORBIDDEN');
    }
  });

  it('чужой в гильдию пройти не может', async () => {
    // Ранга нет - значит и прав нет. Раньше проверки не было вовсе, и
    // достаточно было знать идентификатор гильдии.
    const { service } = подменить({ рангНазначателя: null, рангЦели: 'member', персонажНазначателя: 'чужой' });
    await expect(service.setRank(GUILD, 'чужой', 'target', 'officer'))
      .rejects.toThrow('NOT_A_MEMBER');
  });

  it('лидер назначает ветерана', async () => {
    // Обратная сторона: проверка не должна запрещать всё подряд. Раньше
    // «офицер назначает ветерана» было бы верным ожиданием, но в
    // справочнике право promote есть только у лидера, и проверка прав
    // отказывает офицеру раньше, чем доходит до иерархии.
    const { service, запросы } = подменить({ рангНазначателя: 'leader', рангЦели: 'member', персонажНазначателя: 'leader-char' });
    await service.setRank(GUILD, 'leader-char', 'target-char', 'veteran');
    expect({ запись_прошла: запросы.some(q => /UPDATE guild_members SET rank/.test(q)) })
      .toEqual({ запись_прошла: true });
  });

  it('офицер ранги не назначает: права promote нет ни у кого, кроме лидера', async () => {
    // Проверка прав срабатывает раньше проверки иерархии, и это верно:
    // офицер не может назначить даже новобранца.
    const { service } = подменить({ рангНазначателя: 'officer', рангЦели: 'recruit', персонажНазначателя: 'officer-char' });
    await expect(service.setRank(GUILD, 'officer-char', 'target-char', 'member'))
      .rejects.toThrow('RANKS_FORBIDDEN');
  });
});

describe('Нельзя назначить ранг себе или выше своего', () => {
  it('офицер не может сделать второго офицера', async () => {
    // canPromote пропускает равные ранги, и это правильно для ЦЕЛИ.
    // Но в качестве НАЗНАЧАЕМОГО ранга равенство означало бы, что офицер
    // раздаёт офицерство. Проверять надо обе стороны.
    // Лидер, а не офицер: у офицера нет права promote, и проверка прав
    // отказала бы раньше, чем дошло до иерархии. Проверять иерархию под тем,
    // кто до неё не дойдёт, бессмысленно.
    const { service } = подменить({ рангНазначателя: 'leader', рангЦели: 'member', персонажНазначателя: 'leader-char' });
    await expect(service.setRank(GUILD, 'leader-char', 'target-char', 'officer'))
      .rejects.toThrow('RANK_OUT_OF_REACH');
  });

  it('офицер не может понизить офицера: сначала права, потом иерархия', async () => {
    // Цель выше назначателя: офицер пытается разжаловать офицера.
    //
    // Имя говорит то, что проверяет на самом деле. Ожидался
    // RANK_OUT_OF_REACH, но приходит RANKS_FORBIDDEN: у офицера нет права
    // promote, и проверка прав срабатывает раньше проверки иерархии. Обе
    // проверки нужны, но порядок виден только по факту.
    const { service } = подменить({ рангНазначателя: 'officer', рангЦели: 'officer', персонажНазначателя: 'officer-char' });
    await expect(service.setRank(GUILD, 'officer-char', 'other-officer', 'member'))
      .rejects.toThrow('RANKS_FORBIDDEN');
  });

  it('проверка есть в коде сервиса, а не только в тесте', () => {
    // Поведенческая проверка ловит отказ, но не ловит его ОТСУТСТВИЕ так
    // надёжно: без проверки setRank вернул бы ошибку только потому, что
    // UPDATE не нашёл строку. Исходник страхует.
    const сервис = читать('server/src/services/GuildService.ts');
    const блок = сервис.slice(сервис.indexOf('async setRank'), сервис.indexOf('async addContribution'));
    expect({
      спрашивает_ранг_назначателя: /getMemberRank\(guildId, actorId\)/.test(блок),
      проверяет_право: /права\?\.promote/.test(блок),
      проверяет_иерархию_цели: /canPromote\(актер\.rank, текущий\.rank\)/.test(блок),
      проверяет_иерархию_нового: /canPromote\(актер\.rank, rank as GuildRank\)/.test(блок),
    }).toEqual({
      спрашивает_ранг_назначателя: true, проверяет_право: true,
      проверяет_иерархию_цели: true, проверяет_иерархию_нового: true,
    });
  });
});

describe('Новый ранг не останется незамеченным', () => {
  it('список рангов сервиса покрыт справочником', () => {
    // Первая версия правки держала в сервисе свой список из четырёх
    // рангов. Справочник знает пять, и 'recruit' в сервисе просто не
    // существовал бы. Проверка заставляет расширить сервис при новом
    // ранге в справочнике.
    const сервис = читать('server/src/services/GuildService.ts');
    const блок = сервис.slice(сервис.indexOf('async setRank'));
    // Тип массива может быть string[] или GuildRank[]: ранг приходит из тела
    // запроса и для проверки «есть ли такой ранг» должен оставаться
    // строкой. Ищем список рангов независимо от типа.
    const вСервисе = /=\s*\[([^\]]*'[a-z]+'[^\]]*)\]/.exec(блок)?.[1]
      ?.match(/'([a-z]+)'/g)?.map(s => s.replace(/'/g, '')) ?? [];
    const вСправочнике = GUILD_RANKS.map(r => r.rank);
    expect({ в_справочнике: вСправочнике, в_сервисе_есть_все: вСправочнике.every(r => вСервисе.includes(r)) })
      .toEqual({ в_справочнике: вСправочнике, в_сервисе_есть_все: true });
  });
});
