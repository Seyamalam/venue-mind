export declare function createMemoryProcessedBatchStore(): Readonly<{
    get(idempotencyKey: any): Promise<any>;
    putIfAbsent(idempotencyKey: any, value: any): Promise<{
        inserted: boolean;
        value: any;
    }>;
    list(): any[];
}>;
