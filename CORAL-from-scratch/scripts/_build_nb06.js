const fs = require('fs');
const cells = [];
function md(source) { cells.push({ cell_type: 'markdown', metadata: {}, source: source.split('\n').map((l, i, a) => i < a.length - 1 ? l + '\n' : l) }); }
function code(source) { cells.push({ cell_type: 'code', metadata: {}, source: source.split('\n').map((l, i, a) => i < a.length - 1 ? l + '\n' : l), outputs: [], execution_count: null }); }

md(`# 第六章：评估流水线

> 评估流水线是连接「代理编码」和「分数反馈」的桥梁。本章实现完整的 commit → grade → record 流程。

## 本章内容

- git add + commit 自动化
- 评分器子进程隔离（multiprocessing）
- 分数比较与状态判定
- Attempt 记录写入
- 全局评估计数器

> Source: \`coral/hooks/post_commit.py\``);

md(`## 1. 痛点：手动串联各环节

代理每次想要评估，需要手动执行：
1. \`git add -A\`
2. \`git commit -m "..."\`
3. 运行评分器
4. 比较历史最优
5. 记录结果
6. 打印反馈

\`coral eval -m "描述"\` 一条命令完成所有步骤。`);

md(`## 2. 评估流水线流程

\`\`\`mermaid
flowchart TB
    A[coral eval -m 描述] --> B[git add -A]
    B --> C[git commit -m 描述]
    C --> D[获取 commit hash]
    D --> E[加载评分器]
    E --> F{子进程评分<br/>有超时？}
    F -->|是| G[multiprocessing<br/>+ timeout]
    F -->|否| H[直接运行]
    G --> I{结果}
    H --> I
    I -->|成功| J[比较历史最优]
    I -->|超时| K[status=timeout]
    I -->|崩溃| L[status=crashed]
    J --> M{improved?}
    M -->|更好| N[status=improved]
    M -->|相同| O[status=baseline]
    M -->|更差| P[status=regressed]
    N & O & P & K & L --> Q[写入 Attempt JSON]
    Q --> R[递增全局计数器]
\`\`\``);

code(`import json
import subprocess
import multiprocessing
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
import sys, os, tempfile, asyncio

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(".")), "our-implementation"))
from types_ import Attempt, Task, Score, ScoreBundle
from hub import write_attempt, read_attempts, get_agent_attempts


def _git_add_and_commit(message: str, workdir: str) -> str:
    """暂存所有更改并提交。返回新的 commit hash。"""
    # 暂存
    result = subprocess.run(["git", "add", "-A"], capture_output=True, text=True, cwd=workdir)
    if result.returncode != 0:
        raise RuntimeError(f"git add 失败: {result.stderr}")

    # 检查是否有内容可提交
    status = subprocess.run(["git", "diff", "--cached", "--quiet"], capture_output=True, cwd=workdir)
    if status.returncode == 0:
        raise RuntimeError("没有变更可提交。")

    # 提交
    result = subprocess.run(["git", "commit", "-m", message], capture_output=True, text=True, cwd=workdir)
    if result.returncode != 0:
        raise RuntimeError(f"git commit 失败: {result.stderr}")

    # 获取 commit hash
    result = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True, cwd=workdir)
    return result.stdout.strip()


def _get_parent_hash(commit_hash: str, cwd: str) -> str | None:
    """获取父提交 hash。"""
    result = subprocess.run(
        ["git", "log", "--format=%P", "-n", "1", commit_hash],
        capture_output=True, text=True, cwd=cwd,
    )
    if result.returncode == 0 and result.stdout.strip():
        return result.stdout.strip().split()[0]
    return None


def _increment_eval_count(coral_dir: Path) -> int:
    """递增并返回全局评估计数器。"""
    counter_file = coral_dir / "public" / "eval_count"
    count = 0
    if counter_file.exists():
        try:
            count = int(counter_file.read_text().strip())
        except ValueError:
            pass
    count += 1
    counter_file.write_text(str(count))
    return count


print("Git 操作辅助函数定义完成。")
print("关键：_git_add_and_commit 先检查 diff --cached --quiet 确保有内容可提交。")`);

md(`## 3. 多进程评分隔离

### 为什么用 multiprocessing 而不是直接调用？

评分器可能包含：
- NumPy/SciPy 等 C 扩展（asyncio.wait_for 无法中断）
- 动态导入的模块（不可 pickle）
- 无限循环的用户代码

解决方案：在**子进程**中重新加载评分器并运行，主进程可以硬杀超时的子进程。`);

code(`def _grader_worker(grader_func, codebase_path, tasks, result_queue):
    """子进程工作函数。在子进程内重新运行评分。"""
    try:
        # 在实际 CORAL 中，这里从 config 重新加载评分器
        # 避免 pickle 动态导入的模块
        result = grader_func(codebase_path, tasks)
        result_queue.put(("ok", result))
    except Exception as e:
        result_queue.put(("error", e, traceback.format_exc()))


def _run_grader_with_timeout(grader_func, codebase_path, tasks, timeout):
    """在子进程中运行评分器，带硬超时。"""
    if timeout <= 0:
        # 无超时 - 直接运行
        return grader_func(codebase_path, tasks)

    result_queue = multiprocessing.Queue()
    proc = multiprocessing.Process(
        target=_grader_worker,
        args=(grader_func, codebase_path, tasks, result_queue),
    )
    try:
        proc.start()
        proc.join(timeout=timeout)

        if proc.is_alive():
            proc.kill()  # 硬杀超时进程
            proc.join(timeout=5)
            raise TimeoutError(f"评分器超时（{timeout}秒）")

        if result_queue.empty():
            raise RuntimeError("评分器进程退出但没有返回结果")

        status, *payload = result_queue.get_nowait()
        if status == "ok":
            return payload[0]
        else:
            exc, tb_str = payload
            raise RuntimeError(f"评分器失败: {exc}\\n{tb_str}")
    finally:
        result_queue.close()
        result_queue.join_thread()
        proc.close()


# 演示超时保护
def slow_grader(path, tasks):
    import time
    time.sleep(100)  # 模拟挂死
    return 1.0

def fast_grader(path, tasks):
    return ScoreBundle(scores={"eval": Score(value=0.85, name="eval")}, aggregated=0.85)

# 快速评分器正常返回
result = _run_grader_with_timeout(fast_grader, "/fake", [], timeout=5)
print(f"快速评分器: {result.aggregated}")

# 超时评分器被硬杀（取消注释可测试，但会等 2 秒）
# try:
#     _run_grader_with_timeout(slow_grader, "/fake", [], timeout=2)
# except TimeoutError as e:
#     print(f"超时: {e}")
print("多进程评分隔离实现完成！")`);

md(`## 4. 完整评估流程 run_eval()`);

code(`def run_eval_demo(message: str, agent_id: str, coral_dir: str,
                   workdir: str, grader_func, direction: str = "maximize") -> Attempt:
    """评估流水线的核心函数（教程简化版）。"""
    coral_path = Path(coral_dir)

    # 1. Git add + commit
    commit_hash = _git_add_and_commit(message, workdir)
    parent_hash = _get_parent_hash(commit_hash, workdir)

    # 2. 运行评分器
    task = Task(id="demo", name="demo", description="演示任务")
    try:
        result = grader_func(workdir, [task])
        score = result.aggregated if isinstance(result, ScoreBundle) else float(result)

        # 3. 比较历史最优
        prev_attempts = get_agent_attempts(coral_dir, agent_id)
        prev_scores = [a.score for a in prev_attempts if a.score is not None]
        minimize = direction == "minimize"
        prev_best = (min(prev_scores) if minimize else max(prev_scores)) if prev_scores else None

        if prev_best is None:
            status = "improved"
        elif minimize and score < prev_best:
            status = "improved"
        elif not minimize and score > prev_best:
            status = "improved"
        elif score == prev_best:
            status = "baseline"
        else:
            status = "regressed"

        feedback = f"Score: {score}"

    except TimeoutError:
        score, status, feedback = None, "timeout", "评估超时"
    except Exception as e:
        score, status, feedback = None, "crashed", str(e)

    # 4. 创建并保存 Attempt
    attempt = Attempt(
        commit_hash=commit_hash,
        agent_id=agent_id,
        title=message,
        score=score,
        status=status,
        parent_hash=parent_hash,
        timestamp=datetime.now(timezone.utc).isoformat(),
        feedback=feedback,
    )
    write_attempt(coral_dir, attempt)

    # 5. 递增计数器
    eval_count = _increment_eval_count(coral_path)
    print(f"Eval #{eval_count}: [{status}] score={score} commit={commit_hash[:7]}")

    return attempt


# === 完整演示 ===
with tempfile.TemporaryDirectory() as tmpdir:
    repo = os.path.join(tmpdir, "repo")
    coral_dir = os.path.join(tmpdir, "coral")
    os.makedirs(os.path.join(coral_dir, "public", "attempts"), exist_ok=True)
    os.makedirs(os.path.join(coral_dir, "public"), exist_ok=True)

    # 初始化 git
    subprocess.run(["git", "init", repo], capture_output=True)
    subprocess.run(["git", "-C", repo, "config", "user.email", "test@test.com"], capture_output=True)
    subprocess.run(["git", "-C", repo, "config", "user.name", "test"], capture_output=True)
    subprocess.run(["git", "-C", repo, "commit", "--allow-empty", "-m", "init"], capture_output=True)

    # 模拟 3 次评估
    def mock_grader(path, tasks):
        scores = [0.6, 0.9, 0.85]
        idx = len(list(Path(os.path.join(tmpdir, "coral", "public", "attempts")).glob("*.json")))
        s = scores[min(idx, len(scores)-1)]
        return ScoreBundle(scores={"eval": Score(value=s, name="eval")}, aggregated=s)

    for i, desc in enumerate(["冒泡排序", "快速排序", "优化 pivot 选择"]):
        Path(os.path.join(repo, f"v{i}.py")).write_text(f"# version {i}")
        attempt = run_eval_demo(desc, "agent-1", coral_dir, repo, mock_grader)

    print(f"\\n最终状态: {attempt.status}")
    print(f"评估链: {attempt.parent_hash} -> {attempt.commit_hash[:7]}")`);

md(`## 源码映射表

| 我们的实现 | 原始源码 | 说明 |
|-----------|---------|------|
| _git_add_and_commit | \`coral/hooks/post_commit.py:22-53\` | 完全一致 |
| _get_parent_hash | \`coral/hooks/post_commit.py:56-64\` | 完全一致 |
| _increment_eval_count | \`coral/hooks/post_commit.py:67-78\` | 完全一致 |
| _grader_worker | \`coral/hooks/post_commit.py:81-94\` | 简化：省略了从 config 重新加载 |
| _run_grader_with_timeout | \`coral/hooks/post_commit.py:97-139\` | 核心逻辑一致 |
| run_eval_demo | \`coral/hooks/post_commit.py:153-268\` | 简化：省略了 checkpoint 和 config 加载 |

### 关键发现

1. **multiprocessing 而非 asyncio**：可以硬杀 C 扩展代码（NumPy 等），asyncio 做不到。
2. **子进程内重新加载评分器**：避免 pickle 动态导入模块的问题。
3. **状态判定逻辑**：首次=improved，更好=improved，相同=baseline，更差=regressed。
4. **面包屑发现机制**：run_eval 通过 .coral_dir 文件找到共享目录，无需传参。
5. **eval_count 全局计数器**：纯文本文件，用于触发心跳动作。

---

**上一章**: [05-workspace-isolation.ipynb](05-workspace-isolation.ipynb)
**下一章**: [07-agent-runtime.ipynb](07-agent-runtime.ipynb) —— 实现代理运行时与管理器。`);

const notebook = { nbformat: 4, nbformat_minor: 5, metadata: { kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' }, language_info: { name: 'python', version: '3.11.0' } }, cells: cells };
const output = JSON.stringify(notebook, null, 1);
fs.writeFileSync('G:/agents/opensouce_proj/CORAL/CORAL-from-scratch/notebooks/06-eval-pipeline.ipynb', output);
console.log(`Cells: ${cells.length}  Size: ${output.length} bytes`);
