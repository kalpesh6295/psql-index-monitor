import express, { type Request, type Response } from 'express'
import cors from 'cors'
import { pool } from './db.js'
import { queries } from './queries.js'

const app = express()
const PORT = parseInt(process.env.API_PORT || '4200')

app.use(cors())
app.use(express.json())

function handler(queryFn: (req: Request) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      const result = await queryFn(req)
      res.json(result)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      console.error(`[${req.path}]`, message)
      res.status(500).json({ error: message })
    }
  }
}

app.get(
  '/api/overview',
  handler(async () => {
    const { rows } = await pool.query(queries.overview)
    return rows[0]
  }),
)

app.get(
  '/api/indexes',
  handler(async () => {
    const { rows } = await pool.query(queries.allIndexes)
    return rows
  }),
)

app.get(
  '/api/unused',
  handler(async () => {
    const { rows } = await pool.query(queries.unusedIndexes)
    return rows
  }),
)

app.get(
  '/api/most-used',
  handler(async () => {
    const { rows } = await pool.query(queries.mostUsed)
    return rows
  }),
)

app.get(
  '/api/table-sizes',
  handler(async () => {
    const { rows } = await pool.query(queries.tableSizes)
    return rows
  }),
)

app.get(
  '/api/bloat',
  handler(async () => {
    const { rows } = await pool.query(queries.indexBloat)
    return rows
  }),
)

app.get(
  '/api/duplicates',
  handler(async () => {
    const { rows } = await pool.query(queries.duplicateIndexes)
    return rows
  }),
)

app.get(
  '/api/seq-vs-idx',
  handler(async () => {
    const { rows } = await pool.query(queries.indexVsSeqScan)
    return rows
  }),
)

app.get(
  '/api/missing',
  handler(async () => {
    const { rows } = await pool.query(queries.missingIndexes)
    return rows
  }),
)

app.get(
  '/api/write-overhead',
  handler(async () => {
    const { rows } = await pool.query(queries.writeOverhead)
    return rows
  }),
)

app.get(
  '/api/index-table-ratio',
  handler(async () => {
    const { rows } = await pool.query(queries.indexTableRatio)
    return rows
  }),
)

app.listen(PORT, () => {
  console.log(`Index Monitor API running on http://localhost:${PORT}`)
})
