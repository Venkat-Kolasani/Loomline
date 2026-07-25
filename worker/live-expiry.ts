/**
 * Minimal durable metadata for provisional live-stroke expiry.
 * Points stay in-memory only; this table survives Durable Object hibernation.
 */

export interface LiveStrokeExpiryRow {
  participantId: string;
  strokeId: string;
  roomId: string;
  expiresAt: number;
}

export function ensureLiveExpirySchema(sql: SqlStorage): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS live_stroke_expiry (
      participant_id TEXT NOT NULL,
      stroke_id TEXT NOT NULL,
      room_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      PRIMARY KEY (participant_id, stroke_id)
    );
  `);
  sql.exec(`
    CREATE INDEX IF NOT EXISTS idx_live_stroke_expiry_expires
    ON live_stroke_expiry (expires_at);
  `);
}

export function upsertLiveStrokeExpiry(
  sql: SqlStorage,
  row: LiveStrokeExpiryRow,
): void {
  sql.exec(
    `INSERT INTO live_stroke_expiry (participant_id, stroke_id, room_id, expires_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(participant_id, stroke_id) DO UPDATE SET
       room_id = excluded.room_id,
       expires_at = excluded.expires_at`,
    row.participantId,
    row.strokeId,
    row.roomId,
    row.expiresAt,
  );
}

export function deleteLiveStrokeExpiry(
  sql: SqlStorage,
  participantId: string,
  strokeId: string,
): void {
  sql.exec(
    `DELETE FROM live_stroke_expiry WHERE participant_id = ? AND stroke_id = ?`,
    participantId,
    strokeId,
  );
}

export function deleteLiveStrokeExpiryForParticipant(
  sql: SqlStorage,
  participantId: string,
): LiveStrokeExpiryRow[] {
  const rows = listLiveStrokeExpiryForParticipant(sql, participantId);
  sql.exec(
    `DELETE FROM live_stroke_expiry WHERE participant_id = ?`,
    participantId,
  );
  return rows;
}

export function listLiveStrokeExpiryForParticipant(
  sql: SqlStorage,
  participantId: string,
): LiveStrokeExpiryRow[] {
  return sql
    .exec<{
      participant_id: string;
      stroke_id: string;
      room_id: string;
      expires_at: number;
    }>(
      `SELECT participant_id, stroke_id, room_id, expires_at
       FROM live_stroke_expiry WHERE participant_id = ?`,
      participantId,
    )
    .toArray()
    .map((row) => ({
      participantId: row.participant_id,
      strokeId: row.stroke_id,
      roomId: row.room_id,
      expiresAt: row.expires_at,
    }));
}

export function listExpiredLiveStrokes(
  sql: SqlStorage,
  now: number,
): LiveStrokeExpiryRow[] {
  return sql
    .exec<{
      participant_id: string;
      stroke_id: string;
      room_id: string;
      expires_at: number;
    }>(
      `SELECT participant_id, stroke_id, room_id, expires_at
       FROM live_stroke_expiry WHERE expires_at <= ?
       ORDER BY expires_at ASC`,
      now,
    )
    .toArray()
    .map((row) => ({
      participantId: row.participant_id,
      strokeId: row.stroke_id,
      roomId: row.room_id,
      expiresAt: row.expires_at,
    }));
}

export function countLiveStrokeExpiry(sql: SqlStorage): number {
  const row = sql
    .exec<{ n: number }>(`SELECT COUNT(*) AS n FROM live_stroke_expiry`)
    .one();
  return row.n;
}

/** Soonest expires_at, or null when the table is empty. */
export function soonestLiveStrokeExpiry(sql: SqlStorage): number | null {
  const row = sql
    .exec<{ min_exp: number | null }>(
      `SELECT MIN(expires_at) AS min_exp FROM live_stroke_expiry`,
    )
    .one();
  return row.min_exp;
}
