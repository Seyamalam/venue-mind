export declare function createExternalIdMapping({ venueEntityType, venueObjectId, external, batchId, sourceSystem, sourceVersion, synchronizedAt, checksum }: any): any;
export declare const stagingIntegrityPayload: (batch: any) => {
    schemaVersion: any;
    status: any;
    adapterId: any;
    adapterVersion: any;
    sourceSystem: any;
    sourceVersion: any;
    synchronizedAt: any;
    basePlanVersion: any;
    proposalRevision: any;
    syncCursor: any;
    mappings: any;
    sourceRecords: any;
    warnings: any;
    proposal: {
        revision: any;
        baseVersion: any;
        status: any;
        goal: any;
        changes: any;
        validation: any;
        waivers: any;
    } | null;
};
export declare function createAdapterStagingBatch(definition: any, input: any, options?: any): Promise<any>;
export declare function assertStagingBatchIntegrity(batch: any): Promise<boolean>;
export declare function assertAdapterProjectContext(batch: any, context: any): boolean;
export declare function assertReviewableStagingBatch(batch: any, projectContext?: any, { requireProjectContext }?: any): Promise<boolean>;
export declare function loadAdapterProposalForReview(planner: any, batch: any): Promise<Readonly<{
    status: "review";
    proposalId: any;
    revision: any;
    baseVersion: any;
    changedItems: any;
    requiresHumanApproval: true;
}>>;
