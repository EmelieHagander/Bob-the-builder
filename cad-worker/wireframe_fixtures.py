"""Regenerate the cross-runtime viewer fixtures with the real pinned CAD engine."""
import hashlib
import json
from pathlib import Path
from bob_cad.wireframe import render_wireframe


def placement(x=0, y=0, z=0, rx=0, ry=0, rz=0):
    return dict(x=x, y=y, z=z, rx=rx, ry=ry, rz=rz)


def box(identity, x, y, z):
    return dict(id=identity, primitive='box', material_ref=None, x_mm=x, y_mm=y, z_mm=z)


def assembly(identity, definitions, instances):
    return dict(contract_version=1, units='mm', assembly_id=identity, definitions=definitions, instances=instances, views=['isometric'])


def instance(identity, definition, **place):
    return dict(id=identity, definition_id=definition, placement=placement(**place))


def recipes():
    room = assembly('room', [box('wall_long', 4000, 100, 2400), box('wall_short', 100, 3000, 2400), box('floor', 4000, 3200, 22)], [
        instance('south', 'wall_long'), instance('north', 'wall_long', y=3100), instance('west', 'wall_short', y=100),
        instance('east', 'wall_short', x=3900, y=100), instance('floor', 'floor')])

    def bunk(length):
        corners = ((35, 35), (length-35, 35), (35, 865), (length-35, 865))
        posts = [instance(f'post{i}', 'post', x=x, y=y) for i, (x, y) in enumerate(corners)]
        return assembly('bunk', [box('rail', length, 45, 95), box('deck', length, 900, 22),
                        dict(id='post', primitive='cylinder', material_ref=None, diameter_mm=70, length_mm=1600)], [
            *[instance(f'rail{i}.{level}', 'rail', y=y, z=z) for i, y in enumerate((0, 855)) for level, z in (('low', 300), ('high', 1300))],
            instance('deck.low', 'deck', z=395), instance('deck.high', 'deck', z=1395),
            *posts])

    machined = box('block', 100, 100, 20)
    machined['cuts'] = [dict(primitive='cylinder', diameter_mm=10, length_mm=22, placement=placement(50, 50, -1)),
                        dict(primitive='box', x_mm=10, y_mm=20, z_mm=22, placement=placement(0, 0, -1))]
    return dict(room=room, bunk2000=bunk(2000), bunk2100=bunk(2100),
                machined=assembly('machined', [machined], [instance('block.one', 'block', x=100, y=200, z=10, rx=30, ry=45, rz=60)]))


def fixtures():
    result = {}
    for identity, recipe in recipes().items():
        source = json.dumps(dict(profile='kernel-edges-v1', recipe=recipe), sort_keys=True, separators=(',', ':'))
        source_hash = hashlib.sha256(source.encode()).hexdigest()
        result[identity] = dict(recipe=recipe, geometry=render_wireframe(dict(recipe=recipe, source_hash=source_hash)))
    return result


if __name__ == '__main__':
    path = Path(__file__).resolve().parents[1] / 'tests/fixtures/cad-wireframes.json'
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(fixtures(), separators=(',', ':')) + '\n')
