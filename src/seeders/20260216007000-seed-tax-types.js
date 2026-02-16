'use strict';

/** @type {import('sequelize-cli').Seeder} */
module.exports = {
  async up(queryInterface) {
    const now = new Date();
    const rows = [
      {
        id: 'aa111111-1111-4111-8111-111111111111',
        code: 'VAT',
        name: 'Value Added Tax',
        description: 'Standard Value Added Tax',
        percentage: 12.0,
        is_active: true,
        created_at: now,
        updated_at: now,
      },
      {
        id: 'bb222222-2222-4222-8222-222222222222',
        code: 'PT',
        name: 'Percentage Tax',
        description: 'Percentage Tax',
        percentage: 3.0,
        is_active: true,
        created_at: now,
        updated_at: now,
      },
    ];

    await queryInterface.bulkInsert('tax_types', rows);
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('tax_types', {
      code: ['VAT', 'PT'],
    });
  },
};
