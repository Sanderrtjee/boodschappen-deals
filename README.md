# Boodschappen Deals

Een zelf gehoste website die de weekaanbiedingen van Albert Heijn, Jumbo en Lidl
op één plek zet en rangschikt op het profiel van de bezoeker. Iedereen die de
link opent kiest zelf zijn winkels, dieet en huishoudgrootte, en ziet daar een
eigen top van aanbiedingen bij. Alles in het Nederlands.

De site is de leeskant van de n8n-flow die je al hebt: die flow scrapet de
supermarkten en schrijft naar Postgres, de site leest uit diezelfde database.
Er zit geen tweede scraper in, en geen tweede waarheid.

```
  n8n (dagelijks)                Postgres                  deze add-on
  ┌──────────────┐        ┌──────────────────┐        ┌──────────────────┐
  │ AH  GraphQL  │        │ products         │        │ leest, verrijkt  │
  │ Jumbo HTML   │ ─────► │ offers           │ ─────► │ scoort per       │
  │ Lidl  HTML   │  INSERT│ (1 rij per dag   │  SELECT│ profiel, filtert │
  └──────────────┘        │  per product)    │        │ en toont         │
                          └──────────────────┘        └────────┬─────────┘
                                                               │
                                              Cloudflare tunnel│
                                                               ▼
                                                    boodschappen.jouwdomein.nl
```

## Wat de site doet met de ruwe data

De database bevat productnamen, prijzen en actielabels, geen voedingswaarden.
De site leidt daaruit af wat er wél uit te halen valt en is expliciet over de
grenzen daarvan:

- **Effectieve stuksprijs.** Bij "2 voor 6,99" en "1+1 gratis" rekent de site
  terug naar de prijs per stuk, zodat een bundelactie eerlijk vergelijkbaar is
  met een gewone afprijzing.
- **Kilo- en literprijs.** De eenheid (`500 g`, `2 x 200 g`, `6 x 33 cl`) wordt
  ontleed, zodat een grote zak niet automatisch als voordeliger telt. AH vult
  `eenheid` meestal niet en zet de maat in de naam ("zak 500 gram"), dus als de
  kolom leeg is wordt de naam gelezen.
- **Het actielabel als extra bron.** Een deel van de acties komt binnen als
  `deal_type = 'overig'` zonder kortingsfactor, terwijl in het label staat wat
  de korting is. "2e gratis" is in werkelijkheid 50 procent en "3e gratis" 33
  procent; zonder die stap zouden dat aanbiedingen "zonder korting" zijn. Labels
  waar geen betrouwbare korting uit te halen is, zoals "€1 korting" zonder
  prijzen, krijgen er ook geen: die tonen alleen het label.
- **Kortingsdiepte.** Uit `kortingsfactor` of uit het verschil tussen `prijs_was`
  en `prijs_nu`. Lidl vergelijkt met "elders", dus dat is geen eigen eerdere
  prijs; die korting weegt maar voor 60 procent mee in de ranking en wordt op de
  kaart als "goedkoper dan elders" benoemd in plaats van als korting.
- **Producttype.** Een woordenboek in `lib/classify.js` bepaalt of iets vlees,
  vis, zuivel, plantaardig eiwit, groente, gemak, snoep, alcohol of non-food is.
  Dit is een schatting op basis van de naam en de winkelcategorie, niet op basis
  van de ingrediëntenlijst. De dieetfilters staan er met die waarschuwing bij.
- **Geen verzonnen voedingswaarden.** Er staat nergens een aantal gram eiwit,
  want dat weten we niet. Producten krijgen het label "eiwitrijk" op basis van
  productgroep, en dat is precies wat de site claimt.

Ranking gebeurt met wegingen per profiel in `lib/score.js`. Elk profiel telt op
tot 1, dus scores zijn tussen profielen vergelijkbaar. De acht profielen
(Beste deals, Eiwitrijk, Gezond, Budget, Gezin, Snel klaar, Plantaardig, Borrel)
pas je daar aan of vul je aan; de site pikt nieuwe profielen automatisch op in de
keuzebalk.

## Twee soorten profielen

De site kent twee bronnen voor "wat is relevant", en die vullen elkaar aan.

**Regelprofielen** rekent de site zelf uit met de wegingen in `lib/score.js`.
Ze werken altijd, op de volledige dataset, ook als Gemini eruit ligt of je quota
op is. Nadeel: het zijn regels, dus ze snappen niet dat een specifieke
XXL-verpakking zalm een buitenkans is.

**Assistent-selecties** zijn jouw Gemini-curatie: acht tot twaalf gekozen deals
met een reden per product, precies zoals in je weekbrief. Die staan vooraan in de
profielkiezer, met een `Assistent`-label, en zijn het startpunt voor iemand die
de site voor het eerst opent. Je stuurt ze in met een HTTP-node in n8n; zie
[n8n/SELECTIES.md](n8n/SELECTIES.md), waar ook de tweede tak voor borrel en
weekend staat.

Belangrijk detail: je stuurt alleen de **keuze en de onderbouwing** in, geen
prijzen. De site zoekt de producten er zelf bij uit de database. Daardoor staat
er nooit een prijs van vorige week naast een prijs van deze week, en zie je in
plaats daarvan hoeveel van de gekozen deals nog actueel zijn. Is de hele selectie
verlopen, dan zegt de pagina dat en verwijst hij naar de regelprofielen.

## Hoe komt de data er elke week automatisch op?

Er is geen extra tabel en geen koppeling nodig. De keten is:

1. n8n scrapet en schrijft naar `products` en `offers`. Per product één rij per
   dag, want `offers` heeft een unieke sleutel op `(product_id, scrape_datum)`.
2. De site vraagt **per winkel de hoogste `scrape_datum`** op en toont de rijen
   van die datum. Faalt Jumbo op een dag, dan zie je daar de vorige run in
   plaats van een half lege pagina.
3. Het resultaat blijft `cache_minuten` in het geheugen staan (standaard 15).
   Daarna leest de site opnieuw. Er draait dus niets op een eigen schema in de
   add-on; de scrapemomenten van n8n bepalen het ritme.

Wil je een nieuwe scrape meteen zichtbaar hebben in plaats van na een kwartier,
zet dan achter je flow een `POST` naar `/api/verversen` met het importtoken.
Dat is een gemak, geen noodzaak.

**Een tussentabel zou dit slechter maken.** Dan heb je twee kopieën van dezelfde
aanbiedingen die uit elkaar kunnen lopen, en een extra stap die stil kan falen.
Het enige dat een aparte tabel oplevert is dat de site blijft werken als de
database wegvalt, en dan werkt de site toch al niet.

Wat de site *wel* zelf in de gaten houdt: of de data nog vers is. Staat n8n
langer dan acht dagen stil, dan komt er een balk boven de pagina met welke
winkel hoe oud is. Oude aanbiedingen die als actueel worden gepresenteerd zijn
namelijk erger dan geen aanbiedingen.

## Installeren als Home Assistant add-on

Home Assistant OS draait geen losse Docker-containers, dus het moet als add-on.
Er zijn twee routes naar dezelfde uitkomst.

### Route A: repo klonen op de Home Assistant zelf (aanbevolen)

Werkt ook als jouw Home Assistant geen add-on repositories via een URL kan
ophalen. Je hebt de **Advanced SSH & Web Terminal**-add-on nodig, met
*Protection mode* uit, zodat `/addons` schrijfbaar is.

1. **Push deze map naar een publieke GitHub-repo:**

   ```bash
   git remote add origin https://github.com/<jouw-gebruiker>/boodschappen-deals.git
   git push -u origin main
   ```

   Er staan geen geheimen in: het databasewachtwoord en het importtoken vul je in
   de add-on-configuratie in, niet in de code.

2. **Haal hem op in de SSH-terminal van Home Assistant.** Dit commando is
   veilig om te herhalen, dus je gebruikt hem ook voor updates:

   ```bash
   rm -rf /tmp/bd && git clone --depth 1 https://github.com/<jouw-gebruiker>/boodschappen-deals.git /tmp/bd && rm -rf /addons/boodschappen_deals && cp -r /tmp/bd/boodschappen_deals /addons/boodschappen_deals && rm -rf /tmp/bd && ha addons reload
   ```

   > **Let op de volgorde en op `rm -rf /addons/boodschappen_deals`.** Zonder dat
   > laatste maakt `cp -r` bij de tweede keer een nestmap
   > `/addons/boodschappen_deals/boodschappen_deals` en blijft de oude versie
   > staan: het commando lijkt te slagen maar werkt niets bij. De oude map wordt
   > pas verwijderd nadat de `git clone` gelukt is, zodat een mislukte clone je
   > niet met een half verwijderde add-on achterlaat.

3. **Installeren.** De add-on staat nu onder *Local add-ons* in de Add-on store.
   De eerste build duurt een paar minuten: Home Assistant bouwt het image op je
   eigen machine en haalt daarvoor het Node-image en `pg` op.

**Een update uitrollen** is het commando uit stap 2 opnieuw, plus:

- **`version` omhoog in `boodschappen_deals/config.yaml`** voordat je pusht.
  Anders ziet Home Assistant geen nieuwe versie.
- Daarna in de add-on: *Update*, of bij een gelijk versienummer het
  drie-puntjesmenu → *Rebuild*. Alleen bestanden vervangen is niet genoeg, want
  de container moet opnieuw gebouwd worden.

### Route B: als add-on repository via een URL

Kan je Home Assistant wél repositories per URL ophalen, dan is het korter. Deze
repo heeft daarvoor de juiste vorm: `repository.yaml` in de root en de add-on in
de submap `boodschappen_deals/`.

Instellingen → Add-ons → Add-on store → menu rechtsboven → *Repositories* → plak
de URL van je repo. Updates gaan dan via de gewone updateknop, mits je `version`
in `config.yaml` omhoog zet.
4. **Configureren** (tab Configuratie):

   | Optie | Betekenis |
   | --- | --- |
   | `db_host` | Host van je Postgres. Neem het adres over uit je bestaande n8n-credential, tenzij daar `localhost` staat; zie [KOPPELEN.md](KOPPELEN.md). |
   | `db_port` | Meestal `5432`. |
   | `db_name` | De database waar de n8n-flow in schrijft. |
   | `db_user` / `db_password` | Een **alleen-lezen** gebruiker met rechten op precies `products` en `offers`, zie de waarschuwing hieronder. |
   | `db_ssl` | Aan als je database SSL vereist (managed hosting). |
   | `site_titel` | Wat er in de kop en de browsertab staat. |
   | `cache_minuten` | Hoe lang de dataset in het geheugen blijft. 15 is prima. |
   | `import_token` | Zelf te verzinnen lang geheim. Nodig zodra je de selecties van de assistent (of losse recepten) uit n8n wilt insturen. Leeg laten schakelt die endpoints uit. |

   > **Let op de precieze databaserechten.** In deze database staan naast
   > `products` en `offers` ook alle Nextcloud-tabellen (`oc_users`,
   > `oc_webauthn`, `oc_twofactor_*`). Geef de website daarom een gebruiker met
   > `SELECT` op precies die twee tabellen, en gebruik géén
   > `GRANT SELECT ON ALL TABLES` of `ALTER DEFAULT PRIVILEGES`, want dan kan de
   > site ook je Nextcloud-gegevens lezen. De juiste regels staan in
   > [sql/schema.sql](sql/schema.sql), met een query om achteraf te controleren
   > dat die gebruiker niet verder komt dan bedoeld.

5. **Starten.** Zet *Start bij opstarten* en *Watchdog* aan. Onder
   *Log* zie je of de database gevonden is.
6. **Openen.** Via *In zijbalk weergeven* zit de site in het HA-menu (ingress).
   Daarnaast is hij bereikbaar op `http://<ip-van-home-assistant>:8499`, en dat
   is de ingang die je door de tunnel stuurt.

Ziet de site er meteen goed uit maar staat er een gele balk *Demodata*? Dan
draait de container wel, maar is de database niet bereikbaar of nog leeg. De
melding in de balk en het add-on-log zeggen welke van de twee.

### Over het basisimage

De add-on bouwt op `ghcr.io/home-assistant/{arch}-base:3.21`. Twee dingen daar
zijn de moeite om te weten, want ik ben er allebei tegenaan gelopen:

- **De Supervisor accepteert alleen images uit zijn eigen namespace.** Zet je
  `build_from` op bijvoorbeeld `node:22-alpine`, dan negeert hij dat en bouwt
  hij stil op `ghcr.io/home-assistant/base:latest`. Daar zit geen Node in, dus
  het faalt op `npm: not found` en de foutmelding wijst niet naar de oorzaak.
  Kijk in dat geval in het buildlog naar de regel `load metadata for ...`: daar
  staat welk image echt gebruikt wordt.
- **Alpine 3.21, niet 3.19.** In 3.21 zit `nodejs 22`; 3.19 is end-of-life en
  levert Node 20. Het ophalen van de pakketindex faalde ook een keer met
  "temporary error", dus `apk add` heeft twee herkansingen gekregen.

Het basisimage heeft `ENTRYPOINT ["/init"]` (s6-overlay), dus de app start via
`run.sh` en niet via een kale `CMD`. Die `run.sh` doet weinig: de
add-on-instellingen worden in Node zelf uit `/data/options.json` gelezen (zie
`lib/config.js`), zodat er geen negen omgevingsvariabelen doorgegeven hoeven te
worden. Draai je los met compose, dan bestaat dat bestand niet en komt alles uit
omgevingsvariabelen; het log zegt welke van de twee gebruikt is.

Buiten Home Assistant zijn s6 en bashio overbodig, dus compose gebruikt
`Dockerfile.standalone` op een kaal Node-image. De applicatiecode is identiek.

## Door een Cloudflare-tunnel op je eigen domein

Uitgaande van de **Cloudflared**-add-on (`brenner-tobias/addon_cloudflared`),
die je waarschijnlijk al gebruikt voor Home Assistant zelf. Voeg in de
configuratie van díe add-on een extra host toe:

```yaml
additional_hosts:
  - hostname: boodschappen.jouwdomein.nl
    service: http://192.168.1.10:8499
```

Vul bij `service` het vaste LAN-IP van je Home Assistant in. Herstart de
Cloudflared-add-on; die maakt de DNS-record in Cloudflare zelf aan.

Gebruik je een eigen `cloudflared` buiten Home Assistant, dan is het in
`config.yml` hetzelfde idee:

```yaml
ingress:
  - hostname: boodschappen.jouwdomein.nl
    service: http://192.168.1.10:8499
  - service: http_status:404
```

**Bedenk wel wat je publiceert.** De site heeft geen inlog: wie de URL heeft,
ziet de aanbiedingen. Dat is publieke supermarktinformatie, dus meestal niet
erg. Wil je het toch beperken tot je vrienden, zet er dan Cloudflare Access
(Zero Trust → Access → Applications) voor met een lijst e-mailadressen; ze
krijgen dan een inlogcode per mail. De schrijvende endpoints
(`/api/import/recepten` en `/api/verversen`) zitten los daarvan al achter het
`import_token`.

## Zonder Home Assistant, met docker compose

```bash
cd boodschappen-deals
printf 'DB_HOST=192.168.1.20\nDB_PASSWORD=geheim\n' > .env
docker compose up -d --build
```

De site staat dan op poort 8499. Configuratie loopt via de omgevingsvariabelen
in `docker-compose.yml`.

## n8n en de add-on aan elkaar knopen

Er zijn twee koppelingen en ze lopen in tegengestelde richting: voor de
**aanbiedingen** koppel je niets (n8n schrijft naar Postgres, de add-on leest
daaruit), voor de **selecties van de assistent** stuurt n8n een POST naar de
add-on. Welke adressen waar horen, welk token waar staat en hoe je per stap
controleert of het werkt: [KOPPELEN.md](KOPPELEN.md).

## Wat je in n8n aanpast

Zie [`n8n/README.md`](n8n/README.md). Kort: zet de trigger op dagelijks, haal de
twee `Limit`-nodes weg zodat de volledige dataset in de database komt, en zet de
weekbrief-tak achter een IF op maandag. De site zelf heeft geen wijziging in de
flow nodig.

## Endpoints

| Endpoint | Wat het doet |
| --- | --- |
| `GET /api/health` | Statuscheck: draait de app, is de database verbonden, hoeveel aanbiedingen. Stuur je het importtoken mee, dan staan er ook de verbindingsgegevens en de ingestuurde selecties in. |
| `GET /api/meta` | Winkels met aantallen, categorieën, profielen, dieetopties, laatste scrapedatum. |
| `GET /api/deals` | De gefilterde en gescoorde lijst. Alle filters zijn queryparameters, zie hieronder. |
| `GET /api/recepten` | De laatst ingestuurde recepten (leeg als er niets is). |
| `POST /api/import/selectie` | Een door de assistent samengestelde selectie opslaan of overschrijven. Vereist `Authorization: Bearer <import_token>`. |
| `DELETE /api/import/selectie/<sleutel>` | Zo'n selectie weghalen. Zelfde token. |
| `POST /api/import/recepten` | Losse recepten opslaan. Zelfde token. |
| `POST /api/verversen` | Cache leeggooien en direct opnieuw uit de database lezen. Zelfde token. |

Parameters van `/api/deals`: `profiel`, `winkels`, `dieet`, `categorieen`
(komma's gescheiden), `huishouden` (1–5), `max_prijs`, `min_korting`,
`alleen_korting=1`, `nonfood=1`, `winkelbezoek=alles|online|winkel`, `q`,
`sort=score|korting|prijs|kiloprijs|winkel|naam`, `limit`, `offset`.

Diezelfde parameters staan ook in de URL van de site, dus de knop **Delen**
levert een link op die precies jouw filters terugzet. Handig om in een
vriendengroep te sturen: "voor de sportschoolmensen: deze link".

## Nieuwe winkel toevoegen

De site is niet aan drie winkels gebonden. Zodra je n8n-flow een vierde winkel
in `products.winkel` schrijft (Plus, Aldi, Dirk), verschijnt die automatisch als
filter, met het juiste aantal erbij. Wil je hem ook een eigen kleur geven, voeg
die dan toe in `public/app.js` bij `WINKELKLEUREN` en in `styles.css` bij de
`--plus` / `--aldi`-variabelen; voor Plus en Aldi staat dat er al in.

## Mappen

```
boodschappen-deals/
├── boodschappen_deals/        de add-on (dit is wat naar /addons/ gaat)
│   ├── config.yaml            add-on-opties en ingress
│   ├── build.yaml             basisimages per architectuur
│   ├── Dockerfile             build voor Home Assistant (HA-basisimage, s6)
│   ├── Dockerfile.standalone  build voor gewone docker (kaal Node-image)
│   ├── run.sh                 startscript van de add-on
│   └── app/
│       ├── server.js          HTTP-server en API
│       ├── lib/config.js      instellingen uit /data/options.json of env
│       ├── lib/db.js          de Postgres-query
│       ├── lib/classify.js    productwoordenboek
│       ├── lib/score.js       eenheden, labels, korting, profielwegingen
│       ├── lib/selecties.js   de door de assistent gekozen deals
│       ├── lib/demo.js        voorbeelddata als er geen database is
│       └── public/            de website zelf
├── KOPPELEN.md                de twee koppelingen met n8n, met controlestappen
├── sql/schema.sql             tabellen, indexen, leesgebruiker
├── n8n/README.md              wat je in de flow aanpast
├── n8n/SELECTIES.md           de twee Gemini-takken met prompts en nodes
└── docker-compose.yml         alleen voor draaien buiten Home Assistant
```

## Beperkingen, eerlijk opgeschreven

- **Geen echte voedingswaarden.** "Eiwitrijk" is een categorie-oordeel, geen
  meting. Wil je echte macro's, dan is een extra bron nodig (bijvoorbeeld de
  productdetail-API van AH per artikel); dat is een flinke uitbreiding van de
  scrape.
- **Dieetfilters zijn een schatting.** Ze werken op productnamen. Een pizza
  margherita wordt niet als zuivelhoudend herkend, want er staat geen kaas in de
  naam. Daarom staat de waarschuwing in de zijbalk.
- **Jumbo levert geen prijzen.** De HTML-scrape haalt daar alleen actielabels op
  ("1+1 gratis"). Die producten hebben dus geen stuksprijs en kunnen niet op
  prijs of kiloprijs gesorteerd worden; ze tonen het label in plaats van een
  bedrag.
- **De site is zo actueel als de laatste scrape.** Per winkel wordt de nieuwste
  scrapedatum gepakt, dus als Jumbo vandaag faalde zie je daar de data van
  gisteren in plaats van niets.
