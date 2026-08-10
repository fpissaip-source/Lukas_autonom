#!/usr/bin/env bash
#
# Richtet auf dem DigitalOcean-Droplet die Ausführungsumgebung für Lukas ein.
#
# Was hier passiert und warum:
#   Lukas soll Code ausführen können. Direkt auf dem Droplet wäre das gefährlich —
#   dort liegen die Trading-Credentials, die Wallet-Keys und die Postgres-DB, und
#   Lukas liest E-Mails und Webseiten, in denen Fremde ihm Anweisungen
#   unterschieben könnten. Deshalb bekommt er einen eigenen Benutzer, der NUR
#   Container starten darf, und die Ausführung passiert in einem Container ohne
#   Zugriff auf das Host-Dateisystem.
#
# Aufruf auf dem Droplet als root:
#   bash setup_sandbox.sh
#
set -euo pipefail

SANDBOX_USER="lukas-sandbox"
IMAGE="${LUKAS_SANDBOX_IMAGE:-python:3.12-slim}"

echo "==> 1/5 Docker prüfen"
if ! command -v docker >/dev/null 2>&1; then
  echo "    Docker fehlt, wird installiert…"
  curl -fsSL https://get.docker.com | sh
else
  echo "    Docker ist vorhanden: $(docker --version)"
fi

echo "==> 2/5 Benutzer '${SANDBOX_USER}' anlegen"
if id "${SANDBOX_USER}" >/dev/null 2>&1; then
  echo "    existiert bereits"
else
  adduser --disabled-password --gecos "" "${SANDBOX_USER}"
  echo "    angelegt"
fi

# Docker-Gruppe = faktisch root auf dem Host. Das ist hier bewusst akzeptiert,
# weil dieser Benutzer AUSSCHLIESSLICH für Lukas' Sandbox existiert und sich
# per SSH nur mit dem dedizierten Lukas-Schlüssel anmelden kann. Wer das enger
# haben will, nimmt stattdessen rootless Docker oder podman.
usermod -aG docker "${SANDBOX_USER}"

echo "==> 3/5 SSH-Schlüssel einrichten"
SSH_DIR="/home/${SANDBOX_USER}/.ssh"
mkdir -p "${SSH_DIR}"
chmod 700 "${SSH_DIR}"
touch "${SSH_DIR}/authorized_keys"
chmod 600 "${SSH_DIR}/authorized_keys"
chown -R "${SANDBOX_USER}:${SANDBOX_USER}" "${SSH_DIR}"
cat <<EOF
    Öffentlichen Schlüssel jetzt eintragen:
      echo 'ssh-ed25519 AAAA... lukas-sandbox' >> ${SSH_DIR}/authorized_keys

    Den privaten Teil in Railway als VPS_SSH_KEY setzen, dazu:
      VPS_SSH_HOST = <IP dieses Droplets>
      VPS_SSH_USER = ${SANDBOX_USER}
EOF

echo "==> 4/5 Basis-Image laden (${IMAGE})"
docker pull "${IMAGE}"

echo "==> 5/5 Aufräum-Job für verwaiste Container"
cat > /etc/cron.hourly/lukas-sandbox-cleanup <<'CRON'
#!/bin/sh
# Container mit Lukas-Label, die älter als 2 Stunden sind, entfernen.
# Der API-Server räumt selbst auf; das hier ist das Netz darunter, falls er
# neu startet und die Container verwaist zurücklässt.
for id in $(docker ps -q --filter label=lukas-sandbox=1); do
  started=$(docker inspect -f '{{.State.StartedAt}}' "$id")
  age=$(( $(date +%s) - $(date -d "$started" +%s) ))
  [ "$age" -gt 7200 ] && docker rm -f "$id" >/dev/null 2>&1
done
CRON
chmod +x /etc/cron.hourly/lukas-sandbox-cleanup

echo
echo "Fertig. Kurzer Selbsttest:"
echo "  sudo -u ${SANDBOX_USER} docker run --rm ${IMAGE} python3 -c 'print(1+1)'"
