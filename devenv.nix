{ pkgs, ... }: let
  playwright-driver = pkgs.playwright-driver.browsers.override {
    withFirefox = false;
    withWebkit = false;
  };
in {
  languages.javascript = {
    enable = true;
    bun.enable = true;
  };

  packages = with pkgs; [
    libsecret
    playwright-driver
    playwright-test
  ];

  env = {
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
    PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "1";
    PLAYWRIGHT_BROWSERS_PATH = "${playwright-driver}";
  };

  # The project imports "@playwright/test" from playwright.config.ts, so the
  # package must be physically present in node_modules (ESM bare-specifier
  # resolution ignores NODE_PATH). Instead of installing it via bun (which
  # drifts from the nix browser revision), symlink the devenv-pinned copy so
  # the JS package and the browsers always share the same version.
  enterShell = ''
    pw="${pkgs.playwright-test}/lib/node_modules"
    mkdir -p node_modules/@playwright
    ln -sfn "$pw/@playwright/test" node_modules/@playwright/test
    ln -sfn "$pw/playwright" node_modules/playwright
    ln -sfn "$pw/playwright-core" node_modules/playwright-core
  '';
}
