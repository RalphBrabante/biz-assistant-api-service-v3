'use strict';

/** @type {import('sequelize-cli').Seeder} */
module.exports = {
  async up(queryInterface) {
    const now = new Date();

    const users = [
      {
        id: 'a1111111-1111-4111-8111-111111111111',
        organization_id: '11111111-1111-4111-8111-111111111111',
        first_name: 'Alice',
        last_name: 'Walker',
        email: 'alice.admin@test.local',
        // bcrypt hash for: Password123!
        password: '$2b$10$QY7qv0o7i6q9n4k4r7w9f.v9XkW5J1QnF0QY8gAa0NwC8d5z2D2dK',
        phone: '+1-415-555-1001',
        address_line1: '100 First St',
        address_line2: null,
        city: 'San Francisco',
        state: 'CA',
        postal_code: '94103',
        country: 'United States',
        role: 'admin',
        status: 'active',
        is_email_verified: true,
        email_verified_at: now,
        is_active: true,
        last_login_at: now,
        created_at: now,
        updated_at: now,
      },
      {
        id: 'b2222222-2222-4222-8222-222222222222',
        organization_id: '22222222-2222-4222-8222-222222222222',
        first_name: 'Ben',
        last_name: 'Carter',
        email: 'ben.manager@test.local',
        password: '$2b$10$QY7qv0o7i6q9n4k4r7w9f.v9XkW5J1QnF0QY8gAa0NwC8d5z2D2dK',
        phone: '+1-206-555-1002',
        address_line1: '200 Pine Ave',
        address_line2: null,
        city: 'Seattle',
        state: 'WA',
        postal_code: '98101',
        country: 'United States',
        role: 'manager',
        status: 'active',
        is_email_verified: true,
        email_verified_at: now,
        is_active: true,
        last_login_at: now,
        created_at: now,
        updated_at: now,
      },
      {
        id: 'c3333333-3333-4333-8333-333333333333',
        organization_id: '33333333-3333-4333-8333-333333333333',
        first_name: 'Chloe',
        last_name: 'Diaz',
        email: 'chloe.staff@test.local',
        password: '$2b$10$QY7qv0o7i6q9n4k4r7w9f.v9XkW5J1QnF0QY8gAa0NwC8d5z2D2dK',
        phone: '+1-512-555-1003',
        address_line1: '300 Lake Dr',
        address_line2: 'Unit 2A',
        city: 'Austin',
        state: 'TX',
        postal_code: '78701',
        country: 'United States',
        role: 'member',
        status: 'pending_verification',
        is_email_verified: false,
        email_verified_at: null,
        is_active: true,
        last_login_at: null,
        created_at: now,
        updated_at: now,
      },
      {
        id: 'd4444444-4444-4444-8444-444444444444',
        organization_id: '44444444-4444-4444-8444-444444444444',
        first_name: 'Dylan',
        last_name: 'Frost',
        email: 'dylan.support@test.local',
        password: '$2b$10$QY7qv0o7i6q9n4k4r7w9f.v9XkW5J1QnF0QY8gAa0NwC8d5z2D2dK',
        phone: '+1-303-555-1004',
        address_line1: '400 Ridge Rd',
        address_line2: null,
        city: 'Denver',
        state: 'CO',
        postal_code: '80202',
        country: 'United States',
        role: 'support',
        status: 'active',
        is_email_verified: true,
        email_verified_at: now,
        is_active: true,
        last_login_at: now,
        created_at: now,
        updated_at: now,
      },
      {
        id: 'e5555555-5555-4555-8555-555555555555',
        organization_id: '55555555-5555-4555-8555-555555555555',
        first_name: 'Emma',
        last_name: 'Grant',
        email: 'emma.viewer@test.local',
        password: '$2b$10$QY7qv0o7i6q9n4k4r7w9f.v9XkW5J1QnF0QY8gAa0NwC8d5z2D2dK',
        phone: '+1-617-555-1005',
        address_line1: '500 Beacon St',
        address_line2: 'Floor 3',
        city: 'Boston',
        state: 'MA',
        postal_code: '02110',
        country: 'United States',
        role: 'viewer',
        status: 'invited',
        is_email_verified: false,
        email_verified_at: null,
        is_active: true,
        last_login_at: null,
        created_at: now,
        updated_at: now,
      },
    ];

    await queryInterface.bulkInsert('users', users);

    await queryInterface.bulkInsert('organization_users', [
      {
        id: 'f1111111-1111-4111-8111-111111111111',
        organization_id: '11111111-1111-4111-8111-111111111111',
        user_id: 'a1111111-1111-4111-8111-111111111111',
        role: 'admin',
        is_active: true,
        created_at: now,
        updated_at: now,
      },
      {
        id: 'f2222222-2222-4222-8222-222222222222',
        organization_id: '22222222-2222-4222-8222-222222222222',
        user_id: 'b2222222-2222-4222-8222-222222222222',
        role: 'manager',
        is_active: true,
        created_at: now,
        updated_at: now,
      },
      {
        id: 'f3333333-3333-4333-8333-333333333333',
        organization_id: '33333333-3333-4333-8333-333333333333',
        user_id: 'c3333333-3333-4333-8333-333333333333',
        role: 'member',
        is_active: true,
        created_at: now,
        updated_at: now,
      },
      {
        id: 'f4444444-4444-4444-8444-444444444444',
        organization_id: '44444444-4444-4444-8444-444444444444',
        user_id: 'd4444444-4444-4444-8444-444444444444',
        role: 'support',
        is_active: true,
        created_at: now,
        updated_at: now,
      },
      {
        id: 'f5555555-5555-4555-8555-555555555555',
        organization_id: '55555555-5555-4555-8555-555555555555',
        user_id: 'e5555555-5555-4555-8555-555555555555',
        role: 'viewer',
        is_active: true,
        created_at: now,
        updated_at: now,
      },
    ]);

    await queryInterface.sequelize.query(`
      INSERT INTO roles (id, name, code, description, is_system, is_active, created_at, updated_at)
      VALUES
        (UUID(), 'admin', 'admin', 'Administrator role', true, true, NOW(), NOW()),
        (UUID(), 'manager', 'manager', 'Manager role', true, true, NOW(), NOW()),
        (UUID(), 'member', 'member', 'Member role', true, true, NOW(), NOW()),
        (UUID(), 'support', 'support', 'Support role', true, true, NOW(), NOW()),
        (UUID(), 'viewer', 'viewer', 'Viewer role', true, true, NOW(), NOW())
      ON DUPLICATE KEY UPDATE updated_at = VALUES(updated_at)
    `);

    await queryInterface.sequelize.query(`
      INSERT INTO user_roles (id, user_id, role_id, assigned_at, is_active, created_at, updated_at)
      SELECT UUID(), u.id, r.id, NOW(), true, NOW(), NOW()
      FROM users u
      INNER JOIN roles r ON r.name = u.role
      WHERE u.id IN (
        'a1111111-1111-4111-8111-111111111111',
        'b2222222-2222-4222-8222-222222222222',
        'c3333333-3333-4333-8333-333333333333',
        'd4444444-4444-4444-8444-444444444444',
        'e5555555-5555-4555-8555-555555555555'
      )
      ON DUPLICATE KEY UPDATE updated_at = VALUES(updated_at)
    `);
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('user_roles', {
      user_id: [
        'a1111111-1111-4111-8111-111111111111',
        'b2222222-2222-4222-8222-222222222222',
        'c3333333-3333-4333-8333-333333333333',
        'd4444444-4444-4444-8444-444444444444',
        'e5555555-5555-4555-8555-555555555555',
      ],
    });

    await queryInterface.bulkDelete('organization_users', {
      user_id: [
        'a1111111-1111-4111-8111-111111111111',
        'b2222222-2222-4222-8222-222222222222',
        'c3333333-3333-4333-8333-333333333333',
        'd4444444-4444-4444-8444-444444444444',
        'e5555555-5555-4555-8555-555555555555',
      ],
    });

    await queryInterface.bulkDelete('users', {
      id: [
        'a1111111-1111-4111-8111-111111111111',
        'b2222222-2222-4222-8222-222222222222',
        'c3333333-3333-4333-8333-333333333333',
        'd4444444-4444-4444-8444-444444444444',
        'e5555555-5555-4555-8555-555555555555',
      ],
    });
  },
};
