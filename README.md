Die App **Wanderwege** zeigt die für eine Instanz konfigurierten Wander- und Radwege aus dem
Knowledge Graph der Deutschen Zentrale für Tourismus (DZT) auf Karte und in einer filterbaren
Liste. Ort, Umkreis und Kategorie (Radweg/Fußwanderweg/Sonstige touristische Wege) werden bei
der Buchung der App-Instanz festgelegt, nicht von Besucher:innen der App. Die Detailansicht
zeichnet die Strecke als Linie auf der Karte, zeigt bei Verfügbarkeit ein Höhenprofil und bietet
einen ODTA-konformen JSON-LD-Export je Weg.

Die App ist für die Verwendung im [Open Data App Store](https://open-data-app-store.de/) gemacht
und entspricht der [Open Data App](https://open-data-apps.github.io/open-data-app-docs/open-data-app-spezifikation/).

Mehr zu Open Data Apps unter https://github.com/open-data-apps

---

## Datenzugriff über den ODAS-DZT-Relay

Der DZT-API-Key wird **nicht** von dieser App verwaltet. Seit Commit `d2a8540` des
`open-data-app-store` (2026-08-20, „Implement DNZ Proxy endpoint") stellt die Plattform einen
serverseitigen Relay bereit:

```
GET <app-url>/dzt?path=<pfad relativ zu https://proxy.opendatagermany.io/api/>
```

Der Relay hängt Host, `/api/`-Präfix und den plattformseitig konfigurierten `x-api-key`-Header an
und reicht Statuscode, Content-Type und Antwortkörper unverändert durch. `app/app.js` kennt
keinen API-Key mehr — die Instanz-Konfiguration enthält kein `apiKey`-Feld.

Damit entfällt der frühere Vorbehalt: Der API-Key war zuvor Teil der Instanz-Config und damit für
jede:n Besucher:in im Klartext einsehbar (Instanz-Konfigurationen werden über einen anonymen
`fetch` auf `<app-url>/config` geladen, siehe `app/app-base.js`, `getConfigUrl()`). Diese App ist
deshalb jetzt für den ODAS-Live-Betrieb vorgesehen.

Außerhalb einer ODAS-Instanz — Live Server, Standalone-Betrieb — existiert `<app-url>/dzt` nicht;
dort zeigt die App eine Fehlermeldung statt Wegedaten (siehe „Lokale Entwicklung" und
„Betriebsarten" unten).

Der ODAS-Proxy (`/odp-data`) ist dafür weiterhin keine Alternative: Er löst den Zielhost über den
ODP-Host des betreibenden Portals auf, nicht über den in `apiurl` konfigurierten Host. Bei einem
fremden Host wie `proxy.opendatagermany.io` scheitert jeder `/odp-data`-Aufruf mit HTTP 500. Diese
App bietet deshalb weiterhin bewusst **kein** `proxyAktiv`-Feld an — sie nutzt den separaten
`/dzt`-Relay.

---

## Funktionen
Die App ist eine Single Page Application (Webapp) mit:

- Logo-Anzeige
- Menü
- Seiten für Impressum, Datenschutz, Beschreibung, Kontakt, Hauptinhalt
- Inhaltsbereich
- Fußzeile

Die Konfiguration wird vom ODAS geladen. Die App zeigt folgende Inhalte:

- **Fester Instanz-Zuschnitt**: Ort, Umkreis (5–100 km) und Kategorie sind Teil der
  Instanz-Konfiguration; die App lädt den passenden Ausschnitt beim Aufruf automatisch
- **Erklärtext**: Aus Ort/Umkreis/Kategorie generierter Einleitungssatz, der sagt, was angezeigt
  wird — kein separater Config-Wert, immer synchron zur tatsächlichen Konfiguration
- **KPI-Kacheln**: Gefundene Wege, Gesamtlänge, Rundwege – mit erläuternden Kontexttexten
- **Filter**: Schwierigkeit, Länge, nur Rundwege (die Kategorie selbst ist fest, kein Filter mehr)
- **Interaktive Karte**: Leaflet.js mit OpenStreetMap-Kacheln, Startpunkt-Markern und
  Klick-Navigation zur Detailansicht
- **Listenansicht**: Clientseitiges Paging, Inline-Detailansicht pro Weg
- **Detailansicht**: Streckenlinie auf der Karte, Höhenprofil (Chart.js, wenn Höhendaten entlang
  der Strecke vorliegen), Länge, Schwierigkeit, Dauer, Auf-/Abstieg, Start- und Zielort, Lizenz
- **ODTA-konformer JSON-LD-Export**: Anzeigen, Kopieren und Herunterladen pro Weg
- **Schale-4-Komponenten**: Methodik-Kasten und verwandte Links (optional konfigurierbar)
- **Zustand überlebt Seitenwechsel**: Ergebnisse, Karte und Filterauswahl bleiben beim Wechsel zu
  Kontakt/Beschreibung/… und zurück erhalten — kein erneuter API-Abruf

---

## Für wen ist diese App?
Diese App richtet sich an Wander- und Radsportbegeisterte sowie an Kommunen und
Tourismusverantwortliche, die Wegedaten des DZT Knowledge Graph für ihre Region visualisieren
wollen. Es sind keine besonderen Datenkenntnisse nötig – die Bedienung erfolgt über Karte, Liste
und die verbleibenden Filter (Schwierigkeit, Länge, Rundweg).

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

Beide Endpunkte ruft die App über den ODAS-DZT-Relay auf (`<app-url>/dzt?path=…`, siehe
„Datenzugriff über den ODAS-DZT-Relay" oben) — kein direkter Browser-`fetch` gegen
`proxy.opendatagermany.io` und kein `x-api-key`-Header in der App.

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

**Wegedaten gibt es bei Live Server nicht:** Der DZT-API-Key liegt seit der Umstellung auf den
ODAS-DZT-Relay nicht mehr in der App-Konfiguration, sondern ausschließlich serverseitig im ODAS
(siehe „Datenzugriff über den ODAS-DZT-Relay" oben). `<app-url>/dzt` existiert bei Live Server
nicht, deshalb bleibt der Datenabruf ohne Ergebnis — UI, Konfiguration und Fehlerbild lassen sich
trotzdem prüfen. Ein echter Testlauf mit Daten braucht eine laufende ODAS-Instanz, in der diese
App als Instanz gebucht ist (siehe „Auslieferung an den ODAS" unten).

### Aufbau der App
Der Inhaltsbereich wird in `app/app.js` erstellt. Dort sind der automatische Suchlauf aus der
Instanz-Konfiguration (Ort/Umkreis/Kategorie, SPARQL), die verbleibenden Filter, Paginierung,
Leaflet-Karte, Detailansicht mit Streckenlinie und Höhenprofil sowie JSON-LD-Export
implementiert. Zustand (Ergebnisse, Filterauswahl, Detail-Cache) bleibt über Seitenwechsel
hinweg im Speicher erhalten (`wwInstances`, siehe Kommentare in `app.js`) — `onPageLeave()` baut
nur die DOM-gebundenen Laufzeitressourcen (Karte, Höhenprofil-Chart) ab, nicht den Datenzustand.
Template-eigene Dateien (`app/app-base.js`, `app/app-base.css`, `app/index.html`) werden nicht
verändert. Leaflet und Chart.js werden dynamisch nachgeladen.

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
| `apiurl` | SPARQL-Endpunkt des DZT Knowledge Graph. Der Abruf läuft über den ODAS-DZT-Relay, der REST-Detailpfad wird automatisch aus derselben Origin abgeleitet. | ja |
| `urlDaten` | URL zur Zugriffsdokumentation des DZT Knowledge Graph | ja |
| `ort` | Ortsname, um den die Wege dieser Instanz gesucht werden (Nominatim-Geokodierung) | ja |
| `radiusKm` | Suchradius um den konfigurierten Ort (5/10/25/50/100 km) | ja |
| `kategorie` | Wegart dieser Instanz (Radweg/Fußwanderweg/Sonstige touristische Wege) | ja |
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
stammt nicht vom Open-Data-Portal, das die App betreibt; der ODAS-Proxy (`/odp-data`) löst den
Zielhost aber über den ODP-Host des betreibenden Portals auf. Bei abweichendem Host scheitert
jeder `odp-data`-Aufruf mit HTTP 500, ohne Rückfall auf Direktzugriff. Die App nutzt stattdessen
den separaten ODAS-DZT-Relay (`/dzt`, siehe „Datenzugriff über den ODAS-DZT-Relay" oben).

---

## Betriebsarten

Die App ist für den Betrieb über den ODAS vorgesehen (siehe „Datenzugriff über den
ODAS-DZT-Relay" oben) und kann daneben lokal oder eigenständig hinter einem
Traefik-Reverse-Proxy betrieben werden — dort allerdings ohne Wegedaten, weil der `/dzt`-Relay
nur innerhalb einer ODAS-Instanz existiert.

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
ausgeliefert. **Wegedaten liefert der Standalone-Betrieb nicht:** Der `/dzt`-Relay existiert nur
innerhalb einer ODAS-Instanz; ohne ihn bleibt der Datenabruf ergebnislos.

### Beim Aufruf kontaktierte Drittanbieter

Vom Browser aus werden beim Aufruf dieser App folgende externe Server kontaktiert:

- `nominatim.openstreetmap.org` — Ortssuche (Geokodierung)
- `tile.openstreetmap.org` — Kartenkacheln (OpenStreetMap)

Im ODAS-Live-Betrieb kontaktiert zusätzlich der Open Data App Store serverseitig
`proxy.opendatagermany.io` (DZT-Knowledge-Graph-Schnittstelle, Wegedaten, SPARQL + REST) — dieser
Zugriff findet nicht im Browser statt (siehe „Datenzugriff über den ODAS-DZT-Relay" oben). Diese
Anbieter bleiben auch im Standalone-Betrieb extern; ein vollständig autarker Betrieb ohne
Internetzugang ist derzeit nicht möglich. Alle Programmbibliotheken werden lokal aus
`app/vendor/` ausgeliefert und nicht extern geladen.

### Auslieferung an den ODAS

`make zip` erzeugt das Liefer-ZIP mit `app/`, `assets/`, `app-package.json` und
`CHANGELOG.md`. Die Infrastrukturdateien (`Dockerfile`, `docker-compose*.yml`,
`nginx.conf`, `Makefile`) sind nicht Teil der Auslieferung. Das ZIP ist ein Bauartefakt und wird
nicht mitversioniert, sondern bei Bedarf mit `make zip` erzeugt.

## Autor
© 2026, Ondics GmbH
