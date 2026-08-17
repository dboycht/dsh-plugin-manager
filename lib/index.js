/**
 * dsh-plugin-manager — Host half.
 *
 * A permanently-installed DeepSeek Harness plugin that manages plugins:
 *
 *  - lists every deployment plugin (Cordis Loader entries) and every dynamic
 *    Cordis plugin (dynamicCordisRunner.inventory());
 *  - keeps per-plugin notes in `<workspaceRoot>/.dsh-plugin-notes.json`
 *    (UTF-8, survives restarts), with fallback reads from legacy roots and a
 *    write-through migration so a moved working directory never loses notes;
 *  - exports/imports the full notes JSON for backup and restore;
 *  - starts/stops dynamic plugins through dynamicCordisRunner.
 *
 * It exposes two channels:
 *  1. a model tool named `plugin_manager` (registered via ctx.tools.register);
 *  2. a JSON HTTP API under `/_dsh/plugin-manager` for the Settings UI
 *     (registered via ctx.webServer), called same-origin with fetch().
 *
 * This is the "permanent" form of the plugin. The dynamic (process-local)
 * form lives in ./dynamic for quick agent-driven installs.
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { promises as fsp } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'plugin-manager'
export const inject = ['tools']

const PHASE = { 0: 'pending', 1: 'loading', 2: 'active', 3: 'failed', 4: null, 5: 'unloading' }

/**
 * Legacy notes-file roots: directories a previous run used as its working
 * directory. ensureStore() falls back through these so a changed working
 * directory never looks like lost data, and writes a copy into the current
 * root so both stay in sync.
 */
const LEGACY_ROOTS = ['D:/Program New/DeepSeekHarness/DSH Desktop']

export function apply(ctx) {
  let store = null
  let notesPath = ''

  async function ensureStore() {
    if (store !== null) return store
    store = { version: 1, enabled: true, notes: {} }
    const fs = ctx.get('fs')
    const sp = ctx.get('sandboxPolicy')
    let root = ''
    try {
      if (sp && typeof sp.workspaceRoot === 'string') root = sp.workspaceRoot
    } catch (e) {
      root = ''
    }
    notesPath = root ? root.replace(/[\\/]+$/, '') + '/.dsh-plugin-notes.json' : ''
    if (!fs || !notesPath) return store
    const candidates = [notesPath]
    for (const r of LEGACY_ROOTS) {
      const p = r.replace(/[\\/]+$/, '') + '/.dsh-plugin-notes.json'
      if (p !== notesPath && candidates.indexOf(p) === -1) candidates.push(p)
    }
    let loadedFrom = null
    for (const p of candidates) {
      try {
        const target = await fs.resolve(p)
        const text = await fs.readText(target)
        if (text) {
          const parsed = JSON.parse(text)
          if (parsed && typeof parsed === 'object' && parsed.notes && typeof parsed.notes === 'object') {
            store.notes = parsed.notes
            if (typeof parsed.enabled === 'boolean') store.enabled = parsed.enabled
            loadedFrom = p
          }
        }
      } catch (e) {
        /* missing or unreadable: try the next candidate */
      }
      if (loadedFrom !== null) break
    }
    if (loadedFrom !== null && loadedFrom !== notesPath) {
      try {
        const target = await fs.resolve(notesPath)
        await fs.writeText(target, JSON.stringify(store, null, 2))
      } catch (e) {
        /* migration failure must not block reads */
      }
    }
    return store
  }

  async function persist() {
    if (!store) return { ok: false, error: 'store not initialized' }
    const fs = ctx.get('fs')
    if (!fs || !notesPath) return { ok: false, error: '备注文件不可用（无 fs 或 workspaceRoot），仅保存在内存' }
    try {
      const target = await fs.resolve(notesPath)
      await fs.writeText(target, JSON.stringify(store, null, 2))
      return { ok: true }
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) }
    }
  }

  async function saveNote(key, note) {
    if (!key) return { ok: false, error: 'key 不能为空' }
    if (key.length > 200) return { ok: false, error: 'key 过长（最多 200 字符）' }
    const s = await ensureStore()
    if (!s.enabled) return { ok: false, error: '插件管理已禁用，请先启用' }
    s.notes[key] = { note: String(note || '').slice(0, 4000), updatedAt: new Date().toISOString() }
    return persist()
  }

  async function removeNote(key) {
    if (!key) return { ok: false, error: 'key 不能为空' }
    const s = await ensureStore()
    if (!s.enabled) return { ok: false, error: '插件管理已禁用，请先启用' }
    if (Object.prototype.hasOwnProperty.call(s.notes, key)) delete s.notes[key]
    return persist()
  }

  function owningAgent(agentId) {
    const agents = ctx.get('agents')
    if (!agents || typeof agents.list !== 'function') return undefined
    try {
      const list = agents.list()
      if (!Array.isArray(list)) return undefined
      return list.find((a) => a && a.id === String(agentId))
    } catch (e) {
      return undefined
    }
  }

  async function stopPlugin(agentId, pluginId) {
    const s = await ensureStore()
    if (!s.enabled) return { ok: false, error: '插件管理已禁用，请先启用' }
    const runner = ctx.get('dynamicCordisRunner')
    if (!runner || typeof runner.stop !== 'function') return { ok: false, error: 'dynamicCordisRunner 不可用' }
    const agent = owningAgent(agentId)
    if (!agent) return { ok: false, error: '找不到该插件的所属会话（agent 不在线）' }
    try {
      const res = await runner.stop(agent, String(pluginId))
      if (res && res.ok) return { ok: true }
      return { ok: false, error: (res && (res.message || res.reason)) || '未知错误' }
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) }
    }
  }

  async function startPlugin(agentId, pluginId, packageId) {
    const s = await ensureStore()
    if (!s.enabled) return { ok: false, error: '插件管理已禁用，请先启用' }
    const runner = ctx.get('dynamicCordisRunner')
    if (!runner || typeof runner.run !== 'function') return { ok: false, error: 'dynamicCordisRunner 不可用' }
    const agent = owningAgent(agentId)
    if (!agent) return { ok: false, error: '找不到该插件的所属会话（agent 不在线）' }
    if (!packageId) return { ok: false, error: '该插件没有可启动的包版本' }
    try {
      const res = await runner.run(agent, String(pluginId), String(packageId), 'run', undefined)
      if (res && res.ok) return { ok: true, status: res.status || 'starting' }
      return { ok: false, error: (res && (res.message || res.reason)) || '未知错误' }
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) }
    }
  }

  async function setEnabled(value) {
    const s = await ensureStore()
    s.enabled = !!value
    return persist()
  }

  async function exportNotes() {
    const s = await ensureStore()
    return { ok: true, json: JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), notes: s.notes }, null, 2) }
  }

  async function importNotes(jsonText) {
    let parsed
    try {
      parsed = JSON.parse(String(jsonText || ''))
    } catch (e) {
      return { ok: false, error: 'JSON 解析失败: ' + String(e && e.message ? e.message : e) }
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !parsed.notes || typeof parsed.notes !== 'object') {
      return { ok: false, error: '格式错误：需要 { notes: { key: { note, updatedAt } } }' }
    }
    const s = await ensureStore()
    if (!s.enabled) return { ok: false, error: '插件管理已禁用，请先启用' }
    const incoming = {}
    for (const key of Object.keys(parsed.notes)) {
      const rec = parsed.notes[key]
      if (typeof rec === 'string') {
        incoming[key] = { note: rec.slice(0, 4000), updatedAt: new Date().toISOString() }
      } else if (rec && typeof rec === 'object' && typeof rec.note === 'string') {
        incoming[key] = { note: rec.note.slice(0, 4000), updatedAt: typeof rec.updatedAt === 'string' ? rec.updatedAt : new Date().toISOString() }
      }
    }
    s.notes = incoming
    const res = await persist()
    if (!res.ok) return { ok: false, error: res.error }
    return { ok: true, count: Object.keys(incoming).length }
  }

  function listDeployment() {
    const loader = ctx.get('loader')
    if (!loader || typeof loader.entries !== 'function') return []
    const out = []
    try {
      for (const entry of loader.entries()) {
        if (entry.options && entry.options.group) continue
        const state = entry.fiber ? entry.fiber.state : null
        out.push({
          id: String(entry.id),
          name: entry.options && entry.options.name ? String(entry.options.name) : '',
          enabled: !entry.disabled,
          phase: state === null || state === undefined ? null : (PHASE[state] !== undefined ? PHASE[state] : String(state)),
        })
      }
    } catch (e) {
      console.error('[plugin-manager] loader.entries failed:', e)
    }
    return out
  }

  function listDynamic() {
    const runner = ctx.get('dynamicCordisRunner')
    if (!runner || typeof runner.inventory !== 'function') return []
    try {
      const rows = runner.inventory()
      if (!Array.isArray(rows)) return []
      return rows.map((r) => ({
        pluginId: String(r.pluginId),
        agentId: String(r.agentId),
        packages: (Array.isArray(r.packages) ? r.packages : []).map((p) => ({
          packageId: String(p.packageId),
          name: String(p.name || ''),
          purpose: String(p.purpose || ''),
          hasHostHalf: !!p.hasHostHalf,
          hasClientHalf: !!p.hasClientHalf,
        })),
        currentPackageId: r.currentPackageId ? String(r.currentPackageId) : null,
        nextPackageId: r.nextPackageId ? String(r.nextPackageId) : null,
        activeRun: r.activeRun ? { pluginRunId: String(r.activeRun.pluginRunId), packageId: String(r.activeRun.packageId) } : null,
      }))
    } catch (e) {
      console.error('[plugin-manager] dynamic inventory failed:', e)
    }
    return []
  }

  async function snapshot() {
    const s = await ensureStore()
    const dynamic = listDynamic().map((d) => ({
      ...d,
      manageable: owningAgent(d.agentId) !== undefined,
    }))
    return { deployment: listDeployment(), dynamic, notes: s.notes, notesFile: notesPath || null, enabled: s.enabled }
  }

  // ---- deployment plugin enable/disable (fool-proof toggle) ----
  //
  // The loader composes a profile by applying patch layers in order: each
  // bundle's patch, then the profile's own cordis.patch.yml, then the home
  // layer ($DSH_HOME/cordis.patch.yml). applyEntryPatches merges a patch into
  // the target entry BY ID and field (target[key] = value), so writing
  // `- id: <entryId>` + `disabled: true|false` into a user patch layer flips
  // the row's disabled field while keeping the bundle-provided `name` and
  // `config`. watchUserPatches hot-reloads the profile and home patch files,
  // so a save takes effect immediately — no restart needed.
  //
  // Patch file resolution order (first writable wins):
  //   1. the current profile's own patch: derived from ctx.baseUrl (the
  //      loader sets it to the profile directory's cordis.yml)
  //   2. the home-level patch $DSH_HOME/cordis.patch.yml
  function profilePatchCandidates() {
    const out = []
    try {
      if (typeof ctx.baseUrl === 'string' && /^file:/.test(ctx.baseUrl)) {
        const dir = fileURLToPath(new URL(ctx.baseUrl))
        out.push(join(dir, 'cordis.patch.yml'))
      }
    } catch (e) {
      /* baseUrl unusable — fall through to home layer */
    }
    const dshHome = process.env.DSH_HOME && process.env.DSH_HOME.trim()
      ? process.env.DSH_HOME.trim()
      : join(homedir(), '.dsh')
    out.push(join(dshHome, 'cordis.patch.yml'))
    return out
  }

  async function pickPatchFile() {
    const candidates = profilePatchCandidates()
    for (const p of candidates) {
      try {
        await fsp.access(p)
        return p
      } catch (e) {
        /* missing: try next */
      }
    }
    return candidates[0] || null
  }

  /**
   * Render one loader patch row as YAML. Only the fields we set are emitted;
   * the loader merges them into the existing entry by id, so omitted fields
   * (name, config, …) stay as the bundle layer declared them.
   */
  function renderPatchRow(id, disabled) {
    return '- id: ' + JSON.stringify(id) + '\n  disabled: ' + (disabled ? 'true' : 'false') + '\n'
  }

  /**
   * Extract the id value from a `- id: <value>` loader row, tolerating plain,
   * single-quoted, and double-quoted YAML scalars. Returns null for any line
   * that is not a top-level (or nested) `- id:` row.
   */
  function entryIdFromLine(line) {
    const m = /^\s*-\s*id:\s*(.+?)\s*$/.exec(line)
    if (!m) return null
    const raw = m[1]
    if ((raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2)
      || (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2)) {
      return raw.slice(1, -1)
    }
    // YAML plain scalar: strip an inline comment (a bare `#` following a space)
    return raw.split(/\s+#/)[0].trim()
  }

  /**
   * Read the user patch file, replace or append the row for `id`, and write
   * it back. Keeps every other row byte-for-byte; only the targeted row's
   * `disabled` field is set.
   * @returns {{ok: boolean, file?: string, disabled?: boolean, error?: string}}
   */
  async function setDeploymentDisabled(id, disabled) {
    if (!id || typeof id !== 'string') return { ok: false, error: 'entry id 不能为空' }
    const s = await ensureStore()
    if (!s.enabled) return { ok: false, error: '插件管理已禁用，请先启用' }
    const file = await pickPatchFile()
    if (!file) return { ok: false, error: '无法定位 cordis.patch.yml（无 DSH_HOME 且无法推断 profile 目录）' }
    let text = ''
    try {
      text = await fsp.readFile(file, 'utf8')
    } catch (e) {
      text = ''
    }
    const next = upsertPatchRow(text, id, !!disabled)
    try {
      await fsp.mkdir(join(file, '..'), { recursive: true })
      await fsp.writeFile(file, next, 'utf8')
    } catch (e) {
      return { ok: false, error: '写入 patch 失败: ' + (e && e.message ? e.message : e) }
    }
    return { ok: true, file, disabled: !!disabled }
  }

  /**
   * Insert or update one `- id: <id>` row's `disabled` field in a patch YAML
   * text, preserving all other lines. Line-based, not a full YAML round-trip,
   * so comments and `!!js` expressions elsewhere survive untouched.
   */
  function upsertPatchRow(text, id, disabled) {
    const lines = (text || '').split('\n')
    let index = -1
    for (let i = 0; i < lines.length; i++) {
      const found = entryIdFromLine(lines[i])
      if (found !== null && found === id) {
        index = i
        break
      }
    }
    const patch = '  disabled: ' + (disabled ? 'true' : 'false')
    if (index === -1) {
      // Row not present: append. If the file is an empty list, replace it.
      const trimmed = text.trim()
      if (trimmed === '[]' || trimmed === '') {
        return renderPatchRow(id, disabled)
      }
      const sep = text.endsWith('\n') ? '' : '\n'
      return text + sep + renderPatchRow(id, disabled)
    }
    // Row present: find its indentation and its `disabled:` child if any.
    const indentMatch = /^(\s*)/.exec(lines[index])
    const indent = indentMatch ? indentMatch[1] : ''
    const childIndent = indent + '  '
    // Determine the row's block: from the id line to the next top-level entry.
    const nextTop = (() => {
      for (let j = index + 1; j < lines.length; j++) {
        const m = /^(\s*)- /.exec(lines[j])
        if (m && m[1].length <= indent.length) return j
      }
      return lines.length
    })()
    const out = lines.slice()
    let replaced = false
    for (let j = index + 1; j < nextTop; j++) {
      const m = /^(\s*)disabled:/.exec(lines[j])
      if (m && m[1].length >= childIndent.length) {
        out[j] = childIndent + 'disabled: ' + (disabled ? 'true' : 'false')
        replaced = true
        break
      }
    }
    if (!replaced) out.splice(index + 1, 0, childIndent + 'disabled: ' + (disabled ? 'true' : 'false'))
    return out.join('\n')
  }

  // ---- model tool ----
  ctx.tools.register(defineTool({
    name: 'plugin_manager',
    description: '插件管理：列出 DeepSeek Harness 的全部插件（部署插件 + 动态 Cordis 插件）及已保存的备注；读取/写入/删除备注；导出/导入全部备注（备份与恢复）；启动/停止动态插件；toggle-deployment 禁用/启用部署插件（傻瓜式开关，写 profile patch 热重载生效）；enable/disable 启停插件管理（停用后所有写操作被拒绝，重新启用即恢复）。备注持久化在工作区根目录的 .dsh-plugin-notes.json。',
    parameters: {
      action: { type: 'string', enum: ['list', 'get', 'set', 'remove', 'export', 'import', 'start', 'stop', 'toggle-deployment', 'enable', 'disable'], required: true, description: '操作：list 列出全部；get 读取某键备注；set 写入/更新备注；remove 删除备注；export 导出全部备注 JSON；import 导入备注（note 参数放 JSON）；start 启动动态插件；stop 停止动态插件；toggle-deployment 禁用/启用部署插件（key=部署插件 entry id，note 传 "on"/"off" 或省略自动取反）；enable/disable 启用/停用插件管理' },
      key: { type: 'string', description: '备注键或动态插件 pluginId：部署插件用 entry id（list 输出中的 id），动态插件用 pluginId，也可自定义任意字符串' },
      note: { type: 'string', description: '备注内容（set 用，最长 4000 字符）或导入用 JSON（import 用）；toggle-deployment 用 "on"/"off" 指定目标状态' },
      packageId: { type: 'string', description: 'start 时指定要启动的包版本，缺省用 currentPackageId' },
    },
    output: {
      schema: { type: 'string' },
      render(_args, value) {
        return [{ type: 'text', text: value }]
      },
    },
    async execute(args) {
      const action = args && args.action ? args.action : 'list'
      if (action === 'list') {
        const s = await snapshot()
        const lines = []
        lines.push('部署插件 ' + s.deployment.length + ' 个 | 动态插件 ' + s.dynamic.length + ' 个 | 备注 ' + Object.keys(s.notes).length + ' 条')
        lines.push('插件管理: ' + (s.enabled ? '已启用' : '已禁用') + ' | 备注文件: ' + (s.notesFile || '不可用（仅内存）'))
        for (const d of s.deployment) {
          lines.push('[部署] id=' + d.id + ' name=' + (d.name || '-') + ' enabled=' + d.enabled + ' phase=' + (d.phase === null ? '-' : d.phase) + ' note=' + (s.notes[d.id] ? '有' : '无'))
        }
        for (const d of s.dynamic) {
          const pkg = d.packages.length ? d.packages[d.packages.length - 1] : null
          lines.push('[动态] id=' + d.pluginId + ' ' + (pkg ? pkg.name + ' - ' + pkg.purpose : '') + ' running=' + !!d.activeRun + ' pkg=' + (d.currentPackageId || '-') + ' note=' + (s.notes[d.pluginId] ? '有' : '无'))
        }
        const custom = Object.keys(s.notes).filter((k) => !s.deployment.some((d) => d.id === k) && !s.dynamic.some((d) => d.pluginId === k))
        if (custom.length) lines.push('自定义备注键: ' + custom.join(', '))
        return lines.join('\n')
      }
      if (action === 'get') {
        const key = args && typeof args.key === 'string' ? args.key : ''
        if (!key) return '错误：需要 key'
        const s = await ensureStore()
        const rec = s.notes[key]
        return rec ? (key + ': ' + rec.note + '（更新于 ' + rec.updatedAt + '）') : (key + ': 无备注')
      }
      if (action === 'set') {
        const key = args && typeof args.key === 'string' ? args.key : ''
        const note = args && typeof args.note === 'string' ? args.note : ''
        const res = await saveNote(key, note)
        return res.ok ? ('已保存 ' + key + ' 的备注') : ('保存失败: ' + res.error)
      }
      if (action === 'remove') {
        const key = args && typeof args.key === 'string' ? args.key : ''
        const res = await removeNote(key)
        return res.ok ? ('已删除 ' + key + ' 的备注') : ('删除失败: ' + res.error)
      }
      if (action === 'export') {
        const res = await exportNotes()
        return res.ok ? res.json : ('导出失败: ' + res.error)
      }
      if (action === 'import') {
        const res = await importNotes(args && typeof args.note === 'string' ? args.note : '')
        return res.ok ? ('导入成功，共 ' + res.count + ' 条备注') : ('导入失败: ' + res.error)
      }
      if (action === 'start') {
        const s = await snapshot()
        const row = s.dynamic.find((d) => d.pluginId === (args && typeof args.key === 'string' ? args.key : ''))
        if (!row) return '错误：未找到动态插件 ' + (args && typeof args.key === 'string' ? args.key : '')
        const pkgId = args && typeof args.packageId === 'string' ? args.packageId : row.currentPackageId
        const res = await startPlugin(row.agentId, row.pluginId, pkgId)
        if (!res.ok) return '启动失败: ' + res.error
        return res.status === 'awaiting-approval' ? ('已发起启动 ' + row.pluginId + '（等待审批）') : ('已启动 ' + row.pluginId)
      }
      if (action === 'stop') {
        const s = await snapshot()
        const row = s.dynamic.find((d) => d.pluginId === (args && typeof args.key === 'string' ? args.key : ''))
        if (!row) return '错误：未找到动态插件 ' + (args && typeof args.key === 'string' ? args.key : '')
        const res = await stopPlugin(row.agentId, row.pluginId)
        return res.ok ? ('已停止 ' + row.pluginId) : ('停止失败: ' + res.error)
      }
      if (action === 'toggle-deployment') {
        const key = args && typeof args.key === 'string' ? args.key : ''
        if (!key) return '错误：需要 key（部署插件 entry id）'
        const snap = await snapshot()
        const row = snap.deployment.find((d) => d.id === key)
        if (!row) return '错误：未找到部署插件 ' + key
        const want = typeof args.note === 'string' && (args.note === 'on' || args.note === 'off')
          ? args.note === 'on'
          : !row.enabled
        const res = await setDeploymentDisabled(key, !want)
        if (!res.ok) return '操作失败: ' + res.error
        return res.disabled
          ? ('已禁用部署插件 ' + key + '（写入 ' + res.file + '，热重载生效）')
          : ('已启用部署插件 ' + key + '（写入 ' + res.file + '，热重载生效）')
      }
      if (action === 'enable' || action === 'disable') {
        const s = await ensureStore()
        s.enabled = action === 'enable'
        const res = await persist()
        return res.ok ? (s.enabled ? '插件管理已启用' : '插件管理已禁用') : ('设置失败: ' + res.error)
      }
      return '未知操作: ' + action
    },
  }))

  // ---- JSON API for the browser Settings UI ----
  // webServer mounts during boot; ctx.inject parks this until it is live
  // (ctx.get at apply time returns undefined, which silently skipped the
  // registration — the same pattern vision-toolkit uses for its routes).
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'prefix',
      path: '/_dsh/plugin-manager',
      handler: async (req, res) => {
        try {
          const url = new URL(req.url || '/', 'http://localhost')
          const route = url.pathname.slice('/_dsh/plugin-manager'.length) || '/'
          if (req.method === 'GET' && route === '/list') return json(res, await snapshot())
          if (req.method === 'GET' && route === '/export') return json(res, await exportNotes())
          if (req.method === 'POST') {
            const raw = await readBody(req)
            const body = raw ? JSON.parse(raw) : {}
            if (route === '/save') return json(res, await saveNote(str(body.key), str(body.note)))
            if (route === '/remove') return json(res, await removeNote(str(body.key)))
            if (route === '/import') return json(res, await importNotes(str(body.json)))
            if (route === '/stop') return json(res, await stopPlugin(str(body.agentId), str(body.pluginId)))
            if (route === '/start') return json(res, await startPlugin(str(body.agentId), str(body.pluginId), str(body.packageId)))
            if (route === '/set-deployment') return json(res, await setDeploymentDisabled(str(body.id), body.enabled === true))
            if (route === '/enable') return json(res, await setEnabled(body.enabled === true))
          }
          return json(res, { ok: false, error: 'unknown route: ' + route }, 404)
        } catch (e) {
          return json(res, { ok: false, error: String(e && e.message ? e.message : e) }, 500)
        }
      },
    }))
  })
}

function json(res, data, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(data))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

function str(v) {
  return typeof v === 'string' ? v : ''
}
