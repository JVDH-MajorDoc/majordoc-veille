#!/usr/bin/env bash
# MajorDoc — la veille a-t-elle bien été republiée ?
#
# L'alerte d'échec (OnFailure=, deploy/alerte.sh) ne voit que les générations
# qui échouent. Elle ne voit pas celles qui ne démarrent pas : un timer arrêté
# ne produit aucun échec, il se tait. C'est ainsi que la veille est restée
# figée du 1er au 5 octobre 2026 sans que personne ne soit prévenu.
#
# Ce contrôle regarde le résultat plutôt que le moyen : si le board n'a pas été
# republié depuis MAJORDOC_FRAICHEUR_HEURES heures (30 par défaut — une
# matinée manquée), il prévient l'exploitant par les canaux d'alerte.sh, avec
# l'état du timer et la fin du journal. Lancé chaque jour par
# majordoc-fraicheur.timer, indépendant du timer de génération.
#
# Test : MAJORDOC_FRAICHEUR_HEURES=0 bash /opt/majordoc/deploy/fraicheur.sh

set -u
RACINE="${MAJORDOC_RACINE:-/opt/majordoc}"
SEUIL="${MAJORDOC_FRAICHEUR_HEURES:-30}"
INDEX="$RACINE/site/data/index.json"

if [ -f "$INDEX" ]; then
  HEURES="$(node -e '
    const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const t = Date.parse(j.misAJour);
    console.log(Number.isFinite(t) ? Math.floor((Date.now() - t) / 3600000) : -1);
  ' "$INDEX" 2>/dev/null || echo -1)"
else
  HEURES=-1
fi

if [ "$HEURES" -ge 0 ] && [ "$HEURES" -lt "$SEUIL" ]; then
  echo "majordoc-fraicheur : veille republiée il y a ${HEURES} h — rien à signaler."
  exit 0
fi

if [ "$HEURES" -lt 0 ]; then
  SUJET="MajorDoc : impossible de lire la date de la veille publiée"
else
  SUJET="MajorDoc : la veille n'a pas été republiée depuis $((HEURES / 24)) j $((HEURES % 24)) h"
fi

ETAT_TIMER="$(systemctl is-active majordoc.timer 2>/dev/null) / $(systemctl is-enabled majordoc.timer 2>/dev/null)"
PROCHAIN="$(systemctl list-timers majordoc.timer --no-pager 2>/dev/null | grep 'majordoc.timer' | head -1)"
JOURNAL="$(journalctl -u majordoc.service -n 15 --no-pager -o cat 2>/dev/null | tail -c 2000)"

DETAIL="Timer de génération : ${ETAT_TIMER:-inconnu}
Prochain passage : ${PROCHAIN:-aucun — le timer est arrêté}

Si le timer est « inactive » : systemctl start majordoc.timer
Pour régénérer tout de suite : systemctl start majordoc.service

Fin du journal :
${JOURNAL:-(vide)}"

export MAJORDOC_SUJET="$SUJET" MAJORDOC_DETAIL="$DETAIL"
exec bash "$RACINE/deploy/alerte.sh"
