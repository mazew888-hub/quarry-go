# A stand-in for maya.cmds: one time warp curve, records the keys the Quarry time warp script sets.
import sys, types, json
UNIT = sys.argv[2] if len(sys.argv) > 2 else 'film'
keys = {1.0: 1.0}
log = {'warn': []}
c = types.ModuleType('maya.cmds')
def currentUnit(q=1, t=1): return UNIT
def keyframe(*a, **k):
    if k.get('sl'): return ['timewarp']
    if k.get('tc'): return sorted(keys)
    if k.get('vc'): return [keys[min(keys)]]
def ls(*a, **k): return ['timewarp']
def setKeyframe(curve, t, v): keys[round(t, 4)] = v
def cutKey(curve, t, cl=1): keys.pop(round(t[0], 4), None)
def keyTangent(*a, **k): return [45.0] if k.get('q') else None
def undoInfo(**k): pass
def warning(m): log['warn'].append(m)
def error(m): raise RuntimeError(m)
for f in [currentUnit, keyframe, ls, setKeyframe, cutKey, keyTangent, undoInfo, warning, error]: setattr(c, f.__name__, f)
maya = types.ModuleType('maya'); maya.cmds = c
sys.modules['maya'] = maya; sys.modules['maya.cmds'] = c
ns = {'__name__': '__main__'}
exec(open(sys.argv[1]).read(), ns)
print(json.dumps({'keys': sorted([t, v] for t, v in keys.items()), 'warn': log['warn']}))
