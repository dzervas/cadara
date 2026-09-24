import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import ts from "typescript";
import { expect, test } from "vitest";

// Policy guard: embind returns T* bindings as BORROWED aliases of a native owner
// (a Handle or a map). Deleting such an alias frees memory the owner still uses.
// The runtime inventory is pinned by scripts/occ/native-lifetime-conformance.mjs
// against the registered embind ABI; this guard pins the same list and proves
// production borrowed values only reach an audited, fail-closed consumer set.
//
// Coverage (honest): per-file, intraprocedural taint over TypeScript checker
// symbols. A borrowed value may only be (a) the receiver of a non-deallocating
// method call, (b) the argument of a new OCC Handle_* (shared ownership), (c) a
// local alias (const/let/assignment, parentheses, casts, ?:, ??, ||, &&, clone()),
// or (d) discarded. Everything else fails: any function argument (so renamed
// delete helpers cannot hide), storage, return, destructuring, detached or
// computed member access, module-scope bindings. Zero-argument get() and
// Seek/ChangeSeek/This calls that do not resolve to an OCC declaration fail
// closed (unresolved/any, or structurally re-typed). Not covered: .mjs scripts,
// spec files, and cross-file flows (none are allowed: escaping values fail).

const REPOSITORY = process.cwd();
const OCC_TYPINGS = [
  "/node_modules/opencascade.js/dist/opencascade.full.d.ts",
  "/public/cadara-occ.d.ts",
];
const BORROWED_METHOD_NAMES = new Set(["get", "Seek", "ChangeSeek", "This"]);
const DEALLOCATORS = new Set([
  "delete",
  "deleteLater",
  "Nullify",
  "Delete",
  "DecrementRefCounter",
]);
// Mirrors AUDITED_BORROWED_POINTER_BINDINGS plus the registered-but-uncallable
// Handle_TNaming_NamedShape.get (unbound pointee) from the lifetime gate.
const AUDITED_BORROWED_BINDINGS = [
  "Handle_BRepTools_History.get",
  "Handle_Geom2d_Curve.get",
  "Handle_Geom_Curve.get",
  "Handle_Poly_Polygon3D.get",
  "Handle_Poly_PolygonOnTriangulation.get",
  "Handle_Poly_Triangulation.get",
  "Handle_TNaming_NamedShape.get",
  "Standard_Transient.This",
  "TopTools_IndexedDataMapOfShapeListOfShape.ChangeSeek",
  "TopTools_IndexedDataMapOfShapeListOfShape.Seek",
];
// Every audited production borrowed root. A new root needs an ownership review.
const AUDITED_PRODUCTION_ROOTS = [
  "src/domain/modeling/occ/features/shell.ts Handle_Poly_Triangulation.get",
  "src/domain/modeling/occ/features/sweep.ts Handle_Geom_TrimmedCurve.get",
  "src/domain/modeling/occ/sketch-profile.ts Handle_Geom_TrimmedCurve.get",
  "src/domain/modeling/occ/snapshot.ts Handle_Poly_Polygon3D.get",
  "src/domain/modeling/occ/snapshot.ts Handle_Poly_PolygonOnTriangulation.get",
  "src/domain/modeling/occ/snapshot.ts Handle_Poly_Triangulation.get",
  "src/domain/modeling/occ/snapshot.ts Handle_Poly_Triangulation.get",
];

const isOccTypings = (fileName: string) =>
  OCC_TYPINGS.some((suffix) => fileName.replaceAll("\\", "/").endsWith(suffix));

function isBorrowedDeclaration(className: string, methodName: string) {
  if (methodName === "get") return className.startsWith("Handle_");
  return BORROWED_METHOD_NAMES.has(methodName);
}

function transparentParent(node: ts.Node) {
  let current = node;
  while (
    ts.isParenthesizedExpression(current.parent) ||
    ts.isAsExpression(current.parent) ||
    ts.isNonNullExpression(current.parent) ||
    ts.isSatisfiesExpression(current.parent) ||
    ts.isTypeAssertionExpression(current.parent)
  )
    current = current.parent;
  return current;
}

function memberName(access: ts.Expression) {
  if (ts.isPropertyAccessExpression(access)) return access.name.text;
  if (
    ts.isElementAccessExpression(access) &&
    ts.isStringLiteralLike(access.argumentExpression)
  )
    return access.argumentExpression.text;
  return null;
}

function analyze(program: ts.Program, files: readonly ts.SourceFile[]) {
  const checker = program.getTypeChecker();
  const violations: string[] = [];
  const roots: string[] = [];

  for (const sourceFile of files) {
    const path = relative(REPOSITORY, sourceFile.fileName).replaceAll(
      "\\",
      "/",
    );
    const where = (node: ts.Node) =>
      `${path}:${sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1}`;
    const fail = (node: ts.Node, reason: string) =>
      violations.push(`${where(node)} ${reason}`);

    const occMethod = (declaration: ts.Declaration | undefined) => {
      if (
        !declaration ||
        !isOccTypings(declaration.getSourceFile().fileName) ||
        !(
          ts.isMethodDeclaration(declaration) ||
          ts.isMethodSignature(declaration)
        )
      )
        return null;
      const owner = declaration.parent;
      const className =
        (ts.isClassDeclaration(owner) || ts.isInterfaceDeclaration(owner)) &&
        owner.name
          ? owner.name.text
          : "?";
      return { className, methodName: declaration.name.getText() };
    };
    const isOccHandleConstruction = (node: ts.NewExpression) => {
      const declaration = checker.getResolvedSignature(node)?.declaration;
      if (!declaration || !isOccTypings(declaration.getSourceFile().fileName))
        return false;
      const owner = declaration.parent;
      return (
        ts.isClassDeclaration(owner) &&
        owner.name?.text.startsWith("Handle_") === true
      );
    };
    // An assertion can replace the resolved call signature, so it is not
    // transparent when deciding whether a borrowed method is called directly.
    const isDirectCallee = (node: ts.Expression) => {
      let expression: ts.Node = node;
      while (
        ts.isParenthesizedExpression(expression.parent) ||
        ts.isNonNullExpression(expression.parent) ||
        ts.isSatisfiesExpression(expression.parent)
      )
        expression = expression.parent;
      return (
        ts.isCallExpression(expression.parent) &&
        expression.parent.expression === expression
      );
    };
    const isBorrowedMethodType = (type: ts.Type) =>
      type.getCallSignatures().some((signature) => {
        const method = occMethod(signature.declaration);
        return (
          method !== null &&
          isBorrowedDeclaration(method.className, method.methodName)
        );
      });
    const receiverHasBorrowedMethod = (
      receiver: ts.Expression,
      name: string,
    ) => {
      const property = checker.getTypeAtLocation(receiver).getProperty(name);
      const method = occMethod(
        property?.valueDeclaration ?? property?.declarations?.[0],
      );
      return (
        method !== null &&
        isBorrowedDeclaration(method.className, method.methodName)
      );
    };

    const tainted = new Set<ts.Symbol>();
    const pending: ts.Symbol[] = [];
    const taintIdentifier = (name: ts.Identifier) => {
      const symbol = checker.getSymbolAtLocation(name);
      const declaration = symbol?.valueDeclaration;
      if (
        !symbol ||
        !declaration ||
        ts.isSourceFile(
          ts.findAncestor(
            declaration,
            (n) => ts.isFunctionLike(n) || ts.isSourceFile(n),
          )!,
        )
      ) {
        fail(name, "borrowed value bound outside a function scope");
        return;
      }
      if (!tainted.has(symbol)) {
        tainted.add(symbol);
        pending.push(symbol);
      }
    };

    // Classifies one use of a borrowed expression against the allowed consumers.
    const consume = (expression: ts.Node) => {
      const node = transparentParent(expression);
      const parent = node.parent;
      if (ts.isExpressionStatement(parent)) return;
      if (ts.isVariableDeclaration(parent) && parent.initializer === node) {
        if (ts.isIdentifier(parent.name)) taintIdentifier(parent.name);
        else fail(parent, "borrowed value destructured");
        return;
      }
      if (ts.isBinaryExpression(parent) && parent.right === node) {
        const operator = parent.operatorToken.kind;
        if (operator === ts.SyntaxKind.EqualsToken) {
          if (ts.isIdentifier(parent.left)) {
            taintIdentifier(parent.left);
            // Assignment expressions retain the borrowed value as their result.
            consume(parent);
          } else fail(parent, "borrowed value stored into a non-local target");
          return;
        }
      }
      if (
        (ts.isConditionalExpression(parent) && parent.condition !== node) ||
        (ts.isBinaryExpression(parent) &&
          [
            ts.SyntaxKind.QuestionQuestionToken,
            ts.SyntaxKind.BarBarToken,
            ts.SyntaxKind.AmpersandAmpersandToken,
          ].includes(parent.operatorToken.kind)) ||
        (ts.isBinaryExpression(parent) &&
          parent.operatorToken.kind === ts.SyntaxKind.CommaToken &&
          parent.right === node)
      ) {
        consume(parent);
        return;
      }
      if (
        (ts.isPropertyAccessExpression(parent) ||
          ts.isElementAccessExpression(parent)) &&
        parent.expression === node
      ) {
        const name = memberName(parent);
        const call = transparentParent(parent).parent;
        if (name === null) {
          fail(parent, "computed member access on a borrowed value");
        } else if (
          !ts.isCallExpression(call) ||
          transparentParent(parent) !== call.expression
        ) {
          fail(parent, `detached member '${name}' of a borrowed value`);
        } else if (DEALLOCATORS.has(name)) {
          fail(call, `borrowed value released via ${name}()`);
        } else if (name === "clone") {
          consume(call); // clone() shares the borrowed pointer: still an alias
        }
        return;
      }
      if (
        ts.isNewExpression(parent) &&
        parent.arguments?.includes(node as ts.Expression) &&
        isOccHandleConstruction(parent)
      )
        return;
      fail(node, `borrowed value escapes to ${ts.SyntaxKind[parent.kind]}`);
    };

    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        let inner: ts.Expression = node.expression;
        while (
          ts.isParenthesizedExpression(inner) ||
          ts.isNonNullExpression(inner)
        )
          inner = inner.expression;
        const name =
          ts.isPropertyAccessExpression(inner) ||
          ts.isElementAccessExpression(inner)
            ? memberName(inner)
            : null;
        const method = occMethod(
          checker.getResolvedSignature(node)?.declaration,
        );
        if (
          method &&
          isBorrowedDeclaration(method.className, method.methodName)
        ) {
          roots.push(`${path} ${method.className}.${method.methodName}`);
          if (method.methodName === "This")
            fail(
              node,
              "Standard_Transient.This() is blocked pending ownership review",
            );
          consume(node);
        } else if (
          name !== null &&
          !method &&
          ((name === "get" && node.arguments.length === 0) ||
            (name !== "get" && BORROWED_METHOD_NAMES.has(name)))
        ) {
          // Fail closed: production has no non-OCC native-looking calls, so a
          // type-erased or structurally re-typed receiver cannot hide a root.
          const declaration = checker.getResolvedSignature(node)?.declaration;
          fail(
            node,
            declaration
              ? `native-looking ${name}() call resolved to a non-OCC declaration`
              : `unresolved native-looking ${name}() call (type-erased receiver)`,
          );
        }
      }
      // Borrowed methods may only be called directly, never detached or aliased.
      if (
        (ts.isPropertyAccessExpression(node) ||
          ts.isElementAccessExpression(node)) &&
        !isDirectCallee(node)
      ) {
        const symbol = ts.isPropertyAccessExpression(node)
          ? checker.getSymbolAtLocation(node.name)
          : (() => {
              const key = checker.getTypeAtLocation(node.argumentExpression);
              return key.isStringLiteral()
                ? checker
                    .getTypeAtLocation(node.expression)
                    .getProperty(key.value)
                : undefined;
            })();
        const method = occMethod(
          symbol?.valueDeclaration ?? symbol?.declarations?.[0],
        );
        if (
          method &&
          isBorrowedDeclaration(method.className, method.methodName)
        )
          fail(
            node,
            `detached borrowed method ${method.className}.${method.methodName}`,
          );
      }
      if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
        const key = node.propertyName ?? node.name;
        const keyText =
          ts.isIdentifier(key) || ts.isStringLiteralLike(key) ? key.text : null;
        const binding = node.parent.parent;
        const receiver =
          ts.isVariableDeclaration(binding) && binding.initializer
            ? binding.initializer
            : binding;
        const property =
          keyText === null
            ? undefined
            : checker.getTypeAtLocation(receiver).getProperty(keyText);
        const method = occMethod(
          property?.valueDeclaration ?? property?.declarations?.[0],
        );
        if (
          (method &&
            isBorrowedDeclaration(method.className, method.methodName)) ||
          keyText === null
        )
          fail(node, "destructured borrowed method");
      }
      if (
        ts.isCallExpression(node) &&
        ts.isElementAccessExpression(node.expression) &&
        memberName(node.expression) === null &&
        !checker.getResolvedSignature(node)?.declaration
      )
        fail(node, "unresolved computed call");
      if (
        ts.isExpression(node) &&
        !(
          ts.isPropertyAccessExpression(node.parent) &&
          node.parent.name === node
        ) &&
        !isDirectCallee(node) &&
        !ts.findAncestor(node, ts.isTypeNode) &&
        isBorrowedMethodType(checker.getTypeAtLocation(node))
      )
        fail(node, "borrowed method value used outside a direct call");
      const nativeLookingName =
        ts.isPropertyAccessExpression(node) ||
        ts.isElementAccessExpression(node)
          ? memberName(node)
          : null;
      if (
        nativeLookingName !== null &&
        BORROWED_METHOD_NAMES.has(nativeLookingName) &&
        (checker.getTypeAtLocation(
          (node as ts.PropertyAccessExpression).expression,
        ).flags &
          ts.TypeFlags.Any) !==
          0 &&
        !isDirectCallee(node)
      )
        fail(node, "native-looking member on type-erased receiver");
      if (
        nativeLookingName !== null &&
        BORROWED_METHOD_NAMES.has(nativeLookingName) &&
        !isDirectCallee(node)
      ) {
        const symbol = checker
          .getTypeAtLocation((node as ts.PropertyAccessExpression).expression)
          .getProperty(nativeLookingName);
        const declaration =
          symbol?.valueDeclaration ?? symbol?.declarations?.[0];
        if (
          declaration &&
          !occMethod(declaration) &&
          checker
            .getTypeAtLocation(node)
            .getCallSignatures()
            .some(
              (signature) =>
                nativeLookingName !== "get" ||
                signature.parameters.length === 0,
            )
        )
          fail(
            node,
            "native-looking member detached from a non-OCC declaration",
          );
      }
      if (ts.isCallExpression(node))
        for (const argument of node.arguments)
          if (
            ts.isStringLiteralLike(argument) &&
            BORROWED_METHOD_NAMES.has(argument.text) &&
            node.arguments.some(
              (receiver) =>
                receiver !== argument &&
                receiverHasBorrowedMethod(receiver, argument.text),
            )
          )
            fail(argument, "borrowed method named by string argument");
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);

    while (pending.length > 0) {
      const symbol = pending.pop()!;
      const references = (node: ts.Node) => {
        if (ts.isTypeNode(node)) return; // `typeof alias` is not a value use
        if (ts.isIdentifier(node)) {
          const parent = node.parent;
          const resolved = ts.isShorthandPropertyAssignment(parent)
            ? checker.getShorthandAssignmentValueSymbol(parent)
            : checker.getSymbolAtLocation(node);
          const isDeclarationName =
            ts.isVariableDeclaration(parent) && parent.name === node;
          const isAssignmentTarget =
            ts.isBinaryExpression(parent) &&
            parent.left === node &&
            parent.operatorToken.kind === ts.SyntaxKind.EqualsToken;
          if (
            resolved === symbol &&
            !isDeclarationName &&
            !isAssignmentTarget
          ) {
            if (ts.isShorthandPropertyAssignment(parent))
              fail(node, "borrowed value stored in an object literal");
            else consume(node);
          }
        }
        ts.forEachChild(node, references);
      };
      references(sourceFile);
    }
  }
  return { violations, roots: roots.sort() };
}

const FIXTURE_DIRECTORY = join(
  REPOSITORY,
  "test/static/__occ_borrowed_guard_fixtures__",
);
const FIXTURE_PRELUDE = `import type { OpenCascadeInstance } from "opencascade.js/dist/opencascade.full";
import { deleteOccObject, releaseOccObjects } from "@/domain/modeling/occ/memory";
type Oc = OpenCascadeInstance;
type Tri = InstanceType<Oc["Handle_Poly_Triangulation"]>;
type Curve = InstanceType<Oc["Handle_Geom_TrimmedCurve"]>;
type Map3 = InstanceType<Oc["TopTools_IndexedDataMapOfShapeListOfShape"]>;
type Shape = InstanceType<Oc["TopoDS_Shape"]>;
type Transient = InstanceType<Oc["Standard_Transient"]>;
void deleteOccObject; void releaseOccObjects;
`;
// Each negative fixture must produce at least one violation matching `reason`.
const NEGATIVE_FIXTURES: Record<string, { body: string; reason: string }> = {
  directDelete: {
    body: "export function f(h: Tri) { h.get().delete(); }",
    reason: "released via delete()",
  },
  aliasChainDelete: {
    body: "export function f(h: Tri) { const t = h.get(); let u; u = t; const w = (u as typeof t)!; w.delete(); }",
    reason: "released via delete()",
  },
  optionalDelete: {
    body: "export function f(h: Tri) { const t = h.get(); t?.delete(); }",
    reason: "released via delete()",
  },
  literalComputedDelete: {
    body: 'export function f(h: Tri) { const t = h.get(); t["delete"](); }',
    reason: "released via delete()",
  },
  dynamicComputedDelete: {
    body: 'export function f(h: Tri) { const t = h.get(); const k = ["del", "ete"].join("") as "delete"; t[k](); }',
    reason: "computed member access",
  },
  detachedDelete: {
    body: "export function f(h: Tri) { const t = h.get(); const d = t.delete; d.call(t); }",
    reason: "detached member 'delete'",
  },
  commaDetachedDelete: {
    body: "export function f(h: Tri) { const t = h.get(); (0, t.delete)(); }",
    reason: "detached member 'delete'",
  },
  nullify: {
    body: "export function f(h: Tri) { (h.get() as unknown as { Nullify(): void }).Nullify(); }",
    reason: "released via Nullify()",
  },
  transientDelete: {
    body: "export function f(h: Tri) { (h.get() as unknown as Transient).Delete(); }",
    reason: "released via Delete()",
  },
  decrementRefCounter: {
    body: "export function f(h: Tri) { (h.get() as unknown as Transient).DecrementRefCounter(); }",
    reason: "released via DecrementRefCounter()",
  },
  deleteHelper: {
    body: "export function f(h: Tri) { deleteOccObject(h.get()); }",
    reason: "escapes to CallExpression",
  },
  renamedDeleteHelper: {
    body: "const release = deleteOccObject; export function f(h: Tri) { const t = h.get(); release(t); }",
    reason: "escapes to CallExpression",
  },
  localDeleteHelper: {
    body: "function dispose(x: { delete(): void }) { x.delete(); } export function f(h: Tri) { dispose(h.get()); }",
    reason: "escapes to CallExpression",
  },
  releaseOwner: {
    body: "export function f(h: Tri) { const t = h.get(); releaseOccObjects([t]); }",
    reason: "escapes to ArrayLiteralExpression",
  },
  localCloneAlias: {
    body: "export function f(h: Tri) { const t = h.get(); const c = (t as unknown as { clone(): typeof t }).clone(); c.delete(); }",
    reason: "released via delete()",
  },
  castToAnyRoot: {
    body: "export function f(h: Tri) { (h as any).get().delete(); }",
    reason: "unresolved native-looking get()",
  },
  anyParameterRoot: {
    body: "export function f(h: any) { const t = h.get(); t.NbNodes(); }",
    reason: "unresolved native-looking get()",
  },
  structuralRetype: {
    body: "export function f(h: Tri) { const erased: { get(): { delete(): void } } = h; erased.get().delete(); }",
    reason: "resolved to a non-OCC declaration",
  },
  computedRootAny: {
    body: 'export function f(h: any) { h["get"]().delete(); }',
    reason: "unresolved native-looking get()",
  },
  detachedGet: {
    body: "export function f(h: Tri) { const g = h.get; return g; }",
    reason: "detached borrowed method Handle_Poly_Triangulation.get",
  },
  seekDelete: {
    body: "export function f(m: Map3, s: Shape) { m.Seek(s).delete(); }",
    reason: "released via delete()",
  },
  changeSeekStored: {
    body: "export function f(m: Map3, s: Shape) { return m.ChangeSeek(s); }",
    reason: "escapes to ReturnStatement",
  },
  thisBlocked: {
    body: 'export function f(t: Transient) { t.This().IsKind_2("x"); }',
    reason: "Standard_Transient.This() is blocked",
  },
  objectShorthand: {
    body: "export function f(h: Tri) { const t = h.get(); return { t }; }",
    reason: "stored in an object literal",
  },
  propertyStore: {
    body: "export function f(h: Tri, o: { t?: unknown }) { o.t = h.get(); }",
    reason: "stored into a non-local target",
  },
  destructured: {
    body: "export function f(h: Tri) { const { NbNodes } = h.get(); return NbNodes; }",
    reason: "destructured",
  },
  moduleScope: {
    body: "declare const h: Tri; export const t = h.get();",
    reason: "outside a function scope",
  },
  closureDelete: {
    body: "export function f(h: Tri) { const t = h.get(); return () => t.delete(); }",
    reason: "released via delete()",
  },
  ternaryAliasDelete: {
    body: "export function f(h: Tri, g: Tri, c: boolean) { (c ? h.get() : g.get()).delete(); }",
    reason: "released via delete()",
  },
};
// Owned copies, owner handles, Map.get(key) and Handle re-wraps must stay legal.
// Independently reproduced review cases, including F5's lint-clean method
// detachment routes. The guard rejects them directly; lint is not the policy
// boundary for either explicit or implicit `any`.
const REVIEW_FIXTURES: Record<
  string,
  { body: string; expectedReason?: string }
> = {
  assignExprDelete: {
    body: "export function f(h: Tri) { let t; (t = h.get()).delete(); }",
    expectedReason: "released via delete()",
  },
  assignExprHelper: {
    body: "export function f(h: Tri) { let t; deleteOccObject(t = h.get()); }",
    expectedReason: "escapes to CallExpression",
  },
  assignExprInTernaryAlias: {
    body: "export function f(h: Tri, c: boolean) { let t; const u = c ? (t = h.get()) : null; u?.delete(); }",
    expectedReason: "released via delete()",
  },
  chainedAssign: {
    body: "export function f(h: Tri) { let a, b; a = b = h.get(); a.delete(); }",
    expectedReason: "released via delete()",
  },
  aliasAssignExpr: {
    body: "export function f(h: Tri) { const t = h.get(); let u; (u = t).delete(); }",
    expectedReason: "released via delete()",
  },
  aliasAssignExprReturn: {
    body: "export function f(h: Tri) { const t = h.get(); let u; return (u = t); }",
    expectedReason: "escapes to ReturnStatement",
  },
  destructuredMethodCall: {
    body: "export function f(h: Tri) { const { get } = h; get.call(h).delete(); }",
    expectedReason: "destructured borrowed method",
  },
  destructuredMethodApply: {
    body: "export function f(h: Tri) { const { get: g } = h; g.apply(h).delete(); }",
    expectedReason: "destructured borrowed method",
  },
  paramDestructuredMethod: {
    body: "export function f(h: Tri) { const run = ({ get }: Tri) => get.call(h); run(h); }",
    expectedReason: "destructured borrowed method",
  },
  destructuredDirectCall: {
    body: "export function f(h: Tri) { const { get } = h; get().delete(); }",
    expectedReason: "destructured borrowed method",
  },
  dynamicComputedRootAny: {
    body: "export function f(h: any, k: string) { h[k]().delete(); }",
    expectedReason: "unresolved computed call",
  },
  anyGetCallCall: {
    body: "export function f(h: Tri) { (h as any).get.call(h).delete(); }",
    expectedReason: "native-looking member on type-erased receiver",
  },
  objectCtorElementCall: {
    body: 'export function f(h: Tri) { Object(h)["get"].call(h).delete(); }',
    expectedReason: "native-looking member on type-erased receiver",
  },
  protoElementCall: {
    body: 'export function f(h: Tri) { Object.getPrototypeOf(h)["get"].call(h).delete(); }',
    expectedReason: "native-looking member on type-erased receiver",
  },
  anyElementCall: {
    body: 'export function f(h: Tri) { (h as any)["get"].call(h).delete(); }',
    expectedReason: "native-looking member on type-erased receiver",
  },
  castCalleeUnknown: {
    body: "export function f(h: Tri) { (h.get as unknown as () => { delete(): void })().delete(); }",
    expectedReason: "detached borrowed method",
  },
  castCalleeStructural: {
    body: "export function f(h: Tri) { (h.get as () => { delete(): void })().delete(); }",
    expectedReason: "detached borrowed method",
  },
  castCalleeAnyReceiver: {
    body: "export function f(h: Tri) { (Object(h).get as () => { delete(): void })().delete(); }",
    expectedReason: "native-looking member on type-erased receiver",
  },
  castCalleeSeek: {
    body: "export function f(m: Map3, s: Shape) { (m.Seek as (s: Shape) => { delete(): void })(s).delete(); }",
    expectedReason: "detached borrowed method",
  },
  structuralDetachAssign: {
    body: "export function f(h: Tri) { const x: { get: () => { delete(): void } } = h; x.get.call(h).delete(); }",
    expectedReason: "native-looking member detached from a non-OCC declaration",
  },
  structuralDetachCast: {
    body: "export function f(h: Tri) { (h as { get(): { delete(): void } }).get.call(h).delete(); }",
    expectedReason: "native-looking member detached from a non-OCC declaration",
  },
  genericPluck: {
    body: 'function pluck<T, K extends keyof T>(o: T, k: K): T[K] { return o[k]; } export function f(h: Tri) { pluck(h, "get").call(h).delete(); }',
    expectedReason: "borrowed method value used outside a direct call",
  },
  genericPluckSeek: {
    body: 'function pluck<T, K extends keyof T>(o: T, k: K): T[K] { return o[k]; } export function f(m: Map3, s: Shape) { pluck(m, "Seek").call(m, s).delete(); }',
    expectedReason: "borrowed method value used outside a direct call",
  },
  keyofParamDetach: {
    body: 'export function f(h: Tri, k: keyof Tri) { (h[k] as Tri["get"]).call(h).delete(); }',
    expectedReason: "borrowed method value used outside a direct call",
  },
  implicitAnyReflectGetCall: {
    body: 'export function f(h: Tri) { Reflect.get(h, "get").call(h).delete(); }',
    expectedReason: "borrowed method named by string argument",
  },
  implicitAnyReflectGetTyped: {
    body: 'export function f(h: Tri) { const g: Tri["get"] = Reflect.get(h, "get"); g.call(h).delete(); }',
    expectedReason: "borrowed method named by string argument",
  },
  implicitAnyReflectSeek: {
    body: 'export function f(m: Map3, s: Shape) { Reflect.get(m, "Seek").call(m, s).delete(); }',
    expectedReason: "borrowed method named by string argument",
  },
  implicitAnyPrototypeGet: {
    body: "export function f(h: Tri) { Object.getPrototypeOf(h).get.call(h).delete(); }",
    expectedReason: "native-looking member on type-erased receiver",
  },
  implicitAnyObjectCtor: {
    body: "export function f(h: Tri) { Object(h).get.call(h).delete(); }",
    expectedReason: "native-looking member on type-erased receiver",
  },
  elementDetachTypedKey: {
    body: 'export function f(h: Tri) { const k = "get" as const; const g = h[k]; g.call(h).delete(); }',
    expectedReason: "detached borrowed method",
  },
  dynamicComputedRootTypedKey: {
    body: 'export function f(h: Tri, k: "get") { h[k]().delete(); }',
    expectedReason: "released via delete()",
  },
  reflectApply: {
    body: "export function f(h: Tri) { Reflect.apply(h.get, h, []).delete(); }",
    expectedReason: "detached borrowed method",
  },
  bindDetached: {
    body: "export function f(h: Tri) { h.get.bind(h)().delete(); }",
    expectedReason: "detached borrowed method",
  },
  logicalAssign: {
    body: "export function f(h: Tri) { let t; t ??= h.get(); t.delete(); }",
    expectedReason: "escapes to BinaryExpression",
  },
  classField: {
    body: "export function f(h: Tri) { class C { t = h.get(); } return new C(); }",
    expectedReason: "escapes to PropertyDeclaration",
  },
  paramDefault: {
    body: "export function f(h: Tri, t = h.get()) { t.delete(); }",
    expectedReason: "escapes to Parameter",
  },
  forOf: {
    body: "export function f(h: Tri) { for (const t of [h.get()]) t.delete(); }",
    expectedReason: "escapes to ArrayLiteralExpression",
  },
  closureOuterAssign: {
    body: "export function f(h: Tri) { let t; const g = () => { t = h.get(); }; g(); t!.delete(); }",
    expectedReason: "released via delete()",
  },
  controlFlowJoin: {
    body: 'export function f(h: Tri, c: boolean) { let t = null as null | ReturnType<Tri["get"]>; if (c) t = h.get(); t?.delete(); }',
    expectedReason: "released via delete()",
  },
  rewrapThenDeleteBorrowed: {
    body: "export function f(oc: Oc, h: Tri) { const t = h.get(); new oc.Handle_Poly_Triangulation_2(t).delete(); t.delete(); }",
    expectedReason: "released via delete()",
  },
  optionalComputedDelete: {
    body: 'export function f(h: Tri) { h.get()?.["delete"]?.(); }',
    expectedReason: "released via delete()",
  },
  templateComputedDelete: {
    body: "export function f(h: Tri) { const t = h.get(); t[`delete`](); }",
    expectedReason: "released via delete()",
  },
  genericReceiver: {
    body: "export function f<T extends Tri>(h: T) { h.get().delete(); }",
    expectedReason: "released via delete()",
  },
  getterReturn: {
    body: "export function f(h: Tri) { return { get t() { return h.get(); } }; }",
    expectedReason: "escapes to ReturnStatement",
  },
  awaitEscape: {
    body: "export async function f(h: Tri) { const t = await h.get(); t.delete(); }",
    expectedReason: "escapes to AwaitExpression",
  },
  deleteLaterOptional: {
    body: "export function f(h: Tri) { const t = h.get(); t.deleteLater?.(); }",
    expectedReason: "released via deleteLater()",
  },
  arrayIndexStore: {
    body: "export function f(h: Tri) { const a: unknown[] = []; a[0] = h.get(); }",
    expectedReason: "stored into a non-local target",
  },
  seekViaAnyComputed: {
    body: "export function f(m: any, s: Shape, k: string) { m[k](s).delete(); }",
    expectedReason: "unresolved computed call",
  },
  // Runtime-rejected: v2 lacks Handle_Standard_Transient_2 and a real Handle
  // constructor rejects this ListOfShape with BindingError. This is not lint
  // coverage and remains outside the static policy.
  rewrapSeekAsAny: {
    body: "export function f(oc: Oc, m: Map3, s: Shape) { const x = new oc.Handle_Standard_Transient_2(m.Seek(s) as any); x.delete(); }",
  },
  constChained: {
    body: "export function f(h: Tri) { let b; const a = (b = h.get()); a.delete(); return b; }",
    expectedReason: "released via delete()",
  },
  passDetachedArg: {
    body: "export function f(h: Tri, invoke: (fn: () => unknown) => void) { invoke(h.get); }",
    expectedReason: "detached borrowed method",
  },
  arrayOfDetached: {
    body: "export function f(h: Tri) { const fns = [h.get]; return fns; }",
    expectedReason: "detached borrowed method",
  },
  prodLikeAssignExprUse: {
    body: "export function f(h: Tri) { let t; const n = (t = h.get()).NbNodes(); return n + t.NbTriangles(); }",
  },
  structuralMethodCast: {
    body: "export function f(h: Tri) { const x: { get(): { delete(): void } } = h; x.get().delete(); }",
    expectedReason: "resolved to a non-OCC declaration",
  },
  indexSignatureRoot: {
    body: 'export function f(h: Tri) { const x: { [key: string]: () => { delete(): void } } = h; x["get"]().delete(); }',
    expectedReason: "resolved to a non-OCC declaration",
  },
};

const POSITIVE_FIXTURE = `
export function mapGetIsNotBorrowed(values: Map<string, Shape>) {
  const value = values.get("k");
  deleteOccObject(value);
  releaseOccObjects([...values.values()]);
}
export function ownedCopies(oc: Oc, faces: InstanceType<Oc["TopTools_IndexedMapOfShape"]>) {
  const key = faces.FindKey(1);
  const face = oc.TopoDS.Face_1(key);
  face.delete();
  key.delete();
}
export function ownerHandleRelease(oc: Oc, face: InstanceType<Oc["TopoDS_Face"]>) {
  const location = new oc.TopLoc_Location_1();
  const handle = oc.BRep_Tool.Triangulation(face, location, 0 as never);
  const triangulation = handle.get();
  let alias = null;
  alias = triangulation;
  const count = alias.NbNodes() + (handle.IsNull() ? 0 : triangulation.NbTriangles());
  handle.get();
  handle.delete();
  location.delete();
  return count;
}
export function handleRewrap(oc: Oc, arc: Curve) {
  const owned = new oc.Handle_Geom_Curve_2(arc.get());
  owned.delete();
}
`;

function fixtureFile(name: string) {
  return join(FIXTURE_DIRECTORY, `${name}.ts`);
}

function createProgram() {
  const parsed = ts.getParsedCommandLineOfConfigFile(
    join(REPOSITORY, "tsconfig.app.json"),
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new Error(
          ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
        );
      },
    },
  )!;
  const fixtures = new Map<string, string>([
    [fixtureFile("positive"), FIXTURE_PRELUDE + POSITIVE_FIXTURE],
    ...Object.entries(REVIEW_FIXTURES).map(
      ([name, fixture]) =>
        [
          fixtureFile(`review-${name}`),
          FIXTURE_PRELUDE + fixture.body,
        ] as const,
    ),
    ...Object.entries(NEGATIVE_FIXTURES).map(
      ([name, fixture]) =>
        [fixtureFile(name), FIXTURE_PRELUDE + fixture.body] as const,
    ),
  ]);
  const host = ts.createCompilerHost(parsed.options, true);
  const { getSourceFile, fileExists, readFile } = host;
  host.fileExists = (fileName) =>
    fixtures.has(fileName) || fileExists(fileName);
  host.readFile = (fileName) => fixtures.get(fileName) ?? readFile(fileName);
  host.getSourceFile = (fileName, language, ...rest) => {
    const text = fixtures.get(fileName);
    return text === undefined
      ? getSourceFile(fileName, language, ...rest)
      : ts.createSourceFile(fileName, text, language, true);
  };
  const program = ts.createProgram({
    rootNames: [...parsed.fileNames, ...fixtures.keys()],
    options: { ...parsed.options, noEmit: true },
    host,
  });
  return { program, fixtures };
}

test("test/static/occ-borrowed-pointer-guard.spec.ts", () => {
  // The guard's declaration predicate must cover exactly the audited runtime
  // inventory in the shipped declarations, and not owned by-value/ref copies.
  const declarations = ts.createSourceFile(
    "cadara-occ.d.ts",
    readFileSync(join(REPOSITORY, "public/cadara-occ.d.ts"), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const declared = new Set<string>();
  const borrowed: string[] = [];
  declarations.forEachChild((node) => {
    if (!ts.isClassDeclaration(node) || !node.name) return;
    for (const member of node.members) {
      if (!ts.isMethodDeclaration(member)) continue;
      const binding = `${node.name.text}.${member.name.getText()}`;
      declared.add(binding);
      if (isBorrowedDeclaration(node.name.text, member.name.getText()))
        borrowed.push(binding);
    }
  });
  expect(
    [...new Set(borrowed)].sort(),
    "The borrowed-return predicate must match the audited embind T* inventory exactly",
  ).toEqual(AUDITED_BORROWED_BINDINGS);
  for (const owned of ["TopTools_IndexedMapOfShape.FindKey", "TopoDS.Face_1"]) {
    expect(declared.has(owned), `${owned} must stay declared`).toBe(true);
    const [className, methodName] = owned.split(".");
    expect(
      isBorrowedDeclaration(className, methodName),
      `${owned} returns an embind-owned copy and must not be treated as borrowed`,
    ).toBe(false);
  }

  const { program, fixtures } = createProgram();
  const fixtureFiles = (name: string) => [
    program.getSourceFile(fixtureFile(name))!,
  ];

  expect(
    analyze(program, fixtureFiles("positive")).violations,
    "Map.get(key), owned copies, owner-handle release and Handle re-wraps must pass",
  ).toEqual([]);
  for (const [name, fixture] of Object.entries(NEGATIVE_FIXTURES)) {
    const { violations } = analyze(program, fixtureFiles(name));
    expect(
      violations.some((violation) => violation.includes(fixture.reason)),
      `Negative fixture ${name} must fail with "${fixture.reason}"; got ${JSON.stringify(violations)}`,
    ).toBe(true);
  }
  for (const [name, fixture] of Object.entries(REVIEW_FIXTURES)) {
    const { violations } = analyze(program, fixtureFiles(`review-${name}`));
    if (fixture.expectedReason)
      expect(
        violations.some((violation) =>
          violation.includes(fixture.expectedReason!),
        ),
        `Review fixture ${name} must fail with "${fixture.expectedReason}"; got ${JSON.stringify(violations)}`,
      ).toBe(true);
    else
      expect(
        violations,
        `Review fixture ${name} is a documented static-guard limit, not a blocked flow`,
      ).toEqual([]);
  }

  const production = program
    .getSourceFiles()
    .filter(
      (file) =>
        !file.isDeclarationFile &&
        !fixtures.has(file.fileName) &&
        dirname(relative(REPOSITORY, file.fileName)).split(/[\\/]/)[0] ===
          "src",
    );
  const { violations, roots } = analyze(program, production);
  expect(
    roots,
    "Production borrowed T* roots changed; audit ownership before updating this inventory",
  ).toEqual(AUDITED_PRODUCTION_ROOTS);
  expect(
    violations,
    "Borrowed native aliases must never reach delete/Nullify/release helpers or escape the audited consumer set",
  ).toEqual([]);
}, 60_000);
