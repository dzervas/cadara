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
      package = pkgs.bun.overrideAttrs (
        finalAttrs: _oldAttrs: {
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
        }
      );
    };
  };

  packages = with pkgs; [
    # Demo GIFs for the changelog-post skill.
    ffmpeg
    libsecret

    wrangler
  ];

  env = {
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
    PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "1";
    PLAYWRIGHT_BROWSERS_PATH = "${playwright-driver}";
    # Without any fontconfig font, headless Chromium lays text out at zero
    # height, so screenshots/GIFs show no text at all (cadara-m4ti).
    FONTCONFIG_FILE = pkgs.makeFontsConf { fontDirectories = [ pkgs.dejavu_fonts ]; };
  };

  # @playwright/test comes from bun (package.json pins it exactly). The
  # browsers above only run if both sides share a version, so keep the pin
  # equal to pkgs.playwright-driver.version and warn when devenv.lock drifts.
  enterShell = ''
    installed=$(sed -n 's/^ *"version": "\(.*\)",$/\1/p' node_modules/playwright-core/package.json 2>/dev/null)
    if [ -n "$installed" ] && [ "$installed" != "${pkgs.playwright-driver.version}" ]; then
      echo "warning: node_modules has Playwright $installed but devenv browsers are for ${pkgs.playwright-driver.version}; set @playwright/test to ${pkgs.playwright-driver.version} in package.json and run bun install" >&2
    fi
  '';
}
