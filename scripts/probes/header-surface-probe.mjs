// 离线 CSS/DOM 回归：保护 #258 的结构锚，不连接 DSH、不读取登录态。
// Node >=24 + Chromium；DSH_PROBE_CHROME=/path/to/chrome node scripts/probes/header-surface-probe.mjs
// 仅为合成结构验证，不替代真机/真实 profile 验收。读取完整四层源码 CSS，顺序与入口一致。
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { MOBILE_CSS } from '../../src/client/styles/index.ts'
import { createCdpClient } from '../lib/probe-cdp-client.mjs'

const chromePath = process.env.DSH_PROBE_CHROME || 'chromium'
const timeoutMs = Number(process.env.DSH_PROBE_TIMEOUT_MS || 15000)
const prefix = join(await realpath(tmpdir()), 'dsh-header-surface-')
const profile = await mkdtemp(prefix)
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
  `--user-data-dir=${profile}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] })
// 提前订阅，覆盖启动失败和正常关闭；不按进程名称清理，不碰正在使用的浏览器。
const exited = new Promise((resolve) => {
  chrome.once('error', resolve)
  chrome.once('exit', resolve)
})
let ws
let passed = 0

async function deadline(promise, label) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label}: timeout`)), timeoutMs) }),
    ])
  } finally { clearTimeout(timer) }
}

function fixture({ prefix: hash = 'kiGsTW', wrapped = true, theme = '', hidden = '', noTokens = false }, css) {
  const darkHtml = theme === 'html-dark' ? 'data-ds-dark-theme' : ''
  const darkBody = theme === 'body-dark' || theme === 'wallpaper' ? 'data-ds-dark-theme' : ''
  const wallpaper = theme === 'wallpaper' ? 'data-dsh-bg' : ''
  return `<!doctype html><html ${darkHtml}><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    ${noTokens ? '' : ':root { --dsw-alias-bg-base:#fff; --dsw-alias-bg-layer-1:#fff; --dsw-static-neutral-bluish-950:#151517 }'}
    [data-ds-dark-theme] { --dsw-alias-bg-base:#151517; --dsw-alias-bg-layer-1:#232324 }
    body[data-dsh-bg] { --dsw-alias-bg-base:transparent }
    html,body { margin:0; height:100% }
    .fixture-frame,.fixture-phase { height:100%; position:relative }
    .fixture-phase { display:flex; flex-direction:column }
    .fixture-header { flex-shrink:0; min-height:63px; box-sizing:border-box; padding:8px; display:grid }
    .fixture-flow { flex:1; min-height:0; overflow:auto; position:relative; z-index:7 }
    .fixture-message { height:1200px; background:#f99 }
    .fixture-frame > main { height:100% }
    #menu { display:none; position:absolute; top:100%; right:8px; width:90px; height:40px; z-index:1000 }
    #overlay { display:none; position:fixed; inset:0; background:#777; z-index:55 }
  </style><style>${css}</style></head><body ${darkBody} ${wallpaper}>
    <div data-mobile-nav="frame" class="fixture-frame"><aside style="display:none"></aside><main>
    <section data-phase="conversation" class="fixture-phase">${wrapped ? '<div style="display:contents">' : ''}
    <header id="header" class="fixture-header ${hash}_header ${hidden ? hash + '_' + hidden : ''}">
      ${hidden ? '' : `<div class="${hash}_headerLeading extra-token "></div>
      <div class="${hash}_titleRow"><span>会话标题</span><input id="rename" aria-label="重命名"></div>
      <div class="${hash}_tabs"><div data-conversation-tabs><button>对话</button></div></div>
      <div id="menu">菜单</div>`}
    </header>${wrapped ? '</div>' : ''}
    <div id="flow" class="fixture-flow ${hash}_scrollBody"><div class="fixture-message">滚动正文</div>
      <div><header id="question" class="Mbwy4a_header"><div class="Mbwy4a_headingBlock"><span>确认位置</span><h2 id="question-title" class="Mbwy4a_title">问题正文可复制</h2></div></header></div>
    </div></section></main></div><div id="overlay">遮罩</div>
  </body></html>`
}

// 在浏览器中执行，包含命中测试，不以源码包含某个字符串代替行为验收。
function measure() {
  const header = document.querySelector('#header')
  const flow = document.querySelector('#flow')
  const height = header.getBoundingClientRect().height
  document.querySelector('[data-mobile-nav="frame"]').style.setProperty('--mobile-nav-header-h', `${height}px`)
  flow.scrollTop = 120
  const style = getComputedStyle(header)
  const rect = header.getBoundingClientRect()
  const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
  const question = getComputedStyle(document.querySelector('#question'))
  const title = document.querySelector('#question-title')
  const normal = {
    background: style.backgroundColor, z: style.zIndex, position: style.position,
    select: style.userSelect, inputSelect: document.querySelector('#rename') ? getComputedStyle(document.querySelector('#rename')).userSelect : null,
    questionSelect: question.userSelect, questionZ: question.zIndex,
    questionTitleSelect: getComputedStyle(title).userSelect, questionTitleHeight: title.getBoundingClientRect().height,
    headerOnTop: header.contains(hit), height, padding: style.padding,
    margin: getComputedStyle(flow).marginTop, flowPadding: getComputedStyle(flow).paddingTop,
    mobile: matchMedia('(max-width:1023px) and (pointer:coarse)').matches,
    coarse: matchMedia('(pointer:coarse)').matches, fine: matchMedia('(pointer:fine)').matches,
    noPointer: matchMedia('(pointer:none)').matches, flowScroll: flow.scrollTop,
  }
  document.documentElement.setAttribute('data-mobile-nav-selecting', '')
  normal.yielded = getComputedStyle(header).pointerEvents
  document.documentElement.removeAttribute('data-mobile-nav-selecting')
  normal.restored = getComputedStyle(header).pointerEvents
  const menu = document.querySelector('#menu')
  if (menu) {
    menu.style.display = 'block'
    const mr = menu.getBoundingClientRect()
    normal.menuOnTop = menu.contains(document.elementFromPoint(mr.x + 10, mr.y + 10))
  }
  document.querySelector('#overlay').style.display = 'block'
  normal.overlayOnTop = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.id === 'overlay'
  return normal
}

try {
  const browserUrl = await deadline(new Promise((resolve, reject) => {
    let stderr = ''
    chrome.on('error', reject)
    chrome.once('exit', (code) => reject(new Error(`Chrome exited during boot: ${code}`)))
    chrome.stderr.on('data', (data) => {
      stderr += data
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/)
      if (match) resolve(match[1])
    })
  }), 'Chrome boot')
  const targets = await (await fetch(`http://${new URL(browserUrl).host}/json`, { signal: AbortSignal.timeout(timeoutMs) })).json()
  ws = new WebSocket(targets.find((target) => target.type === 'page').webSocketDebuggerUrl)
  await deadline(once(ws, 'open'), 'CDP connect')
  const { send } = createCdpClient({ ws, requestDeadlineMs: timeoutMs })
  await send('Page.enable')
  const { frameTree } = await send('Page.getFrameTree')
  async function sample(scene, css) {
    await send('Page.setDocumentContent', { frameId: frameTree.frame.id, html: fixture(scene, css) })
    const result = await send('Runtime.evaluate', { expression: `(${measure.toString()})()`, returnByValue: true })
    assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  const scenes = [
    { name: '旧前缀/直接子层', prefix: 'wSkVaW', wrapped: false },
    { name: '新前缀/插入包裹层' },
    { name: '任意前缀/无颜色 token', prefix: 'FutureHost', noTokens: true },
    { name: '深色/html', theme: 'html-dark' },
    { name: '深色/body', theme: 'body-dark' },
    { name: '深色/壁纸', theme: 'wallpaper' },
    { name: '隐藏页头', hidden: 'headerHidden' },
    { name: '空白页头', hidden: 'headerBlank' },
    ...[360, 767, 768, 1023, 1024].map((width) => ({ name: `触屏-${width}`, width })),
    { name: '窄屏鼠标', fine: true }, { name: '宽屏鼠标', width: 1440, fine: true },
  ]
  for (const scene of scenes) {
    await send('Emulation.setDeviceMetricsOverride', { width: scene.width || 390, height: 844, deviceScaleFactor: 1, mobile: !scene.fine })
    await send('Emulation.setTouchEmulationEnabled', { enabled: !scene.fine, maxTouchPoints: 1 })
    const actual = await sample(scene, MOBILE_CSS)
    assert.equal(actual.mobile, !scene.fine && (scene.width || 390) < 1024, scene.name)
    assert.equal(actual.coarse, !scene.fine, scene.name)
    assert.equal(actual.fine, !!scene.fine, scene.name)
    assert.equal(actual.noPointer, false, scene.name)
    if (scene.hidden) assert.equal(actual.height, 0, scene.name)
    else if (!actual.mobile) assert.deepEqual(actual, await sample(scene, ''), `${scene.name}: 非移动档必须保持未安装形态`)
    else {
      assert.equal(actual.background, scene.theme ? 'rgb(21, 21, 23)' : 'rgb(255, 255, 255)', scene.name)
      assert.equal(actual.position, 'relative', scene.name)
      assert.equal(actual.z, '30', scene.name)
      assert.equal(actual.headerOnTop, true, scene.name)
      assert.equal(actual.select, 'none', scene.name)
      assert.equal(actual.inputSelect, 'text', scene.name)
      assert.notEqual(actual.questionSelect, 'none', scene.name)
      assert.equal(actual.questionZ, 'auto', scene.name)
      assert.notEqual(actual.questionTitleSelect, 'none', scene.name)
      assert.equal(actual.flowScroll, 120, `${scene.name}: 必须实际滚动正文`)
      assert.ok(actual.questionTitleHeight > 0, `${scene.name}: 问题正文不可被隐藏`)
      assert.equal(actual.yielded, 'none', scene.name)
      assert.equal(actual.restored, 'auto', scene.name)
      assert.equal(actual.menuOnTop, true, scene.name)
      assert.equal(actual.overlayOnTop, true, scene.name)
      assert.equal(actual.margin, `-${actual.height}px`, scene.name)
      assert.equal(actual.flowPadding, `${actual.height}px`, scene.name)
    }
    console.log(`PASS ${scene.name} ${JSON.stringify(actual)}`)
    passed++
  }
  // 变异对照：退回固定前缀必须重现穿透；去掉抬层也必须被真实命中测试识别。
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
  const legacy = await sample({}, MOBILE_CSS.replaceAll('header:has([class*="_headerLeading"])', 'header.wSkVaW_header'))
  assert.equal(legacy.background, 'rgba(0, 0, 0, 0)')
  assert.equal(legacy.z, 'auto')
  assert.equal(legacy.headerOnTop, false)
  const unraised = await sample({}, MOBILE_CSS + '@media (max-width:1023px) and (pointer:coarse) { #header { z-index:auto !important } }')
  assert.equal(unraised.headerOnTop, false)
  const broad = await sample({}, MOBILE_CSS.replaceAll('header:has([class*="_headerLeading"])', 'header'))
  assert.equal(broad.questionSelect, 'none')
  assert.equal(broad.questionZ, '30')
  console.log(`PASS 变异对照：固定前缀/缺失抬层重现穿透，裸 header 误伤提问卡；SUMMARY ${passed} scenes + 3 mutations`)
} finally {
  if (ws) ws.close()
  if (chrome.exitCode === null && chrome.signalCode === null) chrome.kill('SIGKILL')
  await deadline(exited, 'Chrome cleanup')
  const resolved = await realpath(profile)
  assert.ok(resolved.startsWith(prefix) && !resolved.slice(prefix.length).includes(sep), '只删除本次创建的临时 profile')
  await rm(resolved, { recursive: true, force: true })
  console.log('CLEANUP 自有浏览器已退出，临时 profile 已删除')
}
