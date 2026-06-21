import * as vscode from "vscode";

// A TreeView sidebar showing the live hop grid: projects (status + tally) with
// their open Claude Code chats as children. Polls the local hub /state.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Node =
  | { kind: "project"; p: any }
  | { kind: "session"; s: any }
  | { kind: "banner"; text: string };

const STATUS_ICON: Record<string, string> = {
  agent_waiting: "bell-dot",
  agent_running: "sync~spin",
  blocked: "circle-slash",
  idle: "circle-outline",
};
const SESSION_ICON: Record<string, string> = {
  waiting: "bell-dot",
  running: "sync~spin",
  ended: "circle-outline",
};

export class HoppingTree implements vscode.TreeDataProvider<Node> {
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;
  private state: any = null;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private port: () => number) {
    this.refresh();
    this.timer = setInterval(() => this.refresh(), 5000);
  }

  dispose() {
    if (this.timer) clearInterval(this.timer);
  }

  async refresh() {
    try {
      const res = await fetch(`http://127.0.0.1:${this.port()}/state`, {
        signal: AbortSignal.timeout(1500),
      });
      this.state = await res.json();
    } catch {
      this.state = null;
    }
    this._onDidChange.fire();
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === "banner") {
      const it = new vscode.TreeItem(node.text);
      it.iconPath = new vscode.ThemeIcon("rocket");
      return it;
    }
    if (node.kind === "project") {
      const p = node.p;
      const sessions = (this.state?.sessions ?? []).filter((s: any) => s.project_id === p.id);
      const it = new vscode.TreeItem(
        p.name,
        sessions.length
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.None,
      );
      it.description =
        p.status === "idle" ? `tally ${p.tally}` : (p.status as string).replace("agent_", "");
      it.iconPath = new vscode.ThemeIcon(STATUS_ICON[p.status] ?? "circle-outline");
      it.tooltip = p.last_brief || p.last_commit || "";
      return it;
    }
    const s = node.s;
    const it = new vscode.TreeItem(s.name || s.session_id.slice(0, 8));
    it.description = s.last_result ? s.last_result.slice(0, 80) : s.status;
    it.tooltip = s.last_result || "";
    it.iconPath = new vscode.ThemeIcon(SESSION_ICON[s.status] ?? "circle-outline");
    return it;
  }

  getChildren(node?: Node): Node[] {
    if (!this.state) return [{ kind: "banner", text: "Hopping hub offline" }];
    if (!node) {
      const banner: Node[] = this.state.next
        ? [{ kind: "banner", text: `hop next → ${this.state.next.name}` }]
        : [];
      const projects: Node[] = (this.state.ordered ?? this.state.projects ?? [])
        .filter((p: any) => !p.archived)
        .map((p: any) => ({ kind: "project", p }));
      return [...banner, ...projects];
    }
    if (node.kind === "project") {
      return (this.state.sessions ?? [])
        .filter((s: any) => s.project_id === node.p.id)
        .map((s: any) => ({ kind: "session", s }));
    }
    return [];
  }
}
