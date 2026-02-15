'use strict';

/** @type {import('sequelize-cli').Seeder} */
module.exports = {
  async up(queryInterface) {
    const now = new Date();

    const organizationIds = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444',
      '55555555-5555-4555-8555-555555555555',
    ];

    const customers = Array.from({ length: 25 }, (_, index) => {
      const n = index + 1;
      const orgId = organizationIds[index % organizationIds.length];
      const block1 = String(499 + (index % 5)).padStart(3, '0');
      const block2 = String(223 + (index % 7)).padStart(3, '0');
      const block3 = String(441 + (index % 9)).padStart(3, '0');
      const block4 = String(n).padStart(5, '0');
      const taxId = `${block1}-${block2}-${block3}-${block4}`;

      return {
        id: `ccccc${String(n).padStart(3, '0')}-aaaa-4bbb-8ccc-${String(n).padStart(12, '0')}`,
        organization_id: orgId,
        customer_code: `CUST-SEED-${String(n).padStart(4, '0')}`,
        type: n % 4 === 0 ? 'individual' : 'business',
        name: n % 4 === 0 ? `Seed Customer ${n}` : `Seed Company ${n}`,
        legal_name: n % 4 === 0 ? null : `Seed Company ${n} LLC`,
        tax_id: taxId,
        contact_person: `Contact ${n}`,
        email: `seed.customer${n}@example.test`,
        phone: `+1-555-200-${String(n).padStart(4, '0')}`,
        mobile: `+1-555-900-${String(n).padStart(4, '0')}`,
        address_line1: `${100 + n} Seed St`,
        address_line2: n % 3 === 0 ? `Suite ${n}` : null,
        city: ['San Francisco', 'Seattle', 'Austin', 'Denver', 'Boston'][index % 5],
        state: ['CA', 'WA', 'TX', 'CO', 'MA'][index % 5],
        postal_code: String(94100 + n),
        country: 'United States',
        credit_limit: (5000 + n * 250).toFixed(2),
        payment_terms_days: 15 + (n % 4) * 15,
        status: 'active',
        notes: 'Seeded customer record',
        created_by: null,
        updated_by: null,
        is_active: true,
        created_at: now,
        updated_at: now,
      };
    });

    await queryInterface.bulkInsert('customers', customers);
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('customers', {
      customer_code: {
        [queryInterface.sequelize.Sequelize.Op.like]: 'CUST-SEED-%',
      },
    });
  },
};
