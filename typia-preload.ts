import { plugin } from "bun";
import UnpluginTypia from "@typia/unplugin/bun";

import { createTypiaPluginOptions } from "./typia-plugin-options";

// Source CLI invocations reserve stdout for the machine-readable result.
plugin(UnpluginTypia({ ...createTypiaPluginOptions(process.cwd()), log: false }));
