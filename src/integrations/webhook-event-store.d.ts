export declare function createMemoryWebhookEventStore(initialEntries?: any): Readonly<{
    putIfAbsent(key: any, value: any): Promise<{
        inserted: boolean;
        value: any;
    }>;
    get(key: any): Promise<any>;
    list(): {
        key: any;
        value: any;
    }[];
}>;
