import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer as createViteServer } from 'vite'
import { actionRequestSchema, runSafeAction } from './actions.ts'
import { loadConfig } from './config.ts'
import { buildSnapshot } from './discovery.ts'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(dirname, '..')
const config = loadConfig()
const isProduction = process.env.NODE_ENV === 'production'
const port = Number(process.env.PORT ?? 4111)
const host = process.env.HOST ?? '127.0.0.1'

const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '64kb' }))

app.get('/api/health', (_request, response) => {
  response.json({ ok: true, generatedAt: new Date().toISOString() })
})

app.get('/api/snapshot', async (_request, response, next) => {
  try {
    response.setHeader('Cache-Control', 'no-store')
    response.json(await buildSnapshot(config))
  } catch (error) {
    next(error)
  }
})

app.post('/api/actions', async (request, response, next) => {
  try {
    const body = actionRequestSchema.parse(request.body)
    response.json(await runSafeAction(config, body))
  } catch (error) {
    next(error)
  }
})

if (isProduction) {
  const dist = path.join(root, 'dist')
  app.use(express.static(dist))
  app.use((request, response, next) => {
    if (request.path.startsWith('/api/')) return next()
    response.sendFile(path.join(dist, 'index.html'))
  })
} else {
  const vite = await createViteServer({
    root,
    server: { middlewareMode: true },
    appType: 'spa',
  })
  app.use(vite.middlewares)
}

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : 'Unknown error'
  response.status(500).json({
    error: 'Request failed',
    message,
  })
})

app.listen(port, host, () => {
  console.log(`Local Suite listening on http://${host}:${port}`)
})
