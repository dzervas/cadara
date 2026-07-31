import { existsSync } from "node:fs";

const captureFixtureDirectory = "test/fixtures/onshape-captures";
const capturePaths = [
  "40a51fb8fa82fd4565151114.onshape-capture.json",
  "9841e486906fa2ce62d74d8e.onshape-capture.json",
  "405fa226bb150016d09afc09.onshape-capture.json",
  "5151a4c877c9493b733ad52f.onshape-capture.json",
  "d3cd9b09c3c36af1dd2efae9.onshape-capture.json",
].map((fileName) => `${captureFixtureDirectory}/${fileName}`);

const missing = capturePaths.filter((path) => !existsSync(path));
if (missing.length > 0) {
  throw new Error(
    `Real-capture E2E requires all tracked capture fixtures. Missing: ${missing.join(", ")}`,
  );
}
