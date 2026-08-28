# Template versions are pinned

Projects and Project Object Instances pin exact Venue, Room, and Inventory Item Template versions while keeping their own stable IDs. A newer Room Template never mutates an accepted Plan: safe non-overridden differences become a Template Update Proposal, Project Overrides remain authoritative, and the existing human Approval boundary commits the result. This trades live synchronization for reproducibility, auditability, and protection from unreviewed venue changes.
