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

    const categories = [
      'Lab Supplies',
      'Medical Equipment',
      'Office Consumables',
      'Software Subscription',
      'Maintenance Service',
    ];

    const units = ['each', 'box', 'pack', 'unit', 'hour'];

    const items = Array.from({ length: 50 }, (_, index) => {
      const n = index + 1;
      const organizationId = organizationIds[index % organizationIds.length];
      const isService = n % 5 === 0;
      const basePrice = 20 + n * 3.5;
      const discountedPrice = n % 4 === 0 ? basePrice * 0.92 : null;
      const stock = isService ? 0 : 20 + (n % 12) * 7;

      return {
        id: `aaaa${String(n).padStart(4, '0')}-bbbb-4ccc-8ddd-${String(n).padStart(12, '0')}`,
        organization_id: organizationId,
        type: isService ? 'service' : 'product',
        sku: `DUMMY-ITEM-${String(n).padStart(4, '0')}`,
        name: isService ? `Service Package ${n}` : `Demo Product ${n}`,
        description: isService
          ? `Dummy service package ${n} for testing orders and invoices.`
          : `Dummy inventory product ${n} for testing stock and pricing flows.`,
        category: categories[index % categories.length],
        unit: isService ? 'hour' : units[index % units.length],
        price: basePrice.toFixed(2),
        discounted_price: discountedPrice ? discountedPrice.toFixed(2) : null,
        currency: 'USD',
        stock,
        reorder_level: isService ? 0 : 10 + (n % 6) * 3,
        tax_rate: isService ? '0.00' : '12.00',
        is_active: true,
        created_by: null,
        updated_by: null,
        created_at: now,
        updated_at: now,
      };
    });

    await queryInterface.bulkInsert('items', items);
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('items', {
      sku: {
        [queryInterface.sequelize.Sequelize.Op.like]: 'DUMMY-ITEM-%',
      },
    });
  },
};
