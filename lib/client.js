/**
 * dsh-plugin-manager — Client half (browser).
 *
 * Loaded by the harness client module system as a CLASSIC script, so this file
 * must contain no top-level `import`/`export`. It registers itself with
 * `window.__ModuleLoader__.load({ id, factory })`; the factory receives a
 * `require` that resolves platform seeds (react, …), and returns the plugin
 * exports `{ inject, apply }`.
 *
 * UI: a "备注" (Notes) tab in Settings → Plugins, talking to the Host half
 * through the same-origin JSON API at `/_dsh/plugin-manager` (see lib/index.js).
 */
window.__ModuleLoader__.load({
  id: '@dsh-external/dsh-plugin-manager',
  factory: (require) => {
    const React = require('react')
    const { useEffect, useState } = React

    const inject = ['slots']

    const API = '/_dsh/plugin-manager'

    async function api(path, method, body) {
      const res = await fetch(API + path, method === 'POST'
        ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }
        : { method: 'GET' })
      return res.json()
    }

    const css = {
      wrap: { display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '13px' },
      stats: { display: 'flex', gap: '14px', flexWrap: 'wrap', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' },
      toolbar: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' },
      search: { flex: '1 1 200px', boxSizing: 'border-box', padding: '6px 8px', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '6px', background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)' },
      select: { padding: '6px 8px', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '6px', background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', font: 'inherit' },
      row: { display: 'flex', flexDirection: 'column', gap: '6px', padding: '10px', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '8px', background: 'var(--dsw-alias-bg-layer-1)' },
      head: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
      badge: { fontSize: '11px', padding: '1px 6px', borderRadius: '999px', border: '1px solid var(--dsw-alias-border-l2)', color: 'var(--dsw-alias-label-secondary)' },
      id: { fontFamily: 'ui-monospace,SFMono-Regular,Consolas,monospace', fontWeight: 600, wordBreak: 'break-all' },
      status: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' },
      statusOk: { fontSize: '11px', color: 'var(--dsw-alias-state-success-primary)' },
      statusBad: { fontSize: '11px', color: 'var(--dsw-alias-state-error-primary)' },
      purpose: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' },
      note: { display: 'flex', flexDirection: 'column', gap: '6px' },
      textarea: { width: '100%', boxSizing: 'border-box', minHeight: '52px', resize: 'vertical', padding: '6px 8px', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '6px', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', font: 'inherit' },
      textareaMono: { width: '100%', boxSizing: 'border-box', minHeight: '52px', resize: 'vertical', padding: '6px 8px', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '6px', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', fontFamily: 'ui-monospace,SFMono-Regular,Consolas,monospace', fontSize: '12px' },
      actions: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' },
      btn: { padding: '4px 12px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '6px', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', cursor: 'pointer', font: 'inherit' },
      btnDanger: { padding: '4px 12px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '6px', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-state-error-primary)', cursor: 'pointer', font: 'inherit' },
      btnOk: { padding: '4px 12px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '6px', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-state-success-primary)', cursor: 'pointer', font: 'inherit' },
      msg: { fontSize: '12px', color: 'var(--dsw-alias-state-success-primary)' },
      msgErr: { fontSize: '12px', color: 'var(--dsw-alias-state-error-primary)' },
      add: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' },
      input: { padding: '5px 8px', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '6px', background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', font: 'inherit' },
      empty: { color: 'var(--dsw-alias-label-secondary)', padding: '12px 0' },
      hint: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' },
    }

    const STATUS_TEXT = {
      pending: '等待', loading: '加载中', active: '运行中', failed: '失败', unloading: '卸载中',
      enabled: '已启用', disabled: '已禁用', running: '运行中', stopped: '已停止', custom: '自定义',
    }
    const OK_STATUS = { active: true, running: true, enabled: true }

    function apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return

      slots.inject('settings.plugins.tab', () => slots.register(
        { name: 'settings.plugins.tab', id: 'notes', order: 20, label: '备注' },
        PluginManagerTab,
      ))
    }

    function PluginManagerTab() {
      const [state, setState] = useState({ loading: true, error: null, deployment: [], dynamic: [], notes: {}, notesFile: null, enabled: true })
      const [drafts, setDrafts] = useState({})
      const [filter, setFilter] = useState('')
      const [filterStatus, setFilterStatus] = useState('all')
      const [msg, setMsg] = useState(null)
      const [busy, setBusy] = useState(false)
      const [customKey, setCustomKey] = useState('')
      const [customNote, setCustomNote] = useState('')
      const [exportText, setExportText] = useState(null)
      const [showImport, setShowImport] = useState(false)
      const [importText, setImportText] = useState('')

      const load = () => {
        api('/list').then((res) => {
          setState({
            loading: false,
            error: null,
            deployment: Array.isArray(res.deployment) ? res.deployment : [],
            dynamic: Array.isArray(res.dynamic) ? res.dynamic : [],
            notes: res.notes && typeof res.notes === 'object' ? res.notes : {},
            notesFile: res.notesFile || null,
            enabled: typeof res.enabled === 'boolean' ? res.enabled : true,
          })
        }).catch((e) => {
          setState({ loading: false, error: String(e && e.message ? e.message : e), deployment: [], dynamic: [], notes: {}, notesFile: null, enabled: true })
        })
      }

      useEffect(() => {
        load()
      }, [])

      const doSave = (key) => {
        setBusy(true)
        setMsg(null)
        api('/save', 'POST', { key, note: drafts[key] !== undefined ? drafts[key] : '' }).then((res) => {
          if (res && res.ok) { setMsg({ err: false, text: '已保存: ' + key }); load() }
          else setMsg({ err: true, text: '保存失败: ' + (res && res.error ? res.error : '未知错误') })
        }).catch((e) => setMsg({ err: true, text: String(e && e.message ? e.message : e) })).then(() => setBusy(false))
      }

      const doRemove = (key) => {
        setBusy(true)
        setMsg(null)
        api('/remove', 'POST', { key }).then((res) => {
          if (res && res.ok) { setMsg({ err: false, text: '已删除: ' + key }); load() }
          else setMsg({ err: true, text: '删除失败: ' + (res && res.error ? res.error : '未知错误') })
        }).catch((e) => setMsg({ err: true, text: String(e && e.message ? e.message : e) })).then(() => setBusy(false))
      }

      const doStop = (row) => {
        setBusy(true)
        setMsg(null)
        api('/stop', 'POST', { pluginId: row.key, agentId: row.agentId }).then((res) => {
          if (res && res.ok) { setMsg({ err: false, text: '已停止: ' + row.key }); load() }
          else setMsg({ err: true, text: '停止失败: ' + (res && res.error ? res.error : '未知错误') })
        }).catch((e) => setMsg({ err: true, text: String(e && e.message ? e.message : e) })).then(() => setBusy(false))
      }

      const doStart = (row) => {
        setBusy(true)
        setMsg(null)
        api('/start', 'POST', { pluginId: row.key, agentId: row.agentId, packageId: row.currentPackageId }).then((res) => {
          if (res && res.ok) {
            setMsg({ err: false, text: res.status === 'awaiting-approval' ? '已发起启动（等待审批）: ' + row.key : '已启动: ' + row.key })
            load()
          } else setMsg({ err: true, text: '启动失败: ' + (res && res.error ? res.error : '未知错误') })
        }).catch((e) => setMsg({ err: true, text: String(e && e.message ? e.message : e) })).then(() => setBusy(false))
      }

      const doToggleDeployment = (row) => {
        const target = row.statusKey === 'disabled'
        const ok = window.confirm((target ? '确定启用' : '确定禁用') + '部署插件 ' + row.key + ' 吗？\n\n将写入 profile 的 cordis.patch.yml 并热重载生效。')
        if (!ok) return
        setBusy(true)
        setMsg(null)
        api('/set-deployment', 'POST', { id: row.key, enabled: target }).then((res) => {
          if (res && res.ok) { setMsg({ err: false, text: res.disabled ? '已禁用: ' + row.key : '已启用: ' + row.key }); load() }
          else setMsg({ err: true, text: '操作失败: ' + (res && res.error ? res.error : '未知错误') })
        }).catch((e) => setMsg({ err: true, text: String(e && e.message ? e.message : e) })).then(() => setBusy(false))
      }

      const doExport = () => {
        setBusy(true)
        setMsg(null)
        api('/export').then((res) => {
          if (res && res.ok) { setExportText(res.json); setMsg({ err: false, text: '已导出，可复制下方 JSON 保存' }) }
          else setMsg({ err: true, text: '导出失败: ' + (res && res.error ? res.error : '未知错误') })
        }).catch((e) => setMsg({ err: true, text: String(e && e.message ? e.message : e) })).then(() => setBusy(false))
      }

      const doImport = () => {
        if (!importText.trim()) return
        setBusy(true)
        setMsg(null)
        api('/import', 'POST', { json: importText }).then((res) => {
          if (res && res.ok) { setMsg({ err: false, text: '导入成功，共 ' + res.count + ' 条备注' }); setShowImport(false); setImportText(''); load() }
          else setMsg({ err: true, text: '导入失败: ' + (res && res.error ? res.error : '未知错误') })
        }).catch((e) => setMsg({ err: true, text: String(e && e.message ? e.message : e) })).then(() => setBusy(false))
      }

      const doToggle = () => {
        setBusy(true)
        setMsg(null)
        api('/enable', 'POST', { enabled: !state.enabled }).then((res) => {
          if (res && res.ok) { setMsg({ err: false, text: state.enabled ? '已停用插件管理' : '已启用插件管理' }); load() }
          else setMsg({ err: true, text: '操作失败: ' + (res && res.error ? res.error : '未知错误') })
        }).catch((e) => setMsg({ err: true, text: String(e && e.message ? e.message : e) })).then(() => setBusy(false))
      }

      const addCustom = () => {
        const key = customKey.trim()
        if (!key) return
        setDrafts((p) => {
          const n = Object.assign({}, p)
          n[key] = customNote
          return n
        })
        doSave(key)
        setCustomKey('')
        setCustomNote('')
      }

      const rows = []
      const seen = {}
      for (const d of state.deployment) {
        rows.push({ kind: '部署', key: d.id, name: d.name, sub: '', statusKey: d.enabled ? (d.phase === 'active' ? 'active' : 'enabled') : 'disabled', note: state.notes[d.id], agentId: null, currentPackageId: null, manageable: false, deployable: true })
        seen[d.id] = true
      }
      for (const d of state.dynamic) {
        const pkg = d.packages && d.packages.length ? d.packages[d.packages.length - 1] : null
        rows.push({
          kind: '动态', key: d.pluginId, name: pkg ? pkg.name : '', sub: pkg ? pkg.purpose : '',
          statusKey: d.activeRun ? 'running' : 'stopped', note: state.notes[d.pluginId],
          agentId: d.agentId, currentPackageId: d.currentPackageId, manageable: !!d.manageable, deployable: false,
        })
        seen[d.pluginId] = true
      }
      for (const key of Object.keys(state.notes)) {
        if (!seen[key]) rows.push({ kind: '自定义', key, name: '', sub: '', statusKey: 'custom', note: state.notes[key], agentId: null, currentPackageId: null, manageable: false, deployable: false })
      }

      const q = filter.trim().toLowerCase()
      let filtered = q
        ? rows.filter((r) => (r.key + ' ' + r.name + ' ' + (r.sub || '') + ' ' + (r.note ? r.note.note : '')).toLowerCase().indexOf(q) !== -1)
        : rows
      if (filterStatus !== 'all') {
        filtered = filtered.filter((r) => {
          if (filterStatus === 'running') return r.statusKey === 'running' || r.statusKey === 'active'
          if (filterStatus === 'enabled') return r.statusKey === 'enabled'
          if (filterStatus === 'disabled') return r.statusKey === 'disabled' || r.statusKey === 'stopped'
          if (filterStatus === 'failed') return r.statusKey === 'failed'
          if (filterStatus === 'noted') return !!r.note
          return true
        })
      }

      if (state.loading) {
        return React.createElement('div', { style: css.wrap }, React.createElement('div', { style: css.hint }, '正在加载插件清单…'))
      }

      if (!state.enabled) {
        return React.createElement('div', { style: css.wrap },
          React.createElement('div', { style: css.stats },
            React.createElement('span', null, '插件管理已禁用'),
          ),
          React.createElement('div', { style: css.add },
            React.createElement('button', { style: css.btnOk, onClick: doToggle, disabled: busy }, '启用插件管理'),
          ),
          React.createElement('div', { style: css.hint }, '停用期间所有插件操作被拒绝；备注数据保留，重新启用后恢复。'),
        )
      }

      return React.createElement('div', { style: css.wrap },
        React.createElement('div', { style: css.stats },
          React.createElement('span', null, '部署 ' + state.deployment.length),
          React.createElement('span', null, '动态 ' + state.dynamic.length),
          React.createElement('span', null, '备注 ' + Object.keys(state.notes).length),
          React.createElement('span', null, state.notesFile ? '文件: ' + state.notesFile : '备注仅保存在内存'),
        ),
        React.createElement('div', { style: css.add },
          React.createElement('span', null, '插件管理: ' + (state.enabled ? '已启用' : '已禁用')),
          React.createElement('button', { style: css.btnDanger, onClick: doToggle, disabled: busy }, '停用插件管理'),
        ),
        React.createElement('div', { style: css.toolbar },
          React.createElement('input', { style: css.search, placeholder: '搜索插件或备注…', value: filter, onChange: (e) => setFilter(e.target.value) }),
          React.createElement('select', { style: css.select, value: filterStatus, onChange: (e) => setFilterStatus(e.target.value) },
            React.createElement('option', { value: 'all' }, '全部状态'),
            React.createElement('option', { value: 'running' }, '运行中'),
            React.createElement('option', { value: 'enabled' }, '已启用'),
            React.createElement('option', { value: 'disabled' }, '禁用/已停止'),
            React.createElement('option', { value: 'failed' }, '失败'),
            React.createElement('option', { value: 'noted' }, '有备注'),
          ),
          React.createElement('button', { style: css.btn, onClick: doExport, disabled: busy }, '导出备注'),
          React.createElement('button', { style: css.btn, onClick: () => setShowImport(!showImport), disabled: busy }, '导入备注'),
        ),
        msg ? React.createElement('div', { style: msg.err ? css.msgErr : css.msg }, msg.text) : null,
        state.error ? React.createElement('div', { style: css.msgErr }, '加载失败: ' + state.error) : null,
        exportText ? React.createElement('textarea', { style: css.textareaMono, readOnly: true, rows: 6, value: exportText, onFocus: (e) => e.target.select() }) : null,
        showImport ? React.createElement('div', { style: css.add },
          React.createElement('textarea', { style: css.textareaMono, placeholder: '粘贴 { "notes": { ... } } 格式的 JSON（导入将覆盖现有备注）', rows: 4, value: importText, onChange: (e) => setImportText(e.target.value) }),
          React.createElement('button', { style: css.btnDanger, onClick: doImport, disabled: busy || !importText.trim() }, '执行导入（覆盖）'),
        ) : null,
        React.createElement('div', { style: css.add },
          React.createElement('input', { style: Object.assign({}, css.input, { flex: '1 1 180px' }), placeholder: '自定义备注键（可选）', value: customKey, onChange: (e) => setCustomKey(e.target.value) }),
          React.createElement('input', { style: Object.assign({}, css.input, { flex: '2 1 260px' }), placeholder: '备注内容', value: customNote, onChange: (e) => setCustomNote(e.target.value) }),
          React.createElement('button', { style: css.btn, onClick: addCustom, disabled: busy }, '添加备注'),
        ),
        filtered.length === 0
          ? React.createElement('div', { style: css.empty }, '没有匹配的插件')
          : filtered.map((r) => React.createElement('div', { style: css.row, key: r.key },
              React.createElement('div', { style: css.head },
                React.createElement('span', { style: css.badge }, r.kind),
                React.createElement('span', { style: css.id }, r.key),
                r.name ? React.createElement('span', { style: css.purpose }, r.name) : null,
                React.createElement('span', { style: OK_STATUS[r.statusKey] ? css.statusOk : css.statusBad }, STATUS_TEXT[r.statusKey] || r.statusKey),
              ),
              r.sub ? React.createElement('div', { style: css.purpose }, r.sub) : null,
              React.createElement('div', { style: css.note },
                React.createElement('textarea', {
                  style: css.textarea,
                  placeholder: '为该插件添加备注…',
                  value: drafts[r.key] !== undefined ? drafts[r.key] : (r.note ? r.note.note : ''),
                  onChange: (e) => setDrafts((p) => {
                    const n = Object.assign({}, p)
                    n[r.key] = e.target.value
                    return n
                  }),
                }),
                React.createElement('div', { style: css.actions },
                  React.createElement('button', { style: css.btn, onClick: () => doSave(r.key), disabled: busy }, '保存'),
                  r.note ? React.createElement('button', { style: css.btnDanger, onClick: () => doRemove(r.key), disabled: busy }, '删除备注') : null,
                  r.kind === '动态' && r.manageable && r.statusKey === 'running'
                    ? React.createElement('button', { style: css.btnDanger, onClick: () => doStop(r), disabled: busy }, '停止')
                    : null,
                  r.kind === '动态' && r.manageable && r.statusKey !== 'running' && r.currentPackageId
                    ? React.createElement('button', { style: css.btnOk, onClick: () => doStart(r), disabled: busy }, '启动')
                    : null,
                  r.deployable
                    ? (r.statusKey === 'disabled'
                      ? React.createElement('button', { style: css.btnOk, onClick: () => doToggleDeployment(r), disabled: busy }, '启用')
                      : React.createElement('button', { style: css.btnDanger, onClick: () => doToggleDeployment(r), disabled: busy }, '禁用'))
                    : null,
                ),
              ),
            )),
      )
    }

    return { inject, apply }
  },
})
