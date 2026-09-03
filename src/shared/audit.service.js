const { query } = require('../config/db');

async function createAuditLog({ actorUserId, actionName, entityType, entityId = null, beforeData = null, afterData = null, ipAddress = null, userAgent = null }) {
  try {
    await query(
      `INSERT INTO public.audit_logs
        (actor_user_id, action_name, entity_type, entity_id, before_data, after_data, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        actorUserId,
        actionName,
        entityType,
        entityId,
        beforeData ? JSON.stringify(beforeData) : null,
        afterData ? JSON.stringify(afterData) : null,
        ipAddress,
        userAgent,
      ]
    );
  } catch (_error) {
    // Audit logging should not block the main request path.
  }
}

module.exports = { createAuditLog };
