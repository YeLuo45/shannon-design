# Shannon Design

Shannon AI Pentesting Agent 架构设计文档站。

基于 [Shannon](https://github.com/Keygraph-AI/shannon) 开源项目构建。

## 文档

- [架构概览](/architecture) - Monorepo架构、CLI+Worker双模块
- [CLI Package](/cli-package) - 双CLI模式、状态管理、配置解析
- [Worker Package](/worker-package) - Temporal编排、Agent执行
- [Pipeline](/pipeline) - 5阶段渗透测试Pipeline
- [Temporal](/temporal) - 工作流编排、Crash恢复、进度查询
- [Docker](/docker) - 容器隔离、网络架构
- [配置系统](/configuration) - YAML配置、JSON Schema、环境变量

## 技术栈

- **文档框架**: VitePress
- **部署**: GitHub Pages (workflow mode)
- **源码**: [Keygraph-AI/shannon](https://github.com/Keygraph-AI/shannon)
