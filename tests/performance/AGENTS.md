# BuildPlay performance baselines

Keep the hardcoded values in `baselines.json` and the 50% regression limits fixed
unless a human explicitly approves the specific change before editing. A failing
benchmark is evidence to investigate. Never update the fixture, metric definition,
or source of build artifacts to make a regression pass without that approval.
