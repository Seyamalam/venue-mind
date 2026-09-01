export declare function assertSecretReference(reference: any): string;
export declare function createMemorySecretStore(entries?: any): Readonly<{
    get(reference: any): Promise<any>;
}>;
export declare function createScopedSecretReader(secretStore: any, allowedReferences?: any): Readonly<{
    get(reference: any): Promise<any>;
}>;
