import { test, expect } from "vitest";

import {
  buildImportFilePickerConfiguration,
  showOpenImportFilePicker,
} from "@/lib/import-file-picker";

test("src/lib/import-file-picker.spec.ts", async () => {
  const configuration = buildImportFilePickerConfiguration(
    [
      { extension: "png", mediaType: "image/png" },
      { extension: ".jpg", mediaType: "image/jpeg" },
      { extension: "png", mediaType: "image/png" },
    ],
    { multiple: true },
  );

  expect(
    configuration.openPickerOptions.types[0]?.accept["image/png"]?.includes(
      ".png",
    ) &&
      configuration.openPickerOptions.types[0]?.accept["image/jpeg"]?.includes(
        ".jpg",
      ),
    "Import picker configuration should group extensions under MIME types for the native picker.",
  ).toBeTruthy();
  expect(
    configuration.inputAccept.includes("image/png") &&
      configuration.inputAccept.includes(".png") &&
      configuration.inputAccept.includes(".jpg"),
    "Import picker configuration should build an input accept string from extensions and MIME types.",
  ).toBeTruthy();
  expect(
    configuration.openPickerOptions.multiple,
    "Import picker configuration should forward the multiple-selection flag.",
  ).toBeTruthy();

  const compoundConfiguration = buildImportFilePickerConfiguration([
    { extension: ".onshape-capture.json", mediaType: "application/json" },
  ]);
  expect(
    compoundConfiguration.openPickerOptions.types[0]?.accept[
      "application/json"
    ],
    "Native picker accept entries must use the final suffix only; Chromium rejects compound extensions like '.onshape-capture.json'.",
  ).toEqual([".json"]);
  expect(
    compoundConfiguration.inputAccept.includes(".onshape-capture.json"),
    "Fallback input accept should keep the full compound extension for suffix matching.",
  ).toBeTruthy();

  const pngFile = new File(["png"], "reference.png", { type: "image/png" });
  const pickerResult = await showOpenImportFilePicker({
    acceptedFileTypes: [{ extension: "png", mediaType: "image/png" }],
    multiple: true,
    environment: {
      isSecureContext: true,
      async showOpenFilePicker(options) {
        expect(
          options.types[0]?.accept["image/png"]?.includes(".png"),
          "Native import picker should receive the aggregated accept map.",
        ).toBeTruthy();
        expect(
          options.multiple,
          "Native import picker should receive the multiple-selection flag.",
        ).toBeTruthy();
        return [
          {
            name: "reference.png",
            async getFile() {
              return pngFile;
            },
            async createWritable() {
              throw new Error("Not used in import picker tests.");
            },
          },
        ];
      },
    },
  });
  expect(
    pickerResult.ok && pickerResult.files[0] === pngFile,
    "Native import picker should resolve the selected file handle to a File object.",
  ).toBeTruthy();

  type ChangeHandler = () => void;

  let changeHandler: ChangeHandler | null = null;
  let fallbackInputMultiple = false;
  const fallbackFile = new File(["jpg"], "reference.jpg", {
    type: "image/jpeg",
  });
  const fallbackResult = await showOpenImportFilePicker({
    acceptedFileTypes: [{ extension: "jpg", mediaType: "image/jpeg" }],
    multiple: true,
    environment: {
      isSecureContext: true,
      document: {
        body: {
          appendChild() {},
        },
        createElement() {
          const input = {
            type: "",
            accept: "",
            multiple: false,
            style: { display: "" },
            files: [fallbackFile],
            addEventListener(event: string, handler: ChangeHandler) {
              if (event === "change") {
                changeHandler = handler;
              }
            },
            removeEventListener() {},
            remove() {},
            click() {
              fallbackInputMultiple = input.multiple;
              changeHandler?.();
            },
          };

          return input as unknown as HTMLInputElement;
        },
      } as unknown as Document,
    },
  });

  expect(
    fallbackInputMultiple,
    "Fallback import picker should forward the multiple-selection flag to the input element.",
  ).toBeTruthy();
  expect(
    fallbackResult.ok && fallbackResult.files[0] === fallbackFile,
    "Fallback import picker should resolve the selected input file when the native picker is unavailable.",
  ).toBeTruthy();
});
