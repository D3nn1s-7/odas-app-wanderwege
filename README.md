Die App **Wanderwege** macht Wander- und Radwege aus dem Knowledge Graph der Deutschen Zentrale
für Tourismus (DZT) durchsuchbar: Ort oder eigenen Standort eingeben, Umkreis wählen und die
gefundenen Wege auf Karte und in einer filterbaren Liste ansehen. Die Detailansicht zeichnet die
Strecke als Linie auf der Karte, zeigt bei Verfügbarkeit ein Höhenprofil und bietet einen
ODTA-konformen JSON-LD-Export je Weg.

Die App ist für die Verwendung im [Open Data App Store](https://open-data-app-store.de/) gemacht
und entspricht der [Open Data App](https://open-data-apps.github.io/open-data-app-docs/open-data-app-spezifikation/).

Mehr zu Open Data Apps unter https://github.com/open-data-apps

---

## ⚠️ Sicherheitshinweis: API-Key ist derzeit öffentlich sichtbar

ODAS-Apps sind statische Single Page Applications. Die Instanz-Konfiguration wird über einen
anonymen `fetch` auf `<app-url>/config` geladen (`app/app-base.js`, `getConfigUrl()`/
`fetchConfig()`) — diese Antwort ist damit für jede:n Besucher:in der App im Klartext einsehbar,
nicht nur im DevTools-Netzwerk-Tab, sondern als abrufbare JSON-URL.

Der DZT-API-Key (`apiKey`) liegt wie jeder andere Konfigurationswert in dieser Instanz-Config.
Ein serverseitiger Schutzmechanismus für Zugangsdaten existiert im ODAS derzeit nur für einzelne
Spezialfälle (z. B. der `${appUrl}/ai`-Endpunkt der KI-Backend-Integration, bei dem die
Plattform den Provider-Key hält und die App selbst keinen Schlüssel überträgt). Für frei
konfigurierbare externe APIs wie den DZT Knowledge Graph gibt es aktuell keinen vergleichbaren
Relay.

**Konsequenz:** Diese App wird bis auf Weiteres **nicht im ODAS-Live-Betrieb** eingesetzt,
sondern ausschließlich lokal gegen eine ODAS-Dev-Instanz und zu Vorschauzwecken betrieben.
Sobald die ODAS-Plattform einen serverseitigen Schutzmechanismus für Zugangsdaten bereitstellt,
wird die App darauf umgestellt — voraussichtlich durch reine Config-Änderung (`apiurl` auf einen
Relay-Endpunkt, `apiKey` leeren), ohne Anpassung von `app/app.js`.

Der ODAS-Proxy (`/odp-data`) ist hier keine Lösung: Er löst den Zielhost über den ODP-Host des
betreibenden Portals auf, nicht über den in `apiurl` konfigurierten Host. Bei einem fremden Host
wie `proxy.opendatagermany.io` scheitert jeder Proxy-Aufruf mit HTTP 500. Diese App bietet
deshalb bewusst **kein** `proxyAktiv`-Feld an.

---

## Funktionen
Die App ist eine Single Page Application (Webapp) mit:

- Logo-Anzeige
- Menü
- Seiten für Impressum, Datenschutz, Beschreibung, Kontakt, Hauptinhalt
- Inhaltsbereich
- Fußzeile

Die Konfiguration wird vom ODAS geladen. Die App zeigt folgende Inhalte:

- **Suche**: Ortssuche (OpenStreetMap Nominatim) oder eigener Standort, Umkreis 10–100 km wählbar
- **KPI-Kacheln**: Gefundene Wege, Gesamtlänge, Rundwege, Arten – mit erläuternden Kontexttexten
- **Filter**: Art (Wandern/Rad/Sonstige, aus dem @type-Array abgeleitet), Schwierigkeit, Länge,
  nur Rundwege
- **Interaktive Karte**: Leaflet.js mit OpenStreetMap-Kacheln, Startpunkt-Markern und
  Klick-Navigation zur Detailansicht
- **Listenansicht**: Clientseitiges Paging, Inline-Detailansicht pro Weg
- **Detailansicht**: Streckenlinie auf der Karte, Höhenprofil (Chart.js, wenn Höhendaten entlang
  der Strecke vorliegen), Länge, Schwierigkeit, Dauer, Auf-/Abstieg, Start- und Zielort, Lizenz
- **ODTA-konformer JSON-LD-Export**: Anzeigen, Kopieren und Herunterladen pro Weg
- **Schale-4-Komponenten**: Methodik-Kasten und verwandte Links (optional konfigurierbar)

---

## Für wen ist diese App?
Diese App richtet sich an Wander- und Radsportbegeisterte sowie an Kommunen und
Tourismusverantwortliche, die Wegedaten des DZT Knowledge Graph visualisieren wollen. Es sind
keine besonderen Datenkenntnisse nötig – die Bedienung erfolgt über Suche, Karte, Liste und
Filter.

---

## Datenformat und -abruf
Die App lädt keine Datei, sondern fragt bei jeder Suche live die
[DZT-Knowledge-Graph-API](https://changelog-dzt-kg.readme.io/) ab:

1. **Suche** (`apiurl`, SPARQL-Endpunkt): Ein Geo-Umkreis-Query gegen die Trail-Domain-Specification
   (`https://semantify.it/ds/hSsrCTQowvYH`) liefert je Treffer Name, Länge, Schwierigkeit, Dauer,
   Rundweg-Kennzeichen, Art (`@type`) und einen Referenzpunkt (Startkoordinate) für die
   Kartenmarker – in einem Request statt einem Request je Treffer.
2. **Detail** (abgeleitet von `apiurl`, `…/api/ts/v2/kg/things/{id}`): Beim Aufklappen eines Wegs
   wird der vollständige Datensatz nachgeladen (Beschreibung, Bilder, Streckengeometrie,
   Höhenmeter, Lizenz). Ergebnisse werden pro Sitzung gecacht.

Beide Endpunkte erlauben CORS (`Access-Control-Allow-Origin: *`); ein direkter `fetch` im Browser
ist möglich, sofern ein gültiger `x-api-key`-Header mitgeschickt wird (siehe Sicherheitshinweis
oben).

**Datenlage (gemessen 2026-08-19, 679 Wege im 50-km-Testradius):** Streckengeometrie 100 %,
Länge/Schwierigkeit ~100 %, geschätzte Dauer ~67 %. Sperrstatus, empfohlene Ausrüstung,
Betreuer:in sowie Gipfel-/Tiefpunkte werden von keinem der geprüften Anbieter befüllt (0 %) und
sind deshalb nicht Teil der Detailansicht.

---

## Kompatible Datensätze
Die App ist speziell auf die DZT-Knowledge-Graph-API und das ODTA-Trail-Vokabular
(`https://odta.io/voc/Trail`) zugeschnitten – anders als generische ODAS-Apps ist sie nicht ohne
Weiteres auf andere Datenquellen übertragbar, da sie SPARQL-Query-Struktur und Feldpfade des
DZT Knowledge Graph direkt abbildet.

| Datensatz | Quelle | Lizenz |
| --- | --- | --- |
| Wander- und Radwege (odta:Trail) | DZT Knowledge Graph | je Anbieter, siehe `sdLicense` je Weg |
| OpenStreetMap-Kacheln | OpenStreetMap contributors | ODbL |
| Nominatim-Geokodierung | OpenStreetMap contributors | ODbL |

---

### Systemvoraussetzungen
- Docker / Docker Compose
- Make

Die Entwicklung wurde getestet unter Windows und Ubuntu.

### Starten
```bash
make build up
```

Die App wird gestartet und steht auf dem im `Makefile`/`docker-compose.yml` konfigurierten Port
zur Verfügung.

Weil die App mit localhost gestartet wird, wird die Konfiguration lokal geladen.

### Lokale Entwicklung mit VS Code Live Server

Alternativ kann die App mit VS Code Live Server aus der Projektwurzel gestartet werden. Öffne
dann `http://127.0.0.1:<live-server-port>/app/`; Live Server nutzt standardmäßig Port `5500`.

Empfohlene ODAS-Einstellungen:

```json
{
  "liveServer.settings.host": "127.0.0.1",
  "liveServer.settings.root": "/",
  "liveServer.settings.file": "app/index.html"
}
```

`liveServer.settings.root` sollte für ODAS-Apps normalerweise `/` bleiben, damit `app/` und
`odas-config/` gleichzeitig erreichbar sind. Die App erkennt Localhost (127.0.0.1/localhost)
automatisch und lädt dann `odas-config/config.json`; kein Edit an `app/app-base.js` nötig.

**Für einen echten lokalen Testlauf mit Daten** in `odas-config/config.json` unter `apiKey` den
eigenen DZT-API-Key eintragen. Diese Datei **nicht committen**, solange sie einen echten Key
enthält – lokal wieder leeren oder den Key vor einem Commit entfernen.

### Aufbau der App
Der Inhaltsbereich wird in `app/app.js` erstellt. Dort sind Suche (Ortssuche/Standort, SPARQL),
Filter, Paginierung, Leaflet-Karte, Detailansicht mit Streckenlinie und Höhenprofil sowie
JSON-LD-Export implementiert. Template-eigene Dateien (`app/app-base.js`, `app/app-base.css`,
`app/index.html`) werden nicht verändert. Leaflet und Chart.js werden dynamisch nachgeladen.

### Wichtige Dateien
| Datei | Beschreibung |
| --- | --- |
| `app/app.js` | Hauptlogik: Suche, SPARQL-Query, Filter, Karte, Detailansicht, Höhenprofil, JSON-LD-Export |
| `app-package.json` | App-Metadaten und Instanz-Konfigurationsfelder für den ODAS |
| `assets/schema.json` | Frictionless Data Schema – Datenmodell der angezeigten Wegdaten |
| `assets/odas-app-icon.svg` | ODAS-konformes App-Icon |
| `odas-config/config.json` | Lokale Konfiguration für die Entwicklung |

---

## Konfiguration (Instanz)
Folgende Parameter werden bei der App-Instanzierung im ODAS konfiguriert:

| Parameter | Beschreibung | Pflicht |
| --- | --- | --- |
| `apiurl` | SPARQL-Endpunkt des DZT Knowledge Graph. Die REST-Detailabfrage wird automatisch aus derselben Origin abgeleitet. | ja |
| `apiKey` | DZT-API-Key (`x-api-key`-Header). Siehe Sicherheitshinweis oben. | ja |
| `urlDaten` | URL zur Zugriffsdokumentation des DZT Knowledge Graph | ja |
| `standardSprache` | Anzeigesprache für mehrsprachige Felder (de/en) | ja |
| `sprache` | Sprache der App (`de`) | ja |
| `titel` | Anzeigetitel der App | ja |
| `seitentitel` | Browser-Tab-Titel | ja |
| `datenquelleHinweis` | Methodik-Kasten (HTML) | nein |
| `datenStand` | Zusätzlicher Text zum Datenstand | nein |
| `weiterfuehrendeLinks` | Verwandte Links (HTML) | nein |

Was bei der App-Entwicklung beachtet werden sollte, steht in der ODA-Spezifikation.

---

## ODAS-Proxy
Diese App bietet **kein** `proxyAktiv`-Feld an. Die Datenquelle (`proxy.opendatagermany.io`)
stammt nicht vom Open-Data-Portal, das die App betreibt; der ODAS-Proxy löst den Zielhost aber
über den ODP-Host des betreibenden Portals auf. Bei abweichendem Host scheitert jeder
`odp-data`-Aufruf mit HTTP 500, ohne Rückfall auf Direktzugriff. Die App lädt deshalb
ausschließlich direkt.

---

## Betriebsarten

Die App kann lokal oder eigenständig hinter einem Traefik-Reverse-Proxy betrieben werden. Ein
Betrieb über den ODAS ist aktuell bewusst **nicht vorgesehen** (siehe Sicherheitshinweis oben).

### Standalone-Betrieb

Voraussetzung: ein laufender Traefik mit dem externen Docker-Netzwerk `proxynet`,
dem EntryPoint `websecure` und dem Zertifikatsresolver `letsencrypt`.

1. In `docker-compose.standalone.yml` den Platzhalter `app1.example.com` durch den
   echten FQDN ersetzen.
2. Starten:

```bash
STANDALONE=true make up
STANDALONE=true make logs
STANDALONE=true make down
```

Im Standalone-Betrieb entfällt die lokale Portfreigabe; Traefik terminiert TLS und
leitet auf den internen Nginx-Port 80 weiter. Die Konfiguration wird aus derselben
`odas-config/config.json` gelesen wie in der Entwicklung und von Nginx unter `/config`
ausgeliefert. **Der API-Key liegt in diesem Betrieb ebenso öffentlich in der Config wie im
ODAS-Live-Betrieb** – der Sicherheitshinweis oben gilt unverändert.

### Beim Aufruf kontaktierte Drittanbieter

Beim Aufruf dieser App werden folgende externe Server kontaktiert:

- `proxy.opendatagermany.io` — DZT-Knowledge-Graph-Schnittstelle (Wegedaten, SPARQL + REST)
- `nominatim.openstreetmap.org` — Ortssuche (Geokodierung)
- `tile.openstreetmap.org` — Kartenkacheln (OpenStreetMap)

Diese Anbieter bleiben auch im Standalone-Betrieb extern; ein vollständig autarker Betrieb ohne
Internetzugang ist derzeit nicht möglich. Alle Programmbibliotheken werden lokal aus
`app/vendor/` ausgeliefert und nicht extern geladen.

### Auslieferung an den ODAS

`make zip` erzeugt das Liefer-ZIP mit `app/`, `assets/`, `app-package.json` und
`CHANGELOG.md`. Die Infrastrukturdateien (`Dockerfile`, `docker-compose*.yml`,
`nginx.conf`, `Makefile`) sind nicht Teil der Auslieferung. Das ZIP ist ein Bauartefakt und wird
nicht mitversioniert, sondern bei Bedarf mit `make zip` erzeugt. **Vor einem Upload in den
ODAS-App-Store gilt weiterhin der Sicherheitshinweis oben** – die App ist dafür aktuell nicht
vorgesehen.

## Autor
© 2026, Ondics GmbH
