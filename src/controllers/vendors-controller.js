const { Op } = require('sequelize');
const { parse } = require('csv-parse/sync');
const { getModels } = require('../sequelize');
const { isPrivilegedRequest } = require('../services/request-scope');

function resolveOrganizationId(req, fallback = null) {
  const authOrgId = req.auth?.user?.organizationId || null;
  if (isPrivilegedRequest(req)) {
    return req.query.organizationId || fallback || authOrgId;
  }
  return authOrgId;
}

function pickVendorPayload(body = {}) {
  return {
    organizationId: body.organizationId,
    name: body.name,
    legalName: body.legalName,
    taxId: body.taxId,
    contactPerson: body.contactPerson,
    contactEmail: body.contactEmail,
    phone: body.phone,
    addressLine1: body.addressLine1,
    addressLine2: body.addressLine2,
    city: body.city,
    state: body.state,
    barangay: body.barangay,
    province: body.province,
    postalCode: body.postalCode,
    country: body.country,
    paymentTerms: body.paymentTerms,
    notes: body.notes,
    status: body.status,
    createdBy: body.createdBy,
    updatedBy: body.updatedBy,
  };
}

function cleanUndefined(payload) {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
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

async function importVendors(req, res, next) {
  try {
    const models = getModels();
    if (!models || !models.Vendor) {
      return res.status(503).json({ code: 'SERVICE_UNAVAILABLE', message: 'Database models are not ready yet.' });
    }

    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ code: 'BAD_REQUEST', message: 'CSV file is required.' });
    }

    const records = parse(req.file.buffer.toString('utf-8'), {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ code: 'BAD_REQUEST', message: 'CSV file has no rows to import.' });
    }

    const organizationId = resolveOrganizationId(req, req.body?.organizationId);
    if (!organizationId) {
      return res.status(400).json({ code: 'BAD_REQUEST', message: 'organizationId could not be resolved from authenticated user.' });
    }

    const { Vendor } = models;
    let imported = 0;
    let skipped = 0;
    const errors = [];

    for (let index = 0; index < records.length; index += 1) {
      const row = records[index];
      const rowNum = index + 2;
      const name = String(row.name || '').trim();
      if (!name) {
        skipped += 1;
        errors.push(`Row ${rowNum}: name is required.`);
        continue;
      }

      const payload = cleanUndefined({
        organizationId,
        name,
        legalName: String(row.legalName || '').trim() || undefined,
        taxId: String(row.taxId || '').trim() || undefined,
        contactPerson: String(row.contactPerson || '').trim() || undefined,
        contactEmail: String(row.contactEmail || '').trim() || undefined,
        phone: String(row.phone || '').trim() || undefined,
        addressLine1: String(row.addressLine1 || '').trim() || undefined,
        addressLine2: String(row.addressLine2 || '').trim() || undefined,
        city: String(row.city || '').trim() || undefined,
        state: String(row.state || '').trim() || undefined,
        barangay: String(row.barangay || '').trim() || undefined,
        province: String(row.province || '').trim() || undefined,
        postalCode: String(row.postalCode || '').trim() || undefined,
        country: String(row.country || '').trim() || undefined,
        paymentTerms: String(row.paymentTerms || '').trim() || undefined,
        notes: String(row.notes || '').trim() || undefined,
        status: String(row.status || '').trim().toLowerCase() || 'active',
        createdBy: req.auth?.user?.id || null,
        updatedBy: req.auth?.user?.id || null,
      });

      try {
        // eslint-disable-next-line no-await-in-loop
        await Vendor.create(payload);
        imported += 1;
      } catch (rowErr) {
        skipped += 1;
        errors.push(`Row ${rowNum}: ${rowErr.message || 'failed to import row.'}`);
      }
    }

    return res.status(200).json({
      code: 'SUCCESS',
      message: `Vendor import complete. Imported ${imported}, skipped ${skipped}.`,
      data: {
        imported,
        skipped,
        totalRows: records.length,
        errors,
      },
    });
  } catch (err) {
    return next(err);
  }
}

async function exportVendors(req, res, next) {
  try {
    const models = getModels();
    if (!models || !models.Vendor) {
      return res.status(503).json({ code: 'SERVICE_UNAVAILABLE', message: 'Database models are not ready yet.' });
    }

    const organizationId = resolveOrganizationId(req);
    if (!organizationId) {
      return res.status(400).json({ code: 'BAD_REQUEST', message: 'organizationId could not be resolved from authenticated user.' });
    }

    const where = { organizationId };
    if (req.query.status) {
      where.status = String(req.query.status).toLowerCase();
    }
    if (String(req.query.activeOnly || '').toLowerCase() === 'true') {
      where.status = 'active';
    }

    const q = String(req.query.q || '').trim();
    if (q) {
      where[Op.or] = [
        { name: { [Op.like]: `%${q}%` } },
        { legalName: { [Op.like]: `%${q}%` } },
        { taxId: { [Op.like]: `%${q}%` } },
        { contactPerson: { [Op.like]: `%${q}%` } },
        { contactEmail: { [Op.like]: `%${q}%` } },
        { barangay: { [Op.like]: `%${q}%` } },
        { province: { [Op.like]: `%${q}%` } },
      ];
    }

    const { Vendor } = models;
    const rows = await Vendor.findAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: 10000,
    });

    const headers = [
      'id',
      'organizationId',
      'name',
      'legalName',
      'taxId',
      'contactPerson',
      'contactEmail',
      'phone',
      'addressLine1',
      'addressLine2',
      'city',
      'state',
      'barangay',
      'province',
      'postalCode',
      'country',
      'paymentTerms',
      'status',
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
          csvValue(json.name),
          csvValue(json.legalName),
          csvValue(json.taxId),
          csvValue(json.contactPerson),
          csvValue(json.contactEmail),
          csvValue(json.phone),
          csvValue(json.addressLine1),
          csvValue(json.addressLine2),
          csvValue(json.city),
          csvValue(json.state),
          csvValue(json.barangay),
          csvValue(json.province),
          csvValue(json.postalCode),
          csvValue(json.country),
          csvValue(json.paymentTerms),
          csvValue(json.status),
          csvValue(json.notes),
          csvValue(json.createdAt),
          csvValue(json.updatedAt),
        ].join(',')
      );
    }

    const csv = lines.join('\n');
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=\"vendors-${date}.csv\"`);
    return res.status(200).send(csv);
  } catch (err) {
    return next(err);
  }
}

async function listVendors(req, res, next) {
  try {
    const models = getModels();
    if (!models || !models.Vendor || !models.Organization) {
      return res.status(503).json({ code: 'SERVICE_UNAVAILABLE', message: 'Database models are not ready yet.' });
    }

    const organizationId = resolveOrganizationId(req);
    if (!organizationId) {
      return res.status(400).json({ code: 'BAD_REQUEST', message: 'organizationId could not be resolved from authenticated user.' });
    }

    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 100);
    const offset = (page - 1) * limit;

    const where = { organizationId };
    if (req.query.status) {
      where.status = String(req.query.status).toLowerCase();
    }
    if (String(req.query.activeOnly || '').toLowerCase() === 'true') {
      where.status = 'active';
    }

    const q = String(req.query.q || '').trim();
    if (q) {
      where[Op.or] = [
        { name: { [Op.like]: `%${q}%` } },
        { legalName: { [Op.like]: `%${q}%` } },
        { taxId: { [Op.like]: `%${q}%` } },
        { contactPerson: { [Op.like]: `%${q}%` } },
        { contactEmail: { [Op.like]: `%${q}%` } },
        { barangay: { [Op.like]: `%${q}%` } },
        { province: { [Op.like]: `%${q}%` } },
      ];
    }

    const { Vendor, Organization } = models;
    const { rows, count } = await Vendor.findAndCountAll({
      where,
      include: [
        {
          model: Organization,
          as: 'organization',
          attributes: ['id', 'name', 'legalName'],
          required: false,
        },
      ],
      order: [['createdAt', 'DESC']],
      limit,
      offset,
    });

    return res.status(200).json({
      code: 'SUCCESS',
      message: 'Vendors fetched successfully.',
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

async function createVendor(req, res, next) {
  try {
    const models = getModels();
    if (!models || !models.Vendor) {
      return res.status(503).json({ code: 'SERVICE_UNAVAILABLE', message: 'Database models are not ready yet.' });
    }

    const organizationId = resolveOrganizationId(req, req.body?.organizationId);
    if (!organizationId) {
      return res.status(400).json({ code: 'BAD_REQUEST', message: 'organizationId could not be resolved from authenticated user.' });
    }

    const payload = cleanUndefined(pickVendorPayload(req.body));
    payload.organizationId = organizationId;
    payload.createdBy = req.auth?.user?.id || payload.createdBy || null;
    payload.updatedBy = req.auth?.user?.id || payload.updatedBy || null;

    if (!payload.name) {
      return res.status(400).json({ code: 'BAD_REQUEST', message: 'name is required.' });
    }

    const { Vendor } = models;
    const vendor = await Vendor.create(payload);

    return res.status(201).json({
      code: 'CREATED',
      message: 'Vendor created successfully.',
      data: vendor,
    });
  } catch (err) {
    return next(err);
  }
}

async function getVendorById(req, res, next) {
  try {
    const models = getModels();
    if (!models || !models.Vendor || !models.Organization) {
      return res.status(503).json({ code: 'SERVICE_UNAVAILABLE', message: 'Database models are not ready yet.' });
    }

    const { Vendor, Organization } = models;
    const where = {
      id: req.params.id,
    };
    if (!isPrivilegedRequest(req)) {
      const organizationId = resolveOrganizationId(req);
      if (!organizationId) {
        return res.status(400).json({ code: 'BAD_REQUEST', message: 'organizationId could not be resolved from authenticated user.' });
      }
      where.organizationId = organizationId;
    }

    const vendor = await Vendor.findOne({
      where,
      include: [
        {
          model: Organization,
          as: 'organization',
          attributes: ['id', 'name', 'legalName'],
          required: false,
        },
      ],
    });

    if (!vendor) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Vendor not found.' });
    }

    return res.status(200).json({ code: 'SUCCESS', message: 'Vendor fetched successfully.', data: vendor });
  } catch (err) {
    return next(err);
  }
}

async function updateVendor(req, res, next) {
  try {
    const models = getModels();
    if (!models || !models.Vendor) {
      return res.status(503).json({ code: 'SERVICE_UNAVAILABLE', message: 'Database models are not ready yet.' });
    }

    const { Vendor } = models;
    const where = {
      id: req.params.id,
    };
    if (!isPrivilegedRequest(req)) {
      const organizationId = resolveOrganizationId(req);
      if (!organizationId) {
        return res.status(400).json({ code: 'BAD_REQUEST', message: 'organizationId could not be resolved from authenticated user.' });
      }
      where.organizationId = organizationId;
    }

    const vendor = await Vendor.findOne({
      where,
    });

    if (!vendor) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Vendor not found.' });
    }

    const payload = cleanUndefined(pickVendorPayload(req.body));
    delete payload.organizationId;
    payload.updatedBy = req.auth?.user?.id || payload.updatedBy || vendor.updatedBy || null;

    await vendor.update(payload);

    return res.status(200).json({
      code: 'SUCCESS',
      message: 'Vendor updated successfully.',
      data: vendor,
    });
  } catch (err) {
    return next(err);
  }
}

async function deleteVendor(req, res, next) {
  try {
    const models = getModels();
    if (!models || !models.Vendor) {
      return res.status(503).json({ code: 'SERVICE_UNAVAILABLE', message: 'Database models are not ready yet.' });
    }

    const { Vendor } = models;
    const where = {
      id: req.params.id,
    };
    if (!isPrivilegedRequest(req)) {
      const organizationId = resolveOrganizationId(req);
      if (!organizationId) {
        return res.status(400).json({ code: 'BAD_REQUEST', message: 'organizationId could not be resolved from authenticated user.' });
      }
      where.organizationId = organizationId;
    }

    const vendor = await Vendor.findOne({
      where,
    });

    if (!vendor) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Vendor not found.' });
    }

    await vendor.destroy();

    return res.status(200).json({
      code: 'SUCCESS',
      message: 'Vendor deleted successfully.',
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listVendors,
  importVendors,
  exportVendors,
  createVendor,
  getVendorById,
  updateVendor,
  deleteVendor,
};
