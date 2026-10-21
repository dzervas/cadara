import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";

type OC = OpenCascadeInstance;
type W = { delete(): void; isDeleted?(): boolean };
type AnyFn = (...args: unknown[]) => unknown;
type Patchable = Record<string, unknown>;

/** Minimal independent tracker: records wrappers by kind, counts deletes, arms first-delete failures. */
export function makeOccWrapperTracker(oc: OC) {
  const module = oc as unknown as Patchable;
  const created = new Map<string, W[]>();
  const attempts = new Map<W, number>();
  const stacks = new Map<W, string>();
  // An armed failure, optionally only for a wrapper created at a call site
  // whose stack `where` accepts (T10c review R-3: pick one of several sites).
  const armed = new Map<
    string,
    { error: Error; where?: (stack: string) => boolean }[]
  >();
  const failing = new Map<W, Error>();
  const restorers: Array<() => void> = [];
  let on = false;
  const record = (kind: string, v: unknown) => {
    if (!on || typeof v !== "object" || v === null) return v;
    const w = v as W;
    (created.get(kind) ?? created.set(kind, []).get(kind)!).push(w);
    const stack = new Error().stack ?? "";
    stacks.set(w, stack);
    const queue = armed.get(kind) ?? [];
    const index = queue.findIndex(
      (entry) => !entry.where || entry.where(stack),
    );
    if (index >= 0) failing.set(w, queue.splice(index, 1)[0]!.error);
    const native = w.delete.bind(w);
    attempts.set(w, 0);
    w.delete = () => {
      const n = (attempts.get(w) ?? 0) + 1;
      attempts.set(w, n);
      const f = failing.get(w);
      if (f && n === 1) throw f;
      native();
    };
    return w;
  };
  const patch = (owner: Patchable, name: string, wrap: (o: AnyFn) => AnyFn) => {
    const original = owner[name] as AnyFn;
    if (typeof original !== "function") throw new Error(`missing ${name}`);
    owner[name] = wrap(original);
    restorers.push(() => (owner[name] = original));
  };
  const proto = (c: string) =>
    (module[c] as { prototype: Patchable }).prototype;
  const result = (owner: Patchable, name: string, kind: string) =>
    patch(
      owner,
      name,
      (o) =>
        function (this: unknown, ...a: unknown[]) {
          return record(kind, o.apply(this, a));
        },
    );
  const ctor = (name: string, kind: string) => {
    const original = module[name] as new (...a: unknown[]) => object;
    module[name] = new Proxy(original, {
      construct: (t, a) => record(kind, Reflect.construct(t, a)) as object,
    });
    restorers.push(() => (module[name] = original));
  };
  ctor("TopLoc_Location_1", "TopLoc_Location");
  ctor("BRepAdaptor_Surface_2", "BRepAdaptor_Surface");
  ctor("BRepAdaptor_Curve_2", "BRepAdaptor_Curve");
  ctor("TopTools_IndexedMapOfShape_1", "TopTools_IndexedMapOfShape");
  const bt = module.BRep_Tool as Patchable;
  result(bt, "Triangulation", "Handle_Poly_Triangulation");
  result(bt, "PolygonOnTriangulation_1", "Handle_Poly_PolygonOnTriangulation");
  result(bt, "Polygon3D", "Handle_Poly_Polygon3D");
  result(bt, "Pnt", "gp_Pnt(vertex)");
  result(module.TopoDS as Patchable, "Face_1", "TopoDS_Face(Face_1)");
  result(
    proto("TopTools_IndexedMapOfShape"),
    "FindKey",
    "TopoDS_Shape(FindKey)",
  );
  result(proto("TopLoc_Location"), "Transformation", "gp_Trsf");
  result(proto("Poly_Triangulation"), "Node", "gp_Pnt(node)");
  result(proto("Poly_Triangulation"), "Normal_1", "gp_Dir(normal)");
  result(proto("Poly_Triangulation"), "Triangle", "Poly_Triangle");
  result(proto("gp_Pnt"), "Transformed", "gp_Pnt(transformed)");
  result(proto("gp_Dir"), "Transformed", "gp_Dir(transformed)");
  result(proto("BRepAdaptor_Surface"), "Plane", "gp_Pln");
  result(proto("gp_Pln"), "Position", "gp_Ax3");
  for (const n of ["Location", "XDirection", "YDirection", "Direction"])
    result(proto("gp_Ax3"), n, "gp_Ax3 component");
  result(proto("BRepAdaptor_Curve"), "Value", "gp_Pnt(curve)");
  result(proto("Poly_Polygon3D"), "Nodes", "TColgp_Array1OfPnt");
  result(proto("TColgp_Array1OfPnt"), "Value", "gp_Pnt(polygon)");
  const live = (w: W) => !w.isDeleted?.();
  return {
    ctor,
    patch,
    proto,
    result,
    async record<T>(f: () => T | Promise<T>) {
      on = true;
      try {
        return await f();
      } finally {
        on = false;
      }
    },
    arm(kind: string, e: Error, where?: (stack: string) => boolean) {
      (armed.get(kind) ?? armed.set(kind, []).get(kind)!).push({
        error: e,
        where,
      });
    },
    of: (k: string) => created.get(k) ?? [],
    attempts: (w: W) => attempts.get(w) ?? 0,
    stack: (w: W) => stacks.get(w) ?? "",
    failing: () => [...failing.keys()],
    liveByKind() {
      return Object.fromEntries(
        [...created]
          .map(([k, ws]) => [k, ws.filter(live).length])
          .filter(([, n]) => (n as number) > 0),
      );
    },
    created() {
      return Object.fromEntries([...created].map(([k, ws]) => [k, ws.length]));
    },
    siblingsNotOnce() {
      const f = new Set(failing.keys());
      return [...created.values()]
        .flat()
        .filter((w) => !f.has(w) && (attempts.get(w) !== 1 || live(w))).length;
    },
    clear() {
      created.clear();
      attempts.clear();
      armed.clear();
      failing.clear();
      stacks.clear();
    },
    leftovers() {
      failing.clear();
      for (const ws of created.values())
        for (const w of ws) if (live(w)) w.delete();
    },
    restore() {
      for (const r of restorers.reverse()) r();
      restorers.length = 0;
    },
  };
}

