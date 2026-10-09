export interface SqlDatabase {
    exec(query: string, ...bindings: (string | number | null)[]): Iterable<Record<string, unknown>>;
}
