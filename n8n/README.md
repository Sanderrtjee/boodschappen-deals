# Wat je in de n8n-flow aanpast

> **Kant-en-klaar:** [workflow-met-site-koppeling.json](workflow-met-site-koppeling.json)
> is jouw workflow met alle wijzigingen hieronder al doorgevoerd. Importeer hem in
> n8n (menu → Import from File). Hij heeft een andere naam en geen id, dus je
> bestaande workflow blijft staan; zet die oude op inactief als de nieuwe werkt.
>
> Twee dingen moet je daarna zelf nog invullen, en dat staat ook op een gele
> sticky note in de workflow: het IP van je Home Assistant in de twee
> `Stuur ... naar site`-nodes, en een Header Auth-credential met je importtoken.
>
> **Let op (november 2026):** de live workflow is sindsdien verder gegaan
> (vijf winkels, ALDI en PLUS erbij). Het script `patch-workflow.js` dat deze
> wijzigingen ooit maakte, is daarom verwijderd: het ging uit van een oudere
> export en schreef zijn uitvoer weg vóór de foutcontrole. De bron van waarheid
> is de workflow in n8n zelf. Exporteer die vóór elke wijziging. Deze pagina
> beschrijft het idee achter de koppeling, niet meer de exacte stand.


De website leest **rechtstreeks uit dezelfde Postgres-database** die je flow al
vult. Er is dus geen koppeling, API-sleutel of webhook nodig om aanbiedingen op
de site te krijgen: zodra de flow een nieuwe rij in `offers` zet, staat die de
volgende cachecyclus op de site.

Voor de aanbiedingen zelf hoef je dus niets te koppelen. Wil je ook jouw
Gemini-selecties op de site, dan is daar wel een node voor nodig; zie punt 3.

Zoek je welke adressen en tokens waar horen, en hoe je controleert dat de
verbinding staat? Dat staat in [../KOPPELEN.md](../KOPPELEN.md).

---

## 1. Laat de flow dagelijks lopen in plaats van wekelijks

Je `Schedule Trigger1` staat nu op maandag 08:03. De aanbiedingen van Jumbo en
Lidl wisselen niet allemaal op maandag, en Lidl heeft door de week wisselende
dagaanbiedingen. Zet de trigger op dagelijks, bijvoorbeeld 06:30:

```json
{
  "rule": {
    "interval": [
      { "field": "days", "triggerAtHour": 6, "triggerAtMinute": 30 }
    ]
  }
}
```

De node `Week datums` blijft werken: die berekent zelf de maandag en zondag van
de lopende week, welke dag je hem ook draait. Omdat `offers` een unieke sleutel
op `(product_id, scrape_datum)` heeft, krijg je per dag precies één rij per
product en overschrijft een herhaalde run van dezelfde dag netjes de vorige.

### Let op: de e-mail moet niet dagelijks weg

Zet vóór de tak richting `Bouw html` / `Send an Email` een IF-node zodat de
weekbrief alleen op maandag verstuurd wordt, terwijl de site wel dagelijks
verse data krijgt:

- **Left value:** `{{ $now.weekday }}`
- **Operation:** Number → equals
- **Right value:** `1`

`$now.weekday` is 1 op maandag en 7 op zondag.

---

## 2. Haal de Limit-nodes eruit

`Limit` (89 items) en `Limit1` (150 items) kappen de dataset af voordat hij de
database in gaat. Voor een e-mail met tien tips maakte dat niet uit, voor een
site met filters wel: je verliest nu aanbiedingen die iemand met een ander
profiel juist zoekt. Verwijder beide nodes en verbind:

- `formatteer AH` → `Merge1` (input 0)
- `Formatteer Lidl` → `Merge1` (input 2)

Wil je toch een plafond, zet het dan ruim (bijvoorbeeld 1000).

---

## 3. De selecties van de assistent doorzetten

Dit is waar het om begonnen is: jouw Gemini-curatie op de site, als profiel dat
bezoekers kunnen kiezen. Dat staat apart beschreven in
[SELECTIES.md](SELECTIES.md), inclusief de tweede tak voor borrel en weekend en
de exacte nodes.

Kort: één Code-node die de gekozen product_id met de reden erbij zet, en één
HTTP Request-node naar POST /api/import/selectie.

---

## 3b. Optioneel: alleen recepten doorzetten naar de site

De site heeft een tabblad **Recepten** dat pas verschijnt zodra er recepten
ingestuurd zijn. Je Gemini-node maakt die al. Zet achter
`Code in JavaScript1` een extra HTTP Request-node:

| Veld | Waarde |
| --- | --- |
| Method | `POST` |
| URL | `https://boodschappen.jouwdomein.nl/api/import/recepten` |
| Authentication | Generic → Header Auth (of onderstaande header handmatig) |
| Header | `Authorization: Bearer <import_token uit de add-on>` |
| Body | JSON |

Body:

```
{{ JSON.stringify({ recepten: $json.recepten, gegenereerd_op: $json.gegenereerd_op }) }}
```

Zet bij deze node **Settings → On Error → Continue**, zodat een niet-bereikbare
site je weekbrief niet laat klappen.

Draait n8n op dezelfde machine als Home Assistant, dan kun je in plaats van je
publieke domein ook direct de add-on aanspreken:
`http://<ip-van-home-assistant>:8499/api/import/recepten`.

---

## 4. Optioneel: cache direct verversen

De site houdt de dataset 15 minuten in het geheugen (instelbaar). Wil je dat een
nieuwe scrape meteen zichtbaar is, zet dan achter `Execute a SQL query1` een
HTTP Request-node:

- **Method:** `POST`
- **URL:** `http://<ip-van-home-assistant>:8499/api/verversen`
- **Header:** `Authorization: Bearer <import_token>`

Ook hier: On Error → Continue.

---

## 5. Aanrader: een aparte databasegebruiker voor de site

De website hoeft alleen te lezen. In `sql/schema.sql` staat onderaan (uitgecommentarieerd)
hoe je een rol `boodschappen_web` maakt met `SELECT` op precies `products` en
`offers`. Vul die gebruiker in bij de add-on in plaats van het account waarmee
n8n schrijft.

Dit is hier belangrijker dan gebruikelijk: in dezelfde database staan ook je
Nextcloud-tabellen (`oc_users`, `oc_webauthn`, `oc_twofactor_*`). Gebruik dus
geen `GRANT SELECT ON ALL TABLES` en geen `ALTER DEFAULT PRIVILEGES`, want dan
kan de website die ook lezen.

---

## 6. Optioneel: het gat in `interpreteer` dichten

Je AH-parser kent `n voor x`, `n+m gratis`, `n% korting` en `2e halve prijs`,
maar niet **"2e gratis"** en **"€1 korting"**. Die belanden als
`deal_type = 'overig'` met `kortingsfactor = null`, terwijl "2e gratis" gewoon 50
procent korting is. In je database staan daar meerdere rijen van.

**De website vangt dit al op**: die leest het label alsnog en rekent 2e gratis
als 50 procent en 3e gratis als 33 procent. Je hoeft dus niets te doen, en het
werkt ook voor de rijen die al in de database staan.

Wil je het bij de bron netjes hebben, omdat je weekbrief-prompt en je
HA-sensor dezelfde kortingsfactor gebruiken, voeg dan in `formatteer AH` aan
`interpreteer` toe, vóór de terugval op een kale prijs:

```js
// "2e gratis", "3e gratis": je neemt n stuks en betaalt n-1.
m = t.match(/^(\d+)\s*(?:e|de)\s+gratis$/);
if (m) {
  const n = parseInt(m[1]);
  if (n >= 2) return { deal_type: "gratis_erbij", prijs: null, kortingsfactor: 1 / n };
}
```

`€1 korting` laat ik met rust: zonder de prijs van vóór de actie is er geen
percentage van te maken, en een geschat percentage is erger dan geen.

## Wat je níet hoeft aan te passen

- De scraper-nodes en de parsers voor AH, Jumbo en Lidl blijven zoals ze zijn.
- De SQL-insert blijft zoals hij is; de site gebruikt exact die kolommen.
- De node `Aanbiedingen deze week` filtert AH-non-food eruit voor de Gemini-prompt.
  Dat mag blijven staan: de website doet zijn eigen non-foodfiltering en heeft
  die query niet nodig.
- De `Push topdeals naar HA`-node kan blijven; die vult je Home Assistant-sensor
  en staat los van de site.
- Je bestaande views (`v_aanbiedingen_laatste`, `v_prijshistorie`,
  `v_scrape_overzicht`, `v_weekbrief_input`) blijven ongemoeid. De site heeft
  zijn eigen query in `lib/db.js` staan zodat hij niet afhankelijk is van een
  view die je later aanpast. Doet `v_aanbiedingen_laatste` precies hetzelfde en
  wil je één definitie in plaats van twee, dan kan die query vervangen worden
  door `SELECT * FROM v_aanbiedingen_laatste` mits die view dezelfde
  kolomnamen teruggeeft; zeg het als je dat liever hebt.
- De Gemini-prompt en het antwoordformaat blijven zoals ze zijn. De `topdeals`
  gaan nu wel naar de site, maar via een extra Code-node die de `id` omzet naar
  `product_id`; aan de prompt zelf verandert niets. Zie [SELECTIES.md](SELECTIES.md).
