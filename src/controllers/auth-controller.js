const crypto = require('crypto');
const { getModels } = require('../sequelize');

function isUserAllowedToLogin(user) {
  if (!user || !user.isActive) {
    return { ok: false, reason: 'User is inactive.' };
  }

  if (user.status !== 'active') {
    if (!user.isEmailVerified) {
      return { ok: false, reason: 'Email is not verified yet.' };
    }
    return {
      ok: false,
      reason: `User status "${user.status}" is not allowed to log in.`,
    };
  }

  if (!user.isEmailVerified) {
    return { ok: false, reason: 'Email is not verified yet.' };
  }

  return { ok: true };
}

async function comparePassword(plainPassword, storedPassword) {
  try {
    // Support bcrypt hashes if bcryptjs is available.
    // Fallback to plain text comparison for existing simple records.
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    const bcrypt = require('bcryptjs');
    try {
      return await bcrypt.compare(plainPassword, storedPassword);
    } catch (err) {
      return plainPassword === storedPassword;
    }
  } catch (err) {
    return plainPassword === storedPassword;
  }
}

async function login(req, res) {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({
        ok: false,
        message: 'email and password are required.',
      });
    }

    const models = getModels();
    if (!models) {
      return res.status(503).json({
        ok: false,
        message: 'Database models are not ready yet.',
      });
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    const user = await models.User.findOne({
      where: { email: normalizedEmail },
    });

    const genericError = {
      ok: false,
      message: 'Invalid email or password.',
    };

    if (!user) {
      return res.status(401).json(genericError);
    }

    const passwordMatches = await comparePassword(password, user.password);
    if (!passwordMatches) {
      await models.InvalidLoginAttempt.create({
        userId: user.id,
        attemptedEmail: normalizedEmail,
        ipAddress: req.ip || null,
        userAgent: req.get('user-agent') || null,
        failureReason: 'invalid_password',
      });
      return res.status(401).json(genericError);
    }

    const loginAccess = isUserAllowedToLogin(user);
    if (!loginAccess.ok) {
      return res.status(403).json({
        ok: false,
        message: loginAccess.reason,
      });
    }

    const rawToken = crypto.randomBytes(48).toString('hex');
    const tokenHash = crypto
      .createHash('sha256')
      .update(rawToken)
      .digest('hex');
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24);

    await models.Token.create({
      userId: user.id,
      tokenHash,
      type: 'access',
      scope: 'user',
      expiresAt,
      ipAddress: req.ip || null,
      userAgent: req.get('user-agent') || null,
      metadata: {
        loginMethod: 'password',
      },
      isActive: true,
    });

    await user.update({
      lastLoginAt: new Date(),
    });

    let organizationCurrency = 'USD';
    if (user.organizationId && models.Organization) {
      const organization = await models.Organization.findByPk(user.organizationId, {
        attributes: ['id', 'currency'],
      });
      organizationCurrency = String(organization?.currency || 'USD').toUpperCase().slice(0, 3) || 'USD';
    }

    return res.status(200).json({
      ok: true,
      message: 'Login successful.',
      data: {
        accessToken: rawToken,
        tokenType: 'Bearer',
        expiresAt,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          status: user.status,
          isEmailVerified: user.isEmailVerified,
          organizationId: user.organizationId,
          currency: organizationCurrency,
        },
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({
      ok: false,
      message: 'Unable to process login request.',
    });
  }
}

module.exports = {
  login,
};
