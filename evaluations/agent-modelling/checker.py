#!/usr/bin/env python3
"""Independent trial checker: reopens an agent's saved .cadara through the built
CLI only, measures bodies via native STL export, and runs parametric probes.
Usage: checker.py <task> <run-dir>  -> prints JSON verdict (`pass`, `checks`, `parametric`)."""
import json, math, os, struct, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "../.."))
# Built CLI entry (`bun run build:cli` writes dist-cli/); override with CADARA_CLI.
CLI = ["bun", os.environ.get("CADARA_CLI", os.path.join(REPO, "dist-cli", "main.js")), "document", "recipe"]
MESH = {"meshAccuracy": {"chordTolerance": 0.01, "angleToleranceRadians": 0.05}, "encoding": "binary"}

def run_recipe(ops, cwd):
    with tempfile.NamedTemporaryFile("w", suffix=".json", dir=cwd, delete=False) as f:
        json.dump({"version": 1, "operations": ops}, f)
        path = f.name
    try:
        p = subprocess.run(CLI + [path], cwd=cwd, capture_output=True, text=True, timeout=600)
    finally:
        os.unlink(path)
    try:
        return json.loads(p.stdout), p.returncode
    except json.JSONDecodeError:
        return {"error": p.stderr[-2000:]}, p.returncode

def stl_metrics(path):
    data = open(path, "rb").read()
    n = struct.unpack_from("<I", data, 80)[0]
    vol = 0.0
    lo = [math.inf] * 3; hi = [-math.inf] * 3
    for i in range(n):
        o = 84 + i * 50 + 12
        a = struct.unpack_from("<3f", data, o); b = struct.unpack_from("<3f", data, o + 12); c = struct.unpack_from("<3f", data, o + 24)
        vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6
        for p in (a, b, c):
            for k in range(3):
                lo[k] = min(lo[k], p[k]); hi[k] = max(hi[k], p[k])
    return {"volume": abs(vol), "min": lo, "max": hi, "triangles": n}

def measure(model, cwd, edits=()):
    """Open model, apply variable edits [(name, valueText)], return discovery facts + per-body STL metrics."""
    ops = [{"version": 1, "commandId": "open", "operation": "document.open", "path": model, "basis": None, "as": "m"}]
    last = "m"
    for i, (name, value) in enumerate(edits):
        ops.append({"version": 1, "commandId": f"var{i}", "operation": "variable.update", "basis": {"alias": last},
                    "variableId": {"alias": last, "label": name}, "name": name, "valueText": value, "intent": "fulfill", "as": f"v{i}"})
        last = f"v{i}"
    env, rc = run_recipe(ops, cwd)
    results = env.get("results") or []
    if rc != 0 or not results or results[-1]["outcome"]["kind"] != "completed":
        return {"ok": False, "stage": "open/edit", "rc": rc,
                "outcomes": [r["outcome"] for r in results], "diagnostics": [d.get("message") for r in results for d in r.get("diagnostics", [])],
                "error": env.get("error")}
    disc = results[-1]["discovery"]
    labels = {json.dumps(r["target"], sort_keys=True): r["label"] for r in disc["references"]}
    bodies = []
    exports = []
    for b in disc["model"]["bodies"]:
        label = labels.get(json.dumps({"kind": "body", "bodyId": b["bodyId"]}, sort_keys=True))
        faces = {}
        for t in b.get("topology") or []:
            if t["entityClass"] == "face":
                faces[t["geometryType"]] = faces.get(t["geometryType"], 0) + 1
        cyl = [t["centroid"] for t in (b.get("topology") or []) if t["entityClass"] == "face" and t["geometryType"] == "cylinder"]
        bodies.append({"label": label, "kind": b["kind"], "bounds": b["bounds"], "faces": faces, "cylinderCentroids": cyl})
        stl = os.path.join(cwd, f".check-{b['bodyId']}.stl")
        exports.append((len(bodies) - 1, stl))
        ops.append({"version": 1, "commandId": f"stl{len(exports)}", "operation": "export.stl", "basis": {"alias": last},
                    "target": {"kind": "body", "bodyId": b["bodyId"]}, "path": stl, "options": MESH})
    if exports:
        env2, rc2 = run_recipe(ops, cwd)
        for i, stl in exports:
            if os.path.exists(stl):
                bodies[i]["mesh"] = stl_metrics(stl); os.unlink(stl)
    return {"ok": True, "variables": {v["name"]: v.get("valueText") for v in disc.get("variables") or []},
            "bodies": bodies, "features": [f["kind"] for f in disc["model"]["features"]], "document": disc["document"]["label"]}

def close(a, b, tol):
    return abs(a - b) <= tol

def bounds_ok(body, lo, hi, tol=0.02):
    bd = body.get("bounds")
    return bool(bd) and all(close(bd["min"][k], lo[k], tol) and close(bd["max"][k], hi[k], tol) for k in range(3))

def vol_ok(body, expected, rel=0.004):
    v = body.get("mesh", {}).get("volume")
    return v is not None and abs(v - expected) <= rel * expected

PI = math.pi
TASKS = {}

def task(fn):
    TASKS[fn.__name__] = fn
    return fn

def single_solid(m):
    return m["ok"] and len(m["bodies"]) == 1 and m["bodies"][0]["kind"] == "solid"

@task
def t1(cwd):
    model = "plate.cadara"
    checks = {}
    if not os.path.exists(os.path.join(cwd, model)):
        return {"checks": {"saved": False}, "parametric": {}}
    m = measure(model, cwd)
    checks["saved"] = m["ok"]
    checks["single_solid"] = single_solid(m)
    b = m["bodies"][0] if checks["single_solid"] else {}
    checks["bounds"] = bool(b) and bounds_ok(b, [0, 0, 0], [80, 50, 6])
    checks["volume"] = bool(b) and vol_ok(b, 80 * 50 * 6 - 4 * PI * 9 * 6)
    checks["step_exported"] = os.path.exists(os.path.join(cwd, "plate.step")) and os.path.getsize(os.path.join(cwd, "plate.step")) > 1000
    names = ["width", "depth", "thickness", "holeDiameter", "holeInset"]
    checks["variables_present"] = m["ok"] and all(n in m["variables"] for n in names)
    param = {}
    if checks["variables_present"] and checks["single_solid"]:
        p = measure(model, cwd, [("width", "100")])
        pb = p["bodies"][0] if p.get("ok") and p["bodies"] else {}
        param["width_drives_bounds"] = bool(pb) and bounds_ok(pb, [0, 0, 0], [100, 50, 6])
        xs = sorted(round(c[0], 2) for c in pb.get("cylinderCentroids", []))
        param["holes_follow_width"] = len(xs) == 4 and close(xs[0], 8, 0.05) and close(xs[-1], 92, 0.05)
        p = measure(model, cwd, [("thickness", "10"), ("holeDiameter", "8"), ("holeInset", "10")])
        pb = p["bodies"][0] if p.get("ok") and p["bodies"] else {}
        param["thickness_drives_depth"] = bool(pb) and bounds_ok(pb, [0, 0, 0], [80, 50, 10])
        param["diameter_and_inset_drive_holes"] = bool(pb) and vol_ok(pb, 80 * 50 * 10 - 4 * PI * 16 * 10) and \
            sorted(round(c[0], 1) for c in pb.get("cylinderCentroids", []))[:1] == [10.0]
    return {"checks": checks, "parametric": param, "measured": m}

@task
def t2(cwd):
    model = "bushing.cadara"
    checks = {}
    if not os.path.exists(os.path.join(cwd, model)):
        return {"checks": {"saved": False}, "parametric": {}}
    m = measure(model, cwd)
    checks["saved"] = m["ok"]
    checks["single_solid"] = single_solid(m)
    b = m["bodies"][0] if checks["single_solid"] else {}
    checks["bounds"] = bool(b) and bounds_ok(b, [-14, -14, 0], [14, 14, 20])
    checks["volume"] = bool(b) and vol_ok(b, PI / 4 * ((16**2 - 10**2) * 20 + (28**2 - 16**2) * 3))
    checks["stl_exported"] = os.path.exists(os.path.join(cwd, "bushing.stl")) and os.path.getsize(os.path.join(cwd, "bushing.stl")) > 1000
    return {"checks": checks, "parametric": {}, "measured": m}

@task
def t3(cwd):
    model = "enclosure.cadara"
    checks = {}
    if not os.path.exists(os.path.join(cwd, model)):
        return {"checks": {"saved": False}, "parametric": {}}
    m = measure(model, cwd)
    checks["saved"] = m["ok"]
    checks["single_solid"] = single_solid(m)
    b = m["bodies"][0] if checks["single_solid"] else {}
    checks["bounds"] = bool(b) and bounds_ok(b, [0, 0, 0], [60, 40, 25])
    checks["volume"] = bool(b) and vol_ok(b, 60 * 40 * 25 - 56 * 36 * 23 - 2 * 20 * 4 * 2)
    return {"checks": checks, "parametric": {}, "measured": m}

@task
def t4(cwd):
    model = "plate-boss.cadara"
    checks = {}
    if not os.path.exists(os.path.join(cwd, model)):
        return {"checks": {"saved": False}, "parametric": {}}
    m = measure(model, cwd)
    checks["saved"] = m["ok"]
    checks["single_solid"] = single_solid(m)
    b = m["bodies"][0] if checks["single_solid"] else {}
    checks["bounds"] = bool(b) and bounds_ok(b, [0, 0, 0], [80, 50, 15])
    checks["volume"] = bool(b) and vol_ok(b, 80 * 50 * 10 - 4 * PI * 9 * 10 + PI * 100 * 5)
    checks["thickness_variable_is_10"] = m["ok"] and str(m["variables"].get("thickness", "")).strip() in ("10", "10.0")
    checks["original_untouched"] = os.path.exists(os.path.join(cwd, "plate.cadara"))
    return {"checks": checks, "parametric": {}, "measured": m}

def rrect(w, d, r):
    return w * d - (4 - PI) * r * r

def t5_volume(w, d, h, wall, inset):
    return rrect(w, d, 3) * h - rrect(w - 2 * wall, d - 2 * wall, 3 - wall) * (h - wall) + 4 * PI * 9 * 8 - 4 * PI * 1.25 ** 2 * (8 + wall)

def has_axes(body, pts, tol=0.05):
    cyl = body.get("cylinderCentroids", [])
    return all(any(abs(c[0] - x) <= tol and abs(c[1] - y) <= tol for c in cyl) for x, y in pts)

@task
def t5(cwd):
    model = "enclosure.cadara"
    checks = {}
    if not os.path.exists(os.path.join(cwd, model)):
        return {"checks": {"saved": False}, "parametric": {}}
    m = measure(model, cwd)
    checks["saved"] = m["ok"]
    checks["single_solid"] = single_solid(m)
    b = m["bodies"][0] if checks["single_solid"] else {}
    checks["bounds"] = bool(b) and bounds_ok(b, [0, 0, 0], [60, 40, 25])
    checks["volume"] = bool(b) and vol_ok(b, t5_volume(60, 40, 25, 2, 6))
    checks["boss_axes"] = bool(b) and has_axes(b, [(6, 6), (54, 6), (54, 34), (6, 34)])
    names = ["width", "depth", "height", "wall", "bossInset"]
    checks["variables_present"] = m["ok"] and all(n in m["variables"] for n in names)
    param = {}
    if checks["variables_present"] and checks["single_solid"]:
        p = measure(model, cwd, [("width", "80")])
        pb = p["bodies"][0] if p.get("ok") and len(p["bodies"]) == 1 else {}
        param["width_drives_bounds"] = bool(pb) and bounds_ok(pb, [0, 0, 0], [80, 40, 25])
        param["bosses_follow_width"] = bool(pb) and has_axes(pb, [(6, 6), (74, 6), (74, 34), (6, 34)])
        p = measure(model, cwd, [("height", "30"), ("bossInset", "8")])
        pb = p["bodies"][0] if p.get("ok") and len(p["bodies"]) == 1 else {}
        param["height_drives_bounds"] = bool(pb) and bounds_ok(pb, [0, 0, 0], [60, 40, 30])
        param["inset_drives_bosses"] = bool(pb) and has_axes(pb, [(8, 8), (52, 8), (52, 32), (8, 32)])
        p = measure(model, cwd, [("wall", "2.5")])
        pb = p["bodies"][0] if p.get("ok") and len(p["bodies"]) == 1 else {}
        param["wall_drives_shell"] = bool(pb) and vol_ok(pb, t5_volume(60, 40, 25, 2.5, 6))
    return {"checks": checks, "parametric": param, "measured": m}

TASKS["t6"] = t5

if __name__ == "__main__":
    name, cwd = sys.argv[1], os.path.abspath(sys.argv[2])
    verdict = TASKS[name](cwd)
    c = verdict["checks"]
    verdict["pass"] = bool(c) and all(c.values())
    verdict["parametric_score"] = f"{sum(verdict['parametric'].values())}/{len(verdict['parametric'])}" if verdict["parametric"] else None
    print(json.dumps(verdict))
