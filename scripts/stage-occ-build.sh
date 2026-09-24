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
cp -R "$root/occ-native-shims" "$root/occ-binding-patches" "$stage/"
# Shared by both runners: patch the generator, regenerate/recompile affected base bindings, then buildFromYaml.
cp "$root/scripts/occ/regen-patched-bindings.sh" "$stage/"
mkdir "$stage/probe"
cp \
  "$root/scripts/occ/neutral-curve-conformance.mjs" \
  "$root/scripts/occ/native-semantic-conformance.mjs" \
  "$root/scripts/occ/probe-custom-build.mjs" \
  "$root/scripts/occ/smoke-custom-build.mjs" \
  "$root/scripts/occ/native-lifetime-conformance.mjs" \
  "$stage/probe/"
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
docker run "${run_args[@]}" --entrypoint /bin/bash "$image" \
  /src/regen-patched-bindings.sh opencascade-recipe.yaml 2>&1 | tee build.log
sha256sum --check inputs.sha256
sha256sum cadara-occ.js cadara-occ.wasm cadara-occ.d.ts > artifacts.sha256
# Run even on a host without Bun. A red conformance gate does not mean compilation failed.
node probe/probe-custom-build.mjs "$stage" "$stage/conformance-results.json" 2>&1 | tee conformance.log
node probe/native-lifetime-conformance.mjs "$stage" "$stage/lifetime-results.json" 2>&1 | tee lifetime.log
SH
cat > "$stage/build-rootfs.sh" <<'SH'
#!/usr/bin/env bash
# Docker-API-independent execution of the exact pinned image root filesystem.
set -euo pipefail
stage=$(realpath "$(dirname "${BASH_SOURCE[0]}")")
if [[ $# -lt 1 || $# -gt 2 || $1 != /* || -e $1 || (${2:-/} != /*) ]]; then
  echo 'Usage: bash build-rootfs.sh /absolute/path/to/new-runtime-directory [/absolute/verified-blob-cache]' >&2
  exit 2
fi
runtime=$1
blob_cache=${2:-}
mkdir "$runtime"
mkdir "$runtime/blobs" "$runtime/rootfs"
cd "$stage"
exec > >(tee rootfs-execution.log) 2>&1
sha256sum --check inputs.sha256
for asset in cadara-occ.js cadara-occ.wasm cadara-occ.d.ts; do
  if [[ -e $asset ]]; then echo "Refusing stale output $asset; prepare a new stage." >&2; exit 2; fi
done

repository='donalffons/opencascade.js'
manifest_digest='sha256:3069f4c2e3ab62bb82d81843bad2c0f8552ee92373208f8f655ef9bf71c0524d'
config_digest='sha256:334eaf223475860df3ea19b1748c60f4cf4992e17c0a46e94ad48b598e9e4008'
echo "registry repository: $repository"
echo "pinned manifest: $manifest_digest"
echo "runtime root: $runtime"
token=$(curl -fsSL "https://auth.docker.io/token?service=registry.docker.io&scope=repository:$repository:pull" |
  python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')
curl -fsSL -H "Authorization: Bearer $token" \
  -H 'Accept: application/vnd.docker.distribution.manifest.v2+json' \
  "https://registry-1.docker.io/v2/$repository/manifests/$manifest_digest" \
  > image-manifest.json
printf '%s  %s\n' "${manifest_digest#sha256:}" image-manifest.json |
  sha256sum --check | tee manifest-verification.log
actual_config=$(python3 -c 'import json; print(json.load(open("image-manifest.json"))["config"]["digest"])')
[[ $actual_config == "$config_digest" ]]
curl -fsSL -H "Authorization: Bearer $token" \
  "https://registry-1.docker.io/v2/$repository/blobs/$config_digest" \
  > image-config.json
printf '%s  %s\n' "${config_digest#sha256:}" image-config.json |
  sha256sum --check | tee config-verification.log
python3 - <<'PY' > layer-digests.txt
import json
for layer in json.load(open("image-manifest.json"))["layers"]:
    print(layer["digest"])
PY
: > layer-verification.log
while read -r digest; do
  blob="$runtime/blobs/${digest#sha256:}.tar.gz"
  cached=${blob_cache:+$blob_cache/${digest#sha256:}.tar.gz}
  if [[ -n $cached && -f $cached ]]; then
    cp --reflink=auto "$cached" "$blob"
  else
    curl -fsSL -H "Authorization: Bearer $token" \
      "https://registry-1.docker.io/v2/$repository/blobs/$digest" > "$blob"
  fi
  printf '%s  %s\n' "${digest#sha256:}" "$blob" |
    sha256sum --check | tee -a layer-verification.log
done < layer-digests.txt
unset token

while read -r digest; do
  blob="$runtime/blobs/${digest#sha256:}.tar.gz"
  ROOTFS="$runtime/rootfs" BLOB="$blob" python3 - <<'PY'
import os, pathlib, shutil, tarfile
root = pathlib.Path(os.environ["ROOTFS"])
with tarfile.open(os.environ["BLOB"], "r:*") as archive:
    for member in archive.getmembers():
        path = pathlib.PurePosixPath(member.name)
        if path.is_absolute() or ".." in path.parts:
            raise RuntimeError(f"unsafe image layer path: {member.name}")
        name = path.name
        if not name.startswith(".wh."):
            continue
        parent = root.joinpath(*path.parent.parts)
        if name == ".wh..wh..opq":
            if parent.is_dir():
                for child in parent.iterdir():
                    shutil.rmtree(child) if child.is_dir() and not child.is_symlink() else child.unlink()
        else:
            target = parent / name[4:]
            if target.exists() or target.is_symlink():
                shutil.rmtree(target) if target.is_dir() and not target.is_symlink() else target.unlink()
PY
  tar --extract --gzip --file "$blob" --directory "$runtime/rootfs" \
    --no-same-owner --exclude='.wh.*' --exclude='*/.wh.*'
done < layer-digests.txt
# Containers receive host DNS configuration at runtime; retain its exact bytes
# because the Emscripten FreeType port is fetched during this pinned build.
cp --remove-destination /etc/resolv.conf "$runtime/rootfs/etc/resolv.conf"
sha256sum /etc/resolv.conf "$runtime/rootfs/etc/resolv.conf" | tee runtime-dns.sha256

printf 'unshare --user --map-root-user --mount --pid --fork <mount /dev,/proc,/src; chroot pinned-rootfs /src/regen-patched-bindings.sh opencascade-recipe.yaml>\n' |
  tee rootfs-command.log
host_sh=$(command -v sh)
STAGE="$stage" ROOTFS="$runtime/rootfs" unshare --user --map-root-user --mount --pid --fork \
  "$host_sh" -euc '
    mount --rbind /dev "$ROOTFS/dev"
    mount --make-rslave "$ROOTFS/dev"
    mount -t proc proc "$ROOTFS/proc"
    mount --bind "$STAGE" "$ROOTFS/src"
    chroot "$ROOTFS" /usr/bin/env -i \
      HOME=/root \
      PATH=/emsdk:/emsdk/upstream/emscripten:/emsdk/upstream/bin:/emsdk/node/14.18.2_64bit/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
      EMSDK=/emsdk EM_CONFIG=/emsdk/.emscripten \
      EMSDK_NODE=/emsdk/node/14.18.2_64bit/bin/node \
      OCCT_COMMIT_HASH_FULL=bb368e271e24f63078129283148ce83db6b9670a \
      threading=single-threaded \
      /bin/bash -euc '\''
        cd /src
        echo "=== pinned builder environment ==="
        cat /etc/os-release
        python3 --version
        emcc --version
        clang --version
        node --version
        env | sort
        sha256sum /opencascade.js/src/buildFromYaml.py "$(command -v emcc)" "$(command -v clang)"
        echo "=== compile invocation ==="
        /bin/bash /src/regen-patched-bindings.sh opencascade-recipe.yaml
      '\''
  ' 2>&1 | tee rootfs-build.log
sha256sum --check inputs.sha256
sha256sum cadara-occ.js cadara-occ.wasm cadara-occ.d.ts > artifacts.sha256
node probe/probe-custom-build.mjs "$stage" "$stage/conformance-results.json" 2>&1 | tee conformance.log
node probe/native-lifetime-conformance.mjs "$stage" "$stage/lifetime-results.json" 2>&1 | tee lifetime.log
SH
chmod +x "$stage/build.sh" "$stage/build-rootfs.sh"
(
  cd "$stage"
  find opencascade-recipe.yaml occ-native-shims occ-binding-patches regen-patched-bindings.sh probe package.json \
    builder-identity.json build.sh build-rootfs.sh -type f -print0 |
    sort -z | xargs -0 sha256sum > inputs.sha256
)
printf 'Prepared snapshot (including current native shims and binding-generator patch): %s\n' "$stage"
printf 'On a Docker-capable linux/amd64 host with Node, run ONE rebuild:\n  bash %q/build.sh\n' "$stage"
printf 'Return the entire stage (inputs, logs, hashes, JS/WASM/declarations, conformance JSON).\nNo production assets have been modified.\n'
