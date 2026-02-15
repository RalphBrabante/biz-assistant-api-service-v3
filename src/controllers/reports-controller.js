const { Op, fn, col } = require('sequelize');
const { getModels } = require('../sequelize');
const { getOrganizationCurrency } = require('../services/organization-currency');
const { isPrivilegedRequest } = require('../services/request-scope');

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

function resolveOrganizationId(req, fallbackFromBody = null) {
  const authOrgId = req.auth?.user?.organizationId || null;

  if (isPrivilegedRequest(req)) {
    return req.query.organizationId || fallbackFromBody || authOrgId;
  }

  return authOrgId;
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

    const organizationId = resolveOrganizationId(req);
    if (!organizationId) {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        message: 'organizationId could not be resolved from authenticated user.',
      });
    }

    const { QuarterlySalesReport, Organization } = models;
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 100);
    const offset = (page - 1) * limit;

    const where = { organizationId };

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

    const organizationId = resolveOrganizationId(req);
    if (!organizationId) {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        message: 'organizationId could not be resolved from authenticated user.',
      });
    }

    const { QuarterlySalesReport, Organization } = models;
    const report = await QuarterlySalesReport.findOne({
      where: {
        id: req.params.id,
        organizationId,
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

    const organizationId = resolveOrganizationId(req);
    if (!organizationId) {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        message: 'organizationId could not be resolved from authenticated user.',
      });
    }

    const { QuarterlyExpenseReport, Organization } = models;
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 100);
    const offset = (page - 1) * limit;

    const where = { organizationId };

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

    const organizationId = resolveOrganizationId(req);
    if (!organizationId) {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        message: 'organizationId could not be resolved from authenticated user.',
      });
    }

    const { QuarterlyExpenseReport, Organization } = models;
    const report = await QuarterlyExpenseReport.findOne({
      where: {
        id: req.params.id,
        organizationId,
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

module.exports = {
  computeQuarterlySalesInvoiceReport,
  listQuarterlySalesReports,
  getQuarterlySalesReportById,
  computeQuarterlyExpenseReport,
  listQuarterlyExpenseReports,
  getQuarterlyExpenseReportById,
};
