const { getModels } = require('../sequelize');
const {
  getRedisClient,
  getCacheEnabled,
} = require('../services/cache-service');

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

async function inspectDevCache(req, res) {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'This endpoint is available only in development.',
      });
    }

    const redisClient = getRedisClient();
    if (!redisClient) {
      return res.status(503).json({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Redis cache is not connected.',
      });
    }

    const keys = [];
    const patterns = ['cache:*', 'api_cache:*'];

    for (const pattern of patterns) {
      let cursor = '0';
      do {
        // eslint-disable-next-line no-await-in-loop
        const [nextCursor, matchedKeys] = await redisClient.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          500
        );
        cursor = nextCursor;
        if (matchedKeys && matchedKeys.length > 0) {
          keys.push(...matchedKeys);
        }
      } while (cursor !== '0');
    }

    const uniqueKeys = Array.from(new Set(keys)).sort((a, b) => a.localeCompare(b));
    const values = [];
    for (const key of uniqueKeys) {
      // eslint-disable-next-line no-await-in-loop
      const type = await redisClient.type(key);
      if (type !== 'string') {
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      const rawValue = await redisClient.get(key);
      let parsedValue = rawValue;
      try {
        parsedValue = JSON.parse(rawValue);
      } catch (err) {
        // keep raw value
      }

      values.push({
        key,
        value: parsedValue,
      });
    }

    return res.status(200).json({
      code: 'SUCCESS',
      message: 'Cache data retrieved successfully.',
      data: {
        enabled: getCacheEnabled(),
        totalKeys: values.length,
        entries: values,
      },
    });
  } catch (err) {
    return res.status(500).json({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Unable to inspect cache.',
    });
  }
}

module.exports = {
  createDevUser,
  inspectDevCache,
};
