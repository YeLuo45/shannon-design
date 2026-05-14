import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Shannon Design",
  description: "Shannon AI Pentesting Agent 架构设计文档站",
  base: "/shannon-design/",
  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "https://raw.githubusercontent.com/Keygraph-AI/shannon/main/assets/shannon-banner.png" }],
  ],
  themeConfig: {
    logo: "https://raw.githubusercontent.com/Keygraph-AI/shannon/main/assets/shannon-banner.png",
    nav: [
      { text: "首页", link: "/" },
      { text: "架构", link: "/architecture" },
      { text: "CLI", link: "/cli-package" },
      { text: "Worker", link: "/worker-package" },
      { text: "Pipeline", link: "/pipeline" },
      { text: "Temporal", link: "/temporal" },
      { text: "Docker", link: "/docker" },
      { text: "配置", link: "/configuration" },
    ],
    sidebar: [
      {
        text: "文档",
        items: [
          { text: "首页", link: "/" },
          { text: "架构概览", link: "/architecture" },
          { text: "CLI Package", link: "/cli-package" },
          { text: "Worker Package", link: "/worker-package" },
          { text: "Pipeline", link: "/pipeline" },
          { text: "Temporal", link: "/temporal" },
          { text: "Docker", link: "/docker" },
          { text: "配置系统", link: "/configuration" },
        ],
      },
    ],
    socialLinks: [
      { icon: "github", link: "https://github.com/Keygraph-AI/shannon" },
    ],
    footer: {
      message: "基于 Shannon 开源项目构建",
      copyright: "Copyright © 2024-present Shannon Contributors",
    },
  },
  ignoreDeadLinks: true,
});
