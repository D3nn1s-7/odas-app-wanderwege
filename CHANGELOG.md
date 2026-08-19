# Changelog

## 1.1.1 - 2026-08-19
- FIX: Klick auf einen Kartenmarker öffnete die Detailansicht nur, wenn der Weg zufällig auf
  der aktuell sichtbaren Listenseite lag. `scrollToTrail()` springt jetzt zuerst auf die
  richtige Seite, bevor Detailansicht und Streckenlinie geladen werden.

## 1.1.0 - 2026-08-19
- BREAKING: Ort, Umkreis und Kategorie sind jetzt Instanz-Konfiguration (`ort`, `radiusKm`,
  `kategorie`) statt Nutzer:inneneingabe — kein Suchfeld, kein Radius-Dropdown, kein
  Art-Filter und kein „Standort verwenden“-Button mehr im UI
- ENH: Automatischer Suchlauf beim Erstaufruf einer Instanz aus der konfigurierten Ortsangabe
- ENH: Zustand (Ergebnisse, Filterauswahl, Detail-Cache) überlebt Seitenwechsel — kein
  erneuter API-Abruf beim Zurückkehren zur Startseite
- ENH: Automatisch generierter Erklärtext aus Ort/Umkreis/Kategorie
- ENH: KPI-Kachel „Arten“ entfernt (wäre bei fester Kategorie immer „1“ gewesen)

## 1.0.0 - 2026-08-19
- Erste Version: Umkreissuche nach Wander- und Radwegen (odta:Trail) im DZT Knowledge Graph
- Ortssuche (Nominatim) und Standort-Button mit wählbarem Umkreis
- SPARQL-Geo-Umkreisabfrage liefert Name, Länge, Schwierigkeit, Dauer, Rundweg-Kennzeichen und Art je Treffer in einem Request
- KPI-Kacheln, Filter nach Art/Schwierigkeit/Länge/Rundweg, Kartenmarker, paginierte Liste
- Detailansicht mit Streckenlinie auf der Karte, Höhenprofil (wenn Höhendaten vorliegen) und ODTA-konformem JSON-LD-Export
