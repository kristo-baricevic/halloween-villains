# Halloween Sweet Sixteen

A Halloween villain tournament with 21 contenders, individual voting, a full bracket, and host controls. Built as a Node.js npm-workspaces monorepo with no third-party runtime dependencies.

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
- One ballot per matchup per browser; voters can change their pick while voting is open. Counts remain hidden from voters until the round closes.

This is a casual poll, not identity-verified voting. Another browser or clearing cookies permits another ballot. No voter names or emails are collected. Nominations are a fixed snapshot; no Google credentials, nominator names, or submission timestamps are included.

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
