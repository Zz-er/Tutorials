const fs = require('fs');
const cells = [];
function md(source) { cells.push({ cell_type: 'markdown', metadata: {}, source: source.split('\n').map((l, i, a) => i < a.length - 1 ? l + '\n' : l) }); }
function code(source) { cells.push({ cell_type: 'code', metadata: {}, source: source.split('\n').map((l, i, a) => i < a.length - 1 ? l + '\n' : l), outputs: [], execution_count: null }); }

md(`# 第五章：工作空间隔离

> 多个代理同时修改同一份代码会导致灾难。本章用 Git Worktree + 符号链接实现安全的多代理隔离。

## 本章内容

- Git Worktree 基础：一个仓库，多个工作目录
- CORAL 项目目录结构
- 符号链接共享状态
- 代理权限模型
- 面包屑文件（breadcrumb）发现机制

> Source: \`coral/workspace/project.py\`, \`coral/workspace/worktree.py\``);

md(`## 1. 痛点：并发写入的灾难

两个代理同时修改 solution.py：

\`\`\`
Agent-1: 正在写入第 50 行...
Agent-2: 正在写入第 50 行...（覆盖了 Agent-1 的修改！）
\`\`\`

### 方案对比

| 方案 | 优点 | 缺点 |
|------|------|------|
| 文件锁 | 简单 | 代理互相等待，效率低 |
| 目录复制 | 隔离 | 不支持 git diff，浪费磁盘 |
| Docker 容器 | 完全隔离 | 太重量级，启动慢 |
| **Git Worktree** | **隔离 + git 原生支持** | **需要理解 git 内部机制** |`);

md(`## 2. Git Worktree 原理

Git Worktree 让一个仓库拥有多个**独立的工作目录**，每个在不同的分支上：

\`\`\`mermaid
flowchart TB
    subgraph "单个 .git 仓库"
        GIT[".git/"]
    end

    subgraph "多个工作目录"
        W1["agents/agent-1/<br/>分支: coral/agent-1"]
        W2["agents/agent-2/<br/>分支: coral/agent-2"]
        W3["agents/agent-3/<br/>分支: coral/agent-3"]
    end

    GIT --> W1
    GIT --> W2
    GIT --> W3
\`\`\`

关键命令：
- \`git worktree add <path> -b <branch>\` —— 创建新工作树
- \`git worktree list\` —— 列出所有工作树
- \`git worktree remove <path>\` —— 删除工作树`);

code(`import subprocess
import tempfile
import os
from pathlib import Path

# Git Worktree 演示
with tempfile.TemporaryDirectory() as tmpdir:
    repo = os.path.join(tmpdir, "repo")

    # 初始化仓库
    subprocess.run(["git", "init", repo], capture_output=True)
    subprocess.run(["git", "-C", repo, "commit", "--allow-empty", "-m", "init"],
                   capture_output=True)

    # 创建两个工作树
    wt1 = os.path.join(tmpdir, "agent-1")
    wt2 = os.path.join(tmpdir, "agent-2")

    subprocess.run(["git", "-C", repo, "worktree", "add", wt1, "-b", "coral/agent-1"],
                   capture_output=True)
    subprocess.run(["git", "-C", repo, "worktree", "add", wt2, "-b", "coral/agent-2"],
                   capture_output=True)

    # 在不同工作树中独立修改
    Path(os.path.join(wt1, "solution.py")).write_text("def sort(a): return sorted(a)  # Agent 1")
    Path(os.path.join(wt2, "solution.py")).write_text("def sort(a): return list(reversed(sorted(a, reverse=True)))  # Agent 2")

    # 各自的修改互不影响
    content1 = Path(os.path.join(wt1, "solution.py")).read_text()
    content2 = Path(os.path.join(wt2, "solution.py")).read_text()

    print(f"Agent-1: {content1.strip()}")
    print(f"Agent-2: {content2.strip()}")
    print(f"\\n两个代理独立修改，互不干扰！")

    # 列出工作树
    result = subprocess.run(["git", "-C", repo, "worktree", "list"],
                           capture_output=True, text=True)
    print(f"\\n工作树列表:\\n{result.stdout}")`);

md(`## 3. CORAL 项目目录结构

\`\`\`
results/
  sort-optimizer/              # slugify(task.name)
    latest -> 2026-04-01T10/   # 符号链接到最新运行
    2026-04-01T10:00:00/       # 运行目录
      .coral/
        public/
          attempts/            # 评估记录 JSON
          logs/                # 代理日志 NDJSON
          skills/              # 共享技能
          notes/               # 共享笔记
          heartbeat/           # 心跳配置
          sessions/            # Claude Code 会话
        private/
          eval/                # 评分器代码（代理不可见）
            grader.py
        config.yaml            # 运行配置
      repo/                    # 克隆的代码仓库
      agents/
        agent-1/               # Worktree（分支 coral/agent-1）
          solution.py
          .coral_dir           # 面包屑：指向 .coral/ 路径
          .coral_agent_id      # 面包屑：当前代理 ID
          .claude/             # Claude Code 配置
            notes/ -> ../../.coral/public/notes/    # 符号链接！
            skills/ -> ../../.coral/public/skills/
            ...
        agent-2/               # 另一个独立工作树
\`\`\``);

md(`## 4. 符号链接共享状态

每个工作树通过**符号链接**访问 .coral/public/ 中的共享状态：

\`\`\`mermaid
flowchart LR
    subgraph agent-1 worktree
        A1[".claude/notes/"]
        A2[".claude/skills/"]
        A3[".claude/attempts/"]
    end
    subgraph ".coral/public/"
        N["notes/"]
        S["skills/"]
        AT["attempts/"]
    end
    A1 -->|symlink| N
    A2 -->|symlink| S
    A3 -->|symlink| AT
\`\`\`

关键：使用**相对路径**符号链接，使项目可在不同机器间移植。`);

code(`# 模拟 CORAL 工作空间设置
import json

def create_project_structure(base_dir: str, task_name: str) -> dict:
    """创建 CORAL 项目目录结构。"""
    base = Path(base_dir)
    run_dir = base / "results" / task_name / "run-001"

    # 创建 .coral 结构
    coral_dir = run_dir / ".coral"
    for subdir in ["public/attempts", "public/logs", "public/skills",
                   "public/notes", "public/heartbeat", "private/eval"]:
        (coral_dir / subdir).mkdir(parents=True, exist_ok=True)

    # 创建 repo 和 agents 目录
    repo_dir = run_dir / "repo"
    repo_dir.mkdir(parents=True, exist_ok=True)
    agents_dir = run_dir / "agents"
    agents_dir.mkdir(parents=True, exist_ok=True)

    return {
        "run_dir": str(run_dir),
        "coral_dir": str(coral_dir),
        "repo_dir": str(repo_dir),
        "agents_dir": str(agents_dir),
    }


def setup_shared_state(worktree_path: str, coral_dir: str, shared_dir_name: str = ".claude"):
    """设置共享状态符号链接。"""
    wt = Path(worktree_path)
    shared = wt / shared_dir_name
    shared.mkdir(exist_ok=True)

    # 需要链接的目录
    link_targets = ["notes", "skills", "attempts", "logs", "heartbeat"]
    public_dir = Path(coral_dir) / "public"

    for name in link_targets:
        link = shared / name
        target = public_dir / name
        if not link.exists() and target.exists():
            # 计算相对路径
            try:
                rel = os.path.relpath(target, link.parent)
                os.symlink(rel, link)
            except OSError:
                # Windows 可能需要管理员权限
                pass


def write_agent_id(worktree_path: str, agent_id: str):
    """写入代理 ID 面包屑文件。"""
    Path(worktree_path, ".coral_agent_id").write_text(agent_id)


def write_coral_dir(worktree_path: str, coral_dir: str):
    """写入 .coral 路径面包屑文件。"""
    Path(worktree_path, ".coral_dir").write_text(str(Path(coral_dir).resolve()))


def get_coral_dir(worktree_path: str) -> Path | None:
    """从面包屑文件读取 .coral 路径。"""
    breadcrumb = Path(worktree_path) / ".coral_dir"
    if breadcrumb.exists():
        try:
            return Path(breadcrumb.read_text().strip()).resolve()
        except (OSError, ValueError):
            pass
    return None


# 演示
with tempfile.TemporaryDirectory() as tmpdir:
    paths = create_project_structure(tmpdir, "sort-optimizer")
    print("项目结构创建完成：")
    for k, v in paths.items():
        print(f"  {k}: {v}")

    # 模拟代理工作树
    agent_dir = os.path.join(paths["agents_dir"], "agent-1")
    os.makedirs(agent_dir, exist_ok=True)

    # 设置面包屑
    write_agent_id(agent_dir, "agent-1")
    write_coral_dir(agent_dir, paths["coral_dir"])

    # 验证面包屑
    coral = get_coral_dir(agent_dir)
    print(f"\\n面包屑发现: {coral}")
    print(f"代理 ID: {Path(agent_dir, '.coral_agent_id').read_text()}")`);

md(`## 5. 权限模型

CORAL 为每个代理配置 Claude Code 的权限，确保：
- 代理**不能**访问 .coral/private/（评分器代码、测试数据）
- 代理**不能**直接运行 git 命令（防止破坏 worktree）
- 代理**可以**读写自己的工作树和共享状态`);

code(`def setup_claude_settings(worktree_path: str, coral_dir: str, research: bool = True):
    """生成 Claude Code 权限配置。"""
    settings = {
        "permissions": {
            "allow": [
                "Bash(*)",
                f"Read({worktree_path}/**)",
                f"Edit({worktree_path}/**)",
                f"Write({worktree_path}/**)",
            ],
            "deny": [
                "Bash(git *)",        # 禁止直接 git 操作
                f"Read(**/private/**)",  # 禁止读取私有目录
            ],
        }
    }
    if research:
        settings["permissions"]["allow"].extend([
            "WebSearch(*)",
            "WebFetch(*)",
        ])
    else:
        settings["permissions"]["deny"].extend([
            "WebSearch(*)",
            "WebFetch(*)",
        ])

    settings_dir = Path(worktree_path) / ".claude"
    settings_dir.mkdir(exist_ok=True)
    (settings_dir / "settings.json").write_text(
        json.dumps(settings, indent=2)
    )
    return settings

# 演示权限配置
with tempfile.TemporaryDirectory() as tmpdir:
    settings = setup_claude_settings(tmpdir, "/fake/coral", research=True)
    print("Claude Code 权限配置：")
    print(json.dumps(settings, indent=2, ensure_ascii=False))`);

md(`## 6. 保存到 our-implementation/`);

code(`import os
impl_dir = os.path.join(os.path.dirname(os.path.abspath(".")), "our-implementation")

workspace_code = '''"""工作空间隔离 - 从零重新实现 coral/workspace/"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path


def create_agent_worktree(repo_dir: str, agent_id: str, agents_dir: str) -> Path:
    """为代理创建 git worktree。"""
    wt_path = Path(agents_dir) / agent_id
    if wt_path.exists():
        return wt_path
    branch = f"coral/{agent_id}"
    subprocess.run(
        ["git", "-C", repo_dir, "worktree", "add", str(wt_path), "-b", branch],
        capture_output=True, check=True,
    )
    return wt_path


def setup_shared_state(worktree_path: str, coral_dir: str, shared_dir_name: str = ".claude"):
    wt = Path(worktree_path)
    shared = wt / shared_dir_name
    shared.mkdir(exist_ok=True)
    public_dir = Path(coral_dir) / "public"
    for name in ["notes", "skills", "attempts", "logs", "heartbeat"]:
        link = shared / name
        target = public_dir / name
        if not link.exists() and target.exists():
            try:
                os.symlink(os.path.relpath(target, link.parent), link)
            except OSError:
                pass


def write_agent_id(worktree_path: str, agent_id: str):
    Path(worktree_path, ".coral_agent_id").write_text(agent_id)


def write_coral_dir(worktree_path: str, coral_dir: str):
    Path(worktree_path, ".coral_dir").write_text(str(Path(coral_dir).resolve()))


def get_coral_dir(worktree_path: str) -> Path | None:
    breadcrumb = Path(worktree_path) / ".coral_dir"
    if breadcrumb.exists():
        try:
            return Path(breadcrumb.read_text().strip()).resolve()
        except (OSError, ValueError):
            pass
    return None


def setup_claude_settings(worktree_path: str, coral_dir: str, research: bool = True):
    settings = {"permissions": {
        "allow": ["Bash(*)", f"Read({worktree_path}/**)", f"Edit({worktree_path}/**)", f"Write({worktree_path}/**)"],
        "deny": ["Bash(git *)", "Read(**/private/**)"],
    }}
    if research:
        settings["permissions"]["allow"].extend(["WebSearch(*)", "WebFetch(*)"])
    settings_dir = Path(worktree_path) / ".claude"
    settings_dir.mkdir(exist_ok=True)
    (settings_dir / "settings.json").write_text(json.dumps(settings, indent=2))
'''

with open(os.path.join(impl_dir, "workspace.py"), "w", encoding="utf-8") as f:
    f.write(workspace_code)
print(f"已保存到 {os.path.join(impl_dir, 'workspace.py')}")`);

md(`## 源码映射表

| 我们的实现 | 原始源码 | 说明 |
|-----------|---------|------|
| create_project_structure | \`coral/workspace/project.py:create_project()\` | 简化版，省略了 repo 克隆和 seed 文件 |
| create_agent_worktree | \`coral/workspace/worktree.py:create_agent_worktree()\` | 核心一致 |
| setup_shared_state | \`coral/workspace/worktree.py:setup_shared_state()\` | 相对符号链接一致 |
| setup_claude_settings | \`coral/workspace/worktree.py:setup_claude_settings()\` | 简化版权限模型 |
| write_coral_dir / get_coral_dir | \`coral/workspace/worktree.py\` | 完全一致的面包屑机制 |

### 关键发现

1. **Git Worktree 是隔离的核心** —— 共享 .git，独立工作目录和分支。
2. **相对符号链接** —— 使项目可移植（不依赖绝对路径）。
3. **面包屑文件** —— .coral_dir 避免了 worktree 内部硬编码路径。
4. **权限沙箱** —— 代理不能 git、不能读私有文件，只能通过 coral eval 提交。
5. **每 worktree 独立 venv** —— UV_PROJECT_ENVIRONMENT 防止并发包安装冲突。

---

**上一章**: [04-hub-shared-state.ipynb](04-hub-shared-state.ipynb)
**下一章**: [06-eval-pipeline.ipynb](06-eval-pipeline.ipynb) —— 实现评估流水线。`);

const notebook = { nbformat: 4, nbformat_minor: 5, metadata: { kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' }, language_info: { name: 'python', version: '3.11.0' } }, cells: cells };
const output = JSON.stringify(notebook, null, 1);
fs.writeFileSync('G:/agents/opensouce_proj/CORAL/CORAL-from-scratch/notebooks/05-workspace-isolation.ipynb', output);
console.log(`Cells: ${cells.length}  Size: ${output.length} bytes`);
