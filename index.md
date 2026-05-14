---
layout: home

hero:
  name: "Shannon Design"
  text: "AI渗透测试Agent设计文档"
  tagline: "基于 Claude Agent SDK + Temporal + Docker"
  image:
    src: https://raw.githubusercontent.com/Keygraph-AI/shannon/main/assets/shannon-screen.png
    alt: Shannon
  actions:
    - theme: brand
      text: 架构概览
      link: /architecture
    - theme: brand
      text: CLI Package
      link: /cli-package
    - theme: brand
      text: Worker Package
      link: /worker-package

features:
  - icon: 🏗️
    title: 架构概览
    details: Monorepo架构，CLI+Worker双模块，Temporal工作流编排
  - icon: ⚡
    title: CLI双模式
    details: npx零安装 vs 本地开发，自动检测切换
  - icon: 🔍
    title: 5阶段Pipeline
    details: Pre-Recon → Recon → Vuln Analysis → Exploitation → Reporting
  - icon: 🐳
    title: Docker容器隔离
    details: 每次扫描独立容器，Temporal持久化工作流状态
  - icon: 🤖
    title: Claude Agent SDK
    details: 5个并行Agent (injection/xss/auth/authz/ssrf)，智能重试
  - icon: 📊
    title: 输出报告
    details: 执行摘要、技术细节、可操作建议
---

# Shannon Design 文档

Shannon 是一款 AI 驱动的渗透测试 Agent，用于防御性安全分析。基于 Claude Code Agent SDK + Temporal workflow + Docker 容器化。

## 核心特性

- **Monorepo 架构**：Apps/cli + Apps/worker 双模块，Turborepo 任务编排
- **双 CLI 模式**：npx 零安装 vs 本地开发，自动检测切换
- **5 阶段 Pipeline**：Pre-Recon → Recon → Vuln Analysis → Exploitation → Reporting
- **Docker 容器隔离**：每次扫描独立容器，环境持久化
- **Temporal 工作流编排**：Crash recovery、查询式进度追踪、智能重试
- **并行 Agent 执行**：5 个攻击域并行分析 + 条件触发式 Exploitation

## 快速导航

| 文档 | 说明 |
|---|---|
| [架构概览](/architecture) | Monorepo 结构、Docker 架构、组件关系 |
| [CLI Package](/cli-package) | 命令列表、双模式机制、状态管理、配置解析 |
| [Worker Package](/worker-package) | Temporal 编排、Agent 执行、AI 集成 |
