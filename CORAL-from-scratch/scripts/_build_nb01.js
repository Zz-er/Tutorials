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

// ============================================================
// Chapter 01: 核心类型系统
// ============================================================

md(`# 第一章：核心类型系统

> 任何系统的基石都是它的类型定义。本章从零实现 CORAL 的四大核心类型。

## 本章内容

- Task：任务的最小表示
- Score：灵活的评分值（支持 float/str/bool）
- ScoreBundle：评分集合与加权聚合
- Attempt：代理的一次优化尝试记录

> Source: \`coral/types.py\``);

md(`## 1. 痛点：没有统一类型会怎样？

假设三个代理各自提交了排序代码：
- 代理 1 的评分器返回 \`True\`（正确）
- 代理 2 的评分器返回 \`0.85\`（85% 测试通过）
- 代理 3 的评分器返回 \`"CORRECT"\`（字符串标记）

**问题**：如何比较这三个结果？如何排出排行榜？

我们需要一个统一的类型系统，能把不同格式的评分**归一化**为可比较的数值。`);

code(`# 痛点演示：没有统一类型时的混乱
results = {
    "agent-1": True,        # 布尔值
    "agent-2": 0.85,        # 浮点数
    "agent-3": "CORRECT",   # 字符串
}

# 尝试直接比较 —— 灾难！
try:
    sorted_results = sorted(results.items(), key=lambda x: x[1])
    print(sorted_results)
except TypeError as e:
    print(f"无法比较: {e}")
    print("我们需要一个统一的评分类型！")`);

md(`## 2. 实现 Task：任务的最小表示

Task 是 CORAL 中最简单的类型 —— 描述代理需要完成的工作。

### 设计决策

| 决策 | 选择 | 原因 |
|------|------|------|
| 数据结构 | dataclass | 简洁、自带 __init__/__repr__，无需手写 |
| 序列化 | to_dict/from_dict | 比 pickle 更安全，比 JSON schema 更简单 |
| metadata 字段 | dict[str, Any] | 允许扩展而不改接口 |`);

code(`from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any


@dataclass
class Task:
    """一个工作单元，描述代理需要优化的任务。"""

    id: str
    name: str
    description: str
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "metadata": self.metadata,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Task:
        return cls(
            id=data["id"],
            name=data.get("name", data["id"]),  # name 缺失时回退到 id
            description=data["description"],
            metadata=data.get("metadata", {}),
        )


# 用我们的运行示例验证
task = Task(
    id="sort-optimizer",
    name="sort-optimizer",
    description="实现一个高效的排序函数",
    metadata={"difficulty": "medium"},
)

# 序列化往返测试
task_dict = task.to_dict()
task_restored = Task.from_dict(task_dict)
assert task == task_restored, "序列化往返失败！"
print(f"Task: {task}")
print(f"序列化: {task_dict}")
print("序列化往返测试通过！")`);

md(`## 3. 实现 Score：灵活的评分值

Score 是 CORAL 类型系统的核心 —— 它必须处理多种输入格式并统一归一化。

### to_float() 归一化规则

| 输入类型 | 示例 | 归一化结果 |
|----------|------|-----------|
| None | None | None（评分失败） |
| bool | True / False | 1.0 / 0.0 |
| int/float | 0.85 | 0.85 |
| str | "CORRECT" | 1.0（查映射表） |
| str | "PARTIAL" | 0.5 |
| str | 未知字符串 | 0.0 |

### 生活类比

> Score 就像一个「万能翻译器」—— 不管你用中文、英文还是手语表达「好」，它都能翻译成一个 0-1 的数字。`);

code(`@dataclass
class Score:
    """单个评分结果。支持 float/str/bool/None 输入。"""

    value: float | str | bool | None
    name: str
    explanation: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_float(self) -> float | None:
        """将任意类型的评分值归一化为浮点数。"""
        if self.value is None:
            return None
        if isinstance(self.value, bool):
            # bool 必须在 int 之前检查（bool 是 int 的子类！）
            return 1.0 if self.value else 0.0
        elif isinstance(self.value, (int, float)):
            return float(self.value)
        elif isinstance(self.value, str):
            # 字符串映射表：常见的评分标记
            mapping = {
                "CORRECT": 1.0, "C": 1.0,
                "INCORRECT": 0.0, "I": 0.0,
                "PARTIAL": 0.5, "P": 0.5,
                "NOANSWER": 0.0, "N": 0.0,
            }
            return mapping.get(self.value.upper(), 0.0)
        return 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "value": self.value,
            "name": self.name,
            "explanation": self.explanation,
            "metadata": self.metadata,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Score:
        return cls(
            value=data["value"],
            name=data["name"],
            explanation=data.get("explanation"),
            metadata=data.get("metadata", {}),
        )


# 验证归一化规则
test_scores = [
    Score(value=True, name="pass"),
    Score(value=False, name="fail"),
    Score(value=0.85, name="accuracy"),
    Score(value="CORRECT", name="judge"),
    Score(value="PARTIAL", name="partial"),
    Score(value=None, name="crashed"),
]

print("Score 归一化测试：")
for s in test_scores:
    print(f"  {s.name}: {s.value!r:>12} -> {s.to_float()}")

# 关键：bool 必须在 int 之前检查
assert Score(value=True, name="t").to_float() == 1.0  # 不是 int(True) = 1
assert Score(value=False, name="f").to_float() == 0.0  # 不是 int(False) = 0
print("\\n所有归一化测试通过！")`);

md(`## 4. 实现 ScoreBundle：评分集合与加权聚合

一次评估可能产生多个评分维度（正确性、性能、代码质量等），ScoreBundle 将它们聚合为一个总分。

### 加权聚合公式

$$\\text{aggregated} = \\frac{\\sum_{i} w_i \\cdot s_i}{\\sum_{i} w_i}$$

其中 $w_i$ 是权重（默认 1.0），$s_i$ 是归一化后的分数。

### 具体数值示例

假设评分器返回三个维度：
- correctness = 0.8, weight = 2.0
- performance = 0.6, weight = 1.0
- style = 0.9, weight = 0.5

$$\\text{aggregated} = \\frac{0.8 \\times 2.0 + 0.6 \\times 1.0 + 0.9 \\times 0.5}{2.0 + 1.0 + 0.5} = \\frac{1.6 + 0.6 + 0.45}{3.5} = \\frac{2.65}{3.5} \\approx 0.757$$

### 生活类比

> ScoreBundle 就像大学成绩单 —— 每门课（Score）有自己的分数和学分（权重），GPA（aggregated）是加权平均。`);

code(`@dataclass
class ScoreBundle:
    """评分集合，支持加权聚合。"""

    scores: dict[str, Score]
    aggregated: float | None = None
    is_public: bool = True  # 是否对代理可见
    feedback: str | None = None  # 给代理的文字反馈

    def get(self, name: str) -> Score | None:
        return self.scores.get(name)

    def get_score_value(self, name: str, default: float = 0.0) -> float:
        score = self.scores.get(name)
        if score is None:
            return default
        return score.to_float()

    def compute_aggregated(self, weights: dict[str, float] | None = None) -> float:
        """加权聚合所有评分。"""
        weights = weights or {}
        total = 0.0
        weight_sum = 0.0
        for name, score in self.scores.items():
            try:
                value = score.to_float()
                weight = weights.get(name, 1.0)  # 默认权重 1.0
                total += value * weight
                weight_sum += weight
            except (ValueError, TypeError):
                continue  # 跳过无法归一化的评分
        return total / weight_sum if weight_sum > 0 else 0.0

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "scores": {name: score.to_dict() for name, score in self.scores.items()},
            "aggregated": self.aggregated,
            "is_public": self.is_public,
        }
        if self.feedback is not None:
            d["feedback"] = self.feedback
        return d

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ScoreBundle:
        scores = {name: Score.from_dict(s) for name, s in data.get("scores", {}).items()}
        return cls(
            scores=scores,
            aggregated=data.get("aggregated"),
            is_public=data.get("is_public", True),
            feedback=data.get("feedback"),
        )


# 验证加权聚合
bundle = ScoreBundle(
    scores={
        "correctness": Score(value=0.8, name="correctness"),
        "performance": Score(value=0.6, name="performance"),
        "style": Score(value=0.9, name="style"),
    },
    feedback="整体不错，性能可以优化。"
)

weights = {"correctness": 2.0, "performance": 1.0, "style": 0.5}
agg = bundle.compute_aggregated(weights)
expected = (0.8 * 2.0 + 0.6 * 1.0 + 0.9 * 0.5) / (2.0 + 1.0 + 0.5)

print(f"加权聚合分数: {agg:.4f}")
print(f"预期值: {expected:.4f}")
assert abs(agg - expected) < 1e-10, "加权聚合计算错误！"

# 默认等权重
agg_default = bundle.compute_aggregated()
expected_default = (0.8 + 0.6 + 0.9) / 3
print(f"等权重聚合: {agg_default:.4f} (预期 {expected_default:.4f})")
assert abs(agg_default - expected_default) < 1e-10

# 序列化往返
bundle_dict = bundle.to_dict()
bundle_restored = ScoreBundle.from_dict(bundle_dict)
assert bundle_restored.aggregated == bundle.aggregated
print("\\nScoreBundle 所有测试通过！")`);

md(`## 5. 实现 Attempt：尝试记录

Attempt 是代理每次「提交 + 评估」的完整记录。它构成了一条**优化历史链**（通过 parent_hash 链接）。

### 状态机

\`\`\`mermaid
flowchart LR
    commit[git commit] --> grade[评分]
    grade -->|分数更高| improved[improved]
    grade -->|首次提交| baseline[baseline]
    grade -->|分数更低| regressed[regressed]
    grade -->|评分器崩溃| crashed[crashed]
    grade -->|超时| timeout[timeout]
    revert[coral revert] --> reverted[reverted]
\`\`\``);

code(`from datetime import datetime, timezone


@dataclass
class Attempt:
    """代理一次优化尝试的完整记录。"""

    commit_hash: str
    agent_id: str
    title: str
    score: float | None
    status: str  # improved / baseline / regressed / reverted / crashed / timeout
    parent_hash: str | None
    timestamp: str
    feedback: str = ""
    shared_state_hash: str | None = None
    parent_shared_state_hash: str | None = None

    def to_dict(self) -> dict[str, Any]:
        d = {
            "commit_hash": self.commit_hash,
            "agent_id": self.agent_id,
            "title": self.title,
            "score": self.score,
            "status": self.status,
            "parent_hash": self.parent_hash,
            "timestamp": self.timestamp,
            "feedback": self.feedback,
        }
        # 可选字段：只在有值时序列化
        if self.shared_state_hash is not None:
            d["shared_state_hash"] = self.shared_state_hash
        if self.parent_shared_state_hash is not None:
            d["parent_shared_state_hash"] = self.parent_shared_state_hash
        return d

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Attempt:
        return cls(
            commit_hash=data["commit_hash"],
            agent_id=data["agent_id"],
            title=data["title"],
            score=data.get("score"),
            status=data.get("status", "crashed"),  # 缺失状态默认 crashed
            parent_hash=data.get("parent_hash"),
            timestamp=data["timestamp"],
            feedback=data.get("feedback", ""),
            shared_state_hash=data.get("shared_state_hash"),
            parent_shared_state_hash=data.get("parent_shared_state_hash"),
        )


# 模拟代理的优化历史
now = datetime.now(timezone.utc).isoformat()

attempt_1 = Attempt(
    commit_hash="abc1234",
    agent_id="agent-1",
    title="实现冒泡排序",
    score=0.6,
    status="baseline",
    parent_hash=None,  # 首次尝试，没有父提交
    timestamp=now,
    feedback="正确但慢，通过 60% 的性能测试",
)

attempt_2 = Attempt(
    commit_hash="def5678",
    agent_id="agent-1",
    title="优化为快速排序",
    score=0.95,
    status="improved",  # 比上次更好
    parent_hash="abc1234",  # 链接到上次尝试
    timestamp=now,
    feedback="大幅提升！通过 95% 的测试",
)

# 序列化往返
for attempt in [attempt_1, attempt_2]:
    restored = Attempt.from_dict(attempt.to_dict())
    assert restored == attempt, f"Attempt 序列化往返失败: {attempt.title}"

print(f"尝试 1: [{attempt_1.status}] {attempt_1.title} -> {attempt_1.score}")
print(f"尝试 2: [{attempt_2.status}] {attempt_2.title} -> {attempt_2.score}")
print(f"  parent: {attempt_2.parent_hash} (链接到尝试 1)")
print("\\nAttempt 所有测试通过！")`);

md(`## 6. 把类型保存到 our-implementation/

将本章实现的类型保存为独立模块，供后续章节导入。`);

code(`# 将实现写入 our-implementation/types.py
import os, sys

# 确保输出目录存在
impl_dir = os.path.join(os.path.dirname(os.path.abspath(".")), "our-implementation")
os.makedirs(impl_dir, exist_ok=True)

types_code = '''"""核心类型定义 - 从零重新实现 coral/types.py"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class Task:
    id: str
    name: str
    description: str
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {"id": self.id, "name": self.name, "description": self.description, "metadata": self.metadata}

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Task:
        return cls(id=data["id"], name=data.get("name", data["id"]), description=data["description"], metadata=data.get("metadata", {}))


@dataclass
class Score:
    value: float | str | bool | None
    name: str
    explanation: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_float(self) -> float | None:
        if self.value is None:
            return None
        if isinstance(self.value, bool):
            return 1.0 if self.value else 0.0
        elif isinstance(self.value, (int, float)):
            return float(self.value)
        elif isinstance(self.value, str):
            mapping = {"CORRECT": 1.0, "C": 1.0, "INCORRECT": 0.0, "I": 0.0, "PARTIAL": 0.5, "P": 0.5, "NOANSWER": 0.0, "N": 0.0}
            return mapping.get(self.value.upper(), 0.0)
        return 0.0

    def to_dict(self) -> dict[str, Any]:
        return {"value": self.value, "name": self.name, "explanation": self.explanation, "metadata": self.metadata}

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Score:
        return cls(value=data["value"], name=data["name"], explanation=data.get("explanation"), metadata=data.get("metadata", {}))


@dataclass
class ScoreBundle:
    scores: dict[str, Score]
    aggregated: float | None = None
    is_public: bool = True
    feedback: str | None = None

    def get(self, name: str) -> Score | None:
        return self.scores.get(name)

    def get_score_value(self, name: str, default: float = 0.0) -> float:
        score = self.scores.get(name)
        if score is None:
            return default
        return score.to_float()

    def compute_aggregated(self, weights: dict[str, float] | None = None) -> float:
        weights = weights or {}
        total = 0.0
        weight_sum = 0.0
        for name, score in self.scores.items():
            try:
                value = score.to_float()
                weight = weights.get(name, 1.0)
                total += value * weight
                weight_sum += weight
            except (ValueError, TypeError):
                continue
        return total / weight_sum if weight_sum > 0 else 0.0

    def to_dict(self) -> dict[str, Any]:
        d = {"scores": {name: score.to_dict() for name, score in self.scores.items()}, "aggregated": self.aggregated, "is_public": self.is_public}
        if self.feedback is not None:
            d["feedback"] = self.feedback
        return d

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ScoreBundle:
        scores = {name: Score.from_dict(s) for name, s in data.get("scores", {}).items()}
        return cls(scores=scores, aggregated=data.get("aggregated"), is_public=data.get("is_public", True), feedback=data.get("feedback"))


@dataclass
class Attempt:
    commit_hash: str
    agent_id: str
    title: str
    score: float | None
    status: str
    parent_hash: str | None
    timestamp: str
    feedback: str = ""
    shared_state_hash: str | None = None
    parent_shared_state_hash: str | None = None

    def to_dict(self) -> dict[str, Any]:
        d = {"commit_hash": self.commit_hash, "agent_id": self.agent_id, "title": self.title, "score": self.score, "status": self.status, "parent_hash": self.parent_hash, "timestamp": self.timestamp, "feedback": self.feedback}
        if self.shared_state_hash is not None:
            d["shared_state_hash"] = self.shared_state_hash
        if self.parent_shared_state_hash is not None:
            d["parent_shared_state_hash"] = self.parent_shared_state_hash
        return d

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Attempt:
        return cls(commit_hash=data["commit_hash"], agent_id=data["agent_id"], title=data["title"], score=data.get("score"), status=data.get("status", "crashed"), parent_hash=data.get("parent_hash"), timestamp=data["timestamp"], feedback=data.get("feedback", ""), shared_state_hash=data.get("shared_state_hash"), parent_shared_state_hash=data.get("parent_shared_state_hash"))
'''

with open(os.path.join(impl_dir, "types.py"), "w", encoding="utf-8") as f:
    f.write(types_code)

print(f"已保存到 {os.path.join(impl_dir, 'types.py')}")`);

md(`## 源码映射表

| 我们的实现 | 原始源码 | 说明 |
|-----------|---------|------|
| Task | \`coral/types.py:12-36\` | 完全一致 |
| Score | \`coral/types.py:39-80\` | 完全一致，包括 bool 优先检查 |
| ScoreBundle | \`coral/types.py:83-133\` | 完全一致，加权聚合逻辑相同 |
| Attempt | \`coral/types.py:136-181\` | 完全一致，含可选 shared_state_hash |

### 关键发现

1. **bool 必须在 int 之前检查**：Python 中 \`isinstance(True, int)\` 为 True，如果先检查 int 会把 True 当作 1 处理（虽然数值相同，但语义不同）。
2. **Score.to_float() 是归一化的核心**：整个系统的排行榜、状态判定都依赖它。
3. **Attempt 的 parent_hash 构成链表**：可以追溯代理的完整优化历史。
4. **shared_state_hash 是可选字段**：支持共享状态的版本化快照。

---

**上一章**: [00-why-coral.ipynb](00-why-coral.ipynb)
**下一章**: [02-config-system.ipynb](02-config-system.ipynb) —— 构建 YAML 配置系统。`);

const notebook = {
  nbformat: 4, nbformat_minor: 5,
  metadata: { kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
              language_info: { name: 'python', version: '3.11.0' } },
  cells: cells
};

const output = JSON.stringify(notebook, null, 1);
fs.writeFileSync('G:/agents/opensouce_proj/CORAL/CORAL-from-scratch/notebooks/01-core-types.ipynb', output);
console.log(`Cells: ${cells.length}  Size: ${output.length} bytes`);
