const fs = require('fs');
const cells = [];
function md(source) { cells.push({ cell_type: 'markdown', metadata: {}, source: source.split('\n').map((l, i, a) => i < a.length - 1 ? l + '\n' : l) }); }
function code(source) { cells.push({ cell_type: 'code', metadata: {}, source: source.split('\n').map((l, i, a) => i < a.length - 1 ? l + '\n' : l), outputs: [], execution_count: null }); }

const BT = '`';
const BT3 = '```';

md(`# 第九章：全局集成与端到端演示

> 我们已经从零构建了 CORAL 的所有核心模块。本章将它们组装起来，运行一次完整的端到端模拟。

## 本章内容

- 回顾：9 章构建的完整模块清单
- 端到端演示：从配置到评估到排行榜
- 完整架构图
- CORAL 设计哲学总结
- 源码映射总表

> 本章不引入新概念，而是把前 8 章的积木拼装成完整系统。`);

md(`## 1. 全景架构

${BT3}mermaid
flowchart TB
    subgraph "用户层"
        USER["用户 / 任务作者"]
        CONFIG["task.yaml<br/>CoralConfig"]
        CLI["coral CLI<br/>17 条命令"]
    end

    subgraph "编排层"
        MANAGER["AgentManager<br/>monitor_loop()"]
        HEARTBEAT["HeartbeatRunner<br/>interval + plateau"]
        TEMPLATE["CORAL.md<br/>代理指令模板"]
    end

    subgraph "代理层"
        A1["Agent-1<br/>Worktree + Branch"]
        A2["Agent-2<br/>Worktree + Branch"]
        A3["Agent-N<br/>Worktree + Branch"]
    end

    subgraph "评估层"
        EVAL["coral eval<br/>git commit + 评分"]
        GRADER["Grader<br/>multiprocessing 隔离"]
    end

    subgraph "共享层 .coral/public/"
        ATTEMPTS["attempts/<br/>JSON 评估记录"]
        NOTES["notes/<br/>Markdown 笔记"]
        SKILLS["skills/<br/>可复用工具包"]
        LOGS["logs/<br/>NDJSON 日志"]
    end

    USER -->|"coral start -c"| CLI
    CLI --> MANAGER
    CONFIG --> MANAGER
    MANAGER -->|生成| TEMPLATE
    MANAGER -->|启动| A1 & A2 & A3
    TEMPLATE -->|写入| A1 & A2 & A3
    A1 & A2 & A3 -->|"coral eval -m"| EVAL
    EVAL --> GRADER
    GRADER -->|写入| ATTEMPTS
    A1 & A2 & A3 -->|共享| NOTES & SKILLS
    MANAGER -->|监控| ATTEMPTS
    HEARTBEAT -->|中断/恢复| A1 & A2 & A3
${BT3}

### 模块对照表

| 章节 | 模块 | 核心类/函数 | 源文件 |
|------|------|------------|--------|
| 01 | 核心类型 | Task, Score, ScoreBundle, Attempt | ${BT}types_.py${BT} |
| 02 | 配置系统 | CoralConfig, merge_dotlist | ${BT}config.py${BT} |
| 03 | 评分系统 | GraderInterface, BaseGrader, FunctionGrader | ${BT}grader.py${BT} |
| 04 | 共享状态 | write_attempt, read_attempts, list_notes, list_skills | ${BT}hub.py${BT} |
| 05 | 工作空间 | create_agent_worktree, setup_shared_state | ${BT}workspace.py${BT} |
| 06 | 评估流水线 | _git_add_and_commit, _run_grader_with_timeout | ${BT}(notebook inline)${BT} |
| 07 | 代理运行时 | AgentRuntime, AgentHandle, HeartbeatRunner, AgentManagerDemo | ${BT}runtime.py${BT} |
| 08 | CLI 系统 | create_cli_parser, cmd_log, cmd_show, cmd_eval_demo | ${BT}(notebook inline)${BT} |`);

md(`## 2. 端到端模拟

下面我们模拟一次完整的 CORAL 运行流程：

${BT3}
1. 解析配置（第 2 章）
2. 创建项目目录结构（第 5 章）
3. 为每个代理创建评分器（第 3 章）
4. 生成 CORAL.md（第 7 章）
5. 代理循环：修改 → eval → 记录（第 4、6 章）
6. 心跳触发（第 7 章）
7. 查看排行榜（第 8 章）
8. 查看笔记和技能（第 4 章）
${BT3}`);

code(`import json
import os
import sys
import tempfile
import hashlib
from pathlib import Path
from datetime import datetime, timezone

# === 设置导入路径 ===
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(".")), "our-implementation"))

# 导入我们在前 8 章构建的所有模块
from types_ import Task, Score, ScoreBundle, Attempt

print("=== CORAL From Scratch: 端到端集成 ===")
print(f"Python {sys.version}")
print("所有核心类型已导入: Task, Score, ScoreBundle, Attempt")`);

md(`### 2.1 步骤一：解析配置`);

code(`# 第 2 章: CoralConfig
# 在端到端演示中，我们直接构造配置字典（模拟 YAML 解析结果）

config = {
    "task": {
        "name": "sort-optimizer",
        "description": "优化排序算法，在大规模随机数据上达到最高性能分数",
        "files": ["solution.py"],
    },
    "grader": {
        "timeout": 30,
        "direction": "maximize",
    },
    "agents": {
        "count": 3,
        "runtime": "claude_code",
        "model": "sonnet",
    },
    "sharing": {
        "notes": True,
        "skills": True,
        "attempts": True,
    },
    "run": {
        "session": "local",
        "verbose": True,
    },
}

print("配置解析完成:")
print(f"  任务: {config['task']['name']}")
print(f"  代理数: {config['agents']['count']}")
print(f"  优化方向: {config['grader']['direction']}")
print(f"  运行模式: {config['run']['session']}")`);

md(`### 2.2 步骤二：创建项目目录结构`);

code(`# 第 5 章: 工作空间隔离

def create_project(base_dir: str, config: dict) -> dict:
    """创建完整的 CORAL 项目目录结构。"""
    task_name = config["task"]["name"]
    timestamp = datetime.now().strftime("%Y-%m-%dT%H-%M-%S")
    run_dir = Path(base_dir) / "results" / task_name / timestamp

    # .coral 共享目录
    coral_dir = run_dir / ".coral"
    for subdir in ["public/attempts", "public/logs", "public/notes",
                   "public/skills", "public/heartbeat", "private/eval"]:
        (coral_dir / subdir).mkdir(parents=True, exist_ok=True)

    # 配置文件
    (coral_dir / "config.yaml").write_text(json.dumps(config, indent=2, ensure_ascii=False))

    # 代理目录
    agents_dir = run_dir / "agents"
    agents_dir.mkdir(parents=True, exist_ok=True)

    return {
        "run_dir": str(run_dir),
        "coral_dir": str(coral_dir),
        "agents_dir": str(agents_dir),
    }


# 使用临时目录模拟
tmpdir = tempfile.mkdtemp()
paths = create_project(tmpdir, config)

print("项目结构已创建:")
for k, v in paths.items():
    print(f"  {k}: {v}")

# 列出创建的目录
for root, dirs, files in os.walk(paths["coral_dir"]):
    level = root.replace(paths["coral_dir"], "").count(os.sep)
    indent = "  " * level
    print(f"  {indent}{os.path.basename(root)}/")
    for f in files:
        print(f"  {indent}  {f}")`);

md(`### 2.3 步骤三：设置代理工作空间`);

code(`# 第 5 章: Worktree + 面包屑 + 符号链接

def setup_agent_workspace(agent_id: str, coral_dir: str, agents_dir: str) -> dict:
    """为单个代理设置完整的工作空间。"""
    wt_path = Path(agents_dir) / agent_id
    wt_path.mkdir(parents=True, exist_ok=True)

    # 写入面包屑文件
    (wt_path / ".coral_dir").write_text(str(Path(coral_dir).resolve()))
    (wt_path / ".coral_agent_id").write_text(agent_id)

    # 初始代码文件
    (wt_path / "solution.py").write_text(
        "def sort(arr):\\n    return sorted(arr)  # baseline\\n"
    )

    return {
        "agent_id": agent_id,
        "worktree": str(wt_path),
        "coral_dir": (wt_path / ".coral_dir").read_text(),
        "agent_id_file": (wt_path / ".coral_agent_id").read_text(),
    }


# 为每个代理创建工作空间
agent_count = config["agents"]["count"]
agent_workspaces = {}

for i in range(1, agent_count + 1):
    agent_id = f"agent-{i}"
    ws = setup_agent_workspace(agent_id, paths["coral_dir"], paths["agents_dir"])
    agent_workspaces[agent_id] = ws
    print(f"代理 {agent_id} 工作空间已创建:")
    print(f"  路径: {ws['worktree']}")
    print(f"  面包屑: coral_dir={ws['coral_dir'][:40]}...")
    print()`);

md(`### 2.4 步骤四：创建评分器`);

code(`# 第 3 章: 评分系统

import random
random.seed(42)

class SortOptimizerGrader:
    """排序优化评分器 - 模拟评分逻辑。"""

    def __init__(self, direction: str = "maximize"):
        self.direction = direction

    def grade(self, code_content: str) -> ScoreBundle:
        """根据代码内容模拟评分。"""
        # 基于代码复杂度和关键词模拟分数
        base = 0.50
        if "quicksort" in code_content or "quick_sort" in code_content:
            base = 0.80
        if "merge" in code_content:
            base = 0.82
        if "timsort" in code_content or "tim_sort" in code_content:
            base = 0.88
        if "hybrid" in code_content or "introsort" in code_content:
            base = 0.92
        if "cache" in code_content or "branch_predict" in code_content:
            base = 0.95

        # 加一些随机性
        noise = random.uniform(-0.03, 0.03)
        score = max(0, min(1, base + noise))

        return ScoreBundle(
            scores={"performance": Score(value=score, name="performance")},
            aggregated=round(score, 4),
        )


grader = SortOptimizerGrader(direction=config["grader"]["direction"])

# 测试评分器
test_cases = [
    ("def sort(a): return sorted(a)", "baseline"),
    ("def quicksort(a): ...", "quicksort"),
    ("def timsort(a): ...", "timsort"),
    ("def hybrid(a): ... cache ...", "hybrid+cache"),
]

print("评分器测试:")
for code_str, label in test_cases:
    result = grader.grade(code_str)
    print(f"  {label}: score={result.aggregated}")`);

md(`### 2.5 步骤五：生成 CORAL.md`);

code(`# 第 7 章: CORAL.md 模板生成

def generate_coral_md(task_name, task_description, agent_id, direction, files):
    """生成代理指令文件。"""
    bt = chr(96)  # backtick
    bt3 = bt * 3

    return f"""# CORAL - {task_name}

## Task
{task_description}

## How This Works
You are an autonomous coding agent. Your job is to optimize the code to achieve the best possible score.

## Workflow

### 1. Plan
Read the existing code and understand what it does.

### 2. Edit
Make changes to improve the score. Focus on: {', '.join(files)}

### 3. Evaluate
Run {bt}coral eval -m "description of changes"{bt} to submit and score your changes.

### 4. Check Results
Run {bt}coral log{bt} to see the leaderboard.
Direction: **{direction}** ({"higher" if direction == "maximize" else "lower"} is better)

### 5. Share Knowledge
Write notes about your findings in .claude/notes/

## Ground Rules
- Do NOT access .coral/private/
- Do NOT run git commands directly
- Use {bt}coral eval{bt} for all submissions
- Share useful knowledge via notes and skills

## Your Identity
You are **{agent_id}**.
"""

# 为每个代理生成 CORAL.md
for agent_id, ws in agent_workspaces.items():
    coral_md = generate_coral_md(
        config["task"]["name"],
        config["task"]["description"],
        agent_id,
        config["grader"]["direction"],
        config["task"]["files"],
    )
    wt = Path(ws["worktree"])
    (wt / "CORAL.md").write_text(coral_md, encoding="utf-8")
    print(f"{agent_id}: CORAL.md 已生成 ({len(coral_md)} 字符)")

# 展示其中一份
print("\\n--- agent-1 的 CORAL.md（前 15 行）---")
lines = (Path(agent_workspaces["agent-1"]["worktree"]) / "CORAL.md").read_text().splitlines()
for line in lines[:15]:
    print(f"  {line}")`);

md(`### 2.6 步骤六：模拟代理评估循环

这是 CORAL 的核心循环。每个代理独立工作，通过共享目录沟通：`);

code(`# 第 4 章 (Hub) + 第 6 章 (Eval Pipeline) + 第 8 章 (CLI)

from types_ import Attempt

# Hub 函数 - 简化版内联实现
def write_attempt(coral_dir: str, attempt: Attempt) -> None:
    """写入评估记录。"""
    attempts_dir = Path(coral_dir) / "public" / "attempts"
    attempts_dir.mkdir(parents=True, exist_ok=True)
    path = attempts_dir / f"{attempt.commit_hash}.json"
    path.write_text(json.dumps(attempt.to_dict(), indent=2))

def read_attempts(coral_dir: str) -> list:
    """读取所有评估记录。"""
    attempts_dir = Path(coral_dir) / "public" / "attempts"
    results = []
    for f in attempts_dir.glob("*.json"):
        try:
            data = json.loads(f.read_text())
            results.append(Attempt.from_dict(data))
        except (json.JSONDecodeError, KeyError):
            continue
    return results


def simulate_eval(agent_id: str, message: str, code_content: str,
                  coral_dir: str, eval_count: dict) -> Attempt:
    """模拟一次 coral eval 调用。"""
    # 1. 模拟 git commit (生成 hash)
    commit_hash = hashlib.sha1(
        f"{agent_id}{message}{datetime.now().isoformat()}".encode()
    ).hexdigest()[:12]

    # 2. 运行评分器
    result = grader.grade(code_content)
    score = result.aggregated

    # 3. 比较历史最优
    prev = [a for a in read_attempts(coral_dir) if a.agent_id == agent_id]
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

    # 4. 创建 Attempt
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

    # 5. 递增计数器
    eval_count[agent_id] = eval_count.get(agent_id, 0) + 1

    # 6. 打印反馈
    icon = {"improved": "+", "baseline": "=", "regressed": "-"}.get(status, "?")
    print(f"  [{icon}] {agent_id} | {message} | score={score:.4f} | {status}")
    if status == "improved" and prev_best is not None:
        print(f"      New best! Previous: {prev_best:.4f}")

    return attempt


# === 执行模拟 ===
coral_dir = paths["coral_dir"]
eval_count = {}

print("=" * 65)
print("  CORAL 端到端模拟 - sort-optimizer (3 agents)")
print("=" * 65)

# 第 1 轮: 各代理提交 baseline
print("\\n--- 第 1 轮: Baseline ---")
simulate_eval("agent-1", "冒泡排序 baseline", "def sort(a): return sorted(a)", coral_dir, eval_count)
simulate_eval("agent-2", "选择排序 baseline", "def sort(a): return sorted(a)", coral_dir, eval_count)
simulate_eval("agent-3", "插入排序 baseline", "def sort(a): return sorted(a)", coral_dir, eval_count)

# 第 2 轮: 尝试不同策略
print("\\n--- 第 2 轮: 探索 ---")
simulate_eval("agent-1", "实现快速排序", "def quicksort(a): ...", coral_dir, eval_count)
simulate_eval("agent-2", "实现归并排序", "def merge_sort(a): ...", coral_dir, eval_count)
simulate_eval("agent-3", "实现 TimSort", "def timsort(a): ...", coral_dir, eval_count)

# 第 3 轮: 优化
print("\\n--- 第 3 轮: 优化 ---")
simulate_eval("agent-1", "快排 + 随机 pivot", "def quicksort(a): ... random ...", coral_dir, eval_count)
simulate_eval("agent-2", "混合排序策略", "def hybrid(a): ... merge + insert ...", coral_dir, eval_count)
simulate_eval("agent-3", "TimSort + cache 优化", "def timsort(a): ... cache ...", coral_dir, eval_count)

# 第 4 轮: 冲刺
print("\\n--- 第 4 轮: 冲刺 ---")
simulate_eval("agent-1", "Introsort 实现", "def introsort(a): ...", coral_dir, eval_count)
simulate_eval("agent-2", "混合排序 + 分支预测", "def hybrid(a): ... branch_predict ...", coral_dir, eval_count)
simulate_eval("agent-3", "尝试回退到简单方案", "def sort(a): return sorted(a)", coral_dir, eval_count)

print(f"\\n总评估次数: {sum(eval_count.values())}")
for aid, cnt in sorted(eval_count.items()):
    print(f"  {aid}: {cnt} 次评估")`);

md(`### 2.7 步骤七：查看排行榜`);

code(`# 第 8 章: CLI 查询命令

def format_leaderboard(attempts: list) -> str:
    """格式化排行榜。"""
    if not attempts:
        return "No attempts yet."
    lines = ["| Rank | Score  | Agent   | Title                   | Status   | Commit  |",
             "|------|--------|---------|-------------------------|----------|---------|"]
    for i, a in enumerate(attempts, 1):
        score_str = f"{a.score:.4f}" if a.score is not None else "N/A"
        lines.append(f"| {i:4d} | {score_str} | {a.agent_id:7s} | {a.title[:23]:23s} | {a.status:8s} | {a.commit_hash[:7]} |")
    return "\\n".join(lines)


# 排行榜 (coral log)
all_attempts = read_attempts(coral_dir)
scored = [a for a in all_attempts if a.score is not None]
scored.sort(key=lambda a: a.score, reverse=True)

print("=== coral log (排行榜 Top 10) ===\\n")
print(format_leaderboard(scored[:10]))

# 按代理查看 (coral log --agent agent-1)
print("\\n=== coral log --agent agent-2 ===\\n")
agent2 = [a for a in scored if a.agent_id == "agent-2"]
print(format_leaderboard(agent2))

# 搜索 (coral log --search TimSort)
print("\\n=== coral log --search TimSort ===\\n")
search_results = [a for a in all_attempts if "TimSort" in f"{a.title} {a.feedback}"]
print(format_leaderboard(search_results))`);

md(`### 2.8 步骤八：模拟笔记与技能共享`);

code(`# 第 4 章: Notes 和 Skills

# 代理 1 写了一条笔记
notes_dir = Path(coral_dir) / "public" / "notes"
note_content = """---
creator: agent-1
created: 2026-04-05T10:30:00
---
# 快排对已排序数据退化

发现当输入已排序时，快速排序退化到 O(n^2)。
解决方案：使用随机化 pivot 或三数取中法。

Introsort 在检测到递归深度过大时自动切换到堆排序，
是更稳健的选择。
"""
(notes_dir / "quicksort-degradation.md").write_text(note_content, encoding="utf-8")

# 代理 2 写了一条笔记
note_content2 = """---
creator: agent-2
created: 2026-04-05T11:00:00
---
# 混合排序效果最佳

测试发现：对小数组用插入排序，大数组用归并排序的混合策略
分数最高。关键阈值在 32-64 元素之间。

分支预测优化（减少条件跳转）可以额外提升 3-5%。
"""
(notes_dir / "hybrid-sort-best.md").write_text(note_content2, encoding="utf-8")

# 代理 3 创建了一个技能
skills_dir = Path(coral_dir) / "public" / "skills"
skill_dir = skills_dir / "benchmark-suite"
skill_dir.mkdir(parents=True, exist_ok=True)
(skill_dir / "SKILL.md").write_text("""---
name: benchmark-suite
description: 排序算法基准测试工具
creator: agent-3
---
# Benchmark Suite

提供多种数据分布的排序基准测试。

## 使用方法
导入 benchmark.py 中的 run_benchmark() 函数。
""", encoding="utf-8")
(skill_dir / "benchmark.py").write_text(
    "def run_benchmark(sort_func, sizes=[100, 1000, 10000]):\\n"
    "    import time\\n"
    "    for n in sizes:\\n"
    "        data = list(range(n))\\n"
    "        start = time.time()\\n"
    "        sort_func(data.copy())\\n"
    "        print(f'n={n}: {time.time()-start:.4f}s')\\n",
    encoding="utf-8"
)

# 展示共享状态
print("=== 共享笔记 ===")
for f in sorted(notes_dir.glob("*.md")):
    text = f.read_text(encoding="utf-8")
    # 提取标题
    for line in text.splitlines():
        if line.startswith("# "):
            print(f"  [{f.stem}] {line[2:]}")
            break

print("\\n=== 共享技能 ===")
for d in sorted(skills_dir.iterdir()):
    if d.is_dir() and (d / "SKILL.md").exists():
        files = list(d.iterdir())
        print(f"  {d.name}/ ({len(files)} files)")
        for f in sorted(files):
            print(f"    {f.name}")`);

md(`### 2.9 步骤九：心跳触发模拟`);

code(`# 第 7 章: HeartbeatRunner

class HeartbeatAction:
    def __init__(self, name, every, prompt, trigger="interval"):
        self.name = name
        self.every = every
        self.prompt = prompt
        self.trigger = trigger

class HeartbeatRunner:
    """简化版心跳运行器。"""
    def __init__(self, actions):
        self.actions = actions
        self._plateau_count = {}

    def check(self, agent_id, eval_count, is_improved):
        """检查是否需要触发心跳动作。"""
        triggered = []
        for action in self.actions:
            if action.trigger == "interval":
                if eval_count > 0 and eval_count % action.every == 0:
                    triggered.append(action)
            elif action.trigger == "plateau":
                key = f"{agent_id}:{action.name}"
                if not is_improved:
                    self._plateau_count[key] = self._plateau_count.get(key, 0) + 1
                else:
                    self._plateau_count[key] = 0
                if self._plateau_count.get(key, 0) >= action.every:
                    triggered.append(action)
                    self._plateau_count[key] = 0  # cooldown
        return triggered


# 配置心跳
heartbeat = HeartbeatRunner([
    HeartbeatAction("reflect", every=3, prompt="回顾你的策略，总结发现", trigger="interval"),
    HeartbeatAction("pivot", every=2, prompt="你已经停滞，尝试全新方向", trigger="plateau"),
])

# 模拟心跳触发
print("=== 心跳触发模拟 ===\\n")
sim_data = [
    ("agent-3", 1, True),   # eval 1, improved
    ("agent-3", 2, False),  # eval 2, no improve
    ("agent-3", 3, False),  # eval 3, plateau! + interval!
    ("agent-3", 4, True),   # eval 4, improved (reset plateau)
]

for agent_id, ec, improved in sim_data:
    actions = heartbeat.check(agent_id, ec, improved)
    status = "improved" if improved else "no change"
    print(f"  eval #{ec} ({status})")
    if actions:
        for a in actions:
            print(f"    -> 触发 [{a.name}]: {a.prompt}")
    else:
        print(f"    -> (无触发)")`);

md(`## 3. 最终统计`);

code(`# 最终汇总

print("=" * 65)
print("  CORAL 端到端模拟 - 最终报告")
print("=" * 65)

all_attempts = read_attempts(coral_dir)
best = max(all_attempts, key=lambda a: a.score or 0)

print(f"\\n任务: {config['task']['name']}")
print(f"代理数: {config['agents']['count']}")
print(f"总评估次数: {len(all_attempts)}")
print(f"\\n最高分: {best.score:.4f}")
print(f"  代理: {best.agent_id}")
print(f"  方案: {best.title}")
print(f"  提交: {best.commit_hash}")

# 按代理统计
print(f"\\n--- 按代理统计 ---")
for i in range(1, 4):
    aid = f"agent-{i}"
    agent_attempts = [a for a in all_attempts if a.agent_id == aid]
    agent_best = max(agent_attempts, key=lambda a: a.score or 0)
    improved = sum(1 for a in agent_attempts if a.status == "improved")
    print(f"  {aid}: {len(agent_attempts)} 次评估, "
          f"最高 {agent_best.score:.4f} ({agent_best.title}), "
          f"{improved} 次提升")

# 共享知识统计
notes_count = len(list((Path(coral_dir) / "public" / "notes").glob("*.md")))
skills_count = len([d for d in (Path(coral_dir) / "public" / "skills").iterdir() if d.is_dir()])
print(f"\\n--- 共享知识 ---")
print(f"  笔记: {notes_count} 条")
print(f"  技能: {skills_count} 个")

print(f"\\n{'=' * 65}")
print("  模拟完成!")
print(f"{'=' * 65}")`);

md(`## 4. CORAL 设计哲学

通过 9 章的从零构建，我们总结 CORAL 的核心设计思想：

### 4.1 文件系统即数据库

| 传统方案 | CORAL 方案 | 优势 |
|---------|-----------|------|
| SQLite/PostgreSQL | JSON 文件 | 代理可直接读写，无需驱动 |
| 消息队列 | 轮询目录 | 零依赖，崩溃安全 |
| REST API | 符号链接 | 零网络开销 |

### 4.2 Git 作为隔离层

- **Worktree** = 每个代理独立的工作目录
- **Branch** = 每个代理独立的提交历史
- **Commit hash** = 天然的评估记录 ID

### 4.3 代理即黑盒

CORAL 不关心代理内部如何工作，只关心：
- 代理能读 CORAL.md（指令输入）
- 代理能调用 ${BT}coral eval${BT}（评估接口）
- 代理能写文件（笔记/技能输出）

这使得 CORAL 同时支持 Claude Code、Codex、OpenCode 等不同运行时。

### 4.4 竞争 + 协作

${BT3}mermaid
flowchart LR
    subgraph "竞争：排行榜"
        A1["Agent-1<br/>score=0.95"]
        A2["Agent-2<br/>score=0.98"]
        A3["Agent-3<br/>score=0.88"]
    end

    subgraph "协作：共享知识"
        N["Notes: 排序退化问题"]
        S["Skills: benchmark-suite"]
    end

    A1 -->|发现问题| N
    A2 -->|读取笔记| N
    A3 -->|创建工具| S
    A1 & A2 -->|使用工具| S
${BT3}

### 4.5 心跳 = 外部干预

代理会陷入局部最优。心跳机制提供两种干预：
- **定时反思**（interval）：每 N 次评估自动总结
- **停滞检测**（plateau）：连续 N 次无提升时强制换方向`);

md(`## 5. 源码映射总表

| 章节 | 我们的实现 | 原始源码 | 核心差异 |
|------|-----------|---------|---------|
| 01 核心类型 | ${BT}types_.py${BT} | ${BT}coral/types.py${BT} | 完全一致 |
| 02 配置系统 | ${BT}config.py${BT} | ${BT}coral/config.py${BT} | 用 dict 替代 OmegaConf |
| 03 评分系统 | ${BT}grader.py${BT} | ${BT}coral/grader/*.py${BT} | 省略了 loader 动态加载 |
| 04 共享状态 | ${BT}hub.py${BT} | ${BT}coral/hub/*.py${BT} | 核心一致，省略 checkpoint |
| 05 工作空间 | ${BT}workspace.py${BT} | ${BT}coral/workspace/*.py${BT} | 省略了 repo 克隆和 venv |
| 06 评估流水线 | notebook inline | ${BT}coral/hooks/post_commit.py${BT} | 核心一致，简化了 multiprocessing |
| 07 代理运行时 | ${BT}runtime.py${BT} | ${BT}coral/agent/*.py${BT} | 省略了真实子进程管理 |
| 08 CLI 系统 | notebook inline | ${BT}coral/cli/*.py${BT} | 省略了 tmux/docker 真实集成 |
| 09 集成演示 | 本章 | ${BT}coral start -c task.yaml${BT} | 端到端模拟 vs 真实运行 |

### 未覆盖的高级功能

| 功能 | 原始源码 | 说明 |
|------|---------|------|
| LiteLLM Gateway | ${BT}coral/gateway/*.py${BT} | 代理 API 请求代理与监控 |
| Web Dashboard | ${BT}coral/web/*.py${BT} | Starlette + React SPA + SSE 实时更新 |
| Checkpoint | ${BT}coral/hub/checkpoint.py${BT} | .coral/public/.git 版本控制共享状态 |
| Docker 隔离 | ${BT}coral/cli/start.py${BT} | 容器化运行模式 |
| SWE-bench 集成 | ${BT}coral/grader/builtin/swebench.py${BT} | 软件工程基准评测 |`);

md(`## 6. 学习路线建议

### 如果你想使用 CORAL

${BT3}bash
# 1. 安装
pip install coral-ai  # 或 uv sync

# 2. 初始化任务
coral init my-optimization-task

# 3. 编写评分器
# 编辑 my-optimization-task/grader.py

# 4. 启动代理
coral start -c my-optimization-task/task.yaml agents.count=4

# 5. 监控
coral status    # 代理状态
coral log       # 排行榜
coral ui        # Web 界面
${BT3}

### 如果你想深入源码

按以下顺序阅读（对应本教程的章节顺序）：

1. ${BT}coral/types.py${BT} → 核心数据结构
2. ${BT}coral/config.py${BT} → 配置如何加载
3. ${BT}coral/grader/${BT} → 评分器如何工作
4. ${BT}coral/hub/${BT} → 共享状态如何存储
5. ${BT}coral/workspace/${BT} → 代理隔离如何实现
6. ${BT}coral/hooks/post_commit.py${BT} → 评估流水线（最核心的 268 行）
7. ${BT}coral/agent/${BT} → 代理生命周期管理
8. ${BT}coral/cli/${BT} → 用户交互界面
9. ${BT}coral/web/${BT} → 可视化监控

### 如果你想贡献代码

- 添加新的评分器类型：继承 ${BT}BaseGrader${BT}
- 支持新的代理运行时：实现 ${BT}AgentRuntime${BT} Protocol
- 改进心跳策略：修改 ${BT}HeartbeatRunner.check()${BT}
- 添加新的 CLI 命令：在 ${BT}coral/cli/__init__.py${BT} 注册

---

**恭喜！** 你已经从零构建了 CORAL 的核心系统。

从第零章的「为什么需要 CORAL」到本章的端到端演示，我们覆盖了：
- **9 个模块**、**~1500 行 Python 代码**
- **17 个 CLI 命令** 的架构设计
- **多代理竞争 + 协作** 的完整机制

CORAL 的精髓在于一个简洁的循环：

**生成代理 → 代理读取 CORAL.md → 提交更改 → 评估运行 → 共享知识 → 循环**

这个循环让多个 AI 代理像一个优化团队一样并行工作，不断逼近最优解。`);

const notebook = { nbformat: 4, nbformat_minor: 5, metadata: { kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' }, language_info: { name: 'python', version: '3.11.0' } }, cells: cells };
const output = JSON.stringify(notebook, null, 1);
fs.writeFileSync('G:/agents/opensouce_proj/CORAL/CORAL-from-scratch/notebooks/09-full-integration.ipynb', output);
console.log(`Cells: ${cells.length}  Size: ${output.length} bytes`);
