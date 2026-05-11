/**
 * Canonical identity and invalidation policy for Phase 0 contracts.
 *
 * Durable identity guarantees:
 * - document, feature, sketch, body, face, edge, vertex, sketch entity,
 *   constraint, dimension, and region identifiers are durable within backend
 *   guarantees
 * - non-topology-changing edits preserve unaffected identifiers
 * - topology-changing edits preserve unaffected identifiers whenever the
 *   backend can guarantee it
 * - destroyed or replaced references are reported explicitly as invalidated
 *
 * Invalidity rules:
 * - no silent remapping to a nearby surviving primitive
 * - no fallback from one face, edge, vertex, sketch entity, or region to another
 * - invalid references must return machine-readable invalidation reasons
 *
 * Ownership rules:
 * - every durable reference must resolve to owner document and revision
 * - if applicable, every durable reference must also resolve to owning feature,
 *   sketch, and body
 */
export const IDENTITY_POLICY_VERSION = "identity-policy/v1alpha1" as const;
