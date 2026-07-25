/**
 * Durable room operation records and SQLite helpers for RoomDurableObject.
 * One row per completed stroke; sequence is the authoritative order key.
 */

import type { DrawingTool, StrokePoint } from "../shared/protocol";

export interface StoredOperation {
  sequence: number;
  opId: string;
  participantId: string;
  strokeId: string;
  tool: DrawingTool;
  color: string;
  width: number;
  points: StrokePoint[];
  createdAt: number;
}

export function ensureOperationSchema(sql: SqlStorage): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS operations (
      sequence INTEGER PRIMARY KEY,
      op_id TEXT NOT NULL UNIQUE,
      participant_id TEXT NOT NULL,
      stroke_id TEXT NOT NULL,
      tool TEXT NOT NULL,
      color TEXT NOT NULL,
      width INTEGER NOT NULL,
      points_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
}

export function nextSequence(sql: SqlStorage): number {
  const row = sql
    .exec<{ max_seq: number | null }>(
      "SELECT MAX(sequence) AS max_seq FROM operations",
    )
    .one();
  return (row.max_seq ?? 0) + 1;
}

export function insertOperation(sql: SqlStorage, op: StoredOperation): void {
  sql.exec(
    `INSERT INTO operations (
      sequence, op_id, participant_id, stroke_id, tool, color, width, points_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    op.sequence,
    op.opId,
    op.participantId,
    op.strokeId,
    op.tool,
    op.color,
    op.width,
    JSON.stringify(op.points),
    op.createdAt,
  );
}

export function listOperations(sql: SqlStorage): StoredOperation[] {
  const rows = sql
    .exec<{
      sequence: number;
      op_id: string;
      participant_id: string;
      stroke_id: string;
      tool: string;
      color: string;
      width: number;
      points_json: string;
      created_at: number;
    }>("SELECT * FROM operations ORDER BY sequence ASC")
    .toArray();

  return rows.map((row) => ({
    sequence: row.sequence,
    opId: row.op_id,
    participantId: row.participant_id,
    strokeId: row.stroke_id,
    tool: row.tool as DrawingTool,
    color: row.color,
    width: row.width,
    points: JSON.parse(row.points_json) as StrokePoint[],
    createdAt: row.created_at,
  }));
}

export function sequenceHead(sql: SqlStorage): number {
  const row = sql
    .exec<{ max_seq: number | null }>(
      "SELECT MAX(sequence) AS max_seq FROM operations",
    )
    .one();
  return row.max_seq ?? 0;
}
