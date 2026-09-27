// ============================================================
// Media Service — Empire of Safavids
// ============================================================
// Загрузка фото и видео силами разработчика, админов и модераторов.
//
// ТРИ ПРАВИЛА, КОТОРЫЕ ЗДЕСЬ ВАЖНЕЕ ВСЕГО ОСТАЛЬНОГО:
//
//  1. Имя файла на диске генерирует сервер, а не человек. То, что
//     прислали, живёт в отдельной колонке только для показа в панели.
//     Иначе в имя файла можно записать «../../etc/passwd» или «a.html»
//     и либо затереть чужой файл, либо положить на сервер страницу с
//     чужим скриптом.
//
//  2. Тип файла определяется по ПЕРВЫМ БАЙТАМ, а не по заголовку
//     Content-Type и не по расширению. И то, и другое задаёт тот, кто
//     отправил запрос: браузер можно обмануть заголовком, а .exe
//     можно переименовать в .png. Сверяем магические числа.
//
//  3. Лимит по размеру разный для картинок и видео. И общий потолок,
//     чтобы одним запросом нельзя было забить диск.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';

import { DatabaseService } from './DatabaseService';
import { logger } from '../utils/logger';

/** Куда складывать файлы. На хосте — тома docker, чтобы пережила пересборку */
export function mediaDir(): string {
  const configured = process.env.MEDIA_DIR;
  if (configured) return path.resolve(configured);
  // В контейнере корень репозитория — /app, рядом лежат client и server
  const candidates = [
    path.resolve(process.cwd(), '..', 'uploads', 'media'),
    path.resolve(process.cwd(), 'uploads', 'media'),
    '/app/uploads/media',
  ];
  const fsMod = fs;
  for (const dir of candidates) {
    if (fsMod.existsSync(path.resolve(dir, '..', '..', 'client'))) return dir;
  }
  return candidates[0];
}

/** Потолок для картинки */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;   // 20 МБ
/** Потолок для видео */
export const MAX_VIDEO_BYTES = 300 * 1024 * 1024; // 300 МБ

export type MediaKind = 'image' | 'video';

export interface MediaKindInfo {
  kind: MediaKind;
  mime: string;
  ext: string;
  /** Человеческое название формата для панели */
  label: string;
}

/**
 * Разрешённые форматы, опознаваемые по сигнатуре файла.
 *
 * offset — с какого байта начинается «отпечаток», length — сколько байт
 * сверять. У mp4 сигнатура лежит на 4-м байте, у webm — в начале.
 */
const SIGNATURES: Array<MediaKindInfo & { offset: number; magic: number[] }> = [
  { kind: 'image', mime: 'image/png',  ext: 'png',  label: 'PNG',  offset: 0, magic: [0x89, 0x50, 0x4E, 0x47] },
  { kind: 'image', mime: 'image/jpeg', ext: 'jpg',  label: 'JPEG', offset: 0, magic: [0xFF, 0xD8, 0xFF] },
  { kind: 'image', mime: 'image/gif',  ext: 'gif',  label: 'GIF',  offset: 0, magic: [0x47, 0x49, 0x46, 0x38] },
  { kind: 'image', mime: 'image/webp', ext: 'webp', label: 'WebP', offset: 8, magic: [0x57, 0x45, 0x42, 0x50] },
  { kind: 'video', mime: 'video/mp4',  ext: 'mp4',  label: 'MP4',  offset: 4, magic: [0x66, 0x74, 0x79, 0x70] },
  { kind: 'video', mime: 'video/webm', ext: 'webm', label: 'WebM', offset: 0, magic: [0x1A, 0x45, 0xDF, 0xA3] },
  { kind: 'video', mime: 'video/quicktime', ext: 'mov', label: 'MOV', offset: 4, magic: [0x66, 0x74, 0x79, 0x70] },
];

/**
 * Определить формат по содержимому.
 *
 * ВАЖНО: mp4 и mov имеют одинаковую сигнатуру и различаются только
 * расширением, которое прислал клиент. Мы не доверяем ему и отдаём mp4:
 * браузеры играют mp4 одинаково, зато расширение нельзя подделать.
 */
export function sniff(buf: Buffer): MediaKindInfo | null {
  for (const sig of SIGNATURES) {
    if (buf.length < sig.offset + sig.magic.length) continue;
    let ok = true;
    for (let i = 0; i < sig.magic.length; i++) {
      if (buf[sig.offset + i] !== sig.magic[i]) { ok = false; break; }
    }
    if (!ok) continue;
    // MOV отдаём как mp4: сигнатура общая, доверия расширению нет
    const ext = sig.ext === 'mov' ? 'mp4' : sig.ext;
    const mime = sig.ext === 'mov' ? 'video/mp4' : sig.mime;
    return { kind: sig.kind, mime, ext, label: sig.label };
  }
  return null;
}

/** Размер PNG и JPEG: только эти два формата дают размеры без декодирования */
function readImageSize(buf: Buffer): { width: number; height: number } | null {
  // PNG: IHDR на байтах 16..23
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504E47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // JPEG: перебираем сегменты до SOFn
  if (buf.length >= 4 && buf[0] === 0xFF && buf[1] === 0xD8) {
    let off = 2;
    while (off + 9 < buf.length) {
      if (buf[off] !== 0xFF) { off++; continue; }
      const marker = buf[off + 1];
      // SOF0..SOF15, кроме не-кадровых DHT/JPG/DAC
      if (marker >= 0xC0 && marker <= 0xCF
          && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
        return { height: buf.readUInt16BE(off + 5), width: buf.readUInt16BE(off + 7) };
      }
      const segLen = buf.readUInt16BE(off + 2);
      if (segLen < 2) return null;
      off += 2 + segLen;
    }
  }
  return null;
}

export interface MediaFile {
  id: string;
  url: string;
  originalName: string;
  kind: MediaKind;
  mime: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  createdAt: string;
  uploadedBy: string | null;
  /**
   * Показывается ли файл в галерее на сайте.
   *
   * ТУТ БЫЛА ДЫРА В ЗАМЫСЛЕ. Панель загрузки позволяла залить файл и
   * получить ссылку, но не давала выбрать, попадёт ли он на сайт: страницы
   * сайта собираются в образ и не меняются без пересборки. То есть
   * сотрудник заливал снимок — и он просто нигде не появлялся, а по
   * инструкции надо было ещё звать разработчика.
   */
  isPublic: boolean;
  /** Подпись под файлом в галерее. Пишет сотрудник */
  caption: string | null;
  /** Когда включили публикацию. null — файл так и не опубликован */
  publishedAt: string | null;
}

export class MediaService {
  private db = DatabaseService.getInstance();

  /**
   * Сохранить файл.
   *
   * Порядок проверок важен: сначала сигнатура, потом размер. Иначе
   * пришлось бы читать в память 300 МБ, чтобы потом узнать, что это
   * вовсе не видео.
   */
  async save(
    data: Buffer,
    originalName: string,
    uploadedBy: string | undefined,
    baseUrl: string,
  ): Promise<MediaFile> {
    if (!data || data.length === 0) throw mediaError('empty_file', 'Файл пустой');

    const info = sniff(data);
    if (!info) {
      throw mediaError(
        'unsupported_format',
        'Поддерживаются PNG, JPEG, GIF, WebP, MP4 и WebM',
      );
    }

    const limit = info.kind === 'image' ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
    if (data.length > limit) {
      const mb = Math.round(limit / 1024 / 1024);
      throw mediaError('file_too_large', `Больше ${mb} МБ для этого формата`);
    }

    // Генерируем имя сами. Оригинал сюда не попадает вообще.
    const storageName = `${uuidv4()}.${info.ext}`;
    const dir = mediaDir();
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, storageName), data);

    const size = info.kind === 'image' ? readImageSize(data) : null;

    let id: string;
    try {
      const row = await this.db.queryOne<{ id: string }>(
        `INSERT INTO media_files
           (storage_name, original_name, kind, mime, size_bytes, width, height, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [storageName, originalName.slice(0, 255), info.kind, info.mime, data.length,
         size?.width ?? null, size?.height ?? null, uploadedBy ?? null],
      );
      id = row!.id;
    } catch (err) {
      // Запись в базу не удалась — файл не должен остаться сиротой
      await fsp.unlink(path.join(dir, storageName)).catch(() => {});
      throw err;
    }

    logger.info(`[Media] uploaded ${originalName} -> ${storageName} (${data.length} bytes) by ${uploadedBy}`);
    return {
      id,
      url: `${baseUrl}/media/${storageName}`,
      originalName,
      kind: info.kind,
      mime: info.mime,
      sizeBytes: data.length,
      width: size?.width ?? null,
      height: size?.height ?? null,
      createdAt: new Date().toISOString(),
      uploadedBy: uploadedBy ?? null,
      // Новый файл всегда черновик: публикация — отдельное решение
      // сотрудника, а не побочный эффект загрузки
      isPublic: false,
      caption: null,
      publishedAt: null,
    };
  }

  /** Список файлов, свежие сверху */
  async list(limit = 100): Promise<MediaFile[]> {
    const rows = await this.db.query<{
      id: string; storage_name: string; original_name: string; kind: MediaKind;
      mime: string; size_bytes: string; width: number | null; height: number | null;
      created_at: Date; uploaded_by: string | null;
      is_public: boolean; caption: string | null; published_at: Date | null;
    }>(
      `SELECT id, storage_name, original_name, kind, mime, size_bytes,
              width, height, created_at, uploaded_by,
              is_public, caption, published_at
         FROM media_files
        ORDER BY created_at DESC
        LIMIT $1`, [limit],
    );
    return rows.map((r) => ({
      id: r.id,
      url: `/media/${r.storage_name}`,
      originalName: r.original_name,
      kind: r.kind,
      mime: r.mime,
      sizeBytes: Number(r.size_bytes),
      width: r.width,
      height: r.height,
      createdAt: new Date(r.created_at).toISOString(),
      uploadedBy: r.uploaded_by,
      isPublic: r.is_public,
      caption: r.caption,
      publishedAt: r.published_at ? new Date(r.published_at).toISOString() : null,
    }));
  }

  /**
   * Галерея сайта: только опубликованные файлы.
   *
   * Отдельный метод, а не list() с фильтром, потому что у галереи три
   * отличия от панели, и все три важны:
   *   1. Без авторизации. Галерею смотрит любой посетитель сайта, в том
   *      числе гость и поисковый робот.
   *   2. Только опубликованные. Черновик не должен протекать на главную.
   *   3. Сортировка по дате публикации, а не загрузки: сотрудник мог
   *      залить снимок месяц назад и опубликовать вчера — наверху должен
   *      оказаться вчерашний, а не тот, который в базе старше.
   */
  async gallery(limit = 12): Promise<MediaFile[]> {
    const rows = await this.db.query<{
      id: string; storage_name: string; original_name: string; kind: MediaKind;
      mime: string; size_bytes: string; width: number | null; height: number | null;
      created_at: Date; uploaded_by: string | null;
      is_public: boolean; caption: string | null; published_at: Date | null;
    }>(
      `SELECT id, storage_name, original_name, kind, mime, size_bytes,
              width, height, created_at, uploaded_by,
              is_public, caption, published_at
         FROM media_files
        WHERE is_public
        ORDER BY published_at DESC
        LIMIT $1`, [limit],
    );
    return rows.map((r) => ({
      id: r.id,
      // Относительный адрес: галерею смотрят и на сайте, и внутри игры
      url: `/media/${r.storage_name}`,
      originalName: r.original_name,
      kind: r.kind,
      mime: r.mime,
      sizeBytes: Number(r.size_bytes),
      width: r.width,
      height: r.height,
      createdAt: new Date(r.created_at).toISOString(),
      uploadedBy: r.uploaded_by,
      isPublic: true,
      caption: r.caption,
      publishedAt: r.published_at ? new Date(r.published_at).toISOString() : null,
    }));
  }

  /**
   * Включить или выключить показ файла на сайте, заодно сменив подпись.
   *
   * published_at ставится только при включении и сбрасывается при
   * выключении. Иначе после «опубликовать → снять → опубликовать снова»
   * файл возвращался бы наверх с датой первой публикации, и сотрудник не
   * смог бы изменить порядок выкладки, просто переключив галочку.
   */
  async setPublished(
    id: string,
    isPublic: boolean,
    caption: string | null,
  ): Promise<MediaFile | null> {
    // Подпись режем до 200 символов — ровно столько объявлено в схеме.
    // Без этого длинная подпись молча обрезалась бы Postgres, и панель
    // показывала бы не то, что сотрудник посчитал отправленным.
    const clean = (caption ?? '').trim().slice(0, 200) || null;
    const row = await this.db.queryOne<{
      id: string; storage_name: string; original_name: string; kind: MediaKind;
      mime: string; size_bytes: string; width: number | null; height: number | null;
      created_at: Date; uploaded_by: string | null;
      is_public: boolean; caption: string | null; published_at: Date | null;
    }>(
      `UPDATE media_files
          SET is_public = $2,
              caption = $3,
              published_at = CASE WHEN $2 THEN NOW() ELSE NULL END
        WHERE id = $1
        RETURNING id, storage_name, original_name, kind, mime, size_bytes,
                  width, height, created_at, uploaded_by,
                  is_public, caption, published_at`,
      [id, isPublic, clean],
    );
    if (!row) return null;
    return {
      id: row.id,
      url: `/media/${row.storage_name}`,
      originalName: row.original_name,
      kind: row.kind,
      mime: row.mime,
      sizeBytes: Number(row.size_bytes),
      width: row.width,
      height: row.height,
      createdAt: new Date(row.created_at).toISOString(),
      uploadedBy: row.uploaded_by,
      isPublic: row.is_public,
      caption: row.caption,
      publishedAt: row.published_at ? new Date(row.published_at).toISOString() : null,
    };
  }

  /** Удалить: и запись, и файл. Порядок именно такой — см. removeFile */
  async remove(id: string): Promise<boolean> {
    const row = await this.db.queryOne<{ storage_name: string }>(
      'SELECT storage_name FROM media_files WHERE id = $1', [id],
    );
    if (!row) return false;
    const deleted = await this.db.queryOne<{ id: string }>(
      'DELETE FROM media_files WHERE id = $1 RETURNING id', [id],
    );
    if (!deleted) return false;
    await removeFile(row.storage_name);
    return true;
  }

  /** Сколько всего места занято — показываем в панели */
  async usage(): Promise<{ count: number; bytes: number }> {
    const row = await this.db.queryOne<{ n: string; total: string }>(
      'SELECT COUNT(*)::text AS n, COALESCE(SUM(size_bytes), 0)::text AS total FROM media_files',
    );
    return { count: Number(row?.n ?? 0), bytes: Number(row?.total ?? 0) };
  }
}

/**
 * Убрать файл с диска.
 *
 * storage_name приходит из базы, но проверяем всё равно: если в базу
 * попадёт «../../…», path.join вылезет за пределы папки. Проверяем
 * результат, а не вход.
 */
export async function removeFile(storageName: string): Promise<void> {
  const dir = mediaDir();
  const target = path.resolve(dir, storageName);
  if (path.dirname(target) !== path.resolve(dir)) {
    logger.warn(`[Media] refused to delete outside media dir: ${storageName}`);
    return;
  }
  await fsp.unlink(target).catch(() => {});
}

function mediaError(code: string, message: string): Error {
  const err = new Error(message);
  (err as Error & { code: string }).code = code;
  return err;
}
