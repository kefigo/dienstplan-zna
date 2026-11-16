# Dienstplan Notaufnahme

Wochendienstplan für die Notaufnahme als reine Website: HTML, CSS und JavaScript. Kein Server, keine Datenbank, keine Anmeldung.

## Funktionen

- **Wochenplan nach Bereich:** Lieger A, Lieger B, Lieger C, Springer, Aufnahmestation sowie Aufnahme & Triage, jeweils mit Früh, Spät und Nacht. Personen werden von Montag bis Sonntag eingetragen.
- **Ansicht nach Person:** Urlaub, Krank, Fortbildung und Frei eintragen, mit Stundenbilanz gegen die Vertragsstunden.
- **Prüfungen:** Mindestbesetzung je Bereich und Schicht, Doppelbelegungen, Ruhezeit unter 11 Stunden, Einsätze trotz Abwesenheit.
- **Qualifikationen** als Kürzel im Plan: PFK, FWB, PH, SCH, PRA, FSJ.
- **Übersicht aller Kalenderwochen** eines Jahres mit Besetzungsgrad.
- **Vorwoche übernehmen** und **Woche leeren**.
- **PDF-Export** (A4 quer, nach Bereich und nach Person).
- **Sicherung herunterladen** und **Sicherung laden** (JSON-Datei).

## Benutzen

**Direkt öffnen:** `index.html` im Browser öffnen, per Doppelklick oder in den Browser ziehen. Es wird nichts installiert.

**Auf einen Webspace legen:** Den ganzen Ordner hochladen, also `index.html`, `css/`, `js/`, `fonts/` und `vendor/`. Jeder normale Webspace reicht, auch GitHub Pages.

## Wo die Daten liegen

Alle Daten (Bereiche, Mitarbeitende, Wochen) speichert die Website **im Speicher des Browsers auf diesem Gerät** (`localStorage`). Daraus folgt:

- **Andere Geräte sehen die Daten nicht.** Auch andere Browser und andere Personen auf demselben Gerät mit eigenem Benutzerkonto sehen sie nicht.
- **Daten gehen verloren,** wenn der Browserverlauf beziehungsweise die Website-Daten gelöscht werden. Im privaten Fenster wird gar nichts dauerhaft gespeichert.
- **Regelmäßig sichern:** Unten auf der Seite gibt es „Sicherung herunterladen“. Die JSON-Datei enthält alles.
- **Auf ein anderes Gerät übertragen oder wiederherstellen:** Dort „Sicherung laden …“ wählen und die Datei auswählen. Das ersetzt die Daten in diesem Browser.
- **Mehrere Tabs** im selben Browser bleiben automatisch auf dem gleichen Stand.

Gemeinsames Planen mehrerer Personen gleichzeitig ist damit nicht möglich. Eine Person plant und gibt den Plan als PDF weiter.

## Datenschutz

- Die Website lädt nichts aus dem Internet. Schriften und die PDF-Bibliothek liegen im Ordner selbst. Es gibt keine Verbindung zu Google oder CDNs.
- Die Daten verlassen den Browser nur, wenn du eine Sicherung oder ein PDF herunterlädst.
- **Dienstpläne mit Krankmeldungen sind personenbezogene Daten.** Bewahre Sicherungsdateien und PDFs entsprechend geschützt auf.

## Aufbau

```
index.html   Oberfläche
css/app.css  Gestaltung und Schriften
js/app.js    Logik, Speicherung, PDF, Sicherung
fonts/       IBM Plex (SIL Open Font License)
vendor/      jsPDF und jsPDF-AutoTable (MIT-Lizenz)
```
