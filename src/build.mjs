// MajorDoc — assemblage du site.
//
// Produit un dossier `site/` prêt à déposer sur un serveur web :
//
//   site/index.html
//   site/assets/{app.css, app.js, favicon.svg, fonts/*.woff2}
//   site/data/index.json               liste des journées disponibles
//   site/data/AAAA-MM-JJ.json          une journée
//   site/data/AAAA-MM-JJ-sources.json  les résumés d'origine de cette journée
//
// Les résumés d'origine voyagent à part, et ce n'est pas un détail d'implémentation :
// la recherche dans les archives télécharge TOUTES les journées. Embarquer les
// abstracts dans le fichier du jour aurait plus que doublé ce volume pour une
// donnée que l'on ouvre une fois sur vingt. Ce fichier-ci n'est chargé que lorsque
// la lectrice déplie « Résumé d'origine ».
//
// Publier une nouvelle journée = envoyer deux petits fichiers JSON.
// L'option --inline produit en plus un board.html totalement autonome
// (polices comprises) : un seul fichier à transmettre par mail.

import { readFile, writeFile, readdir, mkdir, copyFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { purgerAudio } from './voix.mjs';

const JOURS_INDEX = 0;   // 0 = toutes les journées conservées sur disque

export async function construire({ racine, digest, sortie, inline = false, joursIndex = JOURS_INDEX, conservation = 0, retentionAudio = 0 }) {
  const theme = path.join(racine, 'src', 'theme');
  const site = sortie ?? path.join(racine, 'site');
  const assets = path.join(site, 'assets');
  const data = path.join(site, 'data');

  await mkdir(path.join(assets, 'fonts'), { recursive: true });
  await mkdir(data, { recursive: true });

  // 1. Gabarit et ressources statiques.
  //    Le CSS et le JS sont mis en cache un mois par le serveur : sans empreinte
  //    dans l'URL, une mise à jour resterait invisible pour les lecteurs jusqu'à
  //    ce qu'ils vident leur cache à la main. On suffixe donc chaque adresse d'un
  //    condensé du contenu — il change quand le fichier change, et pas autrement.
  const css = await readFile(path.join(theme, 'app.css'), 'utf8');
  const js = await readFile(path.join(theme, 'app.js'), 'utf8');
  const empreinte = (t) => createHash('sha1').update(t).digest('hex').slice(0, 8);

  await writeFile(path.join(assets, 'app.css'), css);
  await writeFile(path.join(assets, 'app.js'), js);
  await writeFile(
    path.join(site, 'index.html'),
    (await readFile(path.join(theme, 'index.html'), 'utf8'))
      .replace('href="assets/app.css"', `href="assets/app.css?v=${empreinte(css)}"`)
      .replace('src="assets/app.js"', `src="assets/app.js?v=${empreinte(js)}"`)
  );
  await writeFile(path.join(assets, 'favicon.svg'), FAVICON);
  // Icône d'écran d'accueil iOS/iPadOS : la porte d'entrée sans friction sur
  // l'appareil où la veille se lit le plus souvent.
  const icone = path.join(theme, 'apple-touch-icon.png');
  if (existsSync(icone)) await copyFile(icone, path.join(assets, 'apple-touch-icon.png'));
  await writeFile(path.join(site, '.htaccess'), HTACCESS);
  await writeFile(path.join(site, 'robots.txt'), 'User-agent: *\nDisallow: /\n');

  const polices = await readdir(path.join(theme, 'fonts'));
  for (const f of polices) await copyFile(path.join(theme, 'fonts', f), path.join(assets, 'fonts', f));

  // 2. Journée du jour — les résumés d'origine partent dans un fichier voisin.
  if (digest) {
    const { textesSource, ...jour } = digest;
    const aSources = textesSource && Object.keys(textesSource).length > 0;
    if (aSources) {
      jour.aSources = true;
      await writeFile(path.join(data, `${digest.date}-sources.json`), JSON.stringify(textesSource));
    }
    await writeFile(path.join(data, `${digest.date}.json`), JSON.stringify(jour));
  }

  // 3. Index des journées disponibles
  // Les journées passées ne sont jamais supprimées : 25 Ko par jour, soit 9 Mo par an.
  // Elles restent toutes accessibles depuis le sélecteur de date et la recherche
  // dans les archives. `jours_conservation` permet malgré tout de purger si besoin.
  // L'audio a sa propre rétention, bien plus courte : quelques Mo par journée
  // contre 25 Ko de texte, et personne n'écoute la fiche du mois dernier.
  await purgerAudio(path.join(data, 'audio'), retentionAudio);

  const fichiers = (await readdir(data)).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().reverse();

  if (conservation > 0) {
    const limite = new Date(Date.now() - conservation * 86400000).toISOString().slice(0, 10);
    for (const f of fichiers.filter((f) => f.slice(0, 10) < limite)) {
      await rm(path.join(data, f), { force: true });
      await rm(path.join(data, `${f.slice(0, 10)}-sources.json`), { force: true });
    }
  }

  const jours = [];
  for (const f of (conservation > 0 ? fichiers.filter((f) => f.slice(0, 10) >= new Date(Date.now() - conservation * 86400000).toISOString().slice(0, 10)) : fichiers)) {
    if (joursIndex > 0 && jours.length >= joursIndex) break;
    const d = JSON.parse(await readFile(path.join(data, f), 'utf8'));
    const nb = (d.articles ?? []).length, nbRecos = (d.recos ?? []).length;
    // Sans édito (journée vide), le panneau des archives affichait « Veille du
    // jour » sur toute une série de jours calmes : indistincts, donc illisibles.
    jours.push({ date: d.date, titre: d.edito?.titre ?? (nb + nbRecos === 0 ? 'Rien de neuf ce jour-là' : null), nb, recos: nbRecos });
  }
  await writeFile(
    path.join(data, 'index.json'),
    JSON.stringify({ specialite: digest?.specialite ?? jours[0]?.specialite ?? '', misAJour: new Date().toISOString(), jours }, null, 2)
  );

  // 4. Fichier autonome facultatif
  let fichierInline = null;
  if (inline && digest) {
    fichierInline = path.join(racine, 'board.html');
    await writeFile(fichierInline, await autonome({ theme, digest }));
  }

  return { site, jours: jours.length, inline: fichierInline };
}

/** Assemble un HTML unique : CSS + JS + polices en base64, données inlinées. */
async function autonome({ theme, digest }) {
  let css = await readFile(path.join(theme, 'app.css'), 'utf8');
  const police = async (nom) => (await readFile(path.join(theme, 'fonts', nom))).toString('base64');
  for (const nom of await readdir(path.join(theme, 'fonts'))) {
    css = css.replaceAll(`./fonts/${nom}`, `data:font/woff2;base64,${await police(nom)}`);
  }
  const js = await readFile(path.join(theme, 'app.js'), 'utf8');
  const html = await readFile(path.join(theme, 'index.html'), 'utf8');

  // Toutes les substitutions passent par une fonction : sinon les motifs
  // « $& » présents dans le code source seraient interprétés par String.replace.
  return html
    .replace(/<link rel="preload"[^>]*>\s*/g, '')
    .replace(/<link rel="apple-touch-icon"[^>]*>\s*/g, '')
    .replace('<link rel="icon" href="assets/favicon.svg" type="image/svg+xml" />',
      () => `<link rel="icon" href="data:image/svg+xml;base64,${Buffer.from(FAVICON).toString('base64')}" />`)
    .replace('<link rel="stylesheet" href="assets/app.css" />', () => `<style>${css}</style>`)
    .replace('<script src="assets/app.js"></script>', () => `<script>${js.replace(/<\/script/gi, '<\\/script')}</script>`)
    .replace(
      /\/\*__DATA__\*\/[\s\S]*?\/\*__FIN__\*\//,
      () => '/*__DATA__*/' + JSON.stringify(digest).replace(/<\/script/gi, '<\\/script') + '/*__FIN__*/'
    );
}

const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="5" fill="#16324a"/>
  <path d="M6.6 23.4V8.6h3.1l5.4 9.2 5.4-9.2h3.1v14.8h-2.9v-9.3l-4.4 7.4h-2.4l-4.4-7.4v9.3z" fill="#f6f4ef"/>
</svg>`;

const HTACCESS = `# MajorDoc — en-têtes de cache
<IfModule mod_headers.c>
  <FilesMatch "\\.(woff2|css|js|svg)$">
    Header set Cache-Control "public, max-age=2592000, immutable"
  </FilesMatch>
  <FilesMatch "\\.json$">
    Header set Cache-Control "no-cache, must-revalidate"
  </FilesMatch>
  Header set X-Content-Type-Options "nosniff"
  Header set Referrer-Policy "no-referrer"
</IfModule>
<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE text/html text/css application/javascript application/json image/svg+xml
</IfModule>
AddType font/woff2 .woff2
DirectoryIndex index.html
`;

/** « 12 480 tokens entrée · 8 231 sortie ≈ 0,19 € » — les euros si le tarif est connu. */
function coutTexte(usage, tarif) {
  let t = `${usage.entree.toLocaleString('fr-FR')} tokens entrée · ${usage.sortie.toLocaleString('fr-FR')} sortie`;
  if (tarif && (tarif.entree_usd_mtok || tarif.sortie_usd_mtok)) {
    const eur = ((usage.entree / 1e6) * (tarif.entree_usd_mtok ?? 0) + (usage.sortie / 1e6) * (tarif.sortie_usd_mtok ?? 0)) * (tarif.eur_usd ?? 1);
    t += eur < 0.005 && eur > 0 ? ' · moins de 0,01 €'
       : ` · ≈ ${eur.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
  }
  return t;
}

export function fabriquerDigest({ config, articles, recos = [], edito, sources, sourcesFr = [], scannes, modele, usage, manquants = 0, demo = false, date, alerteHeures = 48, textesSource = null }) {
  return {
    date: date ?? new Date().toISOString().slice(0, 10),
    genereLe: new Date().toISOString(),
    alerteHeures,
    specialite: config?.specialite ?? '',
    // La liste officielle voyage avec la journée : le panneau « Mes thèmes »
    // propose ainsi toutes les rubriques de la spécialité, pas seulement celles
    // qui se trouvent avoir un article ce matin — une liste qui change tous les
    // jours est une liste qu'on n'apprend jamais.
    themes: Object.keys(config?.themes ?? {}),
    demo,
    modele: modele ?? null,
    scannes: scannes ?? null,
    manquants: manquants || 0,
    cout: usage ? coutTexte(usage, config?.anthropic?.tarif) : null,
    edito: edito ?? null,
    sources: sources ?? [],
    sourcesFr,
    recos,
    articles,
    // Séparé du reste par `construire` : cf. l'en-tête de ce fichier.
    textesSource,
  };
}

export function aplatirRecos(resultats) {
  return resultats
    .map(({ element, fiche }) => ({
      id: element.id,
      organisme: element.organisme,
      sourceLabel: element.sourceLabel,
      lien: element.lien,
      date: element.date,
      titreOriginal: element.titre,
      ...fiche,
    }))
    .sort((a, b) => (b.interet ?? 0) - (a.interet ?? 0) || (b.date ?? '').localeCompare(a.date ?? ''));
}

export function aplatir(resultats) {
  return resultats
    .map(({ article, fiche }) => ({
      id: article.id,
      pmid: article.pmid,
      doi: article.doi,
      titre: article.titre,
      journal: article.journal,
      journalAbrege: article.journalAbrege,
      auteurs: article.auteurs,
      date: article.date,
      typeEtude: article.typeEtude,
      rangRevue: article.rangRevue ?? null,
      accesLibre: article.accesLibre,
      liens: article.liens,
      score: article.score,
      ...fiche,
    }))
    .sort((a, b) => (b.interet ?? 0) - (a.interet ?? 0) || (b.score ?? 0) - (a.score ?? 0));
}

export { existsSync };
