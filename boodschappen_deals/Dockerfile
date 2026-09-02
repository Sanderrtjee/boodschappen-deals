# Deze build heeft geen netwerk nodig, alleen twee image-pulls.
#
# Waarom dat uitmaakt: op een Home Assistant OS-machine kon de buildcontainer
# geen namen opzoeken. `apk add nodejs npm` faalde drie keer op rij met
# "temporary error (try again later)", elke keer na precies vijf seconden, terwijl
# het ophalen van de images zelf vlekkeloos ging. Dat is een DNS-timeout binnen de
# build, niet een wegvallende pakketserver. Een build die tijdens RUN nog iets
# moet downloaden, is daar dus onbetrouwbaar.
#
# Daarom:
#   - Node komt als binary uit een officieel Node-image (eerste stage).
#   - `pg` staat als node_modules in de repo, dus geen npm install.
#
# De eerste stage staat bewust op alpine3.21, dezelfde Alpine-versie als het
# Home Assistant basisimage. Gecontroleerd in de registry: dat basisimage bevat
# al lib/ld-musl-x86_64.so.1, usr/lib/libgcc_s.so.1 en usr/lib/libstdc++.so.6,
# precies wat de Node-binary nodig heeft.
FROM node:22.20-alpine3.21 AS nodebin

# BUILD_FROM wordt door de Supervisor gevuld uit build.yaml. Let op: hij
# accepteert alleen images uit zijn eigen namespace en valt bij iets anders stil
# terug op ghcr.io/home-assistant/base:latest, waar geen Node in zit.
ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:3.21
FROM ${BUILD_FROM}

COPY --from=nodebin /usr/local/bin/node /usr/local/bin/node

WORKDIR /app
COPY app/ ./

COPY run.sh /run.sh
RUN chmod a+x /run.sh

# Controle tijdens de build: draait Node en is pg te laden? Faalt dit, dan
# faalt de build hier met een duidelijke melding in plaats van pas bij het
# starten van de add-on.
RUN node --version && node -e "require('pg'); console.log('pg ' + require('pg/package.json').version + ' ok')"

ENV NODE_ENV=production \
    PORT=8499 \
    DATA_DIR=/data

EXPOSE 8499

# Het basisimage heeft ENTRYPOINT ["/init"] (s6-overlay), dus de app wordt via
# run.sh gestart. Een kale CMD zou onder s6 anders behandeld worden.
CMD [ "/run.sh" ]
