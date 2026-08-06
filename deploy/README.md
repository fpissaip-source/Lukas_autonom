# Lukas auf einem Ubuntu-VPS

Diese Anleitung ist fuer Ubuntu 24.04 und den Branch `claude/vps-security-mcp`.
Die Railway-Datenbank bleibt bestehen; nur API, UI und Worker laufen auf dem VPS.

## Erstinstallation

Als `root` per SSH anmelden und ausfuehren:

```bash
cd /opt
git clone --branch claude/vps-security-mcp --single-branch \
  https://github.com/fpissaip-source/Lukas_autonom.git
cd Lukas_autonom

bash deploy/install-docker.sh
bash deploy/prepare-env.sh /root/lukas.env .env

docker compose up -d --build
```

Status und Logs pruefen:

```bash
docker compose ps
docker compose logs --tail=100 lukas
```

Beim ersten Test ist `LUKAS_DOMAIN=:80` gesetzt. Das Dashboard ist dann unter
`http://SERVER-IP` erreichbar. Das Dashboard fragt nach dem Wert von
`LUKAS_API_TOKEN`; der Token wird nicht in Git gespeichert.

## Domain und HTTPS aktivieren

1. Beim DNS-Anbieter einen A-Record der Domain auf die VPS-IP setzen.
2. In `/opt/Lukas_autonom/.env` aendern:

```env
LUKAS_DOMAIN=lukas.example.com
```

3. Stack neu laden:

```bash
cd /opt/Lukas_autonom
docker compose up -d
```

Caddy beantragt und erneuert das TLS-Zertifikat automatisch. Fuer einen Zugriff
ueber dieselbe Domain kann `LUKAS_ALLOWED_ORIGINS` leer bleiben, weil Same-Origin
automatisch zugelassen ist.

## Aktualisieren

```bash
cd /opt/Lukas_autonom
git pull --ff-only
docker compose up -d --build
docker image prune -f
```

## Betrieb

```bash
# laufende Container
docker compose ps

# Lukas-Logs
docker compose logs -f --tail=200 lukas

# Caddy-Logs
docker compose logs -f --tail=200 caddy

# Neustart
docker compose restart

# Stoppen
docker compose down
```

## Sicherheitsregeln

- `.env` niemals committen, hochladen oder im Chat posten.
- Port 5000 und PostgreSQL nicht in der Firewall oeffnen.
- Nach einer Token-Aenderung `docker compose up -d` ausfuehren.
- Railway-Variablen mit dem Prefix `RAILWAY_` werden beim Import entfernt.
- Die private API startet in Produktion nicht ungeschuetzt: Fehlt
  `LUKAS_API_TOKEN`, antwortet sie mit Status 503.
