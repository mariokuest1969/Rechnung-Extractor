// Deliberately has no database driver or connection: all records are test-owned.
type Row = { key: string; value: string; updatedAt: Date };
type Predicate = (row: Row) => boolean;
export const settingsTable = { key: "key", value: "value", updatedAt: "updatedAt" } as const;
export const eq = (column: keyof Row, value: unknown): Predicate => row => row[column] === value;
export const lt = (column: keyof Row, value: Date): Predicate => row => row[column] < value;
export const like = (column: keyof Row, pattern: string): Predicate => row =>
  String(row[column]).startsWith(pattern.replace(/%$/, ""));
export const and = (...conditions: Predicate[]): Predicate => row => conditions.every(condition => condition(row));
export const rows = new Map<string, Row>();
export let failTransaction = false;
export function setTransactionFailure(value: boolean) { failTransaction = value; }
export function seed(records: Row[]) {
  rows.clear();
  for (const row of records) rows.set(row.key, { ...row, updatedAt: new Date(row.updatedAt) });
}
export const db = {
  select: () => ({ from: () => ({ where: async (predicate: Predicate) =>
    [...rows.values()].filter(predicate).map(row => ({ ...row })) }) }),
  insert: () => ({ values: (input: { key: string; value: string }) => {
    const insert = (update = false) => {
      if (!update && rows.has(input.key)) throw new Error("Duplicate test key");
      rows.set(input.key, { ...input, updatedAt: new Date() });
    };
    return {
      then(resolve: (value: void) => unknown, reject: (error: unknown) => unknown) {
        return Promise.resolve().then(() => insert()).then(resolve, reject);
      },
      onConflictDoUpdate: async () => insert(true),
    };
  } }),
  delete: () => ({ where: (predicate: Predicate) => {
    // Execution is deferred until awaited, like a Drizzle query. Consumption is
    // atomic, so two finish calls cannot both delete the same pending record.
    const execute = () => {
      const removed = [...rows.values()].filter(predicate);
      for (const row of removed) rows.delete(row.key);
      return removed;
    };
    return {
      then(resolve: (value: Row[]) => unknown, reject: (error: unknown) => unknown) {
        return Promise.resolve().then(execute).then(resolve, reject);
      },
      returning: async () => execute(),
    };
  } }),
  transaction: async (callback: (tx: typeof db) => Promise<void>) => {
    const snapshot = [...rows.values()].map(row => ({ ...row }));
    try {
      await callback(db);
      if (failTransaction) throw new Error("Test commit failure");
    } catch (error) {
      seed(snapshot);
      throw error;
    }
  },
};
