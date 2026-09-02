ARG BUILD_FROM
FROM $BUILD_FROM

# nodejs en npm uit de Alpine-repo van de Home Assistant basisimage.
RUN apk add --no-cache nodejs npm

WORKDIR /app

# Eerst alleen de manifest, zodat een wijziging in de code de
# npm-install-laag niet ongeldig maakt.
COPY app/package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY app/ ./

COPY run.sh /run.sh
RUN chmod a+x /run.sh

ENV NODE_ENV=production
EXPOSE 8499

CMD [ "/run.sh" ]
