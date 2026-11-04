# Scaling demo VM deployment

This setup targets only the `game-platform-scaling` VM in project
`project-c9ca4f0b-4e47-43ff-847`. It uses the separate `game-platform-scaling`
Firestore database. It does not deploy to or alter the production `game-platform` VM.

The API binds to `127.0.0.1:8000`. Nginx serves the portal's static files and
terminates HTTPS on the VM's public IP, forwarding API requests to localhost.
Open the portal at:

<https://34.26.223.67/portal>

The VM uses a reserved external IPv4 address. Its Let's Encrypt IP certificate lasts
160 hours; a systemd timer checks renewal every six hours and reloads Nginx after a
successful renewal. Nginx redirects port 80 to HTTPS and serves only the `static/`
assets directly. The app's `debug_tools` setting stays off, the builder agent has its
own authenticated API route, and port 8000 remains bound to localhost.

The agent key is stored in Secret Manager as
`game-platform-scaling-model-api-key`. The scaling VM service account has access to
that secret only. Its systemd start wrapper fetches version 1 using the VM identity,
sets `MUSE_SPARK_API_KEY` in the API process, and does not write the key to disk.
Update the pinned secret version in the wrapper when rotating the key.

To seed the scaling catalog without copying accounts, matches, drafts, or agent
conversations, stream the output of `copy_published_games.py export --config
<production-config>` into `copy_published_games.py import --config <scaling-config>`.
The export includes active published games, every stored version, and both client and
server code. Run the importer with `--dry-run` first; it refuses to overwrite a
different game that already uses the same ID.

The VM's systemd unit is `game-platform-scaling.service`; its config is
`/home/zachary/game_platform/config.scaling.json`, and its Firestore database is
`game-platform-scaling`. The VM service account has the Firestore user role. Inspect
the service with:

```bash
gcloud compute ssh game-platform-scaling \
  --project=project-c9ca4f0b-4e47-43ff-847 \
  --zone=us-east1-b \
  --command='sudo systemctl status game-platform-scaling --no-pager'
```

This VM currently runs one API process. The Firestore store in this branch still loads
the full database into process memory, so adding another instance against this database
would not yet be safe. The scale benchmark should wait for request-time persistence and
bounded list APIs.

## Synthetic month of scaling data

`seed_scaling_data.py` adds fake accounts, placeholder games, matches, and match moves
to the scaling database. Its defaults add 1,000 users, 100 games, and 10,000 matches
spread across the preceding 30 days, with finished, ongoing, and waiting matches.
IDs, names, email addresses, and game code are clearly synthetic. Email addresses use
the reserved `.invalid` domain. The tool writes directly to Firestore and makes no
builder or model API calls.

Run a local generation-only preview first:

```bash
python deploy/seed_scaling_data.py --dry-run
```

Copy the tool to the scaling VM, then run it while the API service is stopped so the
running process cannot serve stale in-memory data. The tool verifies its configured
project and database, checks for existing IDs, and refuses to reuse a seed run ID:

```bash
gcloud compute scp deploy/seed_scaling_data.py \
  game-platform-scaling:/home/zachary/game_platform/deploy/ \
  --project=project-c9ca4f0b-4e47-43ff-847 --zone=us-east1-b
gcloud compute ssh game-platform-scaling \
  --project=project-c9ca4f0b-4e47-43ff-847 --zone=us-east1-b \
--command='sudo systemctl stop game-platform-scaling || exit $?; result=0; /home/zachary/game-platform-venv/bin/python -m game_platform.deploy.seed_scaling_data --config /home/zachary/game_platform/config.scaling.json || result=$?; sudo systemctl start game-platform-scaling || exit $?; exit $result'
```

The seed is additive: existing published games and data are not replaced. A unique
marker under `meta/` records the run and its status; choose a different `--run-id` only
when intentionally adding another dataset. The selected default adds roughly 69,000
Firestore documents including moves (the exact total is printed in `--dry-run`); it
does not represent physically loading the 10-million-user / 1-billion-match target.
Since this server loads every record and move at startup, expect restart time and memory
use to rise after seeding. Do not seed the billion-match target into this snapshot-based
server.
