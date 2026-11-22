import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register } from 'claude-code'

import type { Art, Chat, Saved } from '../types'

const PANE = 'meus-trabalhos'
const TITLE = 'Meus Trabalhos'
const SERVER = 'claude-code-remote'
const SCAN_CHATS = 25
const SCAN_PAGES = 4

const chats = atom({ plugin: 'meus-trabalhos', key: 'chats' } as const, [] as Chat[], { shape: 'chats-1' })
const arts = atom({ plugin: 'meus-trabalhos', key: 'arts' } as const, [] as Art[], { shape: 'arts-1' })
const saved = atom({ plugin: 'meus-trabalhos', key: 'saved' } as const, [] as Saved[], { shape: 'saved-1' })
const hidden = atom({ plugin: 'meus-trabalhos', key: 'hidden' } as const, [] as string[], { shape: 'hidden-1' })
const picking = atom({ plugin: 'meus-trabalhos', key: 'picking' } as const, false, { shape: 'picking-1' })
const status = atom({ plugin: 'meus-trabalhos', key: 'status' } as const, '', { shape: 'status-1' })
// chat id -> URLs de artefatos achados na conversa (mais recente primeiro)
const links = atom({ plugin: 'meus-trabalhos', key: 'links' } as const, {} as Record<string, string[]>, { shape: 'links-1' })
// muda sempre que uma miniatura nova fica pronta, para redesenhar
const pics = atom({ plugin: 'meus-trabalhos', key: 'pics' } as const, 0, { shape: 'pics-1' })

// miniaturas em memória: id do artefato -> JPEG em base64
const images = new Map<string, string>()
const failed = new Set<string>()
let busy = false

const chatUrl = (id: string) => `https://claude.ai/code/${id}`
const artId = (url: string) => url.replace(/[?#].*$/, '').split('/').filter(Boolean).pop() ?? ''
const ART_RE = /https:\/\/claude\.ai\/(?:code\/)?artifact\/[A-Za-z0-9-]{10,}/g

function textOf(res: any): string {
  if (Array.isArray(res?.content)) return res.content.map((c: any) => (c.type === 'text' ? c.text : '')).join('\n')
  if (typeof res?.text === 'string') return res.text
  return JSON.stringify(res?.result ?? res ?? '')
}

function parseChats(text: string): Chat[] {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end < start) return []
  const data = JSON.parse(text.slice(start, end + 1))
  const rows: any[] = data?.ccr?.data ?? data?.data ?? []
  return rows.map(r => ({
    id: String(r.id),
    title: String(r.title || 'Sem título'),
    bucket: String(r.status_bucket ?? '').replace('SESSION_STATUS_BUCKET_', ''),
    archived: r.session_status === 'SESSION_STATUS_ARCHIVED',
    updatedAt: String(r.updated_at ?? ''),
    note: r.post_turn_summary?.needs_action ?? r.post_turn_summary?.recent_action ?? undefined,
    unread: Boolean(r.unread),
  }))
}

function parseArts(text: string): Art[] {
  const out: Art[] = []
  for (const line of text.split('\n')) {
    const m = /^- \(\w+\) (.+?) — (https:\/\/claude\.ai\/\S*artifact\/\S+) — updated (\S+)/.exec(line.trim())
    if (m) out.push({ title: m[1]!, url: m[2]!, updated: m[3]! })
  }
  return out
}

function ago(iso: string, now: number): string {
  const t = Date.parse(iso)
  if (!t) return ''
  const m = Math.max(0, Math.round((now - t) / 60000))
  if (m < 60) return `há ${m} min`
  const h = Math.round(m / 60)
  if (h < 48) return `há ${h} h`
  return `há ${Math.round(h / 24)} d`
}

// Procura links de artefatos nas mensagens do Claude numa conversa (com cache)
async function scanChat($: Engine, c: Chat): Promise<string[]> {
  const cache = ((await $.store.get('scan')) ?? {}) as Record<string, { upd: string; urls: string[] }>
  const hit = cache[c.id]
  if (hit && hit.upd === c.updatedAt) return hit.urls
  const found: string[] = []
  let before: string | undefined
  for (let page = 0; page < SCAN_PAGES; page++) {
    const args: Record<string, unknown> = { session_id: c.id, limit: 100, kinds: ['assistant'] }
    if (before) args.before_id = before
    let text = ''
    try {
      text = textOf(await $.mcp.call(SERVER, 'list_events', args))
    } catch {
      break
    }
    const urls = (text.match(ART_RE) ?? []).reverse()
    for (const u of urls) if (!found.some(f => artId(f) === artId(u))) found.push(u)
    const more = /"has_more":\s*true/.test(text)
    const first = /"first_id":\s*"([^"]+)"/.exec(text)?.[1]
    if (!more || !first) break
    before = first
  }
  cache[c.id] = { upd: c.updatedAt, urls: found.slice(0, 5) }
  await $.store.set('scan', cache)
  return found.slice(0, 5)
}

// Gera (ou lê do disco) a miniatura PNG de um artefato
async function ensureThumb($: Engine, url: string, updated: string): Promise<void> {
  const id = artId(url)
  if (!id || images.has(id) || failed.has(id)) return
  const dir = `${$.plugin.root}/thumbs`
  const jpg = `${dir}/${id}.jpg`
  const meta = ((await $.store.get('thumbMeta')) ?? {}) as Record<string, string>
  const fresh = (await $.fs.exists(jpg)) && (!updated || meta[id] === updated)
  try {
    if (!fresh) {
      const res: any = await $.tool.call({ tool: 'Artifact', action: 'read', url } as any)
      const text = textOf(res)
      const lo = text.search(/<!doctype html|<html/i)
      const hi = text.toLowerCase().lastIndexOf('</html>')
      if (lo < 0 || hi < lo) throw new Error('sem HTML')
      const htmlPath = `${dir}/${id}.html`
      await $.fs.write(htmlPath, text.slice(lo, hi + 7))
      const run = await $.process.run(['node', `${$.plugin.root}/scripts/thumb.cjs`, htmlPath, jpg], { timeoutMs: 60000 })
      if (run.exitCode !== 0) throw new Error('captura falhou')
      meta[id] = updated
      await $.store.set('thumbMeta', meta)
    }
    const { base64 } = (await $.fs.read(jpg, { as: 'bytes' })) as { base64: string }
    images.set(id, base64)
    await update($, pics, n => n + 1)
  } catch {
    failed.add(id)
  }
}

async function refresh($: Engine) {
  const errors: string[] = []
  let list: Chat[] = []
  let artList: Art[] = []
  try {
    const res = await $.mcp.call(SERVER, 'list_sessions', { mine: true, limit: 60 })
    const text = textOf(res)
    if (res.isError) throw new Error(text.slice(0, 100))
    list = parseChats(text)
    await update($, chats, () => list)
  } catch (err) {
    errors.push(`chats: ${String((err as Error)?.message ?? err).slice(0, 80)}`)
  }
  try {
    const res: any = await $.tool.call({ tool: 'Artifact', action: 'list', limit: 40 } as any)
    artList = parseArts(textOf(res))
    await update($, arts, () => artList)
  } catch (err) {
    errors.push(`artefatos: ${String((err as Error)?.message ?? err).slice(0, 80)}`)
  }
  const d = new Date(await $.clock.now())
  const hhmm = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`
  await update($, status, () => (errors.length ? `Erro — ${errors.join('; ')}` : `Atualizado ${hhmm}`))
  void scanAll($, list, artList)
}

// Em segundo plano: liga chats a artefatos e gera as miniaturas
async function scanAll($: Engine, list: Chat[], artList: Art[]) {
  if (busy) return
  busy = true
  try {
    const mine = await read($, saved)
    const targets = [
      ...mine.map(s => list.find(c => c.id === s.id) ?? ({ id: s.id, title: s.title, bucket: '', archived: false, updatedAt: '' } as Chat)),
      ...list.filter(c => !mine.some(s => s.id === c.id)).slice(0, SCAN_CHATS),
    ]
    for (const c of targets) {
      const urls = await scanChat($, c)
      await update($, links, m => ({ ...m, [c.id]: urls }))
    }
    const linkMap = await read($, links)
    const wanted = new Map<string, string>()
    for (const urls of Object.values(linkMap)) if (urls[0]) wanted.set(urls[0], '')
    for (const a of artList) wanted.set(a.url, a.updated)
    for (const [url, upd] of wanted) {
      const known = artList.find(a => artId(a.url) === artId(url))
      await ensureThumb($, url, known?.updated ?? upd)
    }
  } finally {
    busy = false
  }
}

async function include($: Engine, c: Chat) {
  const next = await update($, saved, list => (list.some(s => s.id === c.id) ? list : [{ id: c.id, title: c.title }, ...list]))
  await $.store.set('saved', next)
}

async function removeChat($: Engine, id: string) {
  const next = await update($, saved, list => list.filter(s => s.id !== id))
  await $.store.set('saved', next)
}

async function hideArt($: Engine, url: string) {
  const next = await update($, hidden, list => (list.includes(url) ? list : [...list, url]))
  await $.store.set('hidden', next)
}

async function showAllArts($: Engine) {
  await update($, hidden, () => [])
  await $.store.set('hidden', [])
}

async function openPane($: Engine) {
  await $.ui.open({ id: PANE, title: TITLE, focus: true })
  await refresh($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const s = await $.store.get('saved')
    if (Array.isArray(s)) await update($, saved, () => s as Saved[])
    const h = await $.store.get('hidden')
    if (Array.isArray(h)) await update($, hidden, () => h.map(String))
    await $.command.register({ name: 'trabalhos', description: 'Abre o painel Meus Trabalhos' })
    await $.command.register({ name: 'chats', description: 'Abre o painel Meus Trabalhos' })
    void refresh($)
    $.clock.every(180_000, () => void refresh($))
    return next(e)
  })

  on('command.run', { command: 'trabalhos' }, async $ => {
    await openPane($)
    return { text: 'Painel "Meus Trabalhos" aberto.' }
  })
  on('command.run', { command: 'chats' }, async $ => {
    await openPane($)
    return { text: 'Painel "Meus Trabalhos" aberto.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const n = (await read($, saved)).length
    return (
      <Box flexDirection="row" gap={1}>
        <Button key="abrir-trabalhos" label="🗂 Meus Trabalhos" hotkey="t" onPress={() => openPane($)} />
        <Text dimColor>{n} chat(s) incluído(s)</Text>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const els = $.ui.resolve(e) as unknown as Record<string, any>
    const Svg = els.Svg
    const list = await read($, chats)
    const mine = await read($, saved)
    const artList = await read($, arts)
    const hiddenList = await read($, hidden)
    const isPicking = await read($, picking)
    const line = await read($, status)
    const linkMap = await read($, links)
    await read($, pics)
    const now = await $.clock.now()
    const wide = (e.viewport?.columns ?? 80) >= 70
    const imgW = wide ? 300 : 260
    const imgH = Math.round(imgW * 0.627)

    const picture = (url: string | undefined, alt: string) => {
      if (!url) return null
      const b64 = images.get(artId(url))
      if (!b64) return <Text dimColor>🖼 gerando miniatura…</Text>
      if (!Svg) return <Text dimColor>🖼 miniatura disponível no app desktop</Text>
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 440 276" width="${imgW}" height="${imgH}"><rect width="440" height="276" rx="10" fill="#eee"/><image href="data:image/jpeg;base64,${b64}" width="440" height="276" preserveAspectRatio="xMidYMin slice"/></svg>`
      if (svg.length > 131000) return <Text dimColor>🖼 miniatura grande demais</Text>
      return <Svg key={`img-${artId(url)}`} source={svg} width={imgW} height={imgH} alt={`Miniatura de ${alt}`} />
    }

    const card = (key: string, kind: string, title: string, chat: string | undefined, meta: string, note: string | undefined, art: string | undefined, actions: any) => (
      <Box key={key} flexDirection="column" borderStyle="round" paddingX={1} marginRight={1} marginBottom={1} width={wide ? '48%' : '100%'}>
        {picture(art, title)}
        <Text dimColor>{kind}  {meta}</Text>
        <Text bold>{title}</Text>
        {note && <Text dimColor>{note.slice(0, 120)}</Text>}
        <Box flexDirection="row" gap={2} flexWrap="wrap">
          {chat && <Link href={chat} label="💬 Abrir conversa" />}
          {art && <Link href={art} label="🌐 Abrir artefato no navegador" />}
          {actions}
        </Box>
      </Box>
    )

    const stateOf = (live?: Chat) =>
      live?.bucket === 'WORKING' ? '⚙️ em andamento' :
      live?.bucket === 'BLOCKED' || live?.bucket === 'REVIEW_READY' ? '⏳ aguardando você' :
      live?.bucket === 'FAILED' ? '❗ erro' : '💬 chat'

    const chatCards = mine.map(s => {
      const live = list.find(c => c.id === s.id)
      return card(`c-${s.id}`, stateOf(live), live?.title ?? s.title, chatUrl(s.id), live ? ago(live.updatedAt, now) : '', live?.note, linkMap[s.id]?.[0],
        <Button key={`rm-${s.id}`} label="Remover" onPress={() => removeChat($, s.id)} />)
    })

    const withArt = list.filter(c => !mine.some(s => s.id === c.id) && (linkMap[c.id]?.length ?? 0) > 0)
    const withArtCards = withArt.map(c =>
      card(`w-${c.id}`, stateOf(c), c.title, chatUrl(c.id), ago(c.updatedAt, now), c.note, linkMap[c.id]![0],
        <Button key={`inc-${c.id}`} label="+ Incluir" onPress={() => include($, c)} />))

    const linkedIds = new Set(Object.values(linkMap).flat().map(artId))
    const looseArts = artList.filter(a => !hiddenList.includes(a.url) && !linkedIds.has(artId(a.url)))
    const artCards = looseArts.map(a =>
      card(`a-${a.url}`, '🎨 artefato', a.title, undefined, `atualizado ${a.updated}`, undefined, a.url,
        <Button key={`hide-${a.url}`} label="Ocultar" onPress={() => hideArt($, a.url)} />))

    const candidates = list.filter(c => !mine.some(s => s.id === c.id)).slice(0, 25)

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Button key="refresh" label="Atualizar" hotkey="r" onPress={() => refresh($)} />
          <Button key="pick" label={isPicking ? 'Fechar lista' : '+ Incluir chat'} hotkey="i" onPress={() => update($, picking, v => !v)} />
          <Text dimColor>{line}</Text>
        </Box>

        {isPicking && (
          <Box flexDirection="column" marginTop={1} borderStyle="single" paddingX={1}>
            <Text bold>Escolha os chats para incluir</Text>
            {candidates.length === 0 && <Text dimColor>Nenhum outro chat encontrado.</Text>}
            {candidates.map(c => (
              <Box key={`p-${c.id}`} flexDirection="row" gap={1}>
                <Button key={`add-${c.id}`} label="+ Incluir" onPress={() => include($, c)} />
                <Text>{c.title}</Text>
                <Text dimColor>{ago(c.updatedAt, now)}</Text>
              </Box>
            ))}
          </Box>
        )}

        <Box flexDirection="column" marginTop={1}>
          <Text bold>💬 Chats incluídos ({chatCards.length})</Text>
          {chatCards.length === 0 && <Text dimColor>Clique em "+ Incluir chat" para adicionar conversas aqui.</Text>}
          <Box flexDirection="row" flexWrap="wrap">{chatCards}</Box>
        </Box>

        <Box flexDirection="column" marginTop={1}>
          <Text bold>🖼 Conversas com artefatos ({withArtCards.length})</Text>
          {withArtCards.length === 0 && <Text dimColor>Procurando artefatos nas suas conversas…</Text>}
          <Box flexDirection="row" flexWrap="wrap">{withArtCards}</Box>
        </Box>

        <Box flexDirection="column" marginTop={1}>
          <Text bold>🎨 Outros artefatos ({artCards.length})</Text>
          <Box flexDirection="row" flexWrap="wrap">{artCards}</Box>
          {hiddenList.length > 0 && (
            <Button key="show-all" label={`Mostrar ${hiddenList.length} oculto(s)`} onPress={() => showAllArts($)} />
          )}
        </Box>

        <Box marginTop={1}>
          <Link href="https://claude.ai/code" label="Ver todos os chats em claude.ai/code" />
        </Box>
      </Box>
    )
  })
}
