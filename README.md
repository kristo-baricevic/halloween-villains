# Halloween Sweet Sixteen

A Halloween villain tournament with 21 contenders, individual voting, a full bracket, and host controls. Built as a Node.js npm-workspaces monorepo with SQLite for local use and PostgreSQL for Vercel.

## Packages

| Workspace | Purpose |
| --- | --- |
| `apps/web` | Browser interface, nomination cards, voting, and bracket visualization |
| `apps/api` | Node HTTP server, signed voter cookies, host authentication, and SQLite persistence |
| `packages/tournament` | Roster, wildcard selection, bracket generation, and round transitions |

## Run

Requires Node **22.15+** (Node 24 recommended) and npm. Node 22 may print an experimental SQLite warning.

```sh
npm ci
npm start
```

Open http://localhost:8765. Open the private URL written to `data/host-url.txt` to unlock host controls. Do not share that URL or the host key. Voters use the base URL.

`npm run dev` restarts the API when server files change. Reload the browser after frontend changes. `npm run check` checks syntax; `npm test` runs domain and HTTP integration tests using disposable databases.

If your workspace requires RTK, prefix these commands with `rtk proxy`.

## Tournament rules

- The six pairs belonging to people with two nominations are split randomly: one wildcard entrant and one guaranteed bye per pair.
- Four of the remaining nine contenders are randomly selected for the other wildcard spots. The other five get byes.
- Ten contenders play five wildcard matches. Their winners join eleven byes in the Sweet 16, followed by the Elite 8, Final Four, and championship.
- Every shuffle preserves the paired-nomination rule. Shuffling is only available before voting starts.
- The host opens and closes rounds. The higher vote count wins; ties (including 0–0) need an explicit host choice. The current closed round can be reopened before advancing.
- Picks stay local until the voter enters a name and submits the complete round ballot. Each browser can submit once per round; submitted picks cannot be changed. Counts remain hidden from voters until the round closes.

This is a casual poll, not identity-verified voting. Another browser or clearing cookies permits another ballot. A name is required when submitting a complete round ballot. Names, normalized names, and submission times are stored privately for later duplicate review; names are not verified identities. Emails are not collected. Nominations are a fixed snapshot; no Google credentials, nominator names, or submission timestamps are included.

## Character images

`apps/web/public/villain-images.json` maps all 21 roster IDs to local image paths, alt text, source pages, download URLs, retrieval dates, dimensions, MIME types, and SHA-256 checksums. The original downloaded image bytes are stored in `apps/web/public/images/villains/`; the app serves them locally rather than hotlinking to third-party websites. See each source page for image credits and rights. The manifest does not assert a blanket reuse license for film stills or character artwork.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8765` | Listening port |
| `HOST` | `127.0.0.1` | Bind address; use `0.0.0.0` in a container |
| `DATA_DIR` | repository `data/` | Persistent SQLite database and host key |
| `COOKIE_SECURE` | `false` | Set `true` when users access the app through HTTPS |

Set environment variables through your shell or hosting platform. `.env.example` is a reference; `.env` is not automatically loaded. Keep `data/` persistent and private. A fresh directory creates a new tournament and host key. Back up the whole directory while the app is stopped.

The database schema and signed cookies are compatible with the original Python app. To migrate, stop that app, back up its data directory, and point `DATA_DIR` at the same directory. Existing bracket selections, votes, and host credentials are retained. Run only one application instance against that directory.

## Hosting

GitHub hosts this source repository and runs CI. **GitHub Pages cannot host the Node voting API or SQLite database.** A public voting deployment requires a Node host or container service with HTTPS and a persistent writable disk.

A Dockerfile is included:

```sh
docker build -t halloween-villains .
docker run --rm -p 8765:8765 -v halloween-data:/app/data halloween-villains
```

Deploy one instance, mount a persistent volume at `/app/data`, and set `COOKIE_SECURE=true` behind the host's HTTPS proxy. Use `/healthz` for health checks. Retrieve `host.key` from the private volume and open `https://YOUR_HOST/host#YOUR_HOST_KEY` once to unlock host controls. The fragment is removed from the address bar after use. Never put the key in the repository or share the host link.

Neither creating this repository nor running CI deploys a public voting service. The Docker deployment configuration is supplied but must be tested on the chosen host.

## Vercel deployment

Import this repository with the **Other** framework preset and the repository root as the Root Directory. The checked-in `vercel.json` serves the frontend and images statically and sends API requests to `api/index.js`.

Connect a Neon PostgreSQL database on its Free plan through the project's Storage tab. Set `DATABASE_URL` and a private, random `HOST_KEY` (at least 32 characters) for **Production**. Never expose either variable with a public prefix. Vercel requests use secure cookies automatically.

PostgreSQL creates the tables on first API use and seeds the existing 21-person draw from `apps/api/src/initial-state.json`. Subsequent deployments preserve votes and bracket progress. All ballot writes and host transitions lock the tournament row within a transaction to prevent a close-round race. State reads use a consistent snapshot. Preview deployments should use a separate database and host key.

The public UI intentionally omits host controls. Round transitions still require the private host API; publishing does not open voting or advance a round.

Local development continues to use SQLite. To run the HTTP test suite against PostgreSQL as well, supply `TEST_DATABASE_URL` pointing only to a disposable test database: the test suite resets its `halloween_state`, `halloween_votes`, and `halloween_ballot_names` tables. Never use the event database for tests.
