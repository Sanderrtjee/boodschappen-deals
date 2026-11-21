'use strict';

const crypto = require('node:crypto');

// Het adres waarvandaan de Supervisor ingress-verzoeken doorstuurt. Dat is
// een vast adres in elke Home Assistant-installatie (zie de ontwikkeldocs
// over ingress). Alleen van dat adres accepteren we het ingress-prefix.
const INGRESS_IP = '172.30.32.2';

function kaalAdres(adres) {
  return String(adres || '').replace(/^::ffff:/, '');
}

// Het adres van de bezoeker. cf-connecting-ip is een header die iedereen kan
// meesturen; poort 8499 staat ook direct open op het LAN. Die header geloven
// we dus alleen van een afzender die als vertrouwde proxy is ingesteld.
function bezoekerAdres(req, vertrouwdeProxies) {
  const direct = kaalAdres(req.socket && req.socket.remoteAddress);
  const cf = String(req.headers['cf-connecting-ip'] || '').trim();
  if (cf && vertrouwdeProxies.includes(direct)) return cf;
  return direct;
}

// Kwam het verzoek via Cloudflare binnen? Cloudflare zet deze header altijd.
// Een LAN-client kan hem ook zelf meesturen, maar dan sluit hij alleen
// zichzelf buiten, dus daar hoeft geen vertrouwen achter te zitten.
function viaCloudflare(req) {
  return Boolean(req.headers['cf-connecting-ip'] || req.headers['cf-ray']);
}

function viaIngress(req, ingressIp) {
  return kaalAdres(req.socket && req.socket.remoteAddress) === (ingressIp || INGRESS_IP);
}

// Constante tijd. Beide kanten eerst hashen: timingSafeEqual eist even lange
// buffers, en zo lekt ook de lengte van het token niet via de looptijd.
function tokenGelijk(gegeven, verwacht) {
  if (!gegeven || !verwacht) return false;
  const a = crypto.createHash('sha256').update(String(gegeven)).digest();
  const b = crypto.createHash('sha256').update(String(verwacht)).digest();
  return crypto.timingSafeEqual(a, b);
}

// Telt mislukte tokenpogingen per adres in een vast venster. Na `max` fouten
// geeft een fout token een 429 tot het venster om is.
class Pogingenteller {
  constructor({ max = 5, vensterMs = 15 * 60000, nu = () => Date.now() } = {}) {
    this.max = max;
    this.vensterMs = vensterMs;
    this.nu = nu;
    this.adressen = new Map();
  }

  stand(adres) {
    const s = this.adressen.get(adres);
    if (s && this.nu() >= s.tot) {
      this.adressen.delete(adres);
      return null;
    }
    return s || null;
  }

  geblokkeerd(adres) {
    const s = this.stand(adres);
    return Boolean(s && s.fouten >= this.max);
  }

  wachtSeconden(adres) {
    const s = this.stand(adres);
    return s ? Math.max(1, Math.ceil((s.tot - this.nu()) / 1000)) : 0;
  }

  fout(adres) {
    const s = this.stand(adres) || { fouten: 0, tot: this.nu() + this.vensterMs };
    s.fouten += 1;
    this.adressen.set(adres, s);
    // Geheugen begrenzen: een scan vanaf veel adressen mag de add-on niet opblazen.
    if (this.adressen.size > 5000) {
      for (const [k, v] of this.adressen) if (this.nu() >= v.tot) this.adressen.delete(k);
      if (this.adressen.size > 5000) this.adressen.delete(this.adressen.keys().next().value);
    }
    return s.fouten;
  }
}

// Strak beleid: alles van de eigen origin, plaatjes van de CDN's van de
// winkels (https), geen inline scripts. frame-ancestors 'self' werkt ook in
// Home Assistant: de ingress-iframe draait op dezelfde origin als HA zelf.
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' https: data:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'"
].join('; ');

function zetBeveiligingsHeaders(res, { https }) {
  res.setHeader('content-security-policy', CSP);
  res.setHeader('x-frame-options', 'SAMEORIGIN');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('cross-origin-opener-policy', 'same-origin');
  // HSTS alleen op het publieke domein achter Cloudflare. Via ingress zou het
  // de HTTPS-regel van de Home Assistant-host zelf gaan bepalen.
  if (https) res.setHeader('strict-transport-security', 'max-age=31536000');
}

module.exports = {
  INGRESS_IP,
  bezoekerAdres,
  viaCloudflare,
  viaIngress,
  tokenGelijk,
  Pogingenteller,
  zetBeveiligingsHeaders,
  CSP
};
