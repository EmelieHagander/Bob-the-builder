import json
import tempfile
import unittest
from pathlib import Path

from bob_cad_worker import ContractError, run, validate_contract


def fixture():
    return {
        "version": 1,
        "assembly_id": "assembly.demo",
        "units": "mm",
        "definitions": [
            {"id": "P-001", "kind": "box", "size_mm": [45, 70, 1600], "catalog_part_id": "part.post", "catalog_part_revision": 3},
            {"id": "P-002", "kind": "tube", "outside_diameter_mm": 32, "wall_thickness_mm": 2, "length_mm": 500},
        ],
        "instances": [
            {"id": "I-001", "definition_id": "P-001", "position_mm": [0, 0, 800], "rotation_deg": [0, 0, 0]},
            {"id": "I-002", "definition_id": "P-001", "position_mm": [955, 0, 800], "rotation_deg": [0, 0, 0]},
            {"id": "I-003", "definition_id": "P-002", "position_mm": [477.5, 0, 1200], "rotation_deg": [0, 90, 0]},
        ],
        "views": ["front", "top", "isometric"],
    }


class WorkerTest(unittest.TestCase):
    def test_contract_rejects_arbitrary_fields_and_unknown_kind(self):
        value = fixture()
        value["execute"] = "print('no')"
        with self.assertRaises(ContractError):
            validate_contract(value)
        value = fixture()
        value["definitions"][0]["kind"] = "python"
        with self.assertRaises(ContractError):
            validate_contract(value)

    def test_contract_keeps_catalog_pin_and_center_placement(self):
        value = validate_contract(fixture())
        self.assertEqual(value["definitions"][0]["catalog_part_revision"], 3)
        self.assertEqual(value["instances"][0]["position_mm"], [0.0, 0.0, 800.0])

    def test_actual_build123d_generates_step_and_svg(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            manifest = run(fixture(), output)
            self.assertEqual(manifest["engine"], "build123d")
            self.assertEqual(manifest["instances"], ["I-001", "I-002", "I-003"])
            self.assertTrue((output / "assembly.step").read_bytes().startswith(b"ISO-10303"))
            for view in fixture()["views"]:
                text = (output / f"{view}.svg").read_text(encoding="utf-8")
                self.assertIn("<svg", text)
            saved = json.loads((output / "result.json").read_text())
            self.assertEqual(saved["definitions"][0]["id"], "P-001")
            self.assertLess(saved["bbox_mm"]["min"][2], saved["bbox_mm"]["max"][2])


if __name__ == "__main__":
    unittest.main()
