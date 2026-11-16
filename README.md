# Dienstplan Notaufnahme

Wochendienstplan für die Notaufnahme mit eigener Anmeldung und Rechteverwaltung.
Läuft auf einem eigenen Server und braucht keine Konten bei externen Diensten.

## Funktionen

- **Wochenplan nach Bereich:** Lieger A, Lieger B, Lieger C, Springer, Aufnahmestation sowie Aufnahme & Triage, jeweils mit Früh, Spät und Nacht. Personen werden pro Tag eingetragen.
- **Ansicht nach Person:** Urlaub, Krank, Fortbildung und Frei eintragen, mit Stundenbilanz.
- **Prüfungen:** Mindestbesetzung je Bereich und Schicht, Doppelbelegungen, Ruhezeit unter 11 Stunden, Einsätze trotz Abwesenheit.
- **Qualifikationen:** PFK, FWB, PH, SCH, PRA und FSJ als Kürzel im Plan.
- **Übersicht aller Wochen** eines Jahres mit Besetzungsgrad.
- **PDF-Export** (A4 quer).
- **Live-Aktualisierung:** Änderungen erscheinen sofort bei allen, die den Plan geöffnet haben.
- **Anmeldung** mit Benutzername und Passwort.
- **Drei Rollen:** Leitung, Planung, Lesen.
- **Protokoll** aller Anmeldungen und Änderungen.

## Rollen

| Rolle | Darf |
|---|---|
| **Leitung** | alles: Bereiche, Mindestbesetzung, Mitarbeitende, Benutzerkonten, Rollen, Passwörter zurücksetzen, Protokoll ansehen |
| **Planung** | Personen einteilen, Abwesenheiten eintragen, Vorwoche übernehmen, Woche leeren |
| **Lesen** | Übersicht und Wochenplan ansehen, PDF exportieren |

Alle können ihr eigenes Passwort ändern. Der Server prüft die Rolle bei jeder Anfrage. Ein Umgehen der Oberfläche hilft also nicht.

## Voraussetzungen

- **Node.js 22.13 oder neuer** (getestet mit 22.23). Die Datenbank nutzt das eingebaute `node:sqlite`, es muss nichts kompiliert werden.
- Etwa 100 MB Speicherplatz.

## Installation und Start

```bash
npm install
```

```bash
npm start
```

Danach ist die Anwendung unter `http://localhost:3000` erreichbar.

### Ersteinrichtung

Beim allerersten Start gibt es noch kein Konto. Der Server zeigt dann in seiner Ausgabe einen **Einrichtungscode** an, zum Beispiel:

```
 Ersteinrichtung: Es gibt noch kein Benutzerkonto.
 Öffne die Anwendung im Browser und gib diesen Einrichtungscode ein:
   528280-271885
```

So geht es weiter:

1. Öffne die Anwendung im Browser.
2. Gib den Code ein und lege das erste **Leitungskonto** an.
3. Lege unter **„Benutzer“** die weiteren Konten an. Jedes neue Konto bekommt ein Einmalpasswort.
4. Gib das Einmalpasswort der Person persönlich weiter. Beim ersten Anmelden muss sie ein eigenes Passwort festlegen (mindestens 10 Zeichen).

Die sechs Bereiche der Notaufnahme sind schon angelegt. Mindestbesetzung und Kürzel lassen sich im Wochenplan unter „Bereiche“ ändern.

## Einstellungen (Umgebungsvariablen)

| Variable | Standard | Bedeutung |
|---|---|---|
| `PORT` | `3000` | Port des Servers |
| `HOST` | `0.0.0.0` | Netzwerkadresse. Mit `127.0.0.1` ist der Server nur lokal erreichbar, zum Beispiel hinter einem Reverse Proxy. |
| `DATA_DIR` | `./data` | Ordner für die Datenbank `dienstplan.db` |
| `SESSION_HOURS` | `12` | Wie lange eine Anmeldung ohne Aktivität gültig bleibt |
| `NODE_ENV` | – | Bei `production` werden Cookies nur über HTTPS gesendet |
| `COOKIE_SECURE` | – | `1` oder `0` setzt das unabhängig von `NODE_ENV` |
| `TRUST_PROXY` | – | `1`, wenn ein Reverse Proxy (nginx, Caddy) davor läuft. Dann wird die echte Client-IP für den Schutz gegen Passwort-Ausprobieren genutzt. |

## Betrieb im Klinik-Netz (empfohlen: mit HTTPS)

Passwörter dürfen nicht unverschlüsselt durchs Netz gehen. Betreibe die Anwendung deshalb hinter einem Reverse Proxy mit HTTPS. Ein Beispiel mit **Caddy**, das Zertifikate automatisch holt:

```
dienstplan.klinik.example {
    reverse_proxy 127.0.0.1:3000
}
```

Die Anwendung startest du dann mit diesen Einstellungen:

```bash
NODE_ENV=production TRUST_PROXY=1 HOST=127.0.0.1 npm start
```

Für **nginx** brauchst du zusätzlich `proxy_buffering off;` für `/api/events`, sonst funktioniert die Live-Aktualisierung nicht.

### Als Dienst unter Linux (systemd)

```ini
[Unit]
Description=Dienstplan Notaufnahme
After=network.target

[Service]
WorkingDirectory=/opt/dienstplan-zna
ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning server.js
Environment=NODE_ENV=production TRUST_PROXY=1 HOST=127.0.0.1 PORT=3000
User=dienstplan
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Den Einrichtungscode beim ersten Start findest du dann mit:

```bash
journalctl -u dienstplan-zna
```

### Mit Docker

```bash
docker build -t dienstplan-zna .
```

```bash
docker run -d --name dienstplan -p 127.0.0.1:3000:3000 -v dienstplan-daten:/data -e TRUST_PROXY=1 dienstplan-zna
```

Den Einrichtungscode zeigt dieser Befehl:

```bash
docker logs dienstplan
```

## Datensicherung

Alle Daten liegen in einer Datei: `data/dienstplan.db`. Eine Sicherung im laufenden Betrieb erstellst du so:

```bash
npm run backup
```

Die Sicherung landet in `data/backups/`. Mit `npm run backup -- /pfad/zum/ordner` wählst du einen anderen Zielordner. Richte das am besten als täglichen Cron-Job ein und kopiere die Sicherungen auf ein anderes Laufwerk.

**Wiederherstellen:** Server stoppen, die Sicherungsdatei als `data/dienstplan.db` zurückkopieren, dann `dienstplan.db-wal` und `dienstplan.db-shm` löschen, falls vorhanden, und den Server wieder starten.

## Passwort vergessen

- **Normale Konten:** Die Leitung setzt das Passwort unter „Benutzer“ zurück und gibt das neue Einmalpasswort weiter.
- **Notfall, wenn kein Leitungskonto mehr zugänglich ist:** direkt auf dem Server ausführen:

```bash
npm run reset-password -- benutzername
```

## Sicherheit und Datenschutz

- **Passwörter** werden nur als scrypt-Hash mit Salt gespeichert, nie im Klartext.
- **Sitzungen:** zufälliges Token in einem `HttpOnly`- und `SameSite=Strict`-Cookie. In der Datenbank liegt nur ein Hash davon.
- **Schutz gegen Ausprobieren:** Nach 8 Fehlversuchen wird die Anmeldung für 15 Minuten gesperrt.
- **Schutz gegen fremde Seiten (CSRF):** Jede Änderung braucht einen eigenen Header, zusätzlich zum `SameSite`-Cookie.
- **Sicherheits-Header:** Content-Security-Policy erlaubt nur eigene Skripte. Die Seite kann nicht in fremde Seiten eingebettet werden.
- **Keine externen Abrufe:** Schriften und PDF-Bibliothek liefert der eigene Server aus. Es gibt keine Verbindung zu Google oder CDNs, was für die DSGVO relevant ist.
- **Deaktivierte oder gelöschte Konten** werden sofort abgemeldet.
- **Mindestens ein aktives Leitungskonto** bleibt immer bestehen.
- **Protokoll:** Anmeldungen, Fehlversuche und alle Änderungen am Plan und an den Konten werden mit Zeit und Benutzer festgehalten.
- **Dienstpläne mit Krankmeldungen sind personenbezogene Daten.** Stimme den Betrieb mit eurer IT und dem Datenschutzbeauftragten ab: Server-Standort, Zugriff, Sicherungen und Löschfristen.

## Aufbau

```
server.js            Server, API, Rechteprüfung
db.js                Datenbank-Schema und Startwerte
auth.js              Passwort-Hashing, Tokens, Einmalpasswörter
public/index.html    Oberfläche
public/app.js        Logik der Oberfläche
public/app.css       Gestaltung
scripts/backup.js    Datensicherung
scripts/reset-password.js  Notfall-Passwort
```
