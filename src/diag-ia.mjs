// MajorDoc — diagnostic de l'API Claude, en quatre essais de plus en plus complets.
//
//   node src/diag-ia.mjs        (ou : npm run diag-ia)
//
// Quand toutes les fiches échouent, la question est « qu'est-ce que l'API
// refuse ? ». Chaque essai ajoute une seule chose au précédent : le premier qui
// échoue désigne le coupable, avec le message exact de l'API. Coût : quelques
// centimes au plus.

import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { appelAPI, corpsRequete, schemaFiche, lireJson, modeleCompatible } from './summarize.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = path.join(RACINE, '.env');
if (existsSync(env)) {
  for (const ligne of readFileSync(env, 'utf8').split('\n')) {
    const m = ligne.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const config = JSON.parse(readFileSync(path.join(RACINE, 'config.json'), 'utf8'));
const modele = modeleCompatible(config.anthropic?.model);
const themes = Object.keys(config.themes ?? {});

const ARTICLE = `TITRE ORIGINAL : Metformin versus placebo in prediabetes
REVUE : BMJ
ABSTRACT :
In 120 adults with prediabetes, metformin lowered HbA1c by 0.3% versus placebo over 12 months (95% CI 0.1 to 0.5).`;

const essais = [
  ['Clé et modèle', null, { model: modele, max_tokens: 50, messages: [{ role: 'user', content: 'Réponds simplement : OK' }] }],
  ['Réglage effort', null, { model: modele, max_tokens: 2000, output_config: { effort: config.anthropic?.effort ?? 'low' },
    messages: [{ role: 'user', content: 'Réponds simplement : OK' }] }],
  ['Fiche structurée', null, corpsRequete({ modele, maxTokens: 8000, systeme: 'Tu fiches des articles en français.',
    schema: schemaFiche(themes), contenu: ARTICLE, effort: config.anthropic?.effort ?? 'low', repli: null })],
  ['Repli sur refus (beta)', ['server-side-fallback-2026-07-01'], corpsRequete({ modele, maxTokens: 8000,
    systeme: 'Tu fiches des articles en français.', schema: schemaFiche(themes), contenu: ARTICLE,
    effort: config.anthropic?.effort ?? 'low', repli: 'default' })],
];

console.log(`\n  Diagnostic de l'API Claude — modèle ${modele}\n`);
if (!process.env.ANTHROPIC_API_KEY) {
  console.log('  ✗ ANTHROPIC_API_KEY absente (.env).\n');
  process.exit(1);
}
let echecs = 0;
for (const [nom, betas, corps] of essais) {
  try {
    const data = await appelAPI('/messages', corps, { essais: 1, betas: betas ?? [] });
    if (corps.output_config?.format) {
      const fiche = lireJson(data);
      console.log(`  ✓ ${nom} — « ${String(fiche.titre_fr ?? '').slice(0, 60)} »`);
    } else {
      console.log(`  ✓ ${nom} — ${data.usage?.output_tokens ?? '?'} tokens en sortie`);
    }
  } catch (e) {
    echecs++;
    console.log(`  ✗ ${nom} — ${e.message}`);
  }
}
console.log(echecs
  ? '\n  Le premier essai en échec désigne la cause ; copiez ces lignes pour la corriger.\n'
  : '\n  Tout passe : l\'API accepte les requêtes de MajorDoc.\n');
process.exitCode = echecs ? 1 : 0;
