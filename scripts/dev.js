// 使用esbuild更快
// 使用rollup进行构建，因为生成的文件更小，tree-shaking更好

// @ts-check
// 基于 Golang 开发的一款打包工具，相比传统的打包工具，主打性能优势，在构建速度上可以快10~100 倍。
const { build } = require('esbuild')
const nodePolyfills = require('@esbuild-plugins/node-modules-polyfill')
const { resolve, relative } = require('path')
// minimist 轻量级命令行参数解析引擎
const args = require('minimist')(process.argv.slice(2))


const target = args._[0] || 'vue'
const format = args.f || 'global'
const inlineDeps = args.i || args.inline
const pkg = require(resolve(__dirname, `../packages/${target}/package.json`))

// 输出文件格式参照esbuild文档 输出有三种文件格式下面引用中有详细介绍
const outputFormat = format.startsWith('global')
  ? 'iife'
  : format === 'cjs'
    ? 'cjs'
    : 'esm'
// 输出文件名
const postfix = format.endsWith('-runtime')
  ? `runtime.${format.replace(/-runtime$/, '')}`
  : format

const outfile = resolve(
  __dirname,
  `../packages/${target}/dist/${target === 'vue-compat' ? `vue` : target
  }.${postfix}.js`
)
// 获取文件路径，用于监听文件变更和编译完成的打印
const relativeOutfile = relative(process.cwd(), outfile)

// resolve externals
// TODO this logic is largely duplicated from rollup.config.js
let external = []
// 如果不是inline模式打包，则一下模块不会在编译的时候打包进去
if (!inlineDeps) {
  // cjs & esm-bundler: external all deps
  if (format === 'cjs' || format.includes('esm-bundler')) {
    external = [
      ...external,
      ...Object.keys(pkg.dependencies || {}),
      // peerDependencies核心依赖库，仅会在上层安装一次。防止冗余安装
      ...Object.keys(pkg.peerDependencies || {}),
      // for @vue/compiler-sfc / server-renderer
      'path',
      'url',
      'stream'
    ]
  }

  // 如果是单文件编译，则以下模块不会被编译打包
  if (target === 'compiler-sfc') {
    const consolidateDeps = require.resolve('@vue/consolidate/package.json', {
      paths: [resolve(__dirname, `../packages/${target}/`)]
    })
    external = [
      ...external,
      ...Object.keys(require(consolidateDeps).devDependencies),
      'fs',
      'vm',
      'crypto',
      'react-dom/server',
      'teacup/lib/express',
      'arc-templates/dist/es5',
      'then-pug',
      'then-jade'
    ]
  }
}

build({
  // 入口文件
  entryPoints: [resolve(__dirname, `../packages/${target}/src/index.ts`)],
  // 输出文件
  outfile,
  // 将依赖项内联到文件本身
  bundle: true,
  // 将文件或包标记为外部，从生产中排除，这个在rollup中有相同功能
  external,
  // 源映射可以让调试更容易一些
  sourcemap: true,
  // iife: 代表“立即调用的函数表达式”，旨在在浏览器中运行。 Commonjs  ESM 不用多说
  format: outputFormat,
  // 仅当格式设置为iife（表示立即调用的函数表达式）时，此选项才起作用。它设置用于存储从入口点导出的全局变量的名称
  globalName: pkg.buildOptions?.name,
  // 设置node环境运行还是浏览器环境运行
  platform: format === 'cjs' ? 'node' : 'browser',
  // 拓展插件，抹平调用差异
  plugins:
    format === 'cjs' || pkg.buildOptions?.enableNonBrowserBranches

      ? [nodePolyfills.default()]
      : undefined,
  // 常量表达式替换全局标识，用于在构建质检替换某些代码
  define: {
    __COMMIT__: `"dev"`,
    __VERSION__: `"${pkg.version}"`,
    __DEV__: `true`,
    __TEST__: `false`,
    __BROWSER__: String(
      format !== 'cjs' && !pkg.buildOptions?.enableNonBrowserBranches
    ),
    __GLOBAL__: String(format === 'global'),
    __ESM_BUNDLER__: String(format.includes('esm-bundler')),
    __ESM_BROWSER__: String(format.includes('esm-browser')),
    __NODE_JS__: String(format === 'cjs'),
    __SSR__: String(format === 'cjs' || format.includes('esm-bundler')),
    __COMPAT__: String(target === 'vue-compat'),
    __FEATURE_SUSPENSE__: `true`,
    __FEATURE_OPTIONS_API__: `true`,
    __FEATURE_PROD_DEVTOOLS__: `false`
  },
  // 告诉esbuild监听文件修改
  watch: {
    onRebuild(error) {
      if (!error) console.log(`rebuilt: ${relativeOutfile}`)
    }
  }
}).then(() => {
  console.log(`watching: ${relativeOutfile}`)
})
