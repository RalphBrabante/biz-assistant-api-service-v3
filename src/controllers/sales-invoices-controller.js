const { Op } = require('sequelize');
const { parse } = require('csv-parse/sync');
const { getModels } = require('../sequelize');
const { getOrganizationCurrency } = require('../services/organization-currency');
const {
  isPrivilegedRequest,
  getAuthenticatedOrganizationId,
  applyOrganizationWhereScope,
} = require('../services/request-scope');

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

function toNullableNumber(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function csvValue(value) {
  if (value === null || value === undefined) {
    return '';
  }
  const str = String(value);
  if (str.includes('"') || str.includes(',') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function resolveImportOrganizationId(req) {
  if (!isPrivilegedRequest(req)) {
    return getAuthenticatedOrganizationId(req);
  }
  return req.body?.organizationId || req.query?.organizationId || getAuthenticatedOrganizationId(req);
}

async function importSalesInvoices(req, res) {
  try {
    const models = getModels();
    if (!models || !models.SalesInvoice) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }
    const { SalesInvoice } = models;
    const Order = models.Order || null;

    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ ok: false, message: 'CSV file is required.' });
    }

    const records = parse(req.file.buffer.toString('utf-8'), {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ ok: false, message: 'CSV file has no rows to import.' });
    }

    const organizationId = resolveImportOrganizationId(req);

    if (!organizationId) {
      return res.status(400).json({ ok: false, message: 'organizationId is required.' });
    }

    const currency = await getOrganizationCurrency(organizationId);
    let imported = 0;
    let skipped = 0;
    const errors = [];

    for (let index = 0; index < records.length; index += 1) {
      const row = records[index];
      const rowNum = index + 2;
      const orderId = String(row.orderId || '').trim();
      const invoiceNumber = String(row.invoiceNumber || '').trim();
      const issueDate = String(row.issueDate || '').trim();

      if (!orderId || !invoiceNumber || !issueDate) {
        skipped += 1;
        errors.push(`Row ${rowNum}: orderId, invoiceNumber and issueDate are required.`);
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      const duplicate = await SalesInvoice.findOne({
        where: {
          organizationId,
          invoiceNumber,
        },
      });
      if (duplicate) {
        skipped += 1;
        errors.push(`Row ${rowNum}: invoiceNumber already exists.`);
        continue;
      }

      const payload = cleanUndefined({
        organizationId,
        orderId,
        invoiceNumber,
        issueDate,
        dueDate: String(row.dueDate || '').trim() || undefined,
        status: String(row.status || '').trim() || 'draft',
        paymentStatus: String(row.paymentStatus || '').trim() || 'unpaid',
        currency,
        subtotalAmount: toNullableNumber(row.subtotalAmount),
        taxAmount: toNullableNumber(row.taxAmount),
        discountAmount: toNullableNumber(row.discountAmount),
        totalAmount: toNullableNumber(row.totalAmount),
        paidAt: String(row.paidAt || '').trim() || undefined,
        notes: String(row.notes || '').trim() || undefined,
        createdBy: req.auth?.user?.id || null,
        updatedBy: req.auth?.user?.id || null,
      });

      try {
        if (Order) {
          // eslint-disable-next-line no-await-in-loop
          const order = await Order.findOne({
            where: {
              id: orderId,
              organizationId,
            },
          });
          if (!order) {
            skipped += 1;
            errors.push(`Row ${rowNum}: orderId does not exist for this organization.`);
            continue;
          }
        }

        // eslint-disable-next-line no-await-in-loop
        await SalesInvoice.create(payload);
        imported += 1;
      } catch (rowErr) {
        skipped += 1;
        errors.push(`Row ${rowNum}: ${rowErr.message || 'failed to import row.'}`);
      }
    }

    return res.status(200).json({
      ok: true,
      message: `Sales invoice import complete. Imported ${imported}, skipped ${skipped}.`,
      data: {
        imported,
        skipped,
        totalRows: records.length,
        errors,
      },
    });
  } catch (err) {
    console.error('Import sales invoices error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to import sales invoices.' });
  }
}

async function createSalesInvoice(req, res) {
  try {
    const SalesInvoice = getSalesInvoiceModel();
    if (!SalesInvoice) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const payload = cleanUndefined(pickSalesInvoicePayload(req.body));
    if (!isPrivilegedRequest(req)) {
      payload.organizationId = getAuthenticatedOrganizationId(req);
    }

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
    payload.currency = await getOrganizationCurrency(payload.organizationId);

    const salesInvoice = await SalesInvoice.create(payload);
    return res.status(201).json({ ok: true, data: salesInvoice });
  } catch (err) {
    console.error('Create sales invoice error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to create sales invoice.' });
  }
}

async function listSalesInvoices(req, res) {
  try {
    const models = getModels();
    if (!models || !models.SalesInvoice || !models.Organization) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }
    const { SalesInvoice, Organization } = models;

    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 100);
    const offset = (page - 1) * limit;

    const where = {};
    if (req.query.organizationId) where.organizationId = req.query.organizationId;
    if (!isPrivilegedRequest(req)) {
      const scopedWhere = applyOrganizationWhereScope(where, req);
      if (!scopedWhere) {
        return res.status(400).json({ ok: false, message: 'organizationId is required for this user.' });
      }
    }
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
      include: [
        {
          model: Organization,
          as: 'organization',
          attributes: ['id', 'name', 'legalName'],
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
    console.error('List sales invoices error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to fetch sales invoices.' });
  }
}

async function exportSalesInvoices(req, res) {
  try {
    const SalesInvoice = getSalesInvoiceModel();
    if (!SalesInvoice) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const where = {};
    if (req.query.organizationId) where.organizationId = req.query.organizationId;
    if (!isPrivilegedRequest(req)) {
      const scopedWhere = applyOrganizationWhereScope(where, req);
      if (!scopedWhere) {
        return res.status(400).json({ ok: false, message: 'organizationId is required for this user.' });
      }
    }
    if (req.query.orderId) where.orderId = req.query.orderId;
    if (req.query.status) where.status = req.query.status;
    if (req.query.paymentStatus) where.paymentStatus = req.query.paymentStatus;

    if (req.query.q) {
      where[Op.or] = [
        { invoiceNumber: { [Op.like]: `%${req.query.q}%` } },
        { status: { [Op.like]: `%${req.query.q}%` } },
      ];
    }

    const rows = await SalesInvoice.findAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: 10000,
    });

    const headers = [
      'id',
      'organizationId',
      'orderId',
      'invoiceNumber',
      'issueDate',
      'dueDate',
      'status',
      'paymentStatus',
      'currency',
      'subtotalAmount',
      'taxAmount',
      'discountAmount',
      'totalAmount',
      'paidAt',
      'notes',
      'createdAt',
      'updatedAt',
    ];

    const lines = [headers.join(',')];
    for (const row of rows) {
      const json = row.toJSON();
      lines.push(
        [
          csvValue(json.id),
          csvValue(json.organizationId),
          csvValue(json.orderId),
          csvValue(json.invoiceNumber),
          csvValue(json.issueDate),
          csvValue(json.dueDate),
          csvValue(json.status),
          csvValue(json.paymentStatus),
          csvValue(json.currency),
          csvValue(json.subtotalAmount),
          csvValue(json.taxAmount),
          csvValue(json.discountAmount),
          csvValue(json.totalAmount),
          csvValue(json.paidAt),
          csvValue(json.notes),
          csvValue(json.createdAt),
          csvValue(json.updatedAt),
        ].join(',')
      );
    }

    const csv = lines.join('\n');
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=\"sales-invoices-${date}.csv\"`);
    return res.status(200).send(csv);
  } catch (err) {
    console.error('Export sales invoices error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to export sales invoices.' });
  }
}

async function getSalesInvoiceById(req, res) {
  try {
    const models = getModels();
    if (!models || !models.SalesInvoice || !models.Order || !models.OrderItemSnapshot || !models.Customer) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }
    const { SalesInvoice, Order, OrderItemSnapshot, Customer } = models;

    const where = { id: req.params.id };
    if (!isPrivilegedRequest(req)) {
      const scopedWhere = applyOrganizationWhereScope(where, req);
      if (!scopedWhere) {
        return res.status(404).json({ ok: false, message: 'Sales invoice not found.' });
      }
    }

    const salesInvoice = await SalesInvoice.findOne({
      where,
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

    const where = { id: req.params.id };
    if (!isPrivilegedRequest(req)) {
      const scopedWhere = applyOrganizationWhereScope(where, req);
      if (!scopedWhere) {
        return res.status(404).json({ ok: false, message: 'Sales invoice not found.' });
      }
    }

    const salesInvoice = await SalesInvoice.findOne({ where });
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

    const where = { id: req.params.id };
    if (!isPrivilegedRequest(req)) {
      const scopedWhere = applyOrganizationWhereScope(where, req);
      if (!scopedWhere) {
        return res.status(404).json({ ok: false, message: 'Sales invoice not found.' });
      }
    }

    const salesInvoice = await SalesInvoice.findOne({ where });
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
  importSalesInvoices,
  exportSalesInvoices,
  listSalesInvoices,
  getSalesInvoiceById,
  updateSalesInvoice,
  deleteSalesInvoice,
};
