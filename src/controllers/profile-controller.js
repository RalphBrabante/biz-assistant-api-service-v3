const { getModels } = require('../sequelize');

function sanitizeUser(user) {
  const json = user.toJSON();
  delete json.password;
  return json;
}

function optionalString(value) {
  const cleaned = String(value || '').trim();
  return cleaned || undefined;
}

function resolveUploadedProfileImage(req) {
  if (!req || !req.file || !req.file.filename) {
    return undefined;
  }
  return `/uploads/profiles/${req.file.filename}`;
}

function buildProfilePayload(req) {
  const body = req.body || {};
  const payload = {
    firstName: optionalString(body.firstName),
    lastName: optionalString(body.lastName),
    email: optionalString(body.email),
    phone: optionalString(body.phone),
    addressLine1: optionalString(body.addressLine1),
    addressLine2: optionalString(body.addressLine2),
    city: optionalString(body.city),
    state: optionalString(body.state),
    postalCode: optionalString(body.postalCode),
    country: optionalString(body.country),
  };

  const password = optionalString(body.password);
  if (password) {
    payload.password = password;
  }

  const uploadedImage = resolveUploadedProfileImage(req);
  if (uploadedImage) {
    payload.profileImageUrl = uploadedImage;
  }

  if (payload.email) {
    payload.email = payload.email.toLowerCase();
  }

  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined)
  );
}

async function getMyProfile(req, res) {
  try {
    const models = getModels();
    if (!models || !models.User) {
      return res.status(503).json({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Database models are not ready yet.',
      });
    }

    const userId = String(req.auth?.userId || '').trim();
    if (!userId) {
      return res.status(401).json({
        code: 'UNAUTHORIZED',
        message: 'Authentication required.',
      });
    }

    const user = await models.User.findByPk(userId);
    if (!user) {
      return res.status(404).json({
        code: 'NOT_FOUND',
        message: 'User not found.',
      });
    }

    return res.status(200).json({
      code: 'SUCCESS',
      message: 'Profile fetched successfully.',
      data: sanitizeUser(user),
    });
  } catch (err) {
    return res.status(500).json({
      code: 'PROFILE_FETCH_ERROR',
      message: 'Unable to fetch profile.',
    });
  }
}

async function updateMyProfile(req, res) {
  try {
    const models = getModels();
    if (!models || !models.User) {
      return res.status(503).json({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Database models are not ready yet.',
      });
    }

    const userId = String(req.auth?.userId || '').trim();
    if (!userId) {
      return res.status(401).json({
        code: 'UNAUTHORIZED',
        message: 'Authentication required.',
      });
    }

    const user = await models.User.findByPk(userId);
    if (!user) {
      return res.status(404).json({
        code: 'NOT_FOUND',
        message: 'User not found.',
      });
    }

    const payload = buildProfilePayload(req);
    if (Object.keys(payload).length === 0) {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'No valid profile fields were provided.',
      });
    }

    await user.update(payload);

    return res.status(200).json({
      code: 'SUCCESS',
      message: 'Profile updated successfully.',
      data: sanitizeUser(user),
    });
  } catch (err) {
    return res.status(500).json({
      code: 'PROFILE_UPDATE_ERROR',
      message: 'Unable to update profile.',
    });
  }
}

module.exports = {
  getMyProfile,
  updateMyProfile,
};
