const { Op } = require('sequelize');
const { getModels } = require('../sequelize');

function getUserModel() {
  const models = getModels();
  if (!models || !models.User) {
    return null;
  }
  return models.User;
}

function pickUserPayload(body = {}) {
  return {
    organizationId: body.organizationId,
    firstName: body.firstName,
    lastName: body.lastName,
    email: body.email,
    password: body.password,
    phone: body.phone,
    addressLine1: body.addressLine1,
    addressLine2: body.addressLine2,
    city: body.city,
    state: body.state,
    postalCode: body.postalCode,
    country: body.country,
    role: body.role,
    status: body.status,
    isEmailVerified: body.isEmailVerified,
    emailVerifiedAt: body.emailVerifiedAt,
    isActive: body.isActive,
    lastLoginAt: body.lastLoginAt,
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

function sanitizeUser(user) {
  const json = user.toJSON();
  delete json.password;
  return json;
}

async function createUser(req, res) {
  try {
    const User = getUserModel();
    if (!User) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const payload = cleanUndefined(pickUserPayload(req.body));
    if (payload.email) {
      payload.email = String(payload.email).toLowerCase().trim();
    }

    if (!payload.firstName) {
      return res.status(400).json({ ok: false, message: 'firstName is required.' });
    }
    if (!payload.lastName) {
      return res.status(400).json({ ok: false, message: 'lastName is required.' });
    }
    if (!payload.email) {
      return res.status(400).json({ ok: false, message: 'email is required.' });
    }
    if (!payload.password) {
      return res.status(400).json({ ok: false, message: 'password is required.' });
    }

    const user = await User.create(payload);
    return res.status(201).json({ ok: true, data: sanitizeUser(user) });
  } catch (err) {
    console.error('Create user error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to create user.' });
  }
}

async function listUsers(req, res) {
  try {
    const User = getUserModel();
    if (!User) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 100);
    const offset = (page - 1) * limit;

    const where = {};
    if (req.query.organizationId) where.organizationId = req.query.organizationId;
    if (req.query.status) where.status = req.query.status;
    if (req.query.role) where.role = req.query.role;

    const isActive = parseBoolean(req.query.isActive);
    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    const isEmailVerified = parseBoolean(req.query.isEmailVerified);
    if (isEmailVerified !== undefined) {
      where.isEmailVerified = isEmailVerified;
    }

    if (req.query.q) {
      where[Op.or] = [
        { firstName: { [Op.like]: `%${req.query.q}%` } },
        { lastName: { [Op.like]: `%${req.query.q}%` } },
        { email: { [Op.like]: `%${req.query.q}%` } },
      ];
    }

    const { rows, count } = await User.findAndCountAll({
      where,
      limit,
      offset,
      order: [['createdAt', 'DESC']],
    });

    return res.status(200).json({
      ok: true,
      data: rows.map(sanitizeUser),
      meta: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit),
      },
    });
  } catch (err) {
    console.error('List users error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to fetch users.' });
  }
}

async function getUserById(req, res) {
  try {
    const User = getUserModel();
    if (!User) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const user = await User.findByPk(req.params.id);
    if (!user) {
      return res.status(404).json({ ok: false, message: 'User not found.' });
    }

    return res.status(200).json({ ok: true, data: sanitizeUser(user) });
  } catch (err) {
    console.error('Get user error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to fetch user.' });
  }
}

async function updateUser(req, res) {
  try {
    const User = getUserModel();
    if (!User) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const user = await User.findByPk(req.params.id);
    if (!user) {
      return res.status(404).json({ ok: false, message: 'User not found.' });
    }

    const payload = cleanUndefined(pickUserPayload(req.body));
    if (payload.email) {
      payload.email = String(payload.email).toLowerCase().trim();
    }
    if (Object.keys(payload).length === 0) {
      return res.status(400).json({ ok: false, message: 'No valid fields provided for update.' });
    }

    await user.update(payload);
    return res.status(200).json({ ok: true, data: sanitizeUser(user) });
  } catch (err) {
    console.error('Update user error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to update user.' });
  }
}

async function deleteUser(req, res) {
  try {
    const User = getUserModel();
    if (!User) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const user = await User.findByPk(req.params.id);
    if (!user) {
      return res.status(404).json({ ok: false, message: 'User not found.' });
    }

    await user.destroy();
    return res.status(200).json({ ok: true, message: 'User deleted successfully.' });
  } catch (err) {
    console.error('Delete user error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to delete user.' });
  }
}

module.exports = {
  createUser,
  listUsers,
  getUserById,
  updateUser,
  deleteUser,
};
