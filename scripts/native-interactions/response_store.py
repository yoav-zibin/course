"""Build the isolated account and verify moves persisted by the actual game client."""
import json
from pathlib import Path


def seed(fixtures):
    scenarios=json.loads((fixtures/'scenarios.json').read_text())
    master=None
    for case in scenarios:
        envelope=json.loads((fixtures/case['id']/case['filename']).read_text())
        data=json.loads(envelope['value'])
        if master is None:master=data
        else:
            master['responses'].update(data['responses'])
            master['local'].update(data['local'])
    return scenarios,envelope['key'],master


def verify(scenarios,data):
    result={}
    for case in scenarios:
        match=data.get('local',{}).get(case['match'],{})
        moves=match.get('moves',[])[case['moveCount']:]
        first=moves[0].get('move',{}) if moves else {}
        state=match.get('logicState',{})
        wanted=case['expected'] if not case['setup'] else {'action':'configure','difficulty':3,'goal':3,'cube_enabled':True}
        correct=all(first.get(k)==v for k,v in wanted.items())
        replies=[m['move_number'] for m in moves if match['players'][m['player_index']]['kind']=='computer']
        result[case['id']]={'expected':wanted,'humanMove':first,'computerMoves':replies,'moveCount':match.get('move_count'),
            'verified':correct and (case['mode']!='computer' or case['setup'] or bool(replies))}
    return result
