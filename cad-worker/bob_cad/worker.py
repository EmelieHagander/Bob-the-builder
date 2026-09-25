from __future__ import annotations

import hashlib, json, math, re
from pathlib import Path
from typing import Any
from build123d import Align, Box, Compound, Cylinder, ExportSVG, LineType, Location, Unit, export_step

ID=re.compile(r"^[A-Za-z][A-Za-z0-9_.:-]{0,79}$")
class CadContractError(ValueError): pass
COLLISION_PAIR_LIMIT=256

def _num(v:Any,name:str,positive=False,bound=1_000_000.0)->float:
    if isinstance(v,bool) or not isinstance(v,(int,float)) or not math.isfinite(float(v)): raise CadContractError(name)
    n=float(v)
    if abs(n)>bound or (positive and n<=0): raise CadContractError(name)
    return n

def _solid(d:dict[str,Any]):
    if d["primitive"]=="box":
        return Box(_num(d["x_mm"],"x",True),_num(d["y_mm"],"y",True),_num(d["z_mm"],"z",True),align=(Align.MIN,Align.MIN,Align.MIN))
    if d["primitive"]=="tube":
        od=_num(d["outside_diameter_mm"],"od",True); wall=_num(d["wall_thickness_mm"],"wall",True); length=_num(d["length_mm"],"length",True)
        if 2*wall>=od: raise CadContractError("tube_wall_invalid")
        outer=Cylinder(od/2,length,align=(Align.CENTER,Align.CENTER,Align.MIN))
        inner=Cylinder((od-2*wall)/2,length,align=(Align.CENTER,Align.CENTER,Align.MIN))
        return outer-inner
    if d["primitive"]=="cylinder":
        return Cylinder(d["diameter_mm"]/2,d["length_mm"],align=(Align.CENTER,Align.CENTER,Align.MIN))
    raise CadContractError("primitive_unsupported")

def _location(p): return Location((p["x"],p["y"],p["z"]),(p["rx"],p["ry"],p["rz"]))

def _shape(d):
    shape=_solid(d)
    for cut in d.get("cuts",[]):
        previous=shape.volume
        shape=shape-(_location(cut["placement"])*_solid(cut))
        if not shape.is_valid or len(shape.solids())!=1 or shape.volume<=1e-6: raise CadContractError("cut_removes_or_splits_part")
        if previous-shape.volume<=1e-6: raise CadContractError("cut_does_not_intersect_part")
    return shape

def _placement(p):
    if not isinstance(p,dict) or set(p)!={"x","y","z","rx","ry","rz"}: raise CadContractError("placement")
    for k in ("x","y","z"): _num(p[k],k,bound=10_000_000)
    for k in ("rx","ry","rz"): _num(p[k],k,bound=360_000)

def _validate_solid(d,extras,cut=False):
    fields={"box":{"x_mm","y_mm","z_mm"},"tube":{"outside_diameter_mm","wall_thickness_mm","length_mm"},"cylinder":{"diameter_mm","length_mm"}}.get(d.get("primitive"))
    if fields is None or (cut and d["primitive"]=="tube"): raise CadContractError("primitive_unsupported")
    if set(d)!=fields|set(extras)|{"primitive"}: raise CadContractError("definition_fields")
    for k in fields: _num(d[k],k,True)
    if d["primitive"]=="tube" and d["wall_thickness_mm"]*2>=d["outside_diameter_mm"]: raise CadContractError("tube_wall_invalid")

def validate_request(raw:Any)->dict[str,Any]:
    required={"contract_version","units","assembly_id","definitions","instances","views"}
    if not isinstance(raw,dict) or not required<=set(raw) or set(raw)-required-{"clearances","motions"}: raise CadContractError("request_shape")
    if isinstance(raw["contract_version"],bool) or raw["contract_version"]!=1 or raw["units"]!="mm" or not isinstance(raw["assembly_id"],str) or not ID.fullmatch(raw["assembly_id"]): raise CadContractError("contract")
    defs=raw["definitions"]; inst=raw["instances"]; views=raw["views"]
    if not isinstance(defs,list) or not 1<=len(defs)<=128 or not isinstance(inst,list) or not 1<=len(inst)<=512: raise CadContractError("counts")
    ids=set(); total_cuts=0
    for d in defs:
        if not isinstance(d,dict) or not isinstance(d.get("id"),str) or not ID.fullmatch(d["id"]) or d["id"] in ids: raise CadContractError("definition")
        _validate_solid(d,["id","material_ref"]+(["cuts"] if "cuts" in d else []))
        if d["material_ref"] is not None and (not isinstance(d["material_ref"],str) or not ID.fullmatch(d["material_ref"])): raise CadContractError("definition_fields")
        cuts=d.get("cuts",[])
        if not isinstance(cuts,list) or len(cuts)>16: raise CadContractError("cuts")
        total_cuts+=len(cuts)
        if total_cuts>256: raise CadContractError("cuts_budget")
        for c in cuts:
            if not isinstance(c,dict): raise CadContractError("cut")
            _validate_solid(c,["placement"],True); _placement(c["placement"])
        ids.add(d["id"])
    seen=set()
    for i in inst:
        if not isinstance(i,dict) or set(i)!={"id","definition_id","placement"} or not isinstance(i["id"],str) or not ID.fullmatch(i["id"]) or i["id"] in seen or not isinstance(i["definition_id"],str) or i["definition_id"] not in ids: raise CadContractError("instance")
        seen.add(i["id"]); p=i["placement"]
        _placement(p)
    allowed={"front","right","top","isometric"}
    if not isinstance(views,list) or not 1<=len(views)<=4 or len(set(views))!=len(views) or any(v not in allowed for v in views): raise CadContractError("views")
    check_ids=set()
    for group in ("clearances","motions"):
        checks=raw.get(group,[])
        if not isinstance(checks,list) or len(checks)>16: raise CadContractError("checks")
        for c in checks:
            if not isinstance(c,dict) or not isinstance(c.get("id"),str) or not ID.fullmatch(c["id"]) or c["id"] in check_ids: raise CadContractError("check_id")
            check_ids.add(c["id"])
            if group=="clearances":
                if set(c)!={"id","first_id","second_id","min_mm"} or c["first_id"] not in seen or c["second_id"] not in seen or c["first_id"]==c["second_id"]: raise CadContractError("clearance")
                if _num(c["min_mm"],"clearance")<0: raise CadContractError("clearance")
            else:
                if set(c)!={"id","moving_ids","obstacle_ids","delta"}: raise CadContractError("motion")
                for key,limit in (("moving_ids",8),("obstacle_ids",32)):
                    values=c[key]
                    if not isinstance(values,list) or not 1<=len(values)<=limit or any(not isinstance(x,str) or x not in seen for x in values) or len(set(values))!=len(values): raise CadContractError("motion_parts")
                if set(c["moving_ids"])&set(c["obstacle_ids"]): raise CadContractError("motion_parts")
                if not isinstance(c["delta"],dict) or set(c["delta"])!={"x","y","z"}: raise CadContractError("motion_delta")
                for k in c["delta"]: _num(c["delta"][k],k)
    return raw

def _vec(v): return [float(v.X),float(v.Y),float(v.Z)]
def _hash(p:Path)->str: return hashlib.sha256(p.read_bytes()).hexdigest()

def _camera(view,center,d):
    x,y,z=center
    return {"front":((x,y-d,z),(0,0,1)),"right":((x+d,y,z),(0,0,1)),"top":((x,y,z+d),(0,1,0)),"isometric":((x+d,y-d,z+d),(0,0,1))}[view]

def _overlap(a,b):
    return all(min(a["max"][k],b["max"][k])-max(a["min"][k],b["min"][k])>1e-6 for k in range(3))

def _checks(req,children,rows):
    overlaps=[]; tested=0; skipped=0
    for i,left in enumerate(children):
        for j in range(i+1,len(children)):
            if not _overlap(rows[i]["bounding_box_mm"],rows[j]["bounding_box_mm"]): continue
            if tested>=COLLISION_PAIR_LIMIT: skipped+=1; continue
            tested+=1
            intersection=left & children[j]
            volume=intersection.volume if intersection is not None else 0
            if volume>1e-6: overlaps.append({"first_id":rows[i]["id"],"second_id":rows[j]["id"],"volume_mm3":float(volume)})
    shapes={r["id"]:s for r,s in zip(rows,children)}; boxes={r["id"]:r["bounding_box_mm"] for r in rows}
    clearances=[]
    for c in req.get("clearances",[]):
        distance=float(shapes[c["first_id"]].distance_to(shapes[c["second_id"]]))
        clearances.append({**c,"distance_mm":distance,"status":"clear" if distance+1e-6>=c["min_mm"] else "insufficient"})
    motions=[]
    for c in req.get("motions",[]):
        hits=[]; delta=[c["delta"][k] for k in ("x","y","z")]
        for moving in c["moving_ids"]:
            box=boxes[moving]
            swept={"min":[box["min"][k]+min(0,delta[k]) for k in range(3)],"max":[box["max"][k]+max(0,delta[k]) for k in range(3)]}
            for obstacle in c["obstacle_ids"]:
                if _overlap(swept,boxes[obstacle]): hits.append({"moving_id":moving,"obstacle_id":obstacle})
        motions.append({"id":c["id"],"method":"swept_aabb_translation","status":"potential_obstruction" if hits else "clear_envelope","pairs":hits})
    return {"collisions":{"status":"partial" if skipped else "complete","tested_pairs":tested,"skipped_pairs":skipped,"overlaps":overlaps},"clearances":clearances,"motions":motions}

def render_assembly(raw:Any,output_dir:str|Path)->dict[str,Any]:
    req=validate_request(raw); defs={d["id"]:_shape(d) for d in req["definitions"]}; children=[]; rows=[]
    for i in req["instances"]:
        p=i["placement"]; located=_location(p)*defs[i["definition_id"]]
        children.append(located); bb=located.bounding_box()
        rows.append({"id":i["id"],"definition_id":i["definition_id"],"bounding_box_mm":{"min":_vec(bb.min),"max":_vec(bb.max),"size":_vec(bb.size)}})
    assembly=Compound(children=children); bb=assembly.bounding_box(); size=_vec(bb.size)
    center=[(bb.min.X+bb.max.X)/2,(bb.min.Y+bb.max.Y)/2,(bb.min.Z+bb.max.Z)/2]; distance=max(max(size)*4,1000)
    out=Path(output_dir); out.mkdir(parents=True,exist_ok=True); step=out/"assembly.step"; export_step(assembly,str(step))
    exports={"step":{"file":step.name,"sha256":_hash(step)}}
    for view in req["views"]:
        origin,up=_camera(view,center,distance); visible,hidden=assembly.project_to_viewport(origin,viewport_up=up,look_at=center)
        path=out/f"{view}.svg"; svg=ExportSVG(unit=Unit.MM,scale=1,margin=10,precision=6); svg.add_layer("Visible"); svg.add_layer("Hidden",line_type=LineType.ISO_DOT); svg.add_shape(visible,layer="Visible"); svg.add_shape(hidden,layer="Hidden"); svg.write(str(path))
        exports[view]={"file":path.name,"sha256":_hash(path)}
    manifest={"contract_version":1,"engine":{"name":"build123d","version":"0.13.0","units":"mm"},"assembly_id":req["assembly_id"],"bounding_box_mm":{"min":_vec(bb.min),"max":_vec(bb.max),"size":size},"definitions":req["definitions"],"instances":rows,"exports":exports,"checks":_checks(req,children,rows)}
    (out/"manifest.json").write_text(json.dumps(manifest,indent=2,sort_keys=True)+"\n",encoding="utf-8")
    return manifest
