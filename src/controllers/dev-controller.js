const { getModels } = require('../sequelize');

function cleanUndefined(payload) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined)
  );
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

function sanitizeUser(user) {
  const json = user.toJSON();
  delete json.password;
  return json;
}

async function createDevUser(req, res) {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'This endpoint is available only in development.',
      });
    }

    const models = getModels();
    if (!models || !models.User) {
      return res.status(503).json({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Database models are not ready yet.',
      });
    }

    const payload = cleanUndefined(pickUserPayload(req.body));
    if (payload.email) {
      payload.email = String(payload.email).toLowerCase().trim();
    }

    if (!payload.firstName) {
      return res.status(400).json({ code: 'BAD_REQUEST', message: 'firstName is required.' });
    }
    if (!payload.lastName) {
      return res.status(400).json({ code: 'BAD_REQUEST', message: 'lastName is required.' });
    }
    if (!payload.email) {
      return res.status(400).json({ code: 'BAD_REQUEST', message: 'email is required.' });
    }
    if (!payload.password) {
      return res.status(400).json({ code: 'BAD_REQUEST', message: 'password is required.' });
    }

    const user = await models.User.create(payload);
    return res.status(201).json({
      code: 'CREATED',
      message: 'Dev user created successfully.',
      data: sanitizeUser(user),
    });
  } catch (err) {
    return res.status(500).json({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Unable to create development user.',
    });
  }
}

module.exports = {
  createDevUser,
};
