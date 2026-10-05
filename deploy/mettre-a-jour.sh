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
#     timer republier un board cassé demain matin : l'ancienne version est
#     alors remise en place, d'elle-même ;
#   · il relance toujours le timer en partant, quelle que soit l'issue. Le
#     01/10/2026, il le laissait arrêté « pour qu'on regarde avant de
#     republier » ; la commande de relance s'est perdue, et la veille est
#     restée figée quatre jours sans qu'aucune alerte ne parte — un timer
#     arrêté n'échoue pas, il se tait ;
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

# Un timer désactivé exprès (systemctl disable : veille suspendue) le reste.
# Sinon, il repart en fin de script — même si le script s'interrompt.
TIMER_ACTIF=0
systemctl is-enabled --quiet majordoc.timer 2>/dev/null && TIMER_ACTIF=1
COPIE_FAITE=0
TERMINE=0

relancer_timer() {
  [ "$TIMER_ACTIF" = "1" ] || { echo "     Timer désactivé avant la mise à jour : il le reste."; return 0; }
  if systemctl start majordoc.timer; then
    echo "     Timer relancé. Prochaine veille :"
    systemctl list-timers majordoc.timer --no-pager 2>/dev/null | grep 'majordoc.timer' | sed 's/^/       /'
  else
    printf '\n\033[1m  Le timer n'"'"'a pas pu être relancé : systemctl start majordoc.timer\033[0m\n' >&2
  fi
}

# Sortie anticipée (tests en échec, copie interrompue…) : l'ancienne version
# revient en place et le timer repart. Jamais de veille à l'arrêt en partant.
retablir() {
  [ "$TERMINE" = "1" ] && return 0
  if [ "$COPIE_FAITE" = "1" ]; then
    printf '\n\033[1m  Retour à la version précédente (%s).\033[0m\n' "$SAUVEGARDE" >&2
    rm -rf "$CIBLE/src" "$CIBLE/tests" "$CIBLE/deploy"
    cp -a "$SAUVEGARDE/." "$CIBLE/" && chown -R "$UTILISATEUR:$UTILISATEUR" "$CIBLE"
  fi
  relancer_timer
}
trap retablir EXIT

dire "1/6  Arrêt du timer, le temps de la mise à jour"
systemctl stop majordoc.timer 2>/dev/null || echo "     (timer déjà arrêté)"

dire "2/6  Sauvegarde du code en place → $SAUVEGARDE"
# Le site publié et les données pèsent : on ne sauvegarde que ce qu'on remplace.
mkdir -p "$SAUVEGARDE"
for x in src tests deploy package.json README.md INSTALLATION.md config.json; do
  [ -e "$CIBLE/$x" ] && cp -a "$CIBLE/$x" "$SAUVEGARDE/"
done
echo "     Retour en arrière, si besoin plus tard :"
echo "       cp -a $SAUVEGARDE/. $CIBLE/ && chown -R $UTILISATEUR:$UTILISATEUR $CIBLE"

dire "3/6  Copie du nouveau code"
COPIE_FAITE=1
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

# Le contrôle de fraîcheur (deploy/fraicheur.sh) prévient quand la veille
# n'est plus republiée, quelle qu'en soit la cause — timer arrêté compris. Il
# s'installe de lui-même s'il manque : c'est un filet, pas une option.
if [ -d /etc/systemd/system ] && [ ! -f /etc/systemd/system/majordoc-fraicheur.timer ]; then
  cp "$CIBLE/deploy/majordoc-fraicheur.service" "$CIBLE/deploy/majordoc-fraicheur.timer" /etc/systemd/system/
  systemctl daemon-reload && systemctl enable --now majordoc-fraicheur.timer >/dev/null 2>&1 \
    && echo "     Contrôle de fraîcheur installé : alerte si la veille n'est pas republiée (chaque jour, 9 h 45)." \
    || echo "     Contrôle de fraîcheur copié, mais pas activé : systemctl enable --now majordoc-fraicheur.timer"
fi

dire "5/6  Contrôles"
cd "$CIBLE"

# Les tests sont la barrière : ils ne demandent ni clé ni réseau, donc un échec
# ici est un vrai échec. La nouvelle version n'est pas gardée : retablir()
# remet l'ancienne en place et relance le timer.
if ! sudo_majordoc npm test; then
  printf '\n\033[1m  Les tests échouent : la mise à jour est annulée.\033[0m\n' >&2
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

dire "6/6  Relance"
TERMINE=1
[ "$RECOLTE_OK" = "1" ] \
  && echo "     Les tests passent et les sources répondent." \
  || echo "     Les tests passent ; les sources, elles, n'ont pas répondu (voir ci-dessus)."
relancer_timer
cat <<TEXTE

     Le board publié change au prochain passage du timer. Pour le régénérer
     tout de suite :
       systemctl start majordoc.service && journalctl -u majordoc.service -f

     Une fois la nouvelle veille vérifiée, la sauvegarde peut partir :
       rm -rf $SAUVEGARDE
TEXTE
