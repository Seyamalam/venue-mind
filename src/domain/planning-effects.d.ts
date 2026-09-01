export declare function normalizePlanningEffect(input: any): Readonly<{
    operation: any;
    targetBriefId: any;
    targetRequirementId: any;
    before: any;
    after: any;
    requirement: any;
    affectedConstraintIds: any;
    evidenceFamilies: any;
    source: any;
}>;
export declare function assertPlanningEffectBinding(rawEffect: any, context: any): any;
export declare function normalizeProposalPlanningEffects(proposal: any, path?: any): any;
export declare function materializeEventBrief(brief: any, changes?: any): any;
export declare function planningEvidenceInvalidations(changes?: any): Readonly<{
    affectedConstraintIds: any[];
    evidenceFamilies: any[];
}>;
