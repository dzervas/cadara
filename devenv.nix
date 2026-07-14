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
}
