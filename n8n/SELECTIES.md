# De selecties van de assistent op de site krijgen

De website heeft twee soorten profielen:

- **Regelprofielen** (Beste deals, Eiwitrijk, Gezond, Budget, …). Die rekent de
  site zelf uit. Ze werken altijd, ook als Gemini eruit ligt of je API-quota op
  is, en ze werken op de volledige dataset.
- **Assistent-selecties.** Dat is jouw Gemini-curatie: acht tot twaalf
  handgekozen deals met een reden per product. Die staan vooraan in de
  profielkiezer en zijn het startpunt voor een nieuwe bezoeker.

Je stuurt zo'n selectie in met één HTTP-node per profiel. **Je stuurt alleen de
keuze en de onderbouwing, geen prijzen.** De site zoekt de producten er zelf bij
uit de database, zodat er nooit een verouderd bedrag naast een actueel bedrag
staat. Verdwijnt een gekozen product uit de scrape, dan valt hij weg en meldt de
site hoeveel er nog over zijn.

---

## Ja, twee Gemini-runs, maar om een andere reden dan je denkt

Niet omdat één call geen twee lijstjes kan opleveren, maar omdat de **invoer**
verschilt. Je huidige node `Aanbiedingen deze week` gooit precies de categorieën
weg die een borrelprofiel nodig heeft:

```
'Bier, wijn, aperitieven', 'Borrel, chips, snacks',
'Koek, snoep, chocolade', 'Gall & Gall acties', ...
```

Voor een weekendprofiel wil je juist alleen díe categorieën. Twee runs met elk
een eigen SQL-query en een eigen, korte prompt geeft veel beter resultaat dan
één run met alles erin en een prompt die twee dingen tegelijk moet doen. Twee
calls op Gemini Flash kosten bovendien vrijwel niets.

---

## Tak 1: eiwitrijk, gezond en gevarieerd

Dit is je bestaande tak. `Aanbiedingen deze week` en `Bouw prompt` blijven zoals
ze zijn. Achter `Code in JavaScript1` (die de id's terugkoppelt naar de
volledige productgegevens) hang je een **Code**-node:

```js
// Bouw selectie eiwit
const deals = ($json.topdeals ?? []).map(d => ({
  product_id: d.product_id,
  reden: d.reden
})).filter(d => d.product_id);

return [{
  json: {
    sleutel: 'assistent-eiwit',
    naam: 'Eiwitrijk, gezond en gevarieerd',
    omschrijving: 'Wekelijkse keuze op eiwit, gezondheid en scherpe prijs.',
    icoon: 'dumbbell',
    orde: 1,
    gegenereerd_op: $json.gegenereerd_op,
    deals,
    recepten: $json.recepten ?? []
  }
}];
```

Let op `d.product_id`: dat werkt omdat `Code in JavaScript1` de records uit
`Bouw prompt` erbij zoekt, en die komen uit je SQL-node die `p.product_id`
selecteert. De `id` in het Gemini-antwoord is alleen de positie in de prompt en
is buiten die node nergens geldig.

Daarachter een **HTTP Request**-node:

| Veld | Waarde |
| --- | --- |
| Method | `POST` |
| URL | `http://<ip-van-home-assistant>:8499/api/import/selectie` |
| Header | `Authorization: Bearer <import_token>` |
| Body | JSON: `{{ JSON.stringify($json) }}` |
| Settings → On Error | Continue |

---

## Tak 2: borrel en weekend

Deze tak is nieuw en loopt parallel. Vier nodes.

**1. Postgres-node "Borrelaanbiedingen"** met precies de categorieën die de
andere query weglaat:

```sql
SELECT p.product_id, p.winkel, p.categorie, p.naam, p.eenheid, p.afbeelding,
       o.prijs_nu, o.prijs_was, o.prijs_per_stuk, o.deal_type,
       o.label_tekst, o.kortingsfactor, o.link
FROM products p
JOIN offers o ON o.product_id = p.product_id
WHERE o.scrape_datum = (SELECT max(scrape_datum) FROM offers)
  AND (
        p.categorie IN (
          'Bier, wijn, aperitieven', 'Borrel, chips, snacks',
          'Koek, snoep, chocolade', 'Frisdrank, sappen, water',
          'Gall & Gall acties', 'Gall & Gall klantenkaart'
        )
     OR p.naam ~* '(bier|pils|wijn|prosecco|cava|champagne|radler|cider|speciaalbier|'
                  'borrel|chips|nootjes|olijven|tapas|dipsaus|kaasplank|worstjes|toast)'
  )
ORDER BY p.winkel, p.naam;
```

De `~*`-tak vangt Lidl en Jumbo op, want die leveren geen bruikbare categorie
('Food' respectievelijk `null`).

**2. Code-node "Bouw borrelprompt"**, hetzelfde patroon als je bestaande
`Bouw prompt`, met deze instructie:

```
Je bent een boodschappenassistent die supermarktaanbiedingen selecteert voor een
gezellig weekend: borrel, vrijdagavond, visite.
Je krijgt een lijst aanbiedingen, elk met een id.
Kies de beste deals voor een borrel: speciaalbier en pils, wijn en bubbels,
hartige snacks, noten, olijven, kaas en tapas, en iets zoets voor erbij.
Let extra op producten die normaal duur zijn maar nu flink afgeprijsd zijn
(hoge korting_pct of groot verschil tussen prijs_was en prijs_nu).
Let op: 'elders' betekent dat prijs_was een prijs bij een andere winkel is en
geen eerdere Lidl-prijs. Weeg dat eerlijk mee.
Kies ongeveer 8 tot 12 deals, gevarieerd over de winkels en over de soorten,
dus niet alleen bier.
Bedenk daarnaast 2 borrelhapjes die je met deze aanbiedingen kunt maken.
Verwijs naar producten met hun id. Verzin geen prijzen of producten die niet in
de lijst staan.
Antwoord uitsluitend met geldige JSON, zonder codeblok of tekst eromheen, exact
in dit formaat:
{"topdeals":[{"id":0,"reden":"..."}],"recepten":[{"titel":"...","beschrijving":"...","ingredienten":[{"id":0}],"extra_ingredienten":["..."]}]}
```

**3. Gemini-node**, identiek ingesteld aan je bestaande `Message a model`.

**4. Code-node "Bouw selectie weekend"**, dezelfde terugkoppeling van id naar
`product_id` als in `Code in JavaScript1`, en dan:

```js
return [{
  json: {
    sleutel: 'assistent-weekend',
    naam: 'Borrel en weekend',
    omschrijving: 'Bier, wijn en hapjes voor het weekend.',
    icoon: 'glass',
    orde: 2,
    gegenereerd_op: new Date().toISOString(),
    deals,
    recepten
  }
}];
```

Daarachter dezelfde HTTP Request-node als bij tak 1. Hetzelfde endpoint: de
`sleutel` bepaalt welk profiel je overschrijft.

---

## Velden van `/api/import/selectie`

| Veld | Verplicht | Betekenis |
| --- | --- | --- |
| `sleutel` | ja | Kleine letters, cijfers en streepjes. Dit is de identiteit; dezelfde sleutel overschrijft de vorige selectie. |
| `naam` | ja | Wat er in de profielkiezer staat. |
| `deals` | ja | Lijst van `{ product_id, reden }`. De volgorde is de volgorde op de site. |
| `omschrijving` | nee | Alleen zichtbaar op brede schermen. |
| `icoon` | nee | `sparkles`, `dumbbell`, `leaf`, `wallet`, `users`, `clock`, `sprout`, `glass`, `cart` of `kok`. |
| `orde` | nee | Lager staat vooraan. Standaard 50. |
| `gegenereerd_op` | nee | ISO-tijdstempel, wordt op de site getoond. |
| `recepten` | nee | Zelfde vorm als je weekbrief gebruikt; verschijnen op het tabblad Recepten met de naam van de selectie erbij. |

Een selectie weghalen: `DELETE /api/import/selectie/<sleutel>` met hetzelfde
token.

---

## Wat er gebeurt als een selectie oud wordt

De site vergelijkt de `product_id`'s met de actuele scrape:

- **Alles nog actueel** → het profiel toont "8 deals".
- **Een deel verlopen** → "5 van de 8 nog actueel", en boven de resultaten staat
  van welke datum de selectie is.
- **Alles verlopen** → het profiel blijft staan, maar de pagina zegt dat de
  selectie verlopen is en verwijst naar de regelprofielen. Er wordt niets
  verzonnen en er blijft geen oude prijs staan.

Draait je flow dus wekelijks, dan is de selectie hooguit een week oud en klopt
hij met de aanbiedingen van diezelfde week. Zet je de scrape op dagelijks maar
Gemini op wekelijks, dan zie je gedurende de week de selectie langzaam
uitdunnen. Dat is precies wat je wilt weten.
