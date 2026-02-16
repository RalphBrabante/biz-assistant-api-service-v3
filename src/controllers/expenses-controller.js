const { Op } = require('sequelize');
const { parse } = require('csv-parse/sync');
const { getModels } = require('../sequelize');
const { getOrganizationCurrency } = require('../services/organization-currency');
const {
  isPrivilegedRequest,
  getAuthenticatedOrganizationId,
  applyOrganizationWhereScope,
} = require('../services/request-scope');

function getExpenseModels() {
  const models = getModels();
  if (
    !models
    || !models.Expense
    || !models.Vendor
    || !models.Organization
    || !models.TaxType
    || !models.WithholdingTaxType
  ) {
    return null;
  }
  return {
    Expense: models.Expense,
    Vendor: models.Vendor,
    Organization: models.Organization,
    TaxType: models.TaxType,
    WithholdingTaxType: models.WithholdingTaxType,
  };
}

function pickExpensePayload(body = {}) {
  return {
    organizationId: body.organizationId,
    vendorId: body.vendorId,
    vendorTaxId: body.vendorTaxId,
    expenseNumber: body.expenseNumber,
    vatExemptAmount: body.vatExemptAmount,
    taxableAmount: body.taxableAmount,
    withHoldingTaxAmount: body.withHoldingTaxAmount,
    withholdingTaxTypeId: body.withholdingTaxTypeId,
    category: body.category,
    description: body.description,
    expenseDate: body.expenseDate,
    dueDate: body.dueDate,
    status: body.status,
    paymentMethod: body.paymentMethod,
    currency: body.currency,
    amount: body.amount,
    taxAmount: body.taxAmount,
    taxTypeId: body.taxTypeId,
    discountAmount: body.discountAmount,
    totalAmount: body.totalAmount,
    receiptUrl: body.receiptUrl,
    file: body.file,
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

function roundCurrency(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.round((numeric + Number.EPSILON) * 100) / 100;
}

function computeExpenseAmounts({
  amount = 0,
  vatExemptAmount = 0,
  discountAmount = 0,
  vatPercentage = 0,
  withholdingPercentage = 0,
}) {
  const safeAmount = Math.max(roundCurrency(amount), 0);
  const safeVatExempt = Math.max(roundCurrency(vatExemptAmount), 0);
  const safeDiscount = Math.max(roundCurrency(discountAmount), 0);
  const safeVatPercentage = Math.max(Number(vatPercentage || 0), 0);
  const safeWithholdingPercentage = Math.max(Number(withholdingPercentage || 0), 0);

  // VAT is treated as tax-inclusive on the taxable portion:
  // taxableNet = taxableGross / (1 + vatRate), tax = taxableNet * vatRate
  const taxableGross = Math.max(safeAmount - safeVatExempt, 0);
  const vatRate = safeVatPercentage / 100;
  const taxableNet = vatRate > 0
    ? roundCurrency(taxableGross / (1 + vatRate))
    : roundCurrency(taxableGross);
  const taxAmount = vatRate > 0
    ? roundCurrency(taxableNet * vatRate)
    : 0;

  // Withholding is applied on taxable net amount.
  const withholdingTaxAmount = roundCurrency(taxableNet * (safeWithholdingPercentage / 100));

  // Total payable: original gross amount less discount and withholding.
  const totalAmount = Math.max(roundCurrency(safeAmount - safeDiscount - withholdingTaxAmount), 0);

  return {
    amount: safeAmount,
    vatExemptAmount: safeVatExempt,
    taxableAmount: taxableNet,
    discountAmount: safeDiscount,
    taxAmount,
    withHoldingTaxAmount: withholdingTaxAmount,
    totalAmount,
  };
}

async function importExpenses(req, res) {
  try {
    const models = getExpenseModels();
    if (!models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

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

    const { Expense, Vendor, Organization, WithholdingTaxType } = models;
    const organizationId = resolveImportOrganizationId(req);

    if (!organizationId) {
      return res.status(400).json({ ok: false, message: 'organizationId is required.' });
    }

    const organization = await Organization.findByPk(organizationId, {
      include: [
        {
          association: 'taxType',
          attributes: ['id', 'percentage', 'isActive'],
          required: false,
        },
      ],
    });
    if (!organization) {
      return res.status(404).json({ ok: false, message: 'Organization not found.' });
    }
    if (!organization.taxTypeId || !organization.taxType || organization.taxType.isActive === false) {
      return res.status(400).json({
        ok: false,
        message: 'Organization tax type is required and must be active before importing expenses.',
      });
    }

    const currency = await getOrganizationCurrency(organizationId);
    let imported = 0;
    let skipped = 0;
    const errors = [];

    for (let index = 0; index < records.length; index += 1) {
      const row = records[index];
      const rowNum = index + 2;
      const vendorId = String(row.vendorId || '').trim();
      const category = String(row.category || '').trim();
      const expenseDate = String(row.expenseDate || '').trim();

      if (!vendorId || !category || !expenseDate) {
        skipped += 1;
        errors.push(`Row ${rowNum}: vendorId, category and expenseDate are required.`);
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      const vendor = await Vendor.findOne({
        where: {
          id: vendorId,
          organizationId,
        },
      });

      if (!vendor) {
        skipped += 1;
        errors.push(`Row ${rowNum}: vendorId does not belong to the target organization.`);
        continue;
      }

      const rawWithholdingTaxTypeId = String(row.withholdingTaxTypeId || '').trim();
      const rawWithholdingTaxTypeCode = String(row.withholdingTaxTypeCode || '').trim();
      const payload = cleanUndefined({
        organizationId,
        vendorId,
        vendorTaxId: String(row.vendorTaxId || vendor.taxId || '').trim() || undefined,
        vatExemptAmount: toNullableNumber(row.vatExemptAmount) ?? 0,
        category,
        description: String(row.description || '').trim() || undefined,
        expenseDate,
        dueDate: String(row.dueDate || '').trim() || undefined,
        status: String(row.status || '').trim() || 'draft',
        paymentMethod: String(row.paymentMethod || '').trim() || 'bank_transfer',
        currency,
        amount: toNullableNumber(row.amount) ?? 0,
        taxTypeId: organization.taxTypeId,
        withholdingTaxTypeId: rawWithholdingTaxTypeId || undefined,
        discountAmount: toNullableNumber(row.discountAmount) ?? 0,
        notes: String(row.notes || '').trim() || undefined,
        createdBy: req.auth?.user?.id || null,
        updatedBy: req.auth?.user?.id || null,
      });

      let withholdingTaxPercentage = 0;
      if (payload.withholdingTaxTypeId || rawWithholdingTaxTypeCode) {
        // eslint-disable-next-line no-await-in-loop
        const withholdingTaxType = await WithholdingTaxType.findOne({
          where: {
            organizationId,
            ...(payload.withholdingTaxTypeId
              ? { id: payload.withholdingTaxTypeId }
              : { code: rawWithholdingTaxTypeCode.toUpperCase() }),
            isActive: true,
          },
        });
        if (!withholdingTaxType) {
          skipped += 1;
          errors.push(`Row ${rowNum}: withholdingTaxTypeId/withholdingTaxTypeCode is invalid.`);
          continue;
        }
        payload.withholdingTaxTypeId = withholdingTaxType.id;
        withholdingTaxPercentage = Number(withholdingTaxType.percentage || 0);
      }

      Object.assign(
        payload,
        computeExpenseAmounts({
          amount: payload.amount,
          vatExemptAmount: payload.vatExemptAmount,
          discountAmount: payload.discountAmount,
          vatPercentage: Number(organization.taxType.percentage || 0),
          withholdingPercentage: withholdingTaxPercentage,
        })
      );

      // eslint-disable-next-line no-await-in-loop
      await Expense.create(payload);
      imported += 1;
    }

    return res.status(200).json({
      ok: true,
      message: `Expense import complete. Imported ${imported}, skipped ${skipped}.`,
      data: {
        imported,
        skipped,
        totalRows: records.length,
        errors,
      },
    });
  } catch (err) {
    console.error('Import expenses error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to import expenses.' });
  }
}

function resolveUploadedExpenseFile(req) {
  if (!req.file || !req.file.filename) {
    return null;
  }
  return `/uploads/expenses/${req.file.filename}`;
}

async function createExpense(req, res) {
  try {
    const models = getExpenseModels();
    if (!models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const { Expense, Vendor, Organization, WithholdingTaxType } = models;
    const payload = cleanUndefined(pickExpensePayload(req.body));
    const uploadedFile = resolveUploadedExpenseFile(req);
    if (uploadedFile) {
      payload.file = uploadedFile;
    }
    if (!isPrivilegedRequest(req)) {
      payload.organizationId = getAuthenticatedOrganizationId(req);
    }

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
    if (payload.amount === undefined || payload.amount === null || payload.amount === '') {
      return res.status(400).json({ ok: false, message: 'amount is required.' });
    }
    payload.amount = Number(payload.amount);
    if (!Number.isFinite(payload.amount) || payload.amount < 0) {
      return res.status(400).json({ ok: false, message: 'amount must be a non-negative number.' });
    }
    payload.currency = await getOrganizationCurrency(payload.organizationId);
    const organization = await Organization.findByPk(payload.organizationId, {
      include: [
        {
          association: 'taxType',
          attributes: ['id', 'percentage', 'isActive'],
          required: false,
        },
      ],
    });
    if (!organization || !organization.taxTypeId || !organization.taxType || organization.taxType.isActive === false) {
      return res.status(400).json({
        ok: false,
        message: 'Organization tax type is required and must be active before creating expenses.',
      });
    }
    payload.taxTypeId = organization.taxTypeId;

    let withholdingTaxPercentage = 0;
    if (payload.withholdingTaxTypeId) {
      const withholdingTaxType = await WithholdingTaxType.findOne({
        where: {
          id: payload.withholdingTaxTypeId,
          organizationId: payload.organizationId,
          isActive: true,
        },
      });
      if (!withholdingTaxType) {
        return res.status(400).json({ ok: false, message: 'withholdingTaxTypeId is invalid.' });
      }
      withholdingTaxPercentage = Number(withholdingTaxType.percentage || 0);
    }

    Object.assign(
      payload,
      computeExpenseAmounts({
        amount: payload.amount,
        vatExemptAmount: payload.vatExemptAmount,
        discountAmount: payload.discountAmount,
        vatPercentage: Number(organization.taxType.percentage || 0),
        withholdingPercentage: withholdingTaxPercentage,
      })
    );

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
        {
          association: 'taxType',
          attributes: ['id', 'code', 'name', 'percentage'],
          required: false,
        },
        {
          association: 'withholdingTaxType',
          attributes: ['id', 'code', 'name', 'percentage'],
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

    const { Expense, Organization } = models;
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
    if (req.query.vendorId) where.vendorId = req.query.vendorId;
    if (req.query.status) where.status = req.query.status;
    if (req.query.paymentMethod) where.paymentMethod = req.query.paymentMethod;
    if (req.query.vatExemptAmount) where.vatExemptAmount = req.query.vatExemptAmount;
    if (req.query.expenseDateFrom || req.query.expenseDateTo) {
      where.expenseDate = {};
      if (req.query.expenseDateFrom) {
        where.expenseDate[Op.gte] = req.query.expenseDateFrom;
      }
      if (req.query.expenseDateTo) {
        where.expenseDate[Op.lte] = req.query.expenseDateTo;
      }
    }

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
          model: Organization,
          as: 'organization',
          attributes: ['id', 'name', 'legalName'],
          required: false,
        },
        {
          association: 'vendor',
          attributes: ['id', 'name', 'taxId'],
          required: false,
        },
        {
          association: 'taxType',
          attributes: ['id', 'code', 'name', 'percentage'],
          required: false,
        },
        {
          association: 'withholdingTaxType',
          attributes: ['id', 'code', 'name', 'percentage'],
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

async function exportExpenses(req, res) {
  try {
    const models = getExpenseModels();
    if (!models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const { Expense } = models;
    const where = {};
    if (req.query.organizationId) where.organizationId = req.query.organizationId;
    if (!isPrivilegedRequest(req)) {
      const scopedWhere = applyOrganizationWhereScope(where, req);
      if (!scopedWhere) {
        return res.status(400).json({ ok: false, message: 'organizationId is required for this user.' });
      }
    }
    if (req.query.vendorId) where.vendorId = req.query.vendorId;
    if (req.query.status) where.status = req.query.status;
    if (req.query.paymentMethod) where.paymentMethod = req.query.paymentMethod;
    if (req.query.vatExemptAmount) where.vatExemptAmount = req.query.vatExemptAmount;
    if (req.query.expenseDateFrom || req.query.expenseDateTo) {
      where.expenseDate = {};
      if (req.query.expenseDateFrom) {
        where.expenseDate[Op.gte] = req.query.expenseDateFrom;
      }
      if (req.query.expenseDateTo) {
        where.expenseDate[Op.lte] = req.query.expenseDateTo;
      }
    }

    if (req.query.q) {
      where[Op.or] = [
        { expenseNumber: { [Op.like]: `%${req.query.q}%` } },
        { category: { [Op.like]: `%${req.query.q}%` } },
        { description: { [Op.like]: `%${req.query.q}%` } },
        { vendorTaxId: { [Op.like]: `%${req.query.q}%` } },
      ];
    }

    const rows = await Expense.findAll({
      where,
      include: [
        {
          association: 'vendor',
          attributes: ['id', 'name', 'taxId'],
          required: false,
        },
        {
          association: 'taxType',
          attributes: ['id', 'code', 'name', 'percentage'],
          required: false,
        },
        {
          association: 'withholdingTaxType',
          attributes: ['id', 'code', 'name', 'percentage'],
          required: false,
        },
      ],
      order: [['createdAt', 'DESC']],
      limit: 10000,
    });

    const headers = [
      'id',
      'organizationId',
      'vendorId',
      'vendorName',
      'vendorTaxId',
      'category',
      'description',
      'expenseDate',
      'dueDate',
      'status',
      'paymentMethod',
      'currency',
      'amount',
      'taxAmount',
      'taxTypeId',
      'taxTypeCode',
      'taxTypeName',
      'withholdingTaxTypeId',
      'withholdingTaxTypeCode',
      'withholdingTaxTypeName',
      'discountAmount',
      'vatExemptAmount',
      'taxableAmount',
      'withHoldingTaxAmount',
      'totalAmount',
      'notes',
      'file',
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
          csvValue(json.vendorId),
          csvValue(json.vendor?.name),
          csvValue(json.vendorTaxId),
          csvValue(json.category),
          csvValue(json.description),
          csvValue(json.expenseDate),
          csvValue(json.dueDate),
          csvValue(json.status),
          csvValue(json.paymentMethod),
          csvValue(json.currency),
          csvValue(json.amount),
          csvValue(json.taxAmount),
          csvValue(json.taxTypeId),
          csvValue(json.taxType?.code),
          csvValue(json.taxType?.name),
          csvValue(json.withholdingTaxTypeId),
          csvValue(json.withholdingTaxType?.code),
          csvValue(json.withholdingTaxType?.name),
          csvValue(json.discountAmount),
          csvValue(json.vatExemptAmount),
          csvValue(json.taxableAmount),
          csvValue(json.withHoldingTaxAmount),
          csvValue(json.totalAmount),
          csvValue(json.notes),
          csvValue(json.file),
          csvValue(json.createdAt),
          csvValue(json.updatedAt),
        ].join(',')
      );
    }

    const csv = lines.join('\n');
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=\"expenses-${date}.csv\"`);
    return res.status(200).send(csv);
  } catch (err) {
    console.error('Export expenses error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to export expenses.' });
  }
}

async function getExpenseById(req, res) {
  try {
    const models = getExpenseModels();
    if (!models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const { Expense } = models;
    const where = { id: req.params.id };
    if (!isPrivilegedRequest(req)) {
      const scopedWhere = applyOrganizationWhereScope(where, req);
      if (!scopedWhere) {
        return res.status(404).json({ ok: false, message: 'Expense not found.' });
      }
    }

    const expense = await Expense.findOne({
      where,
      include: [
        {
          association: 'vendor',
          attributes: ['id', 'name', 'taxId'],
          required: false,
        },
        {
          association: 'taxType',
          attributes: ['id', 'code', 'name', 'percentage'],
          required: false,
        },
        {
          association: 'withholdingTaxType',
          attributes: ['id', 'code', 'name', 'percentage'],
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

    const { Expense, Vendor, Organization, WithholdingTaxType } = models;
    const where = { id: req.params.id };
    if (!isPrivilegedRequest(req)) {
      const scopedWhere = applyOrganizationWhereScope(where, req);
      if (!scopedWhere) {
        return res.status(404).json({ ok: false, message: 'Expense not found.' });
      }
    }
    const expense = await Expense.findOne({ where });
    if (!expense) {
      return res.status(404).json({ ok: false, message: 'Expense not found.' });
    }

    const payload = cleanUndefined(pickExpensePayload(req.body));
    const uploadedFile = resolveUploadedExpenseFile(req);
    if (uploadedFile) {
      payload.file = uploadedFile;
    }
    if (Object.keys(payload).length === 0) {
      return res.status(400).json({ ok: false, message: 'No valid fields provided for update.' });
    }
    const effectiveOrganizationId = payload.organizationId || expense.organizationId;
    const effectiveAmount = payload.amount ?? expense.amount;
    if (effectiveAmount === undefined || effectiveAmount === null || effectiveAmount === '') {
      return res.status(400).json({ ok: false, message: 'amount is required.' });
    }
    if (!Number.isFinite(Number(effectiveAmount)) || Number(effectiveAmount) < 0) {
      return res.status(400).json({ ok: false, message: 'amount must be a non-negative number.' });
    }
    payload.currency = await getOrganizationCurrency(effectiveOrganizationId);
    const organization = await Organization.findByPk(effectiveOrganizationId, {
      include: [
        {
          association: 'taxType',
          attributes: ['id', 'percentage', 'isActive'],
          required: false,
        },
      ],
    });
    if (!organization || !organization.taxTypeId || !organization.taxType || organization.taxType.isActive === false) {
      return res.status(400).json({
        ok: false,
        message: 'Organization tax type is required and must be active before updating expenses.',
      });
    }
    payload.taxTypeId = organization.taxTypeId;

    let withholdingTaxPercentage = 0;
    if (payload.withholdingTaxTypeId) {
      const withholdingTaxType = await WithholdingTaxType.findOne({
        where: {
          id: payload.withholdingTaxTypeId,
          organizationId: effectiveOrganizationId,
          isActive: true,
        },
      });
      if (!withholdingTaxType) {
        return res.status(400).json({ ok: false, message: 'withholdingTaxTypeId is invalid.' });
      }
      withholdingTaxPercentage = Number(withholdingTaxType.percentage || 0);
    } else if (expense.withholdingTaxTypeId) {
      const existingWithholdingTaxType = await WithholdingTaxType.findOne({
        where: {
          id: expense.withholdingTaxTypeId,
          organizationId: effectiveOrganizationId,
          isActive: true,
        },
      });
      withholdingTaxPercentage = Number(existingWithholdingTaxType?.percentage || 0);
    }

    const computed = computeExpenseAmounts({
      amount: payload.amount ?? expense.amount,
      vatExemptAmount: payload.vatExemptAmount ?? expense.vatExemptAmount,
      discountAmount: payload.discountAmount ?? expense.discountAmount,
      vatPercentage: Number(organization.taxType.percentage || 0),
      withholdingPercentage: withholdingTaxPercentage,
    });
    payload.amount = computed.amount;
    payload.vatExemptAmount = computed.vatExemptAmount;
    payload.discountAmount = computed.discountAmount;
    payload.taxAmount = computed.taxAmount;
    payload.withHoldingTaxAmount = computed.withHoldingTaxAmount;
    payload.totalAmount = computed.totalAmount;

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

    if (!isPrivilegedRequest(req)) {
      delete payload.organizationId;
    }

    await expense.update(payload);
    const updated = await Expense.findByPk(expense.id, {
      include: [
        {
          association: 'vendor',
          attributes: ['id', 'name', 'taxId'],
          required: false,
        },
        {
          association: 'taxType',
          attributes: ['id', 'code', 'name', 'percentage'],
          required: false,
        },
        {
          association: 'withholdingTaxType',
          attributes: ['id', 'code', 'name', 'percentage'],
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
    const where = { id: req.params.id };
    if (!isPrivilegedRequest(req)) {
      const scopedWhere = applyOrganizationWhereScope(where, req);
      if (!scopedWhere) {
        return res.status(404).json({ ok: false, message: 'Expense not found.' });
      }
    }
    const expense = await Expense.findOne({ where });
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
  importExpenses,
  exportExpenses,
  listExpenses,
  getExpenseById,
  updateExpense,
  deleteExpense,
};
