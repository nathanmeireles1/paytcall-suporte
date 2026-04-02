const { db } = require('../config/database');

/**
 * Registra uma ação no log de auditoria.
 * Falhas são silenciosas — nunca interrompem o fluxo principal.
 *
 * @param {object} user      - req.user (precisa de .email e .name)
 * @param {string} action    - ex: 'usuario.convidar', 'empresa.editar', 'permissoes.salvar'
 * @param {object} [opts]
 * @param {string} [opts.entityType]  - 'usuario', 'empresa', 'produto', 'permissao', 'configuracao', 'import'
 * @param {string} [opts.entityId]    - ID da entidade afetada
 * @param {string} [opts.entityName]  - Nome legível da entidade
 * @param {object} [opts.details]     - Dados extras (jsonb)
 */
async function logAudit(user, action, opts = {}) {
  try {
    await db.from('audit_logs').insert({
      user_email:  user?.email  || null,
      user_name:   user?.name   || user?.email || null,
      action,
      entity_type: opts.entityType  || null,
      entity_id:   opts.entityId    || null,
      entity_name: opts.entityName  || null,
      details:     opts.details     || null,
    });
  } catch (_) {
    // silencioso
  }
}

module.exports = { logAudit };
