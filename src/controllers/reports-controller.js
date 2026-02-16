const { Op, fn, col } = require('sequelize');
const { getModels } = require('../sequelize');
const { getOrganizationCurrency } = require('../services/organization-currency');
const { isPrivilegedRequest } = require('../services/request-scope');
const { sendQuarterlyExpenseReportReadyEmail } = require('../services/email-service');

function getQuarterDates(year, quarter) {
  const quarterStartMonth = (quarter - 1) * 3;
  const startDate = new Date(Date.UTC(year, quarterStartMonth, 1));
  const endDate = new Date(Date.UTC(year, quarterStartMonth + 3, 0));

  const toDateOnly = (date) => date.toISOString().slice(0, 10);
  return {
    periodStart: toDateOnly(startDate),
    periodEnd: toDateOnly(endDate),
  };
}

function parseYear(input) {
  const currentYear = new Date().getUTCFullYear();
  const value = Number(input ?? currentYear);
  if (!Number.isInteger(value) || value < 2000 || value > 2200) {
    return null;
  }
  return value;
}

function parseQuarter(input) {
  const value = Number(input);
  if (!Number.isInteger(value) || value < 1 || value > 4) {
    return null;
  }
  return value;
}

function toNumber(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function buildExpenseReportPreviewUrl(reportId) {
  const appBaseUrl = String(process.env.APP_BASE_URL || 'http://localhost').trim();
  return `${appBaseUrl.replace(/\/+$/, '')}/reports/${encodeURIComponent(reportId)}`;
}

function resolveOrganizationId(req, fallbackFromBody = null) {
  const authOrgId = req.auth?.user?.organizationId || null;

  if (isPrivilegedRequest(req)) {
    return req.query.organizationId || fallbackFromBody || authOrgId;
  }

  return authOrgId;
}

function resolveOrganizationIdForRead(req) {
  const authOrgId = req.auth?.user?.organizationId || null;
  if (isPrivilegedRequest(req)) {
    const requested = req.query.organizationId || null;
    return requested || null;
  }
  return authOrgId;
}

function hasRoleCode(user, roleCodes = []) {
  const allowed = roleCodes.map((value) => String(value || '').toLowerCase());
  const primaryRole = String(user?.role || '').toLowerCase();
  if (primaryRole && allowed.includes(primaryRole)) {
    return true;
  }
  const memberships = Array.isArray(user?.roles) ? user.roles : [];
  return memberships.some((role) =>
    allowed.includes(String(role?.code || '').toLowerCase())
  );
}

async function notifyQuarterlyExpenseReportGenerated(models, report) {
  if (!models?.Organization || !models?.Role || !models?.User) {
    return;
  }

  const organization = await models.Organization.findByPk(report.organizationId);
  if (!organization) {
    return;
  }

  const orgUsers = await organization.getUsers({
    attributes: ['id', 'email', 'firstName', 'lastName', 'role', 'isActive'],
    through: {
      where: { isActive: true },
      attributes: [],
    },
    include: models.Role
      ? [
          {
            model: models.Role,
            as: 'roles',
            through: { attributes: [] },
            required: false,
          },
        ]
      : [],
  });

  const recipients = [];
  const seenEmails = new Set();
  for (const user of orgUsers || []) {
    const email = String(user?.email || '').toLowerCase().trim();
    if (!user?.isActive || !email || seenEmails.has(email)) {
      continue;
    }
    if (!hasRoleCode(user, ['administrator', 'accountant'])) {
      continue;
    }
    seenEmails.add(email);
    recipients.push({
      email,
      name:
        [user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
        email,
    });
  }

  if (recipients.length === 0) {
    return;
  }

  const reportUrl = buildExpenseReportPreviewUrl(report.id);
  const quarterLabel = `Q${report.quarter}`;
  const organizationName = organization.name || organization.legalName || 'your organization';

  await Promise.allSettled(
    recipients.map((recipient) =>
      sendQuarterlyExpenseReportReadyEmail({
        toEmail: recipient.email,
        toName: recipient.name,
        organizationName,
        quarter: quarterLabel,
        year: report.year,
        reportUrl,
      })
    )
  );
}

async function computeQuarterlySalesInvoiceReport(req, res, next) {
  try {
    const models = getModels();
    if (!models || !models.SalesInvoice || !models.QuarterlySalesReport) {
      return res.status(503).json({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Database models are not ready yet.',
      });
    }

    const organizationId = resolveOrganizationId(req, req.body?.organizationId);
    if (!organizationId) {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        message: 'organizationId could not be resolved from authenticated user.',
      });
    }

    const year = parseYear(req.body?.year);
    const quarter = parseQuarter(req.body?.quarter);

    if (year === null) {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        message: 'year is required and must be a valid year.',
      });
    }

    if (quarter === null) {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        message: 'quarter is required and must be between 1 and 4.',
      });
    }

    const { SalesInvoice, QuarterlySalesReport } = models;
    const { periodStart, periodEnd } = getQuarterDates(year, quarter);

    const aggregates = await SalesInvoice.findOne({
      where: {
        organizationId,
        issueDate: {
          [Op.between]: [periodStart, periodEnd],
        },
        status: {
          [Op.ne]: 'void',
        },
      },
      attributes: [
        [fn('COUNT', col('id')), 'invoiceCount'],
        [fn('COALESCE', fn('SUM', col('subtotal_amount')), 0), 'subtotalAmount'],
        [fn('COALESCE', fn('SUM', col('tax_amount')), 0), 'taxAmount'],
        [fn('COALESCE', fn('SUM', col('discount_amount')), 0), 'discountAmount'],
        [fn('COALESCE', fn('SUM', col('total_amount')), 0), 'totalAmount'],
      ],
      raw: true,
    });

    const payload = {
      organizationId,
      year,
      quarter,
      periodStart,
      periodEnd,
      invoiceCount: Math.trunc(toNumber(aggregates?.invoiceCount)),
      currency: await getOrganizationCurrency(organizationId),
      subtotalAmount: toNumber(aggregates?.subtotalAmount),
      taxAmount: toNumber(aggregates?.taxAmount),
      discountAmount: toNumber(aggregates?.discountAmount),
      totalAmount: toNumber(aggregates?.totalAmount),
      generatedBy: req.auth?.user?.id || null,
      generatedAt: new Date(),
      notes: req.body?.notes ? String(req.body.notes) : null,
    };

    const [report, created] = await QuarterlySalesReport.findOrCreate({
      where: {
        organizationId,
        year,
        quarter,
      },
      defaults: payload,
    });

    if (!created) {
      await report.update(payload);
    }

    const savedReport = await QuarterlySalesReport.findByPk(report.id);

    return res.status(created ? 201 : 200).json({
      code: created ? 'CREATED' : 'SUCCESS',
      message: `Quarter ${quarter} report for ${year} has been ${created ? 'generated' : 'refreshed'}.`,
      data: savedReport,
    });
  } catch (err) {
    return next(err);
  }
}

async function listQuarterlySalesReports(req, res, next) {
  try {
    const models = getModels();
    if (!models || !models.QuarterlySalesReport || !models.Organization) {
      return res.status(503).json({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Database models are not ready yet.',
      });
    }

    const organizationId = resolveOrganizationIdForRead(req);
    const isPrivileged = isPrivilegedRequest(req);
    if (!isPrivileged && !organizationId) {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        message: 'organizationId could not be resolved from authenticated user.',
      });
    }

    const { QuarterlySalesReport, Organization } = models;
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 100);
    const offset = (page - 1) * limit;

    const where = {};
    if (organizationId) {
      where.organizationId = organizationId;
    }

    const yearFilter = parseYear(req.query.year);
    if (req.query.year !== undefined && yearFilter !== null) {
      where.year = yearFilter;
    }

    const quarterFilter = parseQuarter(req.query.quarter);
    if (req.query.quarter !== undefined && quarterFilter !== null) {
      where.quarter = quarterFilter;
    }

    const { rows, count } = await QuarterlySalesReport.findAndCountAll({
      where,
      include: [
        {
          model: Organization,
          as: 'organization',
          attributes: ['id', 'name', 'legalName'],
        },
      ],
      order: [
        ['year', 'DESC'],
        ['quarter', 'DESC'],
        ['generatedAt', 'DESC'],
      ],
      limit,
      offset,
    });

    return res.status(200).json({
      code: 'SUCCESS',
      message: 'Quarterly sales reports fetched successfully.',
      data: rows,
      meta: {
        page,
        limit,
        total: count,
        totalPages: Math.max(1, Math.ceil(count / limit)),
      },
    });
  } catch (err) {
    return next(err);
  }
}

async function getQuarterlySalesReportById(req, res, next) {
  try {
    const models = getModels();
    if (!models || !models.QuarterlySalesReport || !models.Organization) {
      return res.status(503).json({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Database models are not ready yet.',
      });
    }

    const organizationId = resolveOrganizationIdForRead(req);
    const isPrivileged = isPrivilegedRequest(req);
    if (!isPrivileged && !organizationId) {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        message: 'organizationId could not be resolved from authenticated user.',
      });
    }

    const { QuarterlySalesReport, Organization } = models;
    const report = await QuarterlySalesReport.findOne({
      where: {
        id: req.params.id,
        ...(organizationId ? { organizationId } : {}),
      },
      include: [
        {
          model: Organization,
          as: 'organization',
          attributes: ['id', 'name', 'legalName'],
        },
      ],
    });

    if (!report) {
      return res.status(404).json({
        code: 'NOT_FOUND',
        message: 'Quarterly sales report not found.',
      });
    }

    return res.status(200).json({
      code: 'SUCCESS',
      message: 'Quarterly sales report fetched successfully.',
      data: report,
    });
  } catch (err) {
    return next(err);
  }
}

async function getQuarterlySalesReportPreviewById(req, res, next) {
  try {
    const models = getModels();
    if (
      !models ||
      !models.QuarterlySalesReport ||
      !models.Organization ||
      !models.SalesInvoice
    ) {
      return res.status(503).json({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Database models are not ready yet.',
      });
    }

    const organizationId = resolveOrganizationIdForRead(req);
    const isPrivileged = isPrivilegedRequest(req);
    if (!isPrivileged && !organizationId) {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        message: 'organizationId could not be resolved from authenticated user.',
      });
    }

    const {
      QuarterlySalesReport,
      Organization,
      SalesInvoice,
      Order,
      Customer,
    } = models;

    const report = await QuarterlySalesReport.findOne({
      where: {
        id: req.params.id,
        ...(organizationId ? { organizationId } : {}),
      },
      include: [
        {
          model: Organization,
          as: 'organization',
          attributes: ['id', 'name', 'legalName'],
        },
      ],
    });

    if (!report) {
      return res.status(404).json({
        code: 'NOT_FOUND',
        message: 'Quarterly sales report not found.',
      });
    }

    const salesInvoices = await SalesInvoice.findAll({
      where: {
        organizationId: report.organizationId,
        issueDate: {
          [Op.between]: [report.periodStart, report.periodEnd],
        },
        status: {
          [Op.ne]: 'void',
        },
      },
      include: [
        Order
          ? {
              model: Order,
              as: 'order',
              attributes: ['id', 'orderNumber', 'status', 'paymentStatus'],
              required: false,
              include: Customer
                ? [
                    {
                      model: Customer,
                      as: 'customer',
                      attributes: ['id', 'name', 'taxId'],
                      required: false,
                    },
                  ]
                : [],
            }
          : null,
      ].filter(Boolean),
      order: [
        ['issueDate', 'DESC'],
        ['createdAt', 'DESC'],
      ],
    });

    const summary = salesInvoices.reduce(
      (acc, invoice) => {
        acc.invoiceCount += 1;
        acc.amount += toNumber(invoice.amount);
        acc.taxableAmount += toNumber(invoice.taxableAmount);
        acc.withHoldingTaxAmount += toNumber(invoice.withHoldingTaxAmount);
        acc.subtotalAmount += toNumber(invoice.subtotalAmount);
        acc.taxAmount += toNumber(invoice.taxAmount);
        acc.discountAmount += toNumber(invoice.discountAmount);
        acc.totalAmount += toNumber(invoice.totalAmount);
        return acc;
      },
      {
        invoiceCount: 0,
        amount: 0,
        taxableAmount: 0,
        withHoldingTaxAmount: 0,
        subtotalAmount: 0,
        taxAmount: 0,
        discountAmount: 0,
        totalAmount: 0,
      }
    );

    return res.status(200).json({
      code: 'SUCCESS',
      message: 'Quarterly sales report preview fetched successfully.',
      data: {
        report,
        summary: {
          ...summary,
          currency: report.currency,
        },
        salesInvoices,
      },
    });
  } catch (err) {
    return next(err);
  }
}

async function deleteQuarterlySalesReport(req, res, next) {
  try {
    const models = getModels();
    if (!models || !models.QuarterlySalesReport) {
      return res.status(503).json({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Database models are not ready yet.',
      });
    }

    const organizationId = resolveOrganizationIdForRead(req);
    const isPrivileged = isPrivilegedRequest(req);
    if (!isPrivileged && !organizationId) {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        message: 'organizationId could not be resolved from authenticated user.',
      });
    }

    const { QuarterlySalesReport } = models;
    const report = await QuarterlySalesReport.findOne({
      where: {
        id: req.params.id,
        ...(organizationId ? { organizationId } : {}),
      },
    });

    if (!report) {
      return res.status(404).json({
        code: 'NOT_FOUND',
        message: 'Quarterly sales report not found.',
      });
    }

    await report.destroy();

    return res.status(200).json({
      code: 'SUCCESS',
      message: 'Quarterly sales report deleted successfully.',
    });
  } catch (err) {
    return next(err);
  }
}

async function computeQuarterlyExpenseReport(req, res, next) {
  try {
    const models = getModels();
    if (!models || !models.Expense || !models.QuarterlyExpenseReport) {
      return res.status(503).json({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Database models are not ready yet.',
      });
    }

    const organizationId = resolveOrganizationId(req, req.body?.organizationId);
    if (!organizationId) {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        message: 'organizationId could not be resolved from authenticated user.',
      });
    }

    const year = parseYear(req.body?.year);
    const quarter = parseQuarter(req.body?.quarter);

    if (year === null) {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        message: 'year is required and must be a valid year.',
      });
    }

    if (quarter === null) {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        message: 'quarter is required and must be between 1 and 4.',
      });
    }

    const { Expense, QuarterlyExpenseReport } = models;
    const { periodStart, periodEnd } = getQuarterDates(year, quarter);

    const aggregates = await Expense.findOne({
      where: {
        organizationId,
        expenseDate: {
          [Op.between]: [periodStart, periodEnd],
        },
        status: {
          [Op.ne]: 'cancelled',
        },
      },
      attributes: [
        [fn('COUNT', col('id')), 'expenseCount'],
        [fn('COALESCE', fn('SUM', col('amount')), 0), 'amount'],
        [fn('COALESCE', fn('SUM', col('tax_amount')), 0), 'taxAmount'],
        [fn('COALESCE', fn('SUM', col('discount_amount')), 0), 'discountAmount'],
        [fn('COALESCE', fn('SUM', col('total_amount')), 0), 'totalAmount'],
      ],
      raw: true,
    });

    const payload = {
      organizationId,
      year,
      quarter,
      periodStart,
      periodEnd,
      expenseCount: Math.trunc(toNumber(aggregates?.expenseCount)),
      currency: await getOrganizationCurrency(organizationId),
      amount: toNumber(aggregates?.amount),
      taxAmount: toNumber(aggregates?.taxAmount),
      discountAmount: toNumber(aggregates?.discountAmount),
      totalAmount: toNumber(aggregates?.totalAmount),
      generatedBy: req.auth?.user?.id || null,
      generatedAt: new Date(),
      notes: req.body?.notes ? String(req.body.notes) : null,
    };

    const [report, created] = await QuarterlyExpenseReport.findOrCreate({
      where: {
        organizationId,
        year,
        quarter,
      },
      defaults: payload,
    });

    if (!created) {
      await report.update(payload);
    }

    const savedReport = await QuarterlyExpenseReport.findByPk(report.id);
    if (savedReport) {
      try {
        await notifyQuarterlyExpenseReportGenerated(models, savedReport);
      } catch (emailErr) {
        console.error('Quarterly expense report email notification error:', emailErr);
      }
    }

    return res.status(created ? 201 : 200).json({
      code: created ? 'CREATED' : 'SUCCESS',
      message: `Quarter ${quarter} expense report for ${year} has been ${created ? 'generated' : 'refreshed'}.`,
      data: savedReport,
    });
  } catch (err) {
    return next(err);
  }
}

async function listQuarterlyExpenseReports(req, res, next) {
  try {
    const models = getModels();
    if (!models || !models.QuarterlyExpenseReport || !models.Organization) {
      return res.status(503).json({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Database models are not ready yet.',
      });
    }

    const organizationId = resolveOrganizationIdForRead(req);
    const isPrivileged = isPrivilegedRequest(req);
    if (!isPrivileged && !organizationId) {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        message: 'organizationId could not be resolved from authenticated user.',
      });
    }

    const { QuarterlyExpenseReport, Organization } = models;
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 100);
    const offset = (page - 1) * limit;

    const where = {};
    if (organizationId) {
      where.organizationId = organizationId;
    }

    const yearFilter = parseYear(req.query.year);
    if (req.query.year !== undefined && yearFilter !== null) {
      where.year = yearFilter;
    }

    const quarterFilter = parseQuarter(req.query.quarter);
    if (req.query.quarter !== undefined && quarterFilter !== null) {
      where.quarter = quarterFilter;
    }

    const { rows, count } = await QuarterlyExpenseReport.findAndCountAll({
      where,
      include: [
        {
          model: Organization,
          as: 'organization',
          attributes: ['id', 'name', 'legalName'],
        },
      ],
      order: [
        ['year', 'DESC'],
        ['quarter', 'DESC'],
        ['generatedAt', 'DESC'],
      ],
      limit,
      offset,
    });

    return res.status(200).json({
      code: 'SUCCESS',
      message: 'Quarterly expense reports fetched successfully.',
      data: rows,
      meta: {
        page,
        limit,
        total: count,
        totalPages: Math.max(1, Math.ceil(count / limit)),
      },
    });
  } catch (err) {
    return next(err);
  }
}

async function getQuarterlyExpenseReportById(req, res, next) {
  try {
    const models = getModels();
    if (!models || !models.QuarterlyExpenseReport || !models.Organization) {
      return res.status(503).json({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Database models are not ready yet.',
      });
    }

    const organizationId = resolveOrganizationIdForRead(req);
    const isPrivileged = isPrivilegedRequest(req);
    if (!isPrivileged && !organizationId) {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        message: 'organizationId could not be resolved from authenticated user.',
      });
    }

    const { QuarterlyExpenseReport, Organization } = models;
    const report = await QuarterlyExpenseReport.findOne({
      where: {
        id: req.params.id,
        ...(organizationId ? { organizationId } : {}),
      },
      include: [
        {
          model: Organization,
          as: 'organization',
          attributes: ['id', 'name', 'legalName'],
        },
      ],
    });

    if (!report) {
      return res.status(404).json({
        code: 'NOT_FOUND',
        message: 'Quarterly expense report not found.',
      });
    }

    return res.status(200).json({
      code: 'SUCCESS',
      message: 'Quarterly expense report fetched successfully.',
      data: report,
    });
  } catch (err) {
    return next(err);
  }
}

async function getQuarterlyExpenseReportPreviewById(req, res, next) {
  try {
    const models = getModels();
    if (
      !models ||
      !models.QuarterlyExpenseReport ||
      !models.Organization ||
      !models.Expense
    ) {
      return res.status(503).json({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Database models are not ready yet.',
      });
    }

    const organizationId = resolveOrganizationIdForRead(req);
    const isPrivileged = isPrivilegedRequest(req);
    if (!isPrivileged && !organizationId) {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        message: 'organizationId could not be resolved from authenticated user.',
      });
    }

    const {
      QuarterlyExpenseReport,
      Organization,
      Expense,
      Vendor,
      TaxType,
      WithholdingTaxType,
    } = models;

    const report = await QuarterlyExpenseReport.findOne({
      where: {
        id: req.params.id,
        ...(organizationId ? { organizationId } : {}),
      },
      include: [
        {
          model: Organization,
          as: 'organization',
          attributes: ['id', 'name', 'legalName'],
        },
      ],
    });

    if (!report) {
      return res.status(404).json({
        code: 'NOT_FOUND',
        message: 'Quarterly expense report not found.',
      });
    }

    const expenses = await Expense.findAll({
      where: {
        organizationId: report.organizationId,
        expenseDate: {
          [Op.between]: [report.periodStart, report.periodEnd],
        },
        status: {
          [Op.ne]: 'cancelled',
        },
      },
      include: [
        Vendor
          ? {
              model: Vendor,
              as: 'vendor',
              attributes: ['id', 'name', 'legalName', 'taxId'],
              required: false,
            }
          : null,
        TaxType
          ? {
              model: TaxType,
              as: 'taxType',
              attributes: ['id', 'code', 'name', 'percentage'],
              required: false,
            }
          : null,
        WithholdingTaxType
          ? {
              model: WithholdingTaxType,
              as: 'withholdingTaxType',
              attributes: ['id', 'name', 'percentage'],
              required: false,
            }
          : null,
      ].filter(Boolean),
      order: [
        ['expenseDate', 'DESC'],
        ['createdAt', 'DESC'],
      ],
    });

    const summary = expenses.reduce(
      (acc, expense) => {
        acc.expenseCount += 1;
        acc.amount += toNumber(expense.amount);
        acc.taxableAmount += toNumber(expense.taxableAmount);
        acc.taxAmount += toNumber(expense.taxAmount);
        acc.vatExemptAmount += toNumber(expense.vatExemptAmount);
        acc.withHoldingTaxAmount += toNumber(expense.withHoldingTaxAmount);
        acc.discountAmount += toNumber(expense.discountAmount);
        acc.totalAmount += toNumber(expense.totalAmount);
        return acc;
      },
      {
        expenseCount: 0,
        amount: 0,
        taxableAmount: 0,
        taxAmount: 0,
        vatExemptAmount: 0,
        withHoldingTaxAmount: 0,
        discountAmount: 0,
        totalAmount: 0,
      }
    );

    return res.status(200).json({
      code: 'SUCCESS',
      message: 'Quarterly expense report preview fetched successfully.',
      data: {
        report,
        summary: {
          ...summary,
          currency: report.currency,
        },
        expenses,
      },
    });
  } catch (err) {
    return next(err);
  }
}

async function deleteQuarterlyExpenseReport(req, res, next) {
  try {
    const models = getModels();
    if (!models || !models.QuarterlyExpenseReport) {
      return res.status(503).json({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Database models are not ready yet.',
      });
    }

    const organizationId = resolveOrganizationIdForRead(req);
    const isPrivileged = isPrivilegedRequest(req);
    if (!isPrivileged && !organizationId) {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        message: 'organizationId could not be resolved from authenticated user.',
      });
    }

    const { QuarterlyExpenseReport } = models;
    const report = await QuarterlyExpenseReport.findOne({
      where: {
        id: req.params.id,
        ...(organizationId ? { organizationId } : {}),
      },
    });

    if (!report) {
      return res.status(404).json({
        code: 'NOT_FOUND',
        message: 'Quarterly expense report not found.',
      });
    }

    await report.destroy();

    return res.status(200).json({
      code: 'SUCCESS',
      message: 'Quarterly expense report deleted successfully.',
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  computeQuarterlySalesInvoiceReport,
  listQuarterlySalesReports,
  getQuarterlySalesReportById,
  getQuarterlySalesReportPreviewById,
  deleteQuarterlySalesReport,
  computeQuarterlyExpenseReport,
  listQuarterlyExpenseReports,
  getQuarterlyExpenseReportById,
  getQuarterlyExpenseReportPreviewById,
  deleteQuarterlyExpenseReport,
};
