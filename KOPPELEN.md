# n8n en de add-on aan elkaar knopen

Er zijn **twee koppelingen**, en ze lopen in tegengestelde richting. Dat is de
belangrijkste bron van verwarring, dus eerst het plaatje:

```
  ①  aanbiedingen                                    ②  selecties
      n8n ──schrijft──► Postgres ◄──leest── add-on        n8n ──POST──► add-on
```

- **① De aanbiedingen.** Hier koppel je niets. n8n schrijft naar Postgres, de
  add-on leest uit diezelfde Postgres. Het enige dat je doet is de
  databasegegevens in de add-on invullen. Er gaat geen enkel bericht van n8n
  naar de add-on voor de aanbiedingen zelf.
- **② De selecties van de assistent.** Hier is wel een koppeling nodig, want de
  keuze van Gemini staat niet in de database. n8n stuurt die met een HTTP
  Request-node naar de add-on.

Werkt ① niet, dan is de site leeg. Werkt ② niet, dan werkt de site wel maar
staan er alleen regelprofielen en geen assistent-selecties.

---

## ① De add-on bij je database krijgen

### Welk adres vul je in bij `db_host`?

**Kijk in je bestaande n8n-credential "Postgres account HA" en neem die host
over.** Dat is het snelste en meest betrouwbare antwoord, met één uitzondering:

| Staat er in n8n… | Vul dan in de add-on in |
| --- | --- |
| een IP zoals `192.168.1.20` | hetzelfde IP |
| een hostnaam zoals `nas.local` | dezelfde hostnaam |
| `localhost` of `127.0.0.1` | **niet overnemen.** Dat betekent "de machine waar n8n op draait", en dat is voor de add-on een andere machine. Zie hieronder. |

Staat er `localhost`, dan draaien n8n en Postgres op dezelfde machine. Twee
mogelijkheden:

- **Draait Postgres als Home Assistant add-on?** Dan kun je het LAN-IP van je
  Home Assistant gebruiken, mits die add-on poort 5432 publiceert. Kijk op het
  tabblad *Configuratie* van de Postgres-add-on of daar een poort staat. Zo ja,
  vul het vaste IP van je Home Assistant in (bijvoorbeeld `192.168.1.10`).
- **Publiceert die add-on geen poort?** Dan is hij alleen intern bereikbaar via
  zijn add-on-hostnaam. Die vind je op het tabblad *Info* van die add-on, of je
  leidt hem af uit het patroon `<repository>-<slug>` met streepjes in plaats van
  liggende streepjes: een lokale add-on met slug `postgres` wordt
  `local-postgres`, een add-on van de community-repository wordt bijvoorbeeld
  `a0d7b954-postgres`, een officiële `core-postgres`.

Bij twijfel: het LAN-IP werkt in de meeste opstellingen en is makkelijker te
controleren.

### Welke gebruiker?

Niet het account waarmee n8n schrijft. Maak een leesgebruiker aan; de regels
staan in [sql/schema.sql](sql/schema.sql). Dat is hier extra belangrijk omdat in
diezelfde database je Nextcloud-tabellen staan.

### Controleren of ① werkt

Kijk in het **Log** van de add-on, direct na het starten. Goed ziet er zo uit:

```
info: Boodschappen Deals luistert op poort 8499
info: Instellingen gelezen uit add-on-configuratie
info: Database: boodschappen_web@192.168.1.20:5432/postgres
info: Dataset geladen: 689 aanbiedingen
```

Fout ziet er zo uit:

```
fout: De database is niet bereikbaar: connect ETIMEDOUT 192.168.1.20:5432
waarschuwing: Dataset geladen: 0 aanbiedingen
```

Staat er `(demodata)` achter het aantal, dan is er helemaal geen `db_host`
ingevuld. Op de site zelf zie je hetzelfde: een gele balk met de reden.

Wil je precies zien waar de add-on verbinding mee probeert te maken, vraag dan
`/api/health` op **met je importtoken**. Zonder token krijg je alleen de
grote lijn (want dat endpoint is publiek), met token ook de verbindingsgegevens:

```bash
curl -H "Authorization: Bearer JOUW_TOKEN" http://192.168.1.10:8499/api/health
```

```json
{
  "status": "ok",
  "demo": false,
  "aanbiedingen": 689,
  "database": "verbonden",
  "verbinding": { "host": "192.168.1.20", "poort": 5432, "database": "postgres",
                  "gebruiker": "boodschappen_web", "ssl": false },
  "winkels": { "AH": 412, "Jumbo": 154, "Lidl": 123 },
  "selecties": [ { "sleutel": "assistent-eiwit", "deals": 8,
                   "gegenereerd_op": "2026-09-02T06:03:11.000Z" } ]
}
```

---

## ② n8n bij de add-on krijgen

### Welke URL vul je in de HTTP Request-node in?

Dit hangt af van waar n8n draait. De add-on publiceert poort `8499` op je Home
Assistant, dus:

> Is `8499` bij jou ook al bezet, verander hem dan op het tabblad *Configuratie*
> van de add-on in het vak **Netwerk**. Dat wijzigt alleen de poort aan de
> buitenkant; intern blijft de container 8499 gebruiken en de ingress-weergave in
> het HA-menu blijft werken. Gebruik daarna in de tabel hieronder jouw poort.

| Waar draait n8n? | URL |
| --- | --- |
| Als add-on op dezelfde Home Assistant | `http://192.168.1.10:8499` (het LAN-IP van HA). Ook `http://local-boodschappen-deals:8499` werkt, mits die naam bij jou resolvet; het IP is zekerder. |
| In Docker op een NAS of NUC in hetzelfde netwerk | `http://192.168.1.10:8499` |
| Buiten je netwerk, bijvoorbeeld n8n Cloud | `https://boodschappen.jouwdomein.nl` via je Cloudflare-tunnel |

Gebruik een **vast IP** voor je Home Assistant, of een DHCP-reservering. Anders
werkt de koppeling tot je router een ander adres uitdeelt.

Let op: `http://homeassistant.local:8499` werkt vaak wel vanaf je laptop maar
niet vanuit een container, want mDNS-namen worden daar meestal niet opgelost.
Neem het IP.

### Het token instellen

1. Verzin een lang geheim, bijvoorbeeld met `openssl rand -hex 24`.
2. Zet het in de add-on bij `import_token` en herstart de add-on.
3. Maak in n8n één credential aan van het type **Header Auth**:
   - **Name:** `Authorization`
   - **Value:** `Bearer JOUW_TOKEN`

   Die credential kun je bij elke HTTP Request-node hergebruiken. Dat is beter
   dan het token in de node zelf typen, want dan staat het niet in je
   workflow-export.

Laat je `import_token` leeg, dan zijn de import-endpoints **uit**. Dat is
opzettelijk: liever geen koppeling dan een open schrijfroute.

### De node zelf

| Veld | Waarde |
| --- | --- |
| Method | `POST` |
| URL | `http://192.168.1.10:8499/api/import/selectie` |
| Authentication | Generic Credential Type → Header Auth → jouw credential |
| Send Body | aan, Body Content Type `JSON`, Specify Body `Using JSON` |
| JSON | `{{ JSON.stringify($json) }}` |
| Settings → On Error | **Continue (using error output)** |

Die laatste is niet optioneel maar belangrijk: is de add-on even niet bereikbaar
omdat Home Assistant net herstart, dan moet je weekbrief nog steeds verstuurd
worden. De site houdt gewoon de selectie van vorige keer.

### Controleren of ② werkt

Zet in n8n tijdelijk een losse HTTP Request-node met **GET** naar
`http://192.168.1.10:8499/api/health` en je Header Auth-credential, en klik
*Test step*. Krijg je het JSON-antwoord van hierboven, dan is de route in orde
en hoef je alleen nog de body goed te krijgen.

Na een echte run van de selectie-node hoort het antwoord er zo uit te zien:

```json
{ "status": "ok", "sleutel": "assistent-eiwit", "deals": 8, "recepten": 3 }
```

Staat er `deals: 0` bij, dan is de route goed maar mist de body `product_id`'s.
Dat is bijna altijd hetzelfde probleem: je stuurt de `id` uit het Gemini-antwoord
door in plaats van de `product_id` uit de database. Zie
[n8n/SELECTIES.md](n8n/SELECTIES.md).

---

## Veelvoorkomende fouten

| Symptoom | Oorzaak |
| --- | --- |
| Gele balk "Demodata" | `db_host` is leeg. |
| Balk "De database is niet bereikbaar" met `ETIMEDOUT` | Verkeerd IP, of Postgres publiceert die poort niet. |
| `ECONNREFUSED` | Adres klopt, maar er luistert niets op die poort. |
| `password authentication failed` | Gebruiker of wachtwoord fout, of `pg_hba.conf` laat dat IP niet toe. |
| `permission denied for table products` | De leesgebruiker heeft geen `SELECT`. Zie `sql/schema.sql`. |
| Site werkt, maar geen assistent-profielen | Koppeling ② ontbreekt of het token klopt niet. Test met de GET-node. |
| n8n geeft `401 Ongeldig of ontbrekend token` | Drie mogelijke oorzaken. Kijk eerst in het add-on-log: staat er `Geen import_token ingesteld`, dan is het veld leeg. Staat er `Import-endpoints staan aan`, dan klopt het token in de add-on en is de **Value** in n8n het probleem: die moet `Bearer <token>` zijn, dus met dat woord ervoor. Heb je het token net ingevuld, dan moet de add-on nog **herstart** worden, want de instellingen worden bij het starten gelezen. |
| Alles werkt, maar de selectie is leeg | De gekozen producten staan niet meer in de laatste scrape. De site meldt dat zelf. |
