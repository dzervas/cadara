{ pkgs, ... }: let
  playwright-driver = pkgs.playwright-driver.browsers.override {
    withFirefox = false;
    withWebkit = false;
  };
in {
  languages.javascript = {
    enable = true;
    bun = {
      enable = true;
      # Keep nixpkgs' platform-specific packaging without updating the other inputs.
      package = pkgs.bun.overrideAttrs (finalAttrs: _oldAttrs: {
        version = "1.4.3";
        src = finalAttrs.passthru.sources.${pkgs.stdenv.hostPlatform.system};
        passthru = _oldAttrs.passthru // {
          sources = {
            aarch64-darwin = pkgs.fetchurl {
              url = "https://github.com/oven-sh/bun/releases/download/bun-v${finalAttrs.version}/bun-darwin-aarch64.zip";
              hash = "sha256-gK/UwGm0am+o8+xSC+vHUKeEPkqNW5WD0prUNsAKNAM=";
            };
            aarch64-linux = pkgs.fetchurl {
              url = "https://github.com/oven-sh/bun/releases/download/bun-v${finalAttrs.version}/bun-linux-aarch64.zip";
              hash = "sha256-76mBPaXtckI7+Ef5FujSxHwNd2rdlyNUAmp14Q2pqiE=";
            };
            x86_64-darwin = pkgs.fetchurl {
              url = "https://github.com/oven-sh/bun/releases/download/bun-v${finalAttrs.version}/bun-darwin-x64-baseline.zip";
              hash = "sha256-D94E6LCSFWuX/mQy6Jm68W2e1s5Sy7QhjS2cB6L4J+8=";
            };
            x86_64-linux = pkgs.fetchurl {
              url = "https://github.com/oven-sh/bun/releases/download/bun-v${finalAttrs.version}/bun-linux-x64.zip";
              hash = "sha256-PnMFKNiXdfA/h/BcBnh8TfQJnQo38/JS57gpyyOBbhg=";
            };
          };
        };
      });
    };
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
