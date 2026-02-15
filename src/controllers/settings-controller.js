const { getModels } = require('../sequelize');
const {
  getCacheEnabled,
  setCacheEnabled,
} = require('../services/cache-service');

function isSuperuser(req) {
  const roleCodes = req.auth?.roleCodes || [];
  return roleCodes.some((code) => String(code || '').toLowerCase() === 'superuser');
}

async function getCacheSetting(req, res) {
  try {
    if (!isSuperuser(req)) {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'Only superuser can access cache settings.',
      });
    }

    const models = getModels();
    if (!models || !models.AppSetting) {
      return res.status(503).json({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Database models are not ready yet.',
      });
    }

    const setting = await models.AppSetting.findOne({
      where: { key: 'cache_enabled' },
    });

    const enabled = setting?.valueBoolean === undefined || setting?.valueBoolean === null
      ? getCacheEnabled()
      : Boolean(setting.valueBoolean);

    return res.status(200).json({
      code: 'SUCCESS',
      message: 'Cache setting fetched successfully.',
      data: {
        key: 'cache_enabled',
        enabled,
      },
    });
  } catch (err) {
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'Unable to fetch cache setting.',
    });
  }
}

async function updateCacheSetting(req, res) {
  try {
    if (!isSuperuser(req)) {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'Only superuser can update cache settings.',
      });
    }

    const models = getModels();
    if (!models || !models.AppSetting) {
      return res.status(503).json({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Database models are not ready yet.',
      });
    }

    const enabled = req.body?.enabled;
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        message: 'enabled must be a boolean.',
      });
    }

    const [setting, created] = await models.AppSetting.findOrCreate({
      where: { key: 'cache_enabled' },
      defaults: {
        key: 'cache_enabled',
        valueBoolean: enabled,
        description: 'Global toggle for Redis API response cache',
        updatedBy: req.auth?.userId || null,
      },
    });

    if (!created) {
      await setting.update({
        valueBoolean: enabled,
        updatedBy: req.auth?.userId || null,
      });
    }

    await setCacheEnabled(enabled);

    return res.status(200).json({
      code: 'SUCCESS',
      message: `Cache ${enabled ? 'enabled' : 'disabled'} successfully.`,
      data: {
        key: 'cache_enabled',
        enabled,
      },
    });
  } catch (err) {
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'Unable to update cache setting.',
    });
  }
}

module.exports = {
  getCacheSetting,
  updateCacheSetting,
};
