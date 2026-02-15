const { Op } = require('sequelize');
const { randomUUID } = require('crypto');
const { getModels } = require('../sequelize');
const {
  isPrivilegedRequest,
  getAuthenticatedOrganizationId,
  applyOrganizationWhereScope,
} = require('../services/request-scope');

function getLicenseModel() {
  const models = getModels();
  if (!models || !models.License) {
    return null;
  }
  return models.License;
}

function pickLicensePayload(body = {}) {
  const organizationId =
    body.organizationId === null || body.organizationId === ''
      ? null
      : body.organizationId;

  return {
    organizationId,
    key: body.key ?? body.licenseKey,
    planName: body.planName ?? body.plan,
    status: body.status,
    startsAt: body.startsAt,
    expiresAt: body.expiresAt,
    revokedAt: body.revokedAt,
    maxUsers: body.maxUsers,
    isActive: body.isActive,
    notes: body.notes,
  };
}

function isUuidV4(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || '').trim()
  );
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

async function createLicense(req, res) {
  try {
    const License = getLicenseModel();
    if (!License) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const payload = cleanUndefined(pickLicensePayload(req.body));
    if (!isPrivilegedRequest(req)) {
      payload.organizationId = getAuthenticatedOrganizationId(req);
    }

    if (!payload.key) {
      payload.key = randomUUID();
    }
    if (!isUuidV4(payload.key)) {
      return res.status(400).json({ ok: false, message: 'key must be a valid UUID v4.' });
    }
    if (!payload.expiresAt) {
      return res.status(400).json({ ok: false, message: 'expiresAt is required.' });
    }

    const license = await License.create(payload);
    return res.status(201).json({ ok: true, data: license });
  } catch (err) {
    console.error('Create license error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to create license.' });
  }
}

async function listLicenses(req, res) {
  try {
    const License = getLicenseModel();
    if (!License) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

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
    if (req.query.unassigned === 'true') where.organizationId = null;
    if (req.query.planName) where.planName = req.query.planName;
    if (req.query.plan) where.planName = req.query.plan;
    if (req.query.status) where.status = req.query.status;

    const isActive = parseBoolean(req.query.isActive);
    if (isActive !== undefined) where.isActive = isActive;

    if (req.query.expired === 'true') {
      where.expiresAt = { [Op.lt]: new Date() };
    }
    if (req.query.expired === 'false') {
      where.expiresAt = { [Op.gte]: new Date() };
    }

    if (req.query.q) {
      where[Op.or] = [
        { key: { [Op.like]: `%${req.query.q}%` } },
        { planName: { [Op.like]: `%${req.query.q}%` } },
        { status: { [Op.like]: `%${req.query.q}%` } },
      ];
    }

    const { rows, count } = await License.findAndCountAll({
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
    console.error('List licenses error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to fetch licenses.' });
  }
}

async function getLicenseById(req, res) {
  try {
    const License = getLicenseModel();
    if (!License) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const where = { id: req.params.id };
    if (!isPrivilegedRequest(req)) {
      const scopedWhere = applyOrganizationWhereScope(where, req);
      if (!scopedWhere) {
        return res.status(404).json({ ok: false, message: 'License not found.' });
      }
    }

    const license = await License.findOne({ where });
    if (!license) {
      return res.status(404).json({ ok: false, message: 'License not found.' });
    }

    return res.status(200).json({ ok: true, data: license });
  } catch (err) {
    console.error('Get license error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to fetch license.' });
  }
}

async function updateLicense(req, res) {
  try {
    const License = getLicenseModel();
    if (!License) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const where = { id: req.params.id };
    if (!isPrivilegedRequest(req)) {
      const scopedWhere = applyOrganizationWhereScope(where, req);
      if (!scopedWhere) {
        return res.status(404).json({ ok: false, message: 'License not found.' });
      }
    }
    const license = await License.findOne({ where });
    if (!license) {
      return res.status(404).json({ ok: false, message: 'License not found.' });
    }

    const payload = cleanUndefined(pickLicensePayload(req.body));
    if (payload.key !== undefined) {
      return res.status(400).json({ ok: false, message: 'License key is immutable and cannot be updated.' });
    }
    if (Object.keys(payload).length === 0) {
      return res.status(400).json({ ok: false, message: 'No valid fields provided for update.' });
    }

    await license.update(payload);
    return res.status(200).json({ ok: true, data: license });
  } catch (err) {
    console.error('Update license error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to update license.' });
  }
}

async function deleteLicense(req, res) {
  try {
    const License = getLicenseModel();
    if (!License) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const where = { id: req.params.id };
    if (!isPrivilegedRequest(req)) {
      const scopedWhere = applyOrganizationWhereScope(where, req);
      if (!scopedWhere) {
        return res.status(404).json({ ok: false, message: 'License not found.' });
      }
    }
    const license = await License.findOne({ where });
    if (!license) {
      return res.status(404).json({ ok: false, message: 'License not found.' });
    }

    await license.destroy();
    return res.status(200).json({ ok: true, message: 'License deleted successfully.' });
  } catch (err) {
    console.error('Delete license error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to delete license.' });
  }
}

async function revokeLicense(req, res) {
  try {
    const License = getLicenseModel();
    if (!License) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const where = { id: req.params.id };
    if (!isPrivilegedRequest(req)) {
      const scopedWhere = applyOrganizationWhereScope(where, req);
      if (!scopedWhere) {
        return res.status(404).json({ ok: false, message: 'License not found.' });
      }
    }
    const license = await License.findOne({ where });
    if (!license) {
      return res.status(404).json({ ok: false, message: 'License not found.' });
    }

    if (license.status === 'revoked') {
      return res.status(200).json({ ok: true, message: 'License is already revoked.', data: license });
    }

    await license.update({
      status: 'revoked',
      isActive: false,
      revokedAt: new Date(),
    });

    return res.status(200).json({ ok: true, message: 'License revoked successfully.', data: license });
  } catch (err) {
    console.error('Revoke license error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to revoke license.' });
  }
}

module.exports = {
  createLicense,
  listLicenses,
  getLicenseById,
  updateLicense,
  deleteLicense,
  revokeLicense,
};
