import tempfile, unittest
from pathlib import Path
from bob_cad.worker import CadContractError, render_assembly, validate_request, _shape, _checks
from unittest.mock import patch
import math

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
    def test_real_hole_and_notch_preserve_blank_but_remove_exact_volume(self):
        d={"id":"block","primitive":"box","material_ref":None,"x_mm":100,"y_mm":100,"z_mm":20,"cuts":[
            {"primitive":"cylinder","diameter_mm":10,"length_mm":22,"placement":{"x":50,"y":50,"z":-1,"rx":0,"ry":0,"rz":0}},
            {"primitive":"box","x_mm":10,"y_mm":20,"z_mm":22,"placement":{"x":0,"y":0,"z":-1,"rx":0,"ry":0,"rz":0}}]}
        self.assertAlmostEqual(_shape(d).volume,200000-math.pi*25*20-4000,places=4)
        d["cuts"][0]["placement"]["x"]=500
        with self.assertRaisesRegex(CadContractError,"does_not_intersect"): _shape(d)

    def test_collision_clearance_and_travel_envelope_are_reported(self):
        r=fixture();r["views"]=["front"]
        r["definitions"]=[{"id":"block","primitive":"box","material_ref":None,"x_mm":10,"y_mm":10,"z_mm":10}]
        r["instances"]=[{"id":name,"definition_id":"block","placement":{"x":x,"y":0,"z":0,"rx":0,"ry":0,"rz":0}} for name,x in (("moving",0),("overlap",5),("stop",30))]
        r["clearances"]=[{"id":"gap","first_id":"moving","second_id":"stop","min_mm":25}]
        r["motions"]=[{"id":"open","moving_ids":["moving"],"obstacle_ids":["stop"],"delta":{"x":40,"y":0,"z":0}}]
        with tempfile.TemporaryDirectory() as tmp:
            checks=render_assembly(r,tmp)["checks"]
        self.assertEqual(checks["collisions"]["status"],"complete")
        self.assertAlmostEqual(checks["collisions"]["overlaps"][0]["volume_mm3"],500)
        self.assertEqual(checks["clearances"][0]["distance_mm"],20)
        self.assertEqual(checks["clearances"][0]["status"],"insufficient")
        self.assertEqual(checks["motions"][0]["status"],"potential_obstruction")
        with patch('bob_cad.worker.COLLISION_PAIR_LIMIT',0),tempfile.TemporaryDirectory() as tmp:
            checks=render_assembly(r,tmp)["checks"]
        self.assertEqual(checks["collisions"]["status"],"partial")
        self.assertEqual(checks["collisions"]["skipped_pairs"],1)

    def test_nested_cuts_and_self_motion_fail_contract(self):
        r=fixture();r["definitions"][0]["cuts"]=[{"primitive":"box","x_mm":1,"y_mm":1,"z_mm":1,"cuts":[],"placement":r["instances"][0]["placement"]}]
        with self.assertRaises(CadContractError): validate_request(r)
        r=fixture();r["motions"]=[{"id":"motion","moving_ids":["post.left"],"obstacle_ids":["post.left"],"delta":{"x":10,"y":0,"z":0}}]
        with self.assertRaises(CadContractError): validate_request(r)

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

class CadTransportTest(unittest.TestCase):
    def test_authenticated_transport_returns_actual_matching_files(self):
        import base64, hashlib, json, os, threading, urllib.request, urllib.error
        from http.server import HTTPServer
        from unittest.mock import patch
        from bob_cad.server import Handler
        with patch.dict(os.environ, {"BOB_CAD_TOKEN": "fixture-token-" + "x" * 32}):
            server = HTTPServer(("127.0.0.1", 0), Handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            endpoint = f"http://127.0.0.1:{server.server_port}/render"
            try:
                bad = urllib.request.Request(endpoint, data=b'{}', method="POST")
                with self.assertRaises(urllib.error.HTTPError) as error:
                    urllib.request.urlopen(bad, timeout=5)
                self.assertEqual(error.exception.code, 401)
                request = urllib.request.Request(endpoint, data=json.dumps(fixture()).encode(), method="POST", headers={"Authorization": "Bearer " + os.environ["BOB_CAD_TOKEN"], "Content-Type": "application/json"})
                with urllib.request.urlopen(request, timeout=45) as response:
                    packet = json.load(response)
                self.assertEqual(set(packet["files"]), {"step", "front", "right", "top", "isometric"})
                for key, encoded in packet["files"].items():
                    self.assertEqual(hashlib.sha256(base64.b64decode(encoded)).hexdigest(), packet["manifest"]["exports"][key]["sha256"])
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

if __name__=="__main__": unittest.main()
