import json
import math
import unittest
from pathlib import Path
from unittest.mock import patch
from bob_cad.worker import CadContractError, _shape, _location, _vec
from bob_cad.wireframe import render_wireframe, _edge_points, _chord_distance
from wireframe_fixtures import fixtures, assembly, box, instance, placement


class WireframeTest(unittest.TestCase):
    def render(self, recipe):
        return render_wireframe(dict(recipe=recipe, source_hash='a'*64))

    def test_native_box_edges_have_no_triangle_diagonals(self):
        result = self.render(assembly('box', [box('board', 100, 50, 20)], [instance('one', 'board')]))
        p = result['definitions'][0]['positions']
        self.assertEqual(len(p)//6, 12)
        for i in range(0, len(p), 6):
            self.assertEqual(sum(p[i+k] != p[i+k+3] for k in range(3)), 1)
        self.assertEqual(result['bounds'], dict(min=[0, 0, 0], max=[100, 50, 20]))

    def test_repeated_parts_share_one_definition_even_at_recipe_limit(self):
        recipe = assembly('house.part', [box('stud', 45, 95, 2400)], [instance(f'stud{i}', 'stud', x=i*600) for i in range(512)])
        from bob_cad import wireframe
        with patch.object(wireframe, '_shape', wraps=_shape) as shapes:
            result = self.render(recipe)
            self.assertEqual(shapes.call_count, 1)
        self.assertEqual(len(result['definitions']), 1)
        self.assertEqual(len(result['definitions'][0]['positions']), 72)
        self.assertEqual(len(result['instances']), 512)
        self.assertEqual(result['bounds']['max'], [511*600+45, 95, 2400])

    def test_hole_notch_and_tube_bore_are_present(self):
        value = fixtures()['machined']['geometry']
        p = value['definitions'][0]['positions']
        points = [p[i:i+3] for i in range(0, len(p), 3)]
        self.assertTrue(any(abs(math.hypot(v[0]-50, v[1]-50)-5)<1e-4 and v[2] in (0,20) for v in points), 'hole rim')
        self.assertIn([10,20,0], points, 'notch corner')
        tube = dict(id='tube', primitive='tube', material_ref=None, outside_diameter_mm=40, wall_thickness_mm=3, length_mm=100)
        result = self.render(assembly('tube', [tube], [instance('pipe', 'tube')]))
        p = result['definitions'][0]['positions']
        radii = {round(math.hypot(p[i], p[i+1]),4) for i in range(0,len(p),3)}
        self.assertEqual(radii, {17,20})

    def test_curve_chords_stay_within_view_tolerance(self):
        d = dict(id='post', primitive='cylinder', material_ref=None, diameter_mm=10000, length_mm=100)
        for edge in _shape(d).edges():
            points = _edge_points(edge)
            # Dense independent samples against the closest exported chord.
            for k in range(201):
                p = _vec(edge.position_at(k/200))
                distance = min(_chord_distance(p,a,b) for a,b in zip(points,points[1:]))
                self.assertLessEqual(distance, .25001)

    def test_all_rotations_and_bounds_follow_the_kernel(self):
        recipe = assembly('rotated', [box('part',100,50,20)], [instance('one','part',x=100,y=200,z=10,rx=30,ry=45,rz=60)])
        result = self.render(recipe)
        bounds = (_location(recipe['instances'][0]['placement'])*_shape(recipe['definitions'][0])).bounding_box()
        self.assertEqual(result['bounds'], dict(min=_vec(bounds.min),max=_vec(bounds.max)))
        self.assertEqual(result['instances'], recipe['instances'])

    def test_bad_input_and_budgets_fail_explicitly(self):
        recipe = assembly('box', [box('part',10,10,10)], [instance('one','part')])
        for raw in ({}, dict(recipe=recipe,source_hash='bad'), dict(recipe=recipe,source_hash='a'*64,path='/etc/passwd')):
            with self.assertRaises(CadContractError): render_wireframe(raw)
        with patch('bob_cad.wireframe.MAX_SEGMENTS', 5):
            with self.assertRaisesRegex(CadContractError,'wireframe_segment_budget'): self.render(recipe)
        recipe['definitions'][0]['cuts'] = [dict(primitive='box',x_mm=20,y_mm=20,z_mm=20,placement=placement())]
        with self.assertRaises(CadContractError): self.render(recipe)

    def test_browser_and_typescript_fixtures_are_real_kernel_exports(self):
        path = Path(__file__).resolve().parents[1]/'tests/fixtures/cad-wireframes.json'
        self.assertEqual(json.loads(path.read_text()), fixtures())


if __name__ == '__main__': unittest.main()
