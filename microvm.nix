# Standalone Linux VM; no changes to the host's NixOS configuration are needed.
# Prepare the private runtime seed yourself (it may contain authentication):
#   umask 077
#   state="$HOME/.local/state/cadara-microvm"
#   mkdir -p "$state"
#   chmod 700 "$state"
#   cp -rL --preserve=mode,timestamps "$HOME/.pi/agent" "$state/pi-seed"
# Run the copy only once: -L materializes Nix-managed settings and other symlinks.
# Never add pi-seed or the disk images to Git or a Nix source/derivation.
# Absolute external paths in Pi settings still need matching files in the guest.
#
# From the Cadara checkout:
#   nix build --impure --file microvm.nix config.microvm.declaredRunner \
#     --arg uid "$(id -u)" --arg gid "$(id -g)" -o /tmp/cadara-vm
# Run as your normal user; 9p shares need no separate or privileged helper:
#   /tmp/cadara-vm/bin/microvm-run
# Shut down with /tmp/cadara-vm/bin/microvm-shutdown. Do not run as root.
# The host user still needs access to /dev/kvm and the GPU render node.
# Open http://127.0.0.1:8000; Cadara is available on port 3000 after bun run dev.
# The serial console logs in as the guest user; no SSH or public tunnel is enabled.
{
  system ? builtins.currentSystem,
  user ? builtins.getEnv "USER",
  uid ? 1000,
  gid ? 100,
  home ? builtins.getEnv "HOME",
  projectDir ? builtins.getEnv "PWD",
  stateDir ? "${home}/.local/state/cadara-microvm",
}: let
  # Use Cadara's pinned nixpkgs without importing its source tree (or Pi data).
  lock = builtins.fromJSON (builtins.readFile ./devenv.lock);
  nixpkgs = builtins.getFlake "github:NixOS/nixpkgs/${lock.nodes.nixpkgs-src.locked.rev}";
  microvm = builtins.getFlake "github:microvm-nix/microvm.nix/f13928fe9900e91709d7ce581eefa47eaafa79e1";
  inherit (nixpkgs) lib;
  guestHome = "/home/${user}";
  tools = "${guestHome}/.local/share/pi-tools";
  contains = parent: child: parent == child || lib.hasPrefix "${parent}/" child;
  # Canonical, absolute paths prevent the writable workspace from aliasing the
  # seed, disks, or actual host Pi directory. Reject symlinked path components.
  plainPath = path:
  builtins.substring 0 1 path == "/"
  && toString (/. + path) == path
  && (
    path == "/"
    || (
      (!builtins.pathExists path || builtins.readFileType path != "symlink")
      && plainPath (builtins.dirOf path)
    )
  );
in assert user != "" && user != "root" && uid > 0 && gid > 0;
assert builtins.all plainPath [
  home
  projectDir
  stateDir
];
assert lib.hasPrefix "${home}/" projectDir;
assert !(contains projectDir stateDir || contains stateDir projectDir);
assert !(contains projectDir "${home}/.pi" || contains "${home}/.pi" projectDir);
assert !(contains "/nix" projectDir || contains "/run" projectDir);
nixpkgs.lib.nixosSystem {
  inherit system;
  modules = [
    microvm.nixosModules.microvm
    ({ pkgs, lib, ... }: {
      networking.hostName = "cadara";
      system.stateVersion = "26.05";

      microvm = {
        hypervisor = "qemu";
        vcpu = 8;
        mem = 12288;
        socket = "${stateDir}/qemu.sock";
        graphics = {
          enable = true;
          backend = "headless";
        };

        interfaces = [
          { type = "user"; id = "cadara"; mac = "02:00:00:00:ca:da"; }
        ];
        forwardPorts = map
          (port: {
            from = "host";
            host = {
              address = "127.0.0.1";
              inherit port;
            };
            guest.port = port;
          })
          [
            3000
            8000
          ];

        # QEMU serves 9p itself, avoiding the root-only virtiofs supervisor.
        # This trades shared-filesystem throughput for rootless startup.
        shares = [
          {
            proto = "9p";
            tag = "store";
            source = "/nix/store";
            mountPoint = "/nix/.ro-store";
            readOnly = true;
          }
          { proto = "9p"; tag = "project"; source = projectDir; mountPoint = projectDir; }
          {
            proto = "9p";
            tag = "pi-seed";
            source = "${stateDir}/pi-seed";
            mountPoint = "/run/pi-seed";
            readOnly = true;
          }
        ];

        # Keep both the writable store and its database across boots. Never give
        # the guest access to the host's Nix daemon socket or writable store.
        writableStoreOverlay = "/nix/.rw-store";
        volumes = [
          { image = "${stateDir}/home.img"; mountPoint = "/home"; size = 32768; }
          { image = "${stateDir}/nix-store.img"; mountPoint = "/nix/.rw-store"; size = 32768; }
          { image = "${stateDir}/nix-state.img"; mountPoint = "/nix/var"; size = 2048; }
        ];
      };

      # User activation must create/chown the home on the persistent disk, not
      # on the tmpfs hidden by a later /home mount. Also repairs existing homes.
      fileSystems."/home".neededForBoot = true;

      hardware.graphics.enable = true;
      networking.firewall.allowedTCPPorts = [
        3000
        8000
      ];
      nix.settings.experimental-features = [
        "nix-command"
        "flakes"
      ];
      users.users.${user} = {
        isNormalUser = true;
        inherit uid;
        home = guestHome;
        extraGroups = [
          "render"
          "video"
        ];
      };
      users.groups.users.gid = lib.mkForce gid;
      services.getty.autologinUser = user;
      security.sudo.wheelNeedsPassword = false;

      environment.systemPackages = with pkgs; [
        devenv
        nodejs_24
        git
        jujutsu
        beads
        ripgrep
        chromium # Interactive diagnostics; tests use devenv's pinned browser.
        pi-coding-agent
      ];

      systemd.services.pi-dashboard = {
        description = "Pi Dashboard in Cadara's devenv";
        wantedBy = [ "multi-user.target" ];
        wants = [ "network-online.target" ];
        after = [ "network-online.target" ];
        unitConfig.RequiresMountsFor = [
          guestHome
          projectDir
          "/run/pi-seed"
          "/nix/var"
        ];
        path = with pkgs; [
          coreutils
          nodejs_24
          python3
          gnumake
          gcc
          git
        ];
        environment = {
          HOME = guestHome;
          # Build node-pty against Nix's Node headers instead of downloading an
          # incompatible prebuilt addon. Also support its shared C++ runtime.
          npm_config_build_from_source = "true";
          npm_config_nodedir = "${pkgs.nodejs_24}";
          LD_LIBRARY_PATH = lib.makeLibraryPath [ pkgs.stdenv.cc.cc.lib ];
        };
        preStart = ''
          set -eu
          umask 077
          mkdir -p "$HOME/.pi"
          if [ ! -d "$HOME/.pi/agent" ]; then
            # A failed copy must not mark the seed as installed. Only this
            # private copy is writable; the original host directory isn't shared.
            rm -rf "$HOME/.pi/agent-seeding"
            mkdir "$HOME/.pi/agent-seeding"
            cp -rL /run/pi-seed/. "$HOME/.pi/agent-seeding/"
            chmod -R u+rwX,go-rwx "$HOME/.pi/agent-seeding"
            mv "$HOME/.pi/agent-seeding" "$HOME/.pi/agent"
          fi

          # Runtime installation keeps mutable npm state out of the Nix store.
          # Pin Pi too: the dashboard otherwise prefers its bundled Pi over PATH.
          if [ ! -f "${tools}/.installed-0.9.0-1.3.0" ]; then
            npm install --prefix ${lib.escapeShellArg tools} --no-audit --no-fund \
              @blackbelt-technology/pi-agent-dashboard@0.9.0 \
              @earendil-works/pi-coding-agent@1.3.0
            mkdir -p "$HOME/.pi/dashboard"
            cat > "$HOME/.pi/dashboard/tool-overrides.json" <<'JSON'
          {
            "version": 1,
            "overrides": {
              "pi": { "path": "${tools}/node_modules/.bin/pi" },
              "pi-coding-agent": {
                "path": "${tools}/node_modules/@earendil-works/pi-coding-agent/dist/index.js"
              }
            }
          }
          JSON
            touch "${tools}/.installed-0.9.0-1.3.0"
          fi
        '';
        serviceConfig = {
          User = user;
          WorkingDirectory = projectDir;
          # Run foreground, not `start` (which daemonizes). Child sessions inherit
          # the same devenv and use the writable, persistent guest Pi directory.
          ExecStart = "${pkgs.devenv}/bin/devenv shell -- ${tools}/node_modules/.bin/pi-dashboard --host 0.0.0.0 --port 8000 --no-tunnel";
          TimeoutStartSec = "infinity"; # First-boot npm/native builds can be slow.
          Restart = "on-failure";
          RestartSec = 10;
          UMask = "0077";
        };
      };

      environment.extraInit = ''
        export PATH="${tools}/node_modules/.bin:$PATH"
      '';
    })
  ];
}
