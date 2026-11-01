import { initializeWasm } from "@automerge/automerge-repo/slim";
import { automergeWasmBase64 } from "@automerge/automerge/automerge.wasm.base64";

/** The Automerge module's bytes. initializeBase64Wasm decodes them with a
 * callback per byte, about 170 ms of a reload's critical path for 2.7 MB. */
function decodeAutomergeWasm() {
  const binary = atob(automergeWasmBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}
let wasm: Promise<void> | undefined;
export function prepareAutomerge() {
  wasm ??= initializeWasm(decodeAutomergeWasm()).catch((error: unknown) => {
    wasm = undefined;
    throw error;
  });
  return wasm;
}
