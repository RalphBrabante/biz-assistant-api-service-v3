const crypto = require('crypto');
const { getModels } = require('../sequelize');
const {
  sendPasswordResetEmail,
  sendEmailVerificationEmail,
} = require('../services/email-service');

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
      include: models.Role
        ? [
            {
              model: models.Role,
              as: 'roles',
              through: { attributes: [] },
              include: models.Permission
                ? [
                    {
                      model: models.Permission,
                      as: 'permissions',
                      through: { attributes: [] },
                    },
                  ]
                : [],
            },
          ]
        : [],
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

    const roleCodes = (user.roles || []).map((role) =>
      String(role.code || '').toLowerCase()
    );
    const permissionCodes = [];
    for (const role of user.roles || []) {
      for (const permission of role.permissions || []) {
        const code = String(permission.code || '').toLowerCase();
        if (code && !permissionCodes.includes(code)) {
          permissionCodes.push(code);
        }
      }
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
          profileImageUrl: user.profileImageUrl,
          status: user.status,
          isEmailVerified: user.isEmailVerified,
          organizationId: user.organizationId,
          currency: organizationCurrency,
          roleCodes,
          permissionCodes,
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

function buildResetPasswordUrl(rawToken) {
  const appBaseUrl = String(process.env.APP_BASE_URL || 'http://localhost').trim();
  const resetPath = String(process.env.RESET_PASSWORD_PATH || '/reset-password').trim();
  const safePath = resetPath.startsWith('/') ? resetPath : `/${resetPath}`;
  const separator = safePath.includes('?') ? '&' : '?';
  return `${appBaseUrl.replace(/\/+$/, '')}${safePath}${separator}token=${encodeURIComponent(rawToken)}`;
}

function buildVerifyEmailUrl(rawToken) {
  const appBaseUrl = String(process.env.APP_BASE_URL || 'http://localhost').trim();
  const verifyPath = String(process.env.VERIFY_EMAIL_PATH || '/verify-email').trim();
  const safePath = verifyPath.startsWith('/') ? verifyPath : `/${verifyPath}`;
  const separator = safePath.includes('?') ? '&' : '?';
  return `${appBaseUrl.replace(/\/+$/, '')}${safePath}${separator}token=${encodeURIComponent(rawToken)}`;
}

function isValidNewPassword(password) {
  const value = String(password || '');
  if (value.length < 8) {
    return false;
  }
  const hasUpper = /[A-Z]/.test(value);
  const hasLower = /[a-z]/.test(value);
  const hasNumber = /[0-9]/.test(value);
  return hasUpper && hasLower && hasNumber;
}

async function forgotPassword(req, res) {
  try {
    const models = getModels();
    if (!models) {
      return res.status(503).json({
        ok: false,
        message: 'Database models are not ready yet.',
      });
    }

    const normalizedEmail = String(req.body?.email || '').toLowerCase().trim();
    if (!normalizedEmail) {
      return res.status(400).json({
        ok: false,
        message: 'email is required.',
      });
    }

    const genericMessage =
      'If an account exists for that email, a password reset link has been sent.';

    const user = await models.User.findOne({
      where: { email: normalizedEmail },
    });

    if (!user || !user.isActive) {
      return res.status(200).json({
        ok: true,
        message: genericMessage,
      });
    }

    await models.Token.update(
      {
        isActive: false,
        revokedAt: new Date(),
        revokedReason: 'superseded_reset_request',
      },
      {
        where: {
          userId: user.id,
          type: 'reset_password',
          isActive: true,
          revokedAt: null,
        },
      }
    );

    const rawToken = crypto.randomBytes(48).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresInMinutes = Number(process.env.PASSWORD_RESET_EXPIRES_MINUTES || 30);
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);

    await models.Token.create({
      userId: user.id,
      tokenHash,
      type: 'reset_password',
      scope: 'password_reset',
      expiresAt,
      ipAddress: req.ip || null,
      userAgent: req.get('user-agent') || null,
      metadata: {
        email: user.email,
      },
      isActive: true,
    });

    const resetUrl = buildResetPasswordUrl(rawToken);
    await sendPasswordResetEmail({
      toEmail: user.email,
      toName: [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.email,
      resetUrl,
      expiresInMinutes,
    });

    return res.status(200).json({
      ok: true,
      message: genericMessage,
    });
  } catch (err) {
    console.error('Forgot password error:', err);
    return res.status(500).json({
      ok: false,
      message: 'Unable to process forgot password request.',
    });
  }
}

async function resetPassword(req, res) {
  try {
    const models = getModels();
    if (!models) {
      return res.status(503).json({
        ok: false,
        message: 'Database models are not ready yet.',
      });
    }

    const token = String(req.body?.token || '').trim();
    const newPassword = String(req.body?.newPassword || '');
    const confirmPassword = String(req.body?.confirmPassword || '');

    if (!token) {
      return res.status(400).json({
        ok: false,
        message: 'token is required.',
      });
    }
    if (!newPassword) {
      return res.status(400).json({
        ok: false,
        message: 'newPassword is required.',
      });
    }
    if (confirmPassword && newPassword !== confirmPassword) {
      return res.status(400).json({
        ok: false,
        message: 'Password confirmation does not match.',
      });
    }
    if (!isValidNewPassword(newPassword)) {
      return res.status(400).json({
        ok: false,
        message:
          'Password must be at least 8 characters and include uppercase, lowercase, and a number.',
      });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const tokenRecord = await models.Token.findOne({
      where: {
        tokenHash,
        type: 'reset_password',
        isActive: true,
        revokedAt: null,
      },
      include: [
        {
          model: models.User,
          as: 'user',
        },
      ],
    });

    if (!tokenRecord || !tokenRecord.user) {
      return res.status(400).json({
        ok: false,
        message: 'Reset token is invalid or expired.',
      });
    }

    if (new Date(tokenRecord.expiresAt) <= new Date()) {
      await tokenRecord.update({
        isActive: false,
        revokedAt: new Date(),
        revokedReason: 'expired',
      });
      return res.status(400).json({
        ok: false,
        message: 'Reset token is invalid or expired.',
      });
    }

    const user = tokenRecord.user;
    if (!user.isActive) {
      return res.status(403).json({
        ok: false,
        message: 'User is inactive.',
      });
    }

    await user.update({ password: newPassword });

    await models.Token.update(
      {
        isActive: false,
        revokedAt: new Date(),
        revokedReason: 'password_reset_completed',
      },
      {
        where: {
          userId: user.id,
          type: 'reset_password',
          isActive: true,
          revokedAt: null,
        },
      }
    );

    return res.status(200).json({
      ok: true,
      message: 'Password reset successful. You can now sign in.',
    });
  } catch (err) {
    console.error('Reset password error:', err);
    return res.status(500).json({
      ok: false,
      message: 'Unable to reset password.',
    });
  }
}

async function requestEmailVerification(req, res) {
  try {
    const models = getModels();
    if (!models) {
      return res.status(503).json({
        ok: false,
        message: 'Database models are not ready yet.',
      });
    }

    const normalizedEmail = String(req.body?.email || '').toLowerCase().trim();
    if (!normalizedEmail) {
      return res.status(400).json({
        ok: false,
        message: 'email is required.',
      });
    }

    const genericMessage =
      'If an account exists for that email, a verification link has been sent.';

    const user = await models.User.findOne({
      where: { email: normalizedEmail },
    });

    if (!user || !user.isActive || user.isEmailVerified) {
      return res.status(200).json({
        ok: true,
        message: genericMessage,
      });
    }

    await models.Token.update(
      {
        isActive: false,
        revokedAt: new Date(),
        revokedReason: 'superseded_verify_email_request',
      },
      {
        where: {
          userId: user.id,
          type: 'verify_email',
          isActive: true,
          revokedAt: null,
        },
      }
    );

    const rawToken = crypto.randomBytes(48).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresInMinutes = Number(process.env.VERIFY_EMAIL_EXPIRES_MINUTES || 60);
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);

    await models.Token.create({
      userId: user.id,
      tokenHash,
      type: 'verify_email',
      scope: 'email_verification',
      expiresAt,
      ipAddress: req.ip || null,
      userAgent: req.get('user-agent') || null,
      metadata: {
        email: user.email,
      },
      isActive: true,
    });

    const verifyUrl = buildVerifyEmailUrl(rawToken);
    await sendEmailVerificationEmail({
      toEmail: user.email,
      toName: [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.email,
      verifyUrl,
      expiresInMinutes,
    });

    return res.status(200).json({
      ok: true,
      message: genericMessage,
    });
  } catch (err) {
    console.error('Request email verification error:', err);
    return res.status(500).json({
      ok: false,
      message: 'Unable to process verification request.',
    });
  }
}

async function verifyEmail(req, res) {
  try {
    const models = getModels();
    if (!models) {
      return res.status(503).json({
        ok: false,
        message: 'Database models are not ready yet.',
      });
    }

    const token = String(req.body?.token || '').trim();
    if (!token) {
      return res.status(400).json({
        ok: false,
        message: 'token is required.',
      });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const tokenRecord = await models.Token.findOne({
      where: {
        tokenHash,
        type: 'verify_email',
        isActive: true,
        revokedAt: null,
      },
      include: [
        {
          model: models.User,
          as: 'user',
        },
      ],
    });

    if (!tokenRecord || !tokenRecord.user) {
      return res.status(400).json({
        ok: false,
        message: 'Verification token is invalid or expired.',
      });
    }

    if (new Date(tokenRecord.expiresAt) <= new Date()) {
      await tokenRecord.update({
        isActive: false,
        revokedAt: new Date(),
        revokedReason: 'expired',
      });
      return res.status(400).json({
        ok: false,
        message: 'Verification token is invalid or expired.',
      });
    }

    const user = tokenRecord.user;
    await user.update({
      isEmailVerified: true,
      emailVerifiedAt: new Date(),
      status: user.status === 'pending_verification' ? 'active' : user.status,
    });

    await models.Token.update(
      {
        isActive: false,
        revokedAt: new Date(),
        revokedReason: 'email_verified',
      },
      {
        where: {
          userId: user.id,
          type: 'verify_email',
          isActive: true,
          revokedAt: null,
        },
      }
    );

    return res.status(200).json({
      ok: true,
      message: 'Email verified successfully. You can now sign in.',
    });
  } catch (err) {
    console.error('Verify email error:', err);
    return res.status(500).json({
      ok: false,
      message: 'Unable to verify email.',
    });
  }
}

module.exports = {
  login,
  forgotPassword,
  resetPassword,
  requestEmailVerification,
  verifyEmail,
};
