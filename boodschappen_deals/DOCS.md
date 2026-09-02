# Boodschappen Deals

Website die de weekaanbiedingen uit je eigen Postgres-database toont en
rangschikt op het profiel van de bezoeker. De add-on schrijft niets naar de
database, hij leest alleen.

## Bijwerken

In de SSH-terminal van Home Assistant, veilig om te herhalen:

```bash
rm -rf /tmp/bd && git clone --depth 1 https://github.com/Sanderrtjee/boodschappen-deals.git /tmp/bd && rm -rf /addons/boodschappen_deals && cp -r /tmp/bd/boodschappen_deals /addons/boodschappen_deals && rm -rf /tmp/bd && ha addons reload
```

Daarna in deze add-on op *Update* klikken, of bij een gelijk versienummer op
drie puntjes → *Rebuild*.

## Configuratie

| Optie | Uitleg |
| --- | --- |
| `db_host` | Host van Postgres. Bij een Postgres-add-on de add-on-hostnaam (bijvoorbeeld `core-postgres`), anders een IP-adres. |
| `db_port` | Standaard `5432`. |
| `db_name` | De database waar je n8n-flow naar schrijft. |
| `db_user` | Bij voorkeur een gebruiker met alleen `SELECT`-rechten. |
| `db_password` | Wachtwoord van die gebruiker. |
| `db_ssl` | Aanzetten als je database SSL vereist. |
| `site_titel` | Titel in de kop en de browsertab. |
| `cache_minuten` | Hoe lang de dataset in het geheugen blijft (1–1440). |
| `import_token` | Zelf verzonnen geheim voor `/api/import/recepten` en `/api/verversen`. Leeg laten schakelt die endpoints uit. |

## Gebruiken

- **In Home Assistant:** zet *In zijbalk weergeven* aan, dan staat de site in
  het menu.
- **Poort bezet?** De add-on publiceert `8499`. Draait daar al iets, verander de
  poort dan op het tabblad *Configuratie* in het vak **Netwerk**: dat vak wijzigt
  alleen de poort aan de buitenkant, de container blijft intern 8499 gebruiken.
  Je hoeft dus geen bestand aan te passen. Vergeet daarna niet je
  Cloudflare-tunnel en je n8n-nodes bij te werken.
- **Op je eigen domein:** de add-on publiceert poort `8499`. Stuur die door met
  de Cloudflared-add-on via `additional_hosts`:

  ```yaml
  additional_hosts:
    - hostname: boodschappen.jouwdomein.nl
      service: http://192.168.1.10:8499
  ```

  Vul het LAN-IP van je Home Assistant in bij `service`.

## Controleren of het werkt

Kijk in het log na het starten. Je hoort daar te zien:

```
info: Boodschappen Deals luistert op poort 8499
info: Database: boodschappen_web@192.168.1.20:5432/boodschappen
info: Dataset geladen: 312 aanbiedingen
```

Staat er `(demodata)` achter en zie je in de site een gele balk, dan is de
database niet bereikbaar of nog leeg. De balk zelf noemt de reden.

## Let op

De site heeft geen inlogscherm. Zet je hem op een publiek domein, dan kan
iedereen met de URL hem bekijken. Wil je dat beperken, gebruik dan Cloudflare
Access voor het hostname.
