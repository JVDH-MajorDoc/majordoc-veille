#!/usr/bin/env bash
# MajorDoc — installe la génération quotidienne du board.
#   macOS  : launchd  (fonctionne même si l'heure est passée pendant la veille)
#   Linux  : crontab
#
#   ./installer-tache-quotidienne.sh 06:45
#   ./installer-tache-quotidienne.sh --desinstaller

set -euo pipefail

RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LABEL="com.majordoc.digest"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
NODE="$(command -v node || true)"

if [ "${1:-}" = "--desinstaller" ]; then
  if [ "$(uname)" = "Darwin" ]; then
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null || true
    rm -f "$PLIST"
    echo "Tâche launchd supprimée."
  else
    crontab -l 2>/dev/null | grep -v "majordoc/src/run.mjs" | crontab - || true
    echo "Entrée crontab supprimée."
  fi
  exit 0
fi

HEURE="${1:-06:45}"
HH="${HEURE%%:*}"; MM="${HEURE##*:}"
HH=$((10#$HH)); MM=$((10#$MM))

if [ -z "$NODE" ]; then
  echo "Node.js introuvable. Installez-le : brew install node" >&2
  exit 1
fi
if [ ! -f "$RACINE/.env" ] && [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "Attention : ni .env ni ANTHROPIC_API_KEY. Créez $RACINE/.env avant la première exécution." >&2
fi

mkdir -p "$RACINE/data/logs"

if [ "$(uname)" = "Darwin" ]; then
  mkdir -p "$HOME/Library/LaunchAgents"
  cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$RACINE/src/run.mjs</string>
  </array>
  <key>WorkingDirectory</key><string>$RACINE</string>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>$HH</integer><key>Minute</key><integer>$MM</integer></dict>
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key><string>$RACINE/data/logs/digest.log</string>
  <key>StandardErrorPath</key><string>$RACINE/data/logs/digest.err.log</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string></dict>
</dict>
</plist>
PLISTEOF
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || launchctl load "$PLIST"
  echo "Tâche launchd installée : tous les jours à $(printf '%02d:%02d' "$HH" "$MM")."
  echo "Journal : $RACINE/data/logs/digest.log"
else
  LIGNE="$MM $HH * * * cd $RACINE && $NODE src/run.mjs >> $RACINE/data/logs/digest.log 2>&1"
  ( crontab -l 2>/dev/null | grep -v "majordoc/src/run.mjs" ; echo "$LIGNE" ) | crontab -
  echo "Entrée crontab installée : tous les jours à $(printf '%02d:%02d' "$HH" "$MM")."
fi

echo
echo "Définissez maintenant $RACINE/board.html comme page d'accueil du navigateur :"
echo "  Chrome  : Réglages → Au démarrage → Ouvrir une page précise → file://$RACINE/board.html"
echo "  Safari  : Réglages → Général → La page d'accueil → file://$RACINE/board.html"
echo "  Firefox : Réglages → Accueil → Page d'accueil → Adresse personnalisée"
