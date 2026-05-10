const fs = require('fs');
const cells = [];
function md(source) { cells.push({ cell_type: 'markdown', metadata: {}, source: source.split('\n').map((l, i, a) => i < a.length - 1 ? l + '\n' : l) }); }
function code(source) { cells.push({ cell_type: 'code', metadata: {}, source: source.split('\n').map((l, i, a) => i < a.length - 1 ? l + '\n' : l), outputs: [], execution_count: null }); }

const BT = '`';
const BT3 = '```';

md(`# 第八章：CLI 命令系统

> CLI 是用户和代理与 CORAL 交互的唯一界面。本章实现完整的命令行系统。

## 本章内容

- CLI 架构：argparse + 分组命令
- 17 条命令的分类和调度
- 核心命令实现：start, eval, log, show, notes, skills
- 运行发现机制：从工作目录找到 .coral/
- tmux / Docker 会话管理

> Source: ${BT}coral/cli/__init__.py${BT}, ${BT}coral/cli/start.py${BT}, ${BT}coral/cli/eval.py${BT}, ${BT}coral/cli/query.py${BT}`);

md(`## 1. CLI 命令全景

${BT3}mermaid
flowchart TB
    subgraph "Getting Started"
        INIT["coral init"]
        VALIDATE["coral validate"]
    end

    subgraph "Running Agents"
        START["coral start -c task.yaml"]
        RESUME["coral resume"]
        STOP["coral stop"]
        STATUS["coral status"]
    end

    subgraph "Inspecting Results"
        LOG["coral log"]
        SHOW["coral show hash"]
        NOTES["coral notes"]
        SKILLS["coral skills"]
        RUNS["coral runs"]
    end

    subgraph "Agent Internals"
        EVAL["coral eval -m desc"]
        DIFF["coral diff"]
        REVERT["coral revert"]
        CHECKOUT["coral checkout hash"]
        HEARTBEAT["coral heartbeat"]
    end

    subgraph "Dashboard"
        UI["coral ui"]
    end

    START -->|创建项目| STATUS
    EVAL -->|评估结果| LOG
    LOG -->|查看详情| SHOW
${BT3}

### 命令分组

| 组 | 命令 | 谁用 |
|----|------|------|
| Getting Started | init, validate | 用户（任务作者） |
| Running Agents | start, resume, stop, status | 用户（编排者） |
| Inspecting Results | log, show, notes, skills, runs | 用户 + 代理 |
| Agent Internals | eval, diff, revert, checkout, heartbeat | 代理 |
| Dashboard | ui | 用户 |`);

md(`## 2. CLI 调度架构

CORAL CLI 使用 ${BT}argparse${BT} + 懒导入实现：

${BT3}
coral <command> [options]
  |
  v
argparse.parse_args()
  |
  v
commands = {
    "start": cmd_start,    # 懒导入 coral.cli.start
    "eval":  cmd_eval,     # 懒导入 coral.cli.eval
    "log":   cmd_log,      # 懒导入 coral.cli.query
    ...
}
commands[args.command](args)
${BT3}

**懒导入**的好处：${BT}coral log${BT} 不需要加载 AgentManager，启动更快。`);

code(`import argparse
import json
import os
import sys
import tempfile
from pathlib import Path
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(".")), "our-implementation"))
from types_ import Attempt, Score, ScoreBundle
from hub import write_attempt, read_attempts, get_leaderboard, format_leaderboard


# === CLI 调度器（简化版） ===

def create_cli_parser() -> argparse.ArgumentParser:
    """创建 CORAL CLI 解析器。"""
    epilog = """Getting Started:
  init            Create a new task directory
  validate        Test your grader

Running Agents:
  start           Launch agents on a task
  resume          Resume a previous run
  stop            Shut down running agents
  status          Show agent health

Inspecting Results:
  log             Leaderboard and search
  show            Details of a specific attempt
  notes           Browse shared notes
  skills          Browse shared skills

Agent Internals:
  eval            Stage, commit, evaluate
  diff            Show uncommitted changes
  revert          Undo last commit
  checkout        Reset to previous attempt
  heartbeat       View/modify heartbeat

Run 'coral <command> --help' for details."""

    parser = argparse.ArgumentParser(
        prog="coral",
        description="CORAL - Autonomous agent orchestration",
        epilog=epilog,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    sub = parser.add_subparsers(dest="command")

    # start
    p_start = sub.add_parser("start", help="Launch agents on a task")
    p_start.add_argument("--config", "-c", required=True, help="Path to task config YAML")
    p_start.add_argument("overrides", nargs="*", default=[], help="Config overrides as key=value")

    # eval
    p_eval = sub.add_parser("eval", help="Stage, commit, and evaluate changes")
    p_eval.add_argument("-m", "--message", required=True, help="Description of changes")
    p_eval.add_argument("--agent", help="Agent ID")

    # log
    p_log = sub.add_parser("log", help="Leaderboard and search")
    p_log.add_argument("-n", "--count", type=int, default=20, help="Number of results")
    p_log.add_argument("--recent", action="store_true", help="Sort by time")
    p_log.add_argument("--agent", help="Filter by agent ID")
    p_log.add_argument("--search", help="Full-text search")

    # show
    p_show = sub.add_parser("show", help="Show details of a specific attempt")
    p_show.add_argument("hash", help="Commit hash or prefix")
    p_show.add_argument("--diff", action="store_true", help="Show code diff")

    # notes
    p_notes = sub.add_parser("notes", help="Browse shared notes")
    p_notes.add_argument("--search", "-s", help="Search by keyword")
    p_notes.add_argument("-n", "--recent", type=int, help="Show N most recent")

    # skills
    p_skills = sub.add_parser("skills", help="Browse shared skills")
    p_skills.add_argument("--read", "-r", help="Show skill details")

    # stop
    sub.add_parser("stop", help="Shut down running agents")

    # status
    sub.add_parser("status", help="Show agent health and leaderboard")

    # diff
    sub.add_parser("diff", help="Show uncommitted changes")

    # revert
    sub.add_parser("revert", help="Undo the last commit")

    # checkout
    p_checkout = sub.add_parser("checkout", help="Reset to previous attempt")
    p_checkout.add_argument("hash", help="Commit hash")

    # heartbeat
    sub.add_parser("heartbeat", help="View/modify heartbeat actions")

    return parser


parser = create_cli_parser()
print("CLI 解析器创建完成，支持以下命令：")

# 测试解析
test_cases = [
    'start -c task.yaml agents.count=4',
    'eval -m "优化排序算法"',
    'log -n 5 --recent',
    'show abc123 --diff',
    'notes --search 排序',
]

for cmd in test_cases:
    args = parser.parse_args(cmd.split())
    print(f"  coral {cmd}")
    print(f"    -> command={args.command}, args={vars(args)}")
    print()`);

md(`## 3. 核心命令实现

### 3.1 coral log —— 排行榜`);

code(`def cmd_log(coral_dir: str, count: int = 20, recent: bool = False,
            agent: str | None = None, search: str | None = None,
            direction: str = "maximize") -> str:
    """实现 coral log 命令。"""
    from hub import read_attempts, get_leaderboard, search_attempts, get_agent_attempts, get_recent, format_leaderboard

    if search:
        attempts = search_attempts(coral_dir, search)
        if not attempts:
            return f"No attempts matching '{search}'."
        return format_leaderboard(attempts[:count])

    if agent:
        attempts = get_agent_attempts(coral_dir, agent)
        if not attempts:
            return f"No attempts from {agent}."
        scored = [a for a in attempts if a.score is not None]
        scored.sort(key=lambda a: a.score, reverse=(direction != "minimize"))
        return format_leaderboard(scored[:count])

    if recent:
        attempts = get_recent(coral_dir, n=count)
        return format_leaderboard(attempts)

    top = get_leaderboard(coral_dir, top_n=count, direction=direction)
    return format_leaderboard(top)


# === 演示 ===
with tempfile.TemporaryDirectory() as tmpdir:
    now = datetime.now(timezone.utc).isoformat()
    test_data = [
        Attempt("aaa111", "agent-1", "冒泡排序", 0.60, "baseline", None, now, "慢"),
        Attempt("bbb222", "agent-1", "快速排序", 0.95, "improved", "aaa111", now, "快多了"),
        Attempt("ccc333", "agent-2", "归并排序", 0.90, "improved", None, now, "稳定排序"),
        Attempt("ddd444", "agent-2", "混合排序", 0.98, "improved", "ccc333", now, "最优!"),
        Attempt("eee555", "agent-3", "堆排序", 0.85, "baseline", None, now, "不错"),
    ]
    for a in test_data:
        write_attempt(tmpdir, a)

    print("=== coral log (排行榜) ===")
    print(cmd_log(tmpdir))

    print("\\n=== coral log --agent agent-1 ===")
    print(cmd_log(tmpdir, agent="agent-1"))

    print("\\n=== coral log --search 排序 ===")
    print(cmd_log(tmpdir, search="排序"))`);

md(`### 3.2 coral show —— 查看评估详情`);

code(`def cmd_show(coral_dir: str, commit_hash: str, show_diff: bool = False) -> str:
    """实现 coral show 命令。"""
    from hub import read_attempts

    attempts = read_attempts(coral_dir)

    # 支持前缀匹配
    matches = [a for a in attempts if a.commit_hash.startswith(commit_hash)]
    if not matches:
        return f"No attempt found with hash starting with '{commit_hash}'."
    if len(matches) > 1:
        hashes = ", ".join(a.commit_hash[:7] for a in matches)
        return f"Ambiguous hash prefix '{commit_hash}'. Matches: {hashes}"

    attempt = matches[0]
    lines = [
        f"## Attempt: {attempt.commit_hash[:12]}",
        "",
        f"| Field | Value |",
        f"|-------|-------|",
        f"| Agent | {attempt.agent_id} |",
        f"| Title | {attempt.title} |",
        f"| Score | {attempt.score} |",
        f"| Status | {attempt.status} |",
        f"| Parent | {attempt.parent_hash or 'none'} |",
        f"| Time | {attempt.timestamp} |",
    ]
    if attempt.feedback:
        lines.append(f"| Feedback | {attempt.feedback} |")

    if show_diff:
        lines.append("")
        lines.append("(diff 需要 git 仓库，此处省略)")

    return "\\n".join(lines)


# === 演示 ===
with tempfile.TemporaryDirectory() as tmpdir:
    for a in test_data:
        write_attempt(tmpdir, a)

    print("=== coral show ddd ===")
    print(cmd_show(tmpdir, "ddd"))

    print("\\n=== coral show aaa （前缀匹配）===")
    print(cmd_show(tmpdir, "aaa"))`);

md(`### 3.3 coral eval —— 评估（代理调用）

这是代理最常用的命令，串联了第六章的评估流水线：

${BT3}
coral eval -m "优化了内层循环"
  -> git add -A
  -> git commit -m "优化了内层循环"
  -> 运行评分器
  -> 比较历史最优
  -> 写入 attempt JSON
  -> 打印分数和反馈
${BT3}`);

code(`def cmd_eval_demo(coral_dir: str, message: str, agent_id: str,
                  score: float, workdir: str = "/fake") -> Attempt:
    """模拟 coral eval 命令（不需要真实 git 仓库）。"""
    from hub import write_attempt, get_agent_attempts

    # 模拟 commit hash
    import hashlib
    commit_hash = hashlib.sha1(f"{message}{agent_id}{score}".encode()).hexdigest()[:12]

    # 比较历史最优
    prev = get_agent_attempts(coral_dir, agent_id)
    prev_scores = [a.score for a in prev if a.score is not None]
    prev_best = max(prev_scores) if prev_scores else None

    if prev_best is None:
        status = "improved"
    elif score > prev_best:
        status = "improved"
    elif score == prev_best:
        status = "baseline"
    else:
        status = "regressed"

    attempt = Attempt(
        commit_hash=commit_hash,
        agent_id=agent_id,
        title=message,
        score=score,
        status=status,
        parent_hash=prev[-1].commit_hash if prev else None,
        timestamp=datetime.now(timezone.utc).isoformat(),
        feedback=f"Score: {score:.4f} ({status})",
    )
    write_attempt(coral_dir, attempt)

    # 打印反馈（和真实 coral eval 一样）
    status_icon = {
        "improved": "+",
        "baseline": "=",
        "regressed": "-",
        "timeout": "!",
        "crashed": "X",
    }
    icon = status_icon.get(status, "?")
    print(f"[{icon}] score={score:.4f} ({status}) commit={commit_hash}")
    if status == "improved" and prev_best is not None:
        print(f"    New best! Previous: {prev_best:.4f}")

    return attempt


# === 模拟代理评估循环 ===
with tempfile.TemporaryDirectory() as tmpdir:
    print("=== 模拟 Agent-1 的评估循环 ===\\n")

    cmd_eval_demo(tmpdir, "冒泡排序 baseline", "agent-1", 0.60)
    cmd_eval_demo(tmpdir, "快速排序", "agent-1", 0.85)
    cmd_eval_demo(tmpdir, "优化 pivot 选择", "agent-1", 0.90)
    cmd_eval_demo(tmpdir, "尝试三数取中", "agent-1", 0.88)  # 退步
    cmd_eval_demo(tmpdir, "混合排序策略", "agent-1", 0.95)

    print("\\n=== 最终排行榜 ===")
    print(cmd_log(tmpdir))`);

md(`## 4. 运行发现机制

代理在 worktree 中调用 ${BT}coral eval${BT} 时，需要找到 ${BT}.coral/${BT} 目录。
CORAL 通过**面包屑文件**实现发现：

${BT3}
agents/agent-1/
  .coral_dir        -> /absolute/path/to/.coral
  .coral_agent_id   -> "agent-1"
${BT3}

${BT}coral eval${BT} 从当前工作目录读取这两个文件，就能找到共享状态目录和自己的身份。`);

code(`def find_coral_dir_from_cwd(cwd: str = ".") -> tuple[Path | None, str | None]:
    """从当前工作目录发现 .coral 路径和代理 ID。"""
    cwd_path = Path(cwd).resolve()

    # 读取面包屑文件
    coral_dir_file = cwd_path / ".coral_dir"
    agent_id_file = cwd_path / ".coral_agent_id"

    coral_dir = None
    agent_id = None

    if coral_dir_file.exists():
        try:
            coral_dir = Path(coral_dir_file.read_text().strip())
        except (OSError, ValueError):
            pass

    if agent_id_file.exists():
        try:
            agent_id = agent_id_file.read_text().strip()
        except (OSError, ValueError):
            pass

    return coral_dir, agent_id


# 演示
with tempfile.TemporaryDirectory() as tmpdir:
    # 模拟 worktree 目录
    wt = Path(tmpdir) / "agents" / "agent-1"
    wt.mkdir(parents=True)
    coral_dir = Path(tmpdir) / ".coral"
    coral_dir.mkdir()
    (coral_dir / "public" / "attempts").mkdir(parents=True)

    # 写入面包屑
    (wt / ".coral_dir").write_text(str(coral_dir))
    (wt / ".coral_agent_id").write_text("agent-1")

    # 发现
    found_coral, found_id = find_coral_dir_from_cwd(str(wt))
    print(f"发现 coral_dir: {found_coral}")
    print(f"发现 agent_id: {found_id}")
    assert found_id == "agent-1"`);

md(`## 5. 会话管理：tmux 和 Docker

CORAL 支持三种运行模式：

| 模式 | 设置 | 特点 |
|------|------|------|
| local | ${BT}run.session=local${BT} | 前台运行，Ctrl+C 停止 |
| tmux | ${BT}run.session=tmux${BT}（默认） | 后台运行，${BT}tmux attach${BT} 查看 |
| docker | ${BT}run.session=docker${BT} | 容器化运行 |

${BT3}mermaid
flowchart TD
    USER["coral start -c task.yaml"] --> CHECK{"run.session?"}
    CHECK -->|tmux| TMUX["创建 tmux session<br/>coral-task-timestamp"]
    CHECK -->|docker| DOCKER["docker run -d<br/>coral-task-timestamp"]
    CHECK -->|local| LOCAL["直接运行<br/>前台模式"]

    TMUX --> INNER["在 tmux 内重新运行<br/>coral start ... run.session=local"]
    DOCKER --> INNER2["在容器内运行<br/>coral start ... run.session=local"]
    INNER & INNER2 & LOCAL --> MANAGER["AgentManager.monitor_loop()"]
${BT3}

**关键设计**：tmux/docker 模式下，外层进程创建会话后，在会话内**重新执行** ${BT}coral start${BT} 并附加 ${BT}run.session=local${BT}，避免无限递归。`);

code(`def simulate_session_management(session_mode: str, task_name: str) -> dict:
    """模拟 CORAL 的会话管理逻辑。"""
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")

    if session_mode == "tmux":
        session_name = f"coral-{task_name}-{timestamp}"
        # 实际会执行：tmux new-session -d -s <name> <coral start ... run.session=local>
        return {
            "mode": "tmux",
            "session_name": session_name,
            "command": f"tmux new-session -d -s {session_name} 'coral start -c ... run.session=local'",
            "attach": f"tmux attach -t {session_name}",
        }

    elif session_mode == "docker":
        container_name = f"coral-{task_name}-{timestamp}"
        return {
            "mode": "docker",
            "container_name": container_name,
            "command": f"docker run -d --name {container_name} coral-claude:local start ...",
            "logs": f"docker logs -f {container_name}",
        }

    else:
        return {
            "mode": "local",
            "note": "直接运行 AgentManager.monitor_loop()",
        }


# 演示
for mode in ["tmux", "docker", "local"]:
    result = simulate_session_management(mode, "sort-optimizer")
    print(f"=== {mode} 模式 ===")
    for k, v in result.items():
        print(f"  {k}: {v}")
    print()`);

md(`## 6. 完整 CLI 模拟

把所有命令串联起来，模拟一个完整的 CORAL 工作流。`);

code(`# === 完整 CLI 工作流模拟 ===

with tempfile.TemporaryDirectory() as tmpdir:
    # 1. 创建项目结构（coral init + coral start 的效果）
    coral_dir = os.path.join(tmpdir, ".coral")
    os.makedirs(os.path.join(coral_dir, "public", "attempts"))
    os.makedirs(os.path.join(coral_dir, "public", "notes"))
    os.makedirs(os.path.join(coral_dir, "public", "skills"))

    print("=" * 60)
    print("  CORAL CLI 工作流模拟")
    print("=" * 60)

    # 2. 代理 1 和 2 交替评估
    print("\\n--- Agent-1 开始工作 ---")
    cmd_eval_demo(coral_dir, "冒泡排序 baseline", "agent-1", 0.60)
    cmd_eval_demo(coral_dir, "快速排序", "agent-1", 0.85)

    print("\\n--- Agent-2 开始工作 ---")
    cmd_eval_demo(coral_dir, "归并排序", "agent-2", 0.80)
    cmd_eval_demo(coral_dir, "TimSort", "agent-2", 0.92)

    print("\\n--- Agent-1 继续优化 ---")
    cmd_eval_demo(coral_dir, "随机化快排", "agent-1", 0.90)
    cmd_eval_demo(coral_dir, "混合排序策略", "agent-1", 0.96)

    # 3. coral log
    print("\\n=== coral log ===")
    print(cmd_log(coral_dir))

    # 4. coral show（查看最高分）
    attempts = read_attempts(coral_dir)
    best = max(attempts, key=lambda a: a.score or 0)
    print(f"\\n=== coral show {best.commit_hash[:7]} ===")
    print(cmd_show(coral_dir, best.commit_hash[:7]))

    # 5. coral log --agent agent-2
    print("\\n=== coral log --agent agent-2 ===")
    print(cmd_log(coral_dir, agent="agent-2"))

    # 6. coral log --search TimSort
    print("\\n=== coral log --search TimSort ===")
    print(cmd_log(coral_dir, search="TimSort"))

    print("\\n" + "=" * 60)
    print("  工作流模拟完成!")
    print("=" * 60)`);

md(`## 源码映射表

| 我们的实现 | 原始源码 | 说明 |
|-----------|---------|------|
| create_cli_parser | ${BT}coral/cli/__init__.py:94-416${BT} | 简化：17 个命令全部注册，省略部分选项 |
| cmd_log | ${BT}coral/cli/query.py:cmd_log()${BT} | 核心一致：排行榜 + 搜索 + 过滤 |
| cmd_show | ${BT}coral/cli/query.py:cmd_show()${BT} | 简化：省略了 git diff 集成 |
| cmd_eval_demo | ${BT}coral/cli/eval.py:cmd_eval()${BT} | 简化：省略了真实 git 和评分器 |
| find_coral_dir_from_cwd | ${BT}coral/cli/_helpers.py:find_coral_dir()${BT} | 简化：直接读面包屑 |
| session management | ${BT}coral/cli/start.py:_start_in_tmux()${BT} | 核心逻辑一致 |

### 关键发现

1. **懒导入**：${BT}coral log${BT} 不需要加载 ${BT}AgentManager${BT}，只有 ${BT}coral start${BT} 才导入。启动快 10 倍。
2. **分组帮助**：自定义 ${BT}_GroupedHelpFormatter${BT} 隐藏了默认的子命令列表，改用手写的分组 epilog。
3. **「你是不是想说」**：${BT}_MainParser.error()${BT} 使用 ${BT}difflib.get_close_matches()${BT} 给拼错的命令推荐。
4. **tmux 反递归**：外层加 ${BT}run.session=local${BT}，内层不再创建新 tmux。
5. **面包屑发现**：代理不需要知道自己在哪里，只需读 ${BT}.coral_dir${BT} 和 ${BT}.coral_agent_id${BT}。
6. **前缀匹配**：${BT}coral show abc${BT} 可以匹配 ${BT}abc123...${BT}，方便快速查看。

---

**上一章**: [07-agent-runtime.ipynb](07-agent-runtime.ipynb)
**下一章**: [09-full-integration.ipynb](09-full-integration.ipynb) —— 全局集成与端到端演示。`);

const notebook = { nbformat: 4, nbformat_minor: 5, metadata: { kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' }, language_info: { name: 'python', version: '3.11.0' } }, cells: cells };
const output = JSON.stringify(notebook, null, 1);
fs.writeFileSync('G:/agents/opensouce_proj/CORAL/CORAL-from-scratch/notebooks/08-cli-commands.ipynb', output);
console.log(`Cells: ${cells.length}  Size: ${output.length} bytes`);
