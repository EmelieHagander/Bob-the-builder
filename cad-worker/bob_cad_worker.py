from __future__ import annotations

import argparse
import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

MAX_PARTS = 256
MAX_INSTANCES = 1024
MAX_MM = 1_000_000.0
MAX_OUTPUT_BYTES = 32 * 1024 * 1024
SUPPORTED_KINDS = {"box", "tube"}
SUPPORTED_VIEWS = {"front", "right", "top", "isometric"}


class ContractError(ValueError):
    pass


def _obj(value: Any, name: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ContractError(f"{name}_must_be_object")
    return value


def _exact_keys(value: dict[str, Any], required: set[str], optional: set[str] = set()) -> None:
    keys = set(value)
    missing = required - keys
    extra = keys - required - optional
    if missing:
        raise ContractError("missing:" + ",".join(sorted(missing)))
    if extra:
        raise ContractError("extra:" + ",".join(sorted(extra)))


def _id(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value or len(value) > 80 or any(c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.-" for c in value):
        raise ContractError(f"invalid_{name}")
    return value


def _num(value: Any, name: str, *, positive: bool = False) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        raise ContractError(f"invalid_{name}")
    number = float(value)
    if abs(number) > MAX_MM or (positive and number <= 0):
        raise ContractError(f"invalid_{name}")
    return number


def _vec3(value: Any, name: str) -> tuple[float, float, float]:
    if not isinstance(value, list) or len(value) != 3:
        raise ContractError(f"invalid_{name}")
    return tuple(_num(v, name) for v in value)


@dataclass(frozen=True)
class Definition:
    id: str
    kind: str
    source: dict[str, Any]


@dataclass(frozen=True)
class Instance:
    id: str
    definition_id: str
    position_mm: tuple[float, float, float]
    rotation_deg: tuple[float, float, float]


def validate_contract(raw: Any) -> dict[str, Any]:
    root = _obj(raw, "root")
    _exact_keys(root, {"version", "assembly_id", "units", "definitions", "instances", "views"})
    if root["version"] != 1 or root["units"] != "mm":
        raise ContractError("unsupported_contract")
    assembly_id = _id(root["assembly_id"], "assembly_id")

    definitions_raw = root["definitions"]
    instances_raw = root["instances"]
    views_raw = root["views"]
    if not isinstance(definitions_raw, list) or not 1 <= len(definitions_raw) <= MAX_PARTS:
        raise ContractError("invalid_definitions")
    if not isinstance(instances_raw, list) or not 1 <= len(instances_raw) <= MAX_INSTANCES:
        raise ContractError("invalid_instances")
    if not isinstance(views_raw, list) or not 1 <= len(views_raw) <= 4:
        raise ContractError("invalid_views")

    definitions: list[Definition] = []
    definition_ids: set[str] = set()
    for item in definitions_raw:
        d = _obj(item, "definition")
        _exact_keys(d, {"id", "kind"}, {"size_mm", "outside_diameter_mm", "wall_thickness_mm", "length_mm", "catalog_part_id", "catalog_part_revision"})
        did = _id(d["id"], "definition_id")
        if did in definition_ids:
            raise ContractError("duplicate_definition_id")
        definition_ids.add(did)
        kind = d["kind"]
        if kind not in SUPPORTED_KINDS:
            raise ContractError("unsupported_definition_kind")
        if kind == "box":
            if set(d) - {"id", "kind", "size_mm", "catalog_part_id", "catalog_part_revision"}:
                raise ContractError("box_fields")
            size = d.get("size_mm")
            if not isinstance(size, list) or len(size) != 3:
                raise ContractError("invalid_box_size")
            for n in size:
                _num(n, "box_size", positive=True)
        else:
            allowed = {"id", "kind", "outside_diameter_mm", "wall_thickness_mm", "length_mm", "catalog_part_id", "catalog_part_revision"}
            if set(d) - allowed:
                raise ContractError("tube_fields")
            od = _num(d.get("outside_diameter_mm"), "outside_diameter", positive=True)
            wall = _num(d.get("wall_thickness_mm"), "wall_thickness", positive=True)
            _num(d.get("length_mm"), "length", positive=True)
            if wall * 2 >= od:
                raise ContractError("tube_wall_must_be_less_than_radius")
        if (d.get("catalog_part_id") is None) != (d.get("catalog_part_revision") is None):
            raise ContractError("catalog_part_pin_incomplete")
        if d.get("catalog_part_id") is not None:
            _id(d["catalog_part_id"], "catalog_part_id")
            rev = d["catalog_part_revision"]
            if not isinstance(rev, int) or isinstance(rev, bool) or rev < 1:
                raise ContractError("invalid_catalog_part_revision")
        definitions.append(Definition(did, kind, d))

    instances: list[Instance] = []
    instance_ids: set[str] = set()
    for item in instances_raw:
        i = _obj(item, "instance")
        _exact_keys(i, {"id", "definition_id", "position_mm", "rotation_deg"})
        iid = _id(i["id"], "instance_id")
        if iid in instance_ids:
            raise ContractError("duplicate_instance_id")
        instance_ids.add(iid)
        definition_id = _id(i["definition_id"], "definition_id")
        if definition_id not in definition_ids:
            raise ContractError("unknown_definition_id")
        instances.append(Instance(iid, definition_id, _vec3(i["position_mm"], "position_mm"), _vec3(i["rotation_deg"], "rotation_deg")))

    view_names: list[str] = []
    for item in views_raw:
        if not isinstance(item, str) or item not in SUPPORTED_VIEWS or item in view_names:
            raise ContractError("invalid_view")
        view_names.append(item)

    return {
        "version": 1,
        "assembly_id": assembly_id,
        "units": "mm",
        "definitions": [d.source for d in definitions],
        "instances": [
            {"id": i.id, "definition_id": i.definition_id, "position_mm": list(i.position_mm), "rotation_deg": list(i.rotation_deg)} for i in instances
        ],
        "views": view_names,
    }


def _build_definition(definition: dict[str, Any]):
    from build123d import Align, Box, Cylinder

    if definition["kind"] == "box":
        x, y, z = (float(v) for v in definition["size_mm"])
        return Box(x, y, z, align=(Align.CENTER, Align.CENTER, Align.CENTER))
    outer = float(definition["outside_diameter_mm"])
    wall = float(definition["wall_thickness_mm"])
    length = float(definition["length_mm"])
    outer_shape = Cylinder(outer / 2, length, align=(Align.CENTER, Align.CENTER, Align.CENTER))
    inner_shape = Cylinder((outer - 2 * wall) / 2, length * 1.02, align=(Align.CENTER, Align.CENTER, Align.CENTER))
    return outer_shape - inner_shape


def build_assembly(contract: dict[str, Any]):
    from build123d import Compound, Location

    definitions = {d["id"]: _build_definition(d) for d in contract["definitions"]}
    children = []
    for instance in contract["instances"]:
        shape = definitions[instance["definition_id"]]
        loc = Location(tuple(instance["position_mm"]), tuple(instance["rotation_deg"]))
        placed = loc * shape
        placed.label = instance["id"]
        children.append(placed)
    return Compound(children=children)


def _camera(assembly, view: str):
    bbox = assembly.bounding_box()
    center = bbox.center()
    size = bbox.size
    span = max(size.X, size.Y, size.Z, 1.0)
    cx, cy, cz = center.X, center.Y, center.Z
    distance = span * 4 + 100
    if view == "front":
        return (cx, cy - distance, cz), (0, 0, 1)
    if view == "right":
        return (cx + distance, cy, cz), (0, 0, 1)
    if view == "top":
        return (cx, cy, cz + distance), (0, 1, 0)
    return (cx + distance, cy - distance, cz + distance), (0, 0, 1)


def export_view(assembly, view: str, path: Path) -> None:
    from build123d import Compound, ExportSVG, LineType, Unit

    origin, up = _camera(assembly, view)
    visible, hidden = assembly.project_to_viewport(viewport_origin=origin, viewport_up=up, look_at=assembly.bounding_box().center())
    projected = Compound(children=visible + hidden)
    bbox = projected.bounding_box()
    span = max(bbox.size.X, bbox.size.Y, bbox.size.Z, 1.0)
    exporter = ExportSVG(unit=Unit.MM, scale=180 / span, margin=5, precision=6)
    exporter.add_layer("visible")
    exporter.add_layer("hidden", line_type=LineType.ISO_DOT)
    exporter.add_shape(visible, layer="visible")
    exporter.add_shape(hidden, layer="hidden")
    exporter.write(path)


def run(raw: Any, output_dir: Path) -> dict[str, Any]:
    from build123d import export_step

    contract = validate_contract(raw)
    output_dir.mkdir(parents=True, exist_ok=True)
    assembly = build_assembly(contract)
    bbox = assembly.bounding_box()
    step_path = output_dir / "assembly.step"
    if not export_step(assembly, step_path):
        raise RuntimeError("step_export_failed")
    views: dict[str, str] = {}
    for view in contract["views"]:
        path = output_dir / f"{view}.svg"
        export_view(assembly, view, path)
        views[view] = path.name
    files = [step_path, *(output_dir / name for name in views.values())]
    for path in files:
        if not path.exists() or path.stat().st_size <= 0 or path.stat().st_size > MAX_OUTPUT_BYTES:
            raise RuntimeError("invalid_output_file")
    manifest = {
        "version": 1,
        "engine": "build123d",
        "assembly_id": contract["assembly_id"],
        "units": "mm",
        "bbox_mm": {
            "min": [bbox.min.X, bbox.min.Y, bbox.min.Z],
            "max": [bbox.max.X, bbox.max.Y, bbox.max.Z],
        },
        "definitions": [
            {
                "id": d["id"],
                "kind": d["kind"],
                "catalog_part_id": d.get("catalog_part_id"),
                "catalog_part_revision": d.get("catalog_part_revision"),
            }
            for d in contract["definitions"]
        ],
        "instances": [i["id"] for i in contract["instances"]],
        "files": {"step": step_path.name, "views": views},
    }
    (output_dir / "result.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description="Render Bob construction JSON with build123d/OpenCascade.")
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    raw = json.loads(args.input.read_text(encoding="utf-8"))
    result = run(raw, args.output)
    print(json.dumps(result, separators=(",", ":"), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
