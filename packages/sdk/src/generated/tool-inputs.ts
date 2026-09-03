/* Generated from VenueMind canonical tool contracts. Do not edit. */

export interface VenueMindToolInputMap {
  "venue.list_projects": {};
  "venue.open_project": {
    projectId: string;
  };
  "venue.inspect_templates": {};
  "venue.get_project_brief": {};
  "venue.list_constraints": {
    category?: string;
    severity?: "error" | "warning" | "preference";
  };
  "venue.inspect_layout": {};
  "venue.get_object": {
    objectId: string;
    scope?: "accepted" | "proposal";
  };
  "venue.search_objects": {
    query?: string;
    /**
     * @maxItems 10
     */
    kinds?:
      | []
      | [string]
      | [string, string]
      | [string, string, string]
      | [string, string, string, string]
      | [string, string, string, string, string]
      | [string, string, string, string, string, string]
      | [string, string, string, string, string, string, string]
      | [string, string, string, string, string, string, string, string]
      | [string, string, string, string, string, string, string, string, string]
      | [string, string, string, string, string, string, string, string, string, string];
    /**
     * @maxItems 7
     */
    layers?:
      | []
      | ["architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations"]
      | [
          "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations",
          "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations"
        ]
      | [
          "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations",
          "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations",
          "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations"
        ]
      | [
          "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations",
          "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations",
          "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations",
          "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations"
        ]
      | [
          "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations",
          "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations",
          "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations",
          "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations",
          "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations"
        ]
      | [
          "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations",
          "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations",
          "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations",
          "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations",
          "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations",
          "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations"
        ]
      | [
          "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations",
          "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations",
          "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations",
          "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations",
          "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations",
          "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations",
          "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations"
        ];
    locked?: boolean;
    scope?: "accepted" | "proposal";
    limit?: number;
  };
  "venue.preview_revision": {
    /**
     * The spatial outcome the revision should achieve.
     */
    goal: string;
    /**
     * Unique retry key for this semantic command.
     */
    idempotencyKey: string;
    /**
     * Optional caller correlation identifier.
     */
    correlationId?: string;
  };
  "venue.preview_template_update": {
    templateId: string;
    toVersion: string;
    /**
     * Unique retry key for this semantic command.
     */
    idempotencyKey: string;
    /**
     * Optional caller correlation identifier.
     */
    correlationId?: string;
  };
  "venue.apply_edit": {
    edit:
      | {
          operation: "apply-layout";
          label?: string;
          shortLabel?: string;
          metrics?: [string, string][];
          roomBoundary: {
            /**
             * @minItems 3
             */
            outer: [
              {
                x: number;
                y: number;
              },
              {
                x: number;
                y: number;
              },
              {
                x: number;
                y: number;
              },
              ...{
                x: number;
                y: number;
              }[]
            ];
            holes: [
              {
                x: number;
                y: number;
              },
              {
                x: number;
                y: number;
              },
              {
                x: number;
                y: number;
              },
              ...{
                x: number;
                y: number;
              }[]
            ][];
          };
          /**
           * @minItems 1
           */
          objects: [
            {
              id: string;
              kind: string;
              label?: string;
              layer?: "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations";
              elevationM?: number;
              footprint:
                | {
                    kind: "rectangle";
                    center: {
                      x: number;
                      y: number;
                    };
                    width: number;
                    depth: number;
                    rotationDegrees: number;
                  }
                | {
                    kind: "circle";
                    center: {
                      x: number;
                      y: number;
                    };
                    radius: number;
                  }
                | {
                    kind: "line";
                    start: {
                      x: number;
                      y: number;
                    };
                    end: {
                      x: number;
                      y: number;
                    };
                    width: number;
                  }
                | {
                    kind: "polygon";
                    /**
                     * @minItems 3
                     */
                    points: [
                      {
                        x: number;
                        y: number;
                      },
                      {
                        x: number;
                        y: number;
                      },
                      {
                        x: number;
                        y: number;
                      },
                      ...{
                        x: number;
                        y: number;
                      }[]
                    ];
                    rotationDegrees: number;
                  };
              capacity?: number;
              placement?: {
                collisionMode: "solid";
              };
              circulation?: {
                blocksPath?: boolean;
                blocksExitApproach?: boolean;
                role?: "queue" | "checkpoint";
                demandPersons?: number;
                capacityPersons?: number;
                capacityPersonsPerMinute?: number;
                clearWidthM?: number;
                carCapacityPersons?: number;
                cycleSeconds?: number;
                servesZoneIds?: string[];
              };
              queue?: {
                category:
                  | "registration"
                  | "security"
                  | "cloakroom"
                  | "food"
                  | "beverage"
                  | "restroom"
                  | "merchandise"
                  | "transport";
                servers: number;
                serviceRatePerServerMinute: number;
                priorityLaneCount: number;
              };
              staffPost?: {
                coverageZoneObjectIds: string[];
                /**
                 * @minItems 1
                 */
                assignments: [
                  {
                    shiftId: string;
                    roleId: string;
                    count: number;
                  },
                  ...{
                    shiftId: string;
                    roleId: string;
                    count: number;
                  }[]
                ];
              };
              utility?: {
                type: "power";
                circuitId: string;
                rating?: string;
                voltage: number;
                maxWatts: number;
                powerKw?: number;
              };
              rigging?: {
                safeWorkingLoadKg: number;
              };
              productionZone?: {
                access: "crew-only" | "performer-only" | "mixed";
              };
              resourceBinding?: {
                schemaVersion: 1;
                resourceId: string;
                kind: "inventory" | "av" | "power" | "catering" | "staffing";
                quantity: number;
              };
              production?: {
                equipmentType:
                  | "screen"
                  | "projector"
                  | "speaker"
                  | "camera"
                  | "control-desk"
                  | "cable-route"
                  | "power-distribution"
                  | "rigged-equipment";
                targetObjectId?: string;
                targetObjectIds?: string[];
                targetZoneObjectIds?: string[];
                sourceObjectId?: string;
                circuitId?: string;
                riggingPointId?: string;
                viewableWidthM?: number;
                viewableHeightM?: number;
                throwRatioMin?: number;
                throwRatioMax?: number;
                powerWatts?: number;
                weightKg?: number;
                requiresRigging?: boolean;
                aimPoint?: {
                  x: number;
                  y: number;
                };
                coverageRangeM?: number;
                coverageAngleDegrees?: number;
                minimumDistanceM?: number;
                maximumDistanceM?: number;
                cableType?: string;
                crossingTreatment?: "none" | "overhead" | "cable-ramp" | "floor-channel";
              };
              catering?: {
                type:
                  | "bar"
                  | "buffet"
                  | "service-counter"
                  | "kitchen"
                  | "prep"
                  | "waste"
                  | "water"
                  | "queue-zone"
                  | "replenishment-route";
                servers?: number;
                serviceRatePerServerMinute?: number;
                demandShare?: number;
                queueZoneObjectId?: string;
                queueBufferPersons?: number;
                accessibleServicePoint?: boolean;
                serviceHeightM?: number;
                dietaryOptions?: string[];
                allergenLabels?: string[];
                replenishmentSourceObjectId?: string;
                waterSourceObjectId?: string;
                sourceObjectId?: string;
                /**
                 * @minItems 1
                 */
                targetObjectIds?: [string, ...string[]];
                crossingControl?: string;
              };
              emergency?: {
                type: "assembly-point" | "emergency-access-lane" | "fire-equipment" | "first-aid" | "command-post";
                capacityPersons?: number;
                /**
                 * @minItems 1
                 */
                designatedExitObjectIds?: [string, ...string[]];
                responderOnly?: boolean;
                equipmentClass?: string;
                coverageRadiusM?: number;
                clearanceM?: number;
                accessible?: boolean;
                powerSourceCircuitId?: string;
                backupPowerMinutes?: number;
              };
              entrance?: {
                clearWidthM?: number;
                accessible?: boolean;
              };
              door?: {
                clearWidthM: number;
                swing: "inward" | "outward" | "sliding" | "revolving";
                accessible: boolean;
                clearance?: {
                  side: "left" | "right" | "both";
                  depthM: number;
                  latchSideM: number;
                };
              };
              exit?: {
                clearWidthM: number;
                emergency: boolean;
                capacityPersons: number;
              };
              route?: {
                direction: "one-way" | "bidirectional";
                accessible: boolean;
                purpose: string;
                staffOnly?: boolean;
              };
              restriction?: {
                access: "prohibited" | "staff-only" | "conditional";
                reasonCode: string;
                blocksPlacement: boolean;
              };
              ramp?: {
                riseM: number;
                runM: number;
                clearWidthM: number;
                landingLengthM: number;
                edgeProtectionHeightM: number;
                handrails: boolean;
              };
              locks?: VenueMindObjectLock[];
              locked?: boolean;
              occupancy?: {
                expected?: number;
                maximum?: number;
                minimumCapacity?: number;
                maximumCapacity?: number;
                zoneId?: string | null;
                excludesUsableArea?: boolean;
              };
              accessibility?: {
                accessible?: boolean;
                destination?: boolean;
                accessibleSeats?: number;
                companionSeats?: number;
                accessibleSeatSampleIds?: string[];
                clearanceExempt?: boolean;
              };
              sightline?: {
                focalPoints?: {
                  id: string;
                  point: {
                    x: number;
                    y: number;
                  };
                  elevationM: number;
                  priority?: "primary" | "secondary";
                }[];
                samples?: {
                  id: string;
                  point: {
                    x: number;
                    y: number;
                  };
                  eyeHeightM: number;
                }[];
                opacity?: number;
                heightM?: number;
              };
              templateRef?: {
                kind: "venue-template" | "room-template" | "inventory-item-template";
                templateId: string;
                templateObjectId?: string;
                version: string;
              };
              templateOverrides?: string[];
              inventoryCount?: number;
              groupId?: string | null;
              specification?: {
                dimensions?: {
                  [k: string]: number;
                };
                weightKg?: number;
                power?: {
                  watts: number;
                  connector: string;
                };
                capacity?: number;
                cost?: {
                  amount: number;
                  currency?: string;
                  basis?: string;
                };
              };
            },
            ...{
              id: string;
              kind: string;
              label?: string;
              layer?: "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations";
              elevationM?: number;
              footprint:
                | {
                    kind: "rectangle";
                    center: {
                      x: number;
                      y: number;
                    };
                    width: number;
                    depth: number;
                    rotationDegrees: number;
                  }
                | {
                    kind: "circle";
                    center: {
                      x: number;
                      y: number;
                    };
                    radius: number;
                  }
                | {
                    kind: "line";
                    start: {
                      x: number;
                      y: number;
                    };
                    end: {
                      x: number;
                      y: number;
                    };
                    width: number;
                  }
                | {
                    kind: "polygon";
                    /**
                     * @minItems 3
                     */
                    points: [
                      {
                        x: number;
                        y: number;
                      },
                      {
                        x: number;
                        y: number;
                      },
                      {
                        x: number;
                        y: number;
                      },
                      ...{
                        x: number;
                        y: number;
                      }[]
                    ];
                    rotationDegrees: number;
                  };
              capacity?: number;
              placement?: {
                collisionMode: "solid";
              };
              circulation?: {
                blocksPath?: boolean;
                blocksExitApproach?: boolean;
                role?: "queue" | "checkpoint";
                demandPersons?: number;
                capacityPersons?: number;
                capacityPersonsPerMinute?: number;
                clearWidthM?: number;
                carCapacityPersons?: number;
                cycleSeconds?: number;
                servesZoneIds?: string[];
              };
              queue?: {
                category:
                  | "registration"
                  | "security"
                  | "cloakroom"
                  | "food"
                  | "beverage"
                  | "restroom"
                  | "merchandise"
                  | "transport";
                servers: number;
                serviceRatePerServerMinute: number;
                priorityLaneCount: number;
              };
              staffPost?: {
                coverageZoneObjectIds: string[];
                /**
                 * @minItems 1
                 */
                assignments: [
                  {
                    shiftId: string;
                    roleId: string;
                    count: number;
                  },
                  ...{
                    shiftId: string;
                    roleId: string;
                    count: number;
                  }[]
                ];
              };
              utility?: {
                type: "power";
                circuitId: string;
                rating?: string;
                voltage: number;
                maxWatts: number;
                powerKw?: number;
              };
              rigging?: {
                safeWorkingLoadKg: number;
              };
              productionZone?: {
                access: "crew-only" | "performer-only" | "mixed";
              };
              resourceBinding?: {
                schemaVersion: 1;
                resourceId: string;
                kind: "inventory" | "av" | "power" | "catering" | "staffing";
                quantity: number;
              };
              production?: {
                equipmentType:
                  | "screen"
                  | "projector"
                  | "speaker"
                  | "camera"
                  | "control-desk"
                  | "cable-route"
                  | "power-distribution"
                  | "rigged-equipment";
                targetObjectId?: string;
                targetObjectIds?: string[];
                targetZoneObjectIds?: string[];
                sourceObjectId?: string;
                circuitId?: string;
                riggingPointId?: string;
                viewableWidthM?: number;
                viewableHeightM?: number;
                throwRatioMin?: number;
                throwRatioMax?: number;
                powerWatts?: number;
                weightKg?: number;
                requiresRigging?: boolean;
                aimPoint?: {
                  x: number;
                  y: number;
                };
                coverageRangeM?: number;
                coverageAngleDegrees?: number;
                minimumDistanceM?: number;
                maximumDistanceM?: number;
                cableType?: string;
                crossingTreatment?: "none" | "overhead" | "cable-ramp" | "floor-channel";
              };
              catering?: {
                type:
                  | "bar"
                  | "buffet"
                  | "service-counter"
                  | "kitchen"
                  | "prep"
                  | "waste"
                  | "water"
                  | "queue-zone"
                  | "replenishment-route";
                servers?: number;
                serviceRatePerServerMinute?: number;
                demandShare?: number;
                queueZoneObjectId?: string;
                queueBufferPersons?: number;
                accessibleServicePoint?: boolean;
                serviceHeightM?: number;
                dietaryOptions?: string[];
                allergenLabels?: string[];
                replenishmentSourceObjectId?: string;
                waterSourceObjectId?: string;
                sourceObjectId?: string;
                /**
                 * @minItems 1
                 */
                targetObjectIds?: [string, ...string[]];
                crossingControl?: string;
              };
              emergency?: {
                type: "assembly-point" | "emergency-access-lane" | "fire-equipment" | "first-aid" | "command-post";
                capacityPersons?: number;
                /**
                 * @minItems 1
                 */
                designatedExitObjectIds?: [string, ...string[]];
                responderOnly?: boolean;
                equipmentClass?: string;
                coverageRadiusM?: number;
                clearanceM?: number;
                accessible?: boolean;
                powerSourceCircuitId?: string;
                backupPowerMinutes?: number;
              };
              entrance?: {
                clearWidthM?: number;
                accessible?: boolean;
              };
              door?: {
                clearWidthM: number;
                swing: "inward" | "outward" | "sliding" | "revolving";
                accessible: boolean;
                clearance?: {
                  side: "left" | "right" | "both";
                  depthM: number;
                  latchSideM: number;
                };
              };
              exit?: {
                clearWidthM: number;
                emergency: boolean;
                capacityPersons: number;
              };
              route?: {
                direction: "one-way" | "bidirectional";
                accessible: boolean;
                purpose: string;
                staffOnly?: boolean;
              };
              restriction?: {
                access: "prohibited" | "staff-only" | "conditional";
                reasonCode: string;
                blocksPlacement: boolean;
              };
              ramp?: {
                riseM: number;
                runM: number;
                clearWidthM: number;
                landingLengthM: number;
                edgeProtectionHeightM: number;
                handrails: boolean;
              };
              locks?: VenueMindObjectLock[];
              locked?: boolean;
              occupancy?: {
                expected?: number;
                maximum?: number;
                minimumCapacity?: number;
                maximumCapacity?: number;
                zoneId?: string | null;
                excludesUsableArea?: boolean;
              };
              accessibility?: {
                accessible?: boolean;
                destination?: boolean;
                accessibleSeats?: number;
                companionSeats?: number;
                accessibleSeatSampleIds?: string[];
                clearanceExempt?: boolean;
              };
              sightline?: {
                focalPoints?: {
                  id: string;
                  point: {
                    x: number;
                    y: number;
                  };
                  elevationM: number;
                  priority?: "primary" | "secondary";
                }[];
                samples?: {
                  id: string;
                  point: {
                    x: number;
                    y: number;
                  };
                  eyeHeightM: number;
                }[];
                opacity?: number;
                heightM?: number;
              };
              templateRef?: {
                kind: "venue-template" | "room-template" | "inventory-item-template";
                templateId: string;
                templateObjectId?: string;
                version: string;
              };
              templateOverrides?: string[];
              inventoryCount?: number;
              groupId?: string | null;
              specification?: {
                dimensions?: {
                  [k: string]: number;
                };
                weightKg?: number;
                power?: {
                  watts: number;
                  connector: string;
                };
                capacity?: number;
                cost?: {
                  amount: number;
                  currency?: string;
                  basis?: string;
                };
              };
            }[]
          ];
        }
      | {
          operation: "move";
          label?: string;
          shortLabel?: string;
          metrics?: [string, string][];
          /**
           * @minItems 1
           */
          objectIds: [string, ...string[]];
          delta: {
            x: number;
            y: number;
          };
          snap?: {
            enabled?: boolean;
            sizeM?: number;
            toleranceM?: number;
          };
        }
      | {
          operation: "rotate";
          label?: string;
          shortLabel?: string;
          metrics?: [string, string][];
          /**
           * @minItems 1
           */
          objectIds: [string, ...string[]];
          rotationDegrees: number;
        }
      | {
          operation: "resize";
          label?: string;
          shortLabel?: string;
          metrics?: [string, string][];
          /**
           * @minItems 1
           */
          objectIds: [string, ...string[]];
          dimensions: {
            width?: number;
            depth?: number;
            radius?: number;
          };
        }
      | {
          operation: "delete";
          label?: string;
          shortLabel?: string;
          metrics?: [string, string][];
          /**
           * @minItems 1
           */
          objectIds: [string, ...string[]];
        }
      | {
          operation: "group";
          label?: string;
          shortLabel?: string;
          metrics?: [string, string][];
          /**
           * @minItems 1
           */
          objectIds: [string, ...string[]];
          groupId: string;
        }
      | {
          operation: "ungroup";
          label?: string;
          shortLabel?: string;
          metrics?: [string, string][];
          /**
           * @minItems 1
           */
          objectIds: [string, ...string[]];
        }
      | {
          operation: "edit-zone-vertices";
          label?: string;
          shortLabel?: string;
          metrics?: [string, string][];
          /**
           * @minItems 1
           * @maxItems 1
           */
          objectIds: [string];
          /**
           * @minItems 3
           */
          points: [
            {
              x: number;
              y: number;
            },
            {
              x: number;
              y: number;
            },
            {
              x: number;
              y: number;
            },
            ...{
              x: number;
              y: number;
            }[]
          ];
          snap?: {
            enabled?: boolean;
            sizeM?: number;
            toleranceM?: number;
          };
        }
      | {
          operation: "align";
          label?: string;
          shortLabel?: string;
          metrics?: [string, string][];
          /**
           * @minItems 2
           */
          objectIds: [string, string, ...string[]];
          axis: "x" | "y";
          edge?: "min" | "max" | "center";
          value?: number;
        }
      | {
          operation: "distribute";
          label?: string;
          shortLabel?: string;
          metrics?: [string, string][];
          /**
           * @minItems 2
           */
          objectIds: [string, string, ...string[]];
          axis: "x" | "y";
        }
      | {
          operation: "duplicate";
          label?: string;
          shortLabel?: string;
          metrics?: [string, string][];
          /**
           * @minItems 1
           */
          objectIds: [string, ...string[]];
          /**
           * @minItems 1
           */
          newObjectIds: [string, ...string[]];
          /**
           * @minItems 1
           */
          labels?: [string, ...string[]];
          offset?: {
            x: number;
            y: number;
          };
        }
      | {
          operation: "paste";
          label?: string;
          shortLabel?: string;
          metrics?: [string, string][];
          /**
           * @minItems 1
           */
          objects: [
            {
              id: string;
              kind: string;
              label?: string;
              layer?: "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations";
              elevationM?: number;
              footprint:
                | {
                    kind: "rectangle";
                    center: {
                      x: number;
                      y: number;
                    };
                    width: number;
                    depth: number;
                    rotationDegrees: number;
                  }
                | {
                    kind: "circle";
                    center: {
                      x: number;
                      y: number;
                    };
                    radius: number;
                  }
                | {
                    kind: "line";
                    start: {
                      x: number;
                      y: number;
                    };
                    end: {
                      x: number;
                      y: number;
                    };
                    width: number;
                  }
                | {
                    kind: "polygon";
                    /**
                     * @minItems 3
                     */
                    points: [
                      {
                        x: number;
                        y: number;
                      },
                      {
                        x: number;
                        y: number;
                      },
                      {
                        x: number;
                        y: number;
                      },
                      ...{
                        x: number;
                        y: number;
                      }[]
                    ];
                    rotationDegrees: number;
                  };
              capacity?: number;
              placement?: {
                collisionMode: "solid";
              };
              circulation?: {
                blocksPath?: boolean;
                blocksExitApproach?: boolean;
                role?: "queue" | "checkpoint";
                demandPersons?: number;
                capacityPersons?: number;
                capacityPersonsPerMinute?: number;
                clearWidthM?: number;
                carCapacityPersons?: number;
                cycleSeconds?: number;
                servesZoneIds?: string[];
              };
              queue?: {
                category:
                  | "registration"
                  | "security"
                  | "cloakroom"
                  | "food"
                  | "beverage"
                  | "restroom"
                  | "merchandise"
                  | "transport";
                servers: number;
                serviceRatePerServerMinute: number;
                priorityLaneCount: number;
              };
              staffPost?: {
                coverageZoneObjectIds: string[];
                /**
                 * @minItems 1
                 */
                assignments: [
                  {
                    shiftId: string;
                    roleId: string;
                    count: number;
                  },
                  ...{
                    shiftId: string;
                    roleId: string;
                    count: number;
                  }[]
                ];
              };
              utility?: {
                type: "power";
                circuitId: string;
                rating?: string;
                voltage: number;
                maxWatts: number;
                powerKw?: number;
              };
              rigging?: {
                safeWorkingLoadKg: number;
              };
              productionZone?: {
                access: "crew-only" | "performer-only" | "mixed";
              };
              resourceBinding?: {
                schemaVersion: 1;
                resourceId: string;
                kind: "inventory" | "av" | "power" | "catering" | "staffing";
                quantity: number;
              };
              production?: {
                equipmentType:
                  | "screen"
                  | "projector"
                  | "speaker"
                  | "camera"
                  | "control-desk"
                  | "cable-route"
                  | "power-distribution"
                  | "rigged-equipment";
                targetObjectId?: string;
                targetObjectIds?: string[];
                targetZoneObjectIds?: string[];
                sourceObjectId?: string;
                circuitId?: string;
                riggingPointId?: string;
                viewableWidthM?: number;
                viewableHeightM?: number;
                throwRatioMin?: number;
                throwRatioMax?: number;
                powerWatts?: number;
                weightKg?: number;
                requiresRigging?: boolean;
                aimPoint?: {
                  x: number;
                  y: number;
                };
                coverageRangeM?: number;
                coverageAngleDegrees?: number;
                minimumDistanceM?: number;
                maximumDistanceM?: number;
                cableType?: string;
                crossingTreatment?: "none" | "overhead" | "cable-ramp" | "floor-channel";
              };
              catering?: {
                type:
                  | "bar"
                  | "buffet"
                  | "service-counter"
                  | "kitchen"
                  | "prep"
                  | "waste"
                  | "water"
                  | "queue-zone"
                  | "replenishment-route";
                servers?: number;
                serviceRatePerServerMinute?: number;
                demandShare?: number;
                queueZoneObjectId?: string;
                queueBufferPersons?: number;
                accessibleServicePoint?: boolean;
                serviceHeightM?: number;
                dietaryOptions?: string[];
                allergenLabels?: string[];
                replenishmentSourceObjectId?: string;
                waterSourceObjectId?: string;
                sourceObjectId?: string;
                /**
                 * @minItems 1
                 */
                targetObjectIds?: [string, ...string[]];
                crossingControl?: string;
              };
              emergency?: {
                type: "assembly-point" | "emergency-access-lane" | "fire-equipment" | "first-aid" | "command-post";
                capacityPersons?: number;
                /**
                 * @minItems 1
                 */
                designatedExitObjectIds?: [string, ...string[]];
                responderOnly?: boolean;
                equipmentClass?: string;
                coverageRadiusM?: number;
                clearanceM?: number;
                accessible?: boolean;
                powerSourceCircuitId?: string;
                backupPowerMinutes?: number;
              };
              entrance?: {
                clearWidthM?: number;
                accessible?: boolean;
              };
              door?: {
                clearWidthM: number;
                swing: "inward" | "outward" | "sliding" | "revolving";
                accessible: boolean;
                clearance?: {
                  side: "left" | "right" | "both";
                  depthM: number;
                  latchSideM: number;
                };
              };
              exit?: {
                clearWidthM: number;
                emergency: boolean;
                capacityPersons: number;
              };
              route?: {
                direction: "one-way" | "bidirectional";
                accessible: boolean;
                purpose: string;
                staffOnly?: boolean;
              };
              restriction?: {
                access: "prohibited" | "staff-only" | "conditional";
                reasonCode: string;
                blocksPlacement: boolean;
              };
              ramp?: {
                riseM: number;
                runM: number;
                clearWidthM: number;
                landingLengthM: number;
                edgeProtectionHeightM: number;
                handrails: boolean;
              };
              locks?: VenueMindObjectLock[];
              locked?: boolean;
              occupancy?: {
                expected?: number;
                maximum?: number;
                minimumCapacity?: number;
                maximumCapacity?: number;
                zoneId?: string | null;
                excludesUsableArea?: boolean;
              };
              accessibility?: {
                accessible?: boolean;
                destination?: boolean;
                accessibleSeats?: number;
                companionSeats?: number;
                accessibleSeatSampleIds?: string[];
                clearanceExempt?: boolean;
              };
              sightline?: {
                focalPoints?: {
                  id: string;
                  point: {
                    x: number;
                    y: number;
                  };
                  elevationM: number;
                  priority?: "primary" | "secondary";
                }[];
                samples?: {
                  id: string;
                  point: {
                    x: number;
                    y: number;
                  };
                  eyeHeightM: number;
                }[];
                opacity?: number;
                heightM?: number;
              };
              templateRef?: {
                kind: "venue-template" | "room-template" | "inventory-item-template";
                templateId: string;
                templateObjectId?: string;
                version: string;
              };
              templateOverrides?: string[];
              inventoryCount?: number;
              groupId?: string | null;
              specification?: {
                dimensions?: {
                  [k: string]: number;
                };
                weightKg?: number;
                power?: {
                  watts: number;
                  connector: string;
                };
                capacity?: number;
                cost?: {
                  amount: number;
                  currency?: string;
                  basis?: string;
                };
              };
            },
            ...{
              id: string;
              kind: string;
              label?: string;
              layer?: "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations";
              elevationM?: number;
              footprint:
                | {
                    kind: "rectangle";
                    center: {
                      x: number;
                      y: number;
                    };
                    width: number;
                    depth: number;
                    rotationDegrees: number;
                  }
                | {
                    kind: "circle";
                    center: {
                      x: number;
                      y: number;
                    };
                    radius: number;
                  }
                | {
                    kind: "line";
                    start: {
                      x: number;
                      y: number;
                    };
                    end: {
                      x: number;
                      y: number;
                    };
                    width: number;
                  }
                | {
                    kind: "polygon";
                    /**
                     * @minItems 3
                     */
                    points: [
                      {
                        x: number;
                        y: number;
                      },
                      {
                        x: number;
                        y: number;
                      },
                      {
                        x: number;
                        y: number;
                      },
                      ...{
                        x: number;
                        y: number;
                      }[]
                    ];
                    rotationDegrees: number;
                  };
              capacity?: number;
              placement?: {
                collisionMode: "solid";
              };
              circulation?: {
                blocksPath?: boolean;
                blocksExitApproach?: boolean;
                role?: "queue" | "checkpoint";
                demandPersons?: number;
                capacityPersons?: number;
                capacityPersonsPerMinute?: number;
                clearWidthM?: number;
                carCapacityPersons?: number;
                cycleSeconds?: number;
                servesZoneIds?: string[];
              };
              queue?: {
                category:
                  | "registration"
                  | "security"
                  | "cloakroom"
                  | "food"
                  | "beverage"
                  | "restroom"
                  | "merchandise"
                  | "transport";
                servers: number;
                serviceRatePerServerMinute: number;
                priorityLaneCount: number;
              };
              staffPost?: {
                coverageZoneObjectIds: string[];
                /**
                 * @minItems 1
                 */
                assignments: [
                  {
                    shiftId: string;
                    roleId: string;
                    count: number;
                  },
                  ...{
                    shiftId: string;
                    roleId: string;
                    count: number;
                  }[]
                ];
              };
              utility?: {
                type: "power";
                circuitId: string;
                rating?: string;
                voltage: number;
                maxWatts: number;
                powerKw?: number;
              };
              rigging?: {
                safeWorkingLoadKg: number;
              };
              productionZone?: {
                access: "crew-only" | "performer-only" | "mixed";
              };
              resourceBinding?: {
                schemaVersion: 1;
                resourceId: string;
                kind: "inventory" | "av" | "power" | "catering" | "staffing";
                quantity: number;
              };
              production?: {
                equipmentType:
                  | "screen"
                  | "projector"
                  | "speaker"
                  | "camera"
                  | "control-desk"
                  | "cable-route"
                  | "power-distribution"
                  | "rigged-equipment";
                targetObjectId?: string;
                targetObjectIds?: string[];
                targetZoneObjectIds?: string[];
                sourceObjectId?: string;
                circuitId?: string;
                riggingPointId?: string;
                viewableWidthM?: number;
                viewableHeightM?: number;
                throwRatioMin?: number;
                throwRatioMax?: number;
                powerWatts?: number;
                weightKg?: number;
                requiresRigging?: boolean;
                aimPoint?: {
                  x: number;
                  y: number;
                };
                coverageRangeM?: number;
                coverageAngleDegrees?: number;
                minimumDistanceM?: number;
                maximumDistanceM?: number;
                cableType?: string;
                crossingTreatment?: "none" | "overhead" | "cable-ramp" | "floor-channel";
              };
              catering?: {
                type:
                  | "bar"
                  | "buffet"
                  | "service-counter"
                  | "kitchen"
                  | "prep"
                  | "waste"
                  | "water"
                  | "queue-zone"
                  | "replenishment-route";
                servers?: number;
                serviceRatePerServerMinute?: number;
                demandShare?: number;
                queueZoneObjectId?: string;
                queueBufferPersons?: number;
                accessibleServicePoint?: boolean;
                serviceHeightM?: number;
                dietaryOptions?: string[];
                allergenLabels?: string[];
                replenishmentSourceObjectId?: string;
                waterSourceObjectId?: string;
                sourceObjectId?: string;
                /**
                 * @minItems 1
                 */
                targetObjectIds?: [string, ...string[]];
                crossingControl?: string;
              };
              emergency?: {
                type: "assembly-point" | "emergency-access-lane" | "fire-equipment" | "first-aid" | "command-post";
                capacityPersons?: number;
                /**
                 * @minItems 1
                 */
                designatedExitObjectIds?: [string, ...string[]];
                responderOnly?: boolean;
                equipmentClass?: string;
                coverageRadiusM?: number;
                clearanceM?: number;
                accessible?: boolean;
                powerSourceCircuitId?: string;
                backupPowerMinutes?: number;
              };
              entrance?: {
                clearWidthM?: number;
                accessible?: boolean;
              };
              door?: {
                clearWidthM: number;
                swing: "inward" | "outward" | "sliding" | "revolving";
                accessible: boolean;
                clearance?: {
                  side: "left" | "right" | "both";
                  depthM: number;
                  latchSideM: number;
                };
              };
              exit?: {
                clearWidthM: number;
                emergency: boolean;
                capacityPersons: number;
              };
              route?: {
                direction: "one-way" | "bidirectional";
                accessible: boolean;
                purpose: string;
                staffOnly?: boolean;
              };
              restriction?: {
                access: "prohibited" | "staff-only" | "conditional";
                reasonCode: string;
                blocksPlacement: boolean;
              };
              ramp?: {
                riseM: number;
                runM: number;
                clearWidthM: number;
                landingLengthM: number;
                edgeProtectionHeightM: number;
                handrails: boolean;
              };
              locks?: VenueMindObjectLock[];
              locked?: boolean;
              occupancy?: {
                expected?: number;
                maximum?: number;
                minimumCapacity?: number;
                maximumCapacity?: number;
                zoneId?: string | null;
                excludesUsableArea?: boolean;
              };
              accessibility?: {
                accessible?: boolean;
                destination?: boolean;
                accessibleSeats?: number;
                companionSeats?: number;
                accessibleSeatSampleIds?: string[];
                clearanceExempt?: boolean;
              };
              sightline?: {
                focalPoints?: {
                  id: string;
                  point: {
                    x: number;
                    y: number;
                  };
                  elevationM: number;
                  priority?: "primary" | "secondary";
                }[];
                samples?: {
                  id: string;
                  point: {
                    x: number;
                    y: number;
                  };
                  eyeHeightM: number;
                }[];
                opacity?: number;
                heightM?: number;
              };
              templateRef?: {
                kind: "venue-template" | "room-template" | "inventory-item-template";
                templateId: string;
                templateObjectId?: string;
                version: string;
              };
              templateOverrides?: string[];
              inventoryCount?: number;
              groupId?: string | null;
              specification?: {
                dimensions?: {
                  [k: string]: number;
                };
                weightKg?: number;
                power?: {
                  watts: number;
                  connector: string;
                };
                capacity?: number;
                cost?: {
                  amount: number;
                  currency?: string;
                  basis?: string;
                };
              };
            }[]
          ];
          /**
           * @minItems 1
           */
          newObjectIds: [string, ...string[]];
          /**
           * @minItems 1
           */
          labels?: [string, ...string[]];
          offset?: {
            x: number;
            y: number;
          };
        }
      | {
          operation: "place";
          label?: string;
          shortLabel?: string;
          metrics?: [string, string][];
          object: {
            id: string;
            kind: string;
            label?: string;
            layer?: "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations";
            elevationM?: number;
            footprint:
              | {
                  kind: "rectangle";
                  center: {
                    x: number;
                    y: number;
                  };
                  width: number;
                  depth: number;
                  rotationDegrees: number;
                }
              | {
                  kind: "circle";
                  center: {
                    x: number;
                    y: number;
                  };
                  radius: number;
                }
              | {
                  kind: "line";
                  start: {
                    x: number;
                    y: number;
                  };
                  end: {
                    x: number;
                    y: number;
                  };
                  width: number;
                }
              | {
                  kind: "polygon";
                  /**
                   * @minItems 3
                   */
                  points: [
                    {
                      x: number;
                      y: number;
                    },
                    {
                      x: number;
                      y: number;
                    },
                    {
                      x: number;
                      y: number;
                    },
                    ...{
                      x: number;
                      y: number;
                    }[]
                  ];
                  rotationDegrees: number;
                };
            capacity?: number;
            placement?: {
              collisionMode: "solid";
            };
            circulation?: {
              blocksPath?: boolean;
              blocksExitApproach?: boolean;
              role?: "queue" | "checkpoint";
              demandPersons?: number;
              capacityPersons?: number;
              capacityPersonsPerMinute?: number;
              clearWidthM?: number;
              carCapacityPersons?: number;
              cycleSeconds?: number;
              servesZoneIds?: string[];
            };
            queue?: {
              category:
                | "registration"
                | "security"
                | "cloakroom"
                | "food"
                | "beverage"
                | "restroom"
                | "merchandise"
                | "transport";
              servers: number;
              serviceRatePerServerMinute: number;
              priorityLaneCount: number;
            };
            staffPost?: {
              coverageZoneObjectIds: string[];
              /**
               * @minItems 1
               */
              assignments: [
                {
                  shiftId: string;
                  roleId: string;
                  count: number;
                },
                ...{
                  shiftId: string;
                  roleId: string;
                  count: number;
                }[]
              ];
            };
            utility?: {
              type: "power";
              circuitId: string;
              rating?: string;
              voltage: number;
              maxWatts: number;
              powerKw?: number;
            };
            rigging?: {
              safeWorkingLoadKg: number;
            };
            productionZone?: {
              access: "crew-only" | "performer-only" | "mixed";
            };
            resourceBinding?: {
              schemaVersion: 1;
              resourceId: string;
              kind: "inventory" | "av" | "power" | "catering" | "staffing";
              quantity: number;
            };
            production?: {
              equipmentType:
                | "screen"
                | "projector"
                | "speaker"
                | "camera"
                | "control-desk"
                | "cable-route"
                | "power-distribution"
                | "rigged-equipment";
              targetObjectId?: string;
              targetObjectIds?: string[];
              targetZoneObjectIds?: string[];
              sourceObjectId?: string;
              circuitId?: string;
              riggingPointId?: string;
              viewableWidthM?: number;
              viewableHeightM?: number;
              throwRatioMin?: number;
              throwRatioMax?: number;
              powerWatts?: number;
              weightKg?: number;
              requiresRigging?: boolean;
              aimPoint?: {
                x: number;
                y: number;
              };
              coverageRangeM?: number;
              coverageAngleDegrees?: number;
              minimumDistanceM?: number;
              maximumDistanceM?: number;
              cableType?: string;
              crossingTreatment?: "none" | "overhead" | "cable-ramp" | "floor-channel";
            };
            catering?: {
              type:
                | "bar"
                | "buffet"
                | "service-counter"
                | "kitchen"
                | "prep"
                | "waste"
                | "water"
                | "queue-zone"
                | "replenishment-route";
              servers?: number;
              serviceRatePerServerMinute?: number;
              demandShare?: number;
              queueZoneObjectId?: string;
              queueBufferPersons?: number;
              accessibleServicePoint?: boolean;
              serviceHeightM?: number;
              dietaryOptions?: string[];
              allergenLabels?: string[];
              replenishmentSourceObjectId?: string;
              waterSourceObjectId?: string;
              sourceObjectId?: string;
              /**
               * @minItems 1
               */
              targetObjectIds?: [string, ...string[]];
              crossingControl?: string;
            };
            emergency?: {
              type: "assembly-point" | "emergency-access-lane" | "fire-equipment" | "first-aid" | "command-post";
              capacityPersons?: number;
              /**
               * @minItems 1
               */
              designatedExitObjectIds?: [string, ...string[]];
              responderOnly?: boolean;
              equipmentClass?: string;
              coverageRadiusM?: number;
              clearanceM?: number;
              accessible?: boolean;
              powerSourceCircuitId?: string;
              backupPowerMinutes?: number;
            };
            entrance?: {
              clearWidthM?: number;
              accessible?: boolean;
            };
            door?: {
              clearWidthM: number;
              swing: "inward" | "outward" | "sliding" | "revolving";
              accessible: boolean;
              clearance?: {
                side: "left" | "right" | "both";
                depthM: number;
                latchSideM: number;
              };
            };
            exit?: {
              clearWidthM: number;
              emergency: boolean;
              capacityPersons: number;
            };
            route?: {
              direction: "one-way" | "bidirectional";
              accessible: boolean;
              purpose: string;
              staffOnly?: boolean;
            };
            restriction?: {
              access: "prohibited" | "staff-only" | "conditional";
              reasonCode: string;
              blocksPlacement: boolean;
            };
            ramp?: {
              riseM: number;
              runM: number;
              clearWidthM: number;
              landingLengthM: number;
              edgeProtectionHeightM: number;
              handrails: boolean;
            };
            locks?: VenueMindObjectLock[];
            locked?: boolean;
            occupancy?: {
              expected?: number;
              maximum?: number;
              minimumCapacity?: number;
              maximumCapacity?: number;
              zoneId?: string | null;
              excludesUsableArea?: boolean;
            };
            accessibility?: {
              accessible?: boolean;
              destination?: boolean;
              accessibleSeats?: number;
              companionSeats?: number;
              accessibleSeatSampleIds?: string[];
              clearanceExempt?: boolean;
            };
            sightline?: {
              focalPoints?: {
                id: string;
                point: {
                  x: number;
                  y: number;
                };
                elevationM: number;
                priority?: "primary" | "secondary";
              }[];
              samples?: {
                id: string;
                point: {
                  x: number;
                  y: number;
                };
                eyeHeightM: number;
              }[];
              opacity?: number;
              heightM?: number;
            };
            templateRef?: {
              kind: "venue-template" | "room-template" | "inventory-item-template";
              templateId: string;
              templateObjectId?: string;
              version: string;
            };
            templateOverrides?: string[];
            inventoryCount?: number;
            groupId?: string | null;
            specification?: {
              dimensions?: {
                [k: string]: number;
              };
              weightKg?: number;
              power?: {
                watts: number;
                connector: string;
              };
              capacity?: number;
              cost?: {
                amount: number;
                currency?: string;
                basis?: string;
              };
            };
          };
        }
      | {
          operation: "create-zone";
          label?: string;
          shortLabel?: string;
          metrics?: [string, string][];
          object: {
            id: string;
            kind: string;
            label?: string;
            layer?: "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations";
            elevationM?: number;
            footprint:
              | {
                  kind: "rectangle";
                  center: {
                    x: number;
                    y: number;
                  };
                  width: number;
                  depth: number;
                  rotationDegrees: number;
                }
              | {
                  kind: "circle";
                  center: {
                    x: number;
                    y: number;
                  };
                  radius: number;
                }
              | {
                  kind: "line";
                  start: {
                    x: number;
                    y: number;
                  };
                  end: {
                    x: number;
                    y: number;
                  };
                  width: number;
                }
              | {
                  kind: "polygon";
                  /**
                   * @minItems 3
                   */
                  points: [
                    {
                      x: number;
                      y: number;
                    },
                    {
                      x: number;
                      y: number;
                    },
                    {
                      x: number;
                      y: number;
                    },
                    ...{
                      x: number;
                      y: number;
                    }[]
                  ];
                  rotationDegrees: number;
                };
            capacity?: number;
            placement?: {
              collisionMode: "solid";
            };
            circulation?: {
              blocksPath?: boolean;
              blocksExitApproach?: boolean;
              role?: "queue" | "checkpoint";
              demandPersons?: number;
              capacityPersons?: number;
              capacityPersonsPerMinute?: number;
              clearWidthM?: number;
              carCapacityPersons?: number;
              cycleSeconds?: number;
              servesZoneIds?: string[];
            };
            queue?: {
              category:
                | "registration"
                | "security"
                | "cloakroom"
                | "food"
                | "beverage"
                | "restroom"
                | "merchandise"
                | "transport";
              servers: number;
              serviceRatePerServerMinute: number;
              priorityLaneCount: number;
            };
            staffPost?: {
              coverageZoneObjectIds: string[];
              /**
               * @minItems 1
               */
              assignments: [
                {
                  shiftId: string;
                  roleId: string;
                  count: number;
                },
                ...{
                  shiftId: string;
                  roleId: string;
                  count: number;
                }[]
              ];
            };
            utility?: {
              type: "power";
              circuitId: string;
              rating?: string;
              voltage: number;
              maxWatts: number;
              powerKw?: number;
            };
            rigging?: {
              safeWorkingLoadKg: number;
            };
            productionZone?: {
              access: "crew-only" | "performer-only" | "mixed";
            };
            resourceBinding?: {
              schemaVersion: 1;
              resourceId: string;
              kind: "inventory" | "av" | "power" | "catering" | "staffing";
              quantity: number;
            };
            production?: {
              equipmentType:
                | "screen"
                | "projector"
                | "speaker"
                | "camera"
                | "control-desk"
                | "cable-route"
                | "power-distribution"
                | "rigged-equipment";
              targetObjectId?: string;
              targetObjectIds?: string[];
              targetZoneObjectIds?: string[];
              sourceObjectId?: string;
              circuitId?: string;
              riggingPointId?: string;
              viewableWidthM?: number;
              viewableHeightM?: number;
              throwRatioMin?: number;
              throwRatioMax?: number;
              powerWatts?: number;
              weightKg?: number;
              requiresRigging?: boolean;
              aimPoint?: {
                x: number;
                y: number;
              };
              coverageRangeM?: number;
              coverageAngleDegrees?: number;
              minimumDistanceM?: number;
              maximumDistanceM?: number;
              cableType?: string;
              crossingTreatment?: "none" | "overhead" | "cable-ramp" | "floor-channel";
            };
            catering?: {
              type:
                | "bar"
                | "buffet"
                | "service-counter"
                | "kitchen"
                | "prep"
                | "waste"
                | "water"
                | "queue-zone"
                | "replenishment-route";
              servers?: number;
              serviceRatePerServerMinute?: number;
              demandShare?: number;
              queueZoneObjectId?: string;
              queueBufferPersons?: number;
              accessibleServicePoint?: boolean;
              serviceHeightM?: number;
              dietaryOptions?: string[];
              allergenLabels?: string[];
              replenishmentSourceObjectId?: string;
              waterSourceObjectId?: string;
              sourceObjectId?: string;
              /**
               * @minItems 1
               */
              targetObjectIds?: [string, ...string[]];
              crossingControl?: string;
            };
            emergency?: {
              type: "assembly-point" | "emergency-access-lane" | "fire-equipment" | "first-aid" | "command-post";
              capacityPersons?: number;
              /**
               * @minItems 1
               */
              designatedExitObjectIds?: [string, ...string[]];
              responderOnly?: boolean;
              equipmentClass?: string;
              coverageRadiusM?: number;
              clearanceM?: number;
              accessible?: boolean;
              powerSourceCircuitId?: string;
              backupPowerMinutes?: number;
            };
            entrance?: {
              clearWidthM?: number;
              accessible?: boolean;
            };
            door?: {
              clearWidthM: number;
              swing: "inward" | "outward" | "sliding" | "revolving";
              accessible: boolean;
              clearance?: {
                side: "left" | "right" | "both";
                depthM: number;
                latchSideM: number;
              };
            };
            exit?: {
              clearWidthM: number;
              emergency: boolean;
              capacityPersons: number;
            };
            route?: {
              direction: "one-way" | "bidirectional";
              accessible: boolean;
              purpose: string;
              staffOnly?: boolean;
            };
            restriction?: {
              access: "prohibited" | "staff-only" | "conditional";
              reasonCode: string;
              blocksPlacement: boolean;
            };
            ramp?: {
              riseM: number;
              runM: number;
              clearWidthM: number;
              landingLengthM: number;
              edgeProtectionHeightM: number;
              handrails: boolean;
            };
            locks?: VenueMindObjectLock[];
            locked?: boolean;
            occupancy?: {
              expected?: number;
              maximum?: number;
              minimumCapacity?: number;
              maximumCapacity?: number;
              zoneId?: string | null;
              excludesUsableArea?: boolean;
            };
            accessibility?: {
              accessible?: boolean;
              destination?: boolean;
              accessibleSeats?: number;
              companionSeats?: number;
              accessibleSeatSampleIds?: string[];
              clearanceExempt?: boolean;
            };
            sightline?: {
              focalPoints?: {
                id: string;
                point: {
                  x: number;
                  y: number;
                };
                elevationM: number;
                priority?: "primary" | "secondary";
              }[];
              samples?: {
                id: string;
                point: {
                  x: number;
                  y: number;
                };
                eyeHeightM: number;
              }[];
              opacity?: number;
              heightM?: number;
            };
            templateRef?: {
              kind: "venue-template" | "room-template" | "inventory-item-template";
              templateId: string;
              templateObjectId?: string;
              version: string;
            };
            templateOverrides?: string[];
            inventoryCount?: number;
            groupId?: string | null;
            specification?: {
              dimensions?: {
                [k: string]: number;
              };
              weightKg?: number;
              power?: {
                watts: number;
                connector: string;
              };
              capacity?: number;
              cost?: {
                amount: number;
                currency?: string;
                basis?: string;
              };
            };
          };
        };
    /**
     * Unique retry key for this semantic command.
     */
    idempotencyKey: string;
    /**
     * Optional caller correlation identifier.
     */
    correlationId?: string;
  };
  "venue.measure_objects": {
    /**
     * @minItems 1
     */
    objectIds: [string, ...string[]];
  };
  "venue.validate_layout": {};
  "venue.get_validation_evidence": {
    validationId?: string;
    /**
     * @maxItems 50
     */
    constraintIds?: string[];
    includeSpatialEvidence?: boolean;
  };
  "venue.list_proposal_branches": {};
  "venue.compare_proposal_branches": {
    leftBranchId: string;
    rightBranchId: string;
  };
  "venue.create_proposal_branch": {
    name: string;
    strategy: "balanced" | "access-first" | "circulation-first" | "sightlines-first";
    goal?: string;
    /**
     * Unique retry key for this semantic command.
     */
    idempotencyKey: string;
    /**
     * Optional caller correlation identifier.
     */
    correlationId?: string;
  };
  "venue.switch_proposal_branch": {
    branchId: string;
    /**
     * Unique retry key for this semantic command.
     */
    idempotencyKey: string;
    /**
     * Optional caller correlation identifier.
     */
    correlationId?: string;
  };
  "venue.update_proposal_branch": {
    branchId: string;
    name?: string;
    notes?: string;
    /**
     * Unique retry key for this semantic command.
     */
    idempotencyKey: string;
    /**
     * Optional caller correlation identifier.
     */
    correlationId?: string;
  };
  "venue.duplicate_proposal_branch": {
    branchId: string;
    proposalId?: string;
    name?: string;
    /**
     * Unique retry key for this semantic command.
     */
    idempotencyKey: string;
    /**
     * Optional caller correlation identifier.
     */
    correlationId?: string;
  };
  "venue.archive_proposal_branch": {
    branchId: string;
    /**
     * Unique retry key for this semantic command.
     */
    idempotencyKey: string;
    /**
     * Optional caller correlation identifier.
     */
    correlationId?: string;
  };
  "venue.restore_proposal_branch": {
    branchId: string;
    /**
     * Unique retry key for this semantic command.
     */
    idempotencyKey: string;
    /**
     * Optional caller correlation identifier.
     */
    correlationId?: string;
  };
  "venue.detect_proposal_conflicts": {
    branchId?: string;
  };
  "venue.rebase_proposal": {
    branchId: string;
    /**
     * Unique retry key for this semantic command.
     */
    idempotencyKey: string;
    /**
     * Optional caller correlation identifier.
     */
    correlationId?: string;
  };
  "venue.request_adjustment": {
    instruction: string;
    /**
     * Unique retry key for this semantic command.
     */
    idempotencyKey: string;
    /**
     * Optional caller correlation identifier.
     */
    correlationId?: string;
  };
  "venue.list_comments": {
    status?: "open" | "resolved";
    authorId?: string;
    subjectKind?: "project" | "plan-version" | "proposal" | "change" | "constraint" | "coordinate";
    decisionRelevant?: boolean;
  };
  "venue.add_comment": {
    anchor: {
      kind: "project" | "plan-version" | "proposal" | "change" | "constraint" | "coordinate";
      projectId?: string;
      planVersion?: string;
      proposalId?: string;
      changeId?: string;
      constraintId?: string;
      point?: {
        x: number;
        y: number;
      };
    };
    body: string;
    mentions?: string[];
    decisionRelevant?: boolean;
    authorId: string;
    /**
     * Unique retry key for this semantic command.
     */
    idempotencyKey: string;
    /**
     * Optional caller correlation identifier.
     */
    correlationId?: string;
  };
  "venue.edit_comment": {
    commentId: string;
    body: string;
    mentions?: string[];
    decisionRelevant?: boolean;
    authorId: string;
    /**
     * Unique retry key for this semantic command.
     */
    idempotencyKey: string;
    /**
     * Optional caller correlation identifier.
     */
    correlationId?: string;
  };
  "venue.set_comment_status": {
    commentId: string;
    status: "open" | "resolved";
    authorId: string;
    /**
     * Unique retry key for this semantic command.
     */
    idempotencyKey: string;
    /**
     * Optional caller correlation identifier.
     */
    correlationId?: string;
  };
  "venue.get_change_log": {};
  "venue.replay_history": {};
  "venue.list_scenarios": {};
  "venue.list_scenario_runs": {};
  "venue.get_scenario_result": {
    runId: string;
    includeDensityFrames?: boolean;
  };
  "venue.run_scenario": {
    scenario: {
      model?: "operations" | "ingress-egress" | "queue";
      id: string;
      name?: string;
      seed: number;
      horizonSeconds: number;
      sampleCount?: number;
      /**
       * @minItems 1
       */
      phases?: [
        {
          id: string;
          label?: string;
          startSecond: number;
          endSecond: number;
          demandShare?: number;
        },
        ...{
          id: string;
          label?: string;
          startSecond: number;
          endSecond: number;
          demandShare?: number;
        }[]
      ];
      inputs: {
        population: number;
        arrivalRatePerMinute: number;
        serviceRatePerMinute: number;
        servers: number;
        mobilityFactor?: number;
      };
      ingressEgress?: {
        mode?: "normal" | "emergency";
        curves?: {
          /**
           * @minItems 2
           */
          arrival?: [
            {
              second: number;
              cumulativeShare: number;
            },
            {
              second: number;
              cumulativeShare: number;
            },
            ...{
              second: number;
              cumulativeShare: number;
            }[]
          ];
          /**
           * @minItems 2
           */
          departure?: [
            {
              second: number;
              cumulativeShare: number;
            },
            {
              second: number;
              cumulativeShare: number;
            },
            ...{
              second: number;
              cumulativeShare: number;
            }[]
          ];
        };
        /**
         * @minItems 1
         */
        mobilityProfiles?: [
          {
            id: string;
            label?: string;
            share: number;
            speedFactor?: number;
            accessibleRouteRequired?: boolean;
          },
          ...{
            id: string;
            label?: string;
            share: number;
            speedFactor?: number;
            accessibleRouteRequired?: boolean;
          }[]
        ];
        assumptions?: {
          normal?: {
            responseDelaySeconds?: number;
            flowFactor?: number;
            elevatorsAvailable?: boolean;
          };
          emergency?: {
            responseDelaySeconds?: number;
            flowFactor?: number;
            elevatorsAvailable?: boolean;
          };
        };
      };
      queue?: {
        category?:
          "registration" | "security" | "cloakroom" | "food" | "beverage" | "restroom" | "merchandise" | "transport";
        arrivalRatePerMinute?: number;
        serviceRatePerServerMinute?: number;
        servers?: number;
        abandonment?: {
          enabled?: boolean;
          meanPatienceSeconds?: number;
        };
        priorityLanes?: {
          id: string;
          label?: string;
          arrivalShare?: number;
          servers?: number;
          serviceRatePerServerMinute?: number;
        }[];
        queueObjectId?: string | null;
        bufferAreaM2?: number;
        personAreaM2?: number;
      };
    };
    branchId?: string;
    /**
     * Unique retry key for this semantic command.
     */
    idempotencyKey: string;
    /**
     * Optional caller correlation identifier.
     */
    correlationId?: string;
  };
  "venue.compare_simulations": {
    leftRunId: string;
    rightRunId: string;
  };
  "venue.export_simulation": {
    runId: string;
  };
  "venue.inspect_live_occupancy": {};
  "venue.ingest_occupancy_signal": {
    sourceId: string;
    sourceType: "registration" | "sensor" | "manual-counter";
    sourceVersion: string;
    kind: "check-in" | "zone-occupancy";
    observedAt: string;
    confidence: "low" | "medium" | "high";
    /**
     * @minItems 1
     * @maxItems 100
     */
    readings: [
      {
        scopeId: string;
        count: number;
      },
      ...{
        scopeId: string;
        count: number;
      }[]
    ];
    /**
     * Unique retry key for this semantic command.
     */
    idempotencyKey: string;
    /**
     * Optional caller correlation identifier.
     */
    correlationId?: string;
  };
  "venue.refresh_live_occupancy": {
    /**
     * Unique retry key for this semantic command.
     */
    idempotencyKey: string;
    /**
     * Optional caller correlation identifier.
     */
    correlationId?: string;
  };
  "venue.export_live_occupancy": {};
  "venue.inspect_incidents": {
    incidentId?: string;
    status?: "open" | "mitigating" | "resolved" | "closed";
    severity?: "low" | "medium" | "high" | "critical";
    category?:
      | "accessibility"
      | "crowd-capacity"
      | "medical"
      | "security"
      | "fire-life-safety"
      | "facilities"
      | "production-av"
      | "catering"
      | "staffing"
      | "transport"
      | "weather"
      | "other";
    limit?: number;
  };
  "venue.report_incident": {
    severity: "low" | "medium" | "high" | "critical";
    category:
      | "accessibility"
      | "crowd-capacity"
      | "medical"
      | "security"
      | "fire-life-safety"
      | "facilities"
      | "production-av"
      | "catering"
      | "staffing"
      | "transport"
      | "weather"
      | "other";
    summaryCode: string;
    location:
      | {
          kind: "plan-object";
          planObjectId: string;
        }
      | {
          kind: "coordinate";
          point: {
            x: number;
            y: number;
          };
        };
    /**
     * @maxItems 20
     */
    relatedRefs?:
      | []
      | [
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          }
        ]
      | [
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          }
        ]
      | [
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          }
        ]
      | [
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          }
        ]
      | [
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          }
        ]
      | [
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          }
        ]
      | [
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          }
        ]
      | [
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          }
        ]
      | [
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          }
        ]
      | [
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          }
        ]
      | [
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          }
        ]
      | [
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          }
        ]
      | [
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          }
        ]
      | [
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          }
        ]
      | [
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          }
        ]
      | [
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          }
        ]
      | [
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          }
        ]
      | [
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          }
        ]
      | [
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          }
        ]
      | [
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          },
          {
            kind: "occupancy-alert" | "runbook-task" | "plan-object";
            id: string;
          }
        ];
    /**
     * Unique retry key for this semantic command.
     */
    idempotencyKey: string;
    /**
     * Optional caller correlation identifier.
     */
    correlationId?: string;
  };
  "venue.export_incident_record": {
    incidentId: string;
  };
  "venue.inspect_live_plan_deviations": {
    deviationId?: string;
    status?: "active" | "ended";
    disposition?: "temporary" | "revision-candidate";
    limit?: number;
  };
  "venue.record_live_plan_deviation": {
    deviationId: string;
    disposition: "temporary" | "revision-candidate";
    reasonCode: string;
    location:
      | {
          kind: "plan-object";
          planObjectId: string;
        }
      | {
          kind: "coordinate";
          point: {
            x: number;
            y: number;
          };
        };
    /**
     * @minItems 1
     * @maxItems 100
     */
    affectedObjectIds: [string, ...string[]];
    /**
     * @minItems 1
     * @maxItems 100
     */
    availableConstraintIds: [string, ...string[]];
    change: {
      id: string;
      number?: number;
      title?: string;
      shortTitle?: string;
      label?: string;
      editor?: {
        [k: string]: unknown;
      };
      metrics?: [string, string][];
      /**
       * @minItems 1
       * @maxItems 100
       */
      targetObjectIds: [string, ...string[]];
      /**
       * @maxItems 100
       */
      targetRequirementIds?: string[];
      effects?: {
        [k: string]: unknown;
      };
      planningEffects?: {
        [k: string]: unknown;
      }[];
      /**
       * @minItems 1
       * @maxItems 100
       */
      spatialEffects: [
        {
          [k: string]: unknown;
        },
        ...{
          [k: string]: unknown;
        }[]
      ];
      semantic?: {
        [k: string]: unknown;
      };
      lineage?: {
        [k: string]: unknown;
      };
      templateUpdate?: {
        [k: string]: unknown;
      };
    };
    /**
     * Unique retry key for this semantic command.
     */
    idempotencyKey: string;
    /**
     * Optional caller correlation identifier.
     */
    correlationId?: string;
  };
  "venue.end_live_plan_deviation": {
    deviationId: string;
    expectedDeviationRevision: number;
    reasonCode: string;
    /**
     * Unique retry key for this semantic command.
     */
    idempotencyKey: string;
    /**
     * Optional caller correlation identifier.
     */
    correlationId?: string;
  };
  "venue.create_post_event_deviation_proposal": {
    proposalId: string;
    goal: string;
    /**
     * @minItems 1
     * @maxItems 100
     */
    deviationIds: [string, ...string[]];
    /**
     * Unique retry key for this semantic command.
     */
    idempotencyKey: string;
    /**
     * Optional caller correlation identifier.
     */
    correlationId?: string;
  };
  "venue.export_live_plan_deviations": {};
  "venue.export_audit_package": {};
  "venue.export_plan": {
    format?:
      | "json"
      | "text"
      | "svg"
      | "pdf"
      | "pdf-emergency"
      | "csv"
      | "csv-objects"
      | "csv-inventory"
      | "csv-staffing"
      | "svg-post-map"
      | "csv-production"
      | "svg-production"
      | "csv-catering-stations"
      | "csv-replenishment"
      | "audit";
  };
}
export interface VenueMindObjectLock {
  id: string;
  objectId: string;
  type: "position" | "rotation" | "dimension" | "deletion" | "role";
  source: "venue-template" | "project";
  reasonCode: string;
  authorId: string;
  createdAt?: string;
  expiresAt?: string | null;
  releasedAt?: string;
  releasedBy?: string;
  active: boolean;
}
