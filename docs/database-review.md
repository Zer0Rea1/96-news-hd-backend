# Review against the implementation

Reviewed DATABASE_ANALYSIS.md against schema 001–003 and API callers. Implementation is recorded in migrations 003–004; the deployment ledger tracks which migrations have been applied.

Implemented: separate annual card and 30-day membership dates, renewal receipts with version-checked owner decisions, automatic effective e-card revocation on unpaid membership, applicant-provided father name, owner-only paginated Auth account directory and protected login deletion. Deleting a login retains applications, payment reviews and printed profile UUIDs through ON DELETE SET NULL. Added role/review foreign-key indexes and CNIC checks on new application writes. Existing reporter CNICs are rejected before accepting an application/payment; the reporter unique constraint still resolves approval races safely. Review rows now retain the reviewed receipt path and quoted fee for each payment cycle.

Recommendations not adopted:

- One application per account is intentional in the current API. Rejection supports receipt resubmission; monthly renewal supports repeated payment reviews. Dropping UNIQUE(user_id) would break maybeSingle lookups and idempotent signup. Paid role changes now use a versioned request on the existing account, with a server-priced quote and owner payment review. The area is preserved.
- Expired is derived, not a manually stored reporter state. Adding a stored expired flag would become stale without a scheduler. Unpaid membership derives revoked while manual revocations remain authoritative.
- One-year card expiry and 30-day membership are different business rules explicitly requested by the owner.
- Submitted application details/fees/roles are historical snapshots. Catalog edits do not rewrite them. Explicit paid role-change approvals retain the previous details and request in the private review snapshot.
- Audit rows intentionally survive deleted reporters/posts. Cascades or mandatory target foreign keys would erase history or block supported deletion.
- Public news images and private payment receipts require different access policies. Combining their storage would not itself solve orphan cleanup.
- Legacy news IDs, categories and import snapshots preserve old links/import compatibility. Replacing identifiers or deleting compatibility fields has no demonstrated benefit here.
- Singleton tables separate ownership and payment configuration permissions; merging them would broaden access and complicate validation.

Further work: reporter editing currently has no optimistic version check, so concurrent admin edits can overwrite one another. Existing historical receipts without a review snapshot cannot be reconstructed automatically. Unified media cleanup needs a defined retention policy before migration. Paid role changes and audited admin renewal waivers are implemented in migration 004.
