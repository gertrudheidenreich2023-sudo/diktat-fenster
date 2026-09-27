# Diktat-Fenster v0.1 – Einrichtung und Test

## 1. Auf GitHub Pages veröffentlichen

Auf github.com ein neues **öffentliches** Repository `diktat-fenster` anlegen (leer, ohne README). Dann in Crostini:

```sh
cd ~/projekte
unzip ~/Downloads-Pfad/diktat-fenster-v0.1.zip   # Pfad anpassen
cd diktat-fenster
git init -b main
git add .
git commit -m "Diktat-Fenster v0.1"
git remote add origin https://github.com/gertrudheidenreich2023-sudo/diktat-fenster.git
git push -u origin main
```

(Mit installiertem GitHub-CLI geht alles in einem Schritt: `gh repo create diktat-fenster --public --source=. --push`)

Auf GitHub: Repository → Settings → Pages → „Deploy from a branch" → Branch `main`, Ordner `/ (root)` → Save.
Nach ein bis zwei Minuten ist die Seite erreichbar unter:
https://gertrudheidenreich2023-sudo.github.io/diktat-fenster/

Der API-Schlüssel steht **nicht** im Code, sondern nur lokal im Browser.

## 2. Als App installieren

1. Die Adresse in Chrome öffnen.
2. Chrome-Menü ⋮ → „Streamen, speichern und teilen" → „Seite als App installieren" (als Fenster öffnen).
3. Im Diktat-Fenster „Einstellungen und Verlauf" aufklappen: Schlüssel eintragen, Speichern, „Mikrofon freigeben".
4. Die App in der Ablage anheften und an Position 1 ziehen → Alt+1 öffnet sie. (Andere Position = Alt+2 usw.)
5. Fenster eher klein ziehen, ChromeOS merkt sich die Größe.

## 3. Bedienung

- **Alt+1** → Fenster öffnet sich, Aufnahme startet sofort (roter, pulsierender Kreis).
- **Leertaste oder Enter** → fertig; Text geht in die Zwischenablage, Fenster schließt sich.
- **Strg+V** in der App.
- **Esc** → Aufnahme abbrechen, nichts wird kopiert.

## 4. Testliste

1. Aus der Gmail-App: Öffnet Alt+1 das Fenster, und startet die Aufnahme ohne Klick?
2. Sind die Signaltöne zu hören? (Ohne Klick blockiert Chrome sie eventuell – nicht schlimm.)
3. Leertaste: Erscheint „In der Zwischenablage"?
4. Schließt sich das Fenster von selbst?
5. Bist du danach wieder in der Gmail-App (hat sie den Fokus)?
6. Strg+V: Kommt der Text an?
7. Dasselbe in der WhatsApp-App und in Keep.
8. Falls sich das Fenster nicht schließt: Startet Alt+1 bei offenem Fenster eine neue Aufnahme?
9. Esc während der Aufnahme: Bricht es ab, ohne die Zwischenablage zu ändern?
10. Wie lange dauert der ganze Ablauf gefühlt, von Alt+1 bis Strg+V?

## 5. Notizen speichern (ab v0.4)

- **Leertaste** → Text nur in die Zwischenablage (wie bisher).
- **Enter** → Text in die Zwischenablage **und** als Notiz gespeichert: eine Textdatei pro Diktat, benannt nach Datum und Uhrzeit (z. B. `2026-09-27_14-32-05.txt`). Drei aufsteigende Töne bestätigen das Speichern.
- **Beim ersten Enter** öffnet sich die Ordnerauswahl: unter „Meine Dateien" mit „Neuer Ordner" einen Ordner `Diktate` anlegen, auswählen, bestätigen. Fragt Chrome nach dem Zugriff, **„Bei jedem Besuch zulassen"** wählen.
- **Taste N** (oder Klick auf „Notizen") → Übersicht aller Notizen, neueste oben. Klick auf den Text klappt ihn auf. Knöpfe: Kopieren, Löschen. Eine laufende Aufnahme wird dabei abgebrochen, das Fenster bleibt offen.
- Die Dateien lassen sich auch direkt in der Dateien-App öffnen, verschieben oder löschen. Die Übersicht zeigt immer den aktuellen Inhalt des Ordners (auch `.md`-Dateien).
- Falls Chrome die Freigabe einmal vergisst: In „Notizen" auf „Ordner freigeben" klicken. Bis dahin wird mit Enter nur kopiert, und das Fenster zeigt „Nicht gespeichert – nur in der Zwischenablage".

### Test v0.4

1. Erstes Diktat mit Enter: Öffnet sich die Ordnerauswahl? Nach der Auswahl: „Gespeichert und in der Zwischenablage", drei Töne?
2. Liegt die Datei im Ordner, und stimmt ihr Inhalt?
3. Strg+V in der Ziel-App: Kommt der Text an?
4. Zweites Diktat mit Enter: Keine Rückfrage mehr?
5. Diktat mit Leertaste: Nur kopiert, keine neue Datei?
6. Alt+1, dann N: Wird die Aufnahme abgebrochen und die Übersicht gezeigt?
7. Kopieren und Löschen in der Übersicht ausprobieren.
8. Chromebook neu starten, dann Diktat mit Enter: Wird ohne Rückfrage gespeichert?
