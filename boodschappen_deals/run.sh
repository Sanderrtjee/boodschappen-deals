#!/usr/bin/with-contenv bashio
# shellcheck shell=bash
#
# Start de app. De instellingen worden niet hier uitgelezen maar in Node zelf,
# uit /data/options.json (zie app/lib/config.js). Dat scheelt het doorgeven van
# negen omgevingsvariabelen en werkt ook als de container los draait.
set -e

if ! bashio::config.has_value 'db_host'; then
  bashio::log.warning "Geen databasehost ingevuld. De site start, maar toont demodata."
fi

bashio::log.info "Boodschappen Deals start op poort ${PORT:-8499}"

cd /app
exec node server.js
