# Claude Code From Scratch

从零重写 Anthropic Claude Code CLI 的核心架构 —— 基于 `@anthropic-ai/claude-code@2.1.88` 的 source map 还原源码。

## 概述

本教程通过 10 个 Jupyter Notebook，逐步重新实现 Claude Code 的核心功能：

- **Source Map 逆向还原** — 理解如何从 npm 包还原源码
- **Tool 协议** — 40+ 工具的统一接口设计
- **文件操作工具** — Read/Edit/Grep/Glob 的实现
- **Bash 工具与权限** — 命令执行与安全模型
- **查询引擎** — Agentic Loop 的核心算法
- **命令与技能** — 斜杠命令和技能加载系统
- **MCP 协议与插件** — Model Context Protocol 的实现
- **状态管理与 UI** — React/Ink 终端渲染
- **完整集成** — 端到端的系统组装

## 目录结构

```
claude-code-from-scratch/
├── README.md                    # 本文件
├── SUMMARY.md                   # 章节目录
├── requirements.txt             # Python 依赖
├── our-implementation/          # 增量实现的 Python 模块
│   ├── __init__.py
│   └── tool_protocol.py         # Ch02: Tool 协议核心
├── notebooks/
│   ├── 00-why-this-project.ipynb
│   ├── 01-sourcemap-extraction.ipynb
│   ├── 02-tool-protocol.ipynb
│   ├── 03-file-tools.ipynb
│   ├── 04-bash-permissions.ipynb
│   ├── 05-query-engine.ipynb
│   ├── 06-command-skills.ipynb
│   ├── 07-mcp-plugins.ipynb
│   ├── 08-state-management-ui.ipynb
│   ├── 09-full-integration.ipynb
│   └── scripts/                 # Notebook 构建脚本
│       └── _build_nb*.js
└── references/
    └── papers.md
```

## 环境设置

```bash
# 安装依赖
pip install -r requirements.txt

# 如果要重新构建 notebook（可选）
cd notebooks/scripts
node build_all.sh
```

## 阅读顺序

按编号顺序阅读：00 → 01 → 02 → ... → 09。每章都建立在前一章的基础上。

## 技术栈

| 项目 | 说明 |
|------|------|
| 原始项目 | TypeScript + React + Ink + Zod v4 |
| 本教程 | Python + Pydantic v2 + Jupyter |

我们保留了原始 TypeScript 的设计思想，用 Python 习惯的方式重新实现。

## 声明

- 原始源码版权归 [Anthropic](https://www.anthropic.com) 所有
- 本教程仅用于技术研究与学习
- 还原源码来自公开 npm 包的 Source Map
