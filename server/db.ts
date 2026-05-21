import { Pool } from 'pg'
import dotenv from 'dotenv'

dotenv.config()

const isLocalhost = process.env.DATABASE_URL?.includes('localhost')

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocalhost ? false : { rejectUnauthorized: false },
})
