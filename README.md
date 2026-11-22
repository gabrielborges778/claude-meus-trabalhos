# Meus Trabalhos

Painel para o Claude Code que organiza suas conversas em cards. Um botão **🗂 Meus Trabalhos** aparece acima da caixa de texto em toda conversa. Ao clicar, abre um painel ao lado do chat com:

- **Chats incluídos:** as conversas que você escolhe com "+ Incluir chat".
- **Conversas com artefatos:** conversas em que um artefato foi criado ou citado, com uma miniatura dele.
- **Outros artefatos:** artefatos que não foram ligados a nenhuma conversa.
- Filtros **☁️ Nuvem** e **💻 Meu PC** separam as conversas da nuvem das que rodam no seu computador.

Cada card tem os links **💬 Abrir conversa** e **🌐 Abrir artefato no navegador**. Também abre com `/trabalhos`.

A lista de conversas e as miniaturas usam as ferramentas das sessões na nuvem do Claude Code. Em sessões locais o painel pode aparecer sem essas informações. As miniaturas precisam de Node e Playwright.

## Instalar

No prompt de uma sessão de terminal:

```
/plugin install meus-trabalhos --marketplace gabrielborges778/claude-meus-trabalhos
```

Num terminal comum:

```bash
claude plugin install meus-trabalhos --marketplace gabrielborges778/claude-meus-trabalhos
```

No app desktop, onde `/plugin` não funciona: clique no + ao lado da caixa de texto, depois em Plugins, Add marketplace com `gabrielborges778/claude-meus-trabalhos`, e depois em Add plugin.

O repositório é privado. Para instalar, o computador precisa ter acesso ao GitHub (por exemplo, `gh auth login` e depois `gh auth setup-git`).
