/**
 * Durable room operation records and SQLite helpers for RoomDurableObject.
 * One row per committed stroke/clear; sequence is the authoritative order key.
 */

import type { DrawingTool, StrokePoint } from "../shared/protocol";

interface StoredOperationBase {
  sequence: number;
  opId: string;
  participantId: string;
  createdAt: number;
}

export interface StoredStrokeOperation extends StoredOperationBase {
  kind: "stroke";
  strokeId: string;
  tool: DrawingTool;
  color: string;
  width: number;
  points: StrokePoint[];
}

export interface StoredClearOperation extends StoredOperationBase {
  kind: "clear";
}

export type StoredOperation = StoredStrokeOperation | StoredClearOperation;

export function ensureOperationSchema(sql: SqlStorage): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS operations (
      sequence INTEGER PRIMARY KEY,
      op_id TEXT NOT NULL UNIQUE,
      participant_id TEXT NOT NULL,
      operation_type TEXT NOT NULL DEFAULT 'stroke',
      stroke_id TEXT NOT NULL,
      tool TEXT NOT NULL,
      color TEXT NOT NULL,
      width INTEGER NOT NULL,
      points_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  const columns = sql
    .exec<{ name: string }>("PRAGMA table_info(operations)")
    .toArray();
  if (!columns.some((column) => column.name === "operation_type")) {
    // Existing rooms predate clear operations. The default classifies every
    // legacy row as a stroke without rewriting or deleting the append-only log.
    sql.exec(
      "ALTER TABLE operations ADD COLUMN operation_type TEXT NOT NULL DEFAULT 'stroke'",
    );
  }
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
  const stroke = op.kind === "stroke" ? op : null;
  sql.exec(
    `INSERT INTO operations (
      sequence, op_id, participant_id, operation_type, stroke_id, tool, color,
      width, points_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    op.sequence,
    op.opId,
    op.participantId,
    op.kind,
    stroke?.strokeId ?? "",
    stroke?.tool ?? "",
    stroke?.color ?? "",
    stroke?.width ?? 0,
    JSON.stringify(stroke?.points ?? []),
    op.createdAt,
  );
}

export function listOperations(sql: SqlStorage): StoredOperation[] {
  const rows = sql
    .exec<{
      sequence: number;
      op_id: string;
      participant_id: string;
      operation_type: string;
      stroke_id: string;
      tool: string;
      color: string;
      width: number;
      points_json: string;
      created_at: number;
    }>("SELECT * FROM operations ORDER BY sequence ASC")
    .toArray();

  return rows.map((row) => {
    const base: StoredOperationBase = {
      sequence: row.sequence,
      opId: row.op_id,
      participantId: row.participant_id,
      createdAt: row.created_at,
    };
    if (row.operation_type === "clear") {
      return { ...base, kind: "clear" };
    }
    return {
      ...base,
      kind: "stroke",
      strokeId: row.stroke_id,
      tool: row.tool as DrawingTool,
      color: row.color,
      width: row.width,
      points: JSON.parse(row.points_json) as StrokePoint[],
    };
  });
}

export function sequenceHead(sql: SqlStorage): number {
  const row = sql
    .exec<{ max_seq: number | null }>(
      "SELECT MAX(sequence) AS max_seq FROM operations",
    )
    .one();
  return row.max_seq ?? 0;
}
