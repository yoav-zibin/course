#!/usr/bin/env python3
"""Compare saved UI audit positions and package the actual three-platform screenshots."""
import argparse
from datetime import datetime, timezone
import html
import json
from pathlib import Path
import shutil
import zipfile

PLATFORMS = ("web", "android", "ios")
PAGES = ("catalog", "matches", "local", "preferences", "account")
MATCH_FIELDS = ("game_id", "game_version", "status", "localMode", "practiceSeed", "created_at",
                "players", "logicState", "state", "turn_of_player_indices", "move_count",
                "moves", "initialState", "initialTurn", "last_move_player_index", "awaitingHandoff")


def compare_match(actual, expected):
    return [key for key in MATCH_FIELDS if actual.get(key) != expected.get(key)]


def one_file(directory, name):
    candidates = list(directory.rglob(name))
    if len(candidates) != 1:
        raise ValueError(f"Expected one {name} in {directory}, found {len(candidates)}")
    return candidates[0]


def build_report(fixture_path, evidence, output):
    fixture = json.loads(fixture_path.read_text())
    output.mkdir(parents=True, exist_ok=True)
    shutil.copy2(fixture_path,output / "common-fixture.json")
    rows = [(f"page-{page}", page.replace("local", "On this device").capitalize(), None) for page in PAGES]
    for game in fixture["games"]:
        rows.append((f'{game["slug"]}-initial', f'{game["name"]} — initial', game["initial"]))
        rows.extend((f'{game["slug"]}-step{step["number"]}',
                     f'{game["name"]} — human turn {step["number"]}, {step["expectedMatch"]["move_count"]} accepted moves',
                     step["expectedMatch"]) for step in game["steps"])
    results, rendered, missing = [], [], []
    for stage, title, expected in rows:
        cells, actuals = [], {}
        for platform in PLATFORMS:
            directory = evidence / platform
            try:
                screenshot = one_file(directory, f"{stage}.png")
                target = output / "images" / platform / screenshot.name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(screenshot, target)
                relative = target.relative_to(output).as_posix()
                cells.append(f'<a href="{html.escape(relative)}" target="_blank"><img loading="lazy" src="{html.escape(relative)}" alt="{html.escape(platform+": "+title)}"></a>')
            except ValueError as error:
                missing.append(str(error)); cells.append('<p class="missing">Screenshot missing</p>')
            if expected is not None:
                try:
                    actual_path=one_file(directory, f"{stage}-match.json")
                    actual = json.loads(actual_path.read_text())
                    proof=output / "proof" / platform / actual_path.name
                    proof.parent.mkdir(parents=True,exist_ok=True)
                    shutil.copy2(actual_path,proof)
                    actuals[platform] = actual
                    differences = compare_match(actual, expected)
                    results.append({"stage":stage,"platform":platform,"expectedMoveCount":expected["move_count"],
                                    "actualMoveCount":actual.get("move_count"),"differentFields":differences,"passed":not differences,
                                    "proof":proof.relative_to(output).as_posix()})
                except (ValueError, json.JSONDecodeError) as error:
                    missing.append(str(error)); results.append({"stage":stage,"platform":platform,"passed":False,"error":str(error)})
        cross_equal = len(actuals) == 3 and all(not compare_match(actuals["web"], actuals[p]) for p in ("android", "ios")) if expected is not None else None
        badge = "Page screenshots" if expected is None else "Matching saved position on all three" if cross_equal else "Position comparison incomplete or different"
        rendered.append(f'<section id="{html.escape(stage)}"><h2>{html.escape(title)}</h2><p class="badge">{badge}</p><div class="grid">'+''.join(f'<figure><figcaption>{p.title()}</figcaption>{cell}</figure>' for p,cell in zip(PLATFORMS,cells))+'</div></section>')
    passed = not missing and all(result["passed"] for result in results)
    summary = {"sourceSha":fixture["sourceSha"],"createdAt":datetime.now(timezone.utc).isoformat(),
               "viewport":fixture["viewport"],"comparisonFields":MATCH_FIELDS,"checks":results,
               "missing":missing,"passed":passed,"scope":"Signed-out pages and local single-human versus computer games; synthetic data only."}
    findings_path=evidence / "findings.json"
    findings=json.loads(findings_path.read_text()) if findings_path.is_file() else {"findings":[],"visualReviewComplete":False}
    summary["visualReview"]=findings
    (output / "comparison.json").write_text(json.dumps(summary,indent=2)+"\n")
    document = '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>BuildPlay: web, Android and iOS comparison</title><style>
body{font-family:system-ui,sans-serif;background:#10141f;color:#edf1fa;margin:0;padding:24px;line-height:1.5}main{max-width:1500px;margin:auto}h1{margin-bottom:8px}a{color:#7dd5ff}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}figure{margin:0;min-width:0}figcaption{font-weight:700;padding:8px 0}img{width:100%;height:auto;border:1px solid #4a5468;border-radius:8px;display:block}section{margin-top:36px;border-top:1px solid #40495d;padding-top:12px}.badge{color:#c3f24b}.missing{color:#ff9e9e}.scope{max-width:1000px;color:#bdc8d8}code{overflow-wrap:anywhere}@media(max-width:700px){body{padding:12px}.grid{gap:6px}figcaption{font-size:12px}}
</style><main><h1>BuildPlay: web · Android · iOS</h1>'''
    document += f'<p>Application source <code>{html.escape(fixture["sourceSha"])}</code> · 402 × 874 logical viewport.</p>'
    document += '<p class="scope">Actual app screenshots and saved state after physical UI actions. The three games start from the same legally generated position, game version, seed and clock. Platform fonts and system bars can differ. Click a screenshot for its original resolution.</p>'
    document += f'<p><strong>{"All saved-position comparisons passed" if passed else "Comparison has missing evidence or differences"}</strong> · <a href="comparison.json">Detailed state checks</a></p>'
    if findings.get("findings"):
        document+='<h2>Visual findings</h2><ul>'+''.join(f'<li><strong>{html.escape(item["title"])}</strong>: {html.escape(item["description"])}</li>' for item in findings["findings"])+'</ul>'
    document+='<nav>Jump to: '+ ' · '.join(f'<a href="#{html.escape(stage)}">{html.escape(title)}</a>' for stage,title,_ in rows if stage.startswith('page-') or stage.endswith('step3'))+'</nav>'
    document += ''.join(rendered)+'</main></html>'
    (output / "index.html").write_text(document)
    archive = output.parent / "BuildPlay-three-platform-comparison.zip"
    with zipfile.ZipFile(archive,"w",zipfile.ZIP_DEFLATED) as bundle:
        for file in sorted(output.rglob("*")):
            if file.is_file():bundle.write(file,file.relative_to(output))
    return summary, archive


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixture",type=Path,default=Path("tests/fixtures/portal-parity/common.json"))
    parser.add_argument("--evidence",type=Path,required=True)
    parser.add_argument("--output",type=Path,required=True)
    args=parser.parse_args()
    summary,archive=build_report(args.fixture,args.evidence,args.output)
    print(json.dumps({"passed":summary["passed"],"checks":len(summary["checks"]),"missing":summary["missing"],"archive":str(archive)},indent=2))
    raise SystemExit(0 if summary["passed"] else 1)


if __name__=="__main__":main()
