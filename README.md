# Neo4j CLI Tool – Fußball Community

Ein Node.js CLI-Tool zur Verwaltung und Visualisierung einer Fußball-Community mit verschiedenen Benutzerrollen: **Fan**, **Verein**, **Journalist** und **Admin**.  
Die Anwendung basiert auf einer **Neo4j-Datenbank** und ermöglicht Interaktionen wie **Beitragsveröffentlichungen, Kommentare, Likes, Freundschaftsanfragen** und mehr.

## Voraussetzungen

### Neo4j Desktop

Bitte installieren Sie [**Neo4j Desktop**](https://neo4j.com/download/) – die grafische Oberfläche zur Verwaltung Ihrer lokalen Neo4j-Datenbank.

### Node.js

Stellen Sie sicher, dass **Node.js v20.x (LTS)** installiert ist:

```bash
node -v
```

## Neo4j-Datenbank einrichten

1. Öffnen Sie **Neo4j Desktop**.
2. Klicken Sie auf **"New" → "Create Project"**, um ein neues Projekt zu erstellen.
3. Wählen Sie im Projekt **"Add" → "Local DBMS"** und tragen Sie folgende Daten ein:
   - **Name:** `neo4j`
   - **Passwort:** `DHBW1234`
4. Klicken Sie auf **Start**, um die Datenbank zu starten.
5. (Optional) Klicken Sie auf **Open**, um die grafische Benutzeroberfläche zu öffnen und die Datenstruktur zu prüfen.

> **Hinweis:** Die Datenbank muss aktiv (gestartet) sein, bevor das CLI-Tool verwendet werden kann.


## Projekt starten

1. Repository clonen oder ZIP-Datei herunterladen.
2. Navigieren Sie in das Projektverzeichnis und führen Sie im Terminal aus:

```bash
npm install
```

## Alle verfügbaren Terminal-Befehle

Führen Sie nach Start der Datenbank folgende Befehle im integrierten Terminal (z. B. in **VS Code**) aus:

```bash
node neo4j-cli.js logout            # Melden Sie sich ab.
node neo4j-cli.js create-user       # Erstellen Sie einen neuen Benutzer.
node neo4j-cli.js login-user        # Melden Sie sich an.
node neo4j-cli.js list-users        # Lassen Sie sich alle Benutzer anzeigen (nur als Admin möglich)
node neo4j-cli.js post-actions      # Erstellen Sie einen neuen Beitrag.
node neo4j-cli.js list-posts        # Lassen Sie sich alle Beiträge anzeigen.
node neo4j-cli.js list-clubs        # Lassen Sie sich alle Vereine anzeigen (nur als Admin möglich)
node neo4j-cli.js delete-post       # Löschen Sie einen Beitrag.
node neo4j-cli.js like-post         # Liken Sie einen Beitrag.
node neo4j-cli.js admin-view        # Lassen Sie sich die Datenbank als Graph in neo4j anzeigen (nur als Admin möglich)
node neo4j-cli.js add-friend        # Senden Sie eine Freundschaftsanfrage.
node neo4j-cli.js check-requests    # Prüfen Sie Ihre Freundschaftsanfragen.
node neo4j-cli.js create-admin      # Erstellen Sie einen Admin-Account.
```

> **Hinweis:** Für die meisten Funktionen ist ein Login erforderlich. Die verfügbaren Optionen richten sich nach Ihrer Rolle (Fan, Verein, Journalist, Admin).

