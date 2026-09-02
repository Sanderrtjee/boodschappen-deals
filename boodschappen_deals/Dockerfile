# Basis is het Home Assistant basisimage. Dat is geen willekeurige keuze:
# de Supervisor accepteert alleen images uit zijn eigen namespace en valt bij
# iets anders (bijvoorbeeld node:22-alpine) stil terug op
# ghcr.io/home-assistant/base:latest, waar geen Node in zit.
#
# build.yaml zet dit op Alpine 3.21, want daar zit nodejs 22 in. Alpine 3.19,
# waar dit eerst op stond, is end-of-life en levert nog Node 20.
ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:3.21
FROM ${BUILD_FROM}

# De pakketindex ophalen faalde een keer met "temporary error (try again
# later)", dus twee herkansingen. Kost niets als het meteen lukt.
RUN apk add --no-cache nodejs npm \
 || (sleep 5 && apk add --no-cache nodejs npm) \
 || (sleep 20 && apk add --no-cache nodejs npm)

WORKDIR /app

# Eerst alleen de manifest, zodat een wijziging in de code de npm-laag niet
# ongeldig maakt. `pg` is de enige dependency.
COPY app/package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY app/ ./

COPY run.sh /run.sh
RUN chmod a+x /run.sh

ENV NODE_ENV=production \
    PORT=8499 \
    DATA_DIR=/data

EXPOSE 8499

# Het basisimage heeft ENTRYPOINT ["/init"] (s6-overlay), dus de app wordt via
# run.sh gestart. Een kale CMD zou onder s6 anders behandeld worden.
CMD [ "/run.sh" ]
