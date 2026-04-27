import { defineConfig } from 'wxt'

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  srcDir: 'src',
  manifest: {
    name: 'Vynl — Webpage Capture',
    description: 'Capture any webpage into your Vynl project with one click. Save live pages, localhost builds, and staging sites instantly.',
    version: '1.0.3',
    permissions: ['activeTab', 'scripting', 'storage', 'tabs'],
    host_permissions: [
      'https://vynl.in/*',
      'file:///*'
    ],
    action: {
      default_popup: 'popup/index.html',
      default_title: 'Vynl',
      default_icon: {
        '16': 'icons/icon-16.png',
        '32': 'icons/icon-32.png',
        '48': 'icons/icon-48.png',
        '128': 'icons/icon-128.png'
      }
    },
    icons: {
      '16': 'icons/icon-16.png',
      '32': 'icons/icon-32.png',
      '48': 'icons/icon-48.png',
      '128': 'icons/icon-128.png'
    }
  }
})
