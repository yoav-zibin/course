#!/bin/zsh
# Local-only builder. Private config/data stay in the ignored .local-guided directory.
set -eu
cd "${0:A:h:h}"
if [[ ! -x .venv/bin/python ]]; then
  python3 -m venv .venv
  .venv/bin/python -m pip install -r requirements.txt
fi
mkdir -p .local-guided/python
chmod 700 .local-guided
[[ -e .local-guided/python/game_platform ]] || ln -s "$PWD" .local-guided/python/game_platform
if [[ ! -f .local-guided/config.json ]]; then
  .venv/bin/python - <<'PY'
import json
from pathlib import Path
config = {
    'server': {'host': '127.0.0.1', 'port': 8127, 'cors_allow_origins': []},
    'data_file': {'path': 'data.json'},
    'model_api': {
        'model': 'muse-spark-1.3', 'base_url': 'https://api.meta.ai/v1',
        'builder_input_usd_per_million': 1.25,
        'builder_output_usd_per_million': 4.25,
        'builder_max_input_tokens': 1048576,
    },
}
Path('.local-guided/config.json').write_text(json.dumps(config, indent=2))
PY
fi
if [[ -z "${MUSE_SPARK_API_KEY:-}" ]]; then
  read -rs 'MUSE_SPARK_API_KEY?Paste the class API key, then press Enter: '
  printf '\n'
fi
if [[ -z "$MUSE_SPARK_API_KEY" ]]; then
  print -u2 'No key entered. Run this launcher again to enable generation.'
  exit 1
fi
export MUSE_SPARK_API_KEY
export PYTHONPATH="$PWD/.local-guided/python"
export PLAYWRIGHT_CHANNEL=chrome
print 'Opening server at http://127.0.0.1:8127/static/guided-builder.html'
exec .venv/bin/python -m game_platform.main --config "$PWD/.local-guided/config.json"
