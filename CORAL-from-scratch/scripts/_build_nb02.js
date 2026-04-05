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
// Chapter 02: 配置系统
// ============================================================

md(`# 第二章：配置系统

> 灵活的配置是编排系统的命脉。本章实现 CORAL 的 YAML 配置系统，支持结构化校验和 CLI 覆盖。

## 本章内容

- 为什么需要结构化配置（而非普通 dict）
- 用 OmegaConf 实现带默认值的 YAML 配置
- CoralConfig 的嵌套结构
- dotlist 覆盖：命令行动态修改配置
- 向后兼容的预处理

> Source: \`coral/config.py\``);

md(`## 1. 痛点：为什么不直接用 dict？

假设你的任务配置是一个普通字典：

\`\`\`python
config = yaml.safe_load(open("task.yaml"))
count = config["agents"]["count"]  # KeyError if missing!
\`\`\`

**问题**：
1. **没有默认值** —— 忘记写一个字段就崩溃
2. **没有类型检查** —— \`count: "四"\` 不会报错
3. **没有命令行覆盖** —— 改一个参数就要编辑 YAML 文件
4. **没有文档** —— 不知道有哪些可配置项`);

code(`import yaml

# 痛点演示：普通 dict 的问题
raw_config = """
task:
  name: sort-optimizer
  description: 排序任务
agents:
  count: 4
"""

config = yaml.safe_load(raw_config)

# 问题 1: 缺少字段时 KeyError
try:
    timeout = config["agents"]["timeout"]
except KeyError as e:
    print(f"KeyError: {e} -- 没有默认值！")

# 问题 2: 如何在命令行覆盖 agents.count=8？
# 需要自己实现嵌套 dict 的路径解析...
print("我们需要一个结构化配置系统！")`);

md(`## 2. OmegaConf 简介

[OmegaConf](https://omegaconf.readthedocs.io/) 是一个结构化配置库，核心特性：

| 特性 | 说明 |
|------|------|
| 结构化 schema | 用 dataclass 定义配置结构，自带类型检查 |
| MISSING 哨兵 | 标记必填字段，缺失时报明确错误 |
| merge | 将用户 YAML 合并到 schema，自动填充默认值 |
| dotlist | 支持 \`agents.count=8\` 这样的路径覆盖 |
| to_object | 转回普通 Python 对象（脱离 OmegaConf 代理）|`);

code(`from dataclasses import dataclass, field
from typing import Any
from omegaconf import MISSING, OmegaConf

# OmegaConf 基础演示
@dataclass
class DemoConfig:
    name: str = MISSING       # 必填
    count: int = 4            # 有默认值
    verbose: bool = False     # 有默认值

# 创建 schema
schema = OmegaConf.structured(DemoConfig)
print(f"Schema: {OmegaConf.to_yaml(schema)}")

# 用户只提供了 name
user_data = OmegaConf.create({"name": "my-task"})

# merge: 用户数据 + schema 默认值
merged = OmegaConf.merge(schema, user_data)
print(f"Merged: {OmegaConf.to_yaml(merged)}")

# 转回普通 Python 对象
obj = OmegaConf.to_object(merged)
print(f"Python object: {obj}")
print(f"Type: {type(obj)}")`);

md(`## 3. 实现 CORAL 配置结构

CORAL 的配置是**嵌套 dataclass**，每一层管理一个关注点：

\`\`\`mermaid
flowchart TB
    CoralConfig --> TaskConfig
    CoralConfig --> GraderConfig
    CoralConfig --> AgentConfig
    CoralConfig --> SharingConfig
    CoralConfig --> WorkspaceConfig
    CoralConfig --> RunConfig
    AgentConfig --> GatewayConfig
    AgentConfig --> HeartbeatActionConfig
\`\`\``);

code(`from pathlib import Path

# --- 逐个实现配置子结构 ---

@dataclass
class TaskConfig:
    """任务定义"""
    name: str = MISSING         # 必填：任务名称
    description: str = MISSING  # 必填：任务描述
    files: list[str] = field(default_factory=list)    # 关键文件列表
    tips: str = ""              # 给代理的提示
    seed: list[str] = field(default_factory=list)     # 种子文件/目录


@dataclass
class GraderConfig:
    """评分器配置"""
    type: str = ""              # 空 = 从 eval/grader.py 自动发现
    module: str = ""            # 自定义评分器模块路径
    timeout: int = 300          # 评估超时（秒），0 = 无限制
    args: dict[str, Any] = field(default_factory=dict)  # 传给评分器的参数
    private: list[str] = field(default_factory=list)    # 私有文件（代理不可见）
    direction: str = "maximize" # maximize 或 minimize


@dataclass
class HeartbeatActionConfig:
    """心跳动作配置"""
    name: str = MISSING         # 动作名：reflect, consolidate, pivot
    every: int = MISSING        # 每 N 次评估触发
    is_global: bool = False     # True = 全局计数, False = 每代理计数
    trigger: str = "interval"   # interval 或 plateau


@dataclass
class GatewayConfig:
    """LiteLLM 网关配置"""
    enabled: bool = False
    port: int = 4000
    config: str = ""
    api_key: str = ""


@dataclass
class AgentConfig:
    """代理配置"""
    count: int = 1
    runtime: str = "claude_code"
    model: str = "sonnet"
    gateway: GatewayConfig = field(default_factory=GatewayConfig)
    runtime_options: dict[str, Any] = field(default_factory=dict)
    max_turns: int = 200
    timeout: int = 3600
    heartbeat: list[HeartbeatActionConfig] = field(
        default_factory=lambda: [
            HeartbeatActionConfig(name="reflect", every=1),
            HeartbeatActionConfig(name="consolidate", every=10, is_global=True),
            HeartbeatActionConfig(name="pivot", every=5, trigger="plateau"),
        ]
    )
    research: bool = True
    stagger_seconds: int = 0

    def heartbeat_interval(self, name: str) -> int:
        for action in self.heartbeat:
            if action.name == name:
                return action.every
        raise KeyError(f"No heartbeat action named {name!r}")


@dataclass
class SharingConfig:
    """共享状态开关"""
    attempts: bool = True
    notes: bool = True
    skills: bool = True


@dataclass
class WorkspaceConfig:
    """工作空间布局"""
    results_dir: str = "./results"
    repo_path: str = "."
    setup: list[str] = field(default_factory=list)
    base_dir: str = ""
    run_dir: str = ""


@dataclass
class RunConfig:
    """运行时标志"""
    verbose: bool = False
    ui: bool = False
    session: str = "tmux"
    docker_image: str = ""


print("所有配置子结构定义完成！")
print(f"HeartbeatActionConfig 默认触发器: {HeartbeatActionConfig().trigger if False else 'interval'}")
print(f"AgentConfig 默认心跳: {[h.name for h in AgentConfig().heartbeat]}")`);

md(`## 4. 实现 CoralConfig 主类

核心方法：
- \`from_yaml()\`：从 YAML 文件加载
- \`from_dict()\`：从字典构建（OmegaConf merge）
- \`merge_dotlist()\`：命令行 dotlist 覆盖
- \`to_dict()\` / \`to_yaml()\`：序列化`);

code(`@dataclass
class CoralConfig:
    """顶层项目配置"""

    task: TaskConfig = field(default_factory=TaskConfig)
    grader: GraderConfig = field(default_factory=GraderConfig)
    agents: AgentConfig = field(default_factory=AgentConfig)
    sharing: SharingConfig = field(default_factory=SharingConfig)
    workspace: WorkspaceConfig = field(default_factory=WorkspaceConfig)
    run: RunConfig = field(default_factory=RunConfig)
    task_dir: Path | None = None  # 内部使用：task.yaml 所在目录

    @classmethod
    def from_yaml(cls, path: str | Path) -> "CoralConfig":
        """从 YAML 文件加载配置"""
        with open(path) as f:
            data = yaml.safe_load(f)
        return cls.from_dict(data)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "CoralConfig":
        """从字典构建配置（OmegaConf schema merge）"""
        data = _preprocess(dict(data))
        schema = OmegaConf.structured(cls)
        raw = OmegaConf.create(data)
        merged = OmegaConf.merge(schema, raw)
        cfg: "CoralConfig" = OmegaConf.to_object(merged)
        return cfg

    def to_dict(self) -> dict[str, Any]:
        """序列化为字典"""
        sc = OmegaConf.structured(self)
        container: dict[str, Any] = OmegaConf.to_container(sc, resolve=True)
        container.pop("task_dir", None)  # 移除内部字段
        # is_global -> global 的 YAML 兼容转换
        for h in container.get("agents", {}).get("heartbeat", []):
            h["global"] = h.pop("is_global", False)
        return container

    def to_yaml(self, path: str | Path) -> None:
        """保存到 YAML 文件"""
        with open(path, "w") as f:
            yaml.dump(self.to_dict(), f, default_flow_style=False, sort_keys=False)

    @classmethod
    def merge_dotlist(cls, config: "CoralConfig", dotlist: list[str]) -> "CoralConfig":
        """合并 CLI dotlist 覆盖"""
        if not dotlist:
            return config
        base = OmegaConf.structured(config)
        overrides = OmegaConf.from_dotlist(dotlist)
        merged = OmegaConf.merge(base, overrides)
        cfg: "CoralConfig" = OmegaConf.to_object(merged)
        return cfg


def _preprocess(data: dict[str, Any]) -> dict[str, Any]:
    """预处理：兼容旧配置格式"""
    agents_data = data.get("agents", {})
    if not isinstance(agents_data, dict):
        return data

    agents_data = dict(agents_data)

    # 心跳配置归一化
    heartbeat_raw = agents_data.pop("heartbeat", None)
    old_reflect = agents_data.pop("reflect_every", None)
    old_heartbeat = agents_data.pop("heartbeat_every", None)

    if heartbeat_raw is not None:
        agents_data["heartbeat"] = [
            {
                "name": h["name"],
                "every": h["every"],
                "is_global": h.get("global", False),
                "trigger": h.get("trigger", "interval"),
            }
            for h in heartbeat_raw
        ]
    elif old_reflect is not None or old_heartbeat is not None:
        # 向后兼容旧格式
        agents_data["heartbeat"] = [
            {"name": "reflect", "every": old_reflect or 1, "is_global": False},
            {"name": "consolidate", "every": old_heartbeat or 10, "is_global": False},
        ]

    data["agents"] = agents_data
    data.pop("task_dir", None)  # 移除内部字段
    return data


print("CoralConfig 实现完成！")`);

code(`# 测试 1: 从字典构建，验证默认值填充
config = CoralConfig.from_dict({
    "task": {
        "name": "sort-optimizer",
        "description": "实现高效排序函数",
    },
    "agents": {
        "count": 4,
        "model": "opus",
    },
})

print(f"任务: {config.task.name}")
print(f"代理数: {config.agents.count}")
print(f"模型: {config.agents.model}")
print(f"评分超时（默认值）: {config.grader.timeout}s")
print(f"方向（默认值）: {config.grader.direction}")
print(f"会话模式（默认值）: {config.run.session}")
print(f"心跳动作: {[h.name for h in config.agents.heartbeat]}")

# 验证默认值确实被填充了
assert config.grader.timeout == 300
assert config.grader.direction == "maximize"
assert config.run.session == "tmux"
assert config.sharing.notes is True
print("\\n默认值填充测试通过！")`);

code(`# 测试 2: dotlist 命令行覆盖
# 模拟: coral start -c task.yaml agents.count=8 run.verbose=true
config2 = CoralConfig.merge_dotlist(config, [
    "agents.count=8",
    "run.verbose=true",
    "grader.timeout=600",
])

print(f"覆盖前: agents.count={config.agents.count}")
print(f"覆盖后: agents.count={config2.agents.count}")
print(f"覆盖后: run.verbose={config2.run.verbose}")
print(f"覆盖后: grader.timeout={config2.grader.timeout}")

assert config2.agents.count == 8
assert config2.run.verbose is True
assert config2.grader.timeout == 600
# 原配置不变（不可变操作）
assert config.agents.count == 4
print("\\ndotlist 覆盖测试通过！")`);

code(`# 测试 3: 向后兼容 - 旧格式心跳配置
legacy_data = {
    "task": {"name": "test", "description": "test"},
    "agents": {
        "reflect_every": 3,     # 旧格式
        "heartbeat_every": 15,  # 旧格式
    },
}

legacy_config = CoralConfig.from_dict(legacy_data)
hb_names = [h.name for h in legacy_config.agents.heartbeat]
print(f"旧格式心跳转换: {hb_names}")
assert "reflect" in hb_names
assert "consolidate" in hb_names
print("向后兼容测试通过！")`);

code(`# 测试 4: 序列化往返
config_dict = config.to_dict()
config_restored = CoralConfig.from_dict(config_dict)
assert config_restored.task.name == config.task.name
assert config_restored.agents.count == config.agents.count
print("序列化往返测试通过！")
print(f"\\n序列化结果（部分）:")
print(yaml.dump({"task": config_dict["task"], "agents": {"count": config_dict["agents"]["count"]}}, default_flow_style=False))`);

md(`## 5. 保存到 our-implementation/`);

code(`import os

impl_dir = os.path.join(os.path.dirname(os.path.abspath(".")), "our-implementation")

config_code = '''"""配置系统 - 从零重新实现 coral/config.py"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml
from omegaconf import MISSING, OmegaConf


@dataclass
class TaskConfig:
    name: str = MISSING
    description: str = MISSING
    files: list[str] = field(default_factory=list)
    tips: str = ""
    seed: list[str] = field(default_factory=list)


@dataclass
class GraderConfig:
    type: str = ""
    module: str = ""
    timeout: int = 300
    args: dict[str, Any] = field(default_factory=dict)
    private: list[str] = field(default_factory=list)
    direction: str = "maximize"


@dataclass
class HeartbeatActionConfig:
    name: str = MISSING
    every: int = MISSING
    is_global: bool = False
    trigger: str = "interval"


@dataclass
class GatewayConfig:
    enabled: bool = False
    port: int = 4000
    config: str = ""
    api_key: str = ""


@dataclass
class AgentConfig:
    count: int = 1
    runtime: str = "claude_code"
    model: str = "sonnet"
    gateway: GatewayConfig = field(default_factory=GatewayConfig)
    runtime_options: dict[str, Any] = field(default_factory=dict)
    max_turns: int = 200
    timeout: int = 3600
    heartbeat: list[HeartbeatActionConfig] = field(
        default_factory=lambda: [
            HeartbeatActionConfig(name="reflect", every=1),
            HeartbeatActionConfig(name="consolidate", every=10, is_global=True),
            HeartbeatActionConfig(name="pivot", every=5, trigger="plateau"),
        ]
    )
    research: bool = True
    stagger_seconds: int = 0

    def heartbeat_interval(self, name: str) -> int:
        for action in self.heartbeat:
            if action.name == name:
                return action.every
        raise KeyError(f"No heartbeat action named {name!r}")


@dataclass
class SharingConfig:
    attempts: bool = True
    notes: bool = True
    skills: bool = True


@dataclass
class WorkspaceConfig:
    results_dir: str = "./results"
    repo_path: str = "."
    setup: list[str] = field(default_factory=list)
    base_dir: str = ""
    run_dir: str = ""


@dataclass
class RunConfig:
    verbose: bool = False
    ui: bool = False
    session: str = "tmux"
    docker_image: str = ""


@dataclass
class CoralConfig:
    task: TaskConfig = field(default_factory=TaskConfig)
    grader: GraderConfig = field(default_factory=GraderConfig)
    agents: AgentConfig = field(default_factory=AgentConfig)
    sharing: SharingConfig = field(default_factory=SharingConfig)
    workspace: WorkspaceConfig = field(default_factory=WorkspaceConfig)
    run: RunConfig = field(default_factory=RunConfig)
    task_dir: Path | None = None

    @classmethod
    def from_yaml(cls, path: str | Path) -> CoralConfig:
        with open(path) as f:
            data = yaml.safe_load(f)
        return cls.from_dict(data)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> CoralConfig:
        data = _preprocess(dict(data))
        schema = OmegaConf.structured(cls)
        raw = OmegaConf.create(data)
        merged = OmegaConf.merge(schema, raw)
        return OmegaConf.to_object(merged)

    def to_dict(self) -> dict[str, Any]:
        sc = OmegaConf.structured(self)
        container = OmegaConf.to_container(sc, resolve=True)
        container.pop("task_dir", None)
        for h in container.get("agents", {}).get("heartbeat", []):
            h["global"] = h.pop("is_global", False)
        return container

    def to_yaml(self, path: str | Path) -> None:
        with open(path, "w") as f:
            yaml.dump(self.to_dict(), f, default_flow_style=False, sort_keys=False)

    @classmethod
    def merge_dotlist(cls, config: CoralConfig, dotlist: list[str]) -> CoralConfig:
        if not dotlist:
            return config
        base = OmegaConf.structured(config)
        overrides = OmegaConf.from_dotlist(dotlist)
        merged = OmegaConf.merge(base, overrides)
        return OmegaConf.to_object(merged)


def _preprocess(data: dict[str, Any]) -> dict[str, Any]:
    agents_data = data.get("agents", {})
    if not isinstance(agents_data, dict):
        return data
    agents_data = dict(agents_data)
    heartbeat_raw = agents_data.pop("heartbeat", None)
    old_reflect = agents_data.pop("reflect_every", None)
    old_heartbeat = agents_data.pop("heartbeat_every", None)
    if heartbeat_raw is not None:
        agents_data["heartbeat"] = [
            {"name": h["name"], "every": h["every"], "is_global": h.get("global", False), "trigger": h.get("trigger", "interval")}
            for h in heartbeat_raw
        ]
    elif old_reflect is not None or old_heartbeat is not None:
        agents_data["heartbeat"] = [
            {"name": "reflect", "every": old_reflect or 1, "is_global": False},
            {"name": "consolidate", "every": old_heartbeat or 10, "is_global": False},
        ]
    data["agents"] = agents_data
    data.pop("task_dir", None)
    return data
'''

with open(os.path.join(impl_dir, "config.py"), "w", encoding="utf-8") as f:
    f.write(config_code)
print(f"已保存到 {os.path.join(impl_dir, 'config.py')}")`);

md(`## 源码映射表

| 我们的实现 | 原始源码 | 说明 |
|-----------|---------|------|
| TaskConfig | \`coral/config.py:13-21\` | 完全一致 |
| GraderConfig | \`coral/config.py:24-35\` | 完全一致 |
| HeartbeatActionConfig | \`coral/config.py:38-45\` | 完全一致 |
| GatewayConfig | \`coral/config.py:48-55\` | 完全一致 |
| AgentConfig | \`coral/config.py:58-84\` | 完全一致，含心跳默认值 |
| CoralConfig | \`coral/config.py:118-168\` | 完全一致 |
| _preprocess | \`coral/config.py:171-221\` | 简化了 runtime->model 映射（需要 registry） |

### 关键发现

1. **OmegaConf merge 是核心** —— 将用户 YAML 合并到 schema，自动填充缺失字段的默认值。
2. **MISSING 哨兵** —— 标记 \`task.name\` 和 \`task.description\` 为必填，缺失时报明确错误。
3. **dotlist 覆盖** —— 使 CLI 可以动态修改任意嵌套配置，无需修改 YAML 文件。
4. **_preprocess 向后兼容** —— 旧的 \`reflect_every\` 自动转换为新的 \`heartbeat\` 列表格式。
5. **is_global vs global** —— Python 保留字问题：YAML 中用 \`global\`，Python 中用 \`is_global\`。

---

**上一章**: [01-core-types.ipynb](01-core-types.ipynb)
**下一章**: [03-grader-system.ipynb](03-grader-system.ipynb) —— 实现评分器系统。`);

const notebook = {
  nbformat: 4, nbformat_minor: 5,
  metadata: { kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
              language_info: { name: 'python', version: '3.11.0' } },
  cells: cells
};

const output = JSON.stringify(notebook, null, 1);
fs.writeFileSync('G:/agents/opensouce_proj/CORAL/CORAL-from-scratch/notebooks/02-config-system.ipynb', output);
console.log(`Cells: ${cells.length}  Size: ${output.length} bytes`);
