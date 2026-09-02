# Basis is een officieel Node-image, geen Home Assistant basisimage.
#
# Waarom: op een HA-basisimage moet Node met `apk add nodejs npm` erbij, en die
# download naar dl-cdn.alpinelinux.org faalde tijdens het bouwen. Bovendien zit
# in Alpine 3.19 (end-of-life) Node 20 in plaats van 22. Met dit image is er
# geen pakketindex meer nodig en staat de Node-versie vast.
#
# Home Assistant vult BUILD_FROM uit build.yaml; docker compose geeft hem mee
# als build-arg. Zo bouwen beide met precies hetzelfde recept.
ARG BUILD_FROM=node:22-alpine
FROM ${BUILD_FROM}

WORKDIR /app

# Eerst alleen de manifest, zodat een wijziging in de code de npm-laag niet
# ongeldig maakt. `pg` is de enige dependency.
COPY app/package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY app/ ./

# Blijft als root draaien: /data wordt door de Supervisor als root aangemaakt,
# en een andere gebruiker kan daar dan niet in schrijven.
ENV NODE_ENV=production \
    PORT=8499 \
    DATA_DIR=/data

EXPOSE 8499

HEALTHCHECK --interval=60s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:8499/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# De add-on-instellingen worden in Node zelf uit /data/options.json gelezen,
# dus er is geen shellwrapper met bashio nodig.
CMD [ "node", "server.js" ]
