import { plugin } from "bun";
import UnpluginTypia from "@typia/unplugin/bun";

import { createTypiaPluginOptions } from "./typia-plugin-options";

plugin(UnpluginTypia(createTypiaPluginOptions(process.cwd())));
