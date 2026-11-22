export type Chat = {
  id: string
  title: string
  bucket: string
  archived: boolean
  updatedAt: string
  note?: string
  unread?: boolean
}

export type Art = { url: string; title: string; updated: string }

export type Saved = { id: string; title: string }

declare module 'claude-code' {
  interface PluginState {
    'meus-trabalhos': {
      chats: Shaped<Chat[]>
      arts: Shaped<Art[]>
      saved: Shaped<Saved[]>
      hidden: Shaped<string[]>
      picking: Shaped<boolean>
      status: Shaped<string>
      links: Shaped<Record<string, string[]>>
      pics: Shaped<number>
    }
  }
}
