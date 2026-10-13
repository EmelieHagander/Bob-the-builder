"""Bounded, reusable kernel edges for a saved CAD version. No AI or view loop."""
import math
import re
from build123d import GeomType
from .worker import validate_request, _shape, _location, _vec, CadContractError

TOLERANCE = 0.25
MAX_SEGMENTS = 60000


def _chord_distance(p, a, b):
    ab = [b[i] - a[i] for i in range(3)]
    length = sum(n * n for n in ab)
    t = max(0, min(1, sum((p[i] - a[i]) * ab[i] for i in range(3)) / length)) if length else 0
    return math.sqrt(sum((p[i] - a[i] - t * ab[i]) ** 2 for i in range(3)))


def _edge_points(edge):
    if edge.geom_type == GeomType.LINE:
        return [_vec(edge.position_at(0)), _vec(edge.position_at(1))]
    points = [_vec(edge.position_at(0))]

    def subdivide(t0, a, t1, b, depth):
        # Quarter probes also detect closed circles and avoid midpoint aliasing.
        probes = [(t0 + (t1 - t0) * f, _vec(edge.position_at(t0 + (t1 - t0) * f))) for f in (0.25, 0.5, 0.75)]
        if max(_chord_distance(p, a, b) for _, p in probes) <= TOLERANCE:
            points.append(b)
            if len(points) > 4097:
                raise CadContractError('wireframe_curve_budget')
            return
        if depth >= 14:
            raise CadContractError('wireframe_curve_tolerance')
        tm, mid = probes[1]
        subdivide(t0, a, tm, mid, depth + 1)
        subdivide(tm, mid, t1, b, depth + 1)

    subdivide(0, points[0], 1, _vec(edge.position_at(1)), 0)
    return points


def render_wireframe(raw):
    if not isinstance(raw, dict) or set(raw) != {'recipe', 'source_hash'} or not isinstance(raw['source_hash'], str) or not re.fullmatch(r'[0-9a-f]{64}', raw['source_hash']):
        raise CadContractError('wireframe_request')
    recipe = validate_request(raw['recipe'])
    used = {i['definition_id'] for i in recipe['instances']}
    shapes, definitions, count = {}, [], 0
    for d in recipe['definitions']:
        if d['id'] not in used:
            continue
        shape = _shape(d)
        shapes[d['id']] = shape
        positions = []
        for edge in shape.edges():
            points = _edge_points(edge)
            for a, b in zip(points, points[1:]):
                if math.dist(a, b) < 1e-8:
                    continue
                count += 1
                if count > MAX_SEGMENTS:
                    raise CadContractError('wireframe_segment_budget')
                positions.extend(round(n, 5) for p in (a, b) for n in p)
        if not positions:
            raise CadContractError('wireframe_empty_part')
        definitions.append({'id': d['id'], 'positions': positions})
    lo, hi = [math.inf] * 3, [-math.inf] * 3
    for i in recipe['instances']:
        bb = (_location(i['placement']) * shapes[i['definition_id']]).bounding_box()
        for k, (a, b) in enumerate(zip(_vec(bb.min), _vec(bb.max))):
            lo[k], hi[k] = min(lo[k], a), max(hi[k], b)
    return {'version': 1, 'profile': 'kernel-edges-v1', 'units': 'mm', 'engine': 'build123d-0.13.0',
            'source_hash': raw['source_hash'], 'assembly_id': recipe['assembly_id'], 'tolerance_mm': TOLERANCE,
            'bounds': {'min': lo, 'max': hi}, 'definitions': definitions, 'instances': recipe['instances']}
