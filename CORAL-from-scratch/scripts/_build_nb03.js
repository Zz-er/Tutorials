const fs = require('fs');
const cells = [];

function md(source) {
  cells.push({
    cell_type: 'markdown', metadata: {},
    source: source.split('\n').map((l, i, a) => i < a.length - 1 ? l + '\n' : l)
  });
}

function code(source) {
  cells.push({
    cell_type: 'code', metadata: {},
    source: source.split('\n').map((l, i, a) => i < a.length - 1 ? l + '\n' : l),
    outputs: [], execution_count: null
  });
}

md(`# 第三章：评分器系统

> 自动评估是 CORAL 的核心能力。本章从 Protocol 到 TaskGrader，逐层构建完整的评分器体系。

## 本章内容

- GraderInterface：鸭子类型协议
- BaseGrader：抽象基类与辅助方法
- TaskGrader：任务作者的主要基类（含超时、子进程执行）
- FunctionGrader：轻量级函数包装器
- 实战：为排序任务编写评分器

> Source: \`coral/grader/protocol.py\`, \`coral/grader/base.py\`, \`coral/grader/task_grader.py\`, \`coral/grader/builtin/function_grader.py\``);

md(`## 1. 痛点：手动评估的噩梦

没有自动评分器，每次代理提交代码后你需要：
1. 手动运行测试
2. 手动记录分数
3. 手动比较历史最优
4. 手动给代理反馈

当 4 个代理每小时各提交 10 次……你需要每小时手动评估 40 次。`);

code(`# 痛点演示：手动评估
def manual_grade(code_path):
    """假装手动评估"""
    import random
    print(f"请打开 {code_path} 并手动运行测试...")
    print("请输入分数 (0-1): ", end="")
    # 模拟手动输入
    score = random.random()
    print(f"{score:.2f}")
    return score

# 4个代理 x 10次提交 = 40次手动评估
print("假设 4 个代理各提交 10 次：")
print(f"需要手动评估 {4 * 10} 次！")
print("我们需要自动评分器。")`);

md(`## 2. 评分器类层次

\`\`\`mermaid
flowchart TB
    GI[GraderInterface<br/>Protocol 鸭子类型]
    BG[BaseGrader<br/>ABC 抽象基类]
    FG[FunctionGrader<br/>函数包装器]
    TG[TaskGrader<br/>任务评分器基类]
    UG[用户自定义 Grader<br/>继承 TaskGrader]

    GI -.->|满足协议| BG
    GI -.->|满足协议| TG
    BG --> FG
    TG --> UG
\`\`\`

### 设计决策：为什么有两条继承链？

| 基类 | 用途 | 使用场景 |
|------|------|----------|
| BaseGrader | 通用评分器基类 | 库内部使用（FunctionGrader） |
| TaskGrader | 任务作者的评分器基类 | 用户在 eval/grader.py 中继承 |

TaskGrader 提供了更丰富的辅助方法（run_program, run_script 等），专为任务评估场景设计。`);

md(`## 3. GraderInterface：鸭子类型协议

Python 3.8 引入的 Protocol 让我们可以定义「鸭子类型」接口 —— 不需要继承，只要实现了 \`grade()\` 方法就行。

> 生活类比：Protocol 就像「会飞的东西」这个概念 —— 鸟会飞、飞机会飞、超人会飞，它们不需要继承同一个基类。`);

code(`import asyncio
from typing import Any, Protocol, runtime_checkable
from dataclasses import dataclass, field


# 先导入我们在第一章实现的类型
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(".")), "our-implementation"))
from types_ import Task, Score, ScoreBundle


@runtime_checkable
class GraderInterface(Protocol):
    """评估代码库并返回评分的协议。

    @runtime_checkable 允许用 isinstance() 检查是否满足协议。
    """

    async def grade(
        self,
        codebase_path: str,
        tasks: list[Task],
        **kwargs: Any,
    ) -> ScoreBundle: ...


# 验证：任何实现了 grade() 的类都满足协议
class MyGrader:
    async def grade(self, codebase_path, tasks, **kwargs):
        return ScoreBundle(scores={}, aggregated=0.5)

# runtime_checkable 使 isinstance 检查成为可能
assert isinstance(MyGrader(), GraderInterface)
print("MyGrader 满足 GraderInterface 协议（鸭子类型）")

# 没有 grade 方法的类不满足
class NotAGrader:
    pass

assert not isinstance(NotAGrader(), GraderInterface)
print("NotAGrader 不满足协议")
print("\\nProtocol 的好处：无需继承，只要有 grade() 方法即可！")`);

md(`## 4. BaseGrader：抽象基类

BaseGrader 提供通用的评分器基础设施：
- \`_make_score()\`：用评分器名称创建 Score
- \`_make_bundle()\`：包装为 ScoreBundle
- \`grade_sync()\`：同步包装异步 grade()`);

code(`from abc import ABC, abstractmethod


class BaseGrader(ABC):
    """评分器抽象基类。"""

    def __init__(
        self,
        name: str,
        description: str = "",
        is_public: bool = True,
        **kwargs: Any,
    ) -> None:
        self.name = name
        self.description = description
        self.is_public = is_public
        self.config = kwargs  # 额外配置存储

    @abstractmethod
    async def grade(
        self,
        codebase_path: str,
        tasks: list[Task],
        **kwargs: Any,
    ) -> ScoreBundle:
        """子类必须实现。"""
        ...

    def grade_sync(
        self,
        codebase_path: str,
        tasks: list[Task],
        **kwargs: Any,
    ) -> ScoreBundle:
        """同步包装器：方便在非异步环境中调用。"""
        return asyncio.run(self.grade(codebase_path, tasks, **kwargs))

    def _make_score(
        self,
        value: float | str | bool,
        explanation: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> Score:
        """用当前评分器的名称创建 Score。"""
        return Score(
            value=value,
            name=self.name,
            explanation=explanation,
            metadata=metadata or {},
        )

    def _make_bundle(
        self,
        score: Score,
        aggregated: float | None = None,
    ) -> ScoreBundle:
        """用当前评分器的设置创建 ScoreBundle。"""
        return ScoreBundle(
            scores={self.name: score},
            aggregated=aggregated,
            is_public=self.is_public,
        )

    def __repr__(self) -> str:
        return f"{self.__class__.__name__}(name={self.name!r})"


# 验证
class SimpleGrader(BaseGrader):
    async def grade(self, codebase_path, tasks, **kwargs):
        score = self._make_score(0.9, explanation="90% 测试通过")
        return self._make_bundle(score, aggregated=0.9)

grader = SimpleGrader(name="simple")
result = grader.grade_sync("/fake/path", [])
print(f"评分器: {grader}")
print(f"结果: score={result.aggregated}, public={result.is_public}")
print(f"解释: {result.scores['simple'].explanation}")`);

md(`## 5. TaskGrader：任务作者的主力基类

TaskGrader 是 CORAL 中**最重要**的评分器基类。任务作者只需实现 \`evaluate()\` 方法：

\`\`\`python
from coral.grader import TaskGrader

class Grader(TaskGrader):
    def evaluate(self) -> float:
        result = self.run_program("solution.py")
        return 1.0 if result.returncode == 0 else 0.0
\`\`\`

### 关键设计

1. **evaluate() 是同步的** —— 任务作者不需要懂 async
2. **grade() 用 ThreadPoolExecutor 包装** —— 框架处理异步
3. **超时保护** —— asyncio.wait_for 防止评估挂死
4. **辅助方法** —— run_program, run_script, run_script_json 简化子进程调用`);

code(`import concurrent.futures
import json
import subprocess
from pathlib import Path


class TaskGrader(ABC):
    """任务评分器基类。子类只需实现 evaluate()。"""

    codebase_path: str
    private_dir: str

    def __init__(self, config=None) -> None:
        self.config = config

    @property
    def args(self) -> dict[str, Any]:
        """从配置获取评分器参数。"""
        return self.config.args if self.config else {}

    @property
    def timeout(self) -> int | None:
        """评估超时秒数。None 表示无限制。"""
        if self.config:
            return self.config.timeout or None
        return None

    @abstractmethod
    def evaluate(self) -> float | ScoreBundle:
        """子类实现此方法。返回分数或 ScoreBundle。"""
        ...

    # --- 辅助方法 ---

    def get_python_command(self) -> list[str]:
        """获取 Python 执行命令（优先用 uv run）。"""
        import shutil
        if (Path(self.codebase_path) / "pyproject.toml").exists() and shutil.which("uv"):
            return ["uv", "run", "--project", self.codebase_path, "python"]
        return [sys.executable]

    def run_program(self, filename: str, *cmd_args: str) -> subprocess.CompletedProcess:
        """运行代理代码库中的文件。"""
        filepath = Path(self.codebase_path) / filename
        if not filepath.exists():
            raise FileNotFoundError(f"{filename} not found in codebase")
        return subprocess.run(
            [*self.get_python_command(), str(filepath), *cmd_args],
            capture_output=True, text=True,
            cwd=self.codebase_path, timeout=self.timeout,
        )

    def run_script(self, script: str, *, timeout: int = 300) -> subprocess.CompletedProcess:
        """运行内联 Python 脚本。"""
        return subprocess.run(
            [*self.get_python_command(), "-c", script],
            capture_output=True, text=True, timeout=timeout,
        )

    def run_script_json(self, script: str, *, timeout: int = 300) -> dict:
        """运行返回 JSON 的脚本，处理 stdout 污染。"""
        result = self.run_script(script, timeout=timeout)
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip()[-2000:])
        stdout = result.stdout.strip()
        if not stdout:
            raise RuntimeError(f"脚本无输出。stderr: {result.stderr.strip()[-1000:]}")
        # 先尝试解析完整输出
        try:
            return json.loads(stdout)
        except json.JSONDecodeError:
            pass
        # 倒序扫描每行，找到 JSON 对象（处理 print 污染）
        for line in reversed(stdout.splitlines()):
            line = line.strip()
            if line.startswith("{"):
                try:
                    return json.loads(line)
                except json.JSONDecodeError:
                    continue
        raise RuntimeError(f"输出中无有效 JSON。stdout: {stdout[-500:]}")

    def read_eval(self, relative_path: str) -> str:
        """读取 eval/ 目录中的文件（.coral/private/eval/ 内）。"""
        path = Path(self.private_dir) / "eval" / relative_path
        if not path.exists():
            raise FileNotFoundError(f"Eval 文件未找到: {relative_path}")
        return path.read_text()

    # --- 评分创建辅助 ---

    def score(self, value, explanation="", feedback=None) -> ScoreBundle:
        return self.bundle(value, explanation, feedback=feedback)

    def fail(self, explanation="", feedback=None) -> ScoreBundle:
        return self.bundle(None, explanation, feedback=feedback)

    def bundle(self, value, explanation="", feedback=None) -> ScoreBundle:
        s = Score(value=value, name="eval", explanation=explanation or None)
        return ScoreBundle(scores={"eval": s}, aggregated=value, feedback=feedback)

    # --- 框架调用入口 ---

    async def grade(self, codebase_path: str, tasks: list[Task], **kwargs) -> ScoreBundle:
        """GraderInterface 实现。设置上下文并调用 evaluate()。"""
        self.codebase_path = codebase_path

        loop = asyncio.get_running_loop()
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            try:
                result = await asyncio.wait_for(
                    loop.run_in_executor(pool, self.evaluate),
                    timeout=self.timeout,
                )
            except asyncio.TimeoutError:
                return self.fail(f"评估超时（{self.timeout}秒）")

        if isinstance(result, ScoreBundle):
            return result
        # float/int -> 包装为 ScoreBundle
        value = float(result)
        return ScoreBundle(
            scores={"eval": Score(value=value, name="eval")},
            aggregated=value,
        )


print("TaskGrader 实现完成！")
print("关键设计：evaluate() 是同步的，grade() 用 ThreadPoolExecutor 包装为异步")`);

md(`### TaskGrader 的异步包装机制

\`\`\`
用户实现 evaluate() (同步)
        ↓
grade() 调用 (异步)
        ↓
ThreadPoolExecutor.run_in_executor(evaluate)
        ↓
asyncio.wait_for(timeout=N秒)
        ↓
超时 → fail() | 成功 → ScoreBundle
\`\`\`

### 为什么用 ThreadPoolExecutor 而不是直接 await？

因为 \`evaluate()\` 是**同步方法**（任务作者不需要懂 async）。如果 evaluate 内部调用了 NumPy 等 C 扩展，\`asyncio.wait_for\` 无法中断它。但 ThreadPoolExecutor + multiprocessing（在 post_commit 中使用）可以硬杀超时的进程。`);

md(`## 6. FunctionGrader：轻量级函数包装器

对于简单场景，不需要创建类 —— 用装饰器把函数变成评分器：`);

code(`import inspect
from collections.abc import Callable

GraderFunc = Callable[[str, list[Task]], Score | float | bool]


class FunctionGrader(BaseGrader):
    """把用户函数包装成评分器。"""

    def __init__(self, name, func, description="", is_public=True, **kwargs):
        super().__init__(name, description, is_public, **kwargs)
        self.func = func
        self._is_async = inspect.iscoroutinefunction(func)

    async def grade(self, codebase_path, tasks, **kwargs):
        if self._is_async:
            result = await self.func(codebase_path, tasks)
        else:
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(None, self.func, codebase_path, tasks)

        score = self._normalize_result(result)
        return self._make_bundle(score, aggregated=score.to_float())

    def _normalize_result(self, result) -> Score:
        """归一化函数返回值。"""
        if isinstance(result, Score):
            return result
        elif isinstance(result, bool):
            return self._make_score(
                value=1.0 if result else 0.0,
                explanation="Pass" if result else "Fail",
            )
        elif isinstance(result, (float, int)):
            return self._make_score(value=float(result))
        else:
            raise ValueError(f"意外的返回类型 {type(result)}，期望 Score/float/int/bool")

    @classmethod
    def wrap(cls, name, description="", is_public=True, **kwargs):
        """类方法装饰器。"""
        def decorator(func):
            return cls(name=name, func=func,
                      description=description or func.__doc__ or "",
                      is_public=is_public, **kwargs)
        return decorator


# 模块级装饰器快捷方式
def function_grader(name, is_public=True, **kwargs):
    return FunctionGrader.wrap(name=name, is_public=is_public, **kwargs)


# === 实战演示 ===

# 方式 1：装饰器
@function_grader("sort-check")
def check_sort(codebase_path: str, tasks: list[Task]) -> bool:
    """检查排序是否正确"""
    # 模拟：检查排序实现
    return True

result1 = check_sort.grade_sync("/fake", [])
print(f"装饰器方式: score={result1.aggregated}, explanation={result1.scores['sort-check'].explanation}")

# 方式 2：直接构造
def grade_performance(codebase_path, tasks):
    return 0.85

perf_grader = FunctionGrader(name="performance", func=grade_performance)
result2 = perf_grader.grade_sync("/fake", [])
print(f"直接构造: score={result2.aggregated}")

# 方式 3：异步函数
async def async_grade(codebase_path, tasks):
    return Score(value=0.95, name="async-test", explanation="异步评分通过")

async_grader = FunctionGrader(name="async-test", func=async_grade)
result3 = asyncio.run(async_grader.grade("/fake", []))
print(f"异步函数: score={result3.aggregated}, is_async={async_grader._is_async}")`);

md(`## 7. 实战：为排序任务编写评分器`);

code(`# 使用 TaskGrader 为排序任务编写评分器
import tempfile

class SortGrader(TaskGrader):
    """排序任务评分器 - 检查正确性和性能。"""

    def evaluate(self) -> float:
        test_cases = [
            ([3, 1, 4, 1, 5], [1, 1, 3, 4, 5]),
            ([], []),
            ([1], [1]),
            ([5, 4, 3, 2, 1], [1, 2, 3, 4, 5]),
            ([2, 2, 2], [2, 2, 2]),
            (list(range(100, 0, -1)), list(range(1, 101))),
        ]

        # 模拟：读取代理的排序实现并测试
        passed = 0
        total = len(test_cases)

        for input_arr, expected in test_cases:
            # 在实际场景中，这里会调用 self.run_program()
            result = sorted(input_arr)  # 模拟代理的实现
            if result == expected:
                passed += 1

        score = passed / total
        return score


# 运行评分器
grader = SortGrader()
grader.codebase_path = "/fake"
grader.private_dir = "/fake"

result = asyncio.run(grader.grade("/fake", []))
print(f"排序评分: {result.aggregated}")
print(f"状态: {'全部通过！' if result.aggregated == 1.0 else '部分通过'}")`);

md(`## 8. 保存到 our-implementation/`);

code(`import os

impl_dir = os.path.join(os.path.dirname(os.path.abspath(".")), "our-implementation")

# 重命名 types.py 避免与 Python 内置冲突
types_src = os.path.join(impl_dir, "types.py")
types_dst = os.path.join(impl_dir, "types_.py")
if os.path.exists(types_src) and not os.path.exists(types_dst):
    os.rename(types_src, types_dst)
    print(f"已重命名 types.py -> types_.py（避免与内置模块冲突）")

grader_code = '''"""评分器系统 - 从零重新实现 coral/grader/"""

from __future__ import annotations

import asyncio
import concurrent.futures
import inspect
import json
import subprocess
import sys
from abc import ABC, abstractmethod
from collections.abc import Callable
from pathlib import Path
from typing import Any, Protocol, runtime_checkable

from types_ import Score, ScoreBundle, Task


@runtime_checkable
class GraderInterface(Protocol):
    async def grade(self, codebase_path: str, tasks: list[Task], **kwargs: Any) -> ScoreBundle: ...


class BaseGrader(ABC):
    def __init__(self, name: str, description: str = "", is_public: bool = True, **kwargs: Any) -> None:
        self.name = name
        self.description = description
        self.is_public = is_public
        self.config = kwargs

    @abstractmethod
    async def grade(self, codebase_path: str, tasks: list[Task], **kwargs: Any) -> ScoreBundle: ...

    def grade_sync(self, codebase_path: str, tasks: list[Task], **kwargs: Any) -> ScoreBundle:
        return asyncio.run(self.grade(codebase_path, tasks, **kwargs))

    def _make_score(self, value, explanation=None, metadata=None) -> Score:
        return Score(value=value, name=self.name, explanation=explanation, metadata=metadata or {})

    def _make_bundle(self, score: Score, aggregated=None) -> ScoreBundle:
        return ScoreBundle(scores={self.name: score}, aggregated=aggregated, is_public=self.is_public)

    def __repr__(self) -> str:
        return f"{self.__class__.__name__}(name={self.name!r})"


class TaskGrader(ABC):
    codebase_path: str
    private_dir: str

    def __init__(self, config=None) -> None:
        self.config = config

    @property
    def args(self) -> dict[str, Any]:
        return self.config.args if self.config else {}

    @property
    def timeout(self) -> int | None:
        if self.config:
            return self.config.timeout or None
        return None

    @abstractmethod
    def evaluate(self) -> float | ScoreBundle: ...

    def get_python_command(self) -> list[str]:
        import shutil
        if (Path(self.codebase_path) / "pyproject.toml").exists() and shutil.which("uv"):
            return ["uv", "run", "--project", self.codebase_path, "python"]
        return [sys.executable]

    def run_program(self, filename: str, *cmd_args: str) -> subprocess.CompletedProcess:
        filepath = Path(self.codebase_path) / filename
        if not filepath.exists():
            raise FileNotFoundError(f"{filename} not found")
        return subprocess.run([*self.get_python_command(), str(filepath), *cmd_args],
                            capture_output=True, text=True, cwd=self.codebase_path, timeout=self.timeout)

    def run_script(self, script: str, *, timeout: int = 300) -> subprocess.CompletedProcess:
        return subprocess.run([*self.get_python_command(), "-c", script],
                            capture_output=True, text=True, timeout=timeout)

    def run_script_json(self, script: str, *, timeout: int = 300) -> dict:
        result = self.run_script(script, timeout=timeout)
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip()[-2000:])
        stdout = result.stdout.strip()
        if not stdout:
            raise RuntimeError(f"No output. stderr: {result.stderr.strip()[-1000:]}")
        try:
            return json.loads(stdout)
        except json.JSONDecodeError:
            pass
        for line in reversed(stdout.splitlines()):
            line = line.strip()
            if line.startswith("{"):
                try:
                    return json.loads(line)
                except json.JSONDecodeError:
                    continue
        raise RuntimeError(f"No valid JSON. stdout: {stdout[-500:]}")

    def read_eval(self, relative_path: str) -> str:
        path = Path(self.private_dir) / "eval" / relative_path
        if not path.exists():
            raise FileNotFoundError(f"Eval file not found: {relative_path}")
        return path.read_text()

    def score(self, value, explanation="", feedback=None) -> ScoreBundle:
        return self.bundle(value, explanation, feedback=feedback)

    def fail(self, explanation="", feedback=None) -> ScoreBundle:
        return self.bundle(None, explanation, feedback=feedback)

    def bundle(self, value, explanation="", feedback=None) -> ScoreBundle:
        s = Score(value=value, name="eval", explanation=explanation or None)
        return ScoreBundle(scores={"eval": s}, aggregated=value, feedback=feedback)

    async def grade(self, codebase_path: str, tasks: list[Task], **kwargs: Any) -> ScoreBundle:
        self.codebase_path = codebase_path
        loop = asyncio.get_running_loop()
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            try:
                result = await asyncio.wait_for(loop.run_in_executor(pool, self.evaluate), timeout=self.timeout)
            except asyncio.TimeoutError:
                return self.fail(f"Timed out after {self.timeout}s")
        if isinstance(result, ScoreBundle):
            return result
        value = float(result)
        return ScoreBundle(scores={"eval": Score(value=value, name="eval")}, aggregated=value)


class FunctionGrader(BaseGrader):
    def __init__(self, name, func, description="", is_public=True, **kwargs):
        super().__init__(name, description, is_public, **kwargs)
        self.func = func
        self._is_async = inspect.iscoroutinefunction(func)

    async def grade(self, codebase_path, tasks, **kwargs):
        if self._is_async:
            result = await self.func(codebase_path, tasks)
        else:
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(None, self.func, codebase_path, tasks)
        score = self._normalize_result(result)
        return self._make_bundle(score, aggregated=score.to_float())

    def _normalize_result(self, result) -> Score:
        if isinstance(result, Score):
            return result
        elif isinstance(result, bool):
            return self._make_score(value=1.0 if result else 0.0, explanation="Pass" if result else "Fail")
        elif isinstance(result, (float, int)):
            return self._make_score(value=float(result))
        raise ValueError(f"Unexpected type {type(result)}")

    @classmethod
    def wrap(cls, name, description="", is_public=True, **kwargs):
        def decorator(func):
            return cls(name=name, func=func, description=description or func.__doc__ or "", is_public=is_public, **kwargs)
        return decorator


def function_grader(name, is_public=True, **kwargs):
    return FunctionGrader.wrap(name=name, is_public=is_public, **kwargs)
'''

with open(os.path.join(impl_dir, "grader.py"), "w", encoding="utf-8") as f:
    f.write(grader_code)
print(f"已保存到 {os.path.join(impl_dir, 'grader.py')}")`);

md(`## 源码映射表

| 我们的实现 | 原始源码 | 说明 |
|-----------|---------|------|
| GraderInterface | \`coral/grader/protocol.py:10-19\` | 完全一致 |
| BaseGrader | \`coral/grader/base.py:12-76\` | 完全一致 |
| TaskGrader | \`coral/grader/task_grader.py:27-212\` | 核心逻辑一致，简化了 config 类型依赖 |
| FunctionGrader | \`coral/grader/builtin/function_grader.py:17-94\` | 完全一致 |

### 关键发现

1. **两条继承链共存**：BaseGrader（库内部用）和 TaskGrader（任务作者用）都满足 GraderInterface。
2. **同步 evaluate + 异步 grade**：任务作者写同步代码，框架自动包装为异步。
3. **run_script_json 的鲁棒性**：倒序扫描 stdout 行来找 JSON，处理 print 语句污染。
4. **FunctionGrader 的装饰器模式**：@function_grader 让简单评分只需一个函数。

---

**上一章**: [02-config-system.ipynb](02-config-system.ipynb)
**下一章**: [04-hub-shared-state.ipynb](04-hub-shared-state.ipynb) —— 构建共享状态中心。`);

const notebook = {
  nbformat: 4, nbformat_minor: 5,
  metadata: { kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
              language_info: { name: 'python', version: '3.11.0' } },
  cells: cells
};

const output = JSON.stringify(notebook, null, 1);
fs.writeFileSync('G:/agents/opensouce_proj/CORAL/CORAL-from-scratch/notebooks/03-grader-system.ipynb', output);
console.log(`Cells: ${cells.length}  Size: ${output.length} bytes`);
