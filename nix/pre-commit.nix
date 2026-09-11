{ pkgs, git-hooks, system, fixedNode, src }:

git-hooks.lib.${system}.run {
  inherit src;
  package = pkgs.prek;
  hooks = {
    detect-private-keys.enable = true;
    check-merge-conflicts.enable = true;
    check-added-large-files = {
      enable = true;
      args = [ "--maxkb=500" ];
      excludes = [
        "^docs/blob-tracking-visualization\\.png$"
        "^public/mediapipe/models/efficientdet-lite0-int8-v1\\.tflite$"
        "^public/mediapipe/models/efficientdet-lite0-float16-v1\\.tflite$"
        "^public/mediapipe/models/efficientdet-lite2-int8-v1\\.tflite$"
        "^public/mediapipe/models/efficientdet-lite2-float16-v1\\.tflite$"
      ];
    };
    node-tests = {
      enable = true;
      name = "node-test";
      entry = "${fixedNode.pnpm}/bin/pnpm test";
      files = "^(src|tests)/.*\\.tsx?$";
      pass_filenames = false;
    };
    oxlint = {
      enable = true;
      name = "oxlint";
      package = pkgs.oxlint;
      entry = "${pkgs.oxlint}/bin/oxlint";
      files = "\\.(js|jsx|mjs|cjs|ts|tsx|mts|cts)$";
    };
    betterleaks = {
      enable = true;
      name = "betterleaks";
      entry = "${pkgs.betterleaks}/bin/betterleaks git --pre-commit --redact --staged --verbose";
      pass_filenames = false;
    };
    semgrep = {
      enable = true;
      name = "semgrep";
      # entry = "${pkgs.semgrep}/bin/semgrep --config=p/default --config=p/typescript --config=p/javascript --config=p/react --metrics=off --error .";
      entry = "${pkgs.bash}/bin/bash -c '${pkgs.semgrep}/bin/semgrep --config=p/default --config=p/typescript --config=p/javascript --config=p/react --metrics=off --error --quiet . 2>/dev/null'";
      pass_filenames = false;
    };
    zizmor = {
      enable = true;
      name = "zizmor";
      entry = "${pkgs.zizmor}/bin/zizmor --collect=workflows,actions .";
      files = "^\\.github/(workflows|actions)/.*";
      pass_filenames = false;
    };
  };
}
