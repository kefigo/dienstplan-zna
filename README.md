# Dienstplan Notaufnahme

Wochendienstplan für die Notaufnahme als reine Website: HTML, CSS und JavaScript. Kein Server, keine Datenbank. Mit PIN-Anmeldung und Rollen.

## Funktionen

- **Wochenplan nach Bereich:** Lieger A, Lieger B, Lieger C, Springer, Aufnahmestation sowie Aufnahme & Triage, jeweils mit Früh, Spät und Nacht. Personen werden von Montag bis Sonntag eingetragen.
- **Ansicht nach Person:** Urlaub, Krank, Fortbildung und Frei eintragen, mit Stundenbilanz gegen die Vertragsstunden.
- **Prüfungen:** Mindestbesetzung je Bereich und Schicht, Doppelbelegungen, Ruhezeit unter 11 Stunden, Einsätze trotz Abwesenheit.
- **Qualifikationen** als Kürzel im Plan: PFK, FWB, PH, SCH, PRA, FSJ.
- **Übersicht aller Kalenderwochen** eines Jahres mit Besetzungsgrad.
- **Vorwoche übernehmen** und **Woche leeren**.
- **PDF-Export** (A4 quer, nach Bereich und nach Person).
- **Sicherung herunterladen** und **Sicherung laden** (JSON-Datei).
- **Anmeldung mit PIN** und drei Rollen, mit Protokoll aller Änderungen.

## Anmeldung und Rechte

**Beim ersten Öffnen** legst du den ersten Zugang für die Leitung an: Name und PIN mit 4 bis 8 Ziffern.

**Anmelden:** Namen antippen und die PIN über das Zahlenfeld oder die Tastatur eingeben.

**Rollen:**

| Rolle | Darf |
|---|---|
| **Leitung** | alles: Bereiche, Mindestbesetzung, Mitarbeitende, Zugänge und Rollen, PINs zurücksetzen, Protokoll, Sicherung herunterladen und laden |
| **Planung** | Personen einteilen, Urlaub/Krank/Fortbildung/Frei eintragen, Vorwoche übernehmen, Woche leeren |
| **Lesen** | Übersicht und Wochenplan ansehen, PDF exportieren |

Alle können ihre eigene PIN ändern.

**Neue Zugänge** legt die Leitung unter „Benutzer“ an:

- Die Person bekommt eine vorläufige 6-stellige PIN. Beim ersten Anmelden muss sie eine eigene PIN festlegen.
- Ein Zugang kann mit einem Eintrag unter „Mitarbeitende“ verknüpft werden. Dann sind die eigenen Dienste hervorgehoben.

**Schutzfunktionen:**

- Nach 5 falschen PINs wird der Zugang für 5 Minuten gesperrt.
- Nach 15 Minuten ohne Aktivität wird automatisch abgemeldet.
- Zu leichte PINs wie `1111` oder `1234` werden abgelehnt.
- Es bleibt immer mindestens ein aktiver Zugang mit der Rolle Leitung bestehen.

**Protokoll:** Anmeldungen, Fehlversuche und alle Änderungen werden mit Zeit und Name festgehalten. Die Leitung sieht es unter „Benutzer“.

**Wichtig – was die PIN leistet und was nicht:** Die Website läuft ohne Server komplett im Browser.

- **Schutz:** Die PIN schützt gut vor versehentlichen oder unbefugten Änderungen, zum Beispiel an einem gemeinsam genutzten Stations-PC.
- **Kein echter Datenschutz:** Wer technisch auf den Speicher dieses Browsers zugreift, kann die Daten trotzdem auslesen. Das geht zum Beispiel über die Entwicklerwerkzeuge oder mit einer Sicherungsdatei.
- **Speicherung der PINs:** PINs werden nur als gesalzener Hash gespeichert, nie im Klartext.

Für echten Zugriffsschutz braucht es einen Server. Die Server-Version mit Benutzername und Passwort liegt im Branch `main`.

**PIN der letzten Leitung vergessen:** Dann hilft nur eine Sicherung, deren Leitungs-PIN bekannt ist. Andernfalls musst du die Website-Daten im Browser löschen, dann ist alles weg. Lege deshalb früh einen zweiten Zugang mit der Rolle Leitung an.

## Benutzen

**Direkt öffnen:** `index.html` im Browser öffnen, per Doppelklick oder in den Browser ziehen. Es wird nichts installiert.

**Auf einen Webspace legen:** Den ganzen Ordner hochladen, also `index.html`, `css/`, `js/`, `fonts/` und `vendor/`. Jeder normale Webspace reicht, auch GitHub Pages.

## Wo die Daten liegen

Alle Daten (Bereiche, Mitarbeitende, Wochen) speichert die Website **im Speicher des Browsers auf diesem Gerät** (`localStorage`). Daraus folgt:

- **Andere Geräte sehen die Daten nicht.** Auch andere Browser und andere Personen auf demselben Gerät mit eigenem Benutzerkonto sehen sie nicht.
- **Daten gehen verloren,** wenn der Browserverlauf beziehungsweise die Website-Daten gelöscht werden. Im privaten Fenster wird gar nichts dauerhaft gespeichert.
- **Regelmäßig sichern:** Unten im Wochenplan gibt es für die Leitung „Sicherung herunterladen“. Die JSON-Datei enthält alles, auch die Zugänge mit ihren PIN-Hashes und das Protokoll. Bewahre sie geschützt auf.
- **Auf ein anderes Gerät übertragen oder wiederherstellen:** Dort als Leitung „Sicherung laden …“ wählen und die Datei auswählen. Das ersetzt alle Daten in diesem Browser, auch die Zugänge. Auf einem neuen Gerät legst du dazu zuerst einen beliebigen Leitungszugang an, lädst dann die Sicherung und meldest dich mit den alten Zugängen an.
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
