export async function audit(q, user, action, entity, entityId, details) {
  await q.query(
    'INSERT INTO audit_log (user_id, action, entity, entity_id, details) VALUES ($1, $2, $3, $4, $5::jsonb)',
    [user?.id ?? null, action, entity, entityId ? String(entityId) : null, details ? JSON.stringify(details) : null],
  );
}
