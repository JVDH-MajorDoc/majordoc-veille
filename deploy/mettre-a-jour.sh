#!/usr/bin/env bash
# MajorDoc — mise à jour d'une installation existante, depuis l'archive.
#
#   unzip -q majordoc-maj-AAAA-MM-JJ.zip -d /tmp
#   bash /tmp/majordoc/deploy/mettre-a-jour.sh
#
# Ce que le script fait, et que la procédure à la main faisait mal :
#   · il sauvegarde le code en place AVANT d'y toucher, et donne la commande
#     de retour en arrière — c'était le seul point faible de la procédure ;
#   · il refuse d'avancer si les tests échouent, plutôt que de laisser un
#     timer republier un board cassé demain matin ;
#   · il compare les configs et signale les réglages nouveaux, au lieu de
#     compter sur un diff qu'on oublie de lire ;
#   · il ne touche jamais à config.json, .env ni data/.
#
# Aucune dépendance : ni git, ni réseau, ni dépôt distant.

set -euo pipefail

CIBLE="${MAJORDOC_CIBLE:-/opt/majordoc}"
UTILISATEUR="${MAJORDOC_UTILISATEUR:-majordoc}"
SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HORODATAGE="$(date +%Y%m%d-%H%M%S)"
SAUVEGARDE="${CIBLE}.avant-${HORODATAGE}"

dire() { printf '\n\033[1m%s\033[0m\n' "$*"; }
sudo_majordoc() { sudo -u "$UTILISATEUR" -g "$UTILISATEUR" "$@"; }

[ -d "$CIBLE" ] || { echo "Installation introuvable dans $CIBLE." >&2; exit 1; }
[ -f "$SOURCE/package.json" ] || { echo "Archive incomplète : $SOURCE ne ressemble pas à MajorDoc." >&2; exit 1; }
[ "$SOURCE" != "$CIBLE" ] || { echo "La source et la cible sont le même dossier." >&2; exit 1; }

dire "1/6  Arrêt du timer"
systemctl stop majordoc.timer 2>/dev/null || echo "     (timer déjà arrêté)"

dire "2/6  Sauvegarde du code en place → $SAUVEGARDE"
# Le site publié et les données pèsent : on ne sauvegarde que ce qu'on remplace.
mkdir -p "$SAUVEGARDE"
for x in src tests deploy package.json README.md INSTALLATION.md config.json; do
  [ -e "$CIBLE/$x" ] && cp -a "$CIBLE/$x" "$SAUVEGARDE/"
done
echo "     Retour en arrière, si besoin :"
echo "       systemctl stop majordoc.timer"
echo "       cp -a $SAUVEGARDE/. $CIBLE/ && chown -R $UTILISATEUR:$UTILISATEUR $CIBLE"
echo "       systemctl start majordoc.timer"

dire "3/6  Copie du nouveau code"
rm -rf "$CIBLE/src" "$CIBLE/tests" "$CIBLE/deploy"
cp -a "$SOURCE/src" "$SOURCE/deploy" "$CIBLE/"
[ -d "$SOURCE/tests" ] && cp -a "$SOURCE/tests" "$CIBLE/"
for f in package.json README.md INSTALLATION.md; do
  [ -f "$SOURCE/$f" ] && cp -a "$SOURCE/$f" "$CIBLE/"
done
chown -R "$UTILISATEUR:$UTILISATEUR" "$CIBLE"
echo "     config.json, .env et data/ n'ont pas été touchés."

dire "4/6  Réglages nouveaux dans l'archive"
# Les clés présentes dans l'exemple et absentes du config en place : c'est là
# que se cachent les fonctions qu'on croit installées et qui dorment, faute
# d'avoir été activées. On descend dans les blocs de réglages (anthropic,
# voix…), pas dans les listes que le cabinet a composées lui-même (thèmes,
# revues, pénalités) : leurs clés sont des noms, pas des réglages, et un thème
# retiré exprès ne doit pas revenir à chaque mise à jour comme une nouveauté.
NOUVEAUX="$(node -e '
const reglage = (o) => o && typeof o === "object" && !Array.isArray(o) &&
  Object.keys(o).every((k) => /^_?[a-z][a-z0-9_]*$/.test(k));
const manquants = (a, b, chemin = "") => Object.keys(a)
  .filter((k) => !/^_?commentaire$/.test(k))
  .flatMap((k) => {
    const ici = chemin ? `${chemin}.${k}` : k;
    if (!b || !(k in b)) return [ici];
    return reglage(a[k]) && reglage(b[k]) ? manquants(a[k], b[k], ici) : [];
  });
console.log(manquants(require(process.argv[1]), require(process.argv[2])).join(" "));
' "$SOURCE/config.json" "$CIBLE/config.json" 2>/dev/null || true)"
if [ -n "$NOUVEAUX" ]; then
  echo "     À reporter dans $CIBLE/config.json : $NOUVEAUX"
  echo "     Les valeurs d'exemple sont dans $SOURCE/config.json"
else
  echo "     Aucun réglage nouveau."
fi

# Le bloc « anthropic » porte le modèle et son tarif : un modèle retiré y
# resterait indéfiniment, puisque config.json n'est jamais réécrit.
MODELE="$(node -e '
const a = require(process.argv[1]).anthropic ?? {}, b = require(process.argv[2]).anthropic ?? {};
if (a.model && b.model !== a.model) console.log(`${b.model ?? "(absent)"} → ${a.model}`);
' "$SOURCE/config.json" "$CIBLE/config.json" 2>/dev/null || true)"
if [ -n "$MODELE" ]; then
  echo "     Modèle à mettre à jour dans $CIBLE/config.json : $MODELE"
  echo "     Reportez tout le bloc « anthropic » de $SOURCE/config.json (modèle, effort, max_tokens, tarif)."
fi

# La configuration nginx vit hors de l'installation : on ne la touche pas,
# mais on signale qu'elle a une version plus récente à reprendre.
if [ -d /etc/nginx ] && [ ! -f /etc/nginx/snippets/majordoc-securite.conf ]; then
  echo "     nginx : configuration à reprendre (en-têtes de sécurité, audio sur iPhone)."
  echo "     Marche à suivre : INSTALLATION.md, section 15, « Configuration nginx »."
fi

dire "5/6  Contrôles"
cd "$CIBLE"

# Les tests sont la barrière : ils ne demandent ni clé ni réseau, donc un échec
# ici est un vrai échec. Le timer reste arrêté, rien n'est publié.
if ! sudo_majordoc npm test; then
  echo >&2
  printf '\n\033[1m  Les tests échouent. Le timer reste arrêté, rien ne sera publié.\033[0m\n' >&2
  echo "  Retour en arrière :" >&2
  echo "    cp -a $SAUVEGARDE/. $CIBLE/ && chown -R $UTILISATEUR:$UTILISATEUR $CIBLE" >&2
  exit 1
fi

# Le dry-run, lui, dépend du réseau et de serveurs qui ne nous appartiennent
# pas. Une HAS en maintenance n'est pas une raison de refuser une mise à jour :
# on prévient, on ne bloque pas.
RECOLTE_OK=1
if ! sudo_majordoc node src/run.mjs --dry-run; then
  RECOLTE_OK=0
  printf '\n\033[1m  Attention : la récolte a échoué.\033[0m\n'
  echo "     Le code est en place et les tests passent ; ce sont les sources qui"
  echo "     n'ont pas répondu. Vérifiez le réseau du conteneur avant de relancer"
  echo "     le timer : node src/diagnostic.mjs"
fi

dire "6/6  À vous de jouer"
[ "$RECOLTE_OK" = "1" ] \
  && echo "     Les tests passent et les sources répondent." \
  || echo "     Les tests passent ; les sources, elles, n'ont pas répondu (voir ci-dessus)."
cat <<TEXTE
     Le board publié affiche encore l'ancienne version : il change au prochain
     passage du timer, ou tout de suite avec la première commande.

       cd $CIBLE && sudo -u $UTILISATEUR -g $UTILISATEUR node src/run.mjs
       systemctl start majordoc.timer

     Une fois la nouvelle veille vérifiée, la sauvegarde peut partir :
       rm -rf $SAUVEGARDE
TEXTE
