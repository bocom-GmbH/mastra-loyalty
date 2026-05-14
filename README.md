# Mastra + Studio no Coolify

Stack pronto pra deploy no Coolify usando **Docker Compose**:

- **`mastra`** — servidor Mastra (Hono) com agent de exemplo + Postgres.
- **`studio`** — Mastra Studio standalone, protegido por Basic Auth via Traefik.

## Estrutura

```
.
├── Dockerfile              # build do servidor Mastra (mastra build --studio + mastra start)
├── Dockerfile.studio       # imagem do CLI rodando `mastra studio`
├── docker-compose.yml      # stack do Coolify (mastra + studio)
├── .env.example            # variáveis a configurar no Coolify
├── package.json
├── tsconfig.json
└── src/mastra/
    ├── index.ts
    ├── agents/weather-agent.ts
    └── tools/weather-tool.ts
```

## Pré-requisitos no Coolify

1. Um projeto criado.
2. Um **PostgreSQL** rodando no mesmo projeto (resource → Database → PostgreSQL). Anote o hostname interno (algo como `postgresql-xxxx`).
3. Dois domínios apontando pra esse servidor: ex. `api.seudominio.com` e `studio.seudominio.com`.

## Deploy passo a passo

### 1. Subir o código pro Git

Crie um repo (GitHub/GitLab/Gitea) e faça push deste projeto.

### 2. Criar o Resource no Coolify

- New Resource → **Docker Compose** (a partir de Git).
- Aponte pro seu repo / branch.
- Coolify vai detectar o `docker-compose.yml`.

### 3. Variáveis de ambiente

No painel do Coolify, em **Environment Variables**, defina:

| Variável             | Exemplo                                             |
|----------------------|-----------------------------------------------------|
| `DATABASE_URL`       | `postgresql://mastra:senha@postgresql-xxxx:5432/mastra` |
| `DATABASE_SSL`       | `false` (Postgres interno) / `true` (managed)       |
| `OPENAI_API_KEY`     | `sk-...`                                            |
| `STUDIO_BASIC_AUTH`  | saída de `htpasswd -nbB admin 'senha'` (ver abaixo) |

**Gerando o `STUDIO_BASIC_AUTH`:**

```bash
htpasswd -nbB admin 'sua-senha-forte'
# saída ex.: admin:$2y$05$abc...xyz
```

Cole **a saída exatamente como veio** no campo do Coolify — o painel já cuida do escaping dos `$`. (Só duplique `$$` se for editar o `docker-compose.yml` diretamente.)

### 4. Domínios

Em cada serviço no Coolify:

- **`mastra`** → FQDN `api.seudominio.com` → porta `4111`.
- **`studio`** → FQDN `studio.seudominio.com` → porta `3000`.

O Coolify aplica TLS via Let's Encrypt automaticamente.

### 5. Deploy

Clique em **Deploy**. O build vai:

1. Instalar deps (`npm install`).
2. Rodar `mastra build --studio` → gera `.mastra/output/`.
3. Subir o servidor com `node .mastra/output/index.mjs`.
4. Subir o container do Studio apontando pro serviço `mastra` na rede interna do compose.

### 6. Verificação

- `https://api.seudominio.com/api/health` → deve retornar OK.
- `https://studio.seudominio.com` → pede login (Basic Auth). Depois mostra a UI conectada à sua API.

## Desenvolvimento local

```bash
npm install
cp .env.example .env   # preencher DATABASE_URL + OPENAI_API_KEY
npm run dev            # mastra dev (API + Studio em http://localhost:4111)
```

Ou via Docker Compose local (precisa de um Postgres):

```bash
docker compose up --build
```

## Notas

- **Storage**: `PostgresStore` cria automaticamente as tabelas (`mastra_messages`, `mastra_threads`, etc) no schema `public` no primeiro start. Não precisa rodar migration manual.
- **Studio em produção tem acesso total** a agents/tools/workflows. **Sempre** mantenha o Basic Auth (ou troque por outro middleware do Traefik, ex.: `forwardAuth` com OAuth).
- Pra adicionar mais agents/workflows, crie o arquivo em [src/mastra/agents/](src/mastra/agents/) e registre no [src/mastra/index.ts](src/mastra/index.ts).
- Versões usadas: `@mastra/core` ^1.33, `mastra` CLI ^1.9, Node 22.
