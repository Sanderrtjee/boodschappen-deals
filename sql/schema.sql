-- Schema zoals de n8n-flow het gebruikt. Bestaat je database al, dan verandert
-- dit niets: alles staat als IF NOT EXISTS. Voer het uit met psql of pgAdmin.

CREATE TABLE IF NOT EXISTS products (
  product_id  bigserial PRIMARY KEY,
  winkel      text NOT NULL,
  externe_id  text NOT NULL,
  naam        text,
  categorie   text,
  eenheid     text,
  afbeelding  text,
  aangemaakt  timestamptz DEFAULT now(),
  CONSTRAINT products_winkel_externe_id_key UNIQUE (winkel, externe_id)
);

CREATE TABLE IF NOT EXISTS offers (
  offer_id         bigserial PRIMARY KEY,
  product_id       bigint NOT NULL REFERENCES products (product_id) ON DELETE CASCADE,
  scrape_datum     date NOT NULL DEFAULT CURRENT_DATE,
  geldig_van       date,
  geldig_tot       date,
  geldigheid_tekst text,
  label_tekst      text,
  deal_type        text,
  prijs_per_stuk   numeric(10, 2),
  prijs_nu         numeric(10, 2),
  prijs_was        numeric(10, 2),
  kortingsfactor   numeric(5, 4),
  alleen_in_winkel boolean DEFAULT false,
  uitzondering     text,
  link             text,
  aangemaakt       timestamptz DEFAULT now(),
  CONSTRAINT offers_product_datum_key UNIQUE (product_id, scrape_datum)
);

-- De website vraagt per winkel de laatste scrape op en filtert op geldigheid.
CREATE INDEX IF NOT EXISTS idx_offers_scrape_datum ON offers (scrape_datum DESC);
CREATE INDEX IF NOT EXISTS idx_offers_product ON offers (product_id);
CREATE INDEX IF NOT EXISTS idx_offers_geldig_tot ON offers (geldig_tot);
CREATE INDEX IF NOT EXISTS idx_products_winkel ON products (winkel);

-- ---------------------------------------------------------------------------
-- Losse leesgebruiker voor de website.
--
-- BELANGRIJK: in deze database staan ook je Nextcloud-tabellen (oc_users,
-- oc_twofactor_*, oc_webauthn en de rest). De website hoort daar niets van te
-- kunnen lezen. Geef daarom rechten op precies twee tabellen en gebruik géén
-- "GRANT SELECT ON ALL TABLES" of "ALTER DEFAULT PRIVILEGES", want dan krijgt
-- deze gebruiker ook toegang tot alles wat Nextcloud later nog aanmaakt.
--
-- Vul een eigen, lang wachtwoord in en zet dat in de add-on-configuratie.
-- ---------------------------------------------------------------------------

-- CREATE ROLE boodschappen_web LOGIN PASSWORD 'verzin-hier-iets-lang';
-- GRANT CONNECT ON DATABASE postgres TO boodschappen_web;
-- GRANT USAGE ON SCHEMA public TO boodschappen_web;
-- GRANT SELECT ON public.products, public.offers TO boodschappen_web;

-- Controleer daarna dat de gebruiker echt niet verder komt dan die twee
-- tabellen. Deze query hoort alleen products en offers terug te geven:
--
--   SELECT table_name
--   FROM information_schema.table_privileges
--   WHERE grantee = 'boodschappen_web';

-- ---------------------------------------------------------------------------
-- Opruimen: oude scrapes hebben na een paar maanden geen waarde meer.
-- Zet dit desgewenst als losse n8n-node op een maandelijkse planning.
-- ---------------------------------------------------------------------------

-- DELETE FROM offers WHERE scrape_datum < CURRENT_DATE - INTERVAL '120 days';
