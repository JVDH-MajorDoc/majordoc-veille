#!/usr/bin/env node
// MajorDoc — comparer des réglages de rédaction côte à côte, sur une vraie journée.
//
//   node src/comparer-modeles.mjs
//   node src/comparer-modeles.mjs --jour 2026-10-12 --n 15
//   node src/comparer-modeles.mjs --reglages claude-sonnet-5-5:low,claude-sonnet-5-5:medium,claude-opus-5-5:medium
//   node src/comparer-modeles.mjs --rendre     (refait la page sans nouvel appel)
//
// La question « faut-il passer à Opus, ou monter l'effort ? » ne se tranche
// pas sur un tarif : il faut lire les fiches. Cet outil reprend les articles
// fichés une journée donnée, les fait rédiger par chaque réglage avec le prompt
// et le schéma de production, et produit `site/comparaison/index.html` : pour
// chaque article, les fiches côte à côte, sous des lettres (A, B, C) tirées au
// hasard. On lit, on choisit, puis on révèle — pour juger la fiche et non
// l'étiquette.
//
// Rien n'est publié sur le board ni marqué au registre. Coût : celui de N fiches
// par réglage, affiché à la fin (de l'ordre de 1 à 2 € pour trois réglages).

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ficherTous } from './summarize.mjs';
import { articlesParPmid } from './pubmed.mjs';
import { controler } from './verif.mjs';
import { themeOfficiel } from './vocabulaire.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** USD par million de tokens (entrée, sortie). */
const TARIFS = {
  'claude-sonnet-5-5': [2, 10],
  'claude-opus-5-5': [4, 20],
  'claude-haiku-5-5': [0.1, 0.5],
};
const NOMS = { 'claude-sonnet-5-5': 'Sonnet 5.5', 'claude-opus-5-5': 'Opus 5.5', 'claude-haiku-5-5': 'Haiku 5.5' };

function args() {
  const a = process.argv.slice(2);
  const v = (n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : null; };
  return {
    jour: v('--jour'),
    n: Number(v('--n')) || 15,
    reglages: (v('--reglages') ?? 'claude-sonnet-5-5:low,claude-sonnet-5-5:medium,claude-opus-5-5:medium')
      .split(',').map((r) => { const [modele, effort = 'medium'] = r.split(':'); return { modele, effort }; }),
    sortie: v('--out') ?? path.join(RACINE, 'site', 'comparaison'),
  };
}

async function chargerEnv() {
  const f = path.join(RACINE, '.env');
  if (!existsSync(f)) return;
  for (const ligne of (await readFile(f, 'utf8')).split('\n')) {
    const m = ligne.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const euros = (usd) => `${(usd * 0.86).toFixed(2).replace('.', ',')} €`;

function melanger(xs) {
  const t = [...xs];
  for (let i = t.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [t[i], t[j]] = [t[j], t[i]]; }
  return t;
}

function carteFiche(lettre, r) {
  if (r.erreur) return `<div class="fiche"><h4>${lettre}</h4><p class="ko">Échec : ${esc(r.erreur)}</p></div>`;
  const f = r.fiche;
  const champ = (titre, v) => (v ? `<dt>${titre}</dt><dd>${esc(v)}</dd>` : '');
  const absents = f.verif?.absents ?? [];
  return `<div class="fiche"><h4>${lettre}</h4>
<p class="accroche">${esc(f.accroche)}</p>
<dl>${champ('Méthode', f.methode)}${champ('Résultats', f.resultats)}${champ('Conclusion', f.conclusion)}${champ('Pour la pratique', f.pour_la_pratique)}${champ('Limites', f.limites)}</dl>
<p class="meta">Niveau de preuve : <b>${esc(f.niveau_preuve)}</b> · intérêt <b>${esc(f.interet)}/5</b> · ${esc(f.theme)}</p>
${absents.length ? `<p class="alerte">Chiffres absents de l'abstract : ${absents.map(esc).join(', ')}</p>` : ''}
</div>`;
}

function page({ jour, articles, reglages, lettres, bilan }) {
  const entete = reglages.map((r, i) => `<th>${lettres[i]}</th>`).join('');
  const lignesBilan = reglages.map((r, i) => `<tr><td class="lettre">${lettres[i]}</td>
<td class="revele">${esc(NOMS[r.modele] ?? r.modele)} · effort ${esc(r.effort)}</td>
<td>${bilan[i].entree.toLocaleString('fr-FR')} / ${bilan[i].sortie.toLocaleString('fr-FR')}</td>
<td>${euros(bilan[i].usd)}</td><td>${euros(bilan[i].usd * 30 / Math.max(1, articles.length) * 15)}</td>
<td>${bilan[i].signalees}/${bilan[i].fiches}</td><td>${bilan[i].secondes.toFixed(0)} s</td></tr>`).join('');

  const blocs = articles.map((a, k) => {
    // L'ordre des colonnes change d'un article à l'autre : la position ne trahit pas le réglage.
    const ordre = melanger(reglages.map((_, i) => i));
    return `<section class="article">
<h3>${k + 1}. ${esc(a.titre)}</h3>
<p class="source">${esc(a.journalAbrege || a.journal)} — ${esc(a.date ?? '')} · <a href="${esc(a.liens.pubmed)}" target="_blank" rel="noopener">PubMed</a></p>
<details><summary>Abstract d'origine</summary><p class="abstract">${esc(a.resume)}</p></details>
<div class="grille">${ordre.map((i) => carteFiche(lettres[i], a.resultats[i])).join('')}</div>
<fieldset class="vote" data-k="${k}"><legend>La meilleure fiche :</legend>
${ordre.map((i) => `<label><input type="radio" name="v${k}" value="${lettres[i]}"> ${lettres[i]}</label>`).join(' ')}
<label><input type="radio" name="v${k}" value="="> équivalentes</label></fieldset>
</section>`;
  }).join('\n');

  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Comparaison des réglages</title>
<style>
:root{--fond:#faf8f4;--texte:#1f2328;--doux:#5f6670;--carte:#fff;--trait:#e3ded5;--accent:#8a5a14;--ko:#a33a2a}
@media (prefers-color-scheme:dark){:root{--fond:#15171a;--texte:#e8e6e1;--doux:#a0a6ad;--carte:#1e2125;--trait:#33373c;--accent:#e0b261;--ko:#f08a78}}
*{box-sizing:border-box}body{margin:0;background:var(--fond);color:var(--texte);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1400px;margin:0 auto;padding:16px}h1{font-size:1.5rem;margin:.5rem 0}h3{font-size:1.1rem;margin:0 0 .25rem}
.intro{color:var(--doux);max-width:70ch}.source,.meta{color:var(--doux);font-size:.9rem}a{color:var(--accent)}
.article{border-top:1px solid var(--trait);padding:1.5rem 0}
.grille{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));margin-top:.75rem}
.fiche{background:var(--carte);border:1px solid var(--trait);border-radius:10px;padding:12px 14px}
.fiche h4{margin:0 0 .4rem;color:var(--accent);font-size:1.2rem}.accroche{font-weight:600;margin:.2rem 0 .6rem}
dl{margin:0}dt{font-size:.75rem;text-transform:uppercase;letter-spacing:.04em;color:var(--doux);margin-top:.5rem}dd{margin:0}
.alerte{color:var(--ko);font-size:.85rem}.ko{color:var(--ko)}.abstract{font-size:.9rem;color:var(--doux)}
details summary{cursor:pointer;color:var(--accent);font-size:.9rem}
.vote{border:none;padding:.6rem 0 0;margin:0}.vote legend{font-weight:600;padding:0}.vote label{margin-right:1rem;white-space:nowrap}
table{border-collapse:collapse;width:100%;font-size:.9rem;background:var(--carte)}td,th{border:1px solid var(--trait);padding:6px 8px;text-align:left}
.tableau{overflow-x:auto}.lettre{font-weight:700;color:var(--accent)}
body:not(.reveal) .revele{filter:blur(6px)}button{font:inherit;padding:.5rem 1rem;border-radius:8px;border:1px solid var(--accent);background:none;color:var(--accent);cursor:pointer}
#score{font-weight:600}
</style></head><body><main>
<h1>Quel réglage écrit les meilleures fiches ?</h1>
<p class="intro">Les ${articles.length} articles fichés le ${esc(jour)}, rédigés par ${reglages.length} réglages différents avec le même prompt et les mêmes consignes que la veille. Les lettres sont tirées au hasard et l'ordre des colonnes change à chaque article : lisez, choisissez la meilleure fiche, puis révélez.</p>
<p><button type="button" id="reveler">Révéler les réglages</button> <span id="score"></span></p>
<div class="tableau"><table><thead><tr><th></th><th>Réglage</th><th>Tokens entrée / sortie</th><th>Coût de l'essai</th><th>≈ par mois (15 fiches/j)</th><th>Fiches signalées</th><th>Durée</th></tr></thead>
<tbody>${lignesBilan}</tbody></table></div>
${blocs}
<p><button type="button" id="reveler2">Révéler les réglages</button></p>
</main>
<script>
(function(){
  var cle='md.comparaison.${esc(jour)}';
  var votes={};try{votes=JSON.parse(localStorage.getItem(cle)||'{}')}catch(e){}
  document.querySelectorAll('.vote').forEach(function(f){
    var k=f.dataset.k;if(votes[k]){var r=f.querySelector('input[value="'+votes[k]+'"]');if(r)r.checked=true}
    f.addEventListener('change',function(e){votes[k]=e.target.value;try{localStorage.setItem(cle,JSON.stringify(votes))}catch(x){}compter()});
  });
  function compter(){var n={};Object.keys(votes).forEach(function(k){n[votes[k]]=(n[votes[k]]||0)+1});
    document.getElementById('score').textContent=Object.keys(n).length?'Vos choix : '+Object.keys(n).sort().map(function(l){return (l==='='?'équivalentes':l)+' '+n[l]}).join(' · '):''}
  compter();
  function reveler(){document.body.classList.add('reveal')}
  document.getElementById('reveler').onclick=reveler;document.getElementById('reveler2').onclick=reveler;
})();
</script></body></html>`;
}

async function main() {
  await chargerEnv();
  const o = args();
  const brut = path.join(o.sortie, 'resultats.json');

  // --rendre : refaire la page depuis les résultats déjà payés, sans aucun appel.
  if (process.argv.includes('--rendre')) {
    const r = JSON.parse(await readFile(brut, 'utf8'));
    await writeFile(path.join(o.sortie, 'index.html'), page(r), 'utf8');
    console.log(`  Page refaite : ${path.join(o.sortie, 'index.html')}`);
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) { console.error('  ANTHROPIC_API_KEY absente (.env).'); process.exit(1); }
  const config = JSON.parse(await readFile(path.join(RACINE, 'config.json'), 'utf8'));
  const themes = Object.keys(config.themes ?? {});

  // La journée : la plus récente qui a des fiches, sauf demande contraire.
  const data = path.join(RACINE, 'site', 'data');
  const jour = o.jour ?? (JSON.parse(await readFile(path.join(data, 'index.json'), 'utf8')).jours ?? [])
    .filter((j) => j.nb > 0).map((j) => j.date).find((d) => existsSync(path.join(data, `${d}-sources.json`)));
  const journee = JSON.parse(await readFile(path.join(data, `${jour}.json`), 'utf8'));
  const pmids = (journee.articles ?? []).map((a) => a.pmid).filter(Boolean).slice(0, o.n);
  if (!pmids.length) { console.error(`  Aucune fiche d'article le ${jour}.`); process.exit(1); }

  // Les articles tels que la récolte les voit (titre, abstract, types MEDLINE…),
  // relus sur PubMed : le prompt est ainsi identique à celui de production.
  console.log(`\n  Comparaison sur les fiches du ${jour} — ${pmids.length} articles`);
  const articles = await articlesParPmid(pmids);
  console.log(`  ${articles.length} articles relus sur PubMed\n`);

  const lettres = melanger(['A', 'B', 'C', 'D', 'E', 'F'].slice(0, o.reglages.length));
  const bilan = [];
  for (const [i, r] of o.reglages.entries()) {
    const t0 = Date.now();
    process.stdout.write(`  ${NOMS[r.modele] ?? r.modele} · effort ${r.effort} … `);
    const res = await ficherTous(articles, {
      modele: r.modele, effort: r.effort, themes, concurrence: config.anthropic?.concurrence ?? 4,
      maxTokens: Math.max(config.anthropic?.max_tokens ?? 0, 16000), repli: config.anthropic?.repli_refus,
    });
    const ok = res.filter((x) => !x.erreur);
    for (const x of ok) x.fiche.theme = themeOfficiel(x.fiche.theme, themes, 'Autre');
    const { signalees } = controler(ok);
    const entree = ok.reduce((s, x) => s + (x.usage?.input_tokens ?? 0), 0);
    const sortie = ok.reduce((s, x) => s + (x.usage?.output_tokens ?? 0), 0);
    const [pe, ps] = TARIFS[r.modele] ?? [0, 0];
    const usd = (entree * pe + sortie * ps) / 1e6;
    bilan.push({ entree, sortie, usd, signalees, fiches: ok.length, secondes: (Date.now() - t0) / 1000 });
    res.forEach((x) => { const a = articles.find((y) => y.id === x.article.id); (a.resultats ??= [])[i] = x; });
    console.log(`${ok.length}/${articles.length} fiches · ${entree} + ${sortie} tokens · ${euros(usd)} · ${signalees} signalée(s)`);
  }

  await mkdir(o.sortie, { recursive: true });
  const resultats = { jour, articles, reglages: o.reglages, lettres, bilan };
  await writeFile(brut, JSON.stringify(resultats), 'utf8');
  const fichier = path.join(o.sortie, 'index.html');
  await writeFile(fichier, page(resultats), 'utf8');
  console.log(`\n  Coût total : ${euros(bilan.reduce((s, b) => s + b.usd, 0))}`);
  console.log(`  Page : ${fichier}  (sur le site : /comparaison/)\n`);
}

main().catch((e) => { console.error(`\n  Erreur : ${e.message}\n`); process.exitCode = 1; });
