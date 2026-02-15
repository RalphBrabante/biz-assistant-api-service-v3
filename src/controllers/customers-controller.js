const { Op } = require('sequelize');
const { getModels } = require('../sequelize');
const {
  isPrivilegedRequest,
  getAuthenticatedOrganizationId,
  applyOrganizationWhereScope,
} = require('../services/request-scope');

function getCustomerModels() {
  const models = getModels();
  if (!models || !models.Customer || !models.Organization) {
    return null;
  }
  return {
    Customer: models.Customer,
    Organization: models.Organization,
  };
}

function pickCustomerPayload(body = {}) {
  return {
    organizationId: body.organizationId,
    customerCode: body.customerCode,
    type: body.type,
    name: body.name,
    legalName: body.legalName,
    taxId: body.taxId,
    contactPerson: body.contactPerson,
    email: body.email,
    phone: body.phone,
    mobile: body.mobile,
    addressLine1: body.addressLine1,
    addressLine2: body.addressLine2,
    city: body.city,
    state: body.state,
    postalCode: body.postalCode,
    country: body.country,
    creditLimit: body.creditLimit,
    paymentTermsDays: body.paymentTermsDays,
    status: body.status,
    notes: body.notes,
    createdBy: body.createdBy,
    updatedBy: body.updatedBy,
    isActive: body.isActive,
  };
}

function cleanUndefined(payload) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined)
  );
}

function parseBoolean(value) {
  if (value === true || value === 'true' || value === 1 || value === '1') {
    return true;
  }
  if (value === false || value === 'false' || value === 0 || value === '0') {
    return false;
  }
  return undefined;
}

async function createCustomer(req, res) {
  try {
    const models = getCustomerModels();
    if (!models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const { Customer } = models;
    const payload = cleanUndefined(pickCustomerPayload(req.body));
    if (payload.email) {
      payload.email = String(payload.email).toLowerCase().trim();
    }
    if (!isPrivilegedRequest(req)) {
      payload.organizationId = getAuthenticatedOrganizationId(req);
    }

    if (!payload.organizationId) {
      return res.status(400).json({ ok: false, message: 'organizationId is required.' });
    }
    if (!payload.name) {
      return res.status(400).json({ ok: false, message: 'name is required.' });
    }
    if (!payload.taxId) {
      return res.status(400).json({ ok: false, message: 'taxId is required.' });
    }

    const customer = await Customer.create(payload);
    return res.status(201).json({ ok: true, data: customer });
  } catch (err) {
    console.error('Create customer error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to create customer.' });
  }
}

async function listCustomers(req, res) {
  try {
    const models = getCustomerModels();
    if (!models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const { Customer } = models;
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
    if (req.query.type) where.type = req.query.type;
    if (req.query.status) where.status = req.query.status;

    const isActive = parseBoolean(req.query.isActive);
    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    if (req.query.q) {
      where[Op.or] = [
        { name: { [Op.like]: `%${req.query.q}%` } },
        { legalName: { [Op.like]: `%${req.query.q}%` } },
        { taxId: { [Op.like]: `%${req.query.q}%` } },
        { customerCode: { [Op.like]: `%${req.query.q}%` } },
        { email: { [Op.like]: `%${req.query.q}%` } },
        { contactPerson: { [Op.like]: `%${req.query.q}%` } },
      ];
    }

    const { rows, count } = await Customer.findAndCountAll({
      where,
      include: [
        {
          association: 'organization',
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
    console.error('List customers error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to fetch customers.' });
  }
}

async function getCustomerById(req, res) {
  try {
    const models = getCustomerModels();
    if (!models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const { Customer } = models;
    const where = { id: req.params.id };
    if (!isPrivilegedRequest(req)) {
      const scopedWhere = applyOrganizationWhereScope(where, req);
      if (!scopedWhere) {
        return res.status(404).json({ ok: false, message: 'Customer not found.' });
      }
    }

    const customer = await Customer.findOne({
      where,
      include: [
        {
          association: 'organization',
          attributes: ['id', 'name', 'legalName'],
          required: false,
        },
      ],
    });
    if (!customer) {
      return res.status(404).json({ ok: false, message: 'Customer not found.' });
    }

    return res.status(200).json({ ok: true, data: customer });
  } catch (err) {
    console.error('Get customer error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to fetch customer.' });
  }
}

async function updateCustomer(req, res) {
  try {
    const models = getCustomerModels();
    if (!models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const { Customer } = models;
    const where = { id: req.params.id };
    if (!isPrivilegedRequest(req)) {
      const scopedWhere = applyOrganizationWhereScope(where, req);
      if (!scopedWhere) {
        return res.status(404).json({ ok: false, message: 'Customer not found.' });
      }
    }
    const customer = await Customer.findOne({ where });
    if (!customer) {
      return res.status(404).json({ ok: false, message: 'Customer not found.' });
    }

    const payload = cleanUndefined(pickCustomerPayload(req.body));
    if (payload.email) {
      payload.email = String(payload.email).toLowerCase().trim();
    }
    if (Object.keys(payload).length === 0) {
      return res.status(400).json({ ok: false, message: 'No valid fields provided for update.' });
    }

    if (!isPrivilegedRequest(req)) {
      delete payload.organizationId;
    }

    await customer.update(payload);

    const updated = await Customer.findByPk(customer.id, {
      include: [
        {
          association: 'organization',
          attributes: ['id', 'name', 'legalName'],
          required: false,
        },
      ],
    });

    return res.status(200).json({ ok: true, data: updated || customer });
  } catch (err) {
    console.error('Update customer error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to update customer.' });
  }
}

async function deleteCustomer(req, res) {
  try {
    const models = getCustomerModels();
    if (!models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const { Customer } = models;
    const where = { id: req.params.id };
    if (!isPrivilegedRequest(req)) {
      const scopedWhere = applyOrganizationWhereScope(where, req);
      if (!scopedWhere) {
        return res.status(404).json({ ok: false, message: 'Customer not found.' });
      }
    }
    const customer = await Customer.findOne({ where });
    if (!customer) {
      return res.status(404).json({ ok: false, message: 'Customer not found.' });
    }

    await customer.destroy();
    return res.status(200).json({ ok: true, message: 'Customer deleted successfully.' });
  } catch (err) {
    console.error('Delete customer error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to delete customer.' });
  }
}

module.exports = {
  createCustomer,
  listCustomers,
  getCustomerById,
  updateCustomer,
  deleteCustomer,
};
