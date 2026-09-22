import tempfile, unittest
from pathlib import Path
from bob_cad.worker import CadContractError, render_assembly, validate_request

def fixture():
    return {
        "contract_version":1,"units":"mm","assembly_id":"assembly.demo",
        "definitions":[
            {"id":"post","primitive":"box","material_ref":"mat.45x70","x_mm":45,"y_mm":70,"z_mm":1600},
            {"id":"rail","primitive":"box","material_ref":"mat.45x70","x_mm":900,"y_mm":45,"z_mm":70},
            {"id":"pipe","primitive":"tube","material_ref":"mat.pvc","outside_diameter_mm":32,"wall_thickness_mm":2,"length_mm":500}
        ],
        "instances":[
            {"id":"post.left","definition_id":"post","placement":{"x":0,"y":0,"z":0,"rx":0,"ry":0,"rz":0}},
            {"id":"post.right","definition_id":"post","placement":{"x":955,"y":0,"z":0,"rx":0,"ry":0,"rz":0}},
            {"id":"rail.top","definition_id":"rail","placement":{"x":50,"y":12.5,"z":1450,"rx":0,"ry":0,"rz":0}},
            {"id":"pipe.test","definition_id":"pipe","placement":{"x":500,"y":150,"z":0,"rx":0,"ry":0,"rz":0}}
        ],
        "views":["front","right","top","isometric"]
    }

class CadWorkerTest(unittest.TestCase):
    def test_real_engine_generates_step_svg_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            result=render_assembly(fixture(),tmp)
            self.assertEqual(result["engine"],{"name":"build123d","version":"0.13.0","units":"mm"})
            self.assertEqual(len(result["instances"]),4)
            for name in ("assembly.step","front.svg","right.svg","top.svg","isometric.svg","manifest.json"):
                path=Path(tmp,name); self.assertTrue(path.exists()); self.assertGreater(path.stat().st_size,20)
            self.assertIn("ISO-10303-21",Path(tmp,"assembly.step").read_text(encoding="utf-8",errors="ignore"))
            self.assertIn("<svg",Path(tmp,"front.svg").read_text(encoding="utf-8").lower())

    def test_definition_can_have_multiple_instances(self):
        parsed=validate_request(fixture())
        self.assertEqual(sum(i["definition_id"]=="post" for i in parsed["instances"]),2)

    def test_arbitrary_code_field_fails(self):
        bad=fixture(); bad["python"]="anything"
        with self.assertRaisesRegex(CadContractError,"request_shape"): validate_request(bad)

    def test_invalid_tube_fails(self):
        bad=fixture(); bad["definitions"][2]["wall_thickness_mm"]=16
        with self.assertRaisesRegex(CadContractError,"tube_wall_invalid"): validate_request(bad)

    def test_missing_definition_fails(self):
        bad=fixture(); bad["instances"][0]["definition_id"]="missing"
        with self.assertRaisesRegex(CadContractError,"instance"): validate_request(bad)

if __name__=="__main__": unittest.main()
