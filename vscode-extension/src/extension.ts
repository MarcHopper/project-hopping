import * as vscode from "vscode";

function cfg() {
  const c = vscode.workspace.getConfiguration("hopping");
  return {
    port: c.get<number>("hubPort", 4319),
    pattern: new RegExp(
      c.get<string>("agentCommandPattern", "claude|cursor|aider|codex|gemini|llm|gpt|opencode|goose"),
      "i",
    ),
  };
}

async function post(path: string, body: unknown) {
  try {
    await fetch(`http://127.0.0.1:${cfg().port}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(1500),
    });
  } catch {
    /* hub down — never disrupt the editor */
  }
}

function activeFolder(): string | undefined {
  const ed = vscode.window.activeTextEditor;
  if (ed) {
    const f = vscode.workspace.getWorkspaceFolder(ed.document.uri);
    if (f) return f.uri.fsPath;
  }
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function reportFocus() {
  const path = activeFolder();
  if (path) post("/focus", { path });
}

// The shell-integration API is typed loosely here to avoid version skew.
/* eslint-disable @typescript-eslint/no-explicit-any */
function termCwd(e: any): string | undefined {
  return (
    e?.execution?.cwd?.fsPath ??
    e?.shellIntegration?.cwd?.fsPath ??
    e?.terminal?.shellIntegration?.cwd?.fsPath ??
    activeFolder()
  );
}

export function activate(context: vscode.ExtensionContext) {
  reportFocus();

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => reportFocus()),
    vscode.window.onDidChangeWindowState((s) => {
      if (s.focused) reportFocus();
    }),
  );

  // Terminal shell integration (stable API): detect agent commands finishing.
  const win = vscode.window as any;
  if (typeof win.onDidStartTerminalShellExecution === "function") {
    context.subscriptions.push(
      win.onDidStartTerminalShellExecution((e: any) => {
        const cmd = e?.execution?.commandLine?.value ?? "";
        if (cfg().pattern.test(cmd)) post("/event", { path: termCwd(e), type: "agent_running" });
      }),
      win.onDidEndTerminalShellExecution((e: any) => {
        const cmd = e?.execution?.commandLine?.value ?? "";
        if (cfg().pattern.test(cmd)) post("/event", { path: termCwd(e), type: "agent_waiting" });
      }),
    );
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("hopping.markWaiting", () => {
      const path = activeFolder();
      if (path) {
        post("/event", { path, type: "agent_waiting" });
        vscode.window.showInformationMessage("Hopping: marked this project as waiting on you.");
      } else {
        vscode.window.showWarningMessage("Hopping: no workspace folder to mark.");
      }
    }),
    vscode.commands.registerCommand("hopping.openGrid", () => {
      vscode.env.openExternal(vscode.Uri.parse("http://localhost:3000"));
    }),
  );

  // Status bar: shows the focused project's brief/tally; click opens the grid.
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  item.command = "hopping.openGrid";
  item.text = "$(rocket) Hopping";
  item.tooltip = "Open the hop grid";
  item.show();
  context.subscriptions.push(item);

  const tick = async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${cfg().port}/state`, {
        signal: AbortSignal.timeout(1500),
      });
      const data: any = await res.json();
      const focused = data?.settings?.focused_project_id;
      const p = (data?.projects ?? []).find((x: any) => x.id === focused);
      if (p) item.text = `$(rocket) ${p.name}: ${p.last_brief || "tally " + p.tally}`;
      else if (data?.next) item.text = `$(rocket) hop next → ${data.next.name}`;
      else item.text = "$(rocket) Hopping";
    } catch {
      item.text = "$(rocket) Hopping (hub off)";
    }
  };
  tick();
  const timer = setInterval(tick, 5000);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
}

export function deactivate() {}
