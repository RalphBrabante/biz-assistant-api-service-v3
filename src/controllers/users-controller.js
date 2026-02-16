const { Op } = require('sequelize');
const { getModels } = require('../sequelize');
const {
  isPrivilegedRequest,
  getAuthenticatedOrganizationId,
  applyOrganizationWhereScope,
} = require('../services/request-scope');

function getUserModel() {
  const models = getModels();
  if (!models || !models.User) {
    return null;
  }
  return models.User;
}

function getUserRoleModels() {
  const models = getModels();
  if (!models || !models.User || !models.Role || !models.UserRole) {
    return null;
  }
  return {
    User: models.User,
    Role: models.Role,
    UserRole: models.UserRole,
  };
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
    if (!isPrivilegedRequest(req)) {
      payload.organizationId = getAuthenticatedOrganizationId(req);
    }
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
    const models = getModels();
    if (!models || !models.User || !models.Organization) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }
    const { User, Organization } = models;

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
      include: [
        {
          model: Organization,
          as: 'primaryOrganization',
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
    const models = getUserRoleModels();
    if (!models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }
    const { User, Role } = models;

    const where = { id: req.params.id };
    if (!isPrivilegedRequest(req)) {
      const scopedWhere = applyOrganizationWhereScope(where, req);
      if (!scopedWhere) {
        return res.status(404).json({ ok: false, message: 'User not found.' });
      }
    }

    const user = await User.findOne({
      where,
      include: [
        {
          model: Role,
          as: 'roles',
          through: { attributes: ['id', 'assignedByUserId', 'createdAt'] },
        },
      ],
    });
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

    const where = { id: req.params.id };
    if (!isPrivilegedRequest(req)) {
      const scopedWhere = applyOrganizationWhereScope(where, req);
      if (!scopedWhere) {
        return res.status(404).json({ ok: false, message: 'User not found.' });
      }
    }
    const user = await User.findOne({ where });
    if (!user) {
      return res.status(404).json({ ok: false, message: 'User not found.' });
    }

    const payload = cleanUndefined(pickUserPayload(req.body));
    if (!isPrivilegedRequest(req)) {
      delete payload.organizationId;
    }
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

    const where = { id: req.params.id };
    if (!isPrivilegedRequest(req)) {
      const scopedWhere = applyOrganizationWhereScope(where, req);
      if (!scopedWhere) {
        return res.status(404).json({ ok: false, message: 'User not found.' });
      }
    }
    const user = await User.findOne({ where });
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

async function listUserAssignableRoles(req, res) {
  try {
    const models = getUserRoleModels();
    if (!models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }
    const { User, Role } = models;

    const where = { id: req.params.id };
    if (!isPrivilegedRequest(req)) {
      const scopedWhere = applyOrganizationWhereScope(where, req);
      if (!scopedWhere) {
        return res.status(404).json({ ok: false, message: 'User not found.' });
      }
    }
    const user = await User.findOne({ where });
    if (!user) {
      return res.status(404).json({ ok: false, message: 'User not found.' });
    }

    const roles = await Role.findAll({
      where: { isActive: true },
      attributes: ['id', 'name', 'code', 'description'],
      order: [['name', 'ASC']],
    });

    return res.status(200).json({
      ok: true,
      data: roles,
      meta: { total: roles.length },
    });
  } catch (err) {
    console.error('List assignable roles error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to fetch assignable roles.' });
  }
}

async function addRoleToUser(req, res) {
  try {
    const models = getUserRoleModels();
    if (!models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }
    const { User, Role, UserRole } = models;

    const where = { id: req.params.id };
    if (!isPrivilegedRequest(req)) {
      const scopedWhere = applyOrganizationWhereScope(where, req);
      if (!scopedWhere) {
        return res.status(404).json({ ok: false, message: 'User not found.' });
      }
    }
    const user = await User.findOne({ where });
    if (!user) {
      return res.status(404).json({ ok: false, message: 'User not found.' });
    }

    const roleId = String(req.body?.roleId || '').trim();
    if (!roleId) {
      return res.status(400).json({ ok: false, message: 'roleId is required.' });
    }

    const role = await Role.findOne({ where: { id: roleId, isActive: true } });
    if (!role) {
      return res.status(404).json({ ok: false, message: 'Role not found or inactive.' });
    }

    const [membership] = await UserRole.findOrCreate({
      where: { userId: user.id, roleId: role.id },
      defaults: {
        assignedByUserId: req.auth?.user?.id || null,
      },
    });

    return res.status(201).json({
      ok: true,
      message: 'Role assigned to user successfully.',
      data: membership,
    });
  } catch (err) {
    console.error('Add role to user error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to assign role to user.' });
  }
}

async function removeRoleFromUser(req, res) {
  try {
    const models = getUserRoleModels();
    if (!models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }
    const { User, UserRole } = models;

    const where = { id: req.params.id };
    if (!isPrivilegedRequest(req)) {
      const scopedWhere = applyOrganizationWhereScope(where, req);
      if (!scopedWhere) {
        return res.status(404).json({ ok: false, message: 'User not found.' });
      }
    }
    const user = await User.findOne({ where });
    if (!user) {
      return res.status(404).json({ ok: false, message: 'User not found.' });
    }

    const roleId = String(req.params.roleId || '').trim();
    if (!roleId) {
      return res.status(400).json({ ok: false, message: 'roleId is required.' });
    }

    const membership = await UserRole.findOne({
      where: {
        userId: user.id,
        roleId,
      },
    });

    if (!membership) {
      return res.status(404).json({ ok: false, message: 'User role assignment not found.' });
    }

    await membership.destroy();
    return res.status(200).json({ ok: true, message: 'Role removed from user successfully.' });
  } catch (err) {
    console.error('Remove role from user error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to remove role from user.' });
  }
}

module.exports = {
  createUser,
  listUsers,
  getUserById,
  updateUser,
  deleteUser,
  listUserAssignableRoles,
  addRoleToUser,
  removeRoleFromUser,
};
