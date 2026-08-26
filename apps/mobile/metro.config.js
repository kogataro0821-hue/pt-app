// Expo をモノレポで動かすための設定。
// これが無いと Metro が packages/ 配下のワークスペースを解決できません。
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1) モノレポ全体を監視する（packages/core を編集したら即反映されるように）
config.watchFolders = [workspaceRoot];

// 2) node_modules の探索先を、アプリ直下 → ワークスペースルート の順にする
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// 3) 上位ディレクトリを無限に遡らせない（重複解決による不具合を防ぐ）
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
