/**
 * Global tombstone undo/redo state for a room.
 * The operations table stays append-only; visibility is history_hidden + redo stack.
 */

export function ensureHistorySchema(sql: SqlStorage): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS history_hidden (
      sequence INTEGER PRIMARY KEY
    );
  `);
  sql.exec(`
    CREATE TABLE IF NOT EXISTS history_redo_stack (
      position INTEGER PRIMARY KEY,
      sequence INTEGER NOT NULL UNIQUE
    );
  `);
}

export function listHiddenSequences(sql: SqlStorage): Set<number> {
  const rows = sql
    .exec<{ sequence: number }>("SELECT sequence FROM history_hidden")
    .toArray();
  return new Set(rows.map((row) => row.sequence));
}

export function canUndo(sql: SqlStorage, sequenceHead: number): boolean {
  if (sequenceHead <= 0) {
    return false;
  }
  return latestVisibleSequence(sql, sequenceHead) !== null;
}

export function canRedo(sql: SqlStorage): boolean {
  const row = sql
    .exec<{ n: number }>("SELECT COUNT(*) AS n FROM history_redo_stack")
    .one();
  return row.n > 0;
}

/** Highest sequence that is not currently hidden, or null if none visible. */
export function latestVisibleSequence(
  sql: SqlStorage,
  sequenceHead: number,
): number | null {
  const hidden = listHiddenSequences(sql);
  for (let sequence = sequenceHead; sequence >= 1; sequence -= 1) {
    if (!hidden.has(sequence)) {
      return sequence;
    }
  }
  return null;
}

/**
 * Tombstone the latest visible completed operation.
 * Returns the tombstoned sequence, or null when nothing is undoable.
 */
export function applyUndo(
  sql: SqlStorage,
  sequenceHead: number,
): number | null {
  const target = latestVisibleSequence(sql, sequenceHead);
  if (target === null) {
    return null;
  }

  sql.exec(
    "INSERT OR IGNORE INTO history_hidden (sequence) VALUES (?)",
    target,
  );

  const top = sql
    .exec<{ max_pos: number | null }>(
      "SELECT MAX(position) AS max_pos FROM history_redo_stack",
    )
    .one();
  const nextPosition = (top.max_pos ?? -1) + 1;
  sql.exec(
    "INSERT INTO history_redo_stack (position, sequence) VALUES (?, ?)",
    nextPosition,
    target,
  );

  return target;
}

/**
 * Remove the newest redoable tombstone.
 * Returns the restored sequence, or null when nothing is redoable.
 */
export function applyRedo(sql: SqlStorage): number | null {
  const top = sql
    .exec<{ position: number; sequence: number }>(
      "SELECT position, sequence FROM history_redo_stack ORDER BY position DESC LIMIT 1",
    )
    .toArray()[0];
  if (!top) {
    return null;
  }

  sql.exec(
    "DELETE FROM history_redo_stack WHERE position = ?",
    top.position,
  );
  sql.exec("DELETE FROM history_hidden WHERE sequence = ?", top.sequence);
  return top.sequence;
}

/** New committed ops clear the redo branch; existing tombstones stay hidden. */
export function clearRedoBranch(sql: SqlStorage): void {
  sql.exec("DELETE FROM history_redo_stack");
}

export function filterVisibleOperations<T extends { sequence: number }>(
  operations: readonly T[],
  hidden: ReadonlySet<number>,
): T[] {
  return operations.filter((op) => !hidden.has(op.sequence));
}
