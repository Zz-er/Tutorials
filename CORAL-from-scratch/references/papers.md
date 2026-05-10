# 参考资料

## 项目来源

- [CORAL GitHub](https://github.com/anthropics/coral) — 原始项目仓库

## 关键技术文档

- [OmegaConf 文档](https://omegaconf.readthedocs.io/) — 结构化配置库
- [Git Worktrees](https://git-scm.com/docs/git-worktree) — Git 工作树隔离机制
- [Python Protocols (PEP 544)](https://peps.python.org/pep-0544/) — 结构化子类型 / 鸭子类型协议
- [Claude Code 文档](https://docs.anthropic.com/en/docs/claude-code) — Claude Code CLI 工具

## 设计模式

- Protocol 模式（运行时可检查的鸭子类型）
- 模板方法模式（BaseGrader / TaskGrader）
- 装饰器模式（FunctionGrader.wrap）
- 文件系统作为数据库（Attempts JSON、Notes Markdown）
- 符号链接共享状态（跨 worktree 共享 .coral/public/）
