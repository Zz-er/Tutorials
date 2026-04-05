const fs = require('fs');
const cells = [];

const BT = '`';
const BT3 = '```';

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
// Notebook 00: Why This Project — Overview & Architecture
// ============================================================

md(`# Chapter 0: Why This Project — Claude Code 完全解剖

**本章你将学到：**
- Claude Code 是什么，为什么值得深入研究
- 整体架构的全景图
- 核心概念速览（Tool、Query、Command、MCP）
- 后续章节的学习路线图

---

## 1. Claude Code 是什么？

[Claude Code](https://docs.anthropic.com/en/docs/claude-code) 是 Anthropic 官方推出的 **AI 编程助手 CLI 工具**。
它不是简单的聊天机器人 —— 它是一个拥有 40+ 工具、支持插件扩展、能在终端中读写文件、执行命令、
搜索代码的**智能 Agent 系统**。

你正在阅读的这个仓库，是通过 npm 发布包 ${BT}@anthropic-ai/claude-code@2.1.88${BT} 的 source map
还原出来的 TypeScript 源码。原始包被 webpack 打包成单个 ${BT}cli.js${BT}，但 source map 中包含了
完整的原始源文件 —— 本教程的目标是从零重写这些核心功能，让你彻底理解每一行代码背后的设计决策。

### 为什么研究 Claude Code？

| 维度 | 价值 |
|------|------|
| **Agent 架构** | 学习如何设计一个拥有 40+ 工具的 Agent 系统 |
| **Tool 协议** | 理解 Zod schema 验证、权限检查、结果映射的完整流程 |
| **MCP 协议** | Model Context Protocol 的生产级实现 |
| **终端 UI** | React + Ink 在终端中的渲染架构 |
| **安全模型** | 权限分级、沙箱、危险操作检测 |
| **流式处理** | Streaming API + 工具编排的复杂交互 |
`);

md(`## 2. 架构全景图

${BT3}mermaid
graph TB
    subgraph "CLI Layer"
        MAIN[main.tsx<br/>Commander.js CLI]
        ENTRY[entrypoints/init.ts<br/>初始化配置/遥测]
        REPL[REPL 终端 UI<br/>React + Ink]
    end

    subgraph "Core Engine"
        QUERY[Query Engine<br/>对话循环 + 工具编排]
        TOOLS[Tool System<br/>40+ 工具注册/执行]
        PERM[Permission System<br/>权限检查/沙箱]
    end

    subgraph "Extension Layer"
        CMD[Command System<br/>斜杠命令]
        SKILL[Skill System<br/>技能加载]
        MCP[MCP Protocol<br/>外部工具协议]
        PLUGIN[Plugin System<br/>插件管理]
    end

    subgraph "Infrastructure"
        STATE[State Management<br/>AppState + React Context]
        API[API Client<br/>Anthropic SDK]
        ANALYTICS[Analytics<br/>DataDog + GrowthBook]
    end

    MAIN --> ENTRY --> REPL
    REPL --> QUERY
    QUERY --> TOOLS
    QUERY --> API
    TOOLS --> PERM
    QUERY --> CMD
    QUERY --> SKILL
    TOOLS --> MCP
    TOOLS --> PLUGIN
    REPL --> STATE
    QUERY --> ANALYTICS
${BT3}

### 数据流：一条用户消息的生命周期

${BT3}mermaid
sequenceDiagram
    participant U as 用户输入
    participant R as REPL
    participant Q as Query Engine
    participant A as Anthropic API
    participant T as Tool System
    participant P as Permission

    U->>R: 输入消息
    R->>Q: 提交消息 + 上下文
    Q->>A: 发送 API 请求（streaming）
    A-->>Q: 返回 tool_use blocks
    Q->>P: 检查工具权限
    P-->>Q: 允许/拒绝/询问
    Q->>T: 执行工具
    T-->>Q: 返回结果
    Q->>A: 发送 tool_result
    A-->>Q: 最终文本回复
    Q-->>R: 更新消息列表
${BT3}
`);

md(`## 3. 源码目录结构

还原出的源码有 **3698 个文件**，按功能组织在以下目录中：

| 目录 | 文件数 | 职责 |
|------|--------|------|
| ${BT}tools/${BT} | 40+ | 工具实现（Bash、FileEdit、Grep、MCP 等） |
| ${BT}commands/${BT} | 40+ | 斜杠命令（commit、review、config 等） |
| ${BT}services/${BT} | ~20 | API 客户端、MCP、分析服务 |
| ${BT}utils/${BT} | ~50 | 工具函数（git、model、auth、env 等） |
| ${BT}context/${BT} | ~5 | React Context providers |
| ${BT}coordinator/${BT} | ~10 | 多 Agent 协调模式 |
| ${BT}state/${BT} | ~3 | 全局状态管理 |
| ${BT}components/${BT} | ~15 | React/Ink UI 组件 |
| ${BT}skills/${BT} | ~5 | 技能系统 |
| ${BT}plugins/${BT} | ~5 | 插件系统 |
| ${BT}vim/${BT} | ~5 | Vim 模式 |
| ${BT}bridge/${BT} | ~15 | claude.ai 远程桥接 |
| ${BT}schemas/${BT} | ~5 | Zod schema 定义 |

核心文件只有约 20 个 —— 其余都是围绕这些核心构建的具体工具/命令实现。
`);

md(`## 4. 核心概念速览

### 4.1 Tool（工具）

一切能力的基石。每个工具都是一个实现了 ${BT}Tool${BT} 接口的对象：

- **输入验证**：Zod schema 定义参数，自动生成 JSON Schema 给 API
- **权限检查**：${BT}checkPermissions()${BT} 决定是否需要用户确认
- **执行**：${BT}call()${BT} 执行实际操作
- **结果映射**：${BT}mapToolResultToToolResultBlockParam()${BT} 转换为 API 格式

### 4.2 Query Engine（查询引擎）

对话的核心循环：
1. 构建消息历史 + 系统提示
2. 调用 Anthropic API（streaming）
3. 收到 ${BT}tool_use${BT} → 执行对应工具
4. 发送 ${BT}tool_result${BT} → 继续对话
5. 直到收到最终文本回复

### 4.3 Command（命令）

用户通过 ${BT}/command${BT} 触发的扩展点。三种类型：
- **prompt**：扩展为文本提示
- **local**：本地执行返回文本
- **local-jsx**：渲染 React/Ink 组件

### 4.4 MCP（Model Context Protocol）

连接外部工具服务器的协议。Claude Code 作为 MCP 客户端，可以动态发现并调用
MCP 服务器提供的工具和资源。

### 4.5 Permission（权限）

安全的核心。每个工具执行前都要经过权限检查：
- ${BT}allow${BT}：直接执行
- ${BT}deny${BT}：拒绝执行
- ${BT}ask${BT}：询问用户
`);

md(`## 5. 学习路线图

${BT3}mermaid
graph LR
    C00["Ch0: 总览"] --> C01["Ch1: Source Map<br/>逆向还原"]
    C01 --> C02["Ch2: 类型系统<br/>& Tool 协议"]
    C02 --> C03["Ch3: 文件工具<br/>Read/Edit/Grep"]
    C03 --> C04["Ch4: Bash 工具<br/>& 权限系统"]
    C04 --> C05["Ch5: 查询引擎<br/>对话循环"]
    C05 --> C06["Ch6: 命令系统<br/>& 技能架构"]
    C06 --> C07["Ch7: MCP 协议<br/>& 插件"]
    C07 --> C08["Ch8: 状态管理<br/>& React UI"]
    C08 --> C09["Ch9: 完整集成"]
${BT3}

每一章都遵循 **痛苦优先** 的教学法：
1. 先展示没有这个功能时系统会如何失败
2. 再从第一性原理推导解决方案
3. 最后用 Python 重新实现核心逻辑
`);

md(`## 6. 技术栈概览

原始项目使用的技术栈：

| 技术 | 用途 |
|------|------|
| TypeScript | 主要语言 |
| React + Ink | 终端 UI 渲染 |
| Zod v4 | Schema 定义与验证 |
| Anthropic SDK | API 调用 |
| Commander.js | CLI 参数解析 |
| Zustand | 状态管理 |
| webpack | 打包（npm 发布） |
| MCP SDK | 外部工具协议 |

**本教程使用 Python 重写核心逻辑**，因为它更适合在 Jupyter Notebook 中交互式学习。
我们会保留原始 TypeScript 的设计思想，但用 Python 习惯的方式实现。

---

## 源码映射

| 本教程概念 | 原始源码位置 |
|-----------|-------------|
| 入口点 | ${BT}main.tsx${BT}, ${BT}entrypoints/cli.tsx${BT} |
| 工具协议 | ${BT}Tool.ts${BT} (L362-L695) |
| 工具注册 | ${BT}tools.ts${BT} (${BT}getAllBaseTools()${BT}) |
| 查询引擎 | ${BT}query.ts${BT} |
| 命令系统 | ${BT}commands/${BT} 各子目录 |
| 状态管理 | ${BT}state/AppStateStore.tsx${BT} |

---

← 上一章（这是第一章） | [下一章：Source Map 逆向还原 →](01-sourcemap-extraction.ipynb)
`);

// Lint: check no mermaid in code cells
cells.forEach((cell, i) => {
  if (cell.cell_type === 'code' && cell.source.join('').includes('${BT3}mermaid')) {
    console.warn('WARNING: Cell ' + i + ' is a code cell but contains mermaid diagram');
  }
});

const notebook = {
  nbformat: 4, nbformat_minor: 5,
  metadata: {
    kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
    language_info: { name: 'python', version: '3.10.0' }
  },
  cells: cells
};

const output = JSON.stringify(notebook, null, 1);
fs.writeFileSync('00-why-this-project.ipynb', output);
console.log('Cells: ' + cells.length + '  Size: ' + output.length + ' bytes');
