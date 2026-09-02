# Boodschappen Deals

Een zelf gehoste website die de weekaanbiedingen van Albert Heijn, Jumbo en Lidl
op één plek zet en rangschikt op het profiel van de bezoeker. Iedereen die de
link opent kiest zelf zijn winkels, dieet en huishoudgrootte, en ziet daar een
eigen top van aanbiedingen bij. Alles in het Nederlands.

De site is de **leeskant** van de n8n-flow die er al was: die flow scrapet de
supermarkten en schrijft naar Postgres, de site leest uit diezelfde database.
Er zit geen tweede scraper in, en geen tweede waarheid.

```
        n8n, dagelijks                Postgres                deze add-on
  ┌────────────────────────┐    ┌──────────────────┐    ┌────────────────────┐
  │ AH   GraphQL           │    │ products         │    │ leest, verrijkt,   │
  │ Jumbo HTML             │───►│ offers           │───►│ scoort per profiel │
  │ Lidl  HTML             │    │ 1 rij per dag    │    │ en filtert         │
  ├────────────────────────┤    │ per product      │    ├────────────────────┤
  │ Gemini kiest 8 tot 12  │    └──────────────────┘    │ assistent-selectie │
  │ deals met een reden    │──── POST /api/import ─────►│ als eigen profiel  │
  └────────────────────────┘                            └─────────┬──────────┘
                                                                  │
                                                 Cloudflare tunnel│
                                                                  ▼
                                                   boodschappen.jouwdomein.nl
```

Twee stromen dus, en dat onderscheid is de sleutel tot de rest van dit document:
de **aanbiedingen** lopen via de database (daar hoef je niets te koppelen), de
**selectie van de assistent** wordt door n8n actief ingestuurd.

## Inhoud

- [Wat de site met de ruwe data doet](#wat-de-site-met-de-ruwe-data-doet)
- [Twee soorten profielen](#twee-soorten-profielen)
- [Hoe de data er automatisch op komt](#hoe-de-data-er-automatisch-op-komt)
- [Installeren als Home Assistant add-on](#installeren-als-home-assistant-add-on)
- [Configuratie](#configuratie)
- [Bijwerken](#bijwerken)
- [Op je eigen domein via een Cloudflare-tunnel](#op-je-eigen-domein-via-een-cloudflare-tunnel)
- [n8n aan de add-on knopen](#n8n-aan-de-add-on-knopen)
- [Over het bouwen van het image](#over-het-bouwen-van-het-image)
- [Problemen oplossen](#problemen-oplossen)
- [Endpoints](#endpoints)
- [Zelf aanpassen](#zelf-aanpassen)
- [Lokaal draaien](#lokaal-draaien)
- [Mappen](#mappen)
- [Beperkingen, eerlijk opgeschreven](#beperkingen-eerlijk-opgeschreven)

## Wat de site met de ruwe data doet

De database bevat productnamen, prijzen en actielabels, geen voedingswaarden.
De site leidt daaruit af wat er wél uit te halen valt, en is expliciet over de
grenzen daarvan.

**Effectieve stuksprijs.** De drie scrapers vullen dezelfde kolommen met
verschillende betekenissen, dus die worden eerst op één noemer gebracht:

| `deal_type` | Wat `prijs_nu` en `prijs_was` betekenen | Wat de site doet |
| --- | --- | --- |
| `bundel` ("2 voor 6,99") | de hele bundel | vergelijkprijs delen door het aantal |
| `gratis_erbij` ("1+1"), `tweede_half` | de gewone schapprijs van één stuk | kortingsfactor er nog áf halen |
| `procent`, `vaste_prijs`, `elders`, `lidl_plus` | al de afgeprijsde stuksprijs | overnemen, factor niet nóg eens toepassen |

Zonder die stap zet je € 3,50 naast een doorgestreepte € 9,99, en dat klopt niet.
Het zit in `bepaalPrijzen` in `lib/score.js`.

**Kilo- en literprijs.** De eenheid (`500 g`, `2 x 200 g`, `6 x 33 cl`) wordt
ontleed, zodat een grote zak niet automatisch als voordeliger telt. AH vult
`eenheid` meestal niet en zet de maat in de naam ("zak 500 gram"), dus als de
kolom leeg is wordt de naam gelezen.

**Het actielabel als extra kortingsbron.** Een deel van de acties komt binnen als
`deal_type = 'overig'` zonder kortingsfactor, terwijl in het label staat wat de
korting is. "2e gratis" is in werkelijkheid 50 procent en "3e gratis" 33 procent;
zonder die stap zouden dat aanbiedingen "zonder korting" zijn. Labels waar geen
betrouwbare korting uit te halen is, zoals "€1 korting" zonder prijzen, krijgen
er ook geen: die tonen alleen het label.

**Kortingsdiepte.** Uit `kortingsfactor`, uit het verschil tussen `prijs_was` en
`prijs_nu`, of uit het label. Lidl vergelijkt met "elders", en dat is geen eigen
eerdere prijs; die korting weegt maar voor 60 procent mee in de ranking en wordt
op de kaart als "goedkoper dan elders" benoemd in plaats van als korting.

**Producttype.** Een woordenboek in `lib/classify.js` bepaalt of iets vlees, vis,
zuivel, plantaardig eiwit, groente, gemak, snoep, alcohol of non-food is. Dat
gebeurt op de naam én op de winkelcategorie, want sommige producten verraden zich
alleen via die categorie: "Lay's Oven Baked paprika" bevat geen enkel snackwoord
maar staat onder "Borrel, chips, snacks". Smaakaanduidingen worden bewust
onderdrukt, anders is paprikachips "vers" en chocoladepasta "eiwitrijk".

**Geen verzonnen voedingswaarden.** Er staat nergens een aantal gram eiwit, want
dat weten we niet. Producten krijgen het label "eiwitrijk" op basis van
productgroep, en dat is precies wat de site claimt.

## Twee soorten profielen

De site kent twee bronnen voor "wat is relevant", en die vullen elkaar aan.

**Regelprofielen** rekent de site zelf uit met de wegingen in `lib/score.js`. Er
zijn acht profielen: Beste deals, Eiwitrijk en sportief, Gezond en vers, Zo
goedkoop mogelijk, Gezin en voorraad, Snel klaar, Plantaardig, en Borrel en
snacks. Elk profiel telt op tot 1, dus scores zijn tussen profielen
vergelijkbaar. Ze werken altijd, op de volledige dataset, ook als Gemini eruit
ligt of je quota op is. Nadeel: het zijn regels, dus ze snappen niet dat een
specifieke XXL-verpakking zalm een buitenkans is.

**Assistent-selecties** zijn de Gemini-curatie: acht tot twaalf gekozen deals met
een reden per product, precies zoals in de weekbrief. Die staan vooraan in de
profielkiezer met een `Assistent`-label, en zijn het startpunt voor iemand die de
site voor het eerst opent. Je stuurt ze in met een HTTP-node in n8n; zie
[n8n/SELECTIES.md](n8n/SELECTIES.md), waar ook de tweede tak voor borrel en
weekend staat.

Belangrijk detail: je stuurt alleen de **keuze en de onderbouwing** in, geen
prijzen. De site zoekt de producten er zelf bij uit de database. Daardoor staat er
nooit een prijs van vorige week naast een prijs van deze week, en zie je in plaats
daarvan hoeveel van de gekozen deals nog actueel zijn. Is de hele selectie
verlopen, dan zegt de pagina dat en verwijst hij naar de regelprofielen.

De gewone filters blijven binnen een selectie werken, zodat iemand zonder Lidl in
de buurt ook daar kan filteren.

## Hoe de data er automatisch op komt

Er is geen extra tabel en geen koppeling nodig voor de aanbiedingen. De keten is:

1. n8n scrapet en schrijft naar `products` en `offers`. Per product één rij per
   dag, want `offers` heeft een unieke sleutel op `(product_id, scrape_datum)`.
   Een herhaalde run op dezelfde dag overschrijft dus netjes.
2. De site vraagt **per winkel de hoogste `scrape_datum`** op en toont de rijen
   van die datum. Faalt Jumbo op een dag, dan zie je daar de vorige run in plaats
   van een half lege pagina.
3. Het resultaat blijft `cache_minuten` in het geheugen staan (standaard 15).
   Daarna leest de site opnieuw. Er draait niets op een eigen schema in de add-on;
   de scrapemomenten van n8n bepalen het ritme. Na een databasefout wordt het na
   een minuut opnieuw geprobeerd in plaats van na een kwartier.

Wil je een nieuwe scrape meteen zichtbaar hebben, zet dan achter je flow een
`POST` naar `/api/verversen` met het importtoken. Dat is een gemak, geen
noodzaak.

**Een tussentabel zou dit slechter maken.** Dan heb je twee kopieën van dezelfde
aanbiedingen die uit elkaar kunnen lopen, en een extra stap die stil kan falen.
Het enige dat een aparte tabel oplevert is dat de site blijft werken als de
database wegvalt, en dan werkt de site toch al niet.

**Wat de site wél zelf in de gaten houdt, is of de data nog vers is.** Staat n8n
langer dan acht dagen stil, dan komt er een balk boven de pagina met welke winkel
hoe oud is. Oude aanbiedingen die als actueel worden gepresenteerd zijn namelijk
erger dan geen aanbiedingen. Om dezelfde reden verschijnt demodata alléén als er
helemaal geen database is ingesteld: hapert een ingestelde database, dan toont de
site niets met uitleg in plaats van verzonnen aanbiedingen naast echte.

## Installeren als Home Assistant add-on

Home Assistant OS draait geen losse Docker-containers, dus het moet als add-on.
Twee routes naar dezelfde uitkomst; kies route A als je Home Assistant geen
add-on repositories via een URL kan ophalen.

### Route A: repo klonen op de Home Assistant zelf

Je hebt de **Advanced SSH & Web Terminal**-add-on nodig met *Protection mode*
uit, zodat `/addons` schrijfbaar is.

**Stap 1. Push deze map naar een publieke GitHub-repo.**

```bash
git remote add origin https://github.com/<jouw-gebruiker>/boodschappen-deals.git
git push -u origin main
```

De repo moet publiek zijn, want Home Assistant kloont zonder inloggen. Er staan
geen geheimen in: het databasewachtwoord en het importtoken vul je in de
add-on-configuratie in, niet in de code.

**Stap 2. Haal hem op in de SSH-terminal van Home Assistant.** Dit commando is
veilig om te herhalen, dus je gebruikt hem ook voor updates:

```bash
rm -rf /tmp/bd && git clone --depth 1 https://github.com/<jouw-gebruiker>/boodschappen-deals.git /tmp/bd && rm -rf /addons/boodschappen_deals && cp -r /tmp/bd/boodschappen_deals /addons/boodschappen_deals && rm -rf /tmp/bd && ha addons reload
```

> **Let op de `rm -rf /addons/boodschappen_deals` en op de volgorde.** Zonder dat
> eerste maakt `cp -r` bij de tweede keer een nestmap
> `/addons/boodschappen_deals/boodschappen_deals` en blijft de oude versie staan:
> het commando lijkt te slagen maar werkt niets bij. En de oude map wordt pas
> verwijderd nadat de `git clone` gelukt is, zodat een mislukte clone je niet met
> een half verwijderde add-on achterlaat.

**Stap 3. Installeren.** De add-on staat nu onder *Local add-ons* in de Add-on
store. De eerste build duurt een paar minuten; hij haalt daarvoor twee images op
en verder niets van het netwerk.

**Stap 4. Configureren.** Zie [Configuratie](#configuratie) hieronder.

**Stap 5. Starten.** Zet *Start bij opstarten* en *Watchdog* aan. In het **Log**
zie je of de database gevonden is:

```
info: Boodschappen Deals luistert op poort 8499
info: Instellingen gelezen uit add-on-configuratie
info: Database: boodschappen_web@192.168.1.20:5432/postgres
info: Dataset geladen: 689 aanbiedingen
```

**Stap 6. Openen.** Via *In zijbalk weergeven* zit de site in het HA-menu
(ingress). Daarnaast is hij bereikbaar op `http://<ip-van-home-assistant>:8499`,
en dat is de ingang die je door de tunnel stuurt.

### Route B: als add-on repository via een URL

Kan je Home Assistant wél repositories per URL ophalen, dan is het korter. Deze
repo heeft daarvoor de juiste vorm: `repository.yaml` in de root en de add-on in
de submap `boodschappen_deals/`.

Instellingen → Add-ons → Add-on store → menu rechtsboven → *Repositories* → plak
de URL van je repo. Daarna dezelfde stappen 3 tot 6.

## Configuratie

Op het tabblad **Configuratie** van de add-on.

| Optie | Betekenis |
| --- | --- |
| `db_host` | Host van je Postgres. Neem het adres over uit je bestaande n8n-credential, tenzij daar `localhost` staat; zie [KOPPELEN.md](KOPPELEN.md). |
| `db_port` | Meestal `5432`. |
| `db_name` | De database waar de n8n-flow in schrijft. |
| `db_user` / `db_password` | Een **alleen-lezen** gebruiker met rechten op precies `products` en `offers`. Zie de waarschuwing hieronder. |
| `db_ssl` | Aan als je database SSL vereist, bijvoorbeeld bij gehoste Postgres. |
| `site_titel` | Wat er in de kop en de browsertab staat. |
| `cache_minuten` | Hoe lang de dataset in het geheugen blijft (1–1440). 15 is prima. |
| `import_token` | Zelf te verzinnen lang geheim, bijvoorbeeld uit `openssl rand -hex 24`. Nodig zodra je selecties of recepten uit n8n wilt insturen. Leeg laten schakelt die endpoints uit. |

> **Let op de precieze databaserechten.** In deze database staan naast `products`
> en `offers` ook alle Nextcloud-tabellen (`oc_users`, `oc_webauthn`,
> `oc_twofactor_*`). Geef de website daarom een gebruiker met `SELECT` op precies
> die twee tabellen, en gebruik géén `GRANT SELECT ON ALL TABLES` of
> `ALTER DEFAULT PRIVILEGES`, want dan kan de site ook je Nextcloud-gegevens
> lezen. De juiste regels staan in [sql/schema.sql](sql/schema.sql), met een query
> om achteraf te controleren dat die gebruiker niet verder komt dan bedoeld.

**Poort al bezet?** De add-on publiceert `8499`. Verander die dan op het tabblad
Configuratie in het vak **Netwerk**: dat wijzigt alleen de poort aan de
buitenkant, de container blijft intern 8499 gebruiken en ingress blijft werken.
Je hoeft geen bestand aan te passen, maar wel je Cloudflare-tunnel en je
n8n-nodes bijwerken.

## Bijwerken

1. Zet **`version` omhoog in `boodschappen_deals/config.yaml`** en push. Zonder
   die bump ziet Home Assistant geen nieuwe versie en blijft de oude draaien.
2. Voer het commando uit stap 2 van route A opnieuw uit.
3. In de add-on: *Update*, of bij een gelijk versienummer het drie-puntjesmenu →
   *Rebuild*. Alleen bestanden vervangen is niet genoeg; de container moet
   opnieuw gebouwd worden.

## Op je eigen domein via een Cloudflare-tunnel

Uitgaande van de **Cloudflared**-add-on (`brenner-tobias/addon_cloudflared`).
Voeg in de configuratie van díe add-on een extra host toe:

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

**Bedenk wat je publiceert.** De site heeft geen inlog: wie de URL heeft, ziet de
aanbiedingen. Dat is publieke supermarktinformatie, dus meestal niet erg. Wil je
het beperken tot je vrienden, zet er dan Cloudflare Access voor (Zero Trust →
Access → Applications) met een lijst e-mailadressen; ze krijgen dan een inlogcode
per mail. De schrijvende endpoints zitten los daarvan al achter het
`import_token`.

## n8n aan de add-on knopen

Er zijn twee koppelingen en ze lopen in tegengestelde richting. Welke adressen
waar horen, welk token waar staat en hoe je per stap controleert of het werkt:
**[KOPPELEN.md](KOPPELEN.md)**.

Wat je in de flow zelf aanpast staat in **[n8n/README.md](n8n/README.md)**: de
trigger op dagelijks, de twee `Limit`-nodes eruit zodat de volledige dataset in
de database komt, en de weekbrief achter een IF op maandag. Daar staat ook een
kant-en-klare workflow om te importeren, plus het script waarmee die gemaakt is.

De Gemini-takken die de selecties opleveren staan in
**[n8n/SELECTIES.md](n8n/SELECTIES.md)**, inclusief de prompts en de SQL voor de
borreltak.

## Over het bouwen van het image

Deze build heeft **geen netwerk nodig tijdens de bouwstappen**, alleen twee
image-pulls. Dat is geen luxe maar noodzaak, en het kostte drie mislukte builds om
erachter te komen:

1. **`apk add nodejs npm` faalde** op `dl-cdn.alpinelinux.org` met "temporary
   error (try again later)", drie keer op rij en elke keer na precies vijf
   seconden, terwijl het ophalen van de images zelf vlekkeloos ging. Dat is een
   DNS-timeout binnen de buildcontainer, geen wegvallende pakketserver. Zie
   [Problemen oplossen](#problemen-oplossen).
2. **Uitwijken naar `node:22-alpine` als basis werkte niet.** De Supervisor
   accepteert in `build_from` alleen images uit zijn eigen namespace en valt bij
   iets anders stil terug op `ghcr.io/home-assistant/base:latest`, waar geen Node
   in zit. Je krijgt dan `npm: not found` zonder aanwijzing waarom.
3. **Alpine 3.19 was end-of-life** en levert Node 20. Het is nu 3.21, met Node 22.

Daarom nu:

- **Node komt als binary uit `node:22.20-alpine3.21`**, in een eerste
  build-stage. Die Alpine-versie is dezelfde als die van het basisimage. In de
  registry gecontroleerd dat `ghcr.io/home-assistant/amd64-base:3.21` al
  `ld-musl-x86_64.so.1`, `libgcc_s.so.1` en `libstdc++.so.6` bevat, precies wat
  die binary nodig heeft.
- **`pg` staat als `node_modules` in de repo** (14 pakketten, 789 kB), dus geen
  `npm install` tijdens het bouwen.
- De Dockerfile draait aan het eind `node -e "require('pg')"`, zodat een probleem
  hiermee tijdens de bouw opvalt en niet pas als de add-on start. In het log zie
  je dan `pg 8.23.0 ok`.
- De twee `ARG`-regels staan **vóór de eerste `FROM`**. Een ARG ná een FROM hoort
  bij díe stage en is niet zichtbaar in een volgende FROM-regel; dan zou
  `${BUILD_FROM}` leeg zijn.

Wil je `pg` bijwerken:

```bash
cd boodschappen_deals/app && npm install pg@latest --omit=dev
```

en commit de gewijzigde `node_modules` en `package-lock.json` mee.

Het basisimage heeft `ENTRYPOINT ["/init"]` (s6-overlay), dus de app start via
`run.sh` en niet via een kale `CMD`. Die `run.sh` doet weinig: de
add-on-instellingen worden in Node zelf uit `/data/options.json` gelezen (zie
`lib/config.js`), zodat er geen negen omgevingsvariabelen doorgegeven hoeven te
worden. Draai je los met compose, dan bestaat dat bestand niet en komt alles uit
omgevingsvariabelen; het log zegt welke van de twee gebruikt is.

Buiten Home Assistant zijn s6 en bashio overbodig, dus compose gebruikt
`Dockerfile.standalone` op een kaal Node-image. De applicatiecode is identiek.

## Problemen oplossen

| Symptoom | Oorzaak en oplossing |
| --- | --- |
| Gele balk **Demodata** | `db_host` is leeg. Vul de databasegegevens in. |
| Balk **De database is niet bereikbaar**, `ETIMEDOUT` | Verkeerd IP, of Postgres publiceert die poort niet. |
| `ECONNREFUSED` | Adres klopt, maar er luistert niets op die poort. |
| `password authentication failed` | Gebruiker of wachtwoord fout, of `pg_hba.conf` laat dat IP niet toe. |
| `permission denied for table products` | De leesgebruiker heeft geen `SELECT`. Zie [sql/schema.sql](sql/schema.sql). |
| Balk **deze aanbiedingen zijn niet vers** | De laatste scrape is ouder dan acht dagen. Kijk of de n8n-flow nog loopt. |
| Site werkt, maar geen assistent-profielen | De koppeling vanuit n8n ontbreekt of het token klopt niet. Zie [KOPPELEN.md](KOPPELEN.md). |
| n8n geeft `401 Ongeldig of ontbrekend token` | Header mist `Bearer `, of de add-on is na het instellen van het token niet herstart. |
| Selectie is leeg terwijl het profiel bestaat | De gekozen producten staan niet meer in de laatste scrape. De site meldt dat zelf. Zag je dit met versie 1.2.3 of eerder, dan was het een bug: `product_id` komt als string uit Postgres en werd strikt vergeleken met een getal, dus matchte nooit. |
| Build faalt op `npm: not found` | De Supervisor gebruikt een ander basisimage dan je denkt. Kijk in het buildlog naar `load metadata for ...`. |
| Build faalt op `temporary error (try again later)` | De buildcontainer kan geen DNS. Deze add-on heeft dat niet meer nodig, maar andere lokaal gebouwde add-ons wel. Reproduceren: `printf 'FROM ghcr.io/home-assistant/amd64-base:3.21\nRUN cat /etc/resolv.conf && nslookup dl-cdn.alpinelinux.org\n' > /tmp/dns.Dockerfile && docker build --no-cache -f /tmp/dns.Dockerfile /tmp` |
| Ik heb gepusht maar er verandert niets | `version` in `config.yaml` niet omhoog gezet, of de nestmap uit route A stap 2, of de container is niet herbouwd. |
| Container start niet, onduidelijke shebang-fout | `run.sh` met CRLF. `.gitattributes` dwingt LF af; controleer met `git ls-files --eol boodschappen_deals/run.sh`. |

Voor diepere diagnose: `GET /api/health` **met** je importtoken geeft de
verbindingsgegevens, het aantal producten per winkel en de ingestuurde selecties
terug. Zonder token blijft dat weg, want dat endpoint is publiek.

## Endpoints

| Endpoint | Wat het doet |
| --- | --- |
| `GET /api/health` | Statuscheck. Met importtoken ook de verbindingsgegevens en de ingestuurde selecties. |
| `GET /api/meta` | Winkels met aantallen en ouderdom, categorieën, profielen, dieetopties, laatste scrapedatum. |
| `GET /api/deals` | De gefilterde en gescoorde lijst. Alle filters zijn queryparameters, zie hieronder. |
| `GET /api/recepten` | De ingestuurde recepten, met per recept de selectie waar het uit komt. |
| `POST /api/import/selectie` | Een selectie van de assistent opslaan of overschrijven. Vereist `Authorization: Bearer <import_token>`. |
| `DELETE /api/import/selectie/<sleutel>` | Zo'n selectie weghalen. Zelfde token. |
| `POST /api/import/recepten` | Losse recepten opslaan. Zelfde token. |
| `POST /api/verversen` | Cache leeggooien en direct opnieuw uit de database lezen. Zelfde token. |

Parameters van `/api/deals`:

| Parameter | Waarden |
| --- | --- |
| `profiel` | `alles`, `eiwit`, `gezond`, `budget`, `gezin`, `gemak`, `plantaardig`, `borrel`, of de sleutel van een assistent-selectie |
| `winkels` | komma's gescheiden, bijvoorbeeld `AH,Lidl`. Leeg is alles |
| `dieet` | `vegetarisch`, `veganistisch`, `pescotarisch`, `geen_varkensvlees`, `geen_alcohol`; meerdere mag |
| `categorieen` | komma's gescheiden, zoals ze uit `/api/meta` komen |
| `huishouden` | `1` tot `5`. Bij 1 wegen meerstuks-acties minder mee |
| `max_prijs`, `min_korting` | getallen; `0` betekent geen grens |
| `alleen_korting`, `nonfood` | `1` om aan te zetten |
| `winkelbezoek` | `alles`, `online`, `winkel` |
| `q` | vrije zoektekst |
| `sort` | `score`, `korting`, `prijs`, `kiloprijs`, `winkel`, `naam`, `selectie` |
| `limit`, `offset` | paginering. De API geeft standaard 60 terug, maximaal 500; de site vraagt er 48 per keer |

Diezelfde parameters staan in de URL van de site, dus de knop **Delen** levert een
link op die precies jouw filters terugzet. Handig om in een vriendengroep te
sturen: "voor de sportschoolmensen: deze link".

## Zelf aanpassen

**Een profiel toevoegen of bijstellen.** In `lib/score.js` staat `PROFIELEN`. Elk
profiel heeft gewichten die tot 1 optellen en straffen voor snoep, alcohol en
non-food. Voeg je er een toe, dan verschijnt hij automatisch in de profielkiezer;
kies een `icoon` uit `sparkles`, `dumbbell`, `leaf`, `wallet`, `users`, `clock`,
`sprout`, `glass`, `cart` of `kok`.

**Een winkel toevoegen.** De site is niet aan drie winkels gebonden. Zodra je
n8n-flow een vierde winkel in `products.winkel` schrijft (Plus, Aldi, Dirk),
verschijnt die automatisch als filter met het juiste aantal erbij. Wil je hem een
eigen kleur geven, voeg die dan toe in `public/app.js` bij `WINKELKLEUREN` en in
`styles.css` bij de `--plus` / `--aldi`-variabelen; voor Plus en Aldi staat dat er
al in.

**De productclassificatie verbeteren.** `lib/classify.js` bevat woordgroepen en
categoriehints. Zie je een product met een verkeerd label, dan is dat vrijwel
altijd een ontbrekend woord of een ontbrekende categoriehint daar.

## Lokaal draaien

Handig om aan het uiterlijk te werken. Zonder `db_host` draait de site op
demodata, dus je hebt geen database nodig:

```bash
cd boodschappen_deals/app && node server.js
```

De site staat dan op `http://localhost:8499`. Met een echte database:

```bash
DB_HOST=192.168.1.20 DB_PASSWORD=geheim IMPORT_TOKEN=test node server.js
```

Met docker compose, buiten Home Assistant, vanuit de root van de repo:

```bash
printf 'DB_HOST=192.168.1.20\nDB_PASSWORD=geheim\n' > .env && docker compose up -d --build
```

De demodata in `lib/demo.js` volgt bewust exact de kolomsemantiek van de echte
parsers, inclusief de rare gevallen: `2e gratis` als `overig`, AH met een lege
`eenheid`, Jumbo zonder prijzen, en `product_id` als **string** omdat pg een
bigint zo teruggeeft. Anders test je tegen fictie: die laatste ontbrak eerst, en
daardoor bleef een vergelijkingsfout op `product_id` onzichtbaar tot de site op
echte data draaide.

## Mappen

```
boodschappen-deals/
├── boodschappen_deals/          de add-on; dit is wat naar /addons/ gaat
│   ├── config.yaml              add-on-opties, ingress, poort en versie
│   ├── build.yaml               basisimages per architectuur
│   ├── Dockerfile               build voor Home Assistant (HA-basisimage, s6)
│   ├── Dockerfile.standalone    build voor gewone docker (kaal Node-image)
│   ├── run.sh                   startscript van de add-on
│   ├── DOCS.md                  het Documentatie-tabblad in Home Assistant
│   ├── translations/            Nederlandse en Engelse labels bij de opties
│   └── app/
│       ├── server.js            HTTP-server, API, filteren en sorteren
│       ├── package.json         één dependency: pg
│       ├── node_modules/        pg, meegeleverd zodat de build offline kan
│       ├── lib/config.js        instellingen uit /data/options.json of env
│       ├── lib/db.js            de Postgres-query
│       ├── lib/classify.js      productwoordenboek en categoriehints
│       ├── lib/score.js         eenheden, labels, prijzen, profielwegingen
│       ├── lib/selecties.js     de door de assistent gekozen deals
│       ├── lib/demo.js          voorbeelddata als er geen database is
│       └── public/              de website zelf: html, css, één js-bestand
├── KOPPELEN.md                  de twee koppelingen met n8n, met controlestappen
├── n8n/README.md                wat je in de flow aanpast
├── n8n/SELECTIES.md             de twee Gemini-takken met prompts en nodes
├── n8n/patch-workflow.js        script dat die wijzigingen toepast op een export
├── sql/schema.sql               tabellen, indexen, leesgebruiker
├── repository.yaml              zodat dit als add-on repository kan dienen
├── docker-compose.yml           alleen voor draaien buiten Home Assistant
└── .gitattributes               dwingt LF af; met CRLF start de container niet
```

De aangepaste n8n-workflow staat bewust **niet** in de repo: die bevat de
e-mailadressen van de ontvangers van de weekbrief. `n8n/workflow-*.json` staat
daarom in `.gitignore`. Genereer hem uit je eigen export met
`n8n/patch-workflow.js`.

## Beperkingen, eerlijk opgeschreven

- **Geen echte voedingswaarden.** "Eiwitrijk" is een categorie-oordeel, geen
  meting. Wil je echte macro's, dan is een extra bron nodig, bijvoorbeeld de
  productdetail-API van AH per artikel. Dat is een flinke uitbreiding van de
  scrape.
- **Dieetfilters zijn een schatting.** Ze werken op productnamen. Een pizza
  margherita wordt niet als zuivelhoudend herkend, want er staat geen kaas in de
  naam. Daarom staat die waarschuwing ook in de zijbalk van de site.
- **Jumbo levert geen prijzen.** De HTML-scrape haalt daar alleen actielabels op
  ("1+1 gratis"). Die producten hebben dus geen stuksprijs en kunnen niet op prijs
  of kiloprijs gesorteerd worden; ze tonen het label in plaats van een bedrag.
- **De site is zo actueel als de laatste scrape.** Per winkel wordt de nieuwste
  scrapedatum gepakt, dus als Jumbo vandaag faalde zie je daar de data van
  gisteren in plaats van niets. Boven de acht dagen komt er een waarschuwing.
- **De SQL is nog niet tegen de echte database gedraaid.** In de bouwomgeving was
  geen Postgres beschikbaar. `GET /api/health` is de controle daarvoor: die geeft
  de exacte databasefout terug.
- **Prijzen worden op centen afgerond.** `prijs_per_stuk` is in de database
  `numeric(10,2)`, dus een stuksprijs van € 1,625 uit "2 voor 3,25" wordt € 1,63.
