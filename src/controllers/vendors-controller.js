const { Op } = require('sequelize');
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
  createVendor,
  getVendorById,
  updateVendor,
  deleteVendor,
};
