#!/usr/bin/env bash
# Startet ein wegwerfbares Postgres für den Integrationslauf.
#
# Kein Docker, keine externe Abhängigkeit: initdb legt ein Datenverzeichnis
# unter /tmp an, der Server lauscht nur auf 127.0.0.1 an einem eigenen Port.
# Nach dem Lauf ist alles weg — der Benchmark darf keine Spuren in einer
# echten Datenbank hinterlassen.
set -euo pipefail
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
DIR=${BENCH_PGDIR:-/tmp/lukas-bench-pg}
PORT=${BENCH_PGPORT:-55432}

export PATH="$PATH:$PGBIN"

# Einen Rest vom letzten Lauf zuerst wegräumen — sonst kollidiert der Port,
# und die Meldung ("could not start server") sagt nicht, woran es lag.
if [ -d "$DIR/data" ]; then
  if [ "$(id -u)" = "0" ] && id postgres >/dev/null 2>&1; then
    su postgres -c "PATH=$PATH pg_ctl -D $DIR/data stop -m immediate" >/dev/null 2>&1 || true
  else
    pg_ctl -D "$DIR/data" stop -m immediate >/dev/null 2>&1 || true
  fi
fi
rm -rf "$DIR"; mkdir -p "$DIR"

# Postgres weigert sich, als root zu laufen — in der CI und im Container sind
# wir das aber. Deshalb gehört das Verzeichnis dem postgres-Benutzer.
if [ "$(id -u)" = "0" ] && id postgres >/dev/null 2>&1; then
  chown -R postgres:postgres "$DIR"
  RUN="su postgres -c"
else
  RUN="bash -c"
fi

$RUN "PATH=$PATH initdb -D $DIR/data -U postgres --auth=trust -E UTF8" >/dev/null
$RUN "PATH=$PATH pg_ctl -D $DIR/data -o '-p $PORT -k $DIR -c listen_addresses=127.0.0.1' -l $DIR/log start" >/dev/null
sleep 2

# Wirklich erreichbar? Ein "gestartet" ohne Verbindung hilft niemandem.
for i in $(seq 1 20); do
  if psql "postgresql://postgres@127.0.0.1:$PORT/postgres" -c "select 1" >/dev/null 2>&1; then break; fi
  sleep 0.5
done

echo "postgresql://postgres@127.0.0.1:$PORT/postgres"
