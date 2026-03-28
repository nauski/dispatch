{
  description = "Dispatch - Agent coordination platform";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      supportedSystems = [ "x86_64-linux" "aarch64-linux" ];
      forAllSystems = nixpkgs.lib.genAttrs supportedSystems;
      pkgsFor = system: nixpkgs.legacyPackages.${system};
    in
    {
      packages = forAllSystems (system:
        let
          pkgs = pkgsFor system;

          daemon = pkgs.buildNpmPackage {
            pname = "dispatch-daemon";
            version = "0.1.0";
            src = ./packages/daemon;

            npmDepsHash = "sha256-k56pQKtU39WKbT7m12GFuBGZ1Atho7Xnk8pxuTlv7kY=";

            buildPhase = ''
              npm run build
            '';

            installPhase = ''
              mkdir -p $out/lib/dispatch-daemon $out/bin
              cp -r dist/* $out/lib/dispatch-daemon/
              cp -r node_modules $out/lib/dispatch-daemon/
              cp package.json $out/lib/dispatch-daemon/

              cat > $out/bin/dispatch-daemon <<WRAPPER
              #!/usr/bin/env bash
              exec ${pkgs.nodejs_22}/bin/node $out/lib/dispatch-daemon/index.js "\$@"
              WRAPPER
              chmod +x $out/bin/dispatch-daemon
            '';

            meta = {
              description = "Dispatch agent daemon - connects Claude Code instances to the task board";
              mainProgram = "dispatch-daemon";
            };
          };

          mcp = pkgs.buildNpmPackage {
            pname = "dispatch-mcp";
            version = "0.1.0";
            src = ./packages/mcp;

            npmDepsHash = "sha256-VG1uGqbaa91u7BK4qnug1Wxa9N5MZ/UiS731fFt01V0=";

            buildPhase = ''
              npm run build
            '';

            installPhase = ''
              mkdir -p $out/lib/dispatch-mcp $out/bin
              cp -r dist/* $out/lib/dispatch-mcp/
              cp -r node_modules $out/lib/dispatch-mcp/
              cp package.json $out/lib/dispatch-mcp/

              cat > $out/bin/dispatch-mcp <<WRAPPER
              #!/usr/bin/env bash
              exec ${pkgs.nodejs_22}/bin/node $out/lib/dispatch-mcp/index.js "\$@"
              WRAPPER
              chmod +x $out/bin/dispatch-mcp
            '';

            meta = {
              description = "Dispatch MCP server - exposes task board operations as Claude tools";
              mainProgram = "dispatch-mcp";
            };
          };
          runner = pkgs.buildNpmPackage {
            pname = "dispatch-runner";
            version = "0.1.0";
            src = ./packages/runner;

            npmDepsHash = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

            buildPhase = ''
              npm run build
            '';

            installPhase = ''
              mkdir -p $out/lib/dispatch-runner $out/bin
              cp -r dist/* $out/lib/dispatch-runner/
              cp -r node_modules $out/lib/dispatch-runner/
              cp package.json $out/lib/dispatch-runner/

              cat > $out/bin/dispatch-runner <<WRAPPER
              #!/usr/bin/env bash
              exec ${pkgs.nodejs_22}/bin/node $out/lib/dispatch-runner/index.js "\$@"
              WRAPPER
              chmod +x $out/bin/dispatch-runner
            '';

            meta = {
              description = "Dispatch runner - central agentic execution service with remote tool proxying";
              mainProgram = "dispatch-runner";
            };
          };
        in
        {
          inherit daemon mcp runner;
          default = daemon;
        }
      );

      # NixOS system module
      nixosModules.default = { config, lib, pkgs, ... }:
        let
          cfg = config.services.dispatch-daemon;
          jsonFormat = pkgs.formats.json {};
          mcpPkg = self.packages.${pkgs.system}.mcp;
        in
        {
          options.services.dispatch-daemon = {
            enable = lib.mkEnableOption "Dispatch agent daemon";

            package = lib.mkOption {
              type = lib.types.package;
              default = self.packages.${pkgs.system}.daemon;
              description = "The dispatch-daemon package to use";
            };

            user = lib.mkOption {
              type = lib.types.str;
              description = "User to run the daemon as";
            };

            settings = lib.mkOption {
              type = lib.types.submodule {
                freeformType = jsonFormat.type;
                options = {
                  serverUrl = lib.mkOption {
                    type = lib.types.str;
                    default = "wss://dispatch.example.com";
                    description = "Dispatch server WebSocket URL";
                  };

                  machineName = lib.mkOption {
                    type = lib.types.str;
                    default = config.networking.hostName;
                    description = "Machine name for identification";
                  };

                  maxConcurrent = lib.mkOption {
                    type = lib.types.int;
                    default = 4;
                    description = "Maximum concurrent Claude sessions";
                  };

                  roles = lib.mkOption {
                    type = lib.types.attrsOf (lib.types.submodule {
                      options = {
                        workDir = lib.mkOption {
                          type = lib.types.str;
                          description = "Working directory for this role";
                        };
                        allowedTools = lib.mkOption {
                          type = lib.types.listOf lib.types.str;
                          default = [ "Read" "Glob" "Grep" "Edit" "Write" ];
                          description = "Tools the Claude session is allowed to use. Supports patterns like Bash(kubectl *)";
                        };
                        provider = lib.mkOption {
                          type = lib.types.nullOr (lib.types.enum [ "claude-cli" "openai" "openrouter" "mistral" ]);
                          default = null;
                          description = "LLM provider for this role. null or claude-cli uses Claude Code CLI, others use OpenAI-compatible APIs";
                        };
                        model = lib.mkOption {
                          type = lib.types.nullOr lib.types.str;
                          default = null;
                          description = "Model name override (e.g. gpt-4.1, anthropic/claude-sonnet-4, mistral-large-latest)";
                        };
                        apiKey = lib.mkOption {
                          type = lib.types.nullOr lib.types.str;
                          default = null;
                          description = "Per-role API key override. Prefer apiKeyFiles or apiKeys at daemon level for secrets";
                        };
                        baseUrl = lib.mkOption {
                          type = lib.types.nullOr lib.types.str;
                          default = null;
                          description = "Custom API endpoint override";
                        };
                      };
                    });
                    default = {};
                    description = "Role configurations mapping role names to working directories and permissions";
                  };

                  apiKeys = lib.mkOption {
                    type = lib.types.attrsOf lib.types.str;
                    default = {};
                    description = "API keys by provider name (openai, openrouter, mistral). Prefer apiKeyFiles for secrets";
                  };
                };
              };
              default = {};
              description = "Daemon configuration";
            };

            apiKeyFiles = lib.mkOption {
              type = lib.types.attrsOf lib.types.path;
              default = {};
              description = "Paths to files containing API keys, keyed by provider (openai, openrouter, mistral). Merged into config at startup";
              example = { openai = "/run/secrets/openai-api-key"; };
            };

            clientSecretFile = lib.mkOption {
              type = lib.types.path;
              description = "Path to file containing the Keycloak client secret for dispatch-daemon";
            };

            clientId = lib.mkOption {
              type = lib.types.str;
              default = "dispatch-daemon";
              description = "Keycloak client ID";
            };

            tokenEndpoint = lib.mkOption {
              type = lib.types.str;
              default = "https://keycloak.example.com/realms/master/protocol/openid-connect/token";
              description = "Keycloak token endpoint";
            };
          };

          config = lib.mkIf cfg.enable {
            systemd.services.dispatch-daemon = {
              description = "Dispatch Agent Daemon";
              wantedBy = [ "multi-user.target" ];
              after = [ "network-online.target" ];
              wants = [ "network-online.target" ];

              serviceConfig = {
                Type = "simple";
                User = cfg.user;
                ExecStartPre = let
                  configFile = jsonFormat.generate "dispatch-daemon-base.json" cfg.settings;
                  apiKeyArgs = lib.concatStringsSep " " (lib.mapAttrsToList (provider: path:
                    ''--arg ${provider}Key "$(cat ${path})"''
                  ) cfg.apiKeyFiles);
                  apiKeyJqExpr = if cfg.apiKeyFiles == {} then "." else
                    lib.concatStringsSep " | " (lib.mapAttrsToList (provider: _:
                      ''.apiKeys.${provider} = $${provider}Key''
                    ) cfg.apiKeyFiles);
                  script = pkgs.writeShellScript "dispatch-daemon-pre" ''
                    mkdir -p /run/dispatch
                    CLIENT_SECRET=$(cat ${cfg.clientSecretFile})
                    ${pkgs.jq}/bin/jq \
                      --arg clientSecret "$CLIENT_SECRET" \
                      --arg clientId "${cfg.clientId}" \
                      --arg tokenEndpoint "${cfg.tokenEndpoint}" \
                      --arg mcpPath "${mcpPkg}/bin/dispatch-mcp" \
                      ${apiKeyArgs} \
                      '. + {auth: {clientSecret: $clientSecret, clientId: $clientId, tokenEndpoint: $tokenEndpoint}, dispatchMcpPath: $mcpPath} | ${apiKeyJqExpr}' \
                      ${configFile} > /run/dispatch/daemon.json
                    chown ${cfg.user} /run/dispatch/daemon.json
                  '';
                in "+${script}";
                ExecStart = "${cfg.package}/bin/dispatch-daemon";
                Environment = [
                  "DISPATCH_CONFIG=/run/dispatch/daemon.json"
                  "NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt"
                ];
                Restart = "always";
                RestartSec = 10;
              };
            };
          };
        };

      # Home Manager module (alternative)
      homeManagerModules.default = { config, lib, pkgs, ... }:
        let
          cfg = config.services.dispatch-daemon;
          jsonFormat = pkgs.formats.json {};
          mcpPkg = self.packages.${pkgs.system}.mcp;
        in
        {
          options.services.dispatch-daemon = {
            enable = lib.mkEnableOption "Dispatch agent daemon";

            package = lib.mkOption {
              type = lib.types.package;
              default = self.packages.${pkgs.system}.daemon;
              description = "The dispatch-daemon package to use";
            };

            settings = lib.mkOption {
              type = lib.types.submodule {
                freeformType = jsonFormat.type;
                options = {
                  serverUrl = lib.mkOption {
                    type = lib.types.str;
                    default = "wss://dispatch.example.com";
                    description = "Dispatch server WebSocket URL";
                  };

                  machineName = lib.mkOption {
                    type = lib.types.str;
                    default = config.networking.hostName or "unknown";
                    description = "Machine name for identification";
                  };

                  maxConcurrent = lib.mkOption {
                    type = lib.types.int;
                    default = 4;
                    description = "Maximum concurrent Claude sessions";
                  };

                  roles = lib.mkOption {
                    type = lib.types.attrsOf (lib.types.submodule {
                      options = {
                        workDir = lib.mkOption {
                          type = lib.types.str;
                          description = "Working directory for this role";
                        };
                        allowedTools = lib.mkOption {
                          type = lib.types.listOf lib.types.str;
                          default = [ "Read" "Glob" "Grep" "Edit" "Write" ];
                          description = "Tools the Claude session is allowed to use. Supports patterns like Bash(kubectl *)";
                        };
                        provider = lib.mkOption {
                          type = lib.types.nullOr (lib.types.enum [ "claude-cli" "openai" "openrouter" "mistral" ]);
                          default = null;
                          description = "LLM provider for this role. null or claude-cli uses Claude Code CLI, others use OpenAI-compatible APIs";
                        };
                        model = lib.mkOption {
                          type = lib.types.nullOr lib.types.str;
                          default = null;
                          description = "Model name override (e.g. gpt-4.1, anthropic/claude-sonnet-4, mistral-large-latest)";
                        };
                        apiKey = lib.mkOption {
                          type = lib.types.nullOr lib.types.str;
                          default = null;
                          description = "Per-role API key override. Prefer apiKeyFiles or env vars for secrets";
                        };
                        baseUrl = lib.mkOption {
                          type = lib.types.nullOr lib.types.str;
                          default = null;
                          description = "Custom API endpoint override";
                        };
                      };
                    });
                    default = {};
                    description = "Role configurations mapping role names to working directories and permissions";
                  };

                  apiKeys = lib.mkOption {
                    type = lib.types.attrsOf lib.types.str;
                    default = {};
                    description = "API keys by provider name (openai, openrouter, mistral). Prefer env vars for secrets";
                  };
                };
              };
              default = {};
              description = "Daemon configuration";
            };

            apiKeyFiles = lib.mkOption {
              type = lib.types.attrsOf lib.types.path;
              default = {};
              description = "Paths to files containing API keys, keyed by provider (openai, openrouter, mistral). Merged into config at startup";
              example = { openai = "/run/secrets/openai-api-key"; };
            };

            tokenFile = lib.mkOption {
              type = lib.types.path;
              description = "Path to file containing the Keycloak service account token";
            };
          };

          config = lib.mkIf cfg.enable {
            systemd.user.services.dispatch-daemon = {
              Unit = {
                Description = "Dispatch Agent Daemon";
                After = [ "network-online.target" ];
              };

              Service = {
                Type = "simple";
                ExecStart = "${cfg.package}/bin/dispatch-daemon";
                Environment = [
                  "DISPATCH_CONFIG=%h/.config/dispatch/daemon.json"
                ];
                Restart = "always";
                RestartSec = 10;
              };

              Install = {
                WantedBy = [ "default.target" ];
              };
            };

            home.activation.dispatch-daemon-config = let
              apiKeyArgs = lib.concatStringsSep " " (lib.mapAttrsToList (provider: path:
                ''--arg ${provider}Key "$(cat ${path})"''
              ) cfg.apiKeyFiles);
              apiKeyJqExpr = if cfg.apiKeyFiles == {} then "." else
                lib.concatStringsSep " | " (lib.mapAttrsToList (provider: _:
                  ''.apiKeys.${provider} = $${provider}Key''
                ) cfg.apiKeyFiles);
            in lib.hm.dag.entryAfter [ "writeBoundary" ] ''
              mkdir -p $HOME/.config/dispatch
              TOKEN=$(cat ${cfg.tokenFile})
              ${pkgs.jq}/bin/jq \
                --arg token "$TOKEN" \
                --arg mcpPath "${mcpPkg}/bin/dispatch-mcp" \
                ${apiKeyArgs} \
                '. + {token: $token, dispatchMcpPath: $mcpPath} | ${apiKeyJqExpr}' \
                ${jsonFormat.generate "dispatch-daemon-base.json" cfg.settings} \
                > $HOME/.config/dispatch/daemon.json
            '';
          };
        };

      # Home Manager module for the runner
      homeManagerModules.runner = { config, lib, pkgs, ... }:
        let
          cfg = config.services.dispatch-runner;
          jsonFormat = pkgs.formats.json {};
          mcpPkg = self.packages.${pkgs.system}.mcp;
        in
        {
          options.services.dispatch-runner = {
            enable = lib.mkEnableOption "Dispatch runner (server-side agentic execution)";

            package = lib.mkOption {
              type = lib.types.package;
              default = self.packages.${pkgs.system}.runner;
              description = "The dispatch-runner package to use";
            };

            settings = lib.mkOption {
              type = lib.types.submodule {
                freeformType = jsonFormat.type;
                options = {
                  serverUrl = lib.mkOption {
                    type = lib.types.str;
                    default = "wss://dispatch.example.com";
                    description = "Dispatch server WebSocket URL";
                  };

                  machineName = lib.mkOption {
                    type = lib.types.str;
                    default = "${config.networking.hostName or "unknown"}-runner";
                    description = "Machine name for runner identification";
                  };

                  maxConcurrent = lib.mkOption {
                    type = lib.types.int;
                    default = 4;
                    description = "Maximum concurrent Claude sessions";
                  };

                  roles = lib.mkOption {
                    type = lib.types.either (lib.types.listOf lib.types.str) (lib.types.attrsOf (lib.types.submodule {
                      options = {
                        workDir = lib.mkOption {
                          type = lib.types.nullOr lib.types.str;
                          default = null;
                          description = "Working directory for Claude sessions (optional, defaults to tmpdir)";
                        };
                      };
                    }));
                    default = [];
                    description = "Roles this runner handles. Can be a list of role names or an attrset with per-role workDir.";
                  };
                };
              };
              default = {};
              description = "Runner configuration";
            };

            tokenFile = lib.mkOption {
              type = lib.types.path;
              description = "Path to file containing the Keycloak service account token";
            };
          };

          config = lib.mkIf cfg.enable {
            systemd.user.services.dispatch-runner = {
              Unit = {
                Description = "Dispatch Runner (server-side agentic execution)";
                After = [ "network-online.target" ];
              };

              Service = {
                Type = "simple";
                ExecStart = "${cfg.package}/bin/dispatch-runner";
                Environment = [
                  "RUNNER_CONFIG=%h/.config/dispatch/runner.json"
                ];
                Restart = "always";
                RestartSec = 10;
              };

              Install = {
                WantedBy = [ "default.target" ];
              };
            };

            home.activation.dispatch-runner-config = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
              mkdir -p $HOME/.config/dispatch
              TOKEN=$(cat ${cfg.tokenFile})
              ${pkgs.jq}/bin/jq \
                --arg clientSecret "$TOKEN" \
                --arg mcpPath "${mcpPkg}/bin/dispatch-mcp" \
                '. + {auth: {clientSecret: $clientSecret, clientId: "dispatch-daemon", tokenEndpoint: "https://keycloak.example.com/realms/master/protocol/openid-connect/token"}, dispatchMcpPath: $mcpPath}' \
                ${jsonFormat.generate "dispatch-runner-base.json" cfg.settings} \
                > $HOME/.config/dispatch/runner.json
            '';
          };
        };
    };
}
