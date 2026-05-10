const fs = require('fs');
const cells = [];
function md(source) { cells.push({ cell_type: 'markdown', metadata: {}, source: source.split('\n').map((l, i, a) => i < a.length - 1 ? l + '\n' : l) }); }
function code(source) { cells.push({ cell_type: 'code', metadata: {}, source: source.split('\n').map((l, i, a) => i < a.length - 1 ? l + '\n' : l), outputs: [], execution_count: null }); }

// Use a helper to safely insert backticks in template literals
const BT = '`';
const BT3 = '```';

md(`# 第七章：代理运行时与管理器

> 代理是 CORAL 的「工人」。本章实现代理的生命周期管理：启动、监控、心跳、自动重启。

## 本章内容

- AgentRuntime 协议：如何启动不同运行时（Claude Code / Codex / OpenCode）
- AgentHandle：进程句柄与生命周期（alive / stop / interrupt）
- HeartbeatAction 与 HeartbeatRunner：周期性反射与高原检测
- AgentManager：多代理编排循环
- CORAL.md 模板生成

> Source: ${BT}coral/agent/runtime.py${BT}, ${BT}coral/agent/manager.py${BT}, ${BT}coral/agent/heartbeat.py${BT}, ${BT}coral/template/coral_md.py${BT}`);

md(`## 1. 痛点：手动管理多个代理子进程

假设你手动启动 4 个 Claude Code 进程：
- 进程 1 跑了 200 轮退出了 —— 谁来重启？
- 进程 2 连续 5 次没改进 —— 谁来提醒它换方向？
- 进程 3 提交了好成绩 —— 谁来告诉它「干得好，继续」？
- 进程 4 崩溃了 —— 谁来清理资源？

你需要一个**管理器**（AgentManager）来：
1. 启动所有代理
2. 监控健康状态
3. 在合适的时机**中断并注入反馈**（心跳）
4. 自动重启死掉的代理
5. 优雅关闭所有进程`);

md(`## 2. 代理运行时协议（AgentRuntime Protocol）

${BT3}mermaid
flowchart TB
    subgraph "AgentRuntime Protocol"
        START["start(worktree, model, ...)"]
        EXTRACT["extract_session_id(log)"]
        INST["instruction_filename"]
        SHARED["shared_dir_name"]
    end

    subgraph "具体实现"
        CC["ClaudeCodeRuntime<br/>.claude / CLAUDE.md"]
        CX["CodexRuntime<br/>.codex / AGENTS.md"]
        OC["OpenCodeRuntime<br/>.opencode / AGENTS.md"]
    end

    START --> CC & CX & OC
${BT3}

关键：AgentRuntime 是一个 Protocol（鸭子类型），不同的 AI 编码工具只需实现同一套接口。`);

code(`import json
import os
import signal
import subprocess
import threading
import time
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Protocol, runtime_checkable, IO

sys_path_setup = os.path.join(os.path.dirname(os.path.abspath(".")), "our-implementation")
import sys
sys.path.insert(0, sys_path_setup)


# === AgentRuntime Protocol ===

@runtime_checkable
class AgentRuntime(Protocol):
    """所有代理运行时必须实现的协议。"""

    def start(
        self,
        worktree_path: Path,
        coral_md_path: Path,
        model: str = "sonnet",
        runtime_options: dict[str, Any] | None = None,
        max_turns: int = 200,
        log_dir: Path | None = None,
        verbose: bool = False,
        resume_session_id: str | None = None,
        prompt: str | None = None,
        prompt_source: str | None = None,
        task_name: str | None = None,
        task_description: str | None = None,
        gateway_url: str | None = None,
        gateway_api_key: str | None = None,
    ) -> "AgentHandle": ...

    def extract_session_id(self, log_path: Path) -> str | None: ...

    @property
    def instruction_filename(self) -> str: ...

    @property
    def shared_dir_name(self) -> str: ...


print("AgentRuntime Protocol 定义完成。")
print("关键属性：")
print("  - instruction_filename: CLAUDE.md / AGENTS.md")
print("  - shared_dir_name: .claude / .codex / .opencode")
print("  - start() -> AgentHandle: 启动子进程")
print("  - extract_session_id(): 从日志提取会话 ID（用于恢复）")`);

md(`## 3. AgentHandle：进程句柄

AgentHandle 包装了 ${BT}subprocess.Popen${BT}，提供三个关键操作：

| 方法 | 作用 | 信号 |
|------|------|------|
| ${BT}alive${BT} | 检查进程是否存活 | poll() |
| ${BT}stop()${BT} | 强制停止 | SIGTERM → SIGKILL |
| ${BT}interrupt()${BT} | 优雅中断（保存会话） | SIGINT → SIGTERM → SIGKILL |

${BT3}mermaid
stateDiagram-v2
    [*] --> Running: start()
    Running --> Running: alive=True
    Running --> Interrupted: interrupt() / SIGINT
    Interrupted --> Stopped: 进程退出
    Interrupted --> ForceKilled: 超时 → SIGKILL
    Running --> Stopped: stop() / SIGTERM
    Stopped --> [*]: 清理资源
    ForceKilled --> [*]: 清理资源
${BT3}

关键设计：**interrupt() 发送 SIGINT**（等同 Ctrl+C），Claude Code 收到后会保存会话状态，之后可以用 ${BT}--resume${BT} 恢复。`);

code(`@dataclass
class AgentHandle:
    """运行中的代理子进程句柄。"""

    agent_id: str
    process: subprocess.Popen | None
    worktree_path: Path
    log_path: Path
    session_id: str | None = None
    _log_file: object | None = None

    @property
    def alive(self) -> bool:
        """进程是否仍在运行。"""
        if self.process is None:
            return False
        return self.process.poll() is None

    def _close_pipes(self) -> None:
        """关闭 stdout/stderr 防止文件描述符泄漏。"""
        if self.process:
            for pipe in (self.process.stdout, self.process.stderr):
                if pipe:
                    try:
                        pipe.close()
                    except Exception:
                        pass

    def stop(self) -> None:
        """强制停止代理进程。SIGTERM → 等待 → SIGKILL。"""
        if self.process and self.alive:
            pid = self.process.pid
            # 先发 SIGTERM
            self.process.terminate()
            try:
                self.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                # 超时则 SIGKILL
                self.process.kill()
                self.process.wait(timeout=5)
        self._close_pipes()
        if self._log_file:
            try:
                self._log_file.close()
            except Exception:
                pass

    def interrupt(self) -> str | None:
        """优雅中断：SIGINT 让 Claude Code 保存会话，返回 session_id。"""
        if not self.process or not self.alive:
            return _extract_session_id(self.log_path)

        pid = self.process.pid
        # 发送 SIGINT（Ctrl+C）
        self.process.send_signal(signal.SIGINT)

        try:
            self.process.wait(timeout=15)
        except subprocess.TimeoutExpired:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait()

        self._close_pipes()
        if self._log_file:
            try:
                self._log_file.close()
            except Exception:
                pass

        return _extract_session_id(self.log_path)


def _extract_session_id(log_path: Path) -> str | None:
    """从 NDJSON 日志中提取 session_id（从尾部扫描）。"""
    try:
        lines = log_path.read_text().strip().splitlines()
        # 优先找 result 行（最权威）
        for line in reversed(lines):
            line = line.strip()
            if not line:
                continue
            try:
                data = json.loads(line)
                if data.get("type") == "result" and data.get("session_id"):
                    return data["session_id"]
            except json.JSONDecodeError:
                continue
        # 退而求其次：任何含 session_id 的行
        for line in reversed(lines):
            try:
                data = json.loads(line.strip())
                sid = data.get("session_id")
                if sid:
                    return sid
            except (json.JSONDecodeError, AttributeError):
                continue
    except Exception:
        pass
    return None


def write_coral_log_entry(
    log_file: IO[str],
    prompt: str,
    source: str,
    agent_id: str,
    session_id: str | None = None,
) -> None:
    """写入 CORAL 提示条目到日志（NDJSON 格式）。"""
    entry = {
        "type": "coral",
        "subtype": "prompt",
        "source": source,
        "agent_id": agent_id,
        "prompt": prompt,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    if session_id:
        entry["session_id"] = session_id
    log_file.write(json.dumps(entry) + "\\n")
    log_file.flush()


# === 演示 ===
import tempfile

with tempfile.TemporaryDirectory() as tmpdir:
    # 模拟一个日志文件
    log_path = Path(tmpdir) / "agent-1.log"
    log_path.write_text(
        json.dumps({"type": "system", "session_id": "sess-abc123"}) + "\\n"
        + json.dumps({"type": "result", "session_id": "sess-abc123", "cost": 0.5}) + "\\n"
    )

    sid = _extract_session_id(log_path)
    print(f"提取的 session_id: {sid}")
    assert sid == "sess-abc123"

    # 模拟写入日志
    with open(Path(tmpdir) / "agent-1.coral.log", "w") as f:
        write_coral_log_entry(f, "你好", "start", "agent-1")
    content = (Path(tmpdir) / "agent-1.coral.log").read_text()
    entry = json.loads(content.strip())
    print(f"日志条目: type={entry['type']}, source={entry['source']}")

print("AgentHandle 和日志工具实现完成！")`);

md(`## 4. 心跳系统（Heartbeat）

心跳是 CORAL 的「教练机制」—— 定期中断代理，注入反思和策略调整的提示。

### 两种触发模式

| 模式 | 触发条件 | 用途 |
|------|---------|------|
| interval | 每 N 次评估 | reflect（每次）, consolidate（每 10 次全局） |
| plateau | 连续 N 次无改进 | pivot（换方向） |

${BT3}mermaid
flowchart LR
    subgraph "interval 模式"
        E1["eval #1"] --> E2["eval #2"] --> E3["eval #3"]
        E3 -->|"every=3"| R1["触发 reflect"]
    end

    subgraph "plateau 模式"
        P1["改进!"] --> P2["无改进 #1"] --> P3["无改进 #2"]
        P3 --> P4["无改进 #3"] --> P5["无改进 #4"]
        P5 -->|"every=5, 还没到"| P6["无改进 #5"]
        P6 -->|"every=5, 触发!"| PIV["触发 pivot"]
    end
${BT3}

### plateau 的冷却机制

pivot 触发后不会每次都重新触发，而是有**冷却期**（cooldown = every）。只有当：
1. 连续无改进次数 >= every，且
2. 距离上次触发又过了 every 次

才会再次触发。`);

code(`@dataclass
class HeartbeatAction:
    """一个注册的心跳动作。"""
    name: str           # reflect / consolidate / pivot
    every: int          # 间隔（interval）或停滞阈值（plateau）
    prompt: str         # 注入给代理的提示文本
    is_global: bool = False    # True = 用全局计数器
    trigger: str = "interval"  # interval 或 plateau


class HeartbeatRunner:
    """检查所有注册的心跳动作是否应该触发。"""

    def __init__(self, actions: list[HeartbeatAction]) -> None:
        self.actions = actions
        self._plateau_fired_at: dict[str, int] = {}

    def check(
        self,
        *,
        local_eval_count: int,
        global_eval_count: int,
        evals_since_improvement: int = 0,
    ) -> list[HeartbeatAction]:
        """返回所有应触发的动作列表。"""
        triggered = []
        for action in self.actions:
            if action.trigger == "plateau":
                if self._check_plateau(action, evals_since_improvement):
                    triggered.append(action)
            else:
                count = global_eval_count if action.is_global else local_eval_count
                if count > 0 and count % action.every == 0:
                    triggered.append(action)
        return triggered

    def _check_plateau(self, action: HeartbeatAction, evals_since_improvement: int) -> bool:
        """检查 plateau 动作是否应触发（含冷却机制）。"""
        if evals_since_improvement < action.every:
            if evals_since_improvement == 0:
                self._plateau_fired_at.pop(action.name, None)
            return False

        last_fired = self._plateau_fired_at.get(action.name)
        if last_fired is not None:
            if evals_since_improvement - last_fired < action.every:
                return False

        self._plateau_fired_at[action.name] = evals_since_improvement
        return True


# === 演示心跳触发 ===
runner = HeartbeatRunner([
    HeartbeatAction(name="reflect", every=1, prompt="回顾上次评估"),
    HeartbeatAction(name="consolidate", every=3, prompt="整理笔记", is_global=True),
    HeartbeatAction(name="pivot", every=5, prompt="换方向", trigger="plateau"),
])

print("=== interval 模式测试 ===")
for i in range(1, 7):
    actions = runner.check(local_eval_count=i, global_eval_count=i, evals_since_improvement=0)
    names = [a.name for a in actions]
    print(f"  eval #{i}: 触发 {names}")

print("\\n=== plateau 模式测试 ===")
# 模拟：前 3 次有改进，后 7 次无改进
improvements = [0, 0, 0, 1, 2, 3, 4, 5, 6, 7]
for i, stall in enumerate(improvements):
    actions = runner.check(local_eval_count=i+1, global_eval_count=i+1, evals_since_improvement=stall)
    names = [a.name for a in actions]
    if "pivot" in names:
        print(f"  eval #{i+1} (stall={stall}): 触发 {names} <- pivot!")
    elif names:
        print(f"  eval #{i+1} (stall={stall}): 触发 {names}")

print("\\n心跳系统实现完成！")`);

md(`## 5. CORAL.md 模板生成

每个代理在启动时会获得一份 **CORAL.md** 文件，包含：

1. 任务描述
2. 工作流程（research -> plan -> edit -> eval -> repeat）
3. CLI 命令参考
4. 共享状态说明
5. 心跳动作提醒
6. 代理身份标识

模板使用 Python ${BT}str.format()${BT} 进行变量替换。`);

code(`BT = chr(96)  # backtick character

def generate_coral_md(
    task_name: str,
    task_description: str,
    agent_id: str,
    files: list[str] | None = None,
    tips: str = "",
    score_direction: str = "higher is better",
    single_agent: bool = False,
    shared_dir: str = ".claude",
    research: bool = True,
) -> str:
    """生成 CORAL.md 代理指令文件。"""
    lines = [f"# Task: {task_name}", "", task_description, ""]

    # Key files
    if files:
        lines.append("## Key Files")
        for f in files:
            lines.append(f"- {BT}{f}{BT}")
        lines.append("")

    # How this works
    lines.append("## How This Works")
    lines.append("")
    if single_agent:
        lines.append(
            f"Edit files and run {BT}coral eval -m description{BT} to evaluate. "
            f"Score: **{score_direction}**."
        )
    else:
        lines.append(
            "You are one of several agents working in parallel. "
            f"Each agent has its own git worktree, sharing a {BT}.coral/{BT} directory."
        )
        lines.append("")
        lines.append(
            f"Run {BT}coral eval -m description{BT} to stage, commit, and grade. "
            f"Score: **{score_direction}**."
        )
    lines.append("")

    # Workflow
    step = 1
    if research:
        lines.append(f"## {step}. Research")
        lines.append("")
        lines.append("Search for techniques and algorithms relevant to the task.")
        lines.append("")
        step += 1

    lines.append(f"## {step}. Plan")
    lines.append("")
    lines.append(f"Decide what to try next. Check {BT}coral log{BT} and {BT}coral notes{BT}.")
    lines.append("")
    step += 1

    lines.append(f"## {step}. Edit")
    lines.append("")
    lines.append("Make focused changes. One idea per eval.")
    lines.append("")
    step += 1

    lines.append(f"## {step}. Evaluate")
    lines.append("")
    lines.append(f"{BT}coral eval -m \\"what you changed and why\\"{BT}")
    lines.append("")
    step += 1

    lines.append(f"## {step}. Share Knowledge")
    lines.append("")
    lines.append(f"Write notes to {BT}{shared_dir}/notes/{BT} and skills to {BT}{shared_dir}/skills/{BT}.")
    lines.append("")

    # Tips
    if tips:
        lines.append("## Tips")
        lines.append(tips)
        lines.append("")

    # Identity
    lines.append("## Your Identity")
    lines.append("")
    lines.append(f"You are **{agent_id}**.")
    lines.append("")

    return "\\n".join(lines)


# === 演示 ===
md_content = generate_coral_md(
    task_name="sort-optimizer",
    task_description="实现一个高效的排序函数，使其在各种输入分布上表现最佳。",
    agent_id="agent-1",
    files=["solution.py", "test_sort.py"],
    tips="考虑 TimSort 对部分有序数据的优势。",
    score_direction="higher is better (0-1 scale)",
    single_agent=False,
    shared_dir=".claude",
)

print("生成的 CORAL.md（前 500 字符）：")
print(md_content[:500])
print(f"\\n总长度: {len(md_content)} 字符")`);

md(`## 6. AgentManager 编排循环

AgentManager 是 CORAL 的「总指挥」，负责：

${BT3}mermaid
flowchart TB
    A["start_all()"] --> B["创建项目目录"]
    B --> C["为每个代理："]
    C --> C1["创建 worktree"]
    C1 --> C2["设置共享状态"]
    C2 --> C3["生成 CORAL.md"]
    C3 --> C4["启动运行时"]
    C4 --> D["monitor_loop()"]

    D --> E{"检查 attempts/"}
    E -->|新 attempt| F["更新计数器"]
    F --> G["检查心跳"]
    G -->|触发| H["interrupt + resume"]

    E -->|无新 attempt| I{"检查存活"}
    I -->|有死进程| J["restart_agent()"]
    I -->|全部存活| K["sleep(5s)"]

    H & J & K --> D
${BT3}

### monitor_loop 的核心逻辑

1. **轮询 attempts/ 目录**：发现新 JSON 文件 = 有代理提交了评估
2. **更新评估计数器**：per-agent + global
3. **跟踪 plateau 状态**：连续无改进次数
4. **检查心跳动作**：哪些应该触发
5. **中断代理并注入反馈**：interrupt() + resume with prompt
6. **自动重启死掉的代理**`);

code(`class AgentManagerDemo:
    """AgentManager 教程简化版。"""

    def __init__(self, agent_count: int = 2):
        self.agent_count = agent_count
        self.handles: list[dict] = []
        self._agent_eval_counts: dict[str, int] = {}
        self._agent_best_scores: dict[str, float] = {}
        self._agent_evals_since_improvement: dict[str, int] = {}
        self._restart_counts: dict[str, int] = {}
        self._running = False

    def start_all(self, work_dir: str) -> list[dict]:
        """模拟启动所有代理。"""
        handles = []
        for i in range(self.agent_count):
            agent_id = f"agent-{i + 1}"
            handle = {
                "agent_id": agent_id,
                "alive": True,
                "worktree": os.path.join(work_dir, agent_id),
                "session_id": f"sess-{agent_id}",
            }
            handles.append(handle)
        self.handles = handles
        self._running = True
        return handles

    def process_new_attempt(self, attempt: dict, global_eval_count: int) -> dict:
        """处理一个新的评估结果 —— monitor_loop 的核心。"""
        agent_id = attempt["agent_id"]
        score = attempt.get("score")
        direction = "maximize"

        # 1. 更新评估计数
        self._agent_eval_counts[agent_id] = self._agent_eval_counts.get(agent_id, 0) + 1
        local_count = self._agent_eval_counts[agent_id]

        # 2. 跟踪 plateau
        minimize = direction == "minimize"
        if score is not None:
            prev_best = self._agent_best_scores.get(agent_id)
            improved = (
                prev_best is None
                or (minimize and score < prev_best)
                or (not minimize and score > prev_best)
            )
            if improved:
                self._agent_best_scores[agent_id] = score
                self._agent_evals_since_improvement[agent_id] = 0
            else:
                self._agent_evals_since_improvement[agent_id] = (
                    self._agent_evals_since_improvement.get(agent_id, 0) + 1
                )
        else:
            self._agent_evals_since_improvement[agent_id] = (
                self._agent_evals_since_improvement.get(agent_id, 0) + 1
            )

        stall = self._agent_evals_since_improvement.get(agent_id, 0)

        # 3. 检查心跳
        runner = HeartbeatRunner([
            HeartbeatAction(name="reflect", every=1, prompt="回顾你上次的方法。"),
            HeartbeatAction(name="consolidate", every=5, prompt="整理所有发现。", is_global=True),
            HeartbeatAction(name="pivot", every=3, prompt="尝试全新方向。", trigger="plateau"),
        ])
        actions = runner.check(
            local_eval_count=local_count,
            global_eval_count=global_eval_count,
            evals_since_improvement=stall,
        )

        return {
            "agent_id": agent_id,
            "local_eval_count": local_count,
            "global_eval_count": global_eval_count,
            "score": score,
            "stall": stall,
            "triggered_actions": [a.name for a in actions],
            "would_interrupt": len(actions) > 0,
        }

    def restart_agent(self, agent_id: str) -> dict:
        """模拟重启一个死掉的代理。"""
        self._restart_counts[agent_id] = self._restart_counts.get(agent_id, 0) + 1
        return {
            "agent_id": agent_id,
            "restart_count": self._restart_counts[agent_id],
            "status": "restarted",
        }


# === 完整 monitor_loop 模拟 ===
manager = AgentManagerDemo(agent_count=2)
manager.start_all("/fake/work")

# 模拟一系列评估事件
attempts = [
    {"agent_id": "agent-1", "score": 0.6, "title": "冒泡排序"},
    {"agent_id": "agent-2", "score": 0.7, "title": "插入排序"},
    {"agent_id": "agent-1", "score": 0.65, "title": "优化冒泡"},       # 改进
    {"agent_id": "agent-1", "score": 0.64, "title": "调整 pivot"},     # 退步
    {"agent_id": "agent-2", "score": 0.68, "title": "调整插入"},       # 退步
    {"agent_id": "agent-1", "score": 0.63, "title": "尝试堆排序"},     # stall=2
    {"agent_id": "agent-1", "score": 0.62, "title": "尝试归并"},       # stall=3, pivot!
    {"agent_id": "agent-2", "score": 0.75, "title": "TimSort"},        # 改进!
]

print("=== Monitor Loop 模拟 ===\\n")
for i, attempt in enumerate(attempts):
    result = manager.process_new_attempt(attempt, global_eval_count=i+1)
    actions_str = ", ".join(result["triggered_actions"]) if result["triggered_actions"] else "无"

    status = ""
    if result["would_interrupt"]:
        status = " -> 中断代理，注入反馈"
    if "pivot" in result["triggered_actions"]:
        status = " -> 中断代理，建议换方向!"

    print(
        f"Eval #{i+1} [{result['agent_id']}] "
        f"score={result['score']} stall={result['stall']} "
        f"触发=[{actions_str}]{status}"
    )

# 模拟代理死亡和重启
print("\\n=== 代理死亡与重启 ===")
restart_result = manager.restart_agent("agent-1")
print(f"{restart_result['agent_id']}: 第 {restart_result['restart_count']} 次重启")`);

md(`## 7. 保存到 our-implementation/`);

code(`impl_dir = os.path.join(os.path.dirname(os.path.abspath(".")), "our-implementation")

runtime_code = """\\"\\"\\"代理运行时与管理器 - 从零重新实现 coral/agent/\\"\\"\\"

from __future__ import annotations

import json
import logging
import os
import signal
import subprocess
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Protocol, runtime_checkable, IO

logger = logging.getLogger(__name__)


# ========== AgentRuntime Protocol ==========

@runtime_checkable
class AgentRuntime(Protocol):
    def start(
        self, worktree_path: Path, coral_md_path: Path,
        model: str = "sonnet", runtime_options: dict[str, Any] | None = None,
        max_turns: int = 200, log_dir: Path | None = None,
        verbose: bool = False, resume_session_id: str | None = None,
        prompt: str | None = None, prompt_source: str | None = None,
        task_name: str | None = None, task_description: str | None = None,
        gateway_url: str | None = None, gateway_api_key: str | None = None,
    ) -> "AgentHandle": ...
    def extract_session_id(self, log_path: Path) -> str | None: ...
    @property
    def instruction_filename(self) -> str: ...
    @property
    def shared_dir_name(self) -> str: ...


# ========== AgentHandle ==========

@dataclass
class AgentHandle:
    agent_id: str
    process: subprocess.Popen | None
    worktree_path: Path
    log_path: Path
    session_id: str | None = None
    _log_file: object | None = None

    @property
    def alive(self) -> bool:
        if self.process is None:
            return False
        return self.process.poll() is None

    def _close_pipes(self) -> None:
        if self.process:
            for pipe in (self.process.stdout, self.process.stderr):
                if pipe:
                    try:
                        pipe.close()
                    except Exception:
                        pass

    def stop(self) -> None:
        if self.process and self.alive:
            self.process.terminate()
            try:
                self.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)
        self._close_pipes()
        if self._log_file:
            try:
                self._log_file.close()
            except Exception:
                pass

    def interrupt(self) -> str | None:
        if not self.process or not self.alive:
            return _extract_session_id(self.log_path)
        self.process.send_signal(signal.SIGINT)
        try:
            self.process.wait(timeout=15)
        except subprocess.TimeoutExpired:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait()
        self._close_pipes()
        if self._log_file:
            try:
                self._log_file.close()
            except Exception:
                pass
        return _extract_session_id(self.log_path)


# ========== Helpers ==========

def _extract_session_id(log_path: Path) -> str | None:
    try:
        lines = log_path.read_text().strip().splitlines()
        for line in reversed(lines):
            try:
                data = json.loads(line.strip())
                if data.get("type") == "result" and data.get("session_id"):
                    return data["session_id"]
            except json.JSONDecodeError:
                continue
        for line in reversed(lines):
            try:
                data = json.loads(line.strip())
                if data.get("session_id"):
                    return data["session_id"]
            except json.JSONDecodeError:
                continue
    except Exception:
        pass
    return None


def write_coral_log_entry(
    log_file: IO[str], prompt: str, source: str, agent_id: str,
    session_id: str | None = None,
) -> None:
    entry = {
        "type": "coral", "subtype": "prompt", "source": source,
        "agent_id": agent_id, "prompt": prompt,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    if session_id:
        entry["session_id"] = session_id
    log_file.write(json.dumps(entry) + "\\\\n")
    log_file.flush()


# ========== Heartbeat ==========

@dataclass
class HeartbeatAction:
    name: str
    every: int
    prompt: str
    is_global: bool = False
    trigger: str = "interval"


class HeartbeatRunner:
    def __init__(self, actions: list[HeartbeatAction]) -> None:
        self.actions = actions
        self._plateau_fired_at: dict[str, int] = {}

    def check(self, *, local_eval_count: int, global_eval_count: int,
              evals_since_improvement: int = 0) -> list[HeartbeatAction]:
        triggered = []
        for action in self.actions:
            if action.trigger == "plateau":
                if self._check_plateau(action, evals_since_improvement):
                    triggered.append(action)
            else:
                count = global_eval_count if action.is_global else local_eval_count
                if count > 0 and count % action.every == 0:
                    triggered.append(action)
        return triggered

    def _check_plateau(self, action: HeartbeatAction, evals_since_improvement: int) -> bool:
        if evals_since_improvement < action.every:
            if evals_since_improvement == 0:
                self._plateau_fired_at.pop(action.name, None)
            return False
        last_fired = self._plateau_fired_at.get(action.name)
        if last_fired is not None:
            if evals_since_improvement - last_fired < action.every:
                return False
        self._plateau_fired_at[action.name] = evals_since_improvement
        return True


# ========== Template ==========

BT = chr(96)

def generate_coral_md(
    task_name: str, task_description: str, agent_id: str,
    files: list[str] | None = None, tips: str = "",
    score_direction: str = "higher is better",
    single_agent: bool = False, shared_dir: str = ".claude",
    research: bool = True,
) -> str:
    lines = [f"# Task: {task_name}", "", task_description, ""]
    if files:
        lines.append("## Key Files")
        for f in files:
            lines.append(f"- {BT}{f}{BT}")
        lines.append("")
    lines.append("## How This Works")
    lines.append("")
    if single_agent:
        lines.append(f"Edit files and run {BT}coral eval -m description{BT}. Score: **{score_direction}**.")
    else:
        lines.append(
            "You are one of several agents working in parallel. "
            f"Run {BT}coral eval -m description{BT} to evaluate. Score: **{score_direction}**."
        )
    lines.append("")
    step = 1
    if research:
        lines.append(f"## {step}. Research")
        lines.append("Search for relevant techniques and algorithms.")
        lines.append("")
        step += 1
    lines.append(f"## {step}. Plan")
    lines.append(f"Check {BT}coral log{BT} and {BT}coral notes{BT}, then decide what to try.")
    lines.append("")
    step += 1
    lines.append(f"## {step}. Edit")
    lines.append("Make focused changes. One idea per eval.")
    lines.append("")
    step += 1
    lines.append(f"## {step}. Evaluate")
    lines.append(f'{BT}coral eval -m "what you changed and why"{BT}')
    lines.append("")
    step += 1
    lines.append(f"## {step}. Share Knowledge")
    lines.append(f"Write notes to {BT}{shared_dir}/notes/{BT} and skills to {BT}{shared_dir}/skills/{BT}.")
    lines.append("")
    if tips:
        lines.append("## Tips")
        lines.append(tips)
        lines.append("")
    lines.append(f"You are **{agent_id}**.")
    return "\\\\n".join(lines)
"""

with open(os.path.join(impl_dir, "runtime.py"), "w", encoding="utf-8") as f:
    f.write(runtime_code)
print(f"已保存到 {os.path.join(impl_dir, 'runtime.py')}")`);

md(`## 源码映射表

| 我们的实现 | 原始源码 | 说明 |
|-----------|---------|------|
| AgentRuntime Protocol | ${BT}coral/agent/runtime.py:19-55${BT} | 完全一致 |
| AgentHandle | ${BT}coral/agent/runtime.py:57-163${BT} | 简化：省略 os.killpg（进程组管理）|
| _extract_session_id | ${BT}coral/agent/runtime.py:198-231${BT} | 完全一致：从尾部扫描 NDJSON |
| write_coral_log_entry | ${BT}coral/agent/runtime.py:166-195${BT} | 简化：省略 task_name/description |
| HeartbeatAction | ${BT}coral/agent/heartbeat.py:8-24${BT} | 完全一致 |
| HeartbeatRunner | ${BT}coral/agent/heartbeat.py:26-79${BT} | 完全一致：interval + plateau |
| generate_coral_md | ${BT}coral/template/coral_md.py:13-96${BT} | 简化：内联模板而非外部文件 |
| AgentManagerDemo | ${BT}coral/agent/manager.py:48-700${BT} | 大幅简化：仅保留 monitor_loop 核心逻辑 |

### 关键发现

1. **SIGINT 保存会话**：Claude Code 收到 SIGINT 后会保存当前会话，可以用 ${BT}--resume${BT} 恢复。这是实现心跳的基础。
2. **从尾部扫描日志**：优先找 ${BT}type=result${BT} 行，退而求其次找任何含 ${BT}session_id${BT} 的行。
3. **plateau 冷却机制**：防止 pivot 动作在每次无改进时都触发，用 cooldown 控制频率。
4. **模板变量替换**：CORAL.md 使用 ${BT}str.format()${BT} 填充任务信息、代理 ID、步骤编号等。
5. **monitor_loop 是事件驱动的**：轮询 attempts/ 目录，发现新文件即处理。

---

**上一章**: [06-eval-pipeline.ipynb](06-eval-pipeline.ipynb)
**下一章**: [08-cli-commands.ipynb](08-cli-commands.ipynb) —— 实现 CLI 命令系统。`);

const notebook = { nbformat: 4, nbformat_minor: 5, metadata: { kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' }, language_info: { name: 'python', version: '3.11.0' } }, cells: cells };
const output = JSON.stringify(notebook, null, 1);
fs.writeFileSync('G:/agents/opensouce_proj/CORAL/CORAL-from-scratch/notebooks/07-agent-runtime.ipynb', output);
console.log(`Cells: ${cells.length}  Size: ${output.length} bytes`);
