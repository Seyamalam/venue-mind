export declare const stableFingerprint: (prefix: any, value: any) => string;
export declare const fingerprintPlan: (plan: any) => string;
export declare const fingerprintEventBrief: (brief: any) => string;
export declare const createActivityEntry: (sequence: any, type: any, actor: any, details?: any, metadata?: any) => {
    id: string;
    schemaVersion: number;
    sequence: any;
    type: any;
    actor: any;
    actorId: any;
    actorType: any;
    source: any;
    sessionId: any;
    occurredAt: any;
    details: any;
};
export declare function sealActivityLedger(entries: any): any;
export declare function verifyActivityLedger(entries: any): {
    status: string;
    entries: any;
    headHash: any;
};
export declare function normalizeActivityLedger(entries: any): any;
export declare function replayActivityLedger(entries: any, currentPlan: any, currentBrief?: any): {
    status: string;
    transitions: any;
    currentPlanVersion: any;
    replayedFingerprint: any;
    currentFingerprint: any;
    replayedBriefFingerprint: any;
    currentBriefFingerprint: any;
    briefTransitions: any;
    ledgerHeadHash: any;
    lockedObjectViolations: any[];
    truthFingerprintViolations: any;
};
