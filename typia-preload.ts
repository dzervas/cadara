import { plugin } from "bun";
import UnpluginTypia from "@typia/unplugin/bun";

plugin(UnpluginTypia({ tsconfig: "./tsconfig.app.json" }));
