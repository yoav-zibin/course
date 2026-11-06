"""Compare approved before/after views to browser renders of the generated client."""
import base64

from game_platform import builder_render


def review_views(ask, job_id, cases, screenshots, rules):
    failures = []
    views = ('view_of_mover','view_of_other','expected_view_of_mover','expected_view_of_other')
    sizes = ((390,'ltr'), (844,'rtl'), (820,'ltr'), (1366,'rtl'))
    for case in cases:
        content = [{'type':'text', 'text':'Review each approved mockup and corresponding actual render. Check the move, state, privacy and UI rules. Return JSON {passed:boolean, issues:[strings]}. Rules: ' + rules}]
        for view, (width, direction) in zip(views, sizes):
            shot = next((s for s in screenshots if s['test']==case['name'] and s['width']==width and s['direction']==direction and s['view']==view), None)
            if shot is None: raise RuntimeError('Renderer returned incomplete evidence for ' + case['name'] + ': ' + view)
            content.append({'type':'text', 'text':f'{view}, {width}px {direction}. Approved then actual:'})
            for name in (shot['approvedFile'],shot['file']):
                data = base64.b64encode((builder_render.ARTIFACT_ROOT/job_id/name).read_bytes()).decode()
                content.append({'type':'image_url','image_url':{'url':'data:image/png;base64,'+data}})
        verdict = ask([{'role':'user','content':content}],2000)
        if verdict.get('passed') is not True:
            failures.append({'visual_review':case['name'],'issues':verdict.get('issues',[])})
    return failures
