const fs = require('fs');
const cells = [];
const BT = '`'; const BT3 = '```';
function md(s) { cells.push({ cell_type:'markdown', metadata:{}, source:s.split('\n').map((l,i,a)=>i<a.length-1?l+'\n':l) }); }
function code(s) { cells.push({ cell_type:'code', metadata:{}, source:s.split('\n').map((l,i,a)=>i<a.length-1?l+'\n':l), outputs:[], execution_count:null }); }

md(`# Chapter 8: 状态管理与终端 UI

**本章你将学到：**
- AppState 的设计 — 单一数据源
- React Context 在终端中的应用
- Ink 渲染框架的概念
- 观察者模式在状态管理中的使用

> **Source:** ${BT}state/${BT}, ${BT}context/${BT}, ${BT}components/${BT}

---

## 1. 痛点：组件间共享状态的复杂性

${BT3}python
# 没有集中状态管理时，组件间通信非常混乱
class REPL:
    messages = []

class ToolPanel:
    tools = []

class InputBar:
    history = []

# REPL 如何通知 ToolPanel 消息更新？
# ToolPanel 如何通知 InputBar 工具状态变化？
# -> 需要一个集中式的状态存储
${BT3}

---

## 2. AppState 架构

${BT3}mermaid
flowchart TB
    subgraph "AppState (Single Source of Truth)"
        SETTINGS["settings<br/>用户配置"]
        TOOLS["toolPermissionContext<br/>工具权限"]
        MCP["mcp<br/>MCP 连接"]
        PLUGINS["plugins<br/>插件状态"]
        TASKS["tasks<br/>任务管理"]
        NOTIFS["notifications<br/>通知队列"]
        MESSAGES["messages<br/>消息历史"]
        UI["ui<br/>UI 状态"]
    end

    subgraph "React Context Providers"
        APP_STATE["AppStateProvider"]
        STATS["StatsProvider"]
        FPS["FpsMetricsProvider"]
    end

    APP_STATE --> SETTINGS
    APP_STATE --> TOOLS
    APP_STATE --> MCP
    STATS --> TASKS
${BT3}

> **Source:** ${BT}state/AppStateStore.tsx${BT}, ${BT}state/AppState.tsx${BT}
`);

code(`# === 状态管理实现 ===
from typing import Callable, Any
from dataclasses import dataclass, field
from copy import deepcopy


class AppState:
    """
    集中式应用状态。Source: state/AppStateStore.tsx

    原始 TypeScript 使用 Zustand + DeepImmutable 模式：
    - 所有状态变更通过 set() 函数
    - 状态对象是深度不可变的
    - React 组件通过 Context 订阅状态变化

    我们的 Python 实现使用观察者模式：
    - 状态存储在单一对象中
    - 变更通过 update() 方法
    - 订阅者通过回调接收通知
    """

    def __init__(self):
        # 核心状态
        self.settings: dict = {
            "model": "claude-sonnet-4-6",
            "theme": "dark",
            "verbose": False,
            "permission_mode": "default",
        }
        self.messages: list = []
        self.tools: dict = {}
        self.notifications: list = []
        self.tasks: dict = {}
        self.mcp_connections: dict = {}
        self.plugins: dict = {}

        # UI 状态
        self.ui = {
            "is_processing": False,
            "current_tool": None,
            "input_text": "",
            "show_help": False,
        }

        # 观察者
        self._listeners: list[Callable] = []

    def subscribe(self, callback: Callable[['AppState'], None]):
        """订阅状态变更"""
        self._listeners.append(callback)
        return lambda: self._listeners.remove(callback)

    def update(self, updater: Callable[['AppState'], Any]):
        """
        更新状态。对应 Zustand 的 set() 方法。

        用法：
        state.update(lambda s: setattr(s, 'ui', {...}))
        """
        result = updater(self)
        # 通知所有观察者
        for listener in self._listeners:
            listener(self)
        return result

    def get_snapshot(self) -> dict:
        """获取状态快照（用于 React 的 useSyncExternalStore）"""
        return {
            "settings": self.settings.copy(),
            "message_count": len(self.messages),
            "is_processing": self.ui["is_processing"],
            "current_tool": self.ui["current_tool"],
            "task_count": len(self.tasks),
            "notification_count": len(self.notifications),
        }

    def __repr__(self):
        snap = self.get_snapshot()
        return f"AppState(messages={snap['message_count']}, processing={snap['is_processing']})"


# 测试 AppState
state = AppState()
log = []

# 订阅变更
state.subscribe(lambda s: log.append(f"State updated: {s.get_snapshot()}"))

# 更新状态
state.update(lambda s: setattr(s.ui, 'is_processing', True) or setattr(s.ui, 'current_tool', 'Bash'))

print("=== AppState 测试 ===")
print(f"State: {state}")
print(f"Settings: {state.settings}")
print(f"UI: {state.ui}")
print()
print("Change log:")
for entry in log:
    print(f"  {entry}")
`);

md(`## 3. React Context 模式（概念）

Claude Code 使用 React + Ink 在终端中渲染 UI。关键概念：

### 组件层级

${BT3}mermaid
flowchart TB
    APP["App<br/>根组件"] --> PROVIDER["Context Providers"]
    PROVIDER --> REPL["REPL<br/>主屏幕"]
    REPL --> MSG_LIST["MessageList<br/>消息列表"]
    REPL --> INPUT["PromptInput<br/>输入栏"]
    REPL --> STATUS["StatusBar<br/>状态栏"]
    MSG_LIST --> USER_MSG["UserMessage"]
    MSG_LIST --> ASSIST_MSG["AssistantMessage"]
    MSG_LIST --> TOOL_MSG["ToolUseMessage"]
    MSG_LIST --> RESULT_MSG["ToolResultMessage"]
${BT3}

> **Source:** ${BT}components/App.tsx${BT}, ${BT}screens/REPL.tsx${BT}
`);

code(`# === 简化的组件模型 ===

class Component:
    """
    简化版 React 组件模型。
    Source: components/, screens/

    在 Claude Code 中，这些是 React + Ink 组件：
    - 使用 JSX 描述 UI 结构
    - 通过 hooks 订阅状态
    - Ink 将 React 树渲染为终端文本

    我们的 Python 版本用 __str__ 模拟渲染。
    """

    def __init__(self, props: dict = None):
        self.props = props or {}
        self.state = {}
        self.children: list[Component] = []

    def render(self, width: int = 80) -> str:
        """渲染组件为文本"""
        result = self._render_self(width)
        for child in self.children:
            result += "\\n" + child.render(width)
        return result

    def _render_self(self, width: int) -> str:
        return ""


class MessageList(Component):
    """消息列表组件。Source: screens/REPL.tsx 中的消息渲染"""

    def _render_self(self, width: int) -> str:
        messages = self.props.get("messages", [])
        if not messages:
            return "(no messages)"
        lines = []
        for msg in messages[-5:]:  # 只显示最近5条
            role = msg.get("role", "?")
            text = msg.get("text", "")[:width - 10]
            prefix = {"user": ">", "assistant": "<", "system": "!"}.get(role, "?")
            lines.append(f"  {prefix} {text}")
        return "\\n".join(lines)


class StatusBar(Component):
    """状态栏组件"""

    def _render_self(self, width: int) -> str:
        model = self.props.get("model", "unknown")
        mode = self.props.get("mode", "default")
        processing = self.props.get("processing", False)
        status = "Processing..." if processing else "Ready"
        return f"  [{model}] [{mode}] {status}"


class PromptInput(Component):
    """输入栏组件"""

    def _render_self(self, width: int) -> str:
        return "  > _"


class REPL(Component):
    """主 REPL 界面。Source: screens/REPL.tsx"""

    def __init__(self, app_state: AppState):
        super().__init__()
        self.state_ref = app_state
        self.children = [
            MessageList(),
            StatusBar(),
            PromptInput(),
        ]

    def update_from_state(self):
        """从 AppState 更新组件 props"""
        snap = self.state_ref.get_snapshot()
        self.children[0].props = {"messages": [
            {"role": "user", "text": "Find all TODOs"},
            {"role": "assistant", "text": "I'll search for TODO comments..."},
            {"role": "system", "text": "Tool: Grep(pattern=TODO)"},
            {"role": "assistant", "text": "Found 3 TODO comments"},
        ]}
        self.children[1].props = {
            "model": snap["settings"]["model"],
            "mode": snap["settings"]["permission_mode"],
            "processing": snap["is_processing"],
        }


# 渲染 REPL
repl = REPL(state)
repl.update_from_state()

print("=== Terminal UI 渲染 ===")
print("=" * 60)
print(repl.render(width=60))
print("=" * 60)
`);

md(`## 4. Ink 渲染概念

Ink 是一个用 React 组件构建命令行界面的框架。它的核心概念：

| Ink 概念 | 说明 | 等价 Web React |
|----------|------|----------------|
| ${BT}<Box>${BT} | 布局容器 | ${BT}<div>${BT} |
| ${BT}<Text>${BT} | 文本渲染 | ${BT}<span>${BT} |
| ${BT}<Newline/>${BT} | 换行 | ${BT}<br/>${BT} |
| ${BT}<Spinner/>${BT} | 加载动画 | CSS animation |
| ${BT}useInput()${BT} | 键盘输入 | ${BT}onKeyDown${BT} |
| ${BT}useFocus()${BT} | 焦点管理 | tabIndex |

### Ink 的渲染流程

${BT3}mermaid
flowchart LR
    JSX["React JSX"] --> VDOM["Virtual DOM"]
    VDOM --> PATCH["Diff + Patch"]
    PATCH --> YOGA["Yoga Layout<br/>Flexbox 计算"]
    YOGA --> OUTPUT["终端输出<br/>ANSI escape codes"]
${BT3}

> **Source:** ${BT}ink/${BT} 目录包含 Ink 的核心实现

---

## 5. 源码映射

| 我们的实现 | 原始源码 |
|-----------|---------|
| ${BT}AppState${BT} | ${BT}state/AppStateStore.tsx${BT} |
| ${BT}Component${BT} | React/Ink 组件 |
| ${BT}REPL${BT} | ${BT}screens/REPL.tsx${BT} |
| ${BT}MessageList${BT} | REPL.tsx 中的消息渲染逻辑 |
| ${BT}StatusBar${BT} | REPL.tsx 中的状态栏 |
| 观察者模式 | React Context + useSyncExternalStore |

---

← [上一章：MCP 与插件](07-mcp-plugins.ipynb) | [下一章：完整集成 →](09-full-integration.ipynb)
`);

cells.forEach((c,i)=>{if(c.cell_type==='code'&&c.source.join('').includes('${BT3}mermaid'))console.warn('WARN: cell '+i);});
const nb={nbformat:4,nbformat_minor:5,metadata:{kernelspec:{display_name:'Python 3',language:'python',name:'python3'},language_info:{name:'python',version:'3.10.0'}},cells};
const out=JSON.stringify(nb,null,1);
fs.writeFileSync('08-state-management-ui.ipynb',out);
console.log('Cells: '+cells.length+' Size: '+out.length);
