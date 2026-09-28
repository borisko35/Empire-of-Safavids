// Индексация сайта: robots.txt, sitemap.xml и правильный домен.
//
// ЧТО БЫЛО. Файлов robots.txt и sitemap.xml не существовало вообще, поэтому
// nginx отдавал на эти адреса лендинг (try_files ... /index.html): поисковик
// получал вместо карты сайта html-страницу и уходил. Дополнительно canonical,
// og:url и og:image на лендинге указывали на empire-of-safavids.com —
// домен, который не отвечает, а картинка превью была относительной ссылкой,
// которую скраперы не открывают.
//
// Домен проверяется не по константе в коде, а по тому, что Caddy реально
// обслуживает: Caddyfile берёт {$DOMAIN} из deploy/.env, а .env на сервере
// живёт и в репозиторий не попадает. Поэтому здесь берём домен из карты
// сайта и требуем, чтобы все остальные ссылки совпадали с ним.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');

const webDir = join(repoRoot, 'client', 'web');
const landing = read('client/web/index.html');
const nginx = read('client/nginx.conf');
const caddy = read('deploy/Caddyfile');

/** Все <loc> из карты сайта */
function locs(): string[] {
  return [...read('client/web/sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].trim());
}

/** Домен из карты сайта — эталон, с которым должны совпадать другие ссылки */
const DOMAIN = (() => {
  const first = locs()[0] ?? '';
  const m = first.match(/^https:\/\/([^/]+)\//);
  if (!m) throw new Error('в sitemap.xml нет абсолютной ссылки с https — тест не может сверить домен');
  return m[1];
})();

describe('Поисковикам нужны robots.txt и sitemap.xml', () => {
  it('оба файла лежат в раздаваемой папке', () => {
    // Файлы вне client/web nginx не отдаст: в образ копируется только web
    expect({ robots: existsSync(join(webDir, 'robots.txt')), sitemap: existsSync(join(webDir, 'sitemap.xml')) })
      .toEqual({ robots: true, sitemap: true });
  });

  it('robots.txt — правила, а не лендинг', () => {
    // ТУТ БЫЛО: файла не было, и try_files отдавал index.html. Поисковик,
    // получивший html вместо правил, индексацию прекращал.
    const robots = read('client/web/robots.txt');
    expect(robots).toMatch(/^User-agent: \*/m);
    expect(robots).toMatch(/^Allow: \/$/m);
  });

  it('технические адреса закрыты от обхода', () => {
    // Без этого робот ходит в админку и в API
    const robots = read('client/web/robots.txt');
    for (const path of ['/admin.html', '/api/', '/socket.io/', '/download/', '/health']) {
      expect({ path, закрыт: robots.includes(`Disallow: ${path}`) }).toEqual({ path, закрыт: true });
    }
  });

  it('nginx отдаёт эти файлы как есть, а не как лендинг', () => {
    // try_files живёт в location /; robots.txt и sitemap.xml лежат рядом с
    // index.html, поэтому /robots.txt и /sitemap.xml попадут в $uri
    expect(nginx).toMatch(/location \/ \{[\s\S]*root \/usr\/share\/nginx\/html/);
    expect(nginx).toMatch(/try_files \$uri \$uri\/ \/index\.html/);
  });
});

describe('Карта сайта описывает все страницы, и ни одна не 404', () => {
  it('в карте есть лендинг, форум, обратную связь и трейлер', () => {
    const paths = locs().map(u => new URL(u).pathname);
    for (const p of ['/', '/forum.html', '/feedback.html', '/trailer.html']) {
      expect({ path: p, есть: paths.includes(p) }).toEqual({ path: p, есть: true });
    }
  });

  it('ГЛАВНОЕ: каждый адрес в карте действительно существует в репозитории', () => {
    // Ссылка в карте на несуществующий файл — это 404 для поисковика.
    // Страницу в nginx не отдаёт: проверяем по файлам.
    const missing: string[] = [];
    for (const url of locs()) {
      const path = new URL(url).pathname;
      if (path === '/') continue;
      if (!existsSync(join(webDir, path.replace(/^\//, '')))) missing.push(path);
    }
    expect({ битые_ссылки: missing }).toEqual({ битые_ссылки: [] });
  });

  it('все адреса абсолютные и на одном домене', () => {
    // Относительный адрес в карте бессмыслен, а разные домены разводят
    // вес между версиями сайта
    const hosts = [...new Set(locs().map(u => new URL(u).host))];
    expect({ хостов: hosts.length, все_абсолютные: locs().every(u => u.startsWith('https://')) })
      .toEqual({ хостов: 1, все_абсолютные: true });
  });

  it('админки в карте нет', () => {
    expect(locs().some(u => new URL(u).pathname.includes('admin'))).toBe(false);
  });

  it('robots.txt называет карту сайта, а не выдуманный адрес', () => {
    const robots = read('client/web/robots.txt');
    expect(robots).toContain(`Sitemap: https://${DOMAIN}/sitemap.xml`);
  });
});

describe('Ссылки на «эталонный» адрес страниц указывают на живой домен', () => {
  it('canonical и og:url совпадают с доменом из карты', () => {
    // ТУТ БЫЛО: empire-of-safavids.com — домен, который не отвечает.
    // Поисковик считал канонической чужую страницу и уводил игроков в пустоту.
    const canonical = landing.match(/rel="canonical" href="([^"]+)"/)?.[1];
    const ogUrl = landing.match(/og:url" content="([^"]+)"/)?.[1];
    expect({ canonical, ogUrl, домен_карты: DOMAIN })
      .toEqual({ canonical: `https://${DOMAIN}/`, ogUrl: `https://${DOMAIN}/`, домен_карты: DOMAIN });
  });

  it('картинка превью указана абсолютно — иначе скрапер её не откроет', () => {
    // Относительный /assets/... Facebook, Telegram и VK не открывают
    for (const prop of ['og:image', 'twitter:image']) {
      const re = new RegExp(`(?:property|name)="${prop}" content="([^"]+)"`);
      const value = landing.match(re)?.[1] ?? '';
      expect({ prop, абсолютная: value.startsWith('https://') }).toEqual({ prop, абсолютная: true });
    }
  });

  it('файл картинки превью есть в репозитории', () => {
    // Ссылка в og:image на отсутствующий файл — превью без картинки
    const value = landing.match(/og:image" content="https?:\/\/[^/]+(\/[^"]+)"/)?.[1] ?? '';
    expect({ файл: value, есть: existsSync(join(webDir, value.replace(/^\//, ''))) })
      .toEqual({ файл: expect.any(String), есть: true });
  });

  it('Caddy обслуживает домен из deploy/.env, и карта не придумывает другой', () => {
    // Caddyfile отдаёт {$DOMAIN} — значит боевой домен задаётся окружением.
    // Соответствие проверяем на живом сервере, здесь — что Caddy вообще
    // не подставляет в адреса свой домен вместо переменной окружения.
    expect(caddy).toMatch(/\{\$DOMAIN\}/);
    expect(locs().every(u => u.startsWith(`https://${DOMAIN}/`))).toBe(true);
  });
});
