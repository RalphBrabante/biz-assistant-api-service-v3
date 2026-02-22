const { getModels } = require('../sequelize');
const {
  getCacheEnabled,
  setCacheEnabled,
} = require('../services/cache-service');
const {
  STORAGE_KEYS,
  getStorageConfig,
  StorageProviderError,
} = require('../services/storage-service');

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

async function upsertTextSetting(AppSetting, key, value, description, updatedBy) {
  const [setting, created] = await AppSetting.findOrCreate({
    where: { key },
    defaults: {
      key,
      valueText: value,
      description,
      updatedBy,
    },
  });

  if (!created) {
    await setting.update({
      valueText: value,
      description: description || setting.description || null,
      updatedBy,
    });
  }
}

async function getStorageSetting(req, res) {
  try {
    if (!isSuperuser(req)) {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'Only superuser can access storage settings.',
      });
    }

    const config = await getStorageConfig();
    return res.status(200).json({
      code: 'SUCCESS',
      message: 'Storage setting fetched successfully.',
      data: {
        provider: config.provider,
        doSpaces: {
          endpoint: config.doSpaces.endpoint,
          region: config.doSpaces.region,
          bucket: config.doSpaces.bucket,
          accessKey: config.doSpaces.accessKey,
          secretKey: config.doSpaces.secretKey ? '********' : '',
          hasSecretKey: Boolean(config.doSpaces.secretKey),
          cdnBaseUrl: config.doSpaces.cdnBaseUrl,
          directory: config.doSpaces.directory,
        },
        isDoSpacesConfigured: config.isDoSpacesConfigured,
      },
    });
  } catch (err) {
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'Unable to fetch storage setting.',
    });
  }
}

async function updateStorageSetting(req, res) {
  try {
    if (!isSuperuser(req)) {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'Only superuser can update storage settings.',
      });
    }

    const models = getModels();
    if (!models || !models.AppSetting) {
      return res.status(503).json({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Database models are not ready yet.',
      });
    }

    const provider = String(req.body?.provider || 'local').trim().toLowerCase();
    if (!['local', 'do_spaces'].includes(provider)) {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        message: 'provider must be either local or do_spaces.',
      });
    }

    const doSpacesBody = req.body?.doSpaces || {};
    const endpoint = String(doSpacesBody.endpoint || '').trim();
    const region = String(doSpacesBody.region || '').trim();
    const bucket = String(doSpacesBody.bucket || '').trim();
    const accessKey = String(doSpacesBody.accessKey || '').trim();
    const secretKeyInput = String(doSpacesBody.secretKey || '').trim();
    const cdnBaseUrl = String(doSpacesBody.cdnBaseUrl || '').trim();
    const directory = String(doSpacesBody.directory || '').trim();

    if (provider === 'do_spaces') {
      if (!endpoint || !region || !bucket || !accessKey) {
        return res.status(400).json({
          code: 'BAD_REQUEST',
          message: 'DO Spaces endpoint, region, bucket, and accessKey are required.',
        });
      }
    }

    const { AppSetting } = models;
    const updatedBy = req.auth?.userId || null;

    const existingSecret = await AppSetting.findOne({
      where: { key: STORAGE_KEYS.secretKey },
      attributes: ['valueText'],
    });
    const finalSecret = secretKeyInput || String(existingSecret?.valueText || '').trim();
    if (provider === 'do_spaces' && !finalSecret) {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        message: 'DO Spaces secretKey is required.',
      });
    }

    await upsertTextSetting(
      AppSetting,
      STORAGE_KEYS.provider,
      provider,
      'Global file storage provider: local or do_spaces',
      updatedBy
    );
    await upsertTextSetting(
      AppSetting,
      STORAGE_KEYS.endpoint,
      endpoint,
      'DigitalOcean Spaces endpoint (example: nyc3.digitaloceanspaces.com)',
      updatedBy
    );
    await upsertTextSetting(
      AppSetting,
      STORAGE_KEYS.region,
      region,
      'DigitalOcean Spaces region (example: nyc3)',
      updatedBy
    );
    await upsertTextSetting(
      AppSetting,
      STORAGE_KEYS.bucket,
      bucket,
      'DigitalOcean Spaces bucket name',
      updatedBy
    );
    await upsertTextSetting(
      AppSetting,
      STORAGE_KEYS.accessKey,
      accessKey,
      'DigitalOcean Spaces access key',
      updatedBy
    );
    await upsertTextSetting(
      AppSetting,
      STORAGE_KEYS.secretKey,
      finalSecret,
      'DigitalOcean Spaces secret key',
      updatedBy
    );
    await upsertTextSetting(
      AppSetting,
      STORAGE_KEYS.cdnBaseUrl,
      cdnBaseUrl,
      'Optional public CDN/base URL for files',
      updatedBy
    );
    await upsertTextSetting(
      AppSetting,
      STORAGE_KEYS.directory,
      directory,
      'Optional base directory/prefix inside bucket',
      updatedBy
    );

    const config = await getStorageConfig();
    return res.status(200).json({
      code: 'SUCCESS',
      message: 'Storage settings updated successfully.',
      data: {
        provider: config.provider,
        doSpaces: {
          endpoint: config.doSpaces.endpoint,
          region: config.doSpaces.region,
          bucket: config.doSpaces.bucket,
          accessKey: config.doSpaces.accessKey,
          secretKey: config.doSpaces.secretKey ? '********' : '',
          hasSecretKey: Boolean(config.doSpaces.secretKey),
          cdnBaseUrl: config.doSpaces.cdnBaseUrl,
          directory: config.doSpaces.directory,
        },
        isDoSpacesConfigured: config.isDoSpacesConfigured,
      },
    });
  } catch (err) {
    if (err instanceof StorageProviderError) {
      return res.status(502).json({
        code: err.code || 'STORAGE_ERROR',
        message: err.message || 'Storage provider operation failed.',
      });
    }
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'Unable to update storage setting.',
    });
  }
}

module.exports = {
  getCacheSetting,
  updateCacheSetting,
  getStorageSetting,
  updateStorageSetting,
};
