#!/usr/bin/env python3
"""Render the chosen executable in real terminals, with only offline UI fixtures."""

import argparse
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import time
import uuid

from agent.tests.support.intercom_fixture import write_fixture


ANSI = re.compile(r"\x1b\[[0-9;]*m")


def capture_screen(target):
    screen = subprocess.check_output(["tmux", "capture-pane", "-t", target, "-p", "-e", "-S", "-500"], text=True)
    return screen, ANSI.sub("", screen)


def wait_for_screen(target, timeout, ready, failure):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        screen, plain = capture_screen(target)
        if ready(screen, plain):
            return screen, plain
        time.sleep(0.1)
    raise RuntimeError(failure)


def smoke(sdk: Path, launcher: Path, config: Path, home: Path, output: Path) -> None:
    """Check host rendering with configured pi-pretty, Powerline and the real theme.

    Intercom's renderer callbacks are extracted into a synthetic npm package;
    its entrypoint and broker hooks never run. Other personal extensions remain
    excluded because they can contact live peers or services.
    """
    output.mkdir(parents=True)
    agent = output / "agent"
    agent.mkdir()
    settings = json.loads((config / "pi/agent/settings.json").read_text())
    settings = {key: settings[key] for key in ("powerline", "theme")}
    settings.update(quietStartup=True, lastChangelogVersion="0.87.1", packages=[
        "npm:pi-intercom", "npm:pi-web-access", "npm:pi-mcp-adapter",
    ])
    # Preserve canonical npm owner metadata without loading the broker runtime.
    intercom = home / ".pi/agent/npm/node_modules/pi-intercom"
    synthetic = agent / "npm/node_modules/pi-intercom"
    write_fixture(intercom, synthetic / "index.ts")
    (synthetic / "package.json").write_text(json.dumps({
        "name": "pi-intercom", "version": "0.13.0", "pi": {"extensions": ["./index.ts"]},
    }))
    # Synthetic registrations exercise the actual host/owner lookup, without web
    # requests, MCP connections, package entrypoints or model credentials.
    for package, names in {
        "pi-web-access": ["web_search", "fetch_content", "source_check", "get_search_content"],
        "pi-mcp-adapter": ["mcp", "mcp__exa", "exa_web_search_exa", "mcpScript"],
    }.items():
        fixture = agent / "npm/node_modules" / package
        fixture.mkdir(parents=True)
        (fixture / "package.json").write_text(json.dumps({
            "name": package, "version": "0.0.0", "pi": {"extensions": ["./index.ts"]},
        }))
        (fixture / "index.ts").write_text('''export default function (pi) {
  for (const name of ''' + json.dumps(names) + ''') {
    pi.registerTool({
      name, label: name === "mcp__exa" ? "MCP: exa" : name === "exa_web_search_exa" ? "MCP: web_search_exa" : name,
      description: "Offline rendering fixture", parameters: { type: "object", additionalProperties: true },
      renderCall: () => ({ render: () => ["CUSTOM_CALL_CARD"], invalidate() {} }),
      renderResult: () => ({ render: () => ["CUSTOM_RESULT_CARD"], invalidate() {} }),
      async execute() { return { content: [{ type: "text", text: "OFFLINE_TOOL_RESULT" }], details: {} }; },
    });
  }
}
''')
    work = output / "work"
    work.mkdir()
    (agent / "settings.json").write_text(json.dumps(settings))
    pretty = home / ".pi/agent/npm/node_modules/@heyhuynhgiabuu/pi-pretty/src/index.ts"
    powerline = home / ".pi/agent/git/github.com/nicobailon/pi-powerline-footer/index.ts"
    theme = config / "pi/agent/themes/osaka-jade.json"
    for path in (pretty, powerline, theme):
        if not path.is_file():
            raise RuntimeError(f"missing configured UI source: {path}")
    faux = sdk / "node_modules/@earendil-works/pi-ai/dist/providers/faux.js"
    extension = output / "offline.ts"
    extension.write_text('''import { writeFileSync } from "node:fs";
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from ''' + json.dumps(str(faux)) + ''';
export default function (pi) {
  const root = process.env.PI_CLI_SMOKE_OUTPUT;
  const faux = fauxProvider();
  pi.registerProvider(faux.provider);
  faux.setResponses([
    fauxAssistantMessage([
      fauxToolCall("web_search", { query: "offline-search" }),
      fauxToolCall("fetch_content", { url: "https://example.com/offline" }),
      fauxToolCall("source_check", { claim: "offline-claim" }),
      fauxToolCall("get_search_content", { responseId: "offline-id" }),
      fauxToolCall("mcp", { server: "exa", tool: "web_search_exa", args: { query: "gateway" } }),
      fauxToolCall("mcp__exa", { tool: "web_search_exa", args: { query: "namespace" } }),
      fauxToolCall("exa_web_search_exa", { query: "direct" }),
      fauxToolCall("mcp", { server: "archive", tool: "rotate", args: { id: "offline" } }),
      fauxToolCall("mcpScript", { code: "emit(42)", apiKey: "DO_NOT_DISPLAY" }),
      fauxToolCall("intercom", { action: "send", to: "peer-a", message: "hello" }),
      fauxToolCall("intercom", { action: "send", to: "peer-b", message: "hello" }),
    ], { stopReason: "toolUse" }),
    fauxAssistantMessage("OFFLINE_CUSTOM_HOST_RESPONSE"),
  ]);
  pi.on("session_start", () => writeFileSync(`${root}/ready`, "ready"));
  pi.on("agent_end", event => writeFileSync(`${root}/response.json`, JSON.stringify(event.messages)));
  pi.registerCommand("approval-fixture", { handler: async (_args, ctx) => {
    const answer = await ctx.ui.confirm("OFFLINE_APPROVAL", "Approval remains interactive");
    writeFileSync(`${root}/approval.json`, JSON.stringify(answer));
  } });
  pi.registerCommand("question-fixture", { handler: async (_args, ctx) => {
    const answer = await ctx.ui.select("OFFLINE_QUESTION", ["OFFLINE_OPTION"]);
    writeFileSync(`${root}/question.json`, JSON.stringify(answer));
  } });
}
''')
    env = {"PATH": os.environ.get("PATH", os.defpath), "HOME": str(home),
           "PI_CODING_AGENT_DIR": str(agent), "TERM": "xterm-256color", "COLORTERM": "truecolor",
           "LANG": "en_US.UTF-8", "PI_OFFLINE": "1", "PI_TELEMETRY": "0", "PI_TRUE_COLOR": "1"}
    results = {}
    for mode in ("regular", "fullscreen"):
        run = output / mode
        run.mkdir()
        target = "pi-cli-smoke-" + uuid.uuid4().hex
        env["PI_CLI_SMOKE_OUTPUT"] = str(run)
        command = ["env", "-i", *(f"{key}={value}" for key, value in env.items()), str(launcher),
                   "--no-session", "--no-skills", "--no-prompt-templates",
                   "--no-context-files", "--no-themes", "--theme", str(theme),
                   "-e", str(pretty), "-e", str(powerline), "-e", str(extension),
                   "--provider", "faux", "--model", "faux-1", "--models", "faux/*",
                   "--tui-mode", mode]
        (run / "command.json").write_text(json.dumps(command, indent=2) + "\n")
        # Keep two expanded sends, incoming details and the preceding custom card visible.
        subprocess.run(["tmux", "new-session", "-d", "-s", target, "-x", "120", "-y", "44", "-c", str(work),
                        shlex.join(command) + "; exec /bin/sh"], check=True)
        try:
            sent = False
            def response_ready(screen, plain):
                nonlocal sent
                (run / "response-screen.ansi").write_text(screen)
                (run / "response-screen.txt").write_text(plain)
                if "Failed to load extension" in plain or "Error loading extension" in plain:
                    raise RuntimeError(f"extension startup failed: {run}")
                if (run / "ready").exists() and not sent:
                    subprocess.run(["tmux", "send-keys", "-t", target, "CUSTOM_HOST_PROMPT", "Enter"], check=True)
                    sent = True
                return (run / "response.json").exists() and "OFFLINE_CUSTOM_HOST_RESPONSE" in plain

            screen, plain = wait_for_screen(target, 40, response_ready, f"no rendered offline response: {run}")

            # Add a synthetic incoming message only after the faux turn has settled.
            # The actual native command/tool pipeline is used, never orphan results.
            subprocess.run(["tmux", "send-keys", "-t", target, "/intercom-fixture", "Enter"], check=True)
            screen, plain = wait_for_screen(
                target, 10, lambda _screen, plain: "INTERCOM_PREVIEW" in plain,
                f"incoming Intercom fixture did not render: {run}",
            )
            (run / "intercom-collapsed.ansi").write_text(screen)
            (run / "intercom-collapsed.txt").write_text(plain)

            # These assert the terminal output, not imported modules or source markers.
            checks = {
                "user_header": bool(re.search(r"(?m)^ +◆ You", plain)),
                "assistant_header": bool(re.search(r"(?m)^ +● Pi", plain)),
                "outer_editor_inset": bool(re.search(r"(?m)^  ╭─{114}╮$", plain)),
                "transcript_separator_gutter": bool(re.search(r"(?m)^     ─{110}$", plain)),
                "cream_separator": bool(re.search(r"\x1b\[38;2;222;222;197m[^\n]*─{110}", screen)),
                "powerline_footer": "Faux Model" in plain and "context" in plain and "↳ CUSTOM_HOST_PROMPT" in plain,
                "offline_response": "OFFLINE_CUSTOM_HOST_RESPONSE" in (run / "response.json").read_text(),
                "intercom_invocation": bool(re.search(r'├─ ✓ ⇄ Chat +intercom\(action="send", to="peer-a"', plain))
                    and bool(re.search(r'╰─ ✓ ⇄ Chat +intercom\(action="send", to="peer-b"', plain)),
                "web_invocations": all(re.search(r"✓ ◎ Web +" + name + r"\(", plain) for name in (
                    "web_search", "fetch_content", "source_check", "get_search_content", "exa_web_search_exa",
                )),
                "mcp_invocations": all(f'exa/web_search_exa(query="{query}")' in plain for query in ("gateway", "namespace")),
                "unknown_mcp_invocation": bool(re.search(r'✓ ⌇ Tool +archive/rotate\(id="offline"\)', plain)),
                "batch_invocation": bool(re.search(r'✓ ⋈ Batch +mcpScript\(code="emit\(42\)"', plain)),
                "original_arguments_preserved": "DO_NOT_DISPLAY" in (run / "response.json").read_text(),
                "arguments_redacted": 'apiKey="[redacted]"' in plain and "DO_NOT_DISPLAY" not in plain,
                "no_custom_cards": "CUSTOM_CALL_CARD" not in plain and "CUSTOM_RESULT_CARD" not in plain,
                "intercom_no_duplicate_body": "INTERCOM_EXPANDED_DETAIL" not in plain and "intercom send" not in plain,
                "intercom_sender": bool(re.search(r"(?m)^ {8}✓ ⇄ Chat +From Fixture peer$", plain)),
                "intercom_preview": bool(re.search(r"(?m)^ {10}INTERCOM_PREVIEW$", plain)) and "INTERCOM_ATTACHMENT" not in plain,
                "intercom_no_card": "From:" not in plain and "╭ From" not in plain,
                "intercom_model_content_hidden": "INTERCOM_MODEL_CONTENT" not in plain,
            }
            subprocess.run(["tmux", "send-keys", "-t", target, "C-o"], check=True)
            expanded, expanded_plain = wait_for_screen(
                target, 10,
                lambda _screen, plain: "INTERCOM_ATTACHMENT" in plain and "INTERCOM_EXPANDED_DETAIL" in plain,
                f"incoming Intercom fixture did not expand: {run}",
            )
            (run / "intercom-expanded.ansi").write_text(expanded)
            (run / "intercom-expanded.txt").write_text(expanded_plain)
            checks["intercom_expanded"] = all(text in expanded_plain for text in (
                "INTERCOM_ATTACHMENT", "INTERCOM_EXPANDED_DETAIL", "SYNTHETIC_REPLY_HINT", "synthetic-incoming-id",
            ))
            checks["custom_cards_expand"] = "CUSTOM_CALL_CARD" in expanded_plain and "CUSTOM_RESULT_CARD" in expanded_plain
            subprocess.run(["tmux", "send-keys", "-t", target, "C-o"], check=True)
            for command_name, title, key, answer in (
                ("approval", "OFFLINE_APPROVAL", "Escape", False),
                ("question", "OFFLINE_QUESTION", "Enter", "OFFLINE_OPTION"),
            ):
                subprocess.run(["tmux", "send-keys", "-t", target, f"/{command_name}-fixture", "Enter"], check=True)
                dialog, _ = wait_for_screen(target, 10, lambda _screen, text: title in text, f"missing {title}: {run}")
                (run / f"{command_name}.ansi").write_text(dialog)
                subprocess.run(["tmux", "send-keys", "-t", target, key], check=True)
                answer_path = run / f"{command_name}.json"
                wait_for_screen(target, 10, lambda _screen, _text: answer_path.exists(), f"unanswered {title}: {run}")
                checks[f"{command_name}_interactive"] = json.loads(answer_path.read_text()) == answer
            results[mode] = checks
            (output / "assertions.json").write_text(json.dumps(results, indent=2) + "\n")
            if not all(checks.values()):
                raise RuntimeError(f"{mode} actual-CLI assertions failed: {checks}; see {run}")
            print(f"{mode}: actual {launcher} rendered universal web/MCP/Intercom rows, expanded cards, native dialogs, headers, separator, inset and Powerline")
        finally:
            subprocess.run(["tmux", "kill-session", "-t", target], check=False, capture_output=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("sdk", "launcher", "config", "home", "output"):
        parser.add_argument("--" + name, required=True, type=Path)
    args = parser.parse_args()
    smoke(args.sdk.resolve(), args.launcher.absolute(), args.config.resolve(), args.home.resolve(), args.output.resolve())
