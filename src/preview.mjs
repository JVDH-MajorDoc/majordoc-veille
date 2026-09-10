// Petit serveur statique pour visualiser le site en local, sans dépendance.
//   npm run preview   →   http://localhost:4173
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = process.argv[2] ? path.resolve(process.argv[2]) : path.join(RACINE, 'site');
const PORT = Number(process.env.PORT) || 4173;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

createServer(async (req, res) => {
  try {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let cible = path.join(SITE, path.normalize(url).replace(/^(\.\.[/\\])+/, ''));
    if (!cible.startsWith(SITE)) throw Object.assign(new Error('interdit'), { code: 403 });
    if ((await stat(cible).catch(() => null))?.isDirectory()) cible = path.join(cible, 'index.html');
    const corps = await readFile(cible);
    res.writeHead(200, { 'content-type': TYPES[path.extname(cible)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(corps);
  } catch (e) {
    res.writeHead(e.code === 403 ? 403 : 404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Introuvable. Avez-vous lancé « npm run demo » ou « npm run digest » ?');
  }
}).listen(PORT, () => {
  console.log(`\n  MajorDoc — aperçu sur http://localhost:${PORT}\n  (dossier : ${SITE})\n`);
});
