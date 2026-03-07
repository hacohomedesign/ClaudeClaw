import pg from 'pg';
import { readEnvFile } from '../env.js';
import { logger } from '../logger.js';

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function initEmbeddingsPool(): void {
  const env = readEnvFile(['MAILHUB_PGVECTOR_DSN']);
  const dsn = env.MAILHUB_PGVECTOR_DSN;
  if (!dsn) {
    logger.warn('MAILHUB_PGVECTOR_DSN not set, embeddings disabled');
    return;
  }
  pool = new Pool({ connectionString: dsn, max: 3 });
}

export async function embedText(text: string): Promise<number[] | null> {
  try {
    const res = await fetch('http://localhost:11434/api/embed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'nomic-embed-text', input: text }),
    });
    const data = await res.json() as { embeddings: number[][] };
    return data.embeddings?.[0] ?? null;
  } catch (err) {
    logger.error({ err }, 'Ollama embed failed');
    return null;
  }
}

export async function storeEmbedding(emailId: number, embedding: number[]): Promise<void> {
  if (!pool) return;
  const vecStr = `[${embedding.join(',')}]`;
  await pool.query(
    'INSERT INTO mailhub_embeddings (email_id, embedding) VALUES ($1, $2::vector)',
    [emailId, vecStr],
  );
}

export async function searchSimilar(queryText: string, limit = 5): Promise<Array<{ emailId: number; similarity: number }>> {
  if (!pool) return [];
  const embedding = await embedText(queryText);
  if (!embedding) return [];
  const vecStr = `[${embedding.join(',')}]`;
  const result = await pool.query(
    `SELECT email_id, 1 - (embedding <=> $1::vector) as similarity
     FROM mailhub_embeddings
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    [vecStr, limit],
  );
  return result.rows.map((r: { email_id: number; similarity: string }) => ({
    emailId: r.email_id,
    similarity: parseFloat(r.similarity),
  }));
}
