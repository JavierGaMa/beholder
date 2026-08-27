import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Beholder",
  description: "Non-invasive network traffic inspector for React Native apps on Android emulators",
  lang: "en-US",
  cleanUrls: true,
  lastUpdated: true,

  head: [["meta", { name: "theme-color", content: "#000000" }]],

  themeConfig: {
    search: {
      provider: "local",
      options: {
        translations: {
          button: { buttonText: "Search docs", buttonAriaLabel: "Search" },
          modal: { noResultsText: "No results" },
        },
      },
    },

    nav: [
      { text: "Guide", link: "/guide/getting-started", activeMatch: "/guide/" },
      { text: "Configuration", link: "/config/", activeMatch: "/config/" },
      { text: "Troubleshooting", link: "/troubleshooting" },
      { text: "Development", link: "/development" },
    ],

    sidebar: {
      "/guide/": [
        {
          text: "Guide",
          items: [
            { text: "Getting started", link: "/guide/getting-started" },
            { text: "Capturing traffic", link: "/guide/capture" },
            { text: "Emulator management", link: "/guide/emulators" },
            { text: "Doctor", link: "/guide/doctor" },
            { text: "Exports", link: "/guide/exports" },
          ],
        },
      ],
      "/config/": [{ text: "Configuration", items: [{ text: "config.toml", link: "/config/" }] }],
    },

    outline: { level: [2, 3] },
    socialLinks: [{ icon: "github", link: "https://github.com/JavierGaMa/beholder" }],

    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright © 2026 The Beholder Authors",
    },
  },
});
