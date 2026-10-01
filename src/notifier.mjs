// MajorDoc — notification du matin aux lectrices.
//
// Une fois la veille publiée, l'édito part en notification sur les téléphones
// qui suivent le sujet ntfy du cabinet (application ntfy, gratuite, sans
// compte) ; toucher la notification ouvre le board. Facultatif : sans
// NOTIF_NTFY dans .env, rien ne part.
//
// Ce n'est pas le canal des pannes : ALERTE_NTFY prévient l'exploitant, sur un
// sujet à part. Les lectrices n'ont pas à recevoir les journaux d'erreur.
//
// On publie en JSON plutôt que par en-têtes HTTP : un titre comme « Diabète —
// la HAS rebat les cartes » contient des caractères qu'un en-tête ne transporte
// pas tel quel.

const LIMITE = 1500;

/** Le contenu de la notification, à partir de l'édito du jour. */
export function messageEdito({ edito, nbArticles = 0, nbRecos = 0, url = null }) {
  if (!edito?.titre) return null;
  const compte = [
    nbRecos ? `${nbRecos} recommandation${nbRecos > 1 ? 's' : ''}` : '',
    nbArticles ? `${nbArticles} article${nbArticles > 1 ? 's' : ''}` : '',
  ].filter(Boolean).join(' · ');
  let corps = [
    ...(edito.points ?? []).map((p) => `• ${p}`),
    edito.a_lire_en_priorite ? `\nÀ lire en priorité : ${edito.a_lire_en_priorite}` : '',
    compte ? `\n${compte}` : '',
  ].filter(Boolean).join('\n');
  if (corps.length > LIMITE) corps = corps.slice(0, LIMITE - 1) + '…';
  return { title: edito.titre, message: corps, ...(url ? { click: url } : {}), tags: ['books'] };
}

/** Sépare « https://ntfy.sh/mon-sujet » en serveur et sujet. */
export function cibleNtfy(adresse) {
  try {
    const u = new URL(adresse);
    const topic = u.pathname.replace(/^\/+|\/+$/g, '');
    if (!/^https?:$/.test(u.protocol) || !topic || topic.includes('/')) return null;
    return { serveur: `${u.protocol}//${u.host}/`, topic };
  } catch {
    return null;
  }
}

/**
 * Envoie la notification. Ne lève jamais : une notification manquée ne doit pas
 * faire passer pour un échec une veille qui, elle, est bien publiée.
 */
export async function notifierEdito({ adresse, url, edito, nbArticles, nbRecos, log = console.log }) {
  if (!adresse) return { envoye: false, motif: 'non configuré' };
  const cible = cibleNtfy(adresse);
  if (!cible) {
    log(`  ! Notification non envoyée : NOTIF_NTFY n'est pas une adresse ntfy valide (${adresse}).`);
    return { envoye: false, motif: 'adresse' };
  }
  const contenu = messageEdito({ edito, nbArticles, nbRecos, url });
  if (!contenu) return { envoye: false, motif: 'pas d\'édito' };
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(cible.serveur, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ topic: cible.topic, ...contenu }),
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    log('  Notification du matin envoyée.');
    return { envoye: true };
  } catch (e) {
    log(`  ! Notification non envoyée : ${e.message}`);
    return { envoye: false, motif: 'reseau' };
  } finally {
    clearTimeout(minuteur);
  }
}
