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
