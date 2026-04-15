const { executeHasura } = require('../config/hasura');

async function createAuditLog({ actorUserId, actionName, entityType, entityId = null, beforeData = null, afterData = null, ipAddress = null, userAgent = null }) {
  const mutation = `
    mutation CreateAuditLog($object: audit_logs_insert_input!) {
      item: insert_audit_logs_one(object: $object) {
        id
      }
    }
  `;

  try {
    await executeHasura(mutation, {
      object: {
        actor_user_id: actorUserId,
        action_name: actionName,
        entity_type: entityType,
        entity_id: entityId,
        before_data: beforeData,
        after_data: afterData,
        ip_address: ipAddress,
        user_agent: userAgent,
      },
    });
  } catch (_error) {
    // Audit logging should not block the main request path.
  }
}

module.exports = { createAuditLog };
