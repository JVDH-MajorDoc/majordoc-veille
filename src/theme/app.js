/* MajorDoc — interface du board.
   Sans dépendance, sans framework. Charge data/index.json puis le digest du jour.
   Fonctionne aussi avec les données inlinées (window.MAJORDOC_INLINE). */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var NIVEAUX = ['Très faible', 'Faible', 'Modéré', 'Élevé'];
  // « preuve » est féminin : on accorde à l'affichage.
  var NIVEAU_FEM = { 'Élevé': 'élevée', 'Modéré': 'modérée', 'Faible': 'faible', 'Très faible': 'très faible' };

  var ICONES = {
    auto: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 2a6 6 0 0 0 0 12z" fill="currentColor"/></svg>',
    clair: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="3.2" fill="currentColor"/><g stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M3.1 3.1l1.1 1.1M11.8 11.8l1.1 1.1M12.9 3.1l-1.1 1.1M4.2 11.8l-1.1 1.1"/></g></svg>',
    sombre: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M13.2 10.1A5.6 5.6 0 0 1 6 2.8a5.8 5.8 0 1 0 7.2 7.3z" fill="currentColor"/></svg>',
    marque: '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4 2h8v12l-4-3.2L4 14z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
    marqueOn: '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4 2h8v12l-4-3.2L4 14z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
    coche: '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 4.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    cercle: '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><circle cx="8" cy="8" r="5.4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
    chevron: '<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    haut: '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M8.5 2.5L5 5.5H2.5v5H5l3.5 3z" fill="currentColor"/><path d="M11.2 5.6a3.6 3.6 0 0 1 0 4.8M13 3.6a6.2 6.2 0 0 1 0 8.8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
    partager: '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M8 10V2M5 4.8L8 1.8l3 3M4.5 7H3.5v7h9V7h-1" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    stop: '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><rect x="3.5" y="3.5" width="9" height="9" rx="1.4" fill="currentColor"/></svg>',
    cadenasOuvert: '<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'
  };
  var MOIS = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
  var JOURS = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];

  /* ---------- stockage tolérant (navigation privée, file://) ---------- */
  var repli = {};
  var LS = {
    lire: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return k in repli ? repli[k] : d; } },
    ecrire: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { repli[k] = v; } }
  };

  var lus = new Set(LS.lire('md.lus', []));

  // Les gardés sont mémorisés avec leur contenu, pas seulement leur identifiant :
  // une journée finit par sortir du sélecteur, et un article mis de côté doit rester
  // lisible des mois plus tard sans dépendre du fichier d'archive.
  var gardes = (function () {
    var v = LS.lire('md.gardes', {});
    if (Array.isArray(v)) {           // ancien format : liste d'identifiants
      var m = {};
      v.forEach(function (id) { m[id] = { id: id, _partiel: true }; });
      return m;
    }
    return v || {};
  })();
  /**
   * Affinités par thème : 1 = suivi de près, -1 = en retrait, absent = normal.
   * La sélection du matin est commune au cabinet ; ces réglages ne changent que
   * l'ordre de lecture de CE navigateur. Un thème en retrait descend en fin de
   * page, estompé — jamais supprimé : la transparence sur ce qui est paru fait
   * partie du contrat de l'outil.
   */
  var affinites = LS.lire('md.affinites', {});
  function aff(t) { return affinites[t] || 0; }

  var minuteurAvis = null;
  /** Confirmation discrète : sans elle, mettre de côté ne se voit pas. */
  function signaler(message, avecLien) {
    var el = $('#avis-action');
    el.innerHTML = '<span>' + esc(message) + '</span>' +
      (avecLien ? '<button type="button" id="avis-voir">Voir les fiches mises de côté</button>' : '');
    el.hidden = false;
    clearTimeout(minuteurAvis);
    minuteurAvis = setTimeout(function () { el.hidden = true; }, 5000);
  }

  function estGarde(id) { return Object.prototype.hasOwnProperty.call(gardes, id); }
  function nbGardes() { return Object.keys(gardes).length; }
  function basculerGarde(id, objet, type) {
    if (estGarde(id)) delete gardes[id];
    else gardes[id] = Object.assign({}, objet, { _type: type, _jour: etat.jour.date });
    LS.ecrire('md.gardes', gardes);
  }

  var etat = {
    index: null, jour: null, jours: [], themes: new Set(), majeurs: false, nonLus: false,
    q: '', tout: false, curseur: -1,
    vue: 'jour',            // 'jour' | 'gardes' | 'archives'
    filtresOuverts: false,  // mobile seulement : cf. le bouton « Filtrer »
    archives: null,         // résultats de la recherche dans les archives
    chargement: false
  };

  /* ---------- utilitaires ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  /** Les liens des fiches viennent de flux externes : on ne rend que http(s). */
  function lienSur(u) { return /^https?:\/\//i.test(String(u || '')) ? u : null; }
  function surligne(t, q) {
    if (!q) return esc(t);
    return esc(t).replace(new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig'), '<mark>$1</mark>');
  }
  function dateLongue(iso) {
    var p = String(iso || '').split('-'); if (p.length < 3) return iso || '';
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    return JOURS[d.getUTCDay()] + ' ' + +p[2] + ' ' + MOIS[+p[1] - 1] + ' ' + p[0];
  }
  function dateCourte(iso) {
    var p = String(iso || '').split('-'); if (p.length < 3) return iso || '';
    return +p[2] + ' ' + MOIS[+p[1] - 1] + ' ' + p[0];
  }
  /** La date du jour sur l'horloge de la lectrice, au format des journées (AAAA-MM-JJ). */
  function isoLocal(d) {
    return d.getFullYear() + '-' + deuxChiffres(d.getMonth() + 1) + '-' + deuxChiffres(d.getDate());
  }
  function deuxChiffres(n) { return n < 10 ? '0' + n : String(n); }

  /* ---------- thème clair / sombre ---------- */
  var prefTheme = LS.lire('md.theme', 'auto');
  function appliquerTheme(p) {
    document.documentElement.dataset.theme =
      p === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : p;
    $('#theme').innerHTML = p === 'light' ? ICONES.clair : p === 'dark' ? ICONES.sombre : ICONES.auto;
    $('#theme').title = 'Thème : ' + (p === 'auto' ? 'automatique' : p === 'light' ? 'clair' : 'sombre');
    [].forEach.call(document.querySelectorAll('#prefs-theme button'), function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.themePref === p));
    });
    LS.ecrire('md.theme', p);
  }
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
    if (LS.lire('md.theme', 'auto') === 'auto') appliquerTheme('auto');
  });
  $('#theme').addEventListener('click', function () {
    prefTheme = prefTheme === 'auto' ? 'light' : prefTheme === 'light' ? 'dark' : 'auto';
    appliquerTheme(prefTheme);
  });
  // Sur iPhone, le bouton du bandeau cède sa place : le thème se règle ici.
  $('#prefs-theme').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-theme-pref]');
    if (!b) return;
    prefTheme = b.dataset.themePref;
    appliquerTheme(prefTheme);
  });

  /**
   * Un thème rendu par le modèle avec un échappement littéral — « Diab\u00e8te »
   * au lieu de « Diabète » — s'affichait tel quel et créait une rubrique fantôme
   * dans les filtres comme dans « Mes thèmes ». La génération est corrigée, mais
   * les journées déjà publiées portent encore le défaut : on répare à la lecture
   * plutôt que de régénérer des archives.
   */
  function reparerThemes(j) {
    if (!j) return j;
    var officiels = j.themes || [];
    var cle = function (t) { return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); };
    var corriger = function (x) {
      if (!x || !x.theme) return;
      var t = String(x.theme).replace(/\\u([0-9a-fA-F]{4})/g, function (_, h) { return String.fromCharCode(parseInt(h, 16)); });
      var officiel = officiels.filter(function (o) { return cle(o) === cle(t); })[0];
      x.theme = officiel || t;
    };
    (j.articles || []).forEach(corriger);
    (j.recos || []).forEach(corriger);
    return j;
  }

  /* ---------- chargement ---------- */
  async function json(url) {
    var r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(url + ' → HTTP ' + r.status);
    return r.json();
  }

  async function demarrer() {
    appliquerTheme(prefTheme);
    if (window.MAJORDOC_INLINE) {
      etat.index = { jours: [{ date: window.MAJORDOC_INLINE.date, nb: (window.MAJORDOC_INLINE.articles || []).length }] };
      etat.jour = reparerThemes(window.MAJORDOC_INLINE);
      etat.jours = [etat.jour];
      return rendre();
    }
    try {
      etat.index = await json('data/index.json');
      if (!etat.index.jours || !etat.index.jours.length) throw new Error('index vide');
      etat.jour = reparerThemes(await json('data/' + etat.index.jours[0].date + '.json'));
      etat.jours = [etat.jour];
      rendre();
    } catch (e) {
      panneEnPlace(e);
    }
  }

  function panneEnPlace(e) {
    $('#une').innerHTML =
      '<p class="date">Veille indisponible</p>' +
      '<h1 id="une-titre">Aucun digest à afficher</h1>' +
      '<p style="max-width:60ch;color:var(--ink-2);margin-top:20px">' +
      "Le fichier <code>data/index.json</code> n'a pas pu être lu. Lancez <code>npm run digest</code> " +
      'pour produire la veille du jour, puis rechargez cette page.</p>' +
      '<p style="color:var(--ink-3);font-size:12.5px;margin-top:14px">Détail : ' + esc(e.message) + '</p>';
    $('#rail').innerHTML = '';
    $('#compte').textContent = '';
  }

  async function changerDeJour(date) {
    var deja = etat.jours.filter(function (j) { return j.date === date; })[0];
    etat.jour = deja || reparerThemes(await json('data/' + date + '.json'));
    if (!deja) etat.jours.push(etat.jour);
    etat.curseur = -1;
    rendre();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------- filtrage ---------- */
  function articles() { return (etat.jour && etat.jour.articles) || []; }
  function filtres() {
    var q = etat.q.trim().toLowerCase();
    return articles().filter(function (a) {
      if (etat.themes.size && !etat.themes.has(a.theme)) return false;
      if (etat.majeurs && (a.interet || 0) < 4) return false;
      if (etat.nonLus && lus.has(a.id)) return false;
      if (q) {
        var h = [a.titre_fr, a.titre, a.accroche, a.resultats, a.pour_la_pratique, a.journal, (a.mots_cles || []).join(' ')].join(' ').toLowerCase();
        if (h.indexOf(q) === -1) return false;
      }
      return true;
    }).sort(function (a, b) { return aff(b.theme) - aff(a.theme); });
  }

  /* ---------- rendu ---------- */
  function rendreUne() {
    var j = etat.jour, e = j.edito || {};
    $('#specialite').textContent = j.specialite || '';

    $('#peremption').innerHTML = bandeauFraicheur(j);
    $('#avis').innerHTML = j.demo
      ? '<div class="avis"><b>Démonstration.</b> Les fiches ci-dessous sont des exemples fictifs, destinés à montrer le rendu — aucune référence réelle. Lancez <code>npm run digest</code> avec votre clé API pour la veille du jour.</div>'
      : '';

    var arts = articles();
    var tout = arts.concat(recos());
    var majeurs = arts.filter(function (a) { return (a.interet || 0) >= 4; }).length;
    var nbLus = tout.filter(function (a) { return lus.has(a.id); }).length;
    var minutes = Math.max(1, Math.round(arts.length * 1.2 + recos().length * 1.5));

    $('#une').innerHTML =
      '<p class="date">L\'essentiel du ' + esc(dateLongue(j.date)) + '</p>' +
      '<h1 id="une-titre" class="anim">' + esc(e.titre || 'Veille du jour') + '</h1>' +
      '<ul class="chapo anim" style="animation-delay:.06s">' +
        (e.points || []).map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') +
      '</ul>' +
      // L'encadré et les compteurs vont dans une colonne à part : sur un écran
      // large, elle se range à droite de l'édito au lieu de pousser les
      // premières fiches sous la ligne de flottaison.
      '<div class="une-cote">' +
      (e.a_lire_en_priorite
        ? '<p class="priorite anim" style="animation-delay:.12s">À lire en priorité — <b>' + esc(e.a_lire_en_priorite) + '</b></p>'
        : '') +
      '<div class="jauges anim" style="animation-delay:.16s">' +
        (recos().length ? jauge(recos().length, recos().length > 1 ? 'recommandations' : 'recommandation', 'jauge-ochre') : '') +
        jauge(arts.length, arts.length > 1 ? 'articles retenus' : 'article retenu') +
        jauge(majeurs, 'à fort intérêt') +
        jauge(nbLus + ' / ' + tout.length, 'lus', 'lu') +
        jauge('~' + minutes + ' min', 'de lecture') +
        (j.scannes ? jauge(j.scannes, 'articles parcourus') : '') +
      '</div></div>';
  }
  /**
   * Une panne du timer ne se voit pas : le board affiche simplement une vieille
   * journée. Trois lectrices en concluraient « ça ne marche plus ».
   */
  function bandeauFraicheur(j) {
    var jours = (etat.index && etat.index.jours) || [];
    if (!jours.length || j.date !== jours[0].date) return '';   // on consulte une archive
    if (!j.genereLe) return '';
    var heures = (Date.now() - new Date(j.genereLe).getTime()) / 3600000;
    var seuil = j.alerteHeures || 48;
    if (!(heures > seuil)) return '';
    var n = Math.floor(heures / 24);
    return '<div class="peremption"><b>Cette veille date de ' +
      (n >= 1 ? n + (n > 1 ? ' jours' : ' jour') : Math.round(heures) + ' heures') + '.</b> ' +
      'La génération automatique n\'a pas tourné depuis. Les articles parus depuis ne sont pas ici.</div>';
  }

  function jauge(v, l, cls) {
    return '<div class="jauge ' + (cls || '') + '"><div class="v">' + esc(v) + '</div><div class="l eyebrow">' + esc(l) + '</div></div>';
  }

  /** Un filtre laissé actif ne doit pas disparaître avec le panneau replié. */
  function filtresActifs() {
    return etat.themes.size + (etat.majeurs ? 1 : 0) + (etat.nonLus ? 1 : 0);
  }

  /** La liste des titres du jour. Une seule écriture pour la colonne de bureau
      et pour le panneau mobile : deux rendus finiraient par diverger. */
  function sommaireHTML(vus) {
    return '<ol class="sommaire">' + vus.map(function (a, i) {
      return '<li' + (lus.has(a.id) ? ' class="est-lu"' : '') + ((a.interet || 0) >= 4 ? ' data-majeur="true"' : '') + '>' +
        '<a href="#art-' + i + '" data-i="' + i + '">' +
          '<span class="n">' + deuxChiffres(i + 1) + '</span>' +
          '<span><span class="th">' + esc(a.theme) +
            ((a.interet || 0) >= 4 ? '<span class="fort-point" title="Fort intérêt" aria-label="Fort intérêt">\u25cf</span>' : '') +
          '</span>' +
          '<span class="ti">' + esc(a.titre_fr || a.titre) + '</span></span>' +
        '</a></li>';
    }).join('') + '</ol>';
  }

  function rendreRail() {
    var arts = articles(), vus = filtres();
    var parTheme = {};
    arts.concat(recos()).forEach(function (a) { parTheme[a.theme] = (parTheme[a.theme] || 0) + 1; });
    var noms = Object.keys(parTheme).sort(function (a, b) { return parTheme[b] - parTheme[a] || a.localeCompare(b); });
    var majeurs = arts.filter(function (a) { return (a.interet || 0) >= 4; }).length;
    var restants = arts.filter(function (a) { return !lus.has(a.id); }).length;

    var nbRecos = recosFiltrees().length;
    var nJours = ((etat.index && etat.index.jours) || []).length;
    $('#rail').innerHTML =
      '<nav class="vues">' +
        vueBouton('jour', "Veille du jour", (articles().length + recos().length)) +
        vueBouton('gardes', 'Mis de côté', nbGardes()) +
        (etat.archives ? vueBouton('archives', 'Archives', etat.archives.length) : '') +
      '</nav>' +
      (etat.vue !== 'jour' ? '' :
      '<div class="bloc-sommaire">' +
      (nbRecos
        ? '<h2>Recommandations</h2><ol class="sommaire raccourci"><li><a href="#recos-titre">' +
          '<span class="n">★</span><span><span class="th">France</span><span class="ti">' +
          nbRecos + (nbRecos > 1 ? ' publications officielles' : ' publication officielle') + '</span></span></a></li></ol>'
        : '') +
      '<h2>Sommaire</h2>' +
      '<p class="note">Classés par intérêt clinique décroissant.</p>' +
      sommaireHTML(vus) + '</div>' +
      '') +
      (etat.vue !== 'jour' ? '' :
      '<div class="filtres" data-ouvert="' + (etat.filtresOuverts ? 'true' : 'false') + '">' +
        '<h2>Filtrer</h2>' +
        // Sur mobile uniquement (le CSS s'en charge) : le panneau se replie.
        '<button class="filtres-bascule" type="button" aria-expanded="' + (etat.filtresOuverts ? 'true' : 'false') + '">' +
          '<span>Filtrer</span>' +
          (filtresActifs() ? '<span class="n">' + filtresActifs() + '</span>' : '') +
        '</button>' +
        '<div class="filtres-liste">' +
        noms.map(function (t) {
          return bouton('theme', t, t, parTheme[t], etat.themes.has(t));
        }).join('') +
        bouton('flag', 'majeurs', 'Fort intérêt', majeurs, etat.majeurs) +
        bouton('flag', 'nonLus', 'Non lus', restants, etat.nonLus) +
      '</div></div>') +
      (nJours > 1 ? '<p class="note archives-note">' + nJours + ' journées archivées, toutes consultables par le sélecteur de date.</p>' : '');
  }
  function vueBouton(vue, libelle, n) {
    return '<button class="vue" data-vue="' + vue + '" aria-pressed="' + (etat.vue === vue) + '">' +
      esc(libelle) + '<span class="n">' + n + '</span></button>';
  }
  function bouton(type, val, libelle, n, actif) {
    return '<button class="filtre" data-' + type + '="' + esc(val) + '" aria-pressed="' + !!actif + '">' +
      '<span class="case" aria-hidden="true"></span><span>' + esc(libelle) + '</span>' +
      '<span class="n">' + n + '</span></button>';
  }

  function echelle(niveau) {
    var n = NIVEAUX.indexOf(niveau) + 1;
    var b = '';
    for (var i = 1; i <= 4; i++) b += '<i class="' + (i <= n ? 'on' : '') + '"></i>';
    return '<span class="echelle" role="img" aria-label="Niveau de preuve : ' + esc(niveau || 'non déterminé') + '">' + b + '</span>';
  }


  /* ---------- résumé d'origine ----------
     La fiche annonce que ses chiffres ont été comparés au résumé source. Tant que
     ce résumé n'est pas consultable, la lectrice doit croire l'outil sur parole.
     Le dépliant le lui montre — c'est la garantie rendue vérifiable.

     Le fichier voyage à part (data/AAAA-MM-JJ-sources.json) et n'est chargé qu'à
     la première ouverture : la recherche dans les archives, qui télécharge toutes
     les journées, n'en paie donc jamais le poids. */
  var cacheSources = {};
  /** La journée affichée porte-t-elle ses résumés d'origine ? Les journées
      publiées avant cette version n'en ont pas : le dépliant ne s'affiche alors
      pas du tout, plutôt que de s'ouvrir sur une déception. */
  function jourAvecSources(j) {
    return j && (j.aSources || j.textesSource) ? j.date : null;
  }
  function sourcesDuJour(date) {
    if (etat.jour && etat.jour.date === date && etat.jour.textesSource) {
      return Promise.resolve(etat.jour.textesSource);   // board autonome, tout est déjà là
    }
    if (!cacheSources[date]) {
      cacheSources[date] = fetch('data/' + date + '-sources.json', { cache: 'no-cache' })
        .then(function (r) { return r.ok ? r.json() : {}; })
        .catch(function () { return {}; });
    }
    return cacheSources[date];
  }

  /** Le dépliant n'est rendu que pour une journée dont on sait qu'elle a ses sources. */
  function resumeOrigine(x, jourSources) {
    if (!jourSources) return '';
    return '<details class="source-vo" data-src-jour="' + esc(jourSources) + '" data-src-id="' + esc(x.id) + '">' +
      '<summary>Résumé d\'origine</summary>' +
      '<div class="source-vo-corps" data-etat="vide">Chargement…</div>' +
      '</details>';
  }

  // `toggle` ne remonte pas : on écoute en phase de capture.
  document.addEventListener('toggle', function (e) {
    var d = e.target;
    if (!d || !d.classList || !d.classList.contains('source-vo') || !d.open) return;
    var corps = $('.source-vo-corps', d);
    if (!corps || corps.dataset.etat !== 'vide') return;
    corps.dataset.etat = 'charge';
    sourcesDuJour(d.dataset.srcJour).then(function (m) {
      var t = m && m[d.dataset.srcId];
      corps.textContent = t || "Le résumé d'origine n'a pas été conservé pour cette journée.";
      if (!t) corps.classList.add('absent');
    });
  }, true);

  /* ---------- lecture vocale ----------
     Deux chemins, dans cet ordre :

     1. Un fichier audio pré-généré, quand la journée en a un. C'est le seul
        moyen d'avoir une voix naturelle sur iPhone — voir le point 2.
     2. À défaut, `speechSynthesis` : natif, sans dépendance ni coût, mais
        Safari n'expose PAS à la Web Speech API les voix « Améliorée » et
        « Premium » qu'Apple laisse pourtant télécharger dans les Réglages.
        Sur iPhone il ne reste donc que les voix compactes. Le sélecteur de
        voix des réglages sert surtout sur ordinateur, où Chrome et Firefox
        exposent, eux, des voix nettement meilleures.

     Le résumé d'origine, les auteurs et les mots-clés sont exclus de la
     lecture : le premier est en anglais, les deux autres sont des listes qu'on
     parcourt des yeux et qu'on n'écoute pas. */
  var PARLE = typeof window.speechSynthesis !== 'undefined' && typeof window.SpeechSynthesisUtterance !== 'undefined';
  var AUDIO = typeof window.Audio !== 'undefined';
  var VITESSES = [['0.9', 'Posée'], ['1', 'Normale'], ['1.15', 'Alerte'], ['1.3', 'Rapide']];
  var reglagesVoix = LS.lire('md.voix', { voix: '', vitesse: 1 });
  var diction = { id: null, audio: null };

  /** Les intitulés de rubrique servent de respiration : « Méthode. » puis le texte. */
  function texteDe(article) {
    var morceaux = [];
    var pousser = function (el) {
      if (!el) return;
      var t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (t) morceaux.push(/[.!?…]$/.test(t) ? t : t + '.');
    };
    pousser($('.titre', article) || $('h3', article));
    pousser($('.accroche', article));
    var blocs = article.querySelectorAll('.fiche .bloc, .fiche .changement, .fiche .points li');
    for (var i = 0; i < blocs.length; i++) {
      if (blocs[i].closest('.source-vo')) continue;
      var dt = $('.eyebrow', blocs[i]);
      var titre = dt ? (dt.textContent || '').trim().toLowerCase() : '';
      if (titre === 'auteurs' || titre === 'mots-clés') continue;   // des listes, pas de la prose
      pousser(dt);
      pousser($('dd', blocs[i]) || (dt ? null : blocs[i]));
    }
    return morceaux.join(' ');
  }

  function phrases(texte) {
    // Découpage sans lookbehind : Safari ne l'a qu'à partir de la 16.4, et la
    // veille se lit sur des iPhone qui n'y sont pas tous.
    var brut = texte.match(/[^.!?…]+[.!?…]*\s*/g) || [texte];
    var out = [], courant = '';
    for (var i = 0; i < brut.length; i++) {
      if ((courant + ' ' + brut[i]).length > 220 && courant) { out.push(courant.trim()); courant = brut[i]; }
      else courant = courant ? courant + ' ' + brut[i] : brut[i];
    }
    if (courant.trim()) out.push(courant.trim());
    return out;
  }

  function voixFr() {
    if (!PARLE) return [];
    var v = window.speechSynthesis.getVoices() || [];
    return [].slice.call(v).filter(function (x) { return /^fr(-|_|$)/i.test(x.lang || ''); });
  }
  function voixChoisie() {
    var v = voixFr();
    if (!v.length) return null;
    for (var i = 0; i < v.length; i++) {
      if (v[i].voiceURI === reglagesVoix.voix || v[i].name === reglagesVoix.voix) return v[i];
    }
    // Sans choix explicite : ce que le navigateur expose de mieux. Sur iPhone il
    // n'y a rien à préférer, sur ordinateur ces mots font une vraie différence.
    var mieux = v.filter(function (x) { return /(enhanced|premium|amélior|google|siri|neural)/i.test(x.name || ''); });
    return mieux[0] || v[0];
  }

  function marquerBouton(actif) {
    var b = document.querySelectorAll('[data-act="ecouter"]');
    for (var i = 0; i < b.length; i++) {
      var sien = actif && b[i].closest('.entree, .reco') &&
        b[i].closest('.entree, .reco').dataset.id === diction.id;
      b[i].setAttribute('aria-pressed', sien ? 'true' : 'false');
      b[i].innerHTML = sien ? ICONES.stop + ' Arrêter' : ICONES.haut + ' Écouter';
    }
  }

  function arreterLecture() {
    if (diction.audio) { try { diction.audio.pause(); } catch (e) {} diction.audio = null; }
    if (PARLE) { try { window.speechSynthesis.cancel(); } catch (e) {} }
    diction.id = null;
    marquerBouton(false);
  }

  /**
   * Enchaînement un par un, et non mise en file.
   *
   * iOS ne joue que le PREMIER énoncé d'une file : la fiche s'arrêtait après son
   * titre. Chaque morceau est donc lancé par la fin du précédent. Et le premier
   * part dans le geste utilisateur, sans setTimeout : hors du geste, iOS refuse
   * de démarrer.
   */
  function lireSynthese(article, id) {
    if (!PARLE) return arreterLecture();
    var bouts = phrases(texteDe(article));
    if (!bouts.length) return arreterLecture();
    var voix = voixChoisie(), k = 0;
    function suivant() {
      if (diction.id !== id) return;
      if (k >= bouts.length) return arreterLecture();
      var u = new window.SpeechSynthesisUtterance(bouts[k++]);
      u.lang = 'fr-FR';
      if (voix) u.voice = voix;
      u.rate = +reglagesVoix.vitesse || 1;
      u.onend = suivant;
      u.onerror = function () { if (diction.id === id) arreterLecture(); };
      try { window.speechSynthesis.speak(u); } catch (e) { arreterLecture(); }
    }
    suivant();
  }

  /** Le fichier pré-généré. S'il manque (journée ancienne, serveur sans audio), on retombe sur la synthèse. */
  function lireFichier(src, article, id) {
    var a = new window.Audio(src);
    a.preload = 'auto';
    try { a.playbackRate = +reglagesVoix.vitesse || 1; } catch (e) {}
    a.onended = function () { if (diction.id === id) arreterLecture(); };
    a.onerror = function () {
      if (diction.id !== id) return;
      diction.audio = null;
      lireSynthese(article, id);
    };
    diction.audio = a;
    var p = a.play();
    if (p && p.catch) p.catch(function () {
      if (diction.id !== id) return;
      diction.audio = null;
      lireSynthese(article, id);
    });
  }

  function lire(article) {
    var id = article.dataset.id;
    var memeFiche = diction.id === id;
    arreterLecture();
    if (memeFiche) return;                     // deuxième clic : on arrête, c'est tout
    if (!PARLE && !AUDIO) return;
    diction.id = id;
    marquerBouton(true);
    var src = article.getAttribute('data-audio');
    if (src && AUDIO) lireFichier(src, article, id);
    else lireSynthese(article, id);
  }

  /** Le chemin du fichier pré-généré, quand la journée en a un. Absent : la synthèse prendra le relais. */
  function attributAudio(x) {
    return x && x.audio ? ' data-audio="' + esc(x.audio) + '"' : '';
  }

  function boutonEcouter() {
    return (PARLE || AUDIO)
      ? '<button type="button" data-act="ecouter" aria-pressed="false">' + ICONES.haut + ' Écouter</button>'
      : '';
  }

  /* ---------- partager une fiche ----------
     Sur iPhone, la feuille de partage d'iOS (Messages, WhatsApp, Mail…) :
     c'est ainsi qu'une fiche passe d'une consœur à l'autre. Ailleurs, le texte
     est copié. Le message dit d'où il vient : une fiche rédigée
     automatiquement ne doit pas circuler comme une lecture faite par quelqu'un. */
  var PARTAGE = !!(navigator.share || (navigator.clipboard && navigator.clipboard.writeText));
  function boutonPartager() {
    return PARTAGE ? '<button type="button" data-act="partager">' + ICONES.partager + ' <span>Partager</span></button>' : '';
  }
  function textePartage(x, estReco) {
    var lien = estReco ? lienSur(x.lien)
      : lienSur(x.liens && x.liens.doi) || lienSur(x.liens && x.liens.pubmed) || lienSur(x.liens && x.liens.europepmc);
    var source = estReco ? (x.organisme || '') : (x.journal || x.journalAbrege || '');
    return {
      title: (estReco ? x.titre_court || x.titreOriginal : x.titre_fr || x.titre) || 'Fiche MajorDoc',
      text: [
        (estReco ? x.titre_court || x.titreOriginal : x.titre_fr || x.titre) + (source ? ' (' + source + ')' : ''),
        x.accroche || '',
        estReco && x.ce_qui_change ? 'Ce qui change : ' + x.ce_qui_change : '',
        '— Fiche MajorDoc, rédigée automatiquement à partir du résumé publié.'
      ].filter(Boolean).join('\n\n'),
      url: lien || undefined
    };
  }
  function partager(bloc) {
    var id = bloc.dataset.id, estReco = bloc.classList.contains('reco');
    var x = (estReco ? recos() : articles()).concat(objetsGardes()).filter(function (y) { return y.id === id; })[0];
    if (!x) return;
    var d = textePartage(x, estReco);
    if (navigator.share) {
      navigator.share(d).catch(function () { /* partage annulé : rien à dire */ });
      return;
    }
    navigator.clipboard.writeText(d.text + (d.url ? '\n' + d.url : '')).then(
      function () { signaler('Fiche copiée — prête à coller dans un message'); },
      function () { signaler('Copie impossible dans ce navigateur'); }
    );
  }

  window.addEventListener('beforeunload', arreterLecture);
  window.addEventListener('pagehide', arreterLecture);

  function entree(a, i, jourSources) {
    var q = etat.q.trim();
    var liens = [];
    var lp = lienSur(a.liens && a.liens.pubmed), ld = lienSur(a.liens && a.liens.doi), le = lienSur(a.liens && a.liens.europepmc);
    if (lp) liens.push('<a class="lien" href="' + esc(lp) + '" target="_blank" rel="noopener">PubMed ↗</a>');
    if (ld) liens.push('<a class="lien" href="' + esc(ld) + '" target="_blank" rel="noopener">Texte intégral ↗</a>');
    if (le) liens.push('<a class="lien" href="' + esc(le) + '" target="_blank" rel="noopener">Europe PMC ↗</a>');

    return '<article class="entree' + (lus.has(a.id) ? ' est-lu' : '') + (estGarde(a.id) ? ' est-garde' : '') + ((a.interet || 0) >= 4 ? ' majeur' : '') + (aff(a.theme) < 0 ? ' en-retrait' : '') + '"' +
        ' id="art-' + i + '" data-id="' + esc(a.id) + '" data-i="' + i + '"' + attributAudio(a) + ' data-ouvert="' + (etat.tout ? 'true' : 'false') + '">' +
      '<div class="tete">' +
        '<span class="n">' + deuxChiffres(i + 1) + '</span>' +
        (estGarde(a.id) ? '<span class="marque-garde" title="Mise de côté">' + ICONES.marqueOn + '</span>' : '') +
        (aff(a.theme) > 0 ? '<span class="pref-etoile" title="Thème suivi de près" aria-hidden="true">★</span>' : '') +
        '<span class="theme">' + esc(a.theme) + '</span>' +
        '<span class="sep"></span>' +
        '<span class="genre">' + esc(a.typeEtude || 'Article') + '</span>' +
        ((a.interet || 0) >= 4 ? '<span class="fort">Fort intérêt</span>' : '') +
        '<span class="cle">' + echelle(a.niveau_preuve) +
          '<span>Preuve ' + esc(NIVEAU_FEM[a.niveau_preuve] || 'non déterminée') + '</span></span>' +
      '</div>' +
      alerteChiffres(a) +
      '<h3 class="titre"><button type="button" data-role="basculer">' + surligne(a.titre_fr || a.titre, q) + '</button></h3>' +
      '<p class="vo">' + esc(a.titre) + '</p>' +
      '<p class="accroche">' + surligne(a.accroche || '', q) + '</p>' +
      '<p class="source">' +
        '<span class="revue">' + esc(a.journal || a.journalAbrege || '') + '</span>' +
        rangBadge(a.rangRevue) +
        (a.date ? '<span>· ' + esc(dateCourte(a.date)) + '</span>' : '') +
        (a.accesLibre ? '<span class="libre">' + ICONES.cadenasOuvert + ' Accès libre</span>' : '') +
      '</p>' +
      '<div class="actions">' +
        '<button class="deplier" type="button" data-role="basculer"><span class="fleche">' + ICONES.chevron + '</span><span>Fiche de lecture</span></button>' +
        liens.join('') +
        '<span class="droite">' +
          boutonEcouter() + boutonPartager() +
          '<button type="button" data-act="garde" aria-pressed="' + estGarde(a.id) + '">' +
            (estGarde(a.id) ? ICONES.marqueOn + ' Gardé' : ICONES.marque + ' Garder') + '</button>' +
          '<button type="button" data-act="lu" aria-pressed="' + lus.has(a.id) + '">' +
            (lus.has(a.id) ? ICONES.coche + ' Lu' : ICONES.cercle + ' Marquer lu') + '</button>' +
        '</span>' +
      '</div>' +
      '<div class="fiche">' +
        bloc('Contexte', a.contexte) + bloc('Méthode', a.methode) + bloc('Résultats', a.resultats) + bloc('Conclusion', a.conclusion) +
        '<dl class="bloc pratique"><dt class="eyebrow">Pour la pratique</dt><dd>' + esc(a.pour_la_pratique || '—') + '</dd></dl>' +
        bloc('Limites', a.limites) +
        (a.auteurs ? bloc('Auteurs', String(a.auteurs).slice(0, 260)) : '') +
        ((a.mots_cles || []).length ? bloc('Mots-clés', a.mots_cles.join(' · ')) : '') +
        resumeOrigine(a, jourSources) +
      '</div>' +
    '</article>';
  }
  function bloc(t, v) {
    return v ? '<dl class="bloc"><dt class="eyebrow">' + t + '</dt><dd>' + esc(v) + '</dd></dl>' : '';
  }

  /**
   * La place que le cabinet a donnée à cette revue dans son `config.json` — pas
   * un facteur d'impact, qui serait une autorité extérieure au barème. L'infobulle
   * porte le poids exact : un classement qu'on peut lire est un classement qu'on
   * peut contester, et c'est ce qu'on veut.
   */
  function rangBadge(r) {
    if (!r || !r.label) return '';
    var signe = r.poids > 0 ? '+' : '';
    return '<span class="rang rang-' + esc(r.cle) + '" title="Poids de la revue dans le barème : ' +
      signe + String(r.poids).replace('.', ',') + ' (config.json)">' + esc(r.label) + '</span>';
  }

  /**
   * Chaque nombre de la fiche est comparé au résumé d'origine à la génération.
   * Ceux qui ne s'y retrouvent pas sont affichés ici : la fiche reste lisible,
   * mais le lecteur sait quels chiffres remonter à la source avant de les citer.
   */
  function alerteChiffres(x) {
    var v = x && x.verif;
    if (!v || !v.absents || !v.absents.length) return '';
    var n = v.absents.length;
    return '<p class="verif-alerte">' +
      '<span class="verif-pastille" aria-hidden="true">!</span>' +
      '<span>' + n + (n > 1 ? ' chiffres sont absents' : ' chiffre est absent') +
      ' du résumé d\'origine — <b>' + esc(v.absents.join(', ')) + '</b>. ' +
      'À vérifier dans l\'article avant de les citer.</span></p>';
  }

  /* ---------- recommandations françaises ---------- */
  function recos() { return (etat.jour && etat.jour.recos) || []; }

  function recosFiltrees() {
    var q = etat.q.trim().toLowerCase();
    return recos().filter(function (r) {
      if (etat.themes.size && !etat.themes.has(r.theme)) return false;
      if (etat.nonLus && lus.has(r.id)) return false;
      if (q) {
        var h = [r.titre_court, r.titreOriginal, r.accroche, r.ce_qui_change, r.pour_la_pratique, r.organisme, (r.points_cles || []).join(' ')].join(' ').toLowerCase();
        if (h.indexOf(q) === -1) return false;
      }
      return true;
    }).sort(function (a, b) { return aff(b.theme) - aff(a.theme); });
  }

  function reco(r, i, jourSources) {
    var q = etat.q.trim();
    return '<article class="reco' + (lus.has(r.id) ? ' est-lu' : '') + (estGarde(r.id) ? ' est-garde' : '') + (aff(r.theme) < 0 ? ' en-retrait' : '') + '" id="reco-' + i + '" data-id="' + esc(r.id) + '"' + attributAudio(r) + ' data-ouvert="' + (etat.tout ? 'true' : 'false') + '">' +
      '<div class="tete">' +
        (estGarde(r.id) ? '<span class="marque-garde" title="Mise de côté">' + ICONES.marqueOn + '</span>' : '') +
        '<span class="orga">' + esc(r.organisme || '—') + '</span>' +
        '<span class="genre">' + esc(r.type || 'Publication') + '</span>' +
        '<span class="sep"></span>' +
        '<span class="genre">' + esc(r.theme || '') + '</span>' +
        (r.date ? '<span class="cle">' + esc(dateCourte(r.date)) + '</span>' : '') +
      '</div>' + alerteChiffres(r) +
      '<h3><button type="button" data-role="basculer">' + surligne(r.titre_court || r.titreOriginal, q) + '</button></h3>' +
      '<p class="accroche">' + surligne(r.accroche || '', q) + '</p>' +
      '<dl class="changement"><dt class="eyebrow">Ce qui change</dt><dd>' + esc(r.ce_qui_change || '—') + '</dd></dl>' +
      '<div class="actions">' +
        '<button class="deplier" type="button" data-role="basculer"><span class="fleche">' + ICONES.chevron + '</span><span>Détail</span></button>' +
        (lienSur(r.lien) ? '<a class="lien" href="' + esc(r.lien) + '" target="_blank" rel="noopener">Texte de référence ↗</a>' : '') +
        '<span class="droite">' +
          boutonEcouter() + boutonPartager() +
          '<button type="button" data-act="garde" aria-pressed="' + estGarde(r.id) + '">' +
            (estGarde(r.id) ? ICONES.marqueOn + ' Gardé' : ICONES.marque + ' Garder') + '</button>' +
          '<button type="button" data-act="lu" aria-pressed="' + lus.has(r.id) + '">' +
            (lus.has(r.id) ? ICONES.coche + ' Lu' : ICONES.cercle + ' Marquer lu') + '</button>' +
        '</span>' +
      '</div>' +
      '<div class="fiche">' +
        ((r.points_cles || []).length ? '<ul class="points">' + r.points_cles.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>' : '') +
        bloc('Population', r.population) +
        '<dl class="bloc pratique"><dt class="eyebrow">Pour la pratique</dt><dd>' + esc(r.pour_la_pratique || '—') + '</dd></dl>' +
        (r.titreOriginal && r.titreOriginal !== r.titre_court ? bloc('Intitulé officiel', r.titreOriginal) : '') +
        (r.certitude && r.certitude !== 'Texte complet lu'
          ? '<p class="reserve">Fiche établie à partir du ' + (r.certitude === 'Titre seul' ? 'seul intitulé' : 'résumé publié') +
            ' — se reporter au texte de référence avant toute application.</p>'
          : '') +
        resumeOrigine(r, jourSources) +
      '</div>' +
    '</article>';
  }

  function rendreRecos() {
    var vues = recosFiltrees();
    if (!vues.length) { $('#recos').innerHTML = ''; return; }
    $('#recos').innerHTML =
      '<div class="recos">' +
        '<div class="recos-tete"><h2 id="recos-titre">Recommandations françaises</h2>' +
        '<span class="n">' + vues.length + (vues.length > 1 ? ' publications' : ' publication') + '</span></div>' +
        vues.map(function (r, i) { return reco(r, i, jourAvecSources(etat.jour)); }).join('') +
      '</div>';
  }

  function objetsGardes() {
    return Object.keys(gardes).map(function (k) { return gardes[k]; });
  }

  /** Les gardés, du plus récemment mis de côté au plus ancien. */
  function rendreGardes() {
    var items = objetsGardes().sort(function (a, b) { return String(b._jour || '').localeCompare(String(a._jour || '')); });
    var q = etat.q.trim().toLowerCase();
    if (q) items = items.filter(function (x) {
      return JSON.stringify(x).toLowerCase().indexOf(q) !== -1;
    });

    $('#recos').innerHTML = '';
    if (!items.length) {
      $('#flux').innerHTML = '<div class="vide"><div class="g">\u2014</div>' +
        '<p>Rien de mis de côté pour l\'instant.<br>Le signet sous chaque fiche la range ici, et elle y reste.</p></div>';
      $('#compte').textContent = '';
      return;
    }
    $('#compte').textContent = items.length + (items.length > 1 ? ' fiches mises de côté' : ' fiche mise de côté');
    $('#flux').innerHTML = items.map(function (x, i) {
      if (x._partiel) {
        return '<article class="entree" data-id="' + esc(x.id) + '" data-i="' + i + '">' +
          '<p class="vo">Fiche mise de côté avant la mise à jour : son contenu n\'a pas été conservé. ' +
          'Retrouvez-la par le sélecteur de date.</p>' +
          '<div class="actions"><span class="droite"><button type="button" data-act="garde" aria-pressed="true">' +
          ICONES.marqueOn + ' Retirer</button></span></div></article>';
      }
      var corps = x._type === 'reco' ? reco(x, i, null) : entree(x, i, null);
      return corps.replace('<div class="tete">',
        '<p class="provenance">Veille du ' + esc(dateCourte(x._jour)) + '</p><div class="tete">');
    }).join('');
  }

  /** Recherche dans toutes les journées archivées, chargées à la demande. */
  async function chercherArchives() {
    var q = etat.q.trim().toLowerCase();
    if (!q) return;
    var jours = ((etat.index && etat.index.jours) || []).map(function (j) { return j.date; });
    etat.vue = 'archives';
    etat.chargement = true;
    etat.archives = [];
    rendreRail();
    $('#recos').innerHTML = '';
    $('#flux').innerHTML = '<div class="vide"><div class="g">\u22ef</div><p>Lecture de ' + jours.length + ' journées…</p></div>';

    var trouves = [];
    for (var i = 0; i < jours.length; i += 6) {
      var lot = await Promise.all(jours.slice(i, i + 6).map(function (d) {
        var deja = etat.jours.filter(function (j) { return j.date === d; })[0];
        return deja ? Promise.resolve(deja) : json('data/' + d + '.json').then(reparerThemes).catch(function () { return null; });
      }));
      lot.filter(Boolean).forEach(function (j) {
        var src = jourAvecSources(j);
        (j.recos || []).forEach(function (r) { if (contient(r, q)) trouves.push({ item: r, type: 'reco', jour: j.date, src: src }); });
        (j.articles || []).forEach(function (a) { if (contient(a, q)) trouves.push({ item: a, type: 'article', jour: j.date, src: src }); });
      });
      $('#compte').textContent = trouves.length + ' résultat(s) — ' + Math.min(i + 6, jours.length) + ' / ' + jours.length + ' journées lues';
    }

    trouves.sort(function (a, b) { return b.jour.localeCompare(a.jour); });
    etat.archives = trouves;
    etat.chargement = false;
    rendreRail();
    rendreArchives();
  }
  function contient(x, q) { return JSON.stringify(x).toLowerCase().indexOf(q) !== -1; }

  function rendreArchives() {
    var r = etat.archives || [];
    $('#recos').innerHTML = '';
    $('#compte').textContent = r.length
      ? r.length + ' résultat(s) pour « ' + etat.q.trim() +' » dans ' + ((etat.index && etat.index.jours) || []).length + ' journées'
      : 'Aucun résultat pour « ' + etat.q.trim() + ' » dans les archives';
    $('#flux').innerHTML = r.length
      ? r.map(function (t, i) {
          var corps = t.type === 'reco' ? reco(t.item, i, t.src) : entree(t.item, i, t.src);
          return corps.replace('<div class="tete">',
            '<p class="provenance">Veille du ' + esc(dateCourte(t.jour)) + '</p><div class="tete">');
        }).join('')
      : '<div class="vide"><div class="g">\u2014</div><p>Rien trouvé dans les journées archivées.</p></div>';
  }

  var observateur = null;
  function rendreFlux() {
    var vus = filtres(), tous = articles();
    var nJours = ((etat.index && etat.index.jours) || []).length;
    $('#archives-lien').innerHTML = (etat.q.trim() && nJours > 1)
      ? '<button id="chercher-archives">Chercher « ' + esc(etat.q.trim()) + ' » dans les ' + nJours + ' journées archivées</button>'
      : '';
    $('#compte').textContent = vus.length === tous.length
      ? tous.length + (tous.length > 1 ? ' articles' : ' article') + (nbGardes() ? ' · ' + nbGardes() + ' gardé' + (nbGardes() > 1 ? 's' : '') : '')
      : vus.length + ' sur ' + tous.length + ' affichés';

    var src = jourAvecSources(etat.jour);
    var cartes = vus.map(function (a, i) { return entree(a, i, src); });
    // La zone estompée commence là où les thèmes mis en retrait débutent :
    // un séparateur explique la pâleur, sinon elle se lit comme un défaut.
    for (var iR = 0; iR < vus.length; iR++) {
      if (aff(vus[iR].theme) < 0) {
        if (iR > 0) cartes.splice(iR, 0, '<div class="retrait-sep">Thèmes que vous avez mis en retrait</div>');
        break;
      }
    }
    $('#flux').innerHTML = vus.length
      ? cartes.join('')
      : '<div class="vide"><div class="g">—</div><p>Aucun article ne correspond à ces filtres.</p>' +
        '<button class="ctrl" id="vider">Tout réafficher</button></div>';
    etat.curseur = -1;
    espionner();
  }

  function espionner() {
    if (observateur) observateur.disconnect();
    var liens = [].slice.call(document.querySelectorAll('.sommaire a'));
    if (!liens.length || !('IntersectionObserver' in window)) return;
    observateur = new IntersectionObserver(function (entrees) {
      entrees.forEach(function (e) {
        if (!e.isIntersecting) return;
        var i = e.target.dataset.i;
        liens.forEach(function (l) { l.setAttribute('aria-current', l.dataset.i === i ? 'true' : 'false'); });
      });
    }, { rootMargin: '-80px 0px -70% 0px', threshold: 0 });
    document.querySelectorAll('.entree').forEach(function (n) { observateur.observe(n); });
  }

  function rendrePied() {
    var j = etat.jour;
    var src = (j.sourcesFr || []).concat(j.sources || []).map(function (s) {
      return '<dt>' + esc(s.label) + '</dt><dd' + (s.erreur ? ' class="ko"' : '') + '>' +
        (s.erreur ? esc(s.erreur) : s.recus + ' retenus sur ' + s.total + ' · fenêtre ' + s.fenetre + ' j') + '</dd>';
    }).join('');

    $('#pied').innerHTML =
      (j.manquants
        ? '<p class="manquants">' + j.manquants + (j.manquants > 1 ? ' fiches n\'ont' : ' fiche n\'a') +
          ' pas pu être générée' + (j.manquants > 1 ? 's' : '') + ' ce matin (incident technique). ' +
          'Les articles concernés se représenteront au prochain passage.</p>'
        : '') +
      '<p>Veille générée le ' + esc(j.genereLe ? new Date(j.genereLe).toLocaleString('fr-FR') : '—') +
      (j.modele ? ' · ' + esc(j.modele) : '') + (j.cout ? ' · ' + esc(j.cout) : '') + '</p>' +
      (src ? '<dl>' + src + '</dl>' : '') +
      '<p>Sources : Europe PMC / MEDLINE-PubMed, Annales d\'Endocrinologie, et les flux des organismes français (HAS, sociétés savantes). ' +
      'Les fiches sont rédigées automatiquement à partir des résumés publiés : elles servent à décider quoi lire, ' +
      'ne remplacent pas la lecture de l\'article et n\'engagent aucune décision clinique.</p>' +
      '<p style="margin-top:10px"><kbd>/</kbd> rechercher · <kbd>J</kbd> <kbd>K</kbd> naviguer · <kbd>O</kbd> ouvrir · ' +
      '<kbd>L</kbd> lu · <kbd>G</kbd> garder · <kbd>?</kbd> aide</p>';
  }

  /**
   * Un menu déroulant de toutes les journées devient illisible dès quelques mois.
   * Le geste courant — « hier », « avant-hier » — passe donc par deux flèches ;
   * le geste rare — « ce truc de mi-juillet » — par un panneau groupé par mois.
   */
  function rendreJours() {
    var liste = (etat.index && etat.index.jours) || [];   // du plus récent au plus ancien
    var i = indexDuJour();
    var recent = i <= 0, ancien = i < 0 || i >= liste.length - 1;

    $('#navjour').innerHTML = liste.length < 2 ? '' :
      '<button class="ctrl fleche" id="jour-prec"' + (ancien ? ' disabled' : '') +
        ' aria-label="Journée précédente" title="Journée précédente">‹</button>' +
      '<button class="ctrl jour-courant" id="jour-ouvrir" aria-haspopup="dialog">' +
        '<span class="lg">' + esc(dateLongue(etat.jour.date)) + '</span>' +
        '<span class="sm">' + esc(dateCourte(etat.jour.date)) + '</span>' +
        // « aujourd'hui » seulement si c'est vrai : le 5 octobre, une veille du
        // 1er restée en tête (timer arrêté) s'affichait « aujourd'hui ».
        (i === 0 ? '<span class="auj">' + (etat.jour.date === isoLocal(new Date()) ? 'aujourd\'hui' : 'dernière') + '</span>' : '') +
      '</button>' +
      '<button class="ctrl fleche" id="jour-suiv"' + (recent ? ' disabled' : '') +
        ' aria-label="Journée suivante" title="Journée suivante">›</button>';
  }

  function indexDuJour() {
    var liste = (etat.index && etat.index.jours) || [];
    for (var k = 0; k < liste.length; k++) if (liste[k].date === etat.jour.date) return k;
    return -1;
  }

  function decalerJour(pas) {
    var liste = (etat.index && etat.index.jours) || [];
    var i = indexDuJour();
    if (i < 0) return;
    var cible = liste[i + pas];
    if (cible) { etat.vue = 'jour'; changerDeJour(cible.date); }
  }

  /** Panneau d'archives : les journées groupées par mois, filtrables. */
  function rendreArchivesPanneau() {
    var q = sansAccents($('#archives-q').value.trim());
    var liste = ((etat.index && etat.index.jours) || []).filter(function (d) {
      if (!q) return true;
      return sansAccents(dateLongue(d.date) + ' ' + (d.titre || '')).indexOf(q) !== -1;
    });

    if (!liste.length) {
      $('#archives-liste').innerHTML = '<p class="archives-vide">Aucune journée ne correspond.</p>';
      return;
    }

    var html = '', moisCourant = '';
    liste.forEach(function (d) {
      var mois = MOIS[+d.date.slice(5, 7) - 1] + ' ' + d.date.slice(0, 4);
      if (mois !== moisCourant) {
        if (moisCourant) html += '</ol>';
        html += '<h3 class="archives-mois">' + esc(mois) + '</h3><ol class="archives-jours">';
        moisCourant = mois;
      }
      var n = (d.nb || 0) + (d.recos || 0);
      html += '<li><button type="button" data-date="' + esc(d.date) + '"' +
        (d.date === etat.jour.date ? ' aria-current="true"' : '') + '>' +
        '<span class="jj">' + (+d.date.slice(8, 10)) +
          '<span class="jour-nom">' + esc(JOURS[jourSemaine(d.date)].slice(0, 3)) + '</span></span>' +
        '<span class="tt">' + esc(d.titre || 'Veille du jour') + '</span>' +
        '<span class="nn">' + n + '</span></button></li>';
    });
    html += '</ol>';
    $('#archives-liste').innerHTML = html;
  }

  function jourSemaine(iso) {
    var p = String(iso || '').split('-');
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay();
  }

  function sansAccents(t) {
    return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  function rendreVue() {
    if (etat.vue === 'gardes') return rendreGardes();
    if (etat.vue === 'archives') return rendreArchives();
    rendreRecos(); rendreFlux();
  }
  // Tout rendu reconstruit les cartes : une lecture en cours n'aurait plus de
  // bouton pour l'arrêter. On la coupe avant.
  function rendre() { arreterLecture(); rendreUne(); rendreRail(); rendreVue(); rendrePied(); rendreJours(); majBarre(); }
  function rafraichir() { arreterLecture(); rendreUne(); rendreRail(); rendreVue(); majBarre(); }

  /* ---------- interactions ---------- */
  $('#rail').addEventListener('click', function (e) {
    if (e.target.closest('.filtres-bascule')) {
      etat.filtresOuverts = !etat.filtresOuverts;
      rendreRail();
      return;
    }
    var v = e.target.closest('.vue');
    if (v) {
      etat.vue = v.dataset.vue;
      if (etat.vue !== 'archives') etat.archives = etat.archives;
      rendreRail(); rendreVue();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    var b = e.target.closest('.filtre');
    if (b) {
      if (b.dataset.theme) { etat.themes.has(b.dataset.theme) ? etat.themes.delete(b.dataset.theme) : etat.themes.add(b.dataset.theme); }
      else if (b.dataset.flag) { etat[b.dataset.flag] = !etat[b.dataset.flag]; }
      rafraichir();
    }
  });

  function surClic(e) {
    if (e.target.id === 'vider') {
      etat.themes.clear(); etat.majeurs = etat.nonLus = false; etat.q = ''; $('#q').value = '';
      rafraichir(); return;
    }
    var bloc = e.target.closest('.entree, .reco');
    if (!bloc) return;
    var act = e.target.closest('button[data-act]');
    if (act) {
      var id = bloc.dataset.id;
      // Volontairement avant tout le reste, et sans rafraîchir : un rendu
      // reconstruirait la carte et ferait disparaître le bouton en cours.
      if (act.dataset.act === 'ecouter') { lire(bloc); return; }
      if (act.dataset.act === 'partager') { partager(bloc); return; }
      if (act.dataset.act === 'lu') {
        lus.has(id) ? lus.delete(id) : lus.add(id);
        LS.ecrire('md.lus', Array.from(lus));
      } else {
        var estReco = bloc.classList.contains('reco');
        var source = (estReco ? recos() : articles()).concat(objetsGardes())
          .filter(function (x) { return x.id === id; })[0];
        var etaitGarde = estGarde(id);
        basculerGarde(id, source || { id: id }, estReco ? 'reco' : 'article');
        signaler(
          etaitGarde ? 'Retiré des fiches mises de côté'
                     : 'Mis de côté — ' + nbGardes() + (nbGardes() > 1 ? ' fiches conservées' : ' fiche conservée'),
          !etaitGarde && etat.vue !== 'gardes'
        );
      }
      rafraichir();
      return;
    }
    if (e.target.closest('[data-role="basculer"]')) {
      bloc.dataset.ouvert = bloc.dataset.ouvert === 'true' ? 'false' : 'true';
    }
  }
  $('#flux').addEventListener('click', surClic);
  $('#recos').addEventListener('click', surClic);

  var minuteur;
  $('#q').addEventListener('input', function () {
    var v = this.value;
    clearTimeout(minuteur);
    minuteur = setTimeout(function () { etat.q = v; rafraichir(); }, 130);
  });

  var panneau = $('#archives-panneau');
  $('#navjour').addEventListener('click', function (e) {
    if (e.target.closest('#jour-prec')) return decalerJour(1);    // la liste va du récent à l'ancien
    if (e.target.closest('#jour-suiv')) return decalerJour(-1);
    if (e.target.closest('#jour-ouvrir')) {
      $('#archives-q').value = '';
      rendreArchivesPanneau();
      panneau.showModal();
    }
  });
  $('#archives-q').addEventListener('input', rendreArchivesPanneau);
  $('#archives-fermer').addEventListener('click', function () { panneau.close(); });
  $('#archives-liste').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-date]');
    if (!b) return;
    panneau.close();
    etat.vue = 'jour';
    changerDeJour(b.dataset.date);
  });
  document.addEventListener('click', function (e) {
    if (e.target.id === 'chercher-archives') chercherArchives();
    if (e.target.id === 'avis-voir') {
      $('#avis-action').hidden = true;
      etat.vue = 'gardes';
      rendreRail(); rendreVue();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });

  $('#tout').addEventListener('click', function () {
    etat.tout = !etat.tout;
    var libelle = etat.tout ? 'Tout replier' : 'Tout déplier';
    this.setAttribute('aria-pressed', String(etat.tout));
    // Le libellé est masqué sur petit écran, où le bouton se réduit à son
    // icône : l'attribut aria-label reste donc le seul nom accessible.
    this.setAttribute('aria-label', libelle);
    $('span', this).textContent = libelle;
    document.querySelectorAll('.entree, .reco').forEach(function (n) { n.dataset.ouvert = String(etat.tout); });
  });

  $('#tout-lu').addEventListener('click', function () {
    filtres().concat(recosFiltrees()).forEach(function (a) { lus.add(a.id); });
    LS.ecrire('md.lus', Array.from(lus));
    rafraichir();
  });

  /* ---------- préférences : Mes thèmes ---------- */
  function themesConnus() {
    var vus = new Set(((etat.jour && etat.jour.themes) || []));
    articles().concat(recos()).forEach(function (x) { if (x.theme) vus.add(x.theme); });
    Object.keys(affinites).forEach(function (t) { vus.add(t); });
    // « Autre » ferme la liste : c'est le fourre-tout, pas une rubrique qu'on suit.
    return Array.from(vus).sort(function (a, b) {
      if (a === 'Autre') return 1;
      if (b === 'Autre') return -1;
      return a.localeCompare(b, 'fr');
    });
  }
  function rendrePrefs() {
    var themes = themesConnus();
    $('#prefs-liste').innerHTML = themes.length
      ? themes.map(function (t) {
          var v = aff(t);
          var choix = function (val, libelle) {
            return '<button type="button" data-pref-theme="' + esc(t) + '" data-pref-val="' + val + '"' +
              ' aria-pressed="' + (v === val) + '">' + libelle + '</button>';
          };
          var n = articles().concat(recos()).filter(function (x) { return x.theme === t; }).length;
          return '<div class="prefs-ligne"><span class="prefs-theme">' +
            '<span class="prefs-nom">' + esc(t) + '</span>' +
            (n ? '<span class="prefs-n">' + n + (n > 1 ? ' fiches aujourd\'hui' : ' fiche aujourd\'hui') + '</span>' : '') + '</span>' +
            '<span class="prefs-choix" role="group" aria-label="Préférence pour ' + esc(t) + '">' +
            choix(1, 'Suivi de près') + choix(0, 'Normal') + choix(-1, 'En retrait') +
            '</span></div>';
        }).join('')
      : '<p class="prefs-vide">Les thèmes apparaîtront ici dès la première veille chargée.</p>';
  }
  /**
   * Réglages de la lecture vocale.
   *
   * Le sélecteur ne liste que ce que CE navigateur expose. Sur iPhone, Safari
   * ne donne pas accès aux voix « Améliorée » d'Apple : la liste y sera courte
   * et les voix médiocres, et le mot le dit plutôt que de le taire. La note
   * renvoie alors à la vraie solution, qui est l'audio pré-généré côté serveur.
   */
  function rendrePrefsVoix() {
    var hote = $('#prefs-voix');
    if (!hote) return;
    if (!PARLE && !AUDIO) {
      hote.innerHTML = '<p class="prefs-vide">Ce navigateur ne sait pas lire à voix haute.</p>';
      return;
    }
    var v = voixFr();
    var choisie = voixChoisie();
    var options = v.map(function (x) {
      var sel = choisie && (x.voiceURI === choisie.voiceURI) ? ' selected' : '';
      return '<option value="' + esc(x.voiceURI) + '"' + sel + '>' + esc(x.name) + '</option>';
    }).join('');

    hote.innerHTML =
      '<div class="prefs-ligne">' +
        '<span class="prefs-theme"><span class="prefs-nom">Voix</span>' +
          '<span class="prefs-n">' + (v.length ? v.length + (v.length > 1 ? ' voix françaises disponibles' : ' voix française disponible')
                                               : 'aucune voix française détectée') + '</span></span>' +
        (v.length
          ? '<select id="voix-choix" aria-label="Voix de lecture">' + options + '</select>'
          : '<span class="prefs-n">La lecture utilisera la voix par défaut.</span>') +
      '</div>' +
      '<div class="prefs-ligne">' +
        '<span class="prefs-theme"><span class="prefs-nom">Vitesse</span></span>' +
        '<span class="prefs-choix" role="group" aria-label="Vitesse de lecture">' +
          VITESSES.map(function (p) {
            return '<button type="button" data-vitesse="' + p[0] + '" aria-pressed="' +
              (String(reglagesVoix.vitesse) === p[0]) + '">' + p[1] + '</button>';
          }).join('') +
        '</span>' +
      '</div>' +
      '<div class="prefs-ligne">' +
        '<span class="prefs-theme"><span class="prefs-nom">Essai</span>' +
          '<span class="prefs-n">Une phrase, pour entendre le réglage</span></span>' +
        '<button type="button" class="prefs-essai" id="voix-essai">Écouter un exemple</button>' +
      '</div>' +
      '<p class="prefs-note prefs-note-voix">' +
        'Sur iPhone et iPad, Safari ne donne pas accès aux voix « Améliorée » et ' +
        '« Premium » d\'Apple, même téléchargées : la lecture y reste celle des voix ' +
        'compactes. Une voix naturelle sur mobile demande des fichiers audio préparés ' +
        'à la génération — voyez <code>voix</code> dans <code>config.json</code>.' +
      '</p>';
  }

  function essaiVoix() {
    if (!PARLE) return;
    try { window.speechSynthesis.cancel(); } catch (e) {}
    var u = new window.SpeechSynthesisUtterance(
      "Chez les patients traités par metformine, l'hémoglobine glyquée baisse de zéro virgule huit point."
    );
    u.lang = 'fr-FR';
    var vx = voixChoisie(); if (vx) u.voice = vx;
    u.rate = +reglagesVoix.vitesse || 1;
    try { window.speechSynthesis.speak(u); } catch (e) {}
  }

  /* ---------- panneau « Les titres du jour » et barre du pouce ----------
     Sur mobile il n'y a pas de colonne latérale : le sommaire y était
     simplement masqué, et il fallait parcourir une douzaine d'écrans pour
     savoir ce qu'il y avait dans la journée. Le panneau le rend en un geste,
     et la barre du bas le met à portée du pouce depuis n'importe quel endroit
     de la page — 48 px en bas, contre 117 px de bandeau collant en haut. */
  var sommairePanneau = $('#sommaire-panneau');
  var barre = $('#barre-pouce');

  function ouvrirSommaire() {
    var vus = filtres();
    $('#sommaire-liste').innerHTML = vus.length
      ? sommaireHTML(vus)
      : '<p class="archives-vide">Aucun article ne correspond aux filtres.</p>';
    sommairePanneau.showModal();
  }

  $('#barre-sommaire').addEventListener('click', ouvrirSommaire);
  $('#barre-haut').addEventListener('click', function () {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  $('#sommaire-fermer').addEventListener('click', function () { sommairePanneau.close(); });
  $('#sommaire-liste').addEventListener('click', function (e) {
    var a = e.target.closest('a[data-i]');
    if (!a) return;
    e.preventDefault();
    sommairePanneau.close();
    var cible = document.getElementById('art-' + a.dataset.i);
    if (cible) {
      // `scrollIntoView` seul colle la carte au bord haut : on garde une marge
      // pour que l'étiquette de thème reste lisible.
      var y = cible.getBoundingClientRect().top + window.scrollY - 12;
      window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
      etat.curseur = +a.dataset.i;
    }
  });

  /** La barre n'apparaît qu'une fois la lecture engagée : en haut de page elle
      n'aurait rien à offrir que la page ne montre déjà. */
  function majBarre() {
    if (!barre) return;
    var enVue = etat.vue === 'jour' && !sommairePanneau.open;
    var n = enVue ? filtres().length : 0;
    barre.hidden = !(enVue && n > 1 && window.scrollY > 500);
    $('#barre-n').textContent = n ? String(n) : '';
  }
  window.addEventListener('scroll', majBarre, { passive: true });

  var prefs = $('#prefs');
  $('#prefs-voix').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-vitesse]');
    if (b) {
      reglagesVoix.vitesse = b.dataset.vitesse;
      LS.ecrire('md.voix', reglagesVoix);
      rendrePrefsVoix();
      essaiVoix();
      return;
    }
    if (e.target.closest('#voix-essai')) essaiVoix();
  });
  $('#prefs-voix').addEventListener('change', function (e) {
    if (e.target.id !== 'voix-choix') return;
    reglagesVoix.voix = e.target.value;
    LS.ecrire('md.voix', reglagesVoix);
    essaiVoix();
  });
  // Chrome ne remplit getVoices() qu'après un aller-retour : on redessine à l'arrivée.
  if (PARLE && typeof window.speechSynthesis.addEventListener === 'function') {
    window.speechSynthesis.addEventListener('voiceschanged', function () {
      if (prefs && prefs.open) rendrePrefsVoix();
    });
  }

  $('#prefs-ouvrir').addEventListener('click', function () { rendrePrefs(); rendrePrefsVoix(); prefs.showModal(); });
  $('#prefs-fermer').addEventListener('click', function () { arreterLecture(); prefs.close(); });
  $('#prefs-liste').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-pref-theme]');
    if (!b) return;
    var t = b.dataset.prefTheme, v = +b.dataset.prefVal;
    if (v === 0) delete affinites[t]; else affinites[t] = v;
    LS.ecrire('md.affinites', affinites);
    rendrePrefs(); rafraichir();
  });

  // Chaque panneau porte une croix : c'est ce qu'on cherche du pouce, en haut
  // à droite, plutôt qu'en bas après tout le contenu.
  document.addEventListener('click', function (e) {
    var x = e.target.closest('.fermer-x');
    if (!x) return;
    var d = x.closest('dialog');
    if (d) { arreterLecture(); d.close(); }
  });

  var aide = $('#aide');
  $('#aide-ouvrir').addEventListener('click', function () { aide.showModal(); });
  $('#prefs-aide').addEventListener('click', function () { arreterLecture(); prefs.close(); aide.showModal(); });
  $('#aide-fermer').addEventListener('click', function () { aide.close(); });

  /* ---------- clavier ---------- */
  function deplacer(d) {
    var n = [].slice.call(document.querySelectorAll('.entree'));
    if (!n.length) return;
    etat.curseur = Math.max(0, Math.min(n.length - 1, etat.curseur + d));
    var c = n[etat.curseur];
    c.scrollIntoView({ block: 'start', behavior: 'smooth' });
    c.querySelector('.titre button').focus({ preventScroll: true });
  }
  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var champ = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    if (champ) { if (e.key === 'Escape') e.target.blur(); return; }
    if (aide.open || panneau.open || prefs.open) return;
    var n = [].slice.call(document.querySelectorAll('.entree'));
    var c = n[etat.curseur];
    if (e.key === '/') { e.preventDefault(); $('#q').focus(); $('#q').select(); }
    else if (e.key === '?') { e.preventDefault(); aide.showModal(); }
    else if (e.key === 'j') { e.preventDefault(); deplacer(1); }
    else if (e.key === 'k') { e.preventDefault(); deplacer(-1); }
    else if (e.key === 'o' && c) { e.preventDefault(); c.dataset.ouvert = c.dataset.ouvert === 'true' ? 'false' : 'true'; }
    else if ((e.key === 'l' || e.key === 'g') && c) {
      e.preventDefault();
      var pos = etat.curseur;
      c.querySelector('button[data-act="' + (e.key === 'l' ? 'lu' : 'garde') + '"]').click();
      etat.curseur = pos - 1; deplacer(1);
    }
    else if (e.key === 'd') { e.preventDefault(); $('#tout').click(); }
  });

  demarrer();
})();
