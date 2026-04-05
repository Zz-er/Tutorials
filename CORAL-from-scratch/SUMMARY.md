# CORAL 教程 — 章节总览

| 编号 | 文件名 | 内容概述 |
|------|--------|----------|
| 00 | `00-why-coral.ipynb` | 自主代理编排的痛点与 CORAL 的解决方案，含架构总览图 |
| 01 | `01-core-types.ipynb` | 从零实现 Task、Score、ScoreBundle、Attempt 四大核心类型 |
| 02 | `02-config-system.ipynb` | 用 OmegaConf 构建 YAML 配置系统，支持 dotlist 覆盖 |
| 03 | `03-grader-system.ipynb` | 实现评分器协议链：Protocol → BaseGrader → TaskGrader → FunctionGrader |
| 04 | `04-hub-shared-state.ipynb` | 构建 Attempts CRUD、Notes 笔记、Skills 技能三大共享状态模块 |
| 05 | `05-workspace-isolation.ipynb` | Git Worktree 隔离、符号链接共享状态、代理权限模型 |
| 06 | `06-eval-pipeline.ipynb` | 实现完整评估流水线：暂存→提交→评分→记录→反馈 |
| 07 | `07-agent-runtime.ipynb` | 实现代理运行时协议、进程管理、心跳监控、自动重启 |
| 08 | `08-cli-commands.ipynb` | CLI 命令系统：17 条命令的分组调度、排行榜、评估、会话管理 |
| 09 | `09-full-integration.ipynb` | 端到端集成演示：组装所有模块，完整 3 代理排序优化模拟 |
