#!/usr/bin/with-contenv bashio
# shellcheck shell=bash
set -e

export PORT=8499
export DATA_DIR=/data
export NODE_ENV=production

export DB_HOST="$(bashio::config 'db_host')"
export DB_PORT="$(bashio::config 'db_port')"
export DB_NAME="$(bashio::config 'db_name')"
export DB_USER="$(bashio::config 'db_user')"
export DB_PASSWORD="$(bashio::config 'db_password')"
export SITE_TITEL="$(bashio::config 'site_titel')"
export CACHE_MINUTEN="$(bashio::config 'cache_minuten')"

if bashio::config.true 'db_ssl'; then
  export DB_SSL=true
else
  export DB_SSL=false
fi

if bashio::config.has_value 'import_token'; then
  export IMPORT_TOKEN="$(bashio::config 'import_token')"
else
  export IMPORT_TOKEN=""
fi

if ! bashio::config.has_value 'db_password'; then
  bashio::log.warning "Er is geen databasewachtwoord ingevuld. Zonder werkende verbinding toont de site demodata."
fi

bashio::log.info "Boodschappen Deals start op poort ${PORT}"
cd /app
exec node server.js
