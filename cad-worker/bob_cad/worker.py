from __future__ import annotations

import hashlib, json, math, re
from pathlib import Path
from typing import Any
from build123d import Align, Box, Compound, Cylinder, ExportSVG, LineType, Location, Unit, export_step

ID=re.compile(r"^[A-Za-z][A-Za-z0-9_.:-]{0,79}$")
class CadContractError(ValueError): pass

def _num(v:Any,name:str,positive=False,bound=1_000_000.0)->float:
    if isinstance(v,bool) or not isinstance(v,(int,float)) or not math.isfinite(float(v)): raise CadContractError(name)
    n=float(v)
    if abs(n)>bound or (positive and n<=0): raise CadContractError(name)
    return n

def _shape(d:dict[str,Any]):
    if d["primitive"]=="box":
        return Box(_num(d["x_mm"],"x",True),_num(d["y_mm"],"y",True),_num(d["z_mm"],"z",True),align=(Align.MIN,Align.MIN,Align.MIN))
    if d["primitive"]=="tube":
        od=_num(d["outside_diameter_mm"],"od",True); wall=_num(d["wall_thickness_mm"],"wall",True); length=_num(d["length_mm"],"length",True)
        if 2*wall>=od: raise CadContractError("tube_wall_invalid")
        outer=Cylinder(od/2,length,align=(Align.CENTER,Align.CENTER,Align.MIN))
        inner=Cylinder((od-2*wall)/2,length,align=(Align.CENTER,Align.CENTER,Align.MIN))
        return outer-inner
    raise CadContractError("primitive_unsupported")

def validate_request(raw:Any)->dict[str,Any]:
    if not isinstance(raw,dict) or set(raw)!={"contract_version","units","assembly_id","definitions","instances","views"}: raise CadContractError("request_shape")
    if raw["contract_version"]!=1 or raw["units"]!="mm" or not isinstance(raw["assembly_id"],str) or not ID.fullmatch(raw["assembly_id"]): raise CadContractError("contract")
    defs=raw["definitions"]; inst=raw["instances"]; views=raw["views"]
    if not isinstance(defs,list) or not 1<=len(defs)<=128 or not isinstance(inst,list) or not 1<=len(inst)<=512: raise CadContractError("counts")
    ids=set()
    for d in defs:
        if not isinstance(d,dict) or not isinstance(d.get("id"),str) or not ID.fullmatch(d["id"]) or d["id"] in ids: raise CadContractError("definition")
        ids.add(d["id"]); _shape(d)
    seen=set()
    for i in inst:
        if not isinstance(i,dict) or set(i)!={"id","definition_id","placement"} or not isinstance(i["id"],str) or i["id"] in seen or i["definition_id"] not in ids: raise CadContractError("instance")
        seen.add(i["id"]); p=i["placement"]
        if not isinstance(p,dict) or set(p)!={"x","y","z","rx","ry","rz"}: raise CadContractError("placement")
        for k in ("x","y","z"): _num(p[k],k,bound=10_000_000)
        for k in ("rx","ry","rz"): _num(p[k],k,bound=360_000)
    allowed={"front","right","top","isometric"}
    if not isinstance(views,list) or not 1<=len(views)<=4 or len(set(views))!=len(views) or any(v not in allowed for v in views): raise CadContractError("views")
    return raw

def _vec(v): return [float(v.X),float(v.Y),float(v.Z)]
def _hash(p:Path)->str: return hashlib.sha256(p.read_bytes()).hexdigest()

def _camera(view,center,d):
    x,y,z=center
    return {"front":((x,y-d,z),(0,0,1)),"right":((x+d,y,z),(0,0,1)),"top":((x,y,z+d),(0,1,0)),"isometric":((x+d,y-d,z+d),(0,0,1))}[view]

def render_assembly(raw:Any,output_dir:str|Path)->dict[str,Any]:
    req=validate_request(raw); defs={d["id"]:d for d in req["definitions"]}; children=[]; rows=[]
    for i in req["instances"]:
        p=i["placement"]; located=Location((p["x"],p["y"],p["z"]),(p["rx"],p["ry"],p["rz"]))*_shape(defs[i["definition_id"]])
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
    manifest={"contract_version":1,"engine":{"name":"build123d","version":"0.13.0","units":"mm"},"assembly_id":req["assembly_id"],"bounding_box_mm":{"min":_vec(bb.min),"max":_vec(bb.max),"size":size},"definitions":req["definitions"],"instances":rows,"exports":exports}
    (out/"manifest.json").write_text(json.dumps(manifest,indent=2,sort_keys=True)+"\n",encoding="utf-8")
    return manifest
