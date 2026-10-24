# Rezeptkartei

Eine minimalistische Web-App fürs iPhone (installierbar über „Zum Home-Bildschirm“):

- **Rezept einfügen** – Text von einer Webseite kopieren, „Text einfügen & erkennen“ tippen. Titel, Infos, Zutaten, Zubereitung und Tipps werden automatisch erkannt.
- **Automatisches Layout** – jedes Rezept wird auf eine DIN-A5-Karte gesetzt, immer mit denselben Schriften. Passt es nicht ganz, wird die Schrift leicht verkleinert; ist es lang, läuft es automatisch auf die Rückseite weiter.
- **Sparsam drucken** – je zwei Karten kommen auf ein A4-Blatt (quer). Zweiseitige Karten werden zusammen gruppiert, die Rückseiten werden passend für doppelseitigen Druck angeordnet. Danach in der Mitte durchschneiden.
- **Karteikasten** – Suche über Titel, Zutaten und Text, Filter nach Stichwörtern und „Ungedruckt“.
- **PDF-Import** – vorhandene Rezept-PDFs (auch mehrere auf einmal) einlesen; der Text wird übernommen, das Original bleibt am Rezept gespeichert. PDFs, die mit der App erstellt wurden, enthalten die Rezeptdaten und werden 1:1 wieder eingelesen.
- **Backup / Teilen** – alle Rezepte als Datei exportieren und z. B. per AirDrop auf das andere iPhone übertragen (wird zusammengeführt).

Alles läuft lokal im Browser, es gibt keinen Server und kein Konto. Die Rezepte liegen auf dem jeweiligen Gerät.

## Installation auf dem iPhone

1. Die App muss einmal irgendwo per HTTPS erreichbar sein, z. B. über **GitHub Pages**
   (Repository → Settings → Pages → „Deploy from a branch“, Branch auswählen, Ordner `/ (root)`).
   Die App liegt dann unter `https://<benutzer>.github.io/<repo>/recipe-app/`.
2. Die Adresse in **Safari** öffnen → Teilen-Symbol → **„Zum Home-Bildschirm“**.
3. Ab dann startet sie wie eine normale App und funktioniert auch offline.

## Drucken

1. „Drucken“ → Rezepte auswählen (standardmäßig alle ungedruckten) → „Druckbogen erstellen“.
2. „Teilen / Drucken“ → im iOS-Menü „Drucken“ → **Doppelseitig** einschalten.
3. Beim ersten Mal unter Einstellungen den **Testbogen** drucken und prüfen, ob die Rückseiten richtig stehen. Falls nicht, „links/rechts tauschen“ bzw. „um 180° drehen“ anpassen.

## Eigenes Layout

Das Aussehen der Karte steht komplett in `js/layout.js` im Objekt `LAYOUT` (Ränder, Schriften, Größen, Farben, Überschriften). Eigene Schriften können als TTF-Dateien in `fonts/` abgelegt und unter `customFonts` eingetragen werden.

Nach Änderungen in `sw.js` die `VERSION` erhöhen, damit installierte Apps das Update laden.

## Technik

Reines HTML/CSS/JavaScript ohne Build-Schritt. Mitgeliefert in `vendor/`: [jsPDF](https://github.com/parallax/jsPDF) 2.5.2 (PDF-Erzeugung) und [PDF.js](https://github.com/mozilla/pdf.js) 3.11.174 (Vorschau und Import). Lokal testen: `python3 -m http.server` im Ordner `recipe-app` und `http://localhost:8000` öffnen.
