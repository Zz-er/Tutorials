# CORAL 从零到精通 — 手撕自主编码代理编排系统

> 通过 Jupyter Notebook 从零开始重新实现 CORAL，深入理解自主编码代理编排的每一个细节。

## 什么是 CORAL？

CORAL 是一个**自主编码代理的编排系统**。核心模式：

```
生成代理 → 代理读取指令 → 编辑代码 → 提交评估 → 获取反馈 → 循环优化
```

多个 AI 代理在独立的 git worktree 中并行工作，通过共享状态（笔记、技能、尝试记录）协作，由评分器自动评估每次提交。

## 教程结构

| 编号 | 章节 | 核心内容 |
|------|------|----------|
| 00 | 为什么需要 CORAL | 动机、问题定义、整体架构 |
| 01 | 核心类型系统 | Task, Score, ScoreBundle, Attempt |
| 02 | 配置系统 | YAML 配置、OmegaConf、dotlist 覆盖 |
| 03 | 评分器系统 | Protocol → BaseGrader → TaskGrader → FunctionGrader |
| 04 | 共享状态中心 | Attempts CRUD、Notes、Skills |
| 05 | 工作空间隔离 | Git Worktree、符号链接、权限模型 |
| 06 | 评估流水线 | git commit → 评分 → 记录尝试 |
| 07 | 代理运行时与管理器 | 进程生命周期、心跳、自动重启 |
| 08 | CLI 命令系统 | 17 条命令调度、排行榜、评估、会话管理 |
| 09 | 全局集成 | 端到端 3 代理排序优化模拟、设计哲学总结 |

## 阅读顺序

**请按编号顺序阅读**。后续 notebook 会导入前面章节在 `our-implementation/` 中构建的模块。

## 环境准备

```bash
# 1. 安装依赖
pip install -r requirements.txt

# 2. 按顺序运行 notebook
cd notebooks/
jupyter lab
```

## 目录说明

```
CORAL-from-scratch/
├── README.md                 # 本文件
├── SUMMARY.md                # 所有 notebook 一句话描述
├── requirements.txt          # 运行 notebook 所需依赖
├── skill-optimization-notes.md  # reimpl-tutorial skill 优化建议
├── original-tests/           # 从原项目复制的测试
├── our-implementation/       # 逐步构建的重新实现
├── notebooks/                # 教程 notebook（按编号排列）
├── scripts/                  # notebook 构建脚本（_build_nb*.js）
└── references/               # 参考文献与论文
```
