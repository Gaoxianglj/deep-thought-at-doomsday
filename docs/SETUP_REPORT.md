# Setup Report

项目:《末日时在深度思考中》(英文名 Deep Thought at Doomsday)。纯前端单机 PWA,本报告只记录环境搭建,尚无任何游戏逻辑。

## 环境

- Node v22.22.1,npm 11.18.0,git 2.33.0,gh 2.96.0(账号 Gaoxianglj)
- 本地根文件夹名 `Doomsday_survival_game`;npm 包名/仓库名 `deep-thought-at-doomsday`

## 依赖(实际安装版本)

- 运行依赖:zod 4.6.7
- 开发依赖:typescript 6.0.3、vite 8.3.8、vitest 5.1.0、vite-plugin-pwa 2.0.0、tsx 4.23.15、eslint 10.14.0、@eslint/js 10.0.1、typescript-eslint 8.72.2、eslint-config-prettier 10.1.8、globals 17.14.0、prettier 3.10.1

## 目录结构

```
src/{engine,ui,save,data}/   空目录(.gitkeep),另有 main.ts、style.css(占位页)
scripts/  docs/              scripts 为空;docs 含本文件
tests/                       含 placeholder.test.ts(1+1=2)
public/art/{characters,items,locations,ui}/   空目录(.gitkeep)
public/                      pwa-192x192.png、pwa-512x512.png、apple-touch-icon.png(纯色占位图标)
.github/workflows/deploy.yml
```

配置文件:`vite.config.ts`、`tsconfig.json`(strict)、`eslint.config.js`(flat config)、`.prettierrc`。

## 脚本

`npm run` + `dev` | `dev:host`(vite --host,局域网访问)| `build`(tsc && vite build)| `preview` | `test`(vitest run)| `lint` | `format`

## 仓库与部署

- 仓库:https://github.com/Gaoxianglj/deep-thought-at-doomsday(公开)
- Pages 网址:https://gaoxianglj.github.io/deep-thought-at-doomsday/
- 部署:推送到 `main` 触发 GitHub Actions(`deploy.yml`:npm ci → build → upload-pages-artifact → deploy-pages)。Pages 来源为 GitHub Actions。
- `vite.config.ts` 的 `base` 为 `/deep-thought-at-doomsday/`;引用静态资源请用相对 base 的方式(Vite 会处理 public/ 下的绝对路径)。

## 注意事项

- **TypeScript 固定在 6.0.x**:Vite 模板默认给的是 TypeScript 7.0,但 typescript-eslint 8.72 的 peer 要求 `<6.1.0`,装 7.0 会 ERESOLVE。待 typescript-eslint 支持 7.x 后再升级。
- PWA 图标是纯色占位图,需要后续替换(替换同名文件即可)。manifest 为 vite-plugin-pwa 最小配置,`registerType: 'autoUpdate'`。
- tsconfig 保留了模板的 `erasableSyntaxOnly`(禁用 enum、namespace、参数属性等不可擦除语法)。
- npm 安装时有 `allow-scripts` 警告(fsevents、esbuild postinstall 未列入白名单),不影响 dev/build/test/tsx,均已验证可用。
- iPhone 局域网预览:`npm run dev:host`,手机与 Mac 同一 Wi-Fi,访问终端打印的 Network 地址(注意带 `/deep-thought-at-doomsday/` 路径)。局域网 http 下 Service Worker 不生效,PWA 安装需在 Pages 的 https 地址测试。
