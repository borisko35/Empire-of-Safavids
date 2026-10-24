// Временный приёмник кадров для проверки §317. В игру не входит.
// Браузер отдаёт dataURL холста POST-ом, сервер кладёт его файлом.
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ПАПКА = join(process.cwd(), 'tools', 'shots');
mkdirSync(ПАПКА, { recursive: true });

createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method !== 'POST') { res.writeHead(200); res.end('ok'); return; }
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const url = new URL(req.url, 'http://localhost');
    const имя = (url.searchParams.get('name') || 'shot').replace(/[^\w.-]/g, '_');
    let тело = Buffer.concat(chunks).toString('utf8');
    const запятая = тело.indexOf(',');
    if (тело.startsWith('data:') && запятая > 0) тело = тело.slice(запятая + 1);
    const байт = Buffer.from(тело, 'base64');
    const файл = join(ПАПКА, `${имя}.jpg`);
    writeFileSync(файл, байт);
    console.log(`[shot] ${файл} ${байт.length} байт`);
    res.writeHead(200); res.end('saved');
  });
}).listen(8099, '127.0.0.1', () => console.log('[shot] http://127.0.0.1:8099/shot?name=...'));
