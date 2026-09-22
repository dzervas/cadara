#!/usr/bin/env bash
# Snapshot the recipe AND current uncommitted shims. Never mount the repository in the builder.
set -euo pipefail
root=$(realpath "$(dirname "${BASH_SOURCE[0]}")/..")
if [[ $# != 1 || $1 != /* ]]; then
  echo 'Usage: bash scripts/stage-occ-build.sh /absolute/path/to/new-stage' >&2
  exit 2
fi
stage=$1
# Refuse reuse: stale outputs must not masquerade as this build's artifacts.
mkdir "$stage"
cp "$root/opencascade-recipe.yaml" "$stage/"
cp -R "$root/occ-native-shims" "$stage/"
mkdir "$stage/probe"
cp "$root/scripts/occ/neutral-curve-conformance.mjs" "$root/scripts/occ/probe-custom-build.mjs" "$stage/probe/"
printf '{"type":"module"}\n' > "$stage/package.json"
cat > "$stage/builder-identity.json" <<'JSON'
{
  "image": "donalffons/opencascade.js:2.0.0-beta.b5ff984@sha256:3069f4c2e3ab62bb82d81843bad2c0f8552ee92373208f8f655ef9bf71c0524d",
  "platform": "linux/amd64",
  "configDigest": "sha256:334eaf223475860df3ea19b1748c60f4cf4992e17c0a46e94ad48b598e9e4008",
  "occtCommit": "bb368e271e24f63078129283148ce83db6b9670a",
  "emscripten": "3.1.14",
  "threading": "single-threaded",
  "identitySource": "Docker Registry manifest/config for package-matching 2.0.0-beta.b5ff984; not a locally executed build"
}
JSON
cat > "$stage/build.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
stage=$(realpath "$(dirname "${BASH_SOURCE[0]}")")
cd "$stage"
sha256sum --check inputs.sha256
for asset in cadara-occ.js cadara-occ.wasm cadara-occ.d.ts; do
  if [[ -e $asset ]]; then echo "Refusing stale output $asset; prepare a new stage." >&2; exit 2; fi
done
image='donalffons/opencascade.js:2.0.0-beta.b5ff984@sha256:3069f4c2e3ab62bb82d81843bad2c0f8552ee92373208f8f655ef9bf71c0524d'
security_options=$(docker info --format '{{json .SecurityOptions}}')
user_args=()
# Rootless container root already maps to the invoking host user.
if [[ $security_options != *'"name=rootless"'* ]]; then
  user_args=(--user "$(id -u):$(id -g)")
fi
run_args=(--rm --platform linux/amd64
  --mount "type=bind,source=$stage,target=/src" "${user_args[@]}")
# Check the same mount and identity before spending time compiling.
docker run "${run_args[@]}" --entrypoint /bin/sh "$image" -ec '
  probe=$(mktemp /src/.cadara-write-check.XXXXXX) || {
    echo "Cannot write to /src; check Docker user mapping and stage permissions." >&2
    exit 1
  }
  rm "$probe"
' 2>&1 | tee preflight.log
docker run "${run_args[@]}" "$image" opencascade-recipe.yaml 2>&1 | tee build.log
sha256sum --check inputs.sha256
sha256sum cadara-occ.js cadara-occ.wasm cadara-occ.d.ts > artifacts.sha256
# Run even on a host without Bun. A red conformance gate does not mean compilation failed.
node probe/probe-custom-build.mjs "$stage" "$stage/conformance-results.json" 2>&1 | tee conformance.log
SH
(
  cd "$stage"
  find opencascade-recipe.yaml occ-native-shims probe package.json builder-identity.json build.sh -type f -print0 |
    sort -z | xargs -0 sha256sum > inputs.sha256
)
printf 'Prepared snapshot (including current native precision shim): %s\n' "$stage"
printf 'On a Docker-capable linux/amd64 host with Node, run ONE rebuild:\n  bash %q/build.sh\n' "$stage"
printf 'Return the entire stage (inputs, logs, hashes, JS/WASM/declarations, conformance JSON).\nNo production assets have been modified.\n'
