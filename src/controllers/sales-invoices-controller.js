const { Op } = require('sequelize');
const { getModels } = require('../sequelize');

function getSalesInvoiceModel() {
  const models = getModels();
  if (!models || !models.SalesInvoice) {
    return null;
  }
  return models.SalesInvoice;
}

function pickSalesInvoicePayload(body = {}) {
  return {
    organizationId: body.organizationId,
    orderId: body.orderId,
    invoiceNumber: body.invoiceNumber,
    issueDate: body.issueDate,
    dueDate: body.dueDate,
    status: body.status,
    paymentStatus: body.paymentStatus,
    currency: body.currency,
    subtotalAmount: body.subtotalAmount,
    taxAmount: body.taxAmount,
    discountAmount: body.discountAmount,
    totalAmount: body.totalAmount,
    paidAt: body.paidAt,
    notes: body.notes,
    createdBy: body.createdBy,
    updatedBy: body.updatedBy,
  };
}

function cleanUndefined(payload) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined)
  );
}

async function createSalesInvoice(req, res) {
  try {
    const SalesInvoice = getSalesInvoiceModel();
    if (!SalesInvoice) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const payload = cleanUndefined(pickSalesInvoicePayload(req.body));

    if (!payload.organizationId) {
      return res.status(400).json({ ok: false, message: 'organizationId is required.' });
    }
    if (!payload.orderId) {
      return res.status(400).json({ ok: false, message: 'orderId is required.' });
    }
    if (!payload.invoiceNumber) {
      return res.status(400).json({ ok: false, message: 'invoiceNumber is required.' });
    }
    if (!payload.issueDate) {
      return res.status(400).json({ ok: false, message: 'issueDate is required.' });
    }

    const salesInvoice = await SalesInvoice.create(payload);
    return res.status(201).json({ ok: true, data: salesInvoice });
  } catch (err) {
    console.error('Create sales invoice error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to create sales invoice.' });
  }
}

async function listSalesInvoices(req, res) {
  try {
    const SalesInvoice = getSalesInvoiceModel();
    if (!SalesInvoice) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 100);
    const offset = (page - 1) * limit;

    const where = {};
    if (req.query.organizationId) where.organizationId = req.query.organizationId;
    if (req.query.orderId) where.orderId = req.query.orderId;
    if (req.query.status) where.status = req.query.status;
    if (req.query.paymentStatus) where.paymentStatus = req.query.paymentStatus;

    if (req.query.q) {
      where[Op.or] = [
        { invoiceNumber: { [Op.like]: `%${req.query.q}%` } },
        { status: { [Op.like]: `%${req.query.q}%` } },
      ];
    }

    const { rows, count } = await SalesInvoice.findAndCountAll({
      where,
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
    console.error('List sales invoices error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to fetch sales invoices.' });
  }
}

async function getSalesInvoiceById(req, res) {
  try {
    const models = getModels();
    if (!models || !models.SalesInvoice || !models.Order || !models.OrderItemSnapshot || !models.Customer) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }
    const { SalesInvoice, Order, OrderItemSnapshot, Customer } = models;

    const salesInvoice = await SalesInvoice.findByPk(req.params.id, {
      include: [
        {
          model: Order,
          as: 'order',
          include: [
            {
              model: Customer,
              as: 'customer',
              attributes: ['id', 'name', 'taxId'],
            },
            {
              model: OrderItemSnapshot,
              as: 'orderedItemSnapshots',
            },
          ],
        },
      ],
    });
    if (!salesInvoice) {
      return res.status(404).json({ ok: false, message: 'Sales invoice not found.' });
    }

    return res.status(200).json({ ok: true, data: salesInvoice });
  } catch (err) {
    console.error('Get sales invoice error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to fetch sales invoice.' });
  }
}

async function updateSalesInvoice(req, res) {
  try {
    const SalesInvoice = getSalesInvoiceModel();
    if (!SalesInvoice) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const salesInvoice = await SalesInvoice.findByPk(req.params.id);
    if (!salesInvoice) {
      return res.status(404).json({ ok: false, message: 'Sales invoice not found.' });
    }
    if (String(salesInvoice.status || '').toLowerCase() === 'paid') {
      return res.status(400).json({
        ok: false,
        message: 'Paid invoices are locked and can no longer be edited.',
      });
    }

    const requestedStatus = String(req.body?.status || '').trim().toLowerCase();
    if (!requestedStatus) {
      return res.status(400).json({
        ok: false,
        message: 'Only status can be updated and status is required.',
      });
    }

    const normalizedStatus = requestedStatus === 'cancelled' ? 'void' : requestedStatus;
    const allowedStatus = new Set([
      'draft',
      'issued',
      'sent',
      'paid',
      'partially_paid',
      'overdue',
      'void',
    ]);
    if (!allowedStatus.has(normalizedStatus)) {
      return res.status(400).json({
        ok: false,
        message: 'Invalid status value for sales invoice.',
      });
    }

    const payload = {
      status: normalizedStatus,
      updatedBy: req.auth?.user?.id || salesInvoice.updatedBy || null,
    };
    if (normalizedStatus === 'paid') {
      payload.paymentStatus = 'paid';
      payload.paidAt = salesInvoice.paidAt || new Date();
    }

    await salesInvoice.update(payload);
    return res.status(200).json({ ok: true, data: salesInvoice });
  } catch (err) {
    console.error('Update sales invoice error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to update sales invoice.' });
  }
}

async function deleteSalesInvoice(req, res) {
  try {
    const SalesInvoice = getSalesInvoiceModel();
    if (!SalesInvoice) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const salesInvoice = await SalesInvoice.findByPk(req.params.id);
    if (!salesInvoice) {
      return res.status(404).json({ ok: false, message: 'Sales invoice not found.' });
    }

    await salesInvoice.destroy();
    return res.status(200).json({ ok: true, message: 'Sales invoice deleted successfully.' });
  } catch (err) {
    console.error('Delete sales invoice error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to delete sales invoice.' });
  }
}

module.exports = {
  createSalesInvoice,
  listSalesInvoices,
  getSalesInvoiceById,
  updateSalesInvoice,
  deleteSalesInvoice,
};
