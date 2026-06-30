/* eslint-disable */
// Fixture migration used by the "two components migrating the same database" test.
exports.shorthands = undefined

exports.up = (pgm) => {
  pgm.createTable('pg_component_migration_lock_test', {
    id: { type: 'serial', primaryKey: true }
  })
}

exports.down = (pgm) => {
  pgm.dropTable('pg_component_migration_lock_test')
}
