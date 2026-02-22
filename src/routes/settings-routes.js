const express = require('express');
const { authorize } = require('../middleware/authz');
const {
  getCacheSetting,
  updateCacheSetting,
  getStorageSetting,
  updateStorageSetting,
} = require('../controllers/settings-controller');

const router = express.Router();

router.get('/cache', authorize('settings.update'), getCacheSetting);
router.put('/cache', authorize('settings.update'), updateCacheSetting);
router.get('/storage', authorize('settings.update'), getStorageSetting);
router.put('/storage', authorize('settings.update'), updateStorageSetting);

module.exports = router;
