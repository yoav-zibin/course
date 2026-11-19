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
PROOF_FILES = ("summary.json", "manifest.json", "visual-findings.json", "connect4-centers.json",
               "connect4-pixel-alignment.json", "board-crops.json", "audit-metadata.json",
               "provenance.json", "page-refresh.json", "responsive-findings.json", "seed-proof.json")


def compare_match(actual, expected):
    return [key for key in MATCH_FIELDS if actual.get(key) != expected.get(key)]


def one_file(directory, name):
    candidates = list(directory.rglob(name))
    if len(candidates) != 1:
        raise ValueError(f"Expected one {name} in {directory}, found {len(candidates)}")
    return candidates[0]


def copy_proofs(directory, destination, source_sha):
    """Keep available driver evidence and reject conflicting source claims.

    Older evidence without these optional metadata files is still accepted;
    source provenance is never inferred from a platform's pass flag.
    """
    checked, errors = [], []
    for name in PROOF_FILES:
        candidates = list(directory.rglob(name))
        if not candidates:
            continue
        if len(candidates) != 1:
            errors.append(f"Ambiguous {name} in {directory}: found {len(candidates)}")
            continue
        source = candidates[0]
        destination.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination / name)
        try:
            metadata = json.loads(source.read_text())
            if not isinstance(metadata, dict):
                raise ValueError("expected a JSON object")
            claims = {}
            if "sourceSha" in metadata:
                claims["sourceSha"] = metadata["sourceSha"]
            if name == "provenance.json":
                if isinstance(metadata.get("run"), dict) and "head_sha" in metadata["run"]:
                    claims["run.head_sha"] = metadata["run"]["head_sha"]
                workflow = metadata.get("artifact", {}).get("workflow_run", {}) if isinstance(metadata.get("artifact"), dict) else {}
                if isinstance(workflow, dict) and "head_sha" in workflow:
                    claims["artifact.workflow_run.head_sha"] = workflow["head_sha"]
            for field, actual in claims.items():
                checked.append({"file":name,"field":field,"value":actual})
                if actual != source_sha:
                    errors.append(f"{source}: {field} is {actual!r}; expected {source_sha}")
        except (ValueError, OSError) as error:
            errors.append(f"Unreadable metadata {source}: {error}")
    return checked, errors


def build_report(fixture_path, evidence, output):
    fixture = json.loads(fixture_path.read_text())
    output.mkdir(parents=True, exist_ok=True)
    shutil.copy2(fixture_path,output / "common-fixture.json")
    # The drivers produce full screenshots. Include manually prepared board
    # crops only when supplied; a partial crop set still reports missing files.
    rows = []
    for game in fixture["games"]:
        stage = f'board-{game["slug"]}'
        if any(any((evidence / platform).rglob(stage + ".png")) for platform in PLATFORMS):
            rows.append((stage, f'{game["name"]} — board after three human turns', None))
    rows.extend((f"page-{page}", page.replace("local", "On this device").capitalize(), None) for page in PAGES)
    for game in fixture["games"]:
        rows.append((f'{game["slug"]}-initial', f'{game["name"]} — initial', game["initial"]))
        rows.extend((f'{game["slug"]}-step{step["number"]}',
                     f'{game["name"]} — human turn {step["number"]}, {step["expectedMatch"]["move_count"]} accepted moves',
                     step["expectedMatch"]) for step in game["steps"])
        rows.append((f'{game["slug"]}-restart',f'{game["name"]} — restored after restart',game["steps"][-1]["expectedMatch"]))
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
    state_passed = all(result["passed"] for result in results)
    summary = {"sourceSha":fixture["sourceSha"],"createdAt":datetime.now(timezone.utc).isoformat(),
               "viewport":fixture["viewport"],"comparisonFields":MATCH_FIELDS,"checks":results,
               "missing":missing,"stateComparisonsPassed":state_passed,"scope":"Chromium, Android emulator and iOS Simulator. Signed-out pages and local single-human versus computer games; synthetic data only."}
    findings_path=evidence / "findings.json"
    findings=json.loads(findings_path.read_text()) if findings_path.is_file() else {"findings":[],"visualReviewComplete":False}
    summary["visualReview"]=findings
    summary["visualReviewComplete"]=findings.get("visualReviewComplete") is True
    metadata_checks, metadata_errors = [], []
    for platform in PLATFORMS:
        checked, errors = copy_proofs(evidence / platform, output / "proof" / platform, fixture["sourceSha"])
        metadata_checks.extend({"platform":platform,**item} for item in checked)
        metadata_errors.extend(errors)
    desktop=[]
    if (evidence / "web-desktop").is_dir():
        desktop_dir=evidence / "web-desktop"
        for stage,title in [(f"page-{page}",page.title()) for page in PAGES]+[(f'{game["slug"]}-step3',game["name"]) for game in fixture["games"]]:
            try:
                source=one_file(desktop_dir,stage+".png")
                target=output / "images" / "web-desktop" / source.name
                target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,target)
                desktop.append((title,target.relative_to(output).as_posix()))
            except ValueError as error:
                missing.append(str(error));desktop.append((title,None))
        checked, errors = copy_proofs(desktop_dir, output / "proof" / "web-desktop", fixture["sourceSha"])
        metadata_checks.extend({"platform":"web-desktop",**item} for item in checked)
        metadata_errors.extend(errors)
        summary["desktop"]={"viewport":{"width":1440,"height":1000},"screenshots":sum(file is not None for _,file in desktop),"proof":"proof/web-desktop/summary.json"}
    summary["sourceMetadataChecks"]=metadata_checks
    summary["metadataErrors"]=metadata_errors
    passed = not missing and state_passed and not metadata_errors
    summary["passed"]=passed
    (output / "comparison.json").write_text(json.dumps(summary,indent=2)+"\n")
    document = '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>BuildPlay: web, Android and iOS comparison</title><style>
body{font-family:system-ui,sans-serif;background:#10141f;color:#edf1fa;margin:0;padding:24px;line-height:1.5}main{max-width:1500px;margin:auto}h1{margin-bottom:8px}a{color:#7dd5ff}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}figure{margin:0;min-width:0}figcaption{font-weight:700;padding:8px 0}img{width:100%;height:auto;border:1px solid #4a5468;border-radius:8px;display:block}section{margin-top:36px;border-top:1px solid #40495d;padding-top:12px}.badge{color:#c3f24b}.missing{color:#ff9e9e}.scope{max-width:1000px;color:#bdc8d8}code{overflow-wrap:anywhere}@media(max-width:700px){body{padding:12px}.grid{gap:6px}figcaption{font-size:12px}}
</style><main><h1>BuildPlay: web · Android · iOS</h1>'''
    document += f'<p>Application source <code>{html.escape(fixture["sourceSha"])}</code> · 402 × 874 logical viewport.</p>'
    document += '<p class="scope">Actual screenshots from Chromium, the native Android app in an emulator, and the native app in iOS Simulator. UI taps and clicks drive gameplay. The three games start from the same legally generated position, game version, seed and clock. Platform fonts and system bars can differ. Click a screenshot for its original resolution.</p>'
    document += f'<p><strong>{"All saved-position comparisons passed" if state_passed else "Saved-position comparisons are incomplete or different"}</strong> · <a href="comparison.json">Detailed state checks</a></p>'
    document += '<p><strong>Visual review: '+ ('Complete' if summary["visualReviewComplete"] else 'Pending final three-platform review') + '.</strong> Saved-state equality does not establish visual equivalence.</p>'
    if missing or metadata_errors:
        document += '<p class="missing">Evidence is incomplete or has conflicting source metadata; this is a partial report.</p>'
    if metadata_errors:
        document += '<ul class="missing">'+''.join(f'<li>{html.escape(error)}</li>' for error in metadata_errors)+'</ul>'
    if findings.get("findings"):
        document+='<h2>Visual findings</h2><ul>'+''.join(f'<li><strong>{html.escape(item["title"])}</strong>: {html.escape(item["description"])}</li>' for item in findings["findings"])+'</ul>'
    document+='<nav>Jump to: '+ ' · '.join(f'<a href="#{html.escape(stage)}">{html.escape(title)}</a>' for stage,title,_ in rows if stage.startswith(('page-','board-')))+'</nav>'
    document += ''.join(rendered)
    if desktop:
        document+='<section><h2>Desktop website: 1440 × 1000</h2><p>Additional wide-layout checks, with the same game positions. Navigation and the catalog adapt to the larger screen.</p>'
        document+=''.join(f'<details><summary>{html.escape(title)}</summary>'+ (f'<a href="{html.escape(file)}"><img loading="lazy" src="{html.escape(file)}" alt="Desktop: {html.escape(title)}"></a>' if file is not None else '<p class="missing">Screenshot missing</p>')+'</details>' for title,file in desktop)+'</section>'
    document+='</main></html>'
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
