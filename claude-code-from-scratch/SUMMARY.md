# Claude Code From Scratch — 章节目录

## Part 1: 基础

| # | Notebook | 内容 |
|---|----------|------|
| 00 | [Why This Project](notebooks/00-why-this-project.ipynb) | 项目概述、架构全景图、核心概念速览 |
| 01 | [Source Map Extraction](notebooks/01-sourcemap-extraction.ipynb) | Source Map 原理、VLQ 编码、源码还原工具实现 |
| 02 | [Tool Protocol](notebooks/02-tool-protocol.ipynb) | Tool 接口、buildTool()、Pydantic schema、ToolRegistry |

## Part 2: 核心工具

| # | Notebook | 内容 |
|---|----------|------|
| 03 | [File Operation Tools](notebooks/03-file-tools.ipynb) | FileRead、FileEdit、Grep、Glob 工具实现 |
| 04 | [Bash & Permissions](notebooks/04-bash-permissions.ipynb) | Bash 工具、命令分类、权限规则系统、沙箱概念 |

## Part 3: 引擎与扩展

| # | Notebook | 内容 |
|---|----------|------|
| 05 | [Query Engine](notebooks/05-query-engine.ipynb) | Agentic Loop、消息类型、上下文压缩 |
| 06 | [Commands & Skills](notebooks/06-command-skills.ipynb) | 斜杠命令、Frontmatter 解析、技能发现 |
| 07 | [MCP & Plugins](notebooks/07-mcp-plugins.ipynb) | MCP 客户端、传输层、插件生命周期 |

## Part 4: UI 与集成

| # | Notebook | 内容 |
|---|----------|------|
| 08 | [State & UI](notebooks/08-state-management-ui.ipynb) | AppState、React Context、Ink 渲染 |
| 09 | [Full Integration](notebooks/09-full-integration.ipynb) | 端到端集成、架构回顾、扩展方向 |
