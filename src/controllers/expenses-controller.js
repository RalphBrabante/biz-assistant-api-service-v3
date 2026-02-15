const { Op } = require('sequelize');
const { getModels } = require('../sequelize');
const { getOrganizationCurrency } = require('../services/organization-currency');

function getExpenseModels() {
  const models = getModels();
  if (!models || !models.Expense || !models.Vendor) {
    return null;
  }
  return {
    Expense: models.Expense,
    Vendor: models.Vendor,
  };
}

function pickExpensePayload(body = {}) {
  return {
    organizationId: body.organizationId,
    vendorId: body.vendorId,
    vendorTaxId: body.vendorTaxId,
    expenseNumber: body.expenseNumber,
    vatExemptAmount: body.vatExemptAmount,
    category: body.category,
    description: body.description,
    expenseDate: body.expenseDate,
    dueDate: body.dueDate,
    status: body.status,
    paymentMethod: body.paymentMethod,
    currency: body.currency,
    amount: body.amount,
    taxAmount: body.taxAmount,
    discountAmount: body.discountAmount,
    totalAmount: body.totalAmount,
    receiptUrl: body.receiptUrl,
    notes: body.notes,
    paidAt: body.paidAt,
    approvedBy: body.approvedBy,
    createdBy: body.createdBy,
    updatedBy: body.updatedBy,
  };
}

function cleanUndefined(payload) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined)
  );
}

async function createExpense(req, res) {
  try {
    const models = getExpenseModels();
    if (!models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const { Expense, Vendor } = models;
    const payload = cleanUndefined(pickExpensePayload(req.body));

    if (!payload.organizationId) {
      return res.status(400).json({ ok: false, message: 'organizationId is required.' });
    }
    if (!payload.vendorId) {
      return res.status(400).json({ ok: false, message: 'vendorId is required.' });
    }
    if (!payload.category) {
      return res.status(400).json({ ok: false, message: 'category is required.' });
    }
    if (!payload.expenseDate) {
      return res.status(400).json({ ok: false, message: 'expenseDate is required.' });
    }
    payload.currency = await getOrganizationCurrency(payload.organizationId);

    const vendor = await Vendor.findOne({
      where: {
        id: payload.vendorId,
        organizationId: payload.organizationId,
      },
    });
    if (!vendor) {
      return res.status(400).json({
        ok: false,
        message: 'Selected vendor is invalid for this organization.',
      });
    }
    if (!payload.vendorTaxId && vendor.taxId) {
      payload.vendorTaxId = vendor.taxId;
    }

    const expense = await Expense.create(payload);
    const created = await Expense.findByPk(expense.id, {
      include: [
        {
          association: 'vendor',
          attributes: ['id', 'name', 'taxId'],
          required: false,
        },
      ],
    });

    return res.status(201).json({ ok: true, data: created || expense });
  } catch (err) {
    console.error('Create expense error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to create expense.' });
  }
}

async function listExpenses(req, res) {
  try {
    const models = getExpenseModels();
    if (!models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const { Expense } = models;
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 100);
    const offset = (page - 1) * limit;

    const where = {};
    if (req.query.organizationId) where.organizationId = req.query.organizationId;
    if (req.query.vendorId) where.vendorId = req.query.vendorId;
    if (req.query.status) where.status = req.query.status;
    if (req.query.paymentMethod) where.paymentMethod = req.query.paymentMethod;
    if (req.query.vatExemptAmount) where.vatExemptAmount = req.query.vatExemptAmount;

    if (req.query.q) {
      where[Op.or] = [
        { expenseNumber: { [Op.like]: `%${req.query.q}%` } },
        { category: { [Op.like]: `%${req.query.q}%` } },
        { description: { [Op.like]: `%${req.query.q}%` } },
        { vendorTaxId: { [Op.like]: `%${req.query.q}%` } },
      ];
    }

    const { rows, count } = await Expense.findAndCountAll({
      where,
      include: [
        {
          association: 'vendor',
          attributes: ['id', 'name', 'taxId'],
          required: false,
        },
      ],
      limit,
      offset,
      order: [['createdAt', 'DESC']],
    });

    return res.status(200).json({
      ok: true,
      data: rows,
      meta: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit),
      },
    });
  } catch (err) {
    console.error('List expenses error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to fetch expenses.' });
  }
}

async function getExpenseById(req, res) {
  try {
    const models = getExpenseModels();
    if (!models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const { Expense } = models;
    const expense = await Expense.findByPk(req.params.id, {
      include: [
        {
          association: 'vendor',
          attributes: ['id', 'name', 'taxId'],
          required: false,
        },
      ],
    });
    if (!expense) {
      return res.status(404).json({ ok: false, message: 'Expense not found.' });
    }

    return res.status(200).json({ ok: true, data: expense });
  } catch (err) {
    console.error('Get expense error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to fetch expense.' });
  }
}

async function updateExpense(req, res) {
  try {
    const models = getExpenseModels();
    if (!models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const { Expense, Vendor } = models;
    const expense = await Expense.findByPk(req.params.id);
    if (!expense) {
      return res.status(404).json({ ok: false, message: 'Expense not found.' });
    }

    const payload = cleanUndefined(pickExpensePayload(req.body));
    if (Object.keys(payload).length === 0) {
      return res.status(400).json({ ok: false, message: 'No valid fields provided for update.' });
    }
    const effectiveOrganizationId = payload.organizationId || expense.organizationId;
    payload.currency = await getOrganizationCurrency(effectiveOrganizationId);

    if (payload.vendorId) {
      const organizationId = payload.organizationId || expense.organizationId;
      const vendor = await Vendor.findOne({
        where: {
          id: payload.vendorId,
          organizationId,
        },
      });
      if (!vendor) {
        return res.status(400).json({
          ok: false,
          message: 'Selected vendor is invalid for this organization.',
        });
      }
      if (!payload.vendorTaxId && vendor.taxId) {
        payload.vendorTaxId = vendor.taxId;
      }
    }

    await expense.update(payload);
    const updated = await Expense.findByPk(expense.id, {
      include: [
        {
          association: 'vendor',
          attributes: ['id', 'name', 'taxId'],
          required: false,
        },
      ],
    });

    return res.status(200).json({ ok: true, data: updated || expense });
  } catch (err) {
    console.error('Update expense error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to update expense.' });
  }
}

async function deleteExpense(req, res) {
  try {
    const models = getExpenseModels();
    if (!models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const { Expense } = models;
    const expense = await Expense.findByPk(req.params.id);
    if (!expense) {
      return res.status(404).json({ ok: false, message: 'Expense not found.' });
    }

    await expense.destroy();
    return res.status(200).json({ ok: true, message: 'Expense deleted successfully.' });
  } catch (err) {
    console.error('Delete expense error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to delete expense.' });
  }
}

module.exports = {
  createExpense,
  listExpenses,
  getExpenseById,
  updateExpense,
  deleteExpense,
};
